// Known answers: each dev case's planted fault, found by the real tools and
// their rules on the case built where the tests run (devData), against the
// case's truth (the validation's manifest), and the dev control's planted
// correlations in dpdf_peaks' list. The tools, the verdict rules and the
// pipeline are the app's own; nothing is recorded.
//
// The tolerances are the validation's own where it has one, else the tools':
// - a turn of the UB within 0.15° of the planted one (the validation's grader,
//   evals/validation.ts, for the same angle);
// - an origin shift within half the smallest planted component of it, so the
//   direction and the size are both found;
// - the counts' edge, and full coverage, within one shell (0.1 Å⁻¹) of the
//   planted cut: the coverage measures them to one shell (qmax_coverage, from
//   nebula3d.analysis.coverage);
// - a ring or shell within 0.1 Å⁻¹ of the planted |Q|: the match radius of the
//   ring check (tune/evaluate.ts) and of arm A (nebula3d.validation.arm_a).
//
// A fault the tools miss is a finding about the tools, not a test to tune:
// MISSES names each, per grid, and the test is then expected to fail
// (it.fails), with the evidence printed beside it. When the tools improve, the
// expected failure passes, fails the run, and its entry goes.
//
// A check the grid is too coarse for gives no verdict: at the grids
// TOO_COARSE names it is held to "not judged", with the grid's reason.

import { describe, expect, it } from "vitest";

import { fetchDpdfFeatures, fetchMeta, fetchRingDiagnostics, fetchShellFloors, fetchSlice } from "../../../api/client";
import { usePipelineStore } from "../../../state/pipelineStore";
import type { AgentStep } from "../../agent";
import { dpdfVolumeId, hklVolumeId, stageVolumeId } from "../../context/loadContext";
import { qRadius } from "../../context/pipelineContext";
import { withoutInference } from "../../inference";
import { flattenJudging, flattenMetrics, volumePedestal } from "../../metrics/flatten";
import { SYMMETRY_HOLDS } from "../../metrics/symmetry";
import { fit } from "../../readings";
import { CHAT_TOOLS, MAX_RESULT_CHARS } from "../../tools";
import { verdicts } from "../../verdicts";
import { casesIn, type ValidationCase } from "../validation";
import { bridgeConfig } from "./bridgeWorker";
import { DEV_CASE_IDS, devCase, type DevCase, type DevCaseId, type ToolRunResult } from "./index";

const { n } = bridgeConfig();

const ANGLE_DEG = 0.15;
const COUNTS_SHELL = 0.1;
const SAME_Q = 0.1;

// The planted correlations by dpdf_peaks' entries: an entry of the correlation's
// sign whose vectors hold an image of its vector under the cube's 48 operations
// (the planted correlations keep all of them, docs/algorithms/delta_pdf.md),
// within 0.15 lattice units: about one voxel of the ΔPDF at either grid (0.124
// of a cell), where the vectors of the crystal's other correlations lie half a
// lattice unit or more away.
const SAME_VECTOR = 0.15;

/**
 * The faults the tools miss, by case and check, with what they found instead:
 * each grid's own (81: the default; 161: the nightly run's). The misses at 81
 * (a false ring at 1.75 Å⁻¹, the shell at 2.9 Å⁻¹ never seen, and fill biases
 * on three cases' cuts) were the ring and texture checks judging a grid too
 * coarse for them, which they now say (TOO_COARSE).
 *
 * One now: the dev control's weaker planted correlation, ⟨½ 1 1⟩−, lies past
 * dpdf_peaks' default limit of 12 entries at both grids. The dev cases declare
 * no symmetry, so the list is grouped by sign, length and size, as before the
 * grouping by the declared symmetry (plan 4.4). The default is still to be
 * decided: the list the executor hands the model is cut at MAX_RESULT_CHARS,
 * about 20 of these entries, and a longer list costs the worst turn tokens
 * (tokenBudget.test.ts).
 */
const MISSES: Partial<Record<DevCaseId, Record<string, Partial<Record<number, string>>>>> = {
  "dev-control": {
    "dpdf_peaks, as the model reads it, lists each planted correlation": {
      81: "⟨½ 1 1⟩− is entry 28 and ⟨3/2 0 0⟩+ entry 10, of a default 12",
      161: "⟨½ 1 1⟩− is entry 19 and ⟨3/2 0 0⟩+ entry 7, of a default 12",
    },
  },
};

