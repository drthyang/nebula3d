// What the prompts say the checks judge (plan 1.6). A sentence that states a
// check's criterion is in the verdict module's own words (verdicts/rules.ts,
// metrics/flatten.ts), so it cannot drift from the verdict, and it is a
// definition, read with the skills on and off.

import { describe, expect, it } from "vitest";

import { PEDESTAL_LIMIT } from "../metrics/flatten";
import { SYSTEM, TOOLS } from "../prompts/system";
import { buildChatMessages, buildStageReviewMessages } from "../prompts/templates";
import { WORDS } from "../verdicts";
import { BACK_FFT_R_OK, EVEN_PART, FLATTEN_FLOOR_SIGMA_NOTE, FLOOR_SIGMA_WHY, PEDESTAL_SHELLS } from "../verdicts/rules";

/** A text with its line breaks and runs of spaces as one space, as the checks below read it. */
const flat = (text: string): string => text.replace(/\s+/g, " ");

/** The system prompt's checks: from their opening to the sentence after them. */
const checks = (text: string): string => flat(text.slice(text.search(/To judge a run|A run is judged on/), text.indexOf("On symmetrised data")));

/** A stage-review instruction, as the model reads it. */
const review = (stage: Parameters<typeof buildStageReviewMessages>[1], tools: boolean): string => {
  const messages = buildStageReviewMessages({} as never, stage, null, { tools });
  return String(messages[messages.length - 1].content);
};

describe("the prompts state what the checks judge, in the verdict module's words", () => {
  it("the flatten: the largest floor in σ reported, not judged; the pedestal over the outer half of the shells the counts reach (both arms)", () => {
    for (const text of [SYSTEM.whole, SYSTEM.definitions].map(flat)) {
      expect(text).toContain(`after_floor_max_sigma (the largest |shell floor| in robust σ) is ${FLATTEN_FLOOR_SIGMA_NOTE}, in the flatten's verdict: ${FLOOR_SIGMA_WHY}.`);
      expect(text).toContain(`over ${PEDESTAL_SHELLS} (floor_judged_q gives their |Q| range)`);
      expect(text).toContain(`a span both ${PEDESTAL_LIMIT} or more are a pedestal left`);
      expect(text).not.toMatch(/≲ 1 is flat|over the whole coverage|the σ test/);
    }
    // The criterion assess_stage returns says the same, from the same words.
    for (const words of [`${PEDESTAL_LIMIT} or more over ${PEDESTAL_SHELLS}`, `${FLATTEN_FLOOR_SIGMA_NOTE}: ${FLOOR_SIGMA_WHY}`]) {
      expect(WORDS.criterion.flatten).toContain(words);
    }
    // The flatten's review asks for what the verdict judges, not the floor in σ.
    for (const tools of [true, false]) {
      expect(review("flatten", tools)).toContain("(floor_after, floor_trend, floor_span_fraction)");
      expect(review("flatten", tools)).not.toContain("after_floor_max_sigma");
    }
  });

  it("the ΔPDF: the round trip against the data's even part, to its limit; r against the data lower by the odd part", () => {
    for (const text of [SYSTEM.whole, SYSTEM.definitions].map(flat)) {
      expect(text).toContain(`The transform keeps ${EVEN_PART}, so r against the data is lower by the odd part`);
      expect(text).toContain(`the ΔPDF's verdict judges the round trip against the even part instead, back_fft_pearson_r_even, to an r of ${BACK_FFT_R_OK} or more`);
      expect(text).not.toMatch(/r clearly below 1/);
    }
    // What a low round trip is evidence of is inference: arm B reads it, arm C does not.
    const evidence = `back_fft_pearson_r_even below ${BACK_FFT_R_OK} flags a transform, crop or band problem.`;
    expect(flat(SYSTEM.whole)).toContain(evidence);
    expect(flat(SYSTEM.definitions)).not.toContain(evidence);
    expect(WORDS.criterion.pdf).toContain(`${EVEN_PART}, to an r of ${BACK_FFT_R_OK} or more`);
    for (const tools of [true, false]) {
      expect(review("dpdf", tools)).toContain(`the ΔPDF's verdict judges it against ${EVEN_PART}, to an r of ${BACK_FFT_R_OK} or more; consistency_pearson_r is against the data`);
      expect(review("dpdf", tools)).not.toMatch(/trustworthy/);
    }
  });

  it("the rings: the readings the verdict reads, at the rings confirmed in 3D", () => {
    expect(checks(TOOLS.whole)).toContain("assess_stage rings (max_ring_left and max_ring_dent: a ring left over, or diffuse dented, at the rings confirmed in 3D)");
    expect(checks(TOOLS.whole)).not.toMatch(/ring-energy ratio/);
  });

  it("the criteria carry no note of who decided what, or when", () => {
    for (const [check, criterion] of Object.entries(WORDS.criterion)) {
      expect(criterion, check).not.toMatch(/\b20\d\d-\d\d-\d\d\b|provisional|user's choice/);
    }
  });

  it("the context is where the system prompt says: the first user message", () => {
    expect(flat(TOOLS.whole)).toContain("the diagnostic context in the first user message comes from");
    expect(TOOLS.whole).not.toMatch(/context above/);
    const opening = buildChatMessages({} as never, [], "How clean is this reduction?", null, { tools: true });
    expect(opening.findIndex((m) => m.role === "user")).toBe(1);
    expect(String(opening[1].content)).toMatch(/^Diagnostic context for this reduction/);
  });
});
