// The assistant's tools against a mocked API: argument checking, the line
// profile's row/column pick, the Bragg-peak sort, show_in_viewer moving the
// console's stores, and the two that act: update_settings and run_pipeline.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BraggProfile, Dataset, VolumeMeta } from "../../api/types";
import { useDpdfStore } from "../../state/dpdfStore";
import { useNavStore } from "../../state/navStore";
import { usePipelineStore } from "../../state/pipelineStore";
import { useViewerStore } from "../../state/viewerStore";
import { useTuneStore, type StageRun } from "../tune/tuner";
import { CHAT_TOOLS, runToolCall, type ToolContext } from "../tools";
import { makeSlice } from "./helpers";

const api = vi.hoisted(() => ({
  fetchBraggProfile: vi.fn(),
  fetchConsistencyCheck: vi.fn(),
  fetchDataset: vi.fn(),
  fetchDpdfMeta: vi.fn(),
  fetchDpdfSlice: vi.fn(),
  fetchMeta: vi.fn(),
  fetchSlice: vi.fn(),
}));
vi.mock("../../api/client", () => api);

const evaluate = vi.hoisted(() => ({ evaluateStage: vi.fn() }));
vi.mock("../tune/evaluate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tune/evaluate")>()),
  evaluateStage: evaluate.evaluateStage,
}));

const tuner = vi.hoisted(() => ({ startTuning: vi.fn() }));
vi.mock("../tune/tuner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tune/tuner")>()),
  startTuning: tuner.startTuning,
}));

const dataset: Dataset = {
  id: "demo",
  temperature: "T1",
  raw_name: "demo.nxs",
  stem: "demo",
  stages: [
    { name: "raw", exists: true, kind: "hkl", volume_id: "demo.raw" },
    { name: "flattened", exists: true, kind: "hkl", volume_id: "demo.flattened" },
    { name: "delta_pdf", exists: true, kind: "delta_pdf", volume_id: "demo.delta_pdf" },
  ],
};
const ctx: ToolContext = { dataset, datasets: [dataset] };

const META: VolumeMeta = {
  id: "demo.raw",
  stage: "raw",
  kind: "hkl",
  shape: [21, 21, 11],
  h_range: [-2, 2],
  k_range: [-2, 2],
  l_range: [-1, 1],
  lattice: { a: 4, b: 4, c: 6, alpha: 90, beta: 90, gamma: 90 },
  planes: ["hk0", "h0l", "0kl"],
};

const run = (name: string, args: object) =>
  runToolCall({ id: "c", type: "function", function: { name, arguments: JSON.stringify(args) } }, CHAT_TOOLS, ctx);

beforeEach(() => {
  vi.resetAllMocks();
  api.fetchMeta.mockResolvedValue(META);
  api.fetchDpdfMeta.mockResolvedValue({
    id: "demo.delta_pdf",
    shape: [41, 41, 21],
    x_range: [-20, 20],
    y_range: [-20, 20],
    z_range: [-10, 10],
    lattice: META.lattice,
    q_max: 6,
    planes: ["xy", "xz", "yz"],
  });
});

describe("runToolCall", () => {
  it("reports unparseable arguments and unknown tools to the model", async () => {
    const bad = await runToolCall({ id: "c", type: "function", function: { name: "describe_dataset", arguments: "{oops" } }, CHAT_TOOLS, ctx);
    expect(bad.ok).toBe(false);
    expect(bad.text).toMatch(/not a JSON object/);
    const unknown = await run("delete_everything", {});
    expect(unknown.text).toMatch(/no tool named delete_everything/);
  });

  it("rejects an out-of-range cut with the valid range", async () => {
    const r = await run("measure_reciprocal_cut", { plane: "hk0", value: 5 });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/invalid arguments — L = 5 is outside the data range \[-1, 1\]/);
  });

  it("rejects an unknown plane", async () => {
    const r = await run("measure_reciprocal_cut", { plane: "hkl", value: 0 });
    expect(r.text).toMatch(/plane must be one of hk0, h0l, 0kl/);
  });
});

