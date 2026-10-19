// The disagreements the check-verdict module keeps, each named in the module
// and pinned here with both readings. Unifying one (plan rows 2.4.1–2.4.11)
// is the one line its rule's comment names; its pin then shows the readings
// agree.

import { describe, expect, it } from "vitest";

import type { AgentStep } from "../agent";
import { TOPICS } from "../answerChecks";
import type { Measured } from "../report/report";
import { outOfBounds } from "../tune/evaluate";
import { judge, UNROUNDED, verdicts, WORDS, type CheckId } from "../verdicts";
import {
  D10_ACHIEVED_IGNORES_LEGACY_COVERAGE_WORDS,
  D11_ANSWER_JUDGES_MISSING_OUTPUT,
  D12_ANSWER_SKIPS_WORDS_THAT_ARE_NO_LABEL,
  D13_REPORT_SYMMETRY_FROM_SYMMETRY_CHECK_ONLY,
  D14_REPORT_FILL_BIAS_ON_A_JUDGED_SEAM_ONLY,
  D1_REACH_PASS_SETTLES_NOTHING,
  D2_REPORT_COVERAGE_BY_WEIGHT_ONLY,
  D3_ACHIEVED_IGNORES_GRAIN,
  D3_ANSWER_GRAIN_SECOND_GRAIN_ONLY,
  D3_ANSWER_UB_FROM_UB_CHECK_ONLY,
  D7_SELECTION,
  D8_ANSWER_BACKFILL_IGNORES_TEXTURE,
  D9_REPORT_PDF_CARD_WITHOUT_EVALUATION,
  READS,
} from "../verdicts/readers";
import { D17_REPEAT_POINTER_READS_AS_A_RESULT, D18_REPORT_JUDGES_STAGE_NUMBERS } from "../verdicts/recorded";
import { D15_PDF_PASSES_UNMEASURED, D16_UB_UNMEASURED_READS_RIGHT, D5_PROTECTED_SHARP_PEAKS_COUNT, D6_PDF_READS_ROUNDED_WEIGHT } from "../verdicts/rules";
import { COVERAGE, GRAIN, GRID_STAGES, STAGE_VARIANTS, SYMMETRY, TEXTURE, UB, type GridStage } from "./verdictGrid";

let n = 0;
const step = (name: string, result: unknown, args: Record<string, unknown> = {}): AgentStep => ({
  id: `p${n++}`,
  name,
  args,
  status: "done",
  result: JSON.stringify(result),
});
const reply = (...steps: AgentStep[]) => verdicts({ reply: steps });

const INSIDE = step("qmax_coverage", { verdict: "the transform reaches 6.283 Å⁻¹ (the window is tapered to the measured coverage), inside full coverage at 6.5 Å⁻¹", window_weight_on_unmeasured: null });
const TOO_FAR = step("qmax_coverage", { verdict: "too far: the ΔPDF's separable window puts 0.04 of its weight on unmeasured reciprocal space", window_weight_on_unmeasured: 0.04 });
const grain = (verdict: string, judged: number, near: number) => step("grain_check", { judged, near_bragg_nodes: near, verdict });
const UB_OFF = grain("the off-lattice peaks are the crystal's own Bragg peaks with the UB off: one rotation of 0.9° puts 38 of the 40 strongest orbits back on the Bragg lattice (random directions: 2); refine the UB", 40, 40);
const BESIDE_WORDS = "no second grain of this phase: a rotated copy of the Bragg lattice indexes only 3 of the 40 strongest off-lattice orbits (random directions: 5). 28 of them sit within a quarter of the node spacing of a Bragg node";
const BESIDE = grain(BESIDE_WORDS, 40, 28);
const NO_GRAIN = grain("no second grain of this phase: a rotated copy of the Bragg lattice indexes only 3 of the 40 strongest off-lattice orbits (random directions: 5)", 40, 3);
const assess = (stage: string, m: Record<string, unknown>) => step("assess_stage", { [stage]: m }, { stage });

describe("the answer checks read each check's result where the module says the stage it reads", () => {
  it("as their topics do", () => {
    for (const t of TOPICS) if (t.id in READS) expect(READS[t.id as CheckId], t.id).toBe(t.stage);
  });
});

