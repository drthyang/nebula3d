// The witness (witness.ts): the graders' second reading of an answer's words,
// apart from the reader. It reads as the graders read before the shared
// reader, and it imports nothing; the graders import nothing of the app's
// verdicts or of the answer checks.

import { describe, expect, it } from "vitest";

import { answerCorpus, type CorpusAnswer } from "./answerCorpus";
import { readText } from "./backend";
import { READERS, sharedReader, type Dispute, type GradedAnswer, type GraderReader, type Readers } from "./graderReading";
import { grade } from "./harness";
import { casesIn, gradeRun } from "./validation";
import { witness } from "./witness";

/**
 * The disputes the dev corpus raises, declared: each answer of it (answerCorpus.ts)
 * graded on every dev case and on its own scenario's checks. None: where one
 * appears, read the answer, find which reader misread it, and fix that one.
 */
const DECLARED_DISPUTES: readonly string[] = [];

/** Every dispute the corpus raises read by *readers*, as "answer | case or scenario | check". */
function disputesOver(corpus: readonly CorpusAnswer[], readers: Readers = READERS): string[] {
  const out: string[] = [];
  const add = (where: string, ds: readonly Dispute[]) => out.push(...ds.map((d) => `${where} | ${d.check}`));
  for (const a of corpus) {
    for (const c of casesIn("dev")) add(`${a.id} | ${c.id}`, gradeRun(c, a.run, [], readers).disputes ?? []);
    // The scenarios' checks read with the readers they were built with (READERS).
    if (readers === READERS && a.scenario) add(`${a.id} | ${a.scenario.id}`, grade(a.scenario, a.run).grades.flatMap((g) => (g.dispute ? [g.dispute] : [])));
  }
  return out;
}

/** The false-alarm checks over the corpus read by *readers*: how many failed, and the disputes among them. */
function alarmsOver(corpus: readonly CorpusAnswer[], readers: Readers): { failed: number; disputes: Dispute[] } {
  const grades = corpus.flatMap((a) => casesIn("dev").flatMap((c) => gradeRun(c, a.run, [], readers).falseAlarms));
  return { failed: grades.filter((g) => !g.pass).length, disputes: grades.flatMap((g) => (g.dispute ? [g.dispute] : [])) };
}

/** A shared reader planted with a fault: each of its spans as *mark* reads it, its clauses re-cut by *cut*. */
function planted(mark: (s: GradedAnswer["clauses"][number]) => GradedAnswer["clauses"][number], cut?: (clause: string) => string[]): GraderReader {
  return (answer) => {
    const read = sharedReader(answer);
    const clauses = cut ? read.clauses.flatMap((c) => cut(c.text).flatMap((piece) => sharedReader(piece).clauses)) : read.clauses;
    return { ...read, sentences: read.sentences.map(mark), clauses: clauses.map(mark) };
  };
}

describe("the disputes over the dev corpus", () => {
  it("are the declared ones", async () => {
    expect(disputesOver(await answerCorpus())).toEqual(DECLARED_DISPUTES);
  });
});

describe("the witness catches a shared reader that misreads", () => {
  // Planted controls: shared readers with a fault planted in them, over the
  // dev corpus and two answers that raise a fault in a clause commas cut
  // into pieces; the witness as it is.
  const withShared = (shared: GraderReader): Readers => ({ shared, witness: READERS.witness });
  const asRun = (id: string, text: string): CorpusAnswer => ({ id, text, run: { scenario: id, steps: [], content: text, latencyMs: 0, usage: null }, scenario: null });
  const answers = async (): Promise<CorpusAnswer[]> => [
    ...(await answerCorpus()),
    asRun("planted 1", "The UB, as fitted, is wrong by 1°."),
    asRun("planted 2", "Powder rings, as the ring check found, are present at 2.2 Å⁻¹."),
  ];
  const ALARM = /^never (claims|calls)/;

  it("one that reads “the” as a negator passes alarms the witness raises: alarm disputes", async () => {
    const { disputes } = alarmsOver(await answers(), withShared(planted((s) => ({ ...s, negated: s.negated || /\bthe\b/i.test(s.text) }))));
    expect(disputes.length).toBeGreaterThan(0);
    expect(disputes.filter((d) => !ALARM.test(d.check))).toEqual([]);
  });

  it("one that splits a clause at every comma passes alarms the witness raises: alarm disputes", async () => {
    const { disputes } = alarmsOver(await answers(), withShared(planted((s) => s, (clause) => clause.split(/,\s*/))));
    expect(disputes.length).toBeGreaterThan(0);
    expect(disputes.filter((d) => !ALARM.test(d.check))).toEqual([]);
  });

  it("one that misses negators raises false alarms the witness does not: failures, not disputes", async () => {
    const all = await answers();
    const blind = alarmsOver(all, withShared(planted((s) => ({ ...s, negated: false }))));
    expect(blind.failed).toBeGreaterThan(alarmsOver(all, READERS).failed);
    expect(blind.disputes).toEqual([]);
  });

  it("the real shared reader raises no dispute on the planted answers", async () => {
    expect(alarmsOver(await answers(), READERS).disputes).toEqual([]);
  });
});

