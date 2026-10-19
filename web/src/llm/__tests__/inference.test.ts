// The text the model reads, by class (inference.ts): a definition stays with the
// skills off, an inference goes. Written once, a text renders whole byte for
// byte; without its inference, the spaces left are tidied; every span written
// is listed where it is written.

import { describe, expect, it } from "vitest";

import { built, connective, evidence, inference, joined, quotedInference, reading, remedy, Tagged, withoutInference, writtenInferences, written } from "../inference";

describe("a text tagged by class", () => {
  const t = written("inference.test.ts: a sample")`ring_energy_ratio = after/before${evidence("; lower is cleaner")}. Its
floor is not 0${reading(", so compare it across cuts")}.${remedy(" Refine the UB.")}
Next line.`;

  it("renders whole as written, and without its inference with the spaces it leaves tidied", () => {
    expect(t.whole).toBe("ring_energy_ratio = after/before; lower is cleaner. Its\nfloor is not 0, so compare it across cuts. Refine the UB.\nNext line.");
    expect(t.definitions).toBe("ring_energy_ratio = after/before. Its\nfloor is not 0.\nNext line.");
    expect(t.text(true)).toBe(t.whole);
    expect(t.text(false)).toBe(t.definitions);
    expect(t.marked).toBe("ring_energy_ratio = after/before⟦; lower is cleaner⟧. Its\nfloor is not 0⟦, so compare it across cuts⟧.⟦ Refine the UB.⟧\nNext line.");
    expect(t.inferences.map((s) => s.kind)).toEqual(["evidence", "reading", "remedy"]);
  });

  it("leaves a text with no inference as it is, either way", () => {
    const plain = written("inference.test.ts: a plain one")`A  text  with  spaces kept .`;
    expect(plain.hasInference).toBe(false);
    expect(plain.definitions).toBe(plain.whole);
  });

  it("lists every span written, where, and the text it sits in", () => {
    const mine = writtenInferences().filter((e) => e.source === "inference.test.ts: a sample");
    expect(mine.map((e) => e.span.text)).toEqual(["; lower is cleaner", ", so compare it across cuts", " Refine the UB."]);
    expect(mine.every((e) => e.in === t)).toBe(true);
  });

  it("builds a text for each call from constants written once, which are listed", () => {
    const REFINE = inference("inference.test.ts: a verdict", "remedy", "; refine the UB");
    const words = (deg: number) => built`one rotation of ${deg}° puts them back${REFINE}`;
    expect(words(0.6).whole).toBe("one rotation of 0.6° puts them back; refine the UB");
    expect(words(0.6).definitions).toBe("one rotation of 0.6° puts them back");
    expect(writtenInferences().filter((e) => e.source === "inference.test.ts: a verdict").map((e) => e.span.text)).toEqual(["; refine the UB"]);
    // Joined: parts with a separator, the spans of each kept.
    const j = joined(["The fit removed little.", words(1.5)], " ");
    expect(j).toBeInstanceOf(Tagged);
    expect([j.whole, j.definitions]).toEqual(["The fit removed little. one rotation of 1.5° puts them back; refine the UB", "The fit removed little. one rotation of 1.5° puts them back"]);
  });

  it("gives the definitions the connective they need where an inference span is left out, and the whole text none of it", () => {
    const t = written("inference.test.ts: connectives")`broad (n_broad) leftovers${evidence(" are diffuse maxima")}${connective("", " are counted on their own")}. mean is the offset${evidence(
      ": a shifted origin moves every peak by one vector",
    )} (shift, when ${connective("that vector", "its value after the fit")} makes most of it).`;
    expect(t.whole).toBe("broad (n_broad) leftovers are diffuse maxima. mean is the offset: a shifted origin moves every peak by one vector (shift, when that vector makes most of it).");
    expect(t.definitions).toBe("broad (n_broad) leftovers are counted on their own. mean is the offset (shift, when its value after the fit makes most of it).");
    expect(t.marked).toBe(
      "broad (n_broad) leftovers⟦ are diffuse maxima⟧⟨ →  are counted on their own⟩. mean is the offset⟦: a shifted origin moves every peak by one vector⟧ (shift, when ⟨that vector → its value after the fit⟩ makes most of it).",
    );
    expect(t.connectives).toHaveLength(2);
    expect(t.inferences.map((s) => s.text)).toEqual([" are diffuse maxima", ": a shifted origin moves every peak by one vector"]); // a connective is no inference
    // Without inference beside it a connective changes nothing: the text is whole either way.
    const alone = written("inference.test.ts: a lone connective")`a${connective(" b", " c")}`;
    expect([alone.whole, alone.definitions]).toEqual(["a b", "a b"]);
  });

  it("renders a JSON value's strings written once without their inference, and leaves the rest", () => {
    const result = { reading: t.whole, other: "as is", list: [t.whole, 3], nested: { deep: t.whole }, n: 2, none: null };
    expect(withoutInference(result)).toEqual({ reading: t.definitions, other: "as is", list: [t.definitions, 3], nested: { deep: t.definitions }, n: 2, none: null });
    expect(withoutInference(`${t.whole} and more`)).toBe(`${t.whole} and more`); // only a whole text, never a part
  });

  it("leaves a span the backend quotes out of any string that holds it, wherever it stands, and lists it (quotedInference)", () => {
    const span = quotedInference("inference.test.ts: a quoted span", "remedy", " Try a finer grid.");
    const line = "3 shells not confirmed; not subtracted. Try a finer grid.";
    expect(withoutInference({ lines: [{ message: line }], n: 3, other: "no span here" })).toEqual({
      lines: [{ message: "3 shells not confirmed; not subtracted." }],
      n: 3,
      other: "no span here",
    });
    expect(withoutInference(`${line} ${line}`)).toBe("3 shells not confirmed; not subtracted. 3 shells not confirmed; not subtracted.");
    // Whole with the skills on: nothing renders it but the switch.
    expect(span.text).toBe(" Try a finer grid.");
    expect(writtenInferences().filter((e) => e.source === "inference.test.ts: a quoted span")).toEqual([{ source: "inference.test.ts: a quoted span", span }]);
  });
});