describe("D1–D10, kept and named", () => {
  it("D1, unified (2.4.1): a pass by the reach inside full coverage is coverage OK to the answer checks, as to {{achieved}}", () => {
    expect(D1_REACH_PASS_SETTLES_NOTHING).toBe(false);
    expect(reply(INSIDE).checks.coverage).toBe("pass");
    expect(reply(INSIDE).achieved).toMatchObject({ attention: [] });
    // After "too far", both read the newest: the reach inside.
    const after = reply(TOO_FAR, INSIDE);
    expect(after.checks.coverage).toBe("pass");
    expect(after.achieved?.attention).toEqual([]);
  });

  it("D2, unified (2.4.2): the report's ΔPDF card counts the coverage's \"too far\", as {{achieved}} does", () => {
    expect(D2_REPORT_COVERAGE_BY_WEIGHT_ONLY).toBe(false);
    const reach = { verdict: "too far: the transform reaches 9.1 Å⁻¹ (the window tapers to zero at the box faces), past full coverage at 6.5 Å⁻¹", window_weight_on_unmeasured: null };
    const measured: Measured = { ...PASSING, coverage: reach };
    expect(verdicts({ report: measured }).checks.pdf).toBe("attention");
    expect(chatOf(measured)?.attention).toEqual(["the ΔPDF window against the coverage"]);
    // A weight past the limit, though the evaluation's own is within it.
    const tooFar = { ...PASSING, coverage: { verdict: "too far: the ΔPDF's separable window puts 0.04 of its weight on unmeasured reciprocal space", window_weight_on_unmeasured: 0.04 } };
    expect(verdicts({ report: tooFar }).checks.pdf).toBe("attention");
    expect(chatOf(tooFar)?.attention).toEqual(["the ΔPDF window against the coverage"]);
    // Its weight, where the evaluation records none, it reads as before.
    expect(verdicts({ report: { ...PASSING, pdf: { back_fft_pearson_r_even: 1 }, coverage: { verdict: "too far: …", window_weight_on_unmeasured: 0.04 } } }).checks.pdf).toBe("attention");
    // Words no producer wrote are no "too far" to either reader (D10 keeps them apart for the answer checks).
    const legacy: Measured = { ...PASSING, coverage: { verdict: "past full coverage: the window reaches the box corners" } };
    expect(verdicts({ report: legacy }).checks.pdf).toBe("pass");
    expect(chatOf(legacy)?.attention).toEqual([]);
  });

  it("D3, unified (2.4.3): grain_check's \"UB off\" is a data problem in {{achieved}} and not OK for the UB topic; it stays the check for a second grain", () => {
    expect([D3_ACHIEVED_IGNORES_GRAIN, D3_ANSWER_GRAIN_SECOND_GRAIN_ONLY, D3_ANSWER_UB_FROM_UB_CHECK_ONLY]).toEqual([false, true, false]);
    const problem = "the UB is off by 0.9° (one rotation puts the off-lattice peaks back on the Bragg lattice)";
    // The UB off: the grain's outcome needs attention, as the report's card says, and names the data's problem.
    expect(judge("grain", { off_lattice_orbits: 60, judged: 40, near_bragg_nodes: 40, near_offset_angle_deg: { median: 0.6, quartiles: [0.5, 0.7] }, far: [], rotated_copy: { indexed: 38, misorientation_deg: 0.9 }, random_control: 2, symmetrised: false })).toMatchObject({ kind: "attention", reasons: ["UB off", "peaks beside nodes"], dataProblems: [problem] });
    const off = reply(UB_OFF);
    expect(off.achieved).toMatchObject({ achieved: null, attention: [], dataProblems: [problem] }); // measured; no stage is
    expect(off.checks.grain).toBeUndefined(); // no second grain named, either way
    expect(off.checks.ub).toBe("attention");
    // Of a ub_check and the grain's UB off, the newest decides the UB.
    const right = step("ub_check", { fit: "both", symmetrised: false, orientation_change_deg: 0.01 });
    expect(reply(right, UB_OFF).checks.ub).toBe("attention");
    expect(reply(UB_OFF, right).checks.ub).toBe("pass");
    // grain_check's other findings say nothing of the UB, and name no data problem (but its peaks beside the nodes, D3a).
    expect(reply(NO_GRAIN).checks.ub).toBeUndefined();
    expect(reply(NO_GRAIN).achieved?.dataProblems).toEqual([]);
    // Most of the strongest beside the nodes: attention to the report, "no second grain" to the answer checks.
    expect(reply(BESIDE).checks.grain).toBe("pass");
  });

  it("D3a (2.4.3a, the manager on the user's delegation): grain_check's peaks beside the nodes are the UB off too, to both readers", () => {
    const beside = reply(BESIDE);
    expect([beside.checks.ub, beside.achieved?.dataProblems]).toEqual(["attention", ["the UB is off (the strongest off-lattice peaks sit beside Bragg nodes)"]]);
    // With the median offset its words give, a lower bound.
    const offset = reply(grain(`${BESIDE_WORDS}, offset by a median 1.2° of rotation (a lower bound: a node at an angle to the rotation axis moves less): the Bragg peaks themselves, off their nodes by about that angle (refine the UB)`, 40, 28));
    expect(offset.achieved?.dataProblems).toEqual(["the UB is off by at least 1.2° (the strongest off-lattice peaks sit beside Bragg nodes)"]);
    // Still no second grain to the grain topic.
    expect(beside.checks.grain).toBe("pass");
  });

  it("D4, unified (2.4.4): one UB turned, 0.05° or more from an unsymmetrised fit; a symmetrised volume's UB is not judged, and not right", () => {
    // Turned: a data problem to {{achieved}} and off to the answer checks, its angle under either name.
    for (const [ub, problem] of [
      [{ fit: "both", symmetrised: false, orientation_change_deg: 0.05 }, "the UB is turned by 0.05°"],
      [{ angle_deg: 0.4 }, "the UB is turned by 0.4°"],
    ] as const) {
      const r = reply(step("ub_check", ub));
      expect([r.checks.ub, r.achieved?.dataProblems], JSON.stringify(ub)).toEqual(["attention", [problem]]);
    }
    // Not judged (a symmetrised volume, its symmetric fit): no data problem, whatever the fit turned, and still off to the answer checks.
    for (const ub of [
      { fit: "symmetric", symmetrised: true, orientation_change_deg: 0 },
      { fit: "symmetric", symmetrised: true, orientation_change_deg: 0.3 },
      { fit: "symmetric", symmetrised: false, orientation_change_deg: 0.3 },
    ]) {
      const r = reply(step("ub_check", ub));
      expect([r.checks.ub, r.achieved?.dataProblems], JSON.stringify(ub)).toEqual(["attention", []]);
      expect(judge("ub", ub).reasons, JSON.stringify(ub)).toEqual(["symmetrised"]);
    }
    // Under 0.05° from an unsymmetrised fit: right, to both.
    const right = reply(step("ub_check", { fit: "both", symmetrised: false, orientation_change_deg: 0.049 }));
    expect([right.checks.ub, right.achieved?.dataProblems]).toEqual(["pass", []]);
  });

  it("D5, unified (2.4.5): the sharp peaks on protected planes stay out of the punch's verdict, as its goal says they stay by design", () => {
    expect(D5_PROTECTED_SHARP_PEAKS_COUNT).toBe(false);
    expect(judge("punch", { leftover_at_nodes: 0, leftover_off_lattice_sharp: 3, leftover_on_protected_planes: 3, leftover_on_protected_planes_sharp: 3 })).toMatchObject({ kind: "pass", reasons: [] });
    // One sharp peak more, off the protected planes: one the search left.
    expect(judge("punch", { leftover_at_nodes: 0, leftover_off_lattice_sharp: 4, leftover_on_protected_planes: 3, leftover_on_protected_planes_sharp: 3 })).toMatchObject({ kind: "attention", reasons: ["sharp off-lattice"] });
    // An evaluation recorded without their own count (before 2.4.5) counts every sharp one, as it did.
    expect(judge("punch", { leftover_at_nodes: 0, leftover_off_lattice_sharp: 3, leftover_on_protected_planes: 3 })).toMatchObject({ kind: "attention", reasons: ["sharp off-lattice"] });
    expect(WORDS.goal.punch).toMatch(/leftover_on_protected_planes of them sit on protected planes and stay by design/);
    // The criterion says it too (2.4.5b).
    expect(WORDS.criterion.punch).toMatch(/no sharp peak left off the lattice outside the protected planes/);
  });

  it("D6, unified (2.4.6): every check compares the raw window weight; at 1.04e-3 the coverage, the ΔPDF and the tuning all read it past 1e-3", () => {
    expect(D6_PDF_READS_ROUNDED_WEIGHT).toBe(false);
    const coverage = judge("coverage", { window_weight: 0.00104, window: "the ΔPDF's ellipsoid window", unit_cell: true, full_coverage_q: null, reach: null, reach_from: "", shell: 0.1, band_set: false, counts: { counts_end_inside_box: false } });
    expect(coverage).toMatchObject({ kind: "attention", reasons: ["window past limit"] });
    // An evaluation as tune/evaluate.ts wrote it before 2.4.6b: two figures shown, the raw weight kept beside.
    const evaluation = { back_fft_pearson_r_even: 1, window_weight_on_unmeasured: 0.001, [UNROUNDED]: { window_weight_on_unmeasured: 0.00104 } };
    expect(judge("pdf", evaluation)).toMatchObject({ kind: "attention", reasons: ["window past limit"] });
    expect(outOfBounds("pdf", evaluation)).toBe("its window puts 0.00104 of its weight on unmeasured reciprocal space, past the 0.001 the backend's own window allows");
    // At the limit, raw: within, to each.
    expect(judge("pdf", { ...evaluation, [UNROUNDED]: { window_weight_on_unmeasured: 0.001 } }).kind).toBe("pass");
    // Read back from its JSON, an evaluation has its shown weight only.
    expect(judge("pdf", JSON.parse(JSON.stringify(evaluation)))).toMatchObject({ kind: "pass", reasons: ["window within limit"] });
  });

  it("D7, unified (2.4.7): both readers read a check's newest current result, even one not judged; what decides nothing is not read; on the UB the newest evidence of either check wins", () => {
    expect(D7_SELECTION).toEqual({ achieved: "newest", answer: "newest" });
    const needs = assess("rings", { verdict: "needs attention", max_ring_left: 0.1, max_ring_dent: 0 });
    const r = reply(needs, assess("rings", { verdict: "not judged", max_ring_left: null }));
    expect([r.achieved?.stages.rings, r.checks.rings]).toEqual(["info", "info"]);
    // A missing output decides nothing, and hides nothing, to either reader (D11 keeps the 3D-ΔPDF's apart).
    const missing = reply(needs, assess("rings", { missing: "no ringremoved output yet" }));
    expect([missing.achieved?.stages.rings, missing.checks.rings]).toEqual(["attention", "attention"]);
    // On the UB, the newest evidence across ub_check and grain_check's "UB off" wins, for both readers.
    const problem = "the UB is off by 0.9° (one rotation puts the off-lattice peaks back on the Bragg lattice)";
    const right = step("ub_check", { fit: "both", symmetrised: false, orientation_change_deg: 0.01 });
    const later = reply(UB_OFF, right);
    expect([later.checks.ub, later.achieved?.dataProblems]).toEqual(["pass", []]);
    const earlier = reply(right, UB_OFF);
    expect([earlier.checks.ub, earlier.achieved?.dataProblems]).toEqual(["attention", [problem]]);
    // A grain_check finding that names no UB off decides nothing of the UB: the earlier "UB off" stands, for both.
    const after = reply(UB_OFF, NO_GRAIN);
    expect([after.checks.ub, after.achieved?.dataProblems]).toEqual(["attention", [problem]]);
  });

  it("D8, unified (2.4.8): the answer checks' backfill topic counts the fill bias {{achieved}} counts: attention if either check needs it, a pass only when both pass", () => {
    expect(D8_ANSWER_BACKFILL_IGNORES_TEXTURE).toBe(false);
    const seamOk = assess("backfill", { verdict: "meets its goal", mean_median_seam_sigma: 0.5 });
    const seamFails = assess("backfill", { verdict: "needs attention", mean_median_seam_sigma: 1.5 });
    const bias = step("texture_check", { per_cut: [{ systematic_fill_bias: true }] });
    const noBias = step("texture_check", { per_cut: [{ systematic_fill_bias: false }] });
    const r = reply(seamOk, bias);
    expect(r.achieved?.attention).toEqual(["the backfill's texture"]);
    expect(r.checks.backfill).toBe("attention");
    // One check's newer pass never hides the other's attention.
    expect([reply(seamFails, noBias), reply(bias, seamOk), reply(noBias, seamFails)].map((x) => x.checks.backfill)).toEqual(["attention", "attention", "attention"]);
    expect(reply(seamOk, noBias).checks.backfill).toBe("pass");
    // The seam alone passes only half of it: not judged.
    expect(reply(seamOk).checks.backfill).toBe("info");
  });

  it("D9, unified (2.4.9): without a ΔPDF evaluation the report's ΔPDF card is not judged, as {{achieved}} says not measured; a check on it that needs attention still counts", () => {
    expect(D9_REPORT_PDF_CARD_WITHOUT_EVALUATION).toBe(false);
    const measured: Measured = { ...PASSING, pdf: null };
    expect(verdicts({ report: measured }).checks.pdf).toBe("info");
    expect(verdicts({ report: measured }).achieved).toMatchObject({ achieved: null, text: "not judged: not measured: 3D-ΔPDF" });
    expect(chatOf(measured)).toMatchObject({ achieved: null, notMeasured: ["the 3D-ΔPDF"] });
    // The coverage too far, without an evaluation: attention on the card, as the chat's goal is not met.
    const far: Measured = { ...PASSING, pdf: null, coverage: COVERAGE[1].m };
    expect(verdicts({ report: far }).checks.pdf).toBe("attention");
    expect([verdicts({ report: far }).achieved?.achieved, chatOf(far)?.achieved]).toEqual([false, false]);
  });

  it("D10: a recording's coverage words no producer wrote are not ok to the answer checks and no attention to {{achieved}}", () => {
    expect(D10_ACHIEVED_IGNORES_LEGACY_COVERAGE_WORDS).toBe(true);
    for (const verdict of ["past full coverage: the window reaches the box corners", "unmeasured space inside the window", "not inside the coverage"]) {
      const r = reply(step("qmax_coverage", { verdict }));
      expect(r.checks.coverage, verdict).toBe("attention");
      expect(r.achieved?.attention, verdict).toEqual([]);
    }
  });
});

