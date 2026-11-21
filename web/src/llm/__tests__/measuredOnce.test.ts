// A check's slice metrics are computed once for the slices they are computed
// from (metrics/measuredOnce.ts). Two things are held here:
//
// - a result given back is exactly the one a fresh computation gives (every
//   number bit for bit), for the same dataset, cut and settings and no other;
// - whatever changes a stage's output makes its metrics computed again: a run,
//   a tuning trial, a promote, a fix put back (which gives the results from
//   before it back), Close volume, another dataset, another data root, a page
//   reload.
//
// The "disk" is a fake backend: each stage output has a content, and every
// read builds new slices from it, as a fetch does. The metric functions are
// counted where they are computed, so the counts do not depend on the cache's
// own bookkeeping: with the cache taken out, the tests marked "(count)" fail.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset, Slice } from "../../api/types";
import { resetVolumeState } from "../../state/volumeReset";
import { usePipelineStore } from "../../state/pipelineStore";
import { loadPipelineContext } from "../context/loadContext";
import { exactText, forgetMeasured, measuredCounts, measuredOnce, RESULTS_KEPT, SLICE_BYTES_KEPT, SLICES_KEPT } from "../metrics/measuredOnce";
import { evaluateStage } from "../tune/evaluate";
import { TUNE_STAGES } from "../tune/catalog";
import { labelsOn, makeSlice } from "./helpers";

const api = vi.hoisted(() => ({
  fetchBraggProfile: vi.fn(),
  fetchConsistencyCheck: vi.fn(),
  fetchDpdfMeta: vi.fn(),
  fetchDpdfSlice: vi.fn(),
  fetchMeta: vi.fn(),
  fetchProtectedLabels: vi.fn(),
  fetchRingDiagnostics: vi.fn(),
  fetchRingIsotropy: vi.fn(),
  fetchShellFloors: vi.fn(),
  fetchSlice: vi.fn(),
}));
vi.mock("../../api/client", () => api);

// Each metric counted where it is computed.
const computed = vi.hoisted(() => ({ rings: 0, leftovers: 0, backfill: 0, flatten: 0, dpdf: 0 }));
vi.mock("../metrics/rings", async (orig) => {
  const m = await orig<typeof import("../metrics/rings")>();
  return { ...m, ringMetrics: (...a: Parameters<typeof m.ringMetrics>) => ((computed.rings += 1), m.ringMetrics(...a)) };
});
vi.mock("../metrics/punch", async (orig) => {
  const m = await orig<typeof import("../metrics/punch")>();
  return { ...m, scanLeftoverPeaks: (...a: Parameters<typeof m.scanLeftoverPeaks>) => ((computed.leftovers += 1), m.scanLeftoverPeaks(...a)) };
});
vi.mock("../metrics/backfill", async (orig) => {
  const m = await orig<typeof import("../metrics/backfill")>();
  return { ...m, backfillMetrics: (...a: Parameters<typeof m.backfillMetrics>) => ((computed.backfill += 1), m.backfillMetrics(...a)) };
});
vi.mock("../metrics/flatten", async (orig) => {
  const m = await orig<typeof import("../metrics/flatten")>();
  return { ...m, flattenMetrics: (...a: Parameters<typeof m.flattenMetrics>) => ((computed.flatten += 1), m.flattenMetrics(...a)) };
});
vi.mock("../metrics/dpdf", async (orig) => {
  const m = await orig<typeof import("../metrics/dpdf")>();
  return { ...m, dpdfMetrics: (...a: Parameters<typeof m.dpdfMetrics>) => ((computed.dpdf += 1), m.dpdfMetrics(...a)) };
});
const total = () => computed.rings + computed.leftovers + computed.backfill + computed.flatten + computed.dpdf;
const zero = () => Object.assign(computed, { rings: 0, leftovers: 0, backfill: 0, flatten: 0, dpdf: 0 });

// ---------------------------------------------------------------- the fake disk
//
// A data root holds, per volume id, the content of that output (a number: a
// run that rewrites the output gives it another). A slice read from it is
// built anew on every read.

