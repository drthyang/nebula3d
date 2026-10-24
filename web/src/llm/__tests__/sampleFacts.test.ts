// The facts about the sample (tune/catalog.ts, SAMPLE_PARAMS) and the words
// that name each in the user's latest message (namesSampleFact): what
// update_settings' gate reads before it changes one. Each list is
// conservative: a false refusal costs the user one question, a false accept
// defeats the rule. What every audit talks about names no fact, and the app's
// own instructions (the validation's task, the stage reviews) name none.

import { describe, expect, it } from "vitest";

import { armSetup, TASK } from "../evals/validation";
import { lastQuestion } from "../localTools";
import { buildStageReviewMessages, type ReviewStage } from "../prompts/templates";
import { isSampleFact, namesRegrid, namesSampleFact, REGRID_REFUSED, regridRefusal, SAMPLE_PARAMS, sampleFactRefusal } from "../tune/catalog";

/** The facts a message names, in the catalog's order. */
const named = (message: string): string[] => SAMPLE_PARAMS.filter((p) => namesSampleFact(message, p.key)).map((p) => p.key);

const CELL = ["punchSupercellH", "punchSupercellK", "punchSupercellL"];
const PLANES = ["punchProtectH"];
const WIDTH = ["punchProtectHalfWidth"];

describe("the facts about the sample", () => {
  it("are the search's protected planes and the punch cell: the magnetic ion is none, update_settings cannot change it", () => {
    expect(SAMPLE_PARAMS.map((p) => p.key)).toEqual(["punchProtectH", "punchProtectHalfWidth", ...CELL]);
    expect(isSampleFact("flattenIon")).toBe(false);
    expect(isSampleFact("punchMinSig")).toBe(false);
    for (const p of SAMPLE_PARAMS) {
      expect(isSampleFact(p.key)).toBe(true);
      expect(p.names.length, p.key).toBeGreaterThan(0);
    }
  });

  it("are refused in words that name the setting and what to do, and nothing else", () => {
    expect(sampleFactRefusal("punchSupercellH")).toBe(
      "punchSupercellH is a fact about the sample, which only the user sets: ask the user, and change it once they name it.",
    );
  });
});