describe("line_profile", () => {
  it("reads the row through the requested coordinate and finds its maximum", async () => {
    // hk0 plane: x = H, y = K.  A peak on the K = 1 row at H = 0.6.
    api.fetchSlice.mockResolvedValue(
      makeSlice(21, 21, (x, y) => (Math.abs(y - 1) < 1e-9 && Math.abs(x - 0.6) < 1e-9 ? 50 : 1), { half: 2 }),
    );
    const r = await run("line_profile", { stage: "flattened", along: "H", at: { K: 1, L: 0 }, n_points: 21 });
    expect(r.ok).toBe(true);
    expect(api.fetchSlice).toHaveBeenCalledWith("demo.flattened", "hk0", 0);
    const res = JSON.parse(r.text);
    expect(res.through).toEqual({ K: 1, L: 0 });
    expect(res.max).toEqual({ at: 0.6, value: 50 });
    expect(res.points).toHaveLength(21);
  });

  it("reads a column when the line runs along the plane's y axis", async () => {
    // Line along L through H = 0.4, K = 0 → the h0l plane (x = H, y = L) at K = 0,
    // on the meta's grid: H ∈ [-2, 2] (21 points), L ∈ [-1, 1] (11 points).
    const slice = makeSlice(21, 11, () => 0);
    slice.header.x_axis = Array.from({ length: 21 }, (_v, i) => -2 + 0.2 * i);
    slice.header.y_axis = Array.from({ length: 11 }, (_v, i) => -1 + 0.2 * i);
    slice.data[3 * 21 + 12] = 9; // L = -0.4 (row 3), H = 0.4 (column 12)
    api.fetchSlice.mockResolvedValue(slice);
    const r = await run("line_profile", { stage: "raw", along: "L", at: { H: 0.4, K: 0 } });
    expect(api.fetchSlice).toHaveBeenCalledWith("demo.raw", "h0l", 0);
    const res = JSON.parse(r.text);
    expect(res.through).toEqual({ H: 0.4, K: 0 });
    expect(res.max).toEqual({ at: -0.4, value: 9 });
  });
});

describe("bragg_peaks", () => {
  it("sorts by significance by default and by distance on request", async () => {
    const peak = (hkl: [number, number, number], sig: number) => ({
      index: 0,
      source_node_hkl: null,
      center_hkl: hkl,
      q_abs: 1,
      intensity: 10,
      local_background: 1,
      significance: sig,
      width_hkl: [0.1, 0.1, 0.1],
      width_q: [0.1, 0.1, 0.1],
      measured_width_q: [0.05, 0.05, 0.1],
      principal_directions_hkl: [],
      fit_kind: "covariance",
    });
    api.fetchBraggProfile.mockResolvedValue({
      has_profile: true,
      n_peaks: 3,
      punch_frame: "spherical",
      peaks: [peak([1, 0, 0], 8), peak([2, 0, 0], 30), peak([0, 1, 0], 12)],
    } as unknown as BraggProfile);
    const bySig = JSON.parse((await run("bragg_peaks", {})).text);
    expect(bySig.peaks.map((p: { hkl: number[] }) => p.hkl)).toEqual([[2, 0, 0], [0, 1, 0], [1, 0, 0]]);
    expect(bySig.peaks[0].anisotropy).toBe(2);
    const near = JSON.parse((await run("bragg_peaks", { near_hkl: [0, 1, 0], limit: 1 })).text);
    expect(near.peaks).toEqual([expect.objectContaining({ hkl: [0, 1, 0] })]);
  });
});

describe("show_in_viewer", () => {
  it("opens the cleanup page at the cut on the right axis", async () => {
    const r = await run("show_in_viewer", { view: "cleanup", plane: "h0l", value: 0.5 });
    expect(r.ok).toBe(true);
    expect(r.view).toMatchObject({ view: "cleanup", axis: "K", value: 0.5, label: "H–L plane at K = 0.5" });
    expect(useViewerStore.getState().fixedAxis).toBe("K");
    expect(useViewerStore.getState().focus).toEqual({ axis: "K", value: 0.5 });
    expect(useNavStore.getState().tab).toBe("reciprocal");
  });

  it("opens the ΔPDF page with the cut index for the section", async () => {
    await run("show_in_viewer", { view: "dpdf", plane: "xy", value: 5 });
    const s = useDpdfStore.getState();
    // z ∈ [-10, 10] over 21 points → z = 5 is index 15; x and y stay centred.
    expect([s.cutX, s.cutY, s.cutZ]).toEqual([20, 20, 15]);
    expect(useNavStore.getState().tab).toBe("dpdf");
  });
});

