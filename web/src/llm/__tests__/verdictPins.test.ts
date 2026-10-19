// The disagreements the check-verdict module keeps, each named in the module
// and pinned here with both readings. Unifying one (plan rows 2.4.1–2.4.11)
// is the one line its rule's comment names; its pin then shows the readings
// agree.

import { describe, expect, it } from "vitest";

import type { AgentStep } from "../agent";
import { TOPICS } from "../answerChecks";
import { outOfBounds } from "../tune/evaluate";
import { judge, UNROUNDED, verdicts, WORDS, type CheckId } from "../verdicts";
import {
  D10_ACHIEVED_IGNORES_LEGACY_COVERAGE_WORDS,
  D11_ANSWER_JUDGES_MISSING_OUTPUT,
  D12_ANSWER_SKIPS_WORDS_THAT_ARE_NO_LABEL,
  D1_REACH_PASS_SETTLES_NOTHING,
  D3_ACHIEVED_IGNORES_GRAIN,
  D3_ANSWER_GRAIN_SECOND_GRAIN_ONLY,
  D3_ANSWER_UB_FROM_UB_CHECK_ONLY,
  D7_SELECTION,
  D8_ANSWER_BACKFILL_IGNORES_TEXTURE,
  READS,
} from "../verdicts/readers";
import { D17_REPEAT_POINTER_READS_AS_A_RESULT } from "../verdicts/recorded";
import { D15_PDF_PASSES_UNMEASURED, D16_UB_UNMEASURED_READS_RIGHT, D5_PROTECTED_SHARP_PEAKS_COUNT, D6_PDF_READS_ROUNDED_WEIGHT } from "../verdicts/rules";

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
const BESIDE = grain("no second grain of this phase: a rotated copy of the Bragg lattice indexes only 3 of the 40 strongest off-lattice orbits (random directions: 5). 28 of them sit within a quarter of the node spacing of a Bragg node", 40, 28);
const assess = (stage: string, m: Record<string, unknown>) => step("assess_stage", { [stage]: m }, { stage });

describe("the answer checks read each check's result where the module says the stage it reads", () => {
  it("as their topics do", () => {
    for (const t of TOPICS) if (t.id in READS) expect(READS[t.id as CheckId], t.id).toBe(t.stage);
  });
});