describe("the words that name a fact about the sample", () => {
  // [the user's latest message, the facts it names]
  const KNOWN: [string, string[]][] = [
    // The punch cell: the words name the cell, all three axes.
    ["The volume is indexed on a doubled cell along H: set the punch cell to 2 along H.", CELL],
    ["Use a 2×2×1 supercell for the punch.", CELL],
    ["Set Supercell H to 2.", CELL], // the Configure page's label
    ["The cell is doubled along H and K.", CELL],
    ["Index the punch on a super-cell.", CELL],
    ["Set the punch's indexing cell back to 1.", CELL],
    // Its key names that axis alone.
    ["Set punchSupercellK to 2.", ["punchSupercellK"]],
    // The search's protected planes.
    ["The satellites at H = n ± 1/2 are real: protect the H = 0.5 planes.", PLANES],
    ["Turn off the protected planes.", PLANES],
    ["Don't protect any planes.", PLANES],
    ["Set the H fractions to 1/2.", PLANES],
    ["The search skips H = 1/3 and 2/3; make it skip none.", PLANES], // the Configure page's "Search skips H"
    ["Set punchProtectH to none.", PLANES],
    // Their half width: a width, beside the words for the planes.
    ["Widen the protected planes to 0.1 r.l.u.", [...PLANES, ...WIDTH]],
    ["Set the half width of the protected H planes to 0.05.", [...PLANES, ...WIDTH]],
    ["Set punchProtectHalfWidth to 0.05.", WIDTH],
    // What every audit talks about names no fact.
    ["Are there satellites at H = n ± 1/3?", []],
    ["Does the volume show superlattice peaks, or a lower symmetry?", []],
    ["What is the unit cell? Is it hexagonal?", []],
    ["Show the HK0 plane and the H0L plane.", []],
    ["Is the punch clean? Raise the punch significance to 6.", []],
    ["Make the punch footprint profile, and protect the diffuse maxima.", []],
    ["The modulation is q = (1/3, 0, 0).", []],
    ["Use Tb3+ for the flatten.", []], // the magnetic ion: no fact update_settings sets
    ["Yes, do it.", []], // a bare yes names nothing: the user says which
    ["", []],
  ];

  it.each(KNOWN)("“%s” names %j", (message, facts) => {
    expect(named(message)).toEqual(facts);
  });

  it("reads names, not intent: a question that names a fact names it", () => {
    expect(named("Is the punch cell right?")).toEqual(CELL);
    expect(named("Why are the 1/3 planes protected?")).toEqual(PLANES);
  });

  it("names no fact by a setting that is none", () => {
    expect(namesSampleFact("Set punchMinSig to 6.", "punchMinSig")).toBe(false);
    expect(namesSampleFact("Use Tb3+ for the flatten.", "flattenIon")).toBe(false);
  });

  it("finds none in the app's own instructions: the validation's task and each stage review", () => {
    // The validation's task is the user's latest message in every run of arms B and C.
    expect(lastQuestion(armSetup("C", {} as never).messages)).toBe(TASK);
    expect(named(TASK)).toEqual([]);
    const stages: ReviewStage[] = ["rings", "punch", "backfill", "flatten", "dpdf"];
    for (const stage of stages) {
      for (const tools of [true, false]) {
        const review = lastQuestion(buildStageReviewMessages({} as never, stage, null, { tools }));
        expect(review.length, stage).toBeGreaterThan(0);
        expect(named(review), `${stage} review${tools ? " with tools" : ""}`).toEqual([]);
      }
    }
    // Why "satellites" names nothing: the punch review asks about them in every review of the punch.
    expect(lastQuestion(buildStageReviewMessages({} as never, "punch", null, { tools: true }))).toMatch(/\bsatellites\b/);
  });
});

// The same gate for the regrid onto the refined UB (regrid_refined_ub), which
// writes a new dataset: it runs only when the user's latest message names a
// regrid (namesRegrid), and is refused otherwise in the tool's own words.
describe("the words that ask for a regrid", () => {
  // [the user's latest message, whether it asks for a regrid]
  const KNOWN: [string, boolean][] = [
    ["Regrid the volume onto the refined UB.", true],
    ["Please re-grid the raw data.", true],
    ["The UB is turned: write a regridded copy.", true],
    ["Go ahead with the regridding.", true],
    ["Run regrid_refined_ub.", true],
    ["Run examples/refine_ub.py on it.", true],
    // A question that names it names it: the gate reads names, not intent.
    ["Should I regrid?", true],
    // What a UB question says names no regrid: the UB check refines the UB and writes nothing.
    ["Is the UB right?", false],
    ["Refine the UB and tell me the turn.", false],
    ["The grid is coarse; is the punch on the grid nodes?", false],
    ["Yes, do it.", false], // a bare yes names nothing: the user says which
    ["", false],
  ];

  it.each(KNOWN)("“%s” asks for one: %s", (message, asks) => {
    expect(namesRegrid(message)).toBe(asks);
  });

  it("finds none in the app's own instructions: the validation's task and each stage review", () => {
    expect(namesRegrid(TASK)).toBe(false);
    const stages: ReviewStage[] = ["rings", "punch", "backfill", "flatten", "dpdf"];
    for (const stage of stages) {
      for (const tools of [true, false]) {
        expect(namesRegrid(lastQuestion(buildStageReviewMessages({} as never, stage, null, { tools }))), stage).toBe(false);
      }
    }
  });

  it("is refused in words that say what it does and what to do, and nothing else", () => {
    expect(regridRefusal()).toBe("A regrid writes a new dataset, which only the user asks for: nothing was written. Ask the user, and regrid once they ask for it.");
    expect(regridRefusal()).toContain(REGRID_REFUSED);
  });
});