/**
 * The checks the grid is too coarse for, by grid: there each says "not
 * judged", with the grid's reason ("grid too coarse: …"), and gives no
 * verdict. The minimums are the checks' own (nebula3d.preprocessing.
 * ring_isotropy, Resolution; metrics/texture.ts, roomForRims, which the
 * fills' 3-D read applies to the volume's holes): on 81 points the dev crystal
 * (a = 3.9 Å, ±4 r.l.u.) puts 0.99 voxels across the widest ring the ring
 * check judges, under one, and its holes, reaching 2 to 3 voxels in 3-D, with
 * their rims need the nodes 12 to 14 voxels apart, where they are 10. On 161
 * points neither check is too coarse, and the known answers hold.
 */
type GridLimited = "rings" | "texture";
const TOO_COARSE: Record<GridLimited, readonly number[]> = { rings: [81], texture: [81] };
const tooCoarse = (which: GridLimited): boolean => TOO_COARSE[which].includes(n);

/** The case's check: expected to pass, or, where MISSES names it at this grid, to fail. */
function check(id: DevCaseId, name: string, body: () => Promise<void>): void {
  const miss = MISSES[id]?.[name]?.[n];
  if (miss) it.fails(`${name} [a known miss: ${miss}]`, body);
  else it(name, body);
}

/** A check's name, and at a grid too coarse for it what the test then holds it to. */
const named = (which: GridLimited, name: string): string => (tooCoarse(which) ? `${name} [at n=${n}: not judged, the grid too coarse]` : name);

/** What the tools found, beside the truth: printed, and the assertions' message. */
function evidence(c: DevCase, found: Record<string, unknown>): string {
  const line = `${c.id} at n=${n}: found ${JSON.stringify(found)}; truth ${JSON.stringify(c.truth)}`;
  console.log(line);
  return line;
}

const ran = (r: ToolRunResult, name: string): ToolRunResult => {
  expect(r.ok, `${name}: ${r.summary}`).toBe(true);
  return r;
};

const outcomeOf = (r: ToolRunResult) => r.outcomes.map((o) => ({ check: o.check, kind: o.kind, reasons: o.reasons, dataProblems: o.dataProblems }));

interface Shell {
  at: number;
  ring: boolean;
  isotropy?: number;
  not_judged?: string;
}

/** The ring check on a grid too coarse for it: not judged, the grid's reason given, no shell judged. */
function expectRingsNotJudged(c: DevCase, r: ToolRunResult): void {
  const rings = r.result.rings as Record<string, unknown>;
  const [outcome] = outcomeOf(r);
  const msg = evidence(c, { verdict: rings.verdict, ring_rule: rings.ring_rule, shells_judged: rings.shells_judged, outcome });
  expect(rings.verdict, msg).toBe("not judged");
  const why = /^not judged: grid too coarse: ([\d.]+) voxels across a ring's width \(at most [\d.]+ Å⁻¹\), under ([\d.]+)$/.exec(String(rings.ring_rule));
  expect(why, msg).not.toBeNull();
  expect(Number(why![1]), msg).toBeLessThan(Number(why![2]));
  expect([rings.max_ring_left, rings.max_ring_dent, rings.shells_judged], msg).toEqual([null, null, undefined]);
  expect(outcome, msg).toMatchObject({ kind: "info", reasons: ["grid too coarse"] });
}

/** A known answer of the ring check, read from the shells it judged; on a grid too coarse for it, "not judged" with the reason instead. */
function ringCheck(id: DevCaseId, name: string, known: (c: DevCase, shells: Shell[], rings: Record<string, unknown>) => void): void {
  check(id, named("rings", name), async () => {
    const c = devCase(id);
    const r = ran(await c.tool("assess_stage", { stage: "rings" }), "assess_stage rings");
    if (tooCoarse("rings")) return expectRingsNotJudged(c, r);
    const rings = r.result.rings as Record<string, unknown>;
    known(c, (rings.shells_judged as Shell[] | undefined) ?? [], rings);
  });
}

const near = (q: number) => (s: Shell) => Math.abs(s.at - q) <= SAME_Q;