type Root = Map<string, number>;
const STAGES = ["raw", "ringremoved", "braggpunched", "backfilled", "flattened"] as const;
const N = 61;

const noise = (ix: number, iy: number, seed: number) => (((ix * 7919 + iy * 104729 + seed * 15485863) % 1000) / 500 - 1) * 0.3;

function recipSlice(stage: string, content: number, plane: string): Slice {
  const p = ["hk0", "h0l", "0kl"].indexOf(plane) + 1;
  return makeSlice(
    N,
    N,
    (x, y, ix, iy) => {
      const r = Math.hypot(x, y);
      if (r > 3.05) return NaN;
      let v = 6 * Math.exp(-0.4 * r) + noise(ix, iy, content * 7 + p) + 0.05 * p * x;
      const atNode = Math.abs(x - Math.round(x)) < 0.06 && Math.abs(y - Math.round(y)) < 0.06;
      if (stage === "raw") v += Math.abs(r - 2.2) < 0.08 ? 3 : 0;
      if (stage === "raw" || stage === "ringremoved") v += atNode ? 400 : 0;
      if (stage === "braggpunched" && atNode) return NaN;
      if (stage === "backfilled" || stage === "flattened") v += atNode ? 0.2 * noise(iy, ix, content) : 0;
      if (stage === "flattened") v -= 1.5 + 0.02 * r * r;
      // A leftover the punch missed, where this content has one.
      if (stage !== "raw" && stage !== "ringremoved" && content % 2 === 1) v += 30 * Math.exp(-((x - 1.5) ** 2 + (y - 0.5) ** 2) / 0.01);
      return v;
    },
    { half: 3 },
  );
}

const dpdfSlice = (content: number, plane: string): Slice => {
  const p = ["xy", "xz", "yz"].indexOf(plane) + 1;
  return makeSlice(41, 41, (x, y, ix, iy) => Math.cos(0.7 * x) * Math.cos(0.5 * y * p) * Math.exp(-0.01 * (x * x + y * y)) + 0.05 * noise(ix, iy, content), { half: 20 });
};

let root: Root;
const datasetOf = (id: string, mtime = 1): Dataset => ({
  id,
  temperature: null,
  raw_name: `${id}.nxs`,
  stem: id,
  stages: [
    ...STAGES.map((name) => ({ name, exists: true, kind: "hkl" as const, volume_id: `${id}.${name}`, mtime: name === "raw" ? null : mtime })),
    { name: "delta_pdf", exists: true, kind: "delta_pdf" as const, volume_id: `${id}.delta_pdf`, mtime, source: "flattened" },
  ],
});

/** A dataset's outputs written: each stage's content is `content`, or its own. */
function write(r: Root, id: string, content: number | Partial<Record<(typeof STAGES)[number] | "delta_pdf", number>>): void {
  for (const name of [...STAGES, "delta_pdf"] as const) {
    const c = typeof content === "number" ? content : content[name];
    if (c !== undefined) r.set(`${id}.${name}`, c);
  }
}

const A = datasetOf("A");
const B = datasetOf("B");