describe("D1–D10, kept and named", () => {
  it("D1: a pass by the reach inside full coverage settles nothing for the answer checks; {{achieved}} reads it", () => {
    expect(D1_REACH_PASS_SETTLES_NOTHING).toBe(true);
    expect(reply(INSIDE).checks.coverage).toBeUndefined();
    expect(reply(INSIDE).achieved).toMatchObject({ attention: [] });
    // After "too far", the answer checks still read "too far"; {{achieved}} reads the newest.
    const after = reply(TOO_FAR, INSIDE);
    expect(after.checks.coverage).toBe("attention");
    expect(after.achieved?.attention).toEqual([]);
  });

  it("D3: grain_check counts for nothing in {{achieved}}, decides the grain topic by a second grain only, and never the UB", () => {
    expect([D3_ACHIEVED_IGNORES_GRAIN, D3_ANSWER_GRAIN_SECOND_GRAIN_ONLY, D3_ANSWER_UB_FROM_UB_CHECK_ONLY]).toEqual([true, true, true]);
    // The UB off: the grain's outcome needs attention, as the report's card says.
    expect(judge("grain", { off_lattice_orbits: 60, judged: 40, near_bragg_nodes: 40, near_offset_angle_deg: { median: 0.6, quartiles: [0.5, 0.7] }, far: [], rotated_copy: { indexed: 38, misorientation_deg: 0.9 }, random_control: 2, symmetrised: false })).toMatchObject({ kind: "attention", reasons: ["UB off", "peaks beside nodes"] });
    const off = reply(UB_OFF);
    expect(off.achieved).toBeNull(); // nothing measured, for {{achieved}}
    expect(off.checks.grain).toBeUndefined(); // no second grain named, either way
    expect(off.checks.ub).toBeUndefined(); // and nothing said of the UB
    expect(reply(step("ub_check", { fit: "both", symmetrised: false, orientation_change_deg: 0.01 }), UB_OFF).checks.ub).toBe("pass");
    // Most of the strongest beside the nodes: attention to the report, "no second grain" to the answer checks.
    expect(reply(BESIDE).checks.grain).toBe("pass");
  });

  it("D4: a symmetrised UB, a symmetric fit's turn and a recording's angle_deg are off to the answer checks, and no data problem to {{achieved}}", () => {
    for (const ub of [
      { fit: "symmetric", symmetrised: true, orientation_change_deg: 0 },
      { fit: "symmetric", symmetrised: false, orientation_change_deg: 0.3 },
      { angle_deg: 0.4 },
    ]) {
      const r = reply(step("ub_check", ub));
      expect(r.checks.ub, JSON.stringify(ub)).toBe("attention");
      expect(r.achieved?.dataProblems, JSON.stringify(ub)).toEqual([]);
    }
    // Where both read it turned.
    const turned = reply(step("ub_check", { fit: "both", symmetrised: false, orientation_change_deg: 0.05 }));
    expect([turned.checks.ub, turned.achieved?.dataProblems]).toEqual(["attention", ["the UB is turned by 0.05°"]]);
  });

  it("D5: sharp peaks on protected planes need attention in the punch's verdict, while its goal says they stay by design", () => {
    expect(D5_PROTECTED_SHARP_PEAKS_COUNT).toBe(true);
    expect(judge("punch", { leftover_at_nodes: 0, leftover_off_lattice_sharp: 3, leftover_on_protected_planes: 3 })).toMatchObject({ kind: "attention", reasons: ["sharp off-lattice"] });
    expect(WORDS.goal.punch).toMatch(/leftover_on_protected_planes of them sit on protected planes and stay by design/);
  });

  it("D6: at 1.04e-3 the coverage is too far, while the ΔPDF, shown 0.001, passes, and the tuning keeps the trial", () => {
    expect(D6_PDF_READS_ROUNDED_WEIGHT).toBe(true);
    const coverage = judge("coverage", { window_weight: 0.00104, window: "the ΔPDF's ellipsoid window", unit_cell: true, full_coverage_q: null, reach: null, reach_from: "", shell: 0.1, band_set: false, counts: { counts_end_inside_box: false } });
    expect(coverage).toMatchObject({ kind: "attention", reasons: ["window past limit"] });
    // The evaluation as tune/evaluate.ts writes it: two figures shown, the raw weight kept beside.
    const evaluation = { back_fft_pearson_r_even: 1, window_weight_on_unmeasured: 0.001, [UNROUNDED]: { window_weight_on_unmeasured: 0.00104 } };
    expect(judge("pdf", evaluation)).toMatchObject({ kind: "pass", reasons: ["window within limit"] });
    expect(outOfBounds("pdf", evaluation)).toBeNull();
  });

  it("D7: {{achieved}} reads a stage's newest result, even one not judged; the answer checks the newest that decides", () => {
    expect(D7_SELECTION).toEqual({ achieved: "newest", answer: "newest that decides" });
    const r = reply(assess("rings", { verdict: "needs attention", max_ring_left: 0.1, max_ring_dent: 0 }), assess("rings", { verdict: "not judged", max_ring_left: null }));
    expect(r.achieved?.stages.rings).toBe("info");
    expect(r.checks.rings).toBe("attention");
  });

  it("D8: the answer checks' backfill topic ignores the fill bias that {{achieved}} counts", () => {
    expect(D8_ANSWER_BACKFILL_IGNORES_TEXTURE).toBe(true);
    const r = reply(assess("backfill", { verdict: "meets its goal", mean_median_seam_sigma: 0.5 }), step("texture_check", { per_cut: [{ systematic_fill_bias: true }] }));
    expect(r.achieved?.attention).toEqual(["the backfill's texture"]);
    expect(r.checks.backfill).toBe("pass");
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

  it("D15: the ΔPDF's rule passes an evaluation that measured nothing, where every other stage's says nothing to judge", () => {
    expect(D15_PDF_PASSES_UNMEASURED).toBe(true);
    expect(judge("pdf", {})).toMatchObject({ kind: "pass", reasons: [] });
    expect(judge("rings", {})).toMatchObject({ kind: "info", reasons: ["nothing to judge"] });
  });

  it("D17: a repeated call's pointer reads as a result that holds nothing: {{achieved}} loses the verdict it points to, the answer checks keep it", () => {
    expect(D17_REPEAT_POINTER_READS_AS_A_RESULT).toBe(true);
    const pointer = step("qmax_coverage", { already_called: "Called with these arguments earlier in this reply (step 1); its result is above. Use it, or call with other arguments." });
    expect(reply(TOO_FAR).achieved?.attention).toEqual(["the ΔPDF window against the coverage"]);
    const r = reply(TOO_FAR, pointer);
    expect(r.achieved?.attention).toEqual([]);
    expect(r.checks.coverage).toBe("attention");
  });

  it("D16: a ub_check result without an angle reads as a right UB", () => {
    expect(D16_UB_UNMEASURED_READS_RIGHT).toBe(true);
    const r = reply(step("ub_check", { fit: "both", symmetrised: false }));
    expect(r.checks.ub).toBe("pass");
    expect(r.achieved?.dataProblems).toEqual([]);
  });
});