describe("dev-control: nothing flagged", () => {
  check("dev-control", "no check needs attention, and the data show no problem", async () => {
    const c = devCase("dev-control");
    const results: Record<string, ToolRunResult> = {};
    for (const [name, args] of [
      ["assess_stage", { stage: "all" }],
      ["ub_check", {}],
      ["qmax_coverage", {}],
      ["texture_check", {}],
      ["grain_check", {}],
      ["symmetry_check", {}],
    ] as const) {
      results[name] = ran(await c.tool(name, args), name);
    }
    const outcomes = Object.values(results).flatMap(outcomeOf);
    const flagged = outcomes.filter((o) => o.kind === "attention");
    const problems = outcomes.flatMap((o) => o.dataProblems);
    const msg = evidence(c, { flagged, problems, kinds: outcomes.map((o) => `${o.check}: ${o.kind}`) });
    expect(flagged, msg).toEqual([]);
    expect(problems, msg).toEqual([]);
  });

  // The verdict on the run, {{achieved}}, from the checks a reply ran: met, or
  // on a grid too coarse for the ring check not judged, saying why (G1), and
  // likewise on one too coarse for the fills' texture (plan 4.2).
  check("dev-control", named("rings", "the verdict on the run is met, or says why the ring removal and the fills' texture are not judged"), async () => {
    const c = devCase("dev-control");
    const steps: AgentStep[] = [];
    for (const [name, args] of [
      ["assess_stage", { stage: "all" }],
      ["qmax_coverage", {}],
      ["texture_check", {}],
      ["symmetry_check", {}],
    ] as const) {
      const r = ran(await c.tool(name, args), name);
      steps.push({ id: name, name, args, status: "done", result: JSON.stringify(r.result), outcomes: r.outcomes });
    }
    const v = verdicts({ reply: steps }).achieved;
    const msg = evidence(c, { achieved: v });
    const notJudged = [
      ...(tooCoarse("rings") ? ["the ring removal (grid too coarse for the ring check)"] : []),
      ...(tooCoarse("texture") ? ["the backfill's texture (grid too coarse)"] : []),
    ];
    expect(v?.text, msg).toBe(notJudged.length ? `not judged: ${notJudged.join(", ")}` : "met: every stage meets its goal");
  });

  // The coverage, measured once, in Python, on 3D |Q| shells: the control's
  // counts fill the box to its corners, so full coverage reaches past the box
  // faces, where the window tapers, and no edge of the counts is inside it.
  check("dev-control", "qmax_coverage finds the counts filling the box, past the faces the window reaches", async () => {
    const c = devCase("dev-control");
    const cov = ran(await c.tool("qmax_coverage"), "qmax_coverage");
    const [outcome] = outcomeOf(cov);
    const r = cov.result;
    const msg = evidence(c, { full_coverage_q: r.full_coverage_q, box_face_q: r.box_face_q, transform_reach_q: r.transform_reach_q, raw_counts: r.raw_counts, outcome });
    expect(r.full_coverage_q as number, msg).toBeGreaterThan(r.box_face_q as number);
    expect(r.transform_reach_q as number, msg).toBeLessThanOrEqual(r.full_coverage_q as number);
    expect([r.counts_end_inside_box, (r.raw_counts as { q_max_edge: number | null }).q_max_edge], msg).toEqual([false, null]);
    expect(outcome, msg).toMatchObject({ kind: "pass", dataProblems: [] });
  });
});

type Planted = ValidationCase["planted"][number];
interface PeakEntry {
  size_sigma: number; // signed (THY-63 R1)
  vectors_rlu: (number[] | null)[];
}

/** A vector's images under the cube's 48 operations: every signed permutation of its components. */
const cubeImages = (v: number[]): number[][] =>
  [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]].flatMap((p) =>
    [1, -1].flatMap((a) => [1, -1].flatMap((b) => [1, -1].map((c) => [a * v[p[0]], b * v[p[1]], c * v[p[2]]]))),
  );

/** Whether an entry of dpdf_peaks is the planted correlation: its sign, and an image of its vector among the entry's. */
const listsCorrelation = (e: PeakEntry, p: Planted): boolean =>
  Math.sign(e.size_sigma) === (p.sign === "+" ? 1 : -1) &&
  e.vectors_rlu.some((u) => u !== null && cubeImages(p.vector).some((w) => Math.hypot(u[0] - w[0], u[1] - w[1], u[2] - w[2]) <= SAME_VECTOR));

/** The entry (1-based) each planted correlation first comes in, 0 where none is it. */
const entriesOf = (list: PeakEntry[], planted: Planted[]): number[] => planted.map((p) => list.findIndex((e) => listsCorrelation(e, p)) + 1);