beforeEach(() => {
  vi.resetAllMocks();
  forgetMeasured();
  zero();
  usePipelineStore.setState(usePipelineStore.getInitialState(), true);
  root = new Map();
  write(root, "A", 1);
  write(root, "B", 2);
  const content = (id: string): number => {
    const c = root.get(id);
    if (c === undefined) throw new Error(`404 ${id}`);
    return c;
  };
  api.fetchMeta.mockImplementation(async (id: string) => {
    content(id);
    return {
      shape: [N, N, N],
      h_range: [-3, 3],
      k_range: [-3, 3],
      l_range: [-3, 3],
      lattice: { a: 4, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90 },
      ...(id.endsWith(".flattened") ? { flatten_settings: { fit_q_range: [1, 4], floor_percentile: 25 } } : {}),
    };
  });
  api.fetchSlice.mockImplementation(async (id: string, plane: string) => recipSlice(id.split(".").pop()!, content(id), plane));
  api.fetchProtectedLabels.mockImplementation(async (id: string, plane: string) => labelsOn(recipSlice("braggpunched", content(`${id}.braggpunched`), plane), () => 0, { declared: null }));
  api.fetchDpdfSlice.mockImplementation(async (id: string, plane: string) => dpdfSlice(content(id), plane));
  api.fetchDpdfMeta.mockImplementation(async (id: string) => (content(id), { lattice: { a: 4, b: 4, c: 4 }, window_open_weight: 0.01, window_shape: "box" }));
  api.fetchBraggProfile.mockResolvedValue({ has_profile: true, n_peaks: 12 });
  api.fetchConsistencyCheck.mockResolvedValue({ has_check: true, metrics: { pearson_r: 0.99, normalized_rms: 0.1, per_plane_r: {} } });
  api.fetchRingDiagnostics.mockRejectedValue(new Error("404"));
  api.fetchRingIsotropy.mockRejectedValue(new Error("404"));
  api.fetchShellFloors.mockRejectedValue(new Error("404"));
});

/** Every check's numbers on a dataset: each stage's evaluation and the opening context, written exactly. */
async function everyCheck(dataset: Dataset): Promise<string> {
  const out: Record<string, unknown> = {};
  for (const stage of TUNE_STAGES) out[stage] = await evaluateStage(stage, dataset);
  out.context = (await loadPipelineContext(dataset)).context;
  return exactText(JSON.parse(JSON.stringify(out, (_k, v: unknown) => (typeof v === "number" && !Number.isFinite(v) ? String(v) : Object.is(v, -0) ? "-0" : v))));
}

/** The same, with nothing kept: what the code before the cache computes. */
async function fresh(dataset: Dataset): Promise<string> {
  forgetMeasured();
  const out = await everyCheck(dataset);
  forgetMeasured();
  return out;
}

