// Eval records and fixtures are committed, so they must name no sample.  A
// dataset id starts with its sample (state/configMemory.ts sampleOf), and
// where that sample is written as a chemical formula it is replaced, wherever
// it appears (ids, file names, tool results, answers, in any case), by a
// neutral label: sampleA, sampleB, … in alphabetical order of the formulas.
// Names that are not formulas ("demo") are left as they are.

import { sampleOf } from "../../state/configMemory";

// Two or more element-like groups, each a capital, an optional small letter
// and an optional count: "Ab2Cd3", "EfGh4".
const FORMULA = /^(?:[A-Z][a-z]?(?:\d+(?:\.\d+)?)?){2,}$/;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function sampleScrubber(datasets: { id: string }[]): (text: string) => string {
  const samples = [...new Set(datasets.map((d) => sampleOf(d.id)).filter((s) => FORMULA.test(s)).map((s) => s.toLowerCase()))].sort();
  if (!samples.length) return (text) => text;
  const label = new Map(samples.map((s, i) => [s, `sample${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ""}`]));
  // Longest first, so a formula that contains another is replaced whole; never
  // inside a longer word.
  const re = new RegExp(`(?<![a-z])(?:${[...samples].sort((a, b) => b.length - a.length).map(escape).join("|")})(?![a-z])`, "gi");
  return (text) => text.replace(re, (m) => label.get(m.toLowerCase()) ?? m);
}