/** The modules a source imports or re-exports from, as written: type-only, side-effect and dynamic imports included. */
const importsOf = (source: string): string[] =>
  [...source.matchAll(/\b(?:import|export)\b[^;'"]*?\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|^\s*import\s*["']([^"']+)["']/gm)].map((m) => m[1] ?? m[2] ?? m[3]);
/** The app's verdict module and the answer checks: what the graders must not read. */
const fromTheApp = (spec: string): boolean => /^\.\.\/(verdicts|answerChecks)(\/|\.ts$|$)/.test(spec);

describe("the import scans", () => {
  it("find every kind of import in a planted source", () => {
    const planted = [
      'import type { ComputedVerdict } from "../verdicts";',
      "import {\n  UB_TURNED,\n} from '../verdicts/rules';",
      'export { verdicts } from "../verdicts/readers";',
      'const later = await import("../answerChecks");',
      'import "../answerChecks";',
      'import { seen } from "../readings";',
    ].join("\n");
    expect(importsOf(planted).filter(fromTheApp)).toHaveLength(5);
    expect(importsOf(planted)).toContain("../readings");
  });

  for (const file of ["checks.ts", "validation.ts", "graderReading.ts", "witness.ts"]) {
    it(`${file} imports nothing of the app's verdicts or of the answer checks`, async () => {
      const source = await readText(new URL(`./${file}`, import.meta.url));
      expect(importsOf(source).filter(fromTheApp)).toEqual([]);
    });
  }

  it("witness.ts imports nothing at all", async () => {
    const source = await readText(new URL("./witness.ts", import.meta.url));
    expect(importsOf(source)).toEqual([]);
    expect(source).not.toMatch(/\brequire\s*\(/);
  });
});

describe("the witness's reading", () => {
  const texts = (spans: { text: string }[]) => spans.map((s) => s.text);

  it("splits sentences at their ends and at lines, without Markdown emphasis", () => {
    expect(texts(witness("The **ring** is left. Is it?\n- `0.41` of the diffuse").sentences)).toEqual(["The ring is left.", "Is it?", "- 0.41 of the diffuse"]);
  });

  it("splits clauses at a semicolon and at a spaced dash", () => {
    expect(texts(witness("The UB is turned by 0.6°; no setting fixes it — re-index.").clauses)).toEqual(["The UB is turned by 0.6°", "no setting fixes it", "re-index."]);
  });

  it("negates on a negation or an absence, not on a leading answer word", () => {
    expect(witness("No ring is left.").sentences[0].negated).toBe(true);
    expect(witness("Too few orbits to show a second grain.").sentences[0].negated).toBe(true);
    expect(witness("No, a ring is left at 7.2 Å⁻¹.").sentences[0].negated).toBe(false);
    expect(witness("No, a ring is left at 7.2 Å⁻¹.").clauses[0].negated).toBe(false);
  });

  it("takes a sentence's answer word off its clauses, and keeps it in the sentence", () => {
    const read = witness("No: the window reaches past the coverage; it should not. Yes — it is fine.");
    expect(texts(read.clauses)).toEqual(["the window reaches past the coverage", "it should not.", "it is fine."]);
    expect(read.sentences[0].text).toBe("No: the window reaches past the coverage; it should not.");
    // Only a sentence's own: after a semicolon, "no" negates.
    expect(witness("The rings were checked; no, a ring is left.").clauses.map((c) => c.negated)).toEqual([false, true]);
  });

  it("cuts a clause at a colon after a label of more than three words, not after a shorter one", () => {
    expect(texts(witness("The UB is not the problem: the HKL origin is shifted.").clauses)).toEqual(["The UB is not the problem", "the HKL origin is shifted."]);
    expect(texts(witness("Ring removal: clean.").clauses)).toEqual(["Ring removal: clean."]);
  });

  it("reads a curly apostrophe as a straight one", () => {
    expect(witness("The UB isn’t turned.").clauses[0].negated).toBe(true);
  });

  it("knows a question by its question mark", () => {
    expect(witness("Is the UB turned? It is; is it right?").clauses.map((c) => c.question)).toEqual([true, false, true]);
  });

  it("knows a span a condition or a plan opens, and not one a hedge comes later in", () => {
    const tentative = (t: string) => witness(t).clauses[0].tentative;
    expect(["If the UB is turned, re-index.", "- Whether it is turned is open.", "I will check the UB.", "I’ll check the UB.", "Let me check.", "No, if it were turned we would see it."].map(tentative)).toEqual([true, true, true, true, true, true]);
    expect(["The UB is turned if the fit is right.", "Next, the UB.", "Ifs remain."].map(tentative)).toEqual([false, false, false]);
  });

  it("reads numbers however a model writes them", () => {
    expect(witness("0.41, 3.2e-6, 3.2 × 10⁻⁶, 3.2 x 10^-6, $3.2 \\times 10^{-6}$, 12 %").numbers).toEqual([0.41, 3.2e-6, 3.2e-6, 3.2e-6, 3.2e-6, 12]);
  });

  it("reads a range as two numbers, and a sign only where nothing precedes it", () => {
    expect(witness("the band 0.8-10 Å⁻¹").numbers).toEqual([0.8, 10, -1]); // the unit's exponent reads as −1; quotes look for a match, not every number
    expect(witness("a dent of -0.23").numbers).toContain(-0.23);
  });

  it("reads no number glued to a letter, a power of ten as one number, and a thousands separator as none", () => {
    expect(witness("On hk0 the 3D-ΔPDF, a 201x201 grid, 10⁻³ and 4,190 peaks.").numbers).toEqual([0.001, 4190]);
  });

  it("reads a span's angles from its degrees, else from its bare numbers outside brackets", () => {
    const angles = (t: string) => witness(t).clauses[0].angles;
    expect(angles("Turned 0.002° about [1 1 0].")).toEqual([0.002]);
    expect(angles("Turned $0.6^\\circ$ and 0.2 deg.")).toEqual([0.6, 0.2]);
    expect(angles("Turned 0.002 about [1 1 0], 3 % of a voxel, 0.1 Å⁻¹ off.")).toEqual([0.002]);
    expect(angles("Turned about (1, 1, 0).")).toEqual([]);
  });
});
