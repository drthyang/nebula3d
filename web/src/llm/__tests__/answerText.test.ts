// The one reader of an answer's words (answerText/): where its sentences and
// clauses split, the cues each holds and which opens it, whether it asks, and
// the numbers it writes, with their units and whether they sit in a vector.
// It decides nothing; the answer checks and the graders read it each by their
// own policy (answerTextPins.test.ts pins where those differ).

import { describe, expect, it } from "vitest";

import { clauses } from "../answerChecks";
import { CUES, readAnswer, sourceNumbers, writtenNumbers, type Cue } from "../answerText";

const GATE = { dashes: false, apostrophes: false };
const texts = (spans: readonly { text: string }[]): string[] => spans.map((s) => s.text);
const cuesOf = (text: string, options = {}): Cue[] => [...readAnswer(text, options).clauses[0].cues];

describe("the splits", () => {
  it("splits sentences at their ends and at lines, without Markdown emphasis", () => {
    expect(texts(readAnswer("The **ring** is left. Is it?\n- `0.41` of the diffuse").sentences)).toEqual(["The ring is left.", "Is it?", "- 0.41 of the diffuse"]);
  });

  it("splits claims at ; and :, without a leading Yes or No", () => {
    const read = readAnswer("No: the window reaches past the coverage; it should not. Yes, it is fine.", GATE);
    expect(texts(read.clauses)).toEqual(["the window reaches past the coverage", "it should not.", "it is fine."]);
    expect(read.sentences.map((s) => s.answer)).toEqual(["no", "yes"]);
    // The sentence keeps its answer word; its cues are read without it.
    expect(read.sentences[0].text).toBe("No: the window reaches past the coverage; it should not.");
    expect(read.sentences[0].cues.has("negation")).toBe(true); // "should not"
    expect(readAnswer("No, it is fine.").sentences[0].cues.has("negation")).toBe(false);
    expect(texts(readAnswer("No ring is left.").clauses)).toEqual(["No ring is left."]); // a determiner, not an answer
    expect(readAnswer("No ring is left.").sentences[0].answer).toBeNull();
  });

  it("keeps a short label with what follows its colon, and splits after a long one", () => {
    expect(texts(readAnswer("Ring removal: clean.").clauses)).toEqual(["Ring removal: clean."]);
    expect(texts(readAnswer("The ring check on hk0 finds: a ring at 2.2 Å⁻¹.").clauses)).toEqual(["The ring check on hk0 finds", "a ring at 2.2 Å⁻¹."]);
    // Three words or fewer before the first colon keep the whole sentence one clause.
    expect(texts(readAnswer("The UB check: fine: nothing changed.").clauses)).toEqual(["The UB check: fine: nothing changed."]);
  });

  it("splits at a spaced dash only when told to, the answer checks' reading not (W1)", () => {
    const text = "The UB is turned by 0.6° — no setting fixes it.";
    expect(texts(readAnswer(text).clauses)).toEqual(["The UB is turned by 0.6°", "no setting fixes it."]);
    expect(texts(readAnswer(text, { dashes: false }).clauses)).toEqual([text]);
    expect(texts(readAnswer("A 3D-ΔPDF – its window – stays inside.").clauses)).toEqual(["A 3D-ΔPDF", "its window", "stays inside."]);
    expect(texts(readAnswer("The 0.8–10 Å⁻¹ band.").clauses)).toEqual(["The 0.8–10 Å⁻¹ band."]); // an unspaced dash joins
  });

  it("reads as the answer checks read, with their options", () => {
    for (const text of ["No: the window reaches past the coverage; it should not. Yes, it is fine.", "Ring removal: clean — no ring left.", "If rings remain: raise the sectors; I will check."]) {
      expect(texts(readAnswer(text, GATE).clauses)).toEqual(clauses(text));
    }
  });
});