describe("update_settings", () => {
  beforeEach(() => usePipelineStore.setState({ punchMinSig: "", ringModel: "pooled", running: false }));

  it("puts a checked change on the Configure page and says where to rerun from", async () => {
    const r = await run("update_settings", { changes: { punchMinSig: 6 } });
    expect(r.ok).toBe(true);
    expect(usePipelineStore.getState().punchMinSig).toBe("6");
    expect(JSON.parse(r.text)).toEqual({ changed: [{ setting: "punchMinSig", from: 5, to: 6 }], rerun_from: "punch" });
  });

  it("leaves a setting already at the value alone", async () => {
    usePipelineStore.setState({ punchMinSig: "6" });
    const r = await run("update_settings", { changes: { punchMinSig: 6 } });
    expect(JSON.parse(r.text)).toEqual({ changed: [], already_set: ["punchMinSig"], rerun_from: null });
    expect(r.summary).toBe("no change: punchMinSig already set");
  });

  it("refuses settings outside the catalog and values out of range", async () => {
    const unknown = await run("update_settings", { changes: { flattenIon: "Fe2+" } });
    expect(unknown.text).toMatch(/invalid arguments — flattenIon cannot be changed/);
    const range = await run("update_settings", { changes: { punchMinSig: 1000 } });
    expect(range.text).toMatch(/punchMinSig must be within/);
    expect(usePipelineStore.getState().punchMinSig).toBe("");
  });

  it("sets a fact about the sample the user asks for: the search's protected planes", async () => {
    usePipelineStore.setState({ punchProtectH: "none" });
    const r = await run("update_settings", { changes: { punchProtectH: "1/3, 2/3" } });
    expect(usePipelineStore.getState().punchProtectH).toBe(""); // the default
    expect(JSON.parse(r.text).changed).toEqual([{ setting: "punchProtectH", from: "none", to: "1/3, 2/3" }]);
    await run("update_settings", { changes: { punchProtectH: [0.5] } });
    expect(usePipelineStore.getState().punchProtectH).toBe("0.5");
    const bad = await run("update_settings", { changes: { punchProtectH: "thirds" } });
    expect(bad.text).toMatch(/H fractions/);
    // The punch cell, for a volume indexed on a doubled cell.
    await run("update_settings", { changes: { punchSupercellH: 2, punchSupercellK: 2, punchSupercellL: 2 } });
    expect(usePipelineStore.getState()).toMatchObject({ punchSupercellH: "2", punchSupercellK: "2", punchSupercellL: "2" });
  });
});

