// THY-18's parts one by one: which results are still evidence after a rerun
// (evidence.ts), numbers by reference (references.ts) and the verdict on the
// run computed from the checks (verdicts/, and the line under a reply, verdict.ts).

import { describe, expect, it } from "vitest";

import type { AgentStep } from "../agent";
import { overallContradiction, evidenceGaps } from "../answerChecks";
import { recomputedAt } from "../evidence";
import { fillReferences, resolveReference } from "../references";
import { verdictLine } from "../verdict";
import { verdicts } from "../verdicts";

const computedVerdict = (steps: readonly AgentStep[]) => verdicts({ reply: steps }).achieved;

let n = 0;
const step = (name: string, result: unknown, args: Record<string, unknown> = {}, status: AgentStep["status"] = "done"): AgentStep => ({
  id: String(n++),
  name,
  args,
  status,
  result: JSON.stringify(result),
});

const PASS = "meets its goal";
const ATTENTION = "needs attention";
type StageName = "rings" | "punch" | "backfill" | "flatten" | "pdf";
// Numbers each stage's rule gives the label: a stage is judged from its numbers, not its label (D18).
const NUMBERS: Record<string, Record<StageName, Record<string, unknown>>> = {
  [PASS]: {
    rings: { max_ring_left: 0, max_ring_dent: 0 },
    punch: { leftover_at_nodes: 0 },
    backfill: { mean_median_seam_sigma: 0.5 },
    flatten: { max_floor_trend: 0.31, max_floor_span_fraction: 0.6 },
    pdf: { back_fft_pearson_r_even: 1 },
  },
  [ATTENTION]: {
    rings: { max_ring_left: 0.14, max_ring_dent: 0 },
    punch: { leftover_at_nodes: 2 },
    backfill: { mean_median_seam_sigma: 1.5 },
    flatten: { max_floor_trend: 0.97, max_floor_span_fraction: 0.97 },
    pdf: { back_fft_pearson_r_even: 0.97 },
  },
};
/** A stage's result as assess_stage writes it: its label, and numbers that give it. */
const stage = (name: StageName, verdict: string, extra: Record<string, unknown> = {}) => ({ verdict, ...NUMBERS[verdict][name], ...extra });
const all = (over: Record<string, unknown> = {}) =>
  step("assess_stage", { rings: stage("rings", PASS), punch: stage("punch", PASS), backfill: stage("backfill", PASS), flatten: stage("flatten", PASS), pdf: stage("pdf", PASS), ...over }, { stage: "all" });
const rerun = (stages: Record<string, string>) => step("run_pipeline", { ended: "done", stages }, { from_stage: "flatten" });

describe("evidence after a rerun", () => {
  it("dates each stage by the last run that computed it, not one that reused it", () => {
    const steps = [all(), rerun({ rings: "reused", punch: "reused", backfill: "reused", flatten: "computed", pdf: "computed" })];
    expect(recomputedAt(steps)).toEqual({ rings: -1, punch: -1, backfill: -1, flatten: 1, pdf: 1 });
    // A failed run changes nothing; one whose result says nothing changed everything.
    expect(recomputedAt([step("run_pipeline", "x", {}, "error")]).flatten).toBe(-1);
    expect(recomputedAt([step("run_pipeline", { ended: "done" })]).rings).toBe(0);
  });

  it("keeps a verdict on a stage the rerun reused, and calls one on a stage it recomputed stale", () => {
    const steps = [all(), rerun({ rings: "reused", punch: "reused", backfill: "reused", flatten: "computed", pdf: "computed" })];
    const gaps = evidenceGaps("The ring removal is clean. The flatten now meets its goal.", steps);
    expect(gaps.missing).toEqual([]);
    expect(gaps.stale.map((t) => t.id)).toEqual(["flatten"]);
    // The UB is read from the raw volume, which no run changes.
    const ub = [step("ub_check", { orientation_change_deg: 0, fit: "both" }), rerun({ rings: "computed" })];
    expect(evidenceGaps("The UB is right.", ub)).toEqual({ missing: [], stale: [] });
  });

  it("needs assess_stage for a ring verdict, ub_check for the origin, and a measurement for the ΔPDF's correlations", () => {
    const profile = [step("radial_profile", { rows: [] })];
    expect(evidenceGaps("No powder ring is left.", profile).missing.map((t) => t.id)).toEqual(["rings"]);
    expect(evidenceGaps("The HKL origin is shifted.", []).missing.map((t) => t.id)).toEqual(["origin"]);
    expect(evidenceGaps("The origin's self-correlation peak is cut off at 1.95 Å.", []).missing).toEqual([]); // the ΔPDF's origin
    expect(evidenceGaps("The strongest correlation is negative, at (0.5, 0.5, 0).", []).missing.map((t) => t.id)).toEqual(["features"]);
    // Words about correlations with no vector or sign give no verdict on them.
    expect(evidenceGaps("Next I will look at the pair correlations.", []).missing).toEqual([]);
    const peaks = [step("dpdf_peaks", { features: [] })];
    expect(evidenceGaps("The strongest correlation is negative, at (0.5, 0.5, 0).", peaks).missing).toEqual([]);
  });
});