describe("a check's metrics are computed once for the slices they are computed from", () => {
  it("the fake disk makes metrics that differ with the content, the plane and the stage", async () => {
    const one = await fresh(A);
    write(root, "A", 3);
    expect(await fresh(A)).not.toBe(one);
    const e = await evaluateStage("punch", A);
    expect(e.leftover_off_lattice_sharp).toBeGreaterThan(0);
    const b = await evaluateStage("backfill", A);
    expect((b.per_plane as Record<string, { n_filled: number }>).hk0.n_filled).toBeGreaterThan(0);
  });

  it("a repeat gives exactly the fresh numbers and computes nothing (count)", async () => {
    const first = await everyCheck(A);
    const cost = total();
    expect(cost).toBeGreaterThan(0);
    zero();
    const again = await everyCheck(A);
    expect(again).toBe(first);
    expect(total()).toBe(0);
    // And both are what a computation with nothing kept gives.
    expect(await fresh(A)).toBe(first);
  });

  it("every stage's check after the first reuses the cuts' metrics (count)", async () => {
    await evaluateStage("rings", A);
    // Three planes: each stage's metrics once per plane.
    expect({ ...computed }).toEqual({ rings: 3, leftovers: 3, backfill: 3, flatten: 3, dpdf: 0 });
    zero();
    await evaluateStage("punch", A);
    // Only the punch's own scan of the backfilled cuts is new.
    expect({ ...computed }).toEqual({ rings: 0, leftovers: 3, backfill: 0, flatten: 0, dpdf: 0 });
    zero();
    await evaluateStage("backfill", A);
    expect(total()).toBe(0);
    await evaluateStage("flatten", A);
    // The flatten is judged with what its run recorded, read from the file here.
    expect({ ...computed }).toEqual({ rings: 0, leftovers: 0, backfill: 0, flatten: 3, dpdf: 0 });
  });

  it("a result given back is a copy: changing it changes no later one", async () => {
    const first = await evaluateStage("backfill", A);
    const text = exactText(JSON.parse(JSON.stringify(first)));
    const plane = (first.per_plane as Record<string, Record<string, unknown>>).hk0;
    plane.n_filled = -1;
    delete plane.median_seam_sigma;
    const { context } = await loadPipelineContext(A);
    context.ring_removal!.ring_residuals?.push({ at: 0, fwhm: 0, residual_fraction: 9, noise_fraction: 0, significant: true });
    context.bragg_punch!.leftover.suspicious_peaks.length = 0;
    expect(exactText(JSON.parse(JSON.stringify(await evaluateStage("backfill", A))))).toBe(text);
    const again = await fresh(A);
    expect(await everyCheck(A)).toBe(again);
    expect(await everyCheck(A)).toBe(again);
  });

  it("a slice changed after it was read does not change what is kept for it", async () => {
    const held: Slice[] = [];
    const real = api.fetchSlice.getMockImplementation()!;
    api.fetchSlice.mockImplementation(async (...a: unknown[]) => {
      const s = (await real(...a)) as Slice;
      held.push(s);
      return s;
    });
    const first = await everyCheck(A);
    for (const s of held) s.data.fill(7);
    held.length = 0;
    expect(await everyCheck(A)).toBe(first);
  });

  it("a pipeline run from the punch: the stages it rewrote are computed again, the ring stage's are reused (count)", async () => {
    const before = await everyCheck(A);
    zero();
    // The run rewrites the punch's output and every one after it. The listing the check holds is the old one.
    write(root, "A", { braggpunched: 5, backfilled: 5, flattened: 5, delta_pdf: 5 });
    const after = await everyCheck(A);
    expect(after).not.toBe(before);
    expect(computed.rings).toBe(0);
    expect(computed.leftovers).toBeGreaterThanOrEqual(6);
    expect(computed.backfill).toBe(3);
    expect(computed.flatten).toBeGreaterThanOrEqual(3);
    expect(computed.dpdf).toBeGreaterThanOrEqual(1);
    expect(await fresh(A)).toBe(after);
  });

  it("a run from the flatten: only the flatten's and the ΔPDF's are computed again (count)", async () => {
    await everyCheck(A);
    zero();
    write(root, "A", { flattened: 9, delta_pdf: 9 });
    const after = await everyCheck(A);
    expect([computed.rings, computed.leftovers, computed.backfill]).toEqual([0, 0, 0]);
    expect(computed.flatten).toBeGreaterThanOrEqual(3);
    expect(computed.dpdf).toBeGreaterThanOrEqual(1);
    expect(await fresh(A)).toBe(after);
  });

  it("a run that rewrites every output computes everything again", async () => {
    const before = await everyCheck(A);
    const cost = total();
    zero();
    write(root, "A", 11);
    const after = await everyCheck(A);
    expect(after).not.toBe(before);
    expect(total()).toBe(cost);
    expect(await fresh(A)).toBe(after);
  });

  it("a tuning trial is measured on its own outputs, and a promote reuses the trial's (count)", async () => {
    const before = await everyCheck(A);
    // The trial's view: the dataset's outputs up to the punch, its own from there.
    const view = datasetOf("A~tune~r1~punch-1", 2);
    write(root, view.id, { raw: 1, ringremoved: 1, braggpunched: 21, backfilled: 21, flattened: 21, delta_pdf: 21 });
    zero();
    const trial = await everyCheck(view);
    expect(computed.backfill).toBe(3);
    expect(trial).not.toBe(before.split('"A"').join(`"${view.id}"`));
    expect(await fresh(view)).toBe(trial);
    // The dataset's own are as they were.
    await everyCheck(view);
    expect(await everyCheck(A)).toBe(before);
    // Promote: the trial's files become the dataset's.
    write(root, "A", { braggpunched: 21, backfilled: 21, flattened: 21, delta_pdf: 21 });
    zero();
    const promoted = await everyCheck(A);
    expect(total()).toBe(0);
    expect(promoted).not.toBe(before);
    expect(await fresh(A)).toBe(promoted);
  });

  it("a fix put back gives the numbers from before it, from the results kept then (count)", async () => {
    const before = await everyCheck(A);
    // The fix's run rewrites from the punch; the check on it is what makes it worse.
    write(root, "A", { braggpunched: 31, backfilled: 31, flattened: 31, delta_pdf: 31 });
    const worse = await everyCheck(A);
    expect(worse).not.toBe(before);
    // Put back: the outputs from before the fix are restored.
    write(root, "A", 1);
    zero();
    const restored = await everyCheck(A);
    expect(restored).toBe(before);
    expect(total()).toBe(0);
    expect(await fresh(A)).toBe(before);
    // And the fix's own, were it run again, are the fix's.
    write(root, "A", { braggpunched: 31, backfilled: 31, flattened: 31, delta_pdf: 31 });
    expect(await everyCheck(A)).toBe(worse);
  });

  it("Close volume forgets everything (count)", async () => {
    const first = await everyCheck(A);
    const cost = total();
    resetVolumeState();
    expect(measuredCounts()).toMatchObject({ slices: 0, bytes: 0, results: 0 });
    zero();
    expect(await everyCheck(A)).toBe(first);
    expect(total()).toBe(cost);
  });

  it("another dataset is measured on its own slices, never given the first's", async () => {
    const a = await everyCheck(A);
    zero();
    const b = await everyCheck(B);
    expect(computed.rings).toBe(3);
    expect(b).not.toBe(a.split('"A"').join('"B"'));
    expect(await fresh(B)).toBe(b);
    expect(await everyCheck(A)).toBe(a);
    expect(await everyCheck(B)).toBe(b);
  });

  it("another data root with a dataset of the same name is measured on its own files", async () => {
    const first = await everyCheck(A);
    // The same id, the same listing, other files.
    root.clear();
    write(root, "A", 41);
    zero();
    const other = await everyCheck(A);
    expect(other).not.toBe(first);
    expect(computed.rings).toBe(3);
    expect(await fresh(A)).toBe(other);
  });

  it("a page reload starts with nothing kept", async () => {
    await everyCheck(A);
    expect(measuredCounts().results).toBeGreaterThan(0);
    vi.resetModules();
    const reloaded = await import("../metrics/measuredOnce");
    expect(reloaded.measuredCounts()).toMatchObject({ slices: 0, results: 0 });
  });

  it("another cut is another measurement", async () => {
    const at0 = (await loadPipelineContext(A, { recip: { plane: "hk0", value: 0 }, dpdf: null, records: false })).context;
    zero();
    api.fetchSlice.mockImplementation(async (id: string, plane: string, value: number) => recipSlice(id.split(".").pop()!, root.get(id)! + (value ? 100 : 0), plane));
    const at1 = (await loadPipelineContext(A, { recip: { plane: "hk0", value: 1 }, dpdf: null, records: false })).context;
    expect(computed.rings).toBe(1);
    expect(at1.backfill).not.toEqual(at0.backfill);
    const h0l = (await loadPipelineContext(A, { recip: { plane: "h0l", value: 0 }, dpdf: null, records: false })).context;
    expect(computed.rings).toBe(2);
    expect(h0l.ring_removal).not.toEqual(at0.ring_removal);
    // The same slices named as another plane are another cut: |Q| and H K L are the plane's.
    api.fetchSlice.mockImplementation(async (id: string) => recipSlice(id.split(".").pop()!, root.get(id)!, "hk0"));
    zero();
    await loadPipelineContext(A, { recip: { plane: "hk0", value: 0 }, dpdf: null, records: false });
    expect(total()).toBe(0);
    await loadPipelineContext(A, { recip: { plane: "0kl", value: 0 }, dpdf: null, records: false });
    await loadPipelineContext(A, { recip: { plane: "hk0", value: 0.5 }, dpdf: null, records: false });
    expect(computed.leftovers).toBe(2);
  });

  it("another setting is another measurement: the punch's cell, the leftovers listed, the flatten's record, the cell", async () => {
    const base = { recip: { plane: "hk0", value: 0 }, dpdf: null, records: false } as const;
    const first = (await loadPipelineContext(A, base)).context;
    zero();
    // The punch's indexing cell, from the form.
    usePipelineStore.getState().patch({ punchSupercellH: "2" } as never);
    const doubled = (await loadPipelineContext(A, base)).context;
    expect(computed).toMatchObject({ rings: 0, leftovers: 1, backfill: 0, flatten: 0 });
    forgetMeasured();
    expect((await loadPipelineContext(A, base)).context).toEqual(doubled);
    usePipelineStore.getState().patch({ punchSupercellH: "" } as never);
    expect((await loadPipelineContext(A, base)).context).toEqual(first);
    // Every leftover, not the strongest few.
    zero();
    await loadPipelineContext(A, base);
    expect(total()).toBe(0);
    await loadPipelineContext(A, { ...base, allLeftovers: true });
    expect(computed).toMatchObject({ rings: 0, leftovers: 1, backfill: 0, flatten: 0 });
    // The flatten's recorded fit range and percentile.
    zero();
    for (const settings of [{ fit_q_range: [1, 3], floor_percentile: 25 }, { fit_q_range: [1, 4], floor_percentile: 10 }, null, undefined]) {
      const c = (await loadPipelineContext(A, { ...base, flattenRecord: { settings: settings as never } })).context;
      forgetMeasured();
      expect((await loadPipelineContext(A, { ...base, flattenRecord: { settings: settings as never } })).context).toEqual(c);
    }
    // The cell the |Q| shells and the nodes' reach come from.
    await loadPipelineContext(A, base);
    zero();
    const meta = api.fetchMeta.getMockImplementation()!;
    api.fetchMeta.mockImplementation(async (id: string) => ({ ...(await meta(id)), lattice: { a: 4, b: 4, c: 5, alpha: 90, beta: 90, gamma: 90 } }));
    await loadPipelineContext(A, base);
    // Named by the whole cell: more than this plane's |Q| reads, never less.
    expect(computed).toMatchObject({ rings: 1, leftovers: 1, backfill: 0, flatten: 1 });
    api.fetchMeta.mockImplementation(async (id: string) => ({ ...(await meta(id)), lattice: { a: 4.5, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90 } }));
    const stretched = (await loadPipelineContext(A, base)).context;
    expect(computed).toMatchObject({ rings: 2, leftovers: 2, backfill: 0, flatten: 2 });
    forgetMeasured();
    expect((await loadPipelineContext(A, base)).context).toEqual(stretched);
  });
});

