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

const stage = (verdict: string, extra: Record<string, unknown> = {}) => ({ verdict, ...extra });
const PASS = "meets its goal";
const ATTENTION = "needs attention";
const all = (over: Record<string, unknown> = {}) =>
  step("assess_stage", { rings: stage(PASS), punch: stage(PASS), backfill: stage(PASS), flatten: stage(PASS, { max_floor_trend: 0.31 }), pdf: stage(PASS), ...over }, { stage: "all" });
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
    step("assess_stage", { rings: stage(ATTENTION, { max_ring_left: 0.14 }) }, { stage: "rings" }),
    step("assess_stage", { flatten: stage(PASS, { max_floor_trend: 0.025 }) }, { stage: "flatten" }),
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
    expect(computedVerdict([all({ flatten: stage(ATTENTION) })])!.text).toBe("not met: needs attention: the flatten");
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
    expect(stale).toMatchObject({ achieved: null, notMeasured: ["the flatten", "the 3D-ΔPDF"] });
    expect(stale.text).toBe("not judged: not measured since it was last computed: the flatten, the 3D-ΔPDF");
    // A result without its verdict label: judged by the stage's rule from its numbers.
    const numbers = step("assess_stage", { flatten: { max_after_floor_sigma: 1.8, max_floor_trend: 0.975, max_floor_span_fraction: 0.971 } }, { stage: "flatten" });
    expect(computedVerdict([numbers])!.stages.flatten).toBe("attention");
    expect(computedVerdict([step("describe_dataset", {})])).toBeNull(); // nothing it rests on
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
    const notMet = computedVerdict([all({ flatten: stage(ATTENTION) })]);
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
    expect(verdictLine(computedVerdict([step("assess_stage", { rings: stage(ATTENTION) }, { stage: "rings" })]))).toBe(
      "Verdict from the checks: not met: needs attention: the ring removal.",
    );
    // A question about one stage that passed: too little to judge the run, nothing to add.
    expect(verdictLine(computedVerdict([step("assess_stage", { rings: stage(PASS) }, { stage: "rings" })]))).toBeNull();
    expect(verdictLine(computedVerdict([step("ub_check", { fit: "both", orientation_change_deg: 0, origin_shift_rlu: [0.0305, 0.0195, 0] })]))).toBe(
      "From the checks: data problems no setting fixes: the HKL origin is shifted by (0.0305, 0.0195, 0) r.l.u.",
    );
    expect(verdictLine(null)).toBeNull();
  });
});