describe("the disagreements found beyond D1–D10, kept and named", () => {
  it("D11: a ΔPDF with no output yet reads as passing to the answer checks, over an earlier verdict; {{achieved}} skips it", () => {
    expect(D11_ANSWER_JUDGES_MISSING_OUTPUT).toBe(true);
    const r = reply(assess("pdf", { verdict: "needs attention", back_fft_pearson_r_even: 0.9 }), assess("pdf", { missing: "no delta_pdf output yet; run_pipeline computes it" }));
    expect(r.checks.pdf).toBe("pass");
    expect(r.achieved?.stages.pdf).toBe("attention");
    // Any other stage's missing output decides nothing.
    expect(reply(assess("rings", { missing: "no ringremoved output yet" })).checks.rings).toBeUndefined();
  });

  it("D12: a stage's recorded words that are no label decide nothing for the answer checks; {{achieved}} judges the numbers", () => {
    expect(D12_ANSWER_SKIPS_WORDS_THAT_ARE_NO_LABEL).toBe(true);
    const r = reply(assess("rings", { verdict: "fine", max_ring_left: 0.12, max_ring_dent: 0 }));
    expect(r.achieved?.stages.rings).toBe("attention");
    expect(r.checks.rings).toBeUndefined();
  });

  it("D13: the report's ΔPDF card reads the symmetry from symmetry_check alone; the chat's ΔPDF stage counts the evaluation's own break", () => {
    expect(D13_REPORT_SYMMETRY_FROM_SYMMETRY_CHECK_ONLY).toBe(true);
    const broken = { back_fft_pearson_r_even: 1, window_weight_on_unmeasured: 0.0001, max_symmetry_break: 0.05, worst_symmetry_op: "six-fold (60°)", symmetry_declared: true };
    for (const symmetry of [SYMMETRY[0].m, null]) {
      const measured: Measured = { ...PASSING, pdf: broken, symmetry };
      expect(verdicts({ report: measured }).checks.pdf).toBe("pass");
      expect(chatOf(measured)?.stages.pdf).toBe("attention");
    }
  });

  it("D14: the report counts the fill bias only on a Backfill card that judged its seam; {{achieved}} names the backfill's texture", () => {
    expect(D14_REPORT_FILL_BIAS_ON_A_JUDGED_SEAM_ONLY).toBe(true);
    for (const backfill of [null, { max_bright_fill_fraction: 0 }]) {
      const measured: Measured = { ...PASSING, backfill, texture: TEXTURE[1].m };
      expect(verdicts({ report: measured }).checks.backfill).toBe(backfill ? "info" : undefined);
      expect(chatOf(measured)?.attention).toContain("the backfill's texture");
    }
    // With the seam judged, the bias counts there.
    expect(verdicts({ report: { ...PASSING, texture: TEXTURE[1].m } }).checks.backfill).toBe("attention");
  });

  it("D18: the report judges a stage from its numbers and takes no recorded label; a reply trusts the label", () => {
    expect(D18_REPORT_JUDGES_STAGE_NUMBERS).toBe(true);
    const labelled = { verdict: "needs attention", max_ring_left: 0, max_ring_dent: 0 };
    expect(verdicts({ report: { ...PASSING, rings: labelled } }).checks.rings).toBe("pass");
    expect(reply(assess("rings", labelled)).achieved?.stages.rings).toBe("attention");
    // The outcomes the measurement pass kept come first.
    const said = { check: "rings" as const, kind: "attention" as const, reasons: ["ring left" as const], dataProblems: [], words: "needs attention" };
    expect(verdicts({ report: { ...PASSING, outcomes: [said] } }).checks.rings).toBe("attention");
  });

  it("D15: the ΔPDF's rule passes an evaluation that measured nothing, where every other stage's says nothing to judge", () => {
    expect(D15_PDF_PASSES_UNMEASURED).toBe(true);
    expect(judge("pdf", {})).toMatchObject({ kind: "pass", reasons: [] });
    expect(judge("rings", {})).toMatchObject({ kind: "info", reasons: ["nothing to judge"] });
  });

  it("D17, unified (2.4b.1): a repeated call's pointer holds no outcome; both readers read the result it points to", () => {
    expect(D17_REPEAT_POINTER_READS_AS_A_RESULT).toBe(false);
    const pointer = (name: string) => step(name, { already_called: "Called with these arguments earlier in this reply (step 1); its result is above. Use it, or call with other arguments." });
    expect(reply(TOO_FAR).achieved?.attention).toEqual(["the ΔPDF window against the coverage"]);
    const r = reply(TOO_FAR, pointer("qmax_coverage"));
    expect(r.achieved?.attention).toEqual(["the ΔPDF window against the coverage"]);
    expect(r.checks.coverage).toBe("attention");
    // A repeated ub_check reads as the UB it points to, no longer as a right UB (D16).
    const turned = reply(step("ub_check", { fit: "both", symmetrised: false, orientation_change_deg: 0.6 }), pointer("ub_check"));
    expect([turned.checks.ub, turned.achieved?.dataProblems]).toEqual(["attention", ["the UB is turned by 0.6°"]]);
    // A pointer alone holds nothing to read.
    expect(reply(pointer("qmax_coverage"))).toEqual({ achieved: null, checks: {} });
  });

  it("D16: a ub_check result without an angle reads as a right UB", () => {
    expect(D16_UB_UNMEASURED_READS_RIGHT).toBe(true);
    const r = reply(step("ub_check", { fit: "both", symmetrised: false }));
    expect(r.checks.ub).toBe("pass");
    expect(r.achieved?.dataProblems).toEqual([]);
  });
});