describe("dev-control: dpdf_peaks lists the planted correlations", () => {
  // What the model reads of dpdf_peaks with its defaults: the result fitted
  // to MAX_RESULT_CHARS, as the executor hands it over (runToolCall).
  check("dev-control", "dpdf_peaks, as the model reads it, lists each planted correlation", async () => {
    const c = devCase("dev-control");
    const planted = casesIn("dev").find((x) => x.id === c.id)!.planted;
    const r = ran(await c.tool("dpdf_peaks"), "dpdf_peaks");
    const max = CHAT_TOOLS.find((t) => t.name === "dpdf_peaks")!.maxResultChars ?? MAX_RESULT_CHARS;
    const read = (JSON.parse(fit(r.result, max).text) as { features: PeakEntry[] }).features;
    // Where they come among the 30 strongest entries, the tool's longest list.
    const longest = ran(await c.tool("dpdf_peaks", { limit: 30 }), "dpdf_peaks").result.features as PeakEntry[];
    const msg = evidence(c, { planted, entries_read: read.length, read_at: entriesOf(read, planted), among_30_at: entriesOf(longest, planted) });
    expect(planted.length, msg).toBeGreaterThan(0);
    expect(entriesOf(read, planted), msg).not.toContain(0);
  });

  // The dev cases declare no symmetry: the list says so, and is grouped as
  // before the grouping by the declared symmetry, each entry as it was.
  check("dev-control", "dpdf_peaks says no symmetry is declared, and groups by sign, length and size as before", async () => {
    const c = devCase("dev-control");
    const r = ran(await c.tool("dpdf_peaks"), "dpdf_peaks");
    const entries = r.result.features as Record<string, unknown>[];
    // The server's list, as the tool reads it: no orbit, each size within 5 % of its group's largest.
    const served = await fetchDpdfFeatures(dpdfVolumeId(await c.dataset())!, 5, 12);
    const msg = evidence(c, {
      grouped_by: r.result.grouped_by,
      fields: [...new Set(entries.map((e) => Object.keys(e).join(", ")))],
      served: served.groups.map((g) => ({ n: g.n, multiplicity: g.multiplicity, size_sigma: g.size_sigma, mean_size_sigma: g.mean_size_sigma })),
    });
    expect(r.result.grouped_by, msg).toBe("sign, length and size (no symmetry declared)");
    expect(served.grouped_by, msg).toBe(r.result.grouped_by);
    for (const g of served.groups) {
      expect(g.multiplicity, msg).toBeNull();
      expect(g.mean_size_sigma, msg).toBeLessThanOrEqual(g.size_sigma);
      expect(g.mean_size_sigma, msg).toBeGreaterThanOrEqual(0.95 * g.size_sigma);
    }
    expect(entries.map((e) => e.n_vectors), msg).toEqual(served.groups.map((g) => g.n));
    for (const e of entries) expect(Object.keys(e), msg).toEqual(["length_A", "size_sigma", "n_vectors", "vectors_rlu", "vectors_A"]);
  });
});

// No dev case is symmetrised, so the symmetry check judges none of them: each
// reads "not judged", the file declaring no symmetry. dev-control symmetrised
// over m-3m and declared so (devCase's symmetrise, as the NeXus Viewer's export
// is) is one it judges: through the default run, each of m-3m's 47 operations
// holds (24 entries: each rotation with its product with the inversion, and
// the inversion), those that move c included, on the sections through the
// origin and on the x–y sections off it, and the ΔPDF evaluation's own break
// with them (plan 4.3).
describe("dev-control symmetrised over m-3m: every declared operation holds", () => {
  check("dev-control", "symmetry_check reads each of m-3m's 47 operations as held, at z = 0 and at z = 1 Å", async () => {
    const c = devCase("dev-control", { symmetrise: "m-3m" });
    for (const z of [0, 1]) {
      const r = ran(await c.tool("symmetry_check", { z }), "symmetry_check");
      const ops = r.result.ops as { op: string; rms_difference: number; tested_on: string }[];
      const worst = ops.reduce((w, o) => (o.rms_difference > w.rms_difference ? o : w));
      const [outcome] = outcomeOf(r);
      const msg = evidence(c, { z, operations: r.result.operations, sections: r.result.sections, worst, not_tested: r.result.not_tested ?? [], outcome });
      expect(r.result.operations, msg).toBe("declared (m-3m): 47 besides the identity");
      expect(ops, msg).toHaveLength(24);
      // The three-folds, which move c, on the x–z and y–z sections they map.
      const threeFolds = ops.filter((o) => o.op.startsWith("three-fold"));
      expect(threeFolds, msg).toHaveLength(8);
      expect(threeFolds.every((o) => o.tested_on.includes("xz")), msg).toBe(true);
      expect(r.result.not_tested, msg).toBeUndefined();
      expect(worst.rms_difference, msg).toBeLessThanOrEqual(SYMMETRY_HOLDS);
      expect(outcome, msg).toMatchObject({ kind: "pass", reasons: [] });
    }
    const pdf = ran(await c.tool("assess_stage", { stage: "pdf" }), "assess_stage pdf").result.pdf as Record<string, unknown>;
    const msg = evidence(c, { max_symmetry_break: pdf.max_symmetry_break, worst_symmetry_op: pdf.worst_symmetry_op, symmetry_declared: pdf.symmetry_declared });
    expect(pdf.symmetry_declared, msg).toBe(true);
    expect(pdf.max_symmetry_break as number, msg).toBeLessThanOrEqual(SYMMETRY_HOLDS);
  });
});