describe("run_pipeline", () => {
  const events = [
    { type: "progress", stage: "rings", status: "skip", message: "ring-removed output exists" },
    { type: "progress", stage: "punch", status: "start", message: "Bragg punch" },
    { type: "progress", stage: "punch", status: "progress", fraction: 0.5, message: "fitting peaks" },
    { type: "progress", stage: "punch", status: "done", fraction: 1, message: "punch complete" },
  ];
  // A run that streams `events` into the store, then ends `ending`.
  const fakeRun = (ending: string, evs = events) =>
    vi.fn(async () => {
      usePipelineStore.setState({ running: true, events: [] });
      for (const ev of evs) usePipelineStore.setState((s) => ({ events: [...s.events, ev] }));
      usePipelineStore.setState({ running: false, terminal: ending });
      return ending;
    });
  const call = (args: object) => ({ id: "c", type: "function" as const, function: { name: "run_pipeline", arguments: JSON.stringify(args) } });

  beforeEach(() => {
    usePipelineStore.setState({ running: false, force: false, flatten: true, pdfEnabled: true, events: [] });
    useNavStore.setState({ tab: "config" });
  });

  it("runs the enabled stages, streams its progress, and reads the fresh dataset", async () => {
    const runStages = fakeRun("done");
    usePipelineStore.setState({ runStages });
    const fresh = { ...dataset, stages: [...dataset.stages, { name: "braggpunched", exists: true, kind: "hkl", volume_id: "demo.braggpunched" }] };
    api.fetchDataset.mockResolvedValue(fresh);
    const own = { ...ctx };
    const lines: string[] = [];
    const r = await runToolCall(call({}), CHAT_TOOLS, own, { progress: (t) => lines.push(t) });
    expect(r.ok).toBe(true);
    expect(runStages).toHaveBeenCalledWith(["rings", "punch", "backfill", "flatten", "pdf", "pdf_check"], { datasetId: "demo", force: false });
    expect(useNavStore.getState().tab).toBe("execution");
    expect(lines).toContain("2/6 Bragg punch 50% · fitting peaks");
    const out = JSON.parse(r.text);
    expect(out.stages).toEqual({ rings: "reused", punch: "computed" });
    expect(out.outputs).toContain("braggpunched");
    expect(own.dataset).toBe(fresh);
    expect(r.summary).toMatch(/^done in .* s · 1 computed, 1 reused$/);
  });

  it("recomputes from a stage on", async () => {
    const runStages = fakeRun("done");
    usePipelineStore.setState({ runStages, flatten: false });
    api.fetchDataset.mockResolvedValue(dataset);
    await runToolCall(call({ from_stage: "punch" }), CHAT_TOOLS, { ...ctx });
    expect(runStages).toHaveBeenCalledWith(["punch", "backfill", "pdf", "pdf_check"], { datasetId: "demo", force: true });
  });

  it("reports a failed run as an error with its last error line", async () => {
    usePipelineStore.setState({
      runStages: fakeRun("error", [{ type: "progress", stage: "backfill", status: "error", message: "out of memory" }]),
    });
    const r = await runToolCall(call({}), CHAT_TOOLS, { ...ctx });
    expect(r.ok).toBe(false);
    expect(r.text).toBe("Error: the run failed: Backfill · out of memory");
  });

  it("will not start while another run is going", async () => {
    const runStages = vi.fn();
    usePipelineStore.setState({ running: true, runStages });
    const r = await runToolCall(call({}), CHAT_TOOLS, { ...ctx });
    expect(r.text).toMatch(/a pipeline run is in progress/);
    expect(runStages).not.toHaveBeenCalled();
  });

  it("cancels the run when the reply is stopped", async () => {
    const abort = new AbortController();
    const cancel = vi.fn(async () => undefined);
    usePipelineStore.setState({
      cancel,
      runStages: vi.fn(async () => {
        abort.abort();
        return "cancelled";
      }),
    });
    const r = await runToolCall(call({}), CHAT_TOOLS, { ...ctx }, { signal: abort.signal });
    expect(cancel).toHaveBeenCalled();
    expect(r.text).toMatch(/the run was cancelled/);
  });
});

