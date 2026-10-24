// Characterisation goldens of how an answer's words are read, taken before the
// answer checks and the graders shared one reader (plan 3.2): over the dev
// corpus (answerCorpus.ts: the canned dev answers, the scripted replays and
// the scenario records' answers), for each answer
//
// - the graders' grades on every dev case of the validation (its detection
//   checks, D, and its false-alarm checks, F, each a 1 or a 0 in their order)
//   and on its own scenario's checks, where it answered one;
// - the answer checks' reading of it (answerChecks.ts), as a digest: its
//   clauses, its verdicts by topic, its numbers as written, the success it
//   claims, the claims it makes against every check failing and every check
//   passing, and what it is sent back for with no evidence at all.
//
// Booleans and digests only: no answer's words or numbers are written here
// (the records were measured on the user's data), and dev cases only.
//
// Taken with `npx vitest run src/llm/evals/answerTextGoldens.test.ts` on a tree
// without the golden file. A diff here is a changed grade or reading: update
// it (-u after the file) only in a commit that means to change one, and say
// which entries moved and why.

import { describe, expect, it } from "vitest";

import { assess, COVERAGE, GRAIN, GRID_STAGES, labelled, STAGE_VARIANTS, step, SYMMETRY, TEXTURE, UB } from "../__tests__/verdictGrid";
import type { AgentStep } from "../agent";
import { answerIssues, clauses, contradictions, overallContradiction, verdictsIn, writtenNumbers } from "../answerChecks";
import { answerCorpus, CANNED_DEV_ANSWERS, RESULT_RECORDS } from "./answerCorpus";
import { exists, readText } from "./backend";
import { grade, type Check, type EvalRun } from "./harness";
import { SCENARIOS } from "./scenarios";
import { casesIn, detectionChecks, falseAlarmChecks, type ValidationCase } from "./validation";

const GOLDEN = "./__goldens__/answerText.json";

/** Every check on the run passing, and every one failing, as the verdict grid builds them (verdictGrid.ts). */
const EVERY_CHECK_PASSES: AgentStep[] = [
  assess(Object.fromEntries(GRID_STAGES.map((s) => [s, labelled(STAGE_VARIANTS[s][0])]))),
  step("qmax_coverage", COVERAGE[0].m),
  step("symmetry_check", SYMMETRY[0].m),
  step("texture_check", TEXTURE[0].m),
  step("grain_check", GRAIN[2].m),
  step("ub_check", UB[0].m),
];
const EVERY_CHECK_FAILS: AgentStep[] = [
  assess(Object.fromEntries(GRID_STAGES.map((s) => [s, labelled(STAGE_VARIANTS[s][1])]))),
  step("qmax_coverage", COVERAGE[1].m),
  step("symmetry_check", SYMMETRY[1].m),
  step("texture_check", TEXTURE[1].m),
  step("grain_check", GRAIN[0].m),
  step("ub_check", UB[2].m),
];

const ids = (topics: readonly { id: string }[]): string[] => topics.map((t) => t.id);

/**
 * The validation's dev cases, named as such: the dev split's, by its own ids.
 * The held-out test split is never graded here, whatever the opt-in.
 */
const devCases = (): ValidationCase[] => casesIn("dev").filter((c) => c.split === "dev" && c.id.startsWith("dev-"));

/**
 * A number as the digests keep it: to 12 significant digits. A written
 * number's value and tolerance are worked out with powers of ten, whose last
 * bit one JavaScript engine rounds otherwise than another (CI's Node and a
 * laptop's), and a digest must not see that.
 */
const canonical = (_key: string, v: unknown): unknown => (typeof v === "number" && Number.isFinite(v) ? Number(v.toPrecision(12)) : v);

/** The answer checks' reading of an answer: what the goldens keep a digest of. */
function gateReading(text: string): unknown {
  const issues = answerIssues(text, [], "");
  return {
    clauses: clauses(text),
    verdicts: [...verdictsIn(text)],
    numbers: writtenNumbers(text).map((n) => [n.text, n.value, n.tolerance, n.percent, n.signed]),
    overall: overallContradiction(text, null),
    againstFailing: ids(contradictions(text, EVERY_CHECK_FAILS)),
    againstPassing: ids(contradictions(text, EVERY_CHECK_PASSES)),
    sentBack: issues && {
      missing: ids(issues.missing),
      stale: ids(issues.stale),
      untraced: issues.untraced,
      contradicted: ids(issues.contradicted),
      unknownReferences: issues.unknownReferences,
      overall: issues.overall,
      said: issues.said,
      achieved: issues.achieved,
    },
  };
}

const bits = (checks: readonly Check[], run: EvalRun): string => checks.map((k) => (k.grade(run).pass ? "1" : "0")).join("");