describe("numbers by reference", () => {
  const steps = [
    step("assess_stage", { rings: stage("rings", ATTENTION, { max_ring_left: 0.14 }) }, { stage: "rings" }),
    step("assess_stage", { flatten: stage("flatten", PASS, { max_floor_trend: 0.025 }) }, { stage: "flatten" }),
    step("ub_check", { orientation_change_deg: 0.601, origin_shift_rlu: null, symmetrised: false, passes: [{ q_max: 3.2 }] }),
    step("dpdf_peaks", { features: [{ sign: "−", vectors_rlu: [[0.497, 0.497, 0], [0, 0.497, 0.497]] }] }),
  ];

  it("fills a tool's field from the newest result that holds it, lists as the tools give them", () => {
    expect(resolveReference("assess_stage.rings.max_ring_left", steps)).toBe("0.14"); // not the flatten's result after it
    expect(resolveReference("assess_stage.flatten.verdict", steps)).toBe(PASS);
    expect(resolveReference("ub_check.orientation_change_deg", steps)).toBe("0.601");
    expect(resolveReference("ub_check.symmetrised", steps)).toBe("no");
    expect(resolveReference("dpdf_peaks.features.0.vectors_rlu.1", steps)).toBe("(0, 0.497, 0.497)");
    expect(resolveReference("dpdf_peaks.features.0.vectors_rlu", steps)).toBe("(0.497, 0.497, 0); (0, 0.497, 0.497)");
  });

  it("names nothing it cannot fill: no such tool, field, or a value that is no number or text", () => {
    for (const key of ["ub_check.angle", "ub_check.origin_shift_rlu", "ub_check.passes", "qmax_coverage.verdict", "ub_check"]) {
      expect(resolveReference(key, steps), key).toBeNull();
    }
    const filled = fillReferences("Turned by {{ub_check.orientation_change_deg}}° ({{ub_check.angle}}°, {{ ub_check.angle }}).", steps);
    expect(filled).toEqual({ text: "Turned by 0.601° ({{ub_check.angle}}°, {{ ub_check.angle }}).", unknown: ["ub_check.angle"], filled: 1 });
    expect(fillReferences("No references here.", steps)).toEqual({ text: "No references here.", unknown: [], filled: 0 });
  });
});