describe("tune_pipeline", () => {
  const stage = (s: Partial<StageRun> & Pick<StageRun, "stage">): StageRun => ({ tuned: true, status: "waiting", trials: [], ...s });
  const call = (args: object) => ({ id: "c", type: "function" as const, function: { name: "tune_pipeline", arguments: JSON.stringify(args) } });

  beforeEach(() => {
    usePipelineStore.setState({ running: false });
    useTuneStore.setState({ active: false, stages: [], error: null, finishedNote: null });
  });

  it("tunes the chosen stages, streams its trials, and returns what it kept", async () => {
    tuner.startTuning.mockImplementation(async () => {
      useTuneStore.setState({
        active: true,
        stages: [
          stage({ stage: "punch", status: "running", trials: [{ n: 1, changes: {}, settings: {}, status: "done" }, { n: 2, changes: { punchMinSig: 6 }, settings: {}, status: "running" }] }),
          stage({ stage: "backfill", tuned: false }),
        ],
      });
      useTuneStore.setState({
        active: false,
        finishedNote: "Done.",
        stages: [
          stage({ stage: "punch", status: "done", best: 2, why: "fewer leftover peaks", trials: [{ n: 1, changes: {}, settings: {}, status: "done" }, { n: 2, changes: { punchMinSig: 6 }, settings: {}, status: "done" }] }),
          stage({ stage: "backfill", tuned: false, status: "done", best: 1, trials: [{ n: 1, changes: {}, settings: {}, status: "done" }] }),
        ],
      });
    });
    const lines: string[] = [];
    const r = await runToolCall(call({ stages: ["backfill", "punch"], trials_per_stage: 2 }), CHAT_TOOLS, { ...ctx }, { progress: (t) => lines.push(t) });
    expect(r.ok).toBe(true);
    expect(tuner.startTuning).toHaveBeenCalledWith(expect.objectContaining({ dataset, stages: ["backfill", "punch"], trialsPerStage: 2 }));
    expect(lines).toEqual(["1/2 Bragg punch · trial 2/2 running"]);
    const out = JSON.parse(r.text);
    expect(out.stages[0]).toMatchObject({ stage: "punch", chosen_trial: 2, of: 2, changes: { punchMinSig: 6 }, why: "fewer leftover peaks" });
    expect(out.write_outputs_with).toEqual({ tool: "run_pipeline", from_stage: "punch" });
    expect(r.summary).toMatch(/settings changed on 1 of 2 stages$/);
    expect(useNavStore.getState().tab).toBe("execution");
  });

  it("returns every trial's numbers, marks a trial with no effect, and asks for no write when nothing changed", async () => {
    const same = { leftover_at_nodes: 16, leftover_off_lattice_sharp: 8, leftover_off_lattice_broad: 360, mean_punched_fraction: 0.099 };
    tuner.startTuning.mockImplementation(async () => {
      useTuneStore.setState({
        active: false,
        finishedNote: "Done. Your settings won every tuned stage, so nothing changed.",
        stages: [
          stage({
            stage: "punch",
            status: "done",
            best: 1,
            why: "the others did no better",
            trials: [
              { n: 1, changes: {}, settings: {}, status: "done", evaluation: same },
              { n: 2, changes: { punchMinSig: 3 }, settings: {}, status: "done", evaluation: { ...same } },
              { n: 3, changes: { punchSearchFloor: 20 }, settings: {}, status: "done", evaluation: { ...same, mean_punched_fraction: 0.102 } },
            ],
          }),
        ],
      });
    });
    const out = JSON.parse((await runToolCall(call({ stages: ["punch"] }), CHAT_TOOLS, { ...ctx })).text);
    const trials = out.stages[0].trials;
    expect(trials.map((t: { n: number }) => t.n)).toEqual([1, 2, 3]);
    expect(trials[1]).toMatchObject({ changes: { punchMinSig: 3 }, no_effect: true });
    expect(trials[2].no_effect).toBeUndefined();
    expect(trials[2].result).toMatch(/punched 0.102/);
    expect(out.write_outputs_with).toBeUndefined();
  });

  it("reports a tuning run that stopped on an error", async () => {
    tuner.startTuning.mockImplementation(async () => useTuneStore.setState({ error: "the run with your settings failed" }));
    const r = await runToolCall(call({}), CHAT_TOOLS, { ...ctx });
    expect(r.text).toBe("Error: tuning stopped: the run with your settings failed");
  });

  it("checks its arguments before starting", async () => {
    const r = await runToolCall(call({ trials_per_stage: 9 }), CHAT_TOOLS, { ...ctx });
    expect(r.text).toMatch(/trials_per_stage must be within \[2, 5\]/);
    expect(tuner.startTuning).not.toHaveBeenCalled();
  });
});