describe("measuredOnce", () => {
  const grid = (data: number[] | Float32Array, header: Record<string, unknown> = {}) => ({ header: { nx: data.length, ny: 1, x_axis: [0], y_axis: [0], ...header }, data: data instanceof Float32Array ? data : new Float32Array(data) });
  let n = 0;
  const run = (slices: Parameters<typeof measuredOnce>[1], values: unknown, name = "t") => measuredOnce(name, slices, values, () => ({ n: ++n, z: -0, nan: NaN, inf: -Infinity, u: undefined, list: [1, { a: null }] }));
  beforeEach(() => {
    forgetMeasured();
    n = 0;
  });

  it("gives back the result kept, exactly, for the same slices and values", () => {
    const a = run([grid([1, NaN, -0, 3])], { p: 0.25, q: [1, 2] });
    const b = run([grid([1, NaN, -0, 3])], { p: 0.25, q: [1, 2] });
    expect(n).toBe(1);
    expect(b).not.toBe(a);
    expect(Object.is(b.z, -0) && Number.isNaN(b.nan) && b.inf === -Infinity && "u" in b && b.u === undefined).toBe(true);
    expect(b).toEqual(a);
    expect(Object.keys(b)).toEqual(Object.keys(a));
  });

  it("computes again for any other slice: one bit, the sign of a zero, a NaN's bits, the header, the order, the array type, null or none", () => {
    const base = () => grid([1, 2, 0, NaN]);
    run([base(), null], 1);
    const others: Parameters<typeof measuredOnce>[1][] = [
      [grid([1, 2.0000002, 0, NaN]), null],
      [grid([1, 2, -0, NaN]), null],
      [grid([1, 2, 0, NaN], { nx: 2, ny: 2 }), null],
      [grid([1, 2, 0, NaN], { x_axis: [-0] }), null],
      [grid([1, 2, 0, NaN], { robust_max: 2 }), null],
      [grid([1, 2, 0]), null],
      [null, base()],
      [base(), undefined],
      [base()],
      [base(), base()],
      [{ ...base(), data: new Float64Array([1, 2, 0, NaN]) } as never, null],
    ];
    const quiet = new Float32Array([1, 2, 0, NaN]);
    new Uint32Array(quiet.buffer)[3] = 0x7fc00001; // another NaN
    others.push([grid(quiet), null]);
    let expected = 1;
    for (const o of others) {
      run(o, 1);
      expect(n).toBe(++expected);
    }
    run([base(), null], 1);
    expect(n).toBe(expected);
  });

  it("computes again for any other value or name", () => {
    const s = () => [grid([1, 2, 3])];
    const values: unknown[] = [0, -0, null, undefined, {}, { a: undefined }, { a: null }, { a: 0 }, { a: -0 }, { a: "0" }, [0], [[0]], [undefined], [null], Infinity, -Infinity, NaN, "NaN", 0.1 + 0.2, 0.3, true, "true", { a: 1, b: 2 }, { b: 2, a: 1 }, { topK: Infinity }, { topK: undefined }];
    values.forEach((v, i) => {
      run(s(), v);
      expect(n).toBe(i + 1);
    });
    values.forEach((v) => run(s(), v));
    expect(n).toBe(values.length);
    run(s(), 0, "other");
    expect(n).toBe(values.length + 1);
  });

  it("computes every time what it cannot name exactly: a plain array of data, a function, a class", () => {
    for (const again of [1, 2]) {
      run([{ header: { nx: 2, ny: 1, x_axis: [0], y_axis: [0] }, data: [1, 2] }], 1);
      run([grid([1])], { f: () => 1 });
      run([grid([1])], new Map());
      run([grid([1])], new Date(0));
      expect(n).toBe(4 * again);
    }
    // And a result that is not plain data is given, never kept.
    let m = 0;
    const odd = () => measuredOnce("odd", [grid([1])], 1, () => ({ m: ++m, at: new Date(0) }));
    expect([odd().m, odd().m]).toEqual([1, 2]);
  });

  it("holds a bounded number of slices, bytes and results, and stays right past them", () => {
    for (let i = 0; i < SLICES_KEPT + 20; i++) run([grid([i])], 1);
    expect(measuredCounts().slices).toBe(SLICES_KEPT);
    const made = n;
    run([grid([SLICES_KEPT + 19])], 1); // still kept
    expect(n).toBe(made);
    run([grid([0])], 1); // let go: computed again
    expect(n).toBe(made + 1);
    for (let i = 0; i < RESULTS_KEPT + 30; i++) run([grid([1])], i);
    expect(measuredCounts().results).toBe(RESULTS_KEPT);
    // Large slices: the bytes held stay under the limit.
    const big = SLICE_BYTES_KEPT / 4 / 3;
    for (let i = 0; i < 5; i++) {
      const data = new Float32Array(big).fill(i);
      run([grid(data)], "big");
      expect(measuredCounts().bytes).toBeLessThanOrEqual(SLICE_BYTES_KEPT);
    }
    const before = n;
    run([grid(new Float32Array(big).fill(4))], "big");
    expect(n).toBe(before);
    // One slice larger than the limit is still measured, and right.
    const huge = new Float32Array(SLICE_BYTES_KEPT / 4 + 4).fill(1);
    expect(run([grid(huge)], "huge").n).toBe(n);
    expect(measuredCounts().slices).toBe(1);
  });
});