// ---------------------------------------------------------------- the chat's achieved against the report's

/** A report's measurements that pass every check. */
const PASSING: Measured = {
  rings: STAGE_VARIANTS.rings[0].m,
  punch: STAGE_VARIANTS.punch[0].m,
  backfill: STAGE_VARIANTS.backfill[0].m,
  flatten: STAGE_VARIANTS.flatten[0].m,
  pdf: STAGE_VARIANTS.pdf[0].m,
  texture: TEXTURE[0].m,
  coverage: COVERAGE[0].m,
  symmetry: SYMMETRY[0].m,
  grains: GRAIN[2].m,
};

/** The same measurements as a reply's tool results: each stage as assess_stage writes it, then the checks on the result. */
function replyOf(m: Measured): AgentStep[] {
  const stages = Object.fromEntries(
    GRID_STAGES.filter((s) => m[s]).map((s) => [s, { verdict: judge(s, m[s]!).words, ...m[s] }]),
  );
  const tools: [string, unknown][] = [
    ["texture_check", m.texture],
    ["qmax_coverage", m.coverage],
    ["symmetry_check", m.symmetry],
    ["grain_check", m.grains],
    ["ub_check", m.ub],
  ];
  return [
    ...(Object.keys(stages).length ? [step("assess_stage", stages, { stage: "all" })] : []),
    ...tools.filter(([, r]) => r).map(([name, r]) => step(name, r)),
  ];
}