// Every stage on disk, for the tools that compare stages.
const STAGE_NAMES = ["raw", "ringremoved", "braggpunched", "backfilled", "flattened"];
const full: Dataset = {
  ...dataset,
  stages: [
    ...STAGE_NAMES.map((name) => ({ name, exists: true, kind: "hkl" as const, volume_id: `demo.${name}` })),
    { name: "delta_pdf", exists: true, kind: "delta_pdf" as const, volume_id: "demo.delta_pdf" },
  ],
};
const runOn = (ds: Dataset, name: string, args: object) =>
  runToolCall({ id: "c", type: "function", function: { name, arguments: JSON.stringify(args) } }, CHAT_TOOLS, { dataset: ds, datasets: [ds] });

describe("assess_stage", () => {
  it("judges each stage that exists against its goal, headline numbers only for all", async () => {
    evaluate.evaluateStage.mockImplementation(async (stage: string) =>
      stage === "flatten"
        ? { max_after_floor_sigma: 0.8, per_plane: { hk0: {} } }
        : { back_fft_pearson_r: 0.99, back_fft_normalized_rms: 0.1, mean_feature_snr: 40, per_plane: {} },
    );
    const r = await run("assess_stage", {});
    const out = JSON.parse(r.text);
    expect(out.rings.missing).toMatch(/no ringremoved output yet/);
    expect(out.flatten).toMatchObject({ headline: "floor ≤ 0.8σ · trend ≤ – · span ≤ –", max_after_floor_sigma: 0.8 });
    expect(out.flatten.goal).toMatch(/floor/);
    expect(out.flatten).not.toHaveProperty("per_plane");
    expect(r.summary).toBe("Flatten: floor ≤ 0.8σ · trend ≤ – · span ≤ – · 3D-ΔPDF: r 0.99 · RMS 0.1 · SNR 40");
    expect(r.view).toMatchObject({ view: "cleanup", plane: "hk0", value: 0, axis: "L" });
  });

  it("keeps the per-plane detail for one stage", async () => {
    evaluate.evaluateStage.mockResolvedValue({ max_after_floor_sigma: 0.8, per_plane: { hk0: { after_floor_max_sigma: 0.8 } } });
    const out = JSON.parse((await run("assess_stage", { stage: "flatten" })).text);
    expect(out.flatten.per_plane.hk0).toEqual({ after_floor_max_sigma: 0.8 });
  });
});

describe("run_log", () => {
  it("returns the last run's lines, for one stage on request", async () => {
    usePipelineStore.setState({
      running: false,
      terminal: "done",
      events: [
        { type: "progress", stage: "rings", status: "done", message: "9 shells fitted" },
        { type: "progress", stage: "punch", status: "progress", fraction: 0.5 },
        { type: "progress", stage: "punch", status: "done", message: "188 peaks punched" },
      ],
    });
    const all = JSON.parse((await run("run_log", {})).text);
    expect(all.ended).toBe("done");
    expect(all.lines.map((l: { message: string }) => l.message)).toEqual(["9 shells fitted", "188 peaks punched"]);
    const punch = JSON.parse((await run("run_log", { stage: "punch" })).text);
    expect(punch.lines).toEqual([{ stage: "punch", status: "done", message: "188 peaks punched" }]);
  });

  it("says when there is no run yet", async () => {
    usePipelineStore.setState({ events: [] });
    expect((await run("run_log", {})).text).toMatch(/no pipeline run in this session yet/);
  });
});