describe("the verdict computed from the checks", () => {
  it("is met when every stage, measured as it now is, meets its goal", () => {
    const v = computedVerdict([all()])!;
    expect(v).toMatchObject({ achieved: true, attention: [], notMeasured: [], text: "met: every stage meets its goal" });
    expect(resolveReference("achieved", [all()])).toBe("met: every stage meets its goal");
  });

  it("is not met when a stage, the window, the symmetry or the fill's texture needs attention", () => {
    expect(computedVerdict([all({ flatten: stage("flatten", ATTENTION) })])!.text).toBe("not met: needs attention: the background correction");
    const checks = [
      all(),
      step("qmax_coverage", { verdict: "too far: the ΔPDF's separable window puts 0.04 of its weight on unmeasured reciprocal space" }),
      step("symmetry_check", { verdict: "not kept: six-fold (0.02)" }),
      step("texture_check", { per_cut: [{ systematic_fill_bias: false }, { systematic_fill_bias: true }] }),
    ];
    expect(computedVerdict(checks)!.attention).toEqual(["the ΔPDF window against the coverage", "the ΔPDF's symmetry", "the backfill's texture"]);
  });

  it("is not judged on a stage not measured since it was last computed, and computes the stage from its numbers when needed", () => {
    const stale = computedVerdict([all(), rerun({ rings: "reused", punch: "reused", backfill: "reused", flatten: "computed", pdf: "computed" })])!;
    expect(stale).toMatchObject({ achieved: null, notMeasured: ["the background correction", "the 3D-ΔPDF"] });
    expect(stale.text).toBe("not judged: not measured since it was last computed: the background correction, the 3D-ΔPDF");
    // A result without its verdict label: judged by the stage's rule from its numbers.
    const numbers = step("assess_stage", { flatten: { max_after_floor_sigma: 1.8, max_floor_trend: 0.975, max_floor_span_fraction: 0.971 } }, { stage: "flatten" });
    expect(computedVerdict([numbers])!.stages.flatten).toBe("attention");
    expect(computedVerdict([step("describe_dataset", {})])).toBeNull(); // nothing it rests on
  });

  it("says why a stage measured on a grid too coarse for its check is not judged, not that it was not measured (G1)", () => {
    const coarse = { verdict: "not judged", max_ring_left: null, max_ring_dent: null, ring_rule: "not judged: grid too coarse: 0.99 voxels across a ring's width (at most 0.16 Å⁻¹), under 1" };
    const v = computedVerdict([all({ rings: coarse })])!;
    expect(v).toMatchObject({ achieved: null, attention: [], notMeasured: [], notJudged: ["the ring removal (grid too coarse for the ring check)"] });
    expect(v.text).toBe("not judged: the ring removal (grid too coarse for the ring check)");
    expect(resolveReference("achieved", [all({ rings: coarse })])).toBe(v.text);
    // Beside stages not measured since they were last computed, each with its own words.
    const stale = computedVerdict([all({ rings: coarse }), rerun({ rings: "reused", punch: "reused", backfill: "reused", flatten: "computed", pdf: "computed" })])!;
    expect(stale).toMatchObject({ achieved: null, notMeasured: ["the background correction", "the 3D-ΔPDF"], notJudged: ["the ring removal (grid too coarse for the ring check)"] });
    expect(stale.text).toBe("not judged: the ring removal (grid too coarse for the ring check); not measured since it was last computed: the background correction, the 3D-ΔPDF");
    // A need for attention elsewhere still decides: not met.
    expect(computedVerdict([all({ rings: coarse, flatten: stage("flatten", ATTENTION) })])!.text).toBe("not met: needs attention: the background correction");
    // A ring check that judged nothing for another reason reads as before, with no notJudged.
    const nothing = computedVerdict([all({ rings: { verdict: "not judged", max_ring_left: null, max_ring_dent: null, ring_rule: "not judged: the test of each bump in 3D could not run" } })])!;
    expect(nothing.text).toBe("not judged: not measured since it was last computed: the ring removal");
    expect(nothing).not.toHaveProperty("notJudged");
    // A claim of success is held to the verdict, which says why: the checks ran.
    expect(overallContradiction("The 3D-ΔPDF can be trusted.", v)).toBe(`It calls the run a success, but the verdict computed from the checks is "${v.text}"`);
    expect(overallContradiction("The 3D-ΔPDF can be trusted.", nothing)).toMatch(/did not all run on the outputs as they now are \(not judged: not measured/);
  });

  it("says why the fills' texture could not be judged, and is then not met nor judged met (plan 4.2, as G1)", () => {
    // texture_check over every punch hole in 3-D: not judged on a grid too coarse for the holes' rims, or with too few holes.
    const unmeasured = { median_fill_bias_sigma: null, median_fill_bias_level: null, above_fraction: null, below_fraction: null, above_floor_fraction: null, below_floor_fraction: null };
    const texture = (over: Record<string, unknown>) => step("texture_check", { n_holes: 277, ...unmeasured, systematic_fill_bias: null, per_cut: [], ...over });
    const coarse = texture({ not_judged: "grid too coarse: the nodes are 10 voxels apart, under 14: a hole reaches 3 voxels and its rim 4 more" });
    const few = texture({ n_holes: 4, n_judged: 4, not_judged: "too few holes judged: 4 of 4, under 5" });
    const v = computedVerdict([all(), coarse])!;
    expect(v).toMatchObject({ achieved: null, attention: [], notMeasured: [], notJudged: ["the backfill's texture (grid too coarse)"] });
    expect(v.text).toBe("not judged: the backfill's texture (grid too coarse)");
    expect(computedVerdict([all(), few])!.text).toBe("not judged: the backfill's texture (too few holes)");
    // Beside a stage not judged for the grid (G1): the stages first.
    const rings = { verdict: "not judged", max_ring_left: null, max_ring_dent: null, ring_rule: "not judged: grid too coarse: 0.99 voxels across a ring's width (at most 0.16 Å⁻¹), under 1" };
    expect(computedVerdict([all({ rings }), coarse])!.text).toBe("not judged: the ring removal (grid too coarse for the ring check), the backfill's texture (grid too coarse)");
    // A need for attention elsewhere still decides: not met.
    expect(computedVerdict([all({ flatten: stage("flatten", ATTENTION) }), coarse])!.text).toBe("not met: needs attention: the background correction");
    // The newest texture_check counts: a judged one after it, met; one that judged nothing (no cuts, recorded before 4.2) says nothing of the run.
    expect(computedVerdict([all(), coarse, texture({ n_judged: 189, ...unmeasured, median_fill_bias_level: 0, systematic_fill_bias: false })])!.text).toBe("met: every stage meets its goal");
    expect(computedVerdict([all(), step("texture_check", { per_cut: [] })])!.text).toBe("met: every stage meets its goal");
    // A claim of success is held to the verdict, which says why: the check ran.
    expect(overallContradiction("The 3D-ΔPDF can be trusted.", v)).toBe(`It calls the run a success, but the verdict computed from the checks is "${v.text}"`);
  });

  it("names the data's problems no setting fixes, apart from whether the reduction met its goal", () => {
    const v = computedVerdict([
      all(),
      step("ub_check", { fit: "both", orientation_change_deg: 0.601, origin_shift_rlu: null }),
      step("qmax_coverage", { verdict: "clean: …", counts_end_inside_box: true, raw_counts: { q_max_edge: 4.507 } }),
    ])!;
    expect(v.achieved).toBe(true);
    expect(v.dataProblems).toEqual(["the counts end at 4.507 Å⁻¹, inside the box", "the UB is turned by 0.601°"]);
    expect(v.text).toBe("met: every stage meets its goal; data problems no setting fixes: the counts end at 4.507 Å⁻¹, inside the box; the UB is turned by 0.601°");
  });

  it("holds a claim that the run succeeded to it, and lets the rest through", () => {
    const notMet = computedVerdict([all({ flatten: stage("flatten", ATTENTION) })]);
    expect(overallContradiction("The 3D-ΔPDF can be trusted.", notMet)).toMatch(/^It calls the run a success, but the verdict computed from the checks is "not met/);
    expect(overallContradiction("Every stage meets its goal, so the result is reliable.", notMet)).not.toBeNull();
    expect(overallContradiction("The 3D-ΔPDF can be trusted.", computedVerdict([all()]))).toBeNull();
    // Not claims of success: negated, hedged, a question, a plan.
    for (const s of ["The 3D-ΔPDF cannot be trusted yet.", "Can the 3D-ΔPDF be trusted?", "If the flatten passes, the result would be reliable.", "Next I will check whether the run is ready."]) {
      expect(overallContradiction(s, notMet), s).toBeNull();
    }
    expect(overallContradiction("The run is ready for analysis.", null)).toMatch(/did not all run/);
  });
});

describe("the line under a reply", () => {
  it("gives the verdict when the reply judged the run, the data's problems when only they were found, else nothing", () => {
    expect(verdictLine(computedVerdict([all()]))).toBe("Verdict from the checks: met: every stage meets its goal.");
    expect(verdictLine(computedVerdict([step("assess_stage", { rings: stage("rings", ATTENTION) }, { stage: "rings" })]))).toBe(
      "Verdict from the checks: not met: needs attention: the ring removal.",
    );
    // A question about one stage that passed: too little to judge the run, nothing to add.
    expect(verdictLine(computedVerdict([step("assess_stage", { rings: stage("rings", PASS) }, { stage: "rings" })]))).toBeNull();
    expect(verdictLine(computedVerdict([step("ub_check", { fit: "both", orientation_change_deg: 0, origin_shift_rlu: [0.0305, 0.0195, 0] })]))).toBe(
      "From the checks: data problems no setting fixes: the HKL origin is shifted by (0.0305, 0.0195, 0) r.l.u.",
    );
    expect(verdictLine(null)).toBeNull();
  });
});

describe("what the tool found, read whole where the model read it fitted (readings/)", () => {
  // The model's copy of a result past the limit, as fit leaves it: some fields
  // kept, the rest named under left_out; the step keeps the whole beside it.
  const readFitted = (s: AgentStep, kept: Record<string, unknown>): AgentStep => ({
    ...s,
    result: JSON.stringify({ ...kept, left_out: ["the rest"] }),
    full: s.result,
  });

  it("dates each stage by what the run's whole result says it computed", () => {
    const run = readFitted(rerun({ rings: "reused", punch: "reused", backfill: "reused", flatten: "computed", pdf: "computed" }), { ended: "done" });
    expect(recomputedAt([all(), run])).toEqual({ rings: -1, punch: -1, backfill: -1, flatten: 1, pdf: 1 });
  });

  it("fills a reference from a field only the whole result holds", () => {
    const ub = readFitted(step("ub_check", { fit: "both", orientation_change_deg: 0, origin_shift_rlu: [0.0305, 0.0195, 0] }), { fit: "both" });
    expect(resolveReference("ub_check.origin_shift_rlu", [ub])).toBe("(0.0305, 0.0195, 0)");
    expect(fillReferences("Shifted by {{ub_check.origin_shift_rlu}} r.l.u.", [ub]).text).toBe("Shifted by (0.0305, 0.0195, 0) r.l.u.");
  });

  it("judges a check from the whole result, its numbers left out of the model's copy", () => {
    const rings = readFitted(step("assess_stage", { rings: stage("rings", ATTENTION) }, { stage: "rings" }), {});
    expect(verdicts({ reply: [rings] }).checks.rings).toBe("attention");
    expect(computedVerdict([rings])?.attention).toEqual(["the ring removal"]);
  });
});