const chatOf = (m: Measured) => verdicts({ reply: replyOf(m) }).achieved;

type Rule = "D13" | "D14";

/** The grid's measurements, one change from passing at a time, tagged with the rule that makes the two goals differ there. */
function cases(): { id: string; m: Measured; differs?: Rule }[] {
  const out: { id: string; m: Measured; differs?: Rule }[] = [{ id: "every check passes", m: PASSING }];
  const d13 = new Set(["symmetry broken", "asymmetry, not read"]);
  for (const s of GRID_STAGES as GridStage[]) {
    for (const x of STAGE_VARIANTS[s]) out.push({ id: `${s} ${x.id}`, m: { ...PASSING, [s]: x.m }, differs: s === "pdf" && d13.has(x.id) ? "D13" : undefined });
    out.push({ id: `no ${s}`, m: { ...PASSING, [s]: null } });
  }
  for (const x of COVERAGE) out.push({ id: `coverage ${x.id}`, m: { ...PASSING, coverage: x.m } });
  for (const x of SYMMETRY) out.push({ id: `symmetry ${x.id}`, m: { ...PASSING, symmetry: x.m } });
  for (const x of TEXTURE) out.push({ id: `texture ${x.id}`, m: { ...PASSING, texture: x.m } });
  for (const x of GRAIN) out.push({ id: `grain ${x.id}`, m: { ...PASSING, grains: x.m } });
  for (const x of UB) out.push({ id: `ub ${x.id}`, m: { ...PASSING, ub: x.m } });
  out.push({ id: "no ΔPDF evaluation, the coverage too far by weight", m: { ...PASSING, pdf: null, coverage: COVERAGE[1].m } });
  out.push({ id: "no ΔPDF evaluation, the symmetry not kept", m: { ...PASSING, pdf: null, symmetry: SYMMETRY[1].m } });
  out.push({ id: "no ΔPDF, coverage or symmetry", m: { ...PASSING, pdf: null, coverage: null, symmetry: null } });
  out.push({ id: "a fill bias, no backfill", m: { ...PASSING, backfill: null, texture: TEXTURE[1].m }, differs: "D14" });
  out.push({ id: "a fill bias, the seam not judged", m: { ...PASSING, backfill: STAGE_VARIANTS.backfill[3].m, texture: TEXTURE[1].m }, differs: "D14" });
  out.push({ id: "a fill bias, the seam failing", m: { ...PASSING, backfill: STAGE_VARIANTS.backfill[2].m, texture: TEXTURE[1].m } });
  out.push({ id: "the evaluation's symmetry broken, no symmetry_check", m: { ...PASSING, pdf: STAGE_VARIANTS.pdf[8].m, symmetry: null }, differs: "D13" });
  out.push({ id: "nothing measured", m: {} });
  out.push({ id: "a grain only", m: { grains: GRAIN[0].m } });
  return out;
}

describe("the chat's achieved and the report's, on the same measurements", () => {
  it("agree, but where a named rule of the report's makes them differ", () => {
    for (const { id, m, differs } of cases()) {
      const chat = chatOf(m)?.achieved ?? null;
      const report = verdicts({ report: m }).achieved?.achieved ?? null;
      if (differs) expect(report, `${id} (${differs})`).not.toBe(chat);
      else expect(report, id).toBe(chat);
    }
  });

  it("name the same data problems, the report's run of ub_check included (Q11, 2.4.11)", () => {
    for (const { id, m } of cases()) {
      expect(verdicts({ report: m }).achieved?.dataProblems, id).toEqual(chatOf(m)?.dataProblems ?? []);
    }
  });
});