describe("dev-ub: the turn is found", () => {
  check("dev-ub", "ub_check turns the UB by the planted angle, and judges it turned", async () => {
    const c = devCase("dev-ub");
    const ub = ran(await c.tool("ub_check"), "ub_check");
    const angle = ub.result.orientation_change_deg as number;
    const [outcome] = outcomeOf(ub);
    const msg = evidence(c, { orientation_change_deg: angle, axis_uvw: ub.result.axis_uvw, rms_start: ub.result.rms_start, rms: ub.result.rms, outcome });
    expect(Math.abs(angle - c.truth.angle_deg!), msg).toBeLessThanOrEqual(ANGLE_DEG);
    expect(outcome.reasons, msg).toContain("UB turned");
    expect(outcome.dataProblems, msg).toContain(`the UB is turned by ${angle}°`);
  });
});

describe("dev-origin: the shift is found", () => {
  check("dev-origin", "ub_check finds the HKL origin shifted by the planted vector", async () => {
    const c = devCase("dev-origin");
    const ub = ran(await c.tool("ub_check"), "ub_check");
    const shift = ub.result.origin_shift_rlu as number[] | null;
    const [outcome] = outcomeOf(ub);
    const planted = c.truth.offset_rlu!;
    const tol = Math.min(...planted.filter((x) => x !== 0).map(Math.abs)) / 2;
    const msg = evidence(c, { origin_shift_rlu: shift, mean_offset_rlu: ub.result.mean_offset_rlu, rms_start: ub.result.rms_start, rms: ub.result.rms, tolerance: tol, outcome });
    expect(shift, msg).not.toBeNull();
    shift!.forEach((x, i) => expect(Math.abs(x - planted[i]), msg).toBeLessThanOrEqual(tol));
    expect(outcome.dataProblems, msg).toContain(`the HKL origin is shifted by (${shift!.join(", ")}) r.l.u.`);
  });
});

