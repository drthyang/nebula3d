// Characterisation goldens of how an answer's words are read, taken before the
// answer checks and the graders shared one reader (plan 3.2) and kept since:
// the answer checks' reading never moved, and the graders' moved where the
// commits that gave them the shared reader's rules say. Over the dev corpus
// (answerCorpus.ts: the canned dev answers, the scripted replays and the
// scenario records' answers), for each answer
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
import { answerIssues, clauses, contradictions, overallContradiction, verdictsIn } from "../answerChecks";
import { writtenNumbers } from "../answerText";
import { answerCorpus, CANNED_DEV_ANSWERS } from "./answerCorpus";
import { grade, type Check, type EvalRun } from "./harness";
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

describe("an answer's words, as the graders and the answer checks read them", () => {
  it("reproduce the goldens over the dev corpus", async () => {
    const corpus = await answerCorpus();
    const dev = casesIn("dev");
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
      entries.push([`${a.id} | gate`, await digest(JSON.stringify(gateReading(a.text)))]);
      for (const c of dev) entries.push([`${a.id} | ${c.id}`, gradesOn(c, a.run)]);
      if (a.scenario) entries.push([`${a.id} | scenario ${a.scenario.id}`, grade(a.scenario, a.run).grades.map((g) => (g.pass ? "1" : "0")).join("")]);
    }
    const keys = entries.map(([k]) => k);
    expect(new Set(keys).size, "every entry named once").toBe(keys.length);
    const text = `{\n${entries.map(([k, v]) => ` ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n")}\n}\n`;
    // Dev cases only, checked by count: a failure names no held-out case.
    expect(casesIn("test").filter((c) => text.includes(c.id) || text.includes(c.label)).length, "the goldens name a test case").toBe(0);
    expect(dev.filter((c) => text.includes(` | ${c.id}"`)).length).toBe(dev.length);
    await expect(text).toMatchFileSnapshot(GOLDEN);
  });
});