/** A run's grades on a case: its detection checks (D) and its false-alarm checks (F), in their order. */
const gradesOn = (c: ValidationCase, run: EvalRun): string => `D ${bits(detectionChecks(c), run)} F ${bits(falseAlarmChecks(c), run)}`;

async function digest(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

/**
 * The digest of what the corpus grades: the dev cases, the scenarios and the
 * records it reads, and its counts. Pinned, so the corpus is the same with the
 * held-out opt-in (NEBULA_HOLDOUT_TESTS=1) and without it; a failure prints
 * two digests and names nothing.
 */
const CORPUS_LISTS = "6172c2c124560713";

/** Which kind of entry a golden's key is: by the kind alone, never the key. */
const kindOf = (key: string): string => {
  const [source, what = ""] = key.split(" | ");
  const from = source.startsWith("canned ") ? "canned" : source.startsWith("replay ") ? "replay" : source === "corpus" || source === "checks" ? source : "record";
  return `${from} ${what.startsWith("dev-") ? "dev case" : what.startsWith("scenario ") ? "scenario" : what}`.trim();
};

describe("an answer's words, as the graders and the answer checks read them before the shared reader", () => {
  it("grades the dev split's cases and the measured set's scenarios, the same with the held-out opt-in and without it", async () => {
    const corpus = await answerCorpus();
    const dev = devCases();
    expect(dev.length).toBe(casesIn("dev").length);
    expect(corpus.filter((a) => a.scenario && !SCENARIOS.includes(a.scenario)).length, "a corpus answer on a scenario not of the measured set").toBe(0);
    const lists = {
      cases: dev.map((c) => c.id),
      scenarios: [...new Set(corpus.flatMap((a) => (a.scenario ? [a.scenario.id] : [])))].sort(),
      records: [...RESULT_RECORDS],
      answers: corpus.length,
    };
    expect(await digest(JSON.stringify(lists))).toBe(CORPUS_LISTS);
  });

  it("reproduce the goldens over the dev corpus", async () => {
    const corpus = await answerCorpus();
    const dev = devCases();
    const fromRecords = corpus.filter((a) => a.scenario && !a.id.startsWith("replay "));
    const fromReplays = corpus.filter((a) => a.id.startsWith("replay "));
    // The corpus as the brief names it: every canned dev answer, a good and a bad replay per scenario, 121 record answers.
    expect([corpus.length - fromRecords.length - fromReplays.length, fromReplays.length, fromRecords.length]).toEqual([CANNED_DEV_ANSWERS.length, 24, 121]);

    const entries: [string, string][] = [["corpus", `${CANNED_DEV_ANSWERS.length} canned, ${fromReplays.length} replayed, ${fromRecords.length} recorded`]];
    for (const c of dev) {
      entries.push([`checks | ${c.id}`, await digest(JSON.stringify([detectionChecks(c).map((k) => k.name), falseAlarmChecks(c).map((k) => k.name)]))]);
    }
    for (const a of corpus) {
      entries.push([`${a.id} | answer`, await digest(a.text)]);
      entries.push([`${a.id} | gate`, await digest(JSON.stringify(gateReading(a.text), canonical))]);
      for (const c of dev) entries.push([`${a.id} | ${c.id}`, gradesOn(c, a.run)]);
      if (a.scenario) entries.push([`${a.id} | scenario ${a.scenario.id}`, grade(a.scenario, a.run).grades.map((g) => (g.pass ? "1" : "0")).join("")]);
    }
    const keys = entries.map(([k]) => k);
    expect(new Set(keys).size, "every entry named once").toBe(keys.length);
    const text = `{\n${entries.map(([k, v]) => ` ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n")}\n}\n`;
    // Dev cases only, checked by count: a failure names no held-out case.
    expect(casesIn("test").filter((c) => text.includes(c.id) || text.includes(c.label)).length, "the goldens name a test case").toBe(0);
    expect(dev.filter((c) => text.includes(` | ${c.id}"`)).length).toBe(dev.length);
    // Where the goldens moved, which kinds of entry, by count alone: it names no entry and no value.
    const golden = new URL(GOLDEN, import.meta.url);
    if (await exists(golden)) {
      const kept = JSON.parse(await readText(golden)) as Record<string, string>;
      const moved: Record<string, number> = {};
      for (const [k, v] of entries) if (kept[k] !== v) moved[kindOf(k)] = (moved[kindOf(k)] ?? 0) + 1;
      if (Object.keys(moved).length) console.log(`the goldens moved, by kind of entry: ${JSON.stringify(moved)}`);
    }
    await expect(text).toMatchFileSnapshot(GOLDEN);
  });
});