describe("dev-coverage: the counts end inside the box", () => {
  check("dev-coverage", "qmax_coverage puts the counts' edge within a shell of the planted cut", async () => {
    const c = devCase("dev-coverage");
    const cov = ran(await c.tool("qmax_coverage"), "qmax_coverage");
    const counts = cov.result.raw_counts as { q_max_edge: number | null; box_face_q: number };
    const [outcome] = outcomeOf(cov);
    const msg = evidence(c, { counts_end_inside_box: cov.result.counts_end_inside_box, raw_counts: counts, suggested_band: cov.result.suggested_band, outcome });
    expect(cov.result.counts_end_inside_box, msg).toBe(true);
    expect(Math.abs(counts.q_max_edge! - c.truth.q_cut!), msg).toBeLessThanOrEqual(COUNTS_SHELL);
    expect(outcome.dataProblems, msg).toContain(`the counts end at ${counts.q_max_edge} Å⁻¹, inside the box`);
  });

  // Measured once: full coverage is where the counts stop filling the shells,
  // the number raw_counts gives too, within a shell of the planted cut.
  check("dev-coverage", "qmax_coverage puts full coverage within a shell of the planted cut, the counts' own", async () => {
    const c = devCase("dev-coverage");
    const cov = ran(await c.tool("qmax_coverage"), "qmax_coverage");
    const full = cov.result.full_coverage_q as number;
    const fully = (cov.result.raw_counts as { fully_measured: [number, number] | null }).fully_measured;
    const msg = evidence(c, { full_coverage_q: full, fully_measured: fully, box_face_q: cov.result.box_face_q, transform_reach_q: cov.result.transform_reach_q });
    expect(full, msg).toBe(fully?.[1]);
    expect(Math.abs(full - c.truth.q_cut!), msg).toBeLessThanOrEqual(COUNTS_SHELL);
    expect(full, msg).toBeLessThan(cov.result.box_face_q as number);
  });

  // Plan 4.5: the default run fits the window to the coverage (the support on,
  // an auto window), so the weight it records on unmeasured space is the
  // backend's own target: the verdict says so, and judges where the counts end
  // and a band the user sets (on the Configure page; the model sets none).
  check("dev-coverage", "qmax_coverage says the fitted window's weight is the backend's target, and judges the counts' edge", async () => {
    const c = devCase("dev-coverage");
    const cov = ran(await c.tool("qmax_coverage"), "qmax_coverage");
    const [outcome] = outcomeOf(cov);
    const msg = evidence(c, { verdict: cov.result.verdict, window_weight_on_unmeasured: cov.result.window_weight_on_unmeasured, window_scale: cov.result.window_scale, outcome });
    expect(cov.result.window_weight_on_unmeasured as number, msg).toBeLessThanOrEqual(1e-3);
    expect(outcome, msg).toMatchObject({ kind: "pass", reasons: ["window fitted", "window within limit"] });
    expect(outcome.dataProblems, msg).toEqual([`the counts end at ${(cov.result.raw_counts as { q_max_edge: number }).q_max_edge} Å⁻¹, inside the box`]);
    expect(String(cov.result.verdict), msg).toMatch(/^fitted to the coverage: .*: its own target, not a check; the raw counts end at [\d.]+ Å⁻¹, inside the box/);
  });

  check("dev-coverage", "a band set inside the counts passes; past their upper edge it needs attention, the transform rerun with it", async () => {
    const c = devCase("dev-coverage");
    const before = ran(await c.tool("qmax_coverage"), "qmax_coverage");
    const [lo, hi] = before.result.suggested_band as [number, number];
    const banded = async (qMax: number) => {
      usePipelineStore.setState({ pdfQMin: String(lo), pdfQMax: String(qMax) });
      ran(await c.tool("run_pipeline", { from_stage: "pdf" }), "run_pipeline");
      const r = ran(await c.tool("qmax_coverage"), "qmax_coverage");
      return { band: [lo, qMax], band_check: r.result.band_check, weight: r.result.window_weight_on_unmeasured, outcome: outcomeOf(r)[0] };
    };
    const inside = await banded(hi);
    const past = await banded(hi + 1);
    const msg = evidence(c, { suggested_band: [lo, hi], inside, past });
    expect(inside.outcome, msg).toMatchObject({ kind: "pass", reasons: ["window fitted", "window within limit"] });
    expect(inside.band_check, msg).toBe(`the band ${lo}–${hi} Å⁻¹ stays inside the counts`);
    expect(past.outcome, msg).toMatchObject({ kind: "attention", reasons: ["band past counts", "window within limit"] });
    expect(String(past.band_check), msg).toMatch(/^Qmax past the counts' upper edge/);
  });
});

// The rings and the crystal's own shell: the ring check (assess_stage rings)
// judges each bump the principal planes show in 3D on the raw volume, a
// powder ring only if it rises in nearly every direction (shells_judged).
for (const id of ["dev-rings", "dev-rings-shell"] as const) {
  describe(`${id}: the powder rings are found`, () => {
    ringCheck(id, "every planted ring judged a powder ring", (c, shells, rings) => {
      const msg = evidence(c, { shells_judged: shells, verdict: rings.verdict });
      for (const q of c.truth.ring_q!) expect(shells.some((s) => s.ring && near(q)(s)), `${msg} (no ring at ${q})`).toBe(true);
    });

    ringCheck(id, "no ring where none was planted", (c, shells) => {
      const extra = shells.filter((s) => s.ring && !c.truth.ring_q!.some((q) => near(q)(s)));
      const msg = evidence(c, { shells_judged: shells, rings_not_planted: extra });
      expect(extra, msg).toEqual([]);
    });
  });
}

// The ring removal's notice (G1): on a grid too coarse to confirm a ring, the
// removal subtracts none of the ring candidates it detected (powder rings or
// the crystal's own scattering) and says so out loud, with how many, what the
// grid needs and the two ways out, in its run log line, its record (the
// diagnostics) and the ring check's result; arm C reads it without the remedy.
// On a grid fine enough it leaves no ring unconfirmed, and says nothing of the
// kind. The planted rings are among those it detected. Its words, for more
// than one candidate (the count in group 1) and for one (group 2):
const NEEDS_AND_WAYS = String.raw` detected but not confirmed at this grid \(needs ≥ 1 voxel across 0\.16 Å⁻¹\); not subtracted\. Use a finer grid, or, from the Python API, set pooled_confirm_rings=False to subtract`;
const NOTICE = new RegExp(
  String.raw`^(?:(\d+) ring candidates \(shells that may be powder rings or the crystal's own scattering\)${NEEDS_AND_WAYS} every candidate, the crystal's own shells included\.` +
    String.raw`|(1) ring candidate \(a shell that may be a powder ring or the crystal's own scattering\)${NEEDS_AND_WAYS} it, even if it is the crystal's own shell\.)$`,
);

for (const id of ["dev-rings", "dev-rings-shell"] as const) {
  describe(`${id}: the rings the removal could not confirm, said out loud`, () => {
    const name = tooCoarse("rings")
      ? `the ring removal says how many rings it left unconfirmed at n=${n}, the planted ones among them, in its log, its record and the ring check`
      : `the ring removal leaves no ring unconfirmed at n=${n}, and says nothing of the kind`;
    check(id, name, async () => {
      const c = devCase(id);
      const log = ran(await c.tool("run_log", { stage: "rings" }), "run_log");
      const done = (log.result.lines as { status: string; message: string }[]).filter((l) => l.status === "done").pop()?.message ?? "";
      const rings = ran(await c.tool("assess_stage", { stage: "rings" }), "assess_stage rings").result.rings as Record<string, unknown>;
      const left = (await fetchRingDiagnostics((await c.dataset()).id)).unconfirmed_at_grid;
      const msg = evidence(c, { ring_log: done, notice: rings.notice ?? null, unconfirmed_at_grid: left });
      if (!tooCoarse("rings")) {
        expect(done, msg).toMatch(/^pooled ring removal /);
        expect(done, msg).not.toContain("⚠");
        expect(rings, msg).not.toHaveProperty("notice");
        expect(left, msg).toBeNull();
        return;
      }
      const notice = done.split(". ⚠ ")[1] ?? "";
      const said = NOTICE.exec(notice);
      expect(said, msg).not.toBeNull();
      const count = Number(said![1] ?? said![2]);
      if (said![1] !== undefined) expect(count, msg).toBeGreaterThan(1); // "1 ring candidate" is said in the singular
      expect(rings.notice, msg).toBe(notice);
      expect(left, msg).toMatchObject({ count, needs: "1 voxel across 0.16 Å⁻¹", notice });
      expect(left!.q_centers.length, msg).toBe(left!.count);
      for (const q of c.truth.ring_q!) expect(left!.q_centers.some((x) => Math.abs(x - q) <= SAME_Q), `${msg} (no ${q} among them)`).toBe(true);
      // Arm C reads the notice without its remedy, in the ring check's result and the run log.
      const definition = notice.slice(0, notice.indexOf(" Use a finer grid"));
      expect((withoutInference(rings) as Record<string, unknown>).notice, msg).toBe(definition);
      expect(withoutInference(done), msg).toBe(done.replace(notice, definition));
    });
  });
}

for (const id of ["dev-shell", "dev-rings-shell"] as const) {
  describe(`${id}: the crystal's shell is its own`, () => {
    ringCheck(id, "the shell never judged a powder ring", (c, shells) => {
      const msg = evidence(c, { shells_judged: shells });
      expect(shells.filter((s) => s.ring && near(c.truth.shell_q!)(s)), msg).toEqual([]);
    });

    ringCheck(id, "the shell seen, as the crystal's own", (c, shells) => {
      const msg = evidence(c, { shells_judged: shells });
      expect(shells.some((s) => !s.ring && near(c.truth.shell_q!)(s)), msg).toBe(true);
    });
  });
}

// The fills' texture (texture_check): the default backfill prints no fill bias
// of its own over the punch's holes, every one judged in 3-D with its rim
// (plan 4.2). On a grid too coarse to leave the holes room for their rims the
// check is not judged, says why, and measures no bias. At 81 points, before
// that rule (#60), the cuts read a false bias on three of these cases
// (dev-origin, dev-rings, dev-shell), and the 3-D read, past it, would read
// one on six: the rule, not the 3-D read, keeps them from a verdict.
for (const id of DEV_CASE_IDS) {
  describe(`${id}: the fills leave no texture`, () => {
    check(id, named("texture", "texture_check finds no systematic fill bias over the holes in 3-D"), async () => {
      const c = devCase(id);
      const r = ran(await c.tool("texture_check"), "texture_check");
      const fills = r.result;
      const [outcome] = outcomeOf(r);
      const { per_cut: cuts, ...shown } = fills;
      const msg = evidence(c, { fills: shown, per_cut: cuts, outcome });
      expect(fills.systematic_fill_bias, msg).not.toBe(true);
      // The cuts carry the azimuthal texture only.
      for (const x of cuts as Record<string, unknown>[]) expect(Object.keys(x), msg).toEqual(["cut", "azimuthal_ratio"]);
      if (tooCoarse("texture")) {
        expect(outcome, msg).toMatchObject({ kind: "info", reasons: ["grid too coarse"] });
        // Either reason the backend gives for a grid too coarse: the punch's
        // node test could not resolve the holes (G3, read from the punch's
        // record), or the median hole leaves its rim no room.
        if (fills.not_judged !== "grid too coarse (the punch's node test could not resolve the holes at this grid)") {
          const why = /^grid too coarse: the nodes are ([\d.]+) voxels apart, under ([\d.]+): a hole reaches [\d.]+ voxels? and its rim \d+ more$/.exec(String(fills.not_judged));
          expect(why, msg).not.toBeNull();
          expect(Number(why![1]), msg).toBeLessThan(Number(why![2]));
        }
        expect([fills.systematic_fill_bias, fills.median_fill_bias_sigma, fills.median_fill_bias_level], msg).toEqual([null, null, null]);
      } else {
        expect(outcome, msg).toMatchObject({ kind: "pass", reasons: [] });
        expect(fills, msg).not.toHaveProperty("not_judged");
        expect(fills.systematic_fill_bias, msg).toBe(false);
        expect(fills.n_judged, msg).toBeGreaterThan(0);
      }
    });
  });
}

// The flatten judged over the run's own range (plan 4.11): what made the file
// on disk, its recorded settings, and not the Configure page's, which may have
// changed since the run.
describe("dev-control: the flatten judged over the range its run recorded", () => {
  check("dev-control", "a run fitted to 5 Å⁻¹ is judged over its range after the page goes back to the default", async () => {
    const c = devCase("dev-control");
    ran(await c.tool("update_settings", { changes: { flattenFitQMax: 5 } }), "update_settings");
    ran(await c.tool("run_pipeline", { from_stage: "flatten" }), "run_pipeline");
    usePipelineStore.setState({ flattenFitQMax: "" }); // the page's default again, no run
    const ds = await c.dataset();
    const [rawId, filledId, flatId] = [hklVolumeId(ds)!, stageVolumeId(ds, "backfilled")!, stageVolumeId(ds, "flattened")!];
    const recorded = (await fetchMeta(flatId)).flatten_settings;
    const per = ((ran(await c.tool("assess_stage", { stage: "flatten" }), "assess_stage flatten").result.flatten as Record<string, unknown>).per_plane ?? {}) as Record<string, unknown>;
    const meta = await fetchMeta(rawId);
    const msg = evidence(c, { recorded, per_plane: per });
    expect(recorded?.fit_q_range, msg).toEqual([0.8, 5]);
    expect(Object.keys(per), msg).toEqual(["hk0", "h0l", "0kl"]);
    // Each plane's numbers are its cut's over the run's range, which the
    // page's would not give: the planes reach 9 Å⁻¹, past the run's 5.
    for (const plane of Object.keys(per)) {
      const [before, after] = await Promise.all([fetchSlice(filledId, plane, 0), fetchSlice(flatId, plane, 0)]);
      const radius = qRadius(plane, 0, meta);
      expect(per[plane], `${msg} (${plane})`).toEqual(flattenMetrics(before, after, radius, [0.8, 5], 25));
      expect(per[plane], `${msg} (${plane})`).not.toEqual(flattenMetrics(before, after, radius, [0.8, 10], 25));
    }
  });
});

describe("dev-flatten: the pedestal is found, and the Q² term takes it out", () => {
  // Judged over the whole volume's shell floors (plan 4.1), as the server
  // measures them on the run's own shells, from its fit range (plan 4.11).
  check("dev-flatten", "a pedestal, then none with the Q² term on and the flatten rerun", async () => {
    const c = devCase("dev-flatten");
    const flatten = async () => {
      const r = ran(await c.tool("assess_stage", { stage: "flatten" }), "assess_stage flatten");
      const f = r.result.flatten as Record<string, unknown>;
      const floors = await fetchShellFloors(stageVolumeId(await c.dataset(), "flattened")!);
      const volume = volumePedestal(floors, flattenJudging(floors.flatten).fitQ);
      return { pedestal_left: f.pedestal_left, trend: f.floor_trend, span: f.floor_span_fraction, judged: f.floor_judged_q, verdict: f.verdict, outcome: outcomeOf(r)[0], volume };
    };
    const before = await flatten();
    ran(await c.tool("update_settings", { changes: { flattenQ2: true } }), "update_settings");
    const rerun = ran(await c.tool("run_pipeline", { from_stage: "flatten" }), "run_pipeline");
    const after = await flatten();
    const msg = evidence(c, { before, rerun: rerun.result.stages, after });
    for (const x of [before, after]) expect([x.trend, x.span, x.judged], msg).toEqual([x.volume.floor_trend, x.volume.floor_span_fraction, x.volume.floor_judged_q]);
    expect(before.pedestal_left, msg).toBe(true);
    expect(before.outcome.reasons, msg).toEqual(["pedestal"]);
    expect(rerun.result.stages, msg).toMatchObject({ flatten: "computed" });
    expect(after.pedestal_left, msg).toBe(false);
    expect(after.outcome.kind, msg).toBe("pass");
  });
});