describe("qmax_coverage", () => {
  // Measured out to 1.5 r.l.u. of the origin on every plane; the box ends at 2.
  beforeEach(() => {
    api.fetchSlice.mockResolvedValue(makeSlice(21, 21, (x, y) => (Math.hypot(x, y) < 1.5 ? 1 : NaN), { half: 2 }));
    usePipelineStore.setState({ pdfQMax: "", pdfApod: "", pdfWindowShape: "", pdfWindowSupport: true });
  });
  const check = async () => JSON.parse((await run("qmax_coverage", {})).text);

  it("passes a window tapered to the measured coverage", async () => {
    const out = await check();
    expect(out.full_coverage_q).toBeLessThan(out.box_face_q);
    expect(out.reach_from).toBe("the window is tapered to the measured coverage");
    expect(out.verdict).toMatch(/^the transform reaches .* inside full coverage/);
  });

  it("flags a window that tapers only at the box faces past the coverage", async () => {
    usePipelineStore.setState({ pdfWindowSupport: false });
    const out = await check();
    expect(out.transform_reach_q).toBe(out.box_face_q);
    expect(out.verdict).toMatch(/^too far: .* tapers to zero at the box faces/);
  });

  it("judges an explicit |Q| band, and a flat window by the box corners", async () => {
    usePipelineStore.setState({ pdfQMax: "0.1" });
    expect((await check()).verdict).toMatch(/inside full coverage/);
    usePipelineStore.setState({ pdfQMax: "", pdfApod: "none" });
    const flat = await check();
    expect(flat.transform_reach_q).toBe(6); // the ΔPDF's recorded q_max, the box corner
    expect(flat.verdict).toMatch(/^too far: .* out to the box corners/);
  });

  it("judges by the window's recorded weight on unmeasured space when the ΔPDF has it", async () => {
    const meta = await api.fetchDpdfMeta();
    api.fetchDpdfMeta.mockResolvedValueOnce({ ...meta, window_shape: "ellipsoid", window_scale: 1, window_open_weight: 3.2e-6 });
    const clean = await check();
    expect(clean.window_weight_on_unmeasured).toBe(3.2e-6);
    expect(clean.verdict).toMatch(/^clean: the ΔPDF's ellipsoid window puts 3.2e-6 of its weight/);
    api.fetchDpdfMeta.mockResolvedValueOnce({ ...meta, window_shape: "separable", window_scale: 1, window_open_weight: 0.04 });
    expect((await check()).verdict).toMatch(/^too far: the ΔPDF's separable window puts 0.04/);
  });
});

describe("symmetry_check", () => {
  it("reports each in-plane operation of a hexagonal ΔPDF section", async () => {
    const meta = await api.fetchDpdfMeta();
    api.fetchDpdfMeta.mockResolvedValue({ ...meta, lattice: { a: 8, b: 8, c: 10, alpha: 90, beta: 90, gamma: 120 } });
    const section = makeSlice(41, 41, (u, v) => Math.cos(0.7 * u) + Math.cos(0.7 * v) + Math.cos(0.7 * (u - v)) + 0.3 * Math.cos(0.5 * u));
    section.header.axes_angle = 120;
    api.fetchDpdfSlice.mockResolvedValue(section);
    const r = await runOn(full, "symmetry_check", {});
    const out = JSON.parse(r.text);
    expect(out.cell).toBe("hexagonal");
    expect(out.holds).toEqual(["two-fold (180°)"]);
    expect(out.verdict).toMatch(/^not kept: six-fold/);
    expect(api.fetchDpdfSlice).toHaveBeenCalledWith("demo.delta_pdf", "xy", 0);
  });
});

describe("texture_check", () => {
  // Fills 30 above a noisy diffuse at nine nodes: a lattice of bright plugs.
  const noise = (ix: number, iy: number) => (((ix * 7919 + iy * 104729) % 1000) / 500) - 1;
  const hole = (ix: number, iy: number) => ix > 2 && iy > 2 && ix < 18 && iy < 18 && [4, 0, 1].includes(ix % 5) && [4, 0, 1].includes(iy % 5);
  const slices: Record<string, ReturnType<typeof makeSlice>> = {
    "demo.ringremoved": makeSlice(21, 21, (_x, _y, ix, iy) => 100 + 4 * noise(ix, iy)),
    "demo.braggpunched": makeSlice(21, 21, (_x, _y, ix, iy) => (hole(ix, iy) ? NaN : 100 + 4 * noise(ix, iy))),
    "demo.backfilled": makeSlice(21, 21, (_x, _y, ix, iy) => 100 + 4 * noise(ix, iy) + (hole(ix, iy) ? 30 : 0)),
  };

  it("flags fills that sit above their rims on every plane", async () => {
    api.fetchSlice.mockImplementation(async (id: string) => slices[id]);
    const r = await runOn(full, "texture_check", {});
    const out = JSON.parse(r.text);
    expect(out.per_cut).toHaveLength(3);
    expect(out.per_cut[0]).toMatchObject({ cut: "H–K plane at L = 0", n_holes: 9, systematic_fill_bias: true, brighter_fraction: 1 });
    expect(r.summary).toMatch(/^systematic fill bias on 3 of 3 cut\(s\)/);
    expect(r.view?.label).toBe("H–K plane at L = 0");
  });

  it("needs the punched and backfilled outputs", async () => {
    expect((await run("texture_check", {})).text).toMatch(/needs the punched and backfilled outputs/);
  });
});

describe("radial_profile", () => {
  it("puts the stages' shell medians side by side", async () => {
    api.fetchSlice.mockImplementation(async (id: string) =>
      makeSlice(21, 21, (x, y) => (id === "demo.raw" ? 10 : 2) + Math.hypot(x, y), { half: 2 }),
    );
    const out = JSON.parse((await runOn(full, "radial_profile", { stages: ["raw", "flattened"], bins: 8 })).text);
    expect(out.q_unit).toBe("|Q| in Å⁻¹");
    expect(Object.keys(out.rows[0])).toEqual(["q", "raw", "flattened"]);
    expect(out.rows[0].raw - out.rows[0].flattened).toBeCloseTo(8, 5);
    expect(out.rows[out.rows.length - 1].q).toBeGreaterThan(out.rows[0].q);
  });
});

describe("the figure each step looked at", () => {
  it("is the cut a measurement was taken on", async () => {
    api.fetchSlice.mockResolvedValue(makeSlice(21, 21, () => 1, { half: 2 }));
    const r = await run("measure_reciprocal_cut", { plane: "h0l", value: 0.5 });
    expect(r.view).toEqual({ view: "cleanup", plane: "h0l", value: 0.5, label: "H–L plane at K = 0.5", axis: "K" });
  });

  it("is the plane a stage did worst on, or the back-FFT check for the ΔPDF", async () => {
    evaluate.evaluateStage.mockResolvedValue({
      mean_ring_energy_ratio: 0.5,
      per_plane: { hk0: { ring_energy_ratio: 0.4 }, h0l: { ring_energy_ratio: 0.7 }, "0kl": { ring_energy_ratio: 0.5 } },
    });
    expect((await runOn(full, "assess_stage", { stage: "rings" })).view).toMatchObject({ view: "cleanup", plane: "h0l", value: 0, axis: "K" });
    evaluate.evaluateStage.mockResolvedValue({ back_fft_pearson_r: 0.99, per_plane: {} });
    expect((await runOn(full, "assess_stage", { stage: "pdf" })).view).toEqual({ view: "consistency", label: "the back-FFT check" });
  });

  it("is the top peak on the Bragg page, the run log on the Execution page", async () => {
    api.fetchBraggProfile.mockResolvedValue({
      has_profile: true,
      n_peaks: 1,
      punch_frame: "spherical",
      peaks: [{ center_hkl: [2, 0, 0], q_abs: 1, intensity: 9, local_background: 1, significance: 20, fit_kind: "covariance" }],
    } as unknown as BraggProfile);
    expect((await run("bragg_peaks", {})).view).toEqual({ view: "bragg", hkl: [2, 0, 0], label: "the peak at (2, 0, 0)" });
    usePipelineStore.setState({ running: false, terminal: "done", events: [{ type: "progress", stage: "rings", status: "done", message: "ok" }] });
    expect((await run("run_log", {})).view).toEqual({ view: "execution", label: "the run log" });
  });
});

describe("openView", () => {
  it("selects a peak on the Bragg page and opens the back-FFT check and the run log", async () => {
    const { openView } = await import("../tools/openView");
    openView({ view: "bragg", hkl: [1, 1, 1], label: "the peak at (1, 1, 1)" });
    expect(useViewerStore.getState().peakFocus).toEqual([1, 1, 1]);
    expect(useNavStore.getState().tab).toBe("bragg");
    openView({ view: "consistency", label: "the back-FFT check" });
    expect(useNavStore.getState().tab).toBe("consistency");
    openView({ view: "execution", label: "the run log" });
    expect(useNavStore.getState().tab).toBe("execution");
  });
});