describe("the cues", () => {
  const cases: [Cue, string[], string[]][] = [
    ["negation", ["No ring is left.", "It is not turned.", "It never moved.", "It shouldn't.", "Nothing is left.", "It lacks a ring."], ["A notable ring.", "Nobody's ring.", "The knot holds."]],
    ["absence", ["The ring is nowhere.", "Too few orbits.", "Too weak to show a grain.", "The data are insufficient."], ["Too many orbits.", "Sufficient data."]],
    ["doubt", ["A ring is unlikely.", "I doubt a ring is there.", "Doubtful."], ["A likely ring."]],
    ["conditional", ["If rings remain, raise it.", "Check whether it is turned.", "Unless it is turned."], ["The rift is wide.", "Ifs and buts."]],
    ["plan", ["Let me check the rings.", "I will rerun it.", "I'll rerun it.", "I'd rerun it.", "I'm going to rerun it."], ["Let the ring be.", "I willingly ran it."]],
    ["modal", ["It would pass.", "It could be turned.", "It might be.", "It may be off."], ["Maybe.", "Couldron."]],
    ["sequence", ["Once it ends, look.", "Wait until it ends.", "Next, the punch."], ["The nexus.", "Oncer."]],
    ["purpose", ["I ran it to check the rings.", "Rerun to see it."], ["To checkpoint.", "To seed."]],
  ];
  for (const [cue, yes, no] of cases) {
    it(`${cue}: its words, and not words that only contain them`, () => {
      for (const t of yes) expect(cuesOf(t), t).toContain(cue);
      for (const t of no) expect(cuesOf(t), t).not.toContain(cue);
    });
  }

  it("names every class once", () => {
    expect([...CUES].sort()).toEqual(cases.map(([c]) => c).sort());
  });

  it("reads a curly apostrophe as a straight one only when told to", () => {
    expect(cuesOf("The UB isn’t turned.")).toContain("negation");
    expect(cuesOf("The UB isn’t turned.", { apostrophes: false })).not.toContain("negation");
    expect(cuesOf("I’ll rerun it.")).toContain("plan");
    expect(readAnswer("The UB isn’t turned.").clauses[0].text).toBe("The UB isn’t turned."); // the text as written
  });

  it("says which cue opens a span, after a bullet or a quote", () => {
    const opens = (t: string) => readAnswer(t).clauses[0].opens;
    expect(opens("If rings remain, raise the sectors.")).toBe("conditional");
    expect(opens("- “Whether it is turned is open.")).toBe("conditional");
    expect(opens("I will check whether the UB is turned.")).toBe("plan");
    expect(opens("Let me look.")).toBe("plan");
    expect(opens("No ring is left.")).toBe("negation");
    expect(opens("Next, the punch.")).toBe("sequence");
    expect(opens("The UB is turned if the fit is right.")).toBeNull();
    // After an answer word: the clause's own opening.
    expect(readAnswer("No, if it were turned we would see it.").clauses[0].opens).toBe("conditional");
  });

  it("says whether a span asks", () => {
    const read = readAnswer("Is the UB turned? The fit says so; is it right?");
    expect(read.sentences.map((s) => s.question)).toEqual([true, true]);
    expect(read.clauses.map((c) => c.question)).toEqual([true, false, true]);
  });
});

describe("the numbers", () => {
  it("reads numbers as written, not the digits inside names, exponents or list markers", () => {
    const n = writtenNumbers("1. On hk0 the 3D-ΔPDF at 6/mmm: a ring at 7.2 Å⁻¹, 4.1 × 10⁻⁶ of the weight, 12 %, 10⁻³, x_H on a 201x201x201 grid.");
    expect(n.map((x) => x.text)).toEqual(["7.2", "4.1e-6", "12 %", "1e-3"]);
    expect(n[0].tolerance).toBeCloseTo(0.05);
    expect(n[1].value).toBeCloseTo(4.1e-6);
  });

  it("says the unit written after a number", () => {
    const units = (t: string) => writtenNumbers(t).map((x) => [x.text, x.unit]);
    expect(units("Turned 0.6° and 0.2 deg, 1.5 degrees.")).toEqual([["0.6", "deg"], ["0.2", "deg"], ["1.5", "deg"]]);
    expect(units("Rings at 2.2 Å⁻¹, 3.1 Å^-1, 4.05 Å^{-1} and 6 1/Å.")).toEqual([["2.2", "inv_angstrom"], ["3.1", "inv_angstrom"], ["4.05", "inv_angstrom"], ["6", "inv_angstrom"]]);
    // An exponent written without its caret is read as a number, as it always was.
    expect(units("A ring at 5 Å−1.")).toEqual([["5", "inv_angstrom"], ["-1", null]]);
    expect(units("a = 3.9 Å, offset 0.03 r.l.u., 0.02 rlu, 12 %, 7 voxels.")).toEqual([["3.9", "angstrom"], ["0.03", "rlu"], ["0.02", "rlu"], ["12 %", "percent"], ["7", null]]);
    // Å⁻¹ leaves no number of its own, as before.
    expect(writtenNumbers("2.2 Å⁻¹ and Q²").map((x) => x.value)).toEqual([2.2]);
  });

  it("says whether a number is a component of a vector", () => {
    const inVector = (t: string) => writtenNumbers(t).map((x) => [x.value, x.inVector]);
    expect(inVector("Turned 0.6° about [1 1 0].")).toEqual([[0.6, false], [1, true], [1, true], [0, true]]);
    expect(inVector("Shifted by (0.03, 0.02, 0) r.l.u.")).toEqual([[0.03, true], [0.02, true], [0, true]]);
    expect(inVector("About [1, −0.03, −0.43], at ⟨½ ½ 0⟩.")).toEqual([[1, true], [-0.03, true], [-0.43, true], [0, true]]);
    expect(inVector("Six-fold (60°) at 0.02 (ub_check).")).toEqual([[60, false], [0.02, false]]);
  });

  it("reads the sources' numbers by sign, a range as two positive ones", () => {
    expect(sourceNumbers('{"x": -0.14, "band": "4-8 Å⁻¹", "w": 1.2e-3}')).toEqual({ all: [0.0012, 0.14, 4, 8], negative: [0.14], positive: [0.0012, 4, 8] });
  });

  it("reads each span's own numbers, and the answer's", () => {
    const read = readAnswer("The UB is turned by 0.6°; the origin is off by (0.03, 0.02, 0).");
    expect(read.clauses.map((c) => c.numbers.map((x) => x.value))).toEqual([[0.6], [0.03, 0.02, 0]]);
    expect(read.numbers.map((x) => x.text)).toEqual(["0.6", "0.03", "0.02", "0"]);
  });
});
