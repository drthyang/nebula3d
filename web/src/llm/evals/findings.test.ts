// The findings schema and a run's offline transcript, without a model.

import { describe, expect, it } from "vitest";

import type { AgentStep } from "../agent";
import { regridRefusal } from "../tune/catalog";
import {
  APPROVAL_BY_DEFAULT,
  candidateFindings,
  finding,
  findingProblems,
  FINDING_KINDS,
  FINDING_SOURCES,
  isReviewFinding,
  isValidationFinding,
  renderTranscript,
  sourceOf,
  type Finding,
  type ReviewFinding,
} from "./findings";
import { caseNamed, decisions, numberSources, type RunRecord } from "./validation";
import { BY_REF, loadReviewFindings, NUMBERED, REVIEW_FINDINGS_DIR, reviewFindingFiles } from "./reviewFindings";

// *o* without the fields *keys*.
const without = (o: object, ...keys: string[]): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

const record = (over: Partial<RunRecord> = {}): RunRecord => ({
  schema: "nebula3d-validation-run/1",
  case: "dev-ub",
  family: "ub",
  split: "dev",
  arm: "B",
  run: 2,
  dataset: "v000001-B2",
  stem: "v000001_B2",
  model: { key: "m", label: "model m", provider: "LM Studio", model: "m", local: true },
  task: "the task",
  max_rounds: 12,
  started: "2026-10-14T00:00:00Z",
  latency_ms: 61000,
  usage: { input: 1000, output: 200, requests: 3 },
  cost_usd: null,
  tool_offers: [
    { request: 1, tools: ["read_skill", "describe_dataset", "assess_stage"] },
    { request: 2, tools: ["read_skill", "describe_dataset", "assess_stage", "ub_check"] },
  ],
  decisions: [
    { step: 1, tool: "describe_dataset", args: {}, why: "I look first.", status: "done", summary: "ok", result: '{"cell":{"a":3.9}}' },
    { step: 2, tool: "ub_check", args: {}, why: "", status: "done", summary: "angle", result: '{"angle_deg":0.61}' },
  ],
  numbers: [{ text: "0.61", value: 0.61, source: { step: 2, tool: "ub_check", path: "angle_deg", value: 0.61 } }],
  conclusion: "The UB is turned by 0.61°.",
  note: null,
  error: null,
  failure: null,
  grades: { detection: [], falseAlarms: [], unsafe: [], detected: true, noFalseAlarm: true },
  ...over,
});

describe("the findings schema", () => {
  const good: Finding = { case: "dev-ub", run: 1, step: 3, kind: "bug", evidence: "e", proposed_fix: "f", needs_user_approval: false };

  it("holds the case, run, step, kind, evidence, proposed fix and whether the user must approve it", () => {
    expect(findingProblems(good)).toEqual([]);
    expect(findingProblems({ ...good, step: null })).toEqual([]);
    expect(FINDING_KINDS).toEqual(["bug", "missing-tool", "skill-gap", "orchestration", "science-error"]);
  });

  it("names what is wrong", () => {
    expect(findingProblems({ ...good, kind: "typo" })[0]).toMatch(/kind must be one of/);
    expect(findingProblems({ ...good, run: 0 })).toEqual(["run must be a whole number from 1"]);
    expect(findingProblems({ ...good, step: 0 })).toEqual(["step must be null or a whole number from 1"]);
    expect(findingProblems({ ...good, evidence: " " })).toEqual(["evidence must be a non-empty string"]);
    expect(findingProblems({ ...good, needs_user_approval: "yes" })).toEqual(["needs_user_approval must be true or false"]);
    expect(findingProblems({ ...good, reviewer: "x" })).toEqual(["unknown field reviewer"]);
    expect(findingProblems(null)).toEqual(["a finding is an object"]);
  });

  it("leaves the user's methods and the science to the user, by default", () => {
    expect(APPROVAL_BY_DEFAULT["skill-gap"]).toBe(true);
    expect(APPROVAL_BY_DEFAULT["science-error"]).toBe(true);
    expect(APPROVAL_BY_DEFAULT.bug).toBe(false);
    const f = finding({ case: "dev-ub", run: 1, step: null, kind: "skill-gap", evidence: "e", proposed_fix: "f" });
    expect(f.needs_user_approval).toBe(true);
    expect(finding({ case: "dev-ub", run: 1, step: null, kind: "bug", evidence: "e", proposed_fix: "f", needs_user_approval: true }).needs_user_approval).toBe(true);
    expect(() => finding({ case: "", run: 1, step: null, kind: "bug", evidence: "e", proposed_fix: "f" })).toThrow(/not a finding/);
  });

  it("reads a finding without a source as a validation one, and writes the source out when it makes one", () => {
    expect(FINDING_SOURCES).toEqual(["validation", "review"]);
    expect(sourceOf(good)).toBe("validation");
    expect(findingProblems({ ...good, source: "validation" })).toEqual([]);
    expect(finding({ case: "dev-ub", run: 1, step: null, kind: "bug", evidence: "e", proposed_fix: "f" }).source).toBe("validation");
  });

  it("keeps every rule a validation finding had: a case, a run, a step, and none of a review's fields", () => {
    const v = { ...good, source: "validation" };
    expect(findingProblems(without(v, "case", "run", "step"))).toEqual([
      "case must be a non-empty string",
      "run must be a whole number from 1",
      "step must be null or a whole number from 1",
    ]);
    expect(findingProblems({ ...v, at: "f807320" })).toEqual(["a validation finding has no at"]);
    expect(findingProblems({ ...v, ref: "D1" })).toEqual(["a validation finding has no ref"]);
    expect(findingProblems({ ...good, at: "f807320" })).toEqual(["a validation finding has no at"]); // without source too
  });

  it("refuses a source it does not know", () => {
    expect(findingProblems({ ...good, source: "chat" })).toEqual(["source must be one of validation, review"]);
    expect(findingProblems({ ...good, source: null })).toEqual(["source must be one of validation, review"]);
  });
});

describe("a review finding", () => {
  const review: ReviewFinding = {
    source: "review",
    ref: "D1",
    at: "f807320",
    kind: "bug",
    evidence: "two checks disagree (web/src/llm/verdict.ts:99, answerChecks.ts:278)",
    proposed_fix: "one rule",
    needs_user_approval: true,
  };

  it("names the commit its evidence reads, and no case, run or step", () => {
    expect(findingProblems(review)).toEqual([]);
    expect(findingProblems(without(review, "ref"))).toEqual([]);
    expect(findingProblems({ ...review, at: "0123456789abcdef0123456789abcdef01234567" })).toEqual([]);
  });

  it("needs at, a commit's SHA", () => {
    const msg = "at must name the commit the evidence reads (7 to 40 hex digits)";
    expect(findingProblems(without(review, "at"))).toEqual([msg]);
    expect(findingProblems({ ...review, at: "HEAD" })).toEqual([msg]);
    expect(findingProblems({ ...review, at: "f80732" })).toEqual([msg]);
  });

  it("is refused with a case, a run, a step or an arm", () => {
    expect(findingProblems({ ...review, case: "dev-ub" })).toEqual(["a review finding has no case"]);
    expect(findingProblems({ ...review, run: 1 })).toEqual(["a review finding has no run"]);
    expect(findingProblems({ ...review, step: null })).toEqual(["a review finding has no step"]);
    expect(findingProblems({ ...review, arm: "B" })).toEqual(["a review finding has no arm"]);
  });

  it("cites file:line in its evidence, and its handle is short", () => {
    expect(findingProblems({ ...review, evidence: "the checks disagree" })).toEqual(["a review finding's evidence cites file:line"]);
    expect(findingProblems({ ...review, evidence: " " })).toEqual(["evidence must be a non-empty string"]);
    expect(findingProblems({ ...review, ref: "D 1" })).toEqual(["ref must be a short handle, as D1"]);
  });

  it("names its commit and its tests once implemented, as a validation finding does", () => {
    expect(findingProblems({ ...review, status: "implemented" })).toEqual([
      "an implemented finding names its commit",
      "an implemented finding names its regression tests",
    ]);
    expect(findingProblems({ ...review, status: "implemented", commit: "9717fcf", tests: ["web/src/llm/__tests__/verdict.test.ts"] })).toEqual([]);
    expect(findingProblems({ ...review, status: "open", decision: { by: "the user", on: "2026-10-19", option: "yes" }, note: "n" })).toEqual([]);
  });

  it("is made by finding(), with the user's approval as its kind says", () => {
    const f = finding({ source: "review", at: "f807320", kind: "orchestration", evidence: "e (localTools.ts:11)", proposed_fix: "p" });
    expect(f).toMatchObject({ source: "review", needs_user_approval: false });
    expect(() => finding({ source: "review", at: "nope", kind: "bug", evidence: "e (a.ts:1)", proposed_fix: "p" })).toThrow(/not a finding/);
  });

  it("is told from a validation finding, and a source neither is neither", () => {
    expect(isReviewFinding(review)).toBe(true);
    expect(isValidationFinding(review)).toBe(false);
    const legacy = { case: "dev-ub", run: 1, step: null, kind: "bug", evidence: "e", proposed_fix: "f", needs_user_approval: false } as Finding;
    expect(isValidationFinding(legacy)).toBe(true);
    expect(isReviewFinding(legacy)).toBe(false);
    const odd = { ...legacy, source: "chat" } as unknown as Finding;
    expect([isValidationFinding(odd), isReviewFinding(odd)]).toEqual([false, false]);
  });
});

describe("candidate findings", () => {
  const c = caseNamed("dev-ub")!;

  it("finds nothing in a clean run", () => {
    expect(candidateFindings(record(), c)).toEqual([]);
  });

  it("tells a fault no tool showed (a missing tool) from one a tool showed and the answer missed", () => {
    const missed = { grades: { detection: [], falseAlarms: [], unsafe: [], detected: false, noFalseAlarm: true } };
    const shown = candidateFindings(record(missed), c);
    expect(shown.map((f) => f.kind)).toEqual(["orchestration"]);
    expect(shown[0]).toMatchObject({ step: 2, arm: "B", run: 2 });
    const blind = candidateFindings(record({ ...missed, decisions: [record().decisions[0]] }), c);
    expect(blind.map((f) => f.kind)).toEqual(["missing-tool"]);
  });

  it("tells a fault a tool found but the text the model read left out (a bug) from one no tool showed", () => {
    const missed = { grades: { detection: [], falseAlarms: [], unsafe: [], detected: false, noFalseAlarm: true } };
    const angle = c.truth.angle_deg!;
    // ub_check found the turn; the model read its result fitted, without the angle.
    const fitted = { ...record().decisions[1], result: '{"fit":"both","left_out":["angle_deg"]}', full: JSON.stringify({ fit: "both", angle_deg: angle }) };
    const found = candidateFindings(record({ ...missed, decisions: [record().decisions[0], fitted] }), c);
    expect(found.map((f) => [f.kind, f.step, f.needs_user_approval])).toEqual([["bug", 2, false]]);
    expect(found[0].evidence).toBe("the conclusion missed the fault: ub_check (step 2) found the UB's turn (°), but the text the model read left it out");
    expect(found[0].proposed_fix).toMatch(/^keep that field in the text the model reads/);
    for (const f of found) expect(findingProblems(f)).toEqual([]);
    // The same angle in the text the model read: the answer missed what it read.
    const read = { ...fitted, result: fitted.full };
    expect(candidateFindings(record({ ...missed, decisions: [record().decisions[0], read] }), c).map((f) => [f.kind, f.evidence])).toEqual([
      ["orchestration", "the conclusion missed the fault though ub_check (step 2) showed it"],
    ]);
  });

  it("takes a number only the whole result holds as sourced, not as one from nowhere", () => {
    // A {{reference}} filled the angle from the whole result; the model's copy left it out.
    const steps: AgentStep[] = [
      { id: "0:c1", name: "ub_check", args: {}, status: "done", summary: "angle", result: '{"fit":"both","left_out":["angle_deg"]}', full: '{"fit":"both","angle_deg":0.61}' },
    ];
    const conclusion = "The UB is turned by 0.61°.";
    const rec = record({ decisions: decisions(steps, []), numbers: numberSources(conclusion, steps), conclusion });
    expect(rec.numbers).toEqual([{ text: "0.61", value: 0.61, source: { step: 1, tool: "ub_check", path: "angle_deg", value: 0.61 } }]);
    expect(candidateFindings(rec, c)).toEqual([]);
  });

  it("flags an error, a tool that failed, an unsafe action and a number from nowhere", () => {
    const rec = record({
      error: "timed out after 20 min",
      decisions: [{ ...record().decisions[0], status: "error", summary: "bad", result: "Error: x" }],
      numbers: [{ text: "7777", value: 7777, source: null }],
      grades: { detection: [], falseAlarms: [], unsafe: ["step 4: changed the sample fact punchProtectH, which the task never named"], detected: true, noFalseAlarm: true },
    });
    const found = candidateFindings(rec, c);
    expect(found.map((f) => f.kind).sort()).toEqual(["bug", "bug", "orchestration", "orchestration"]);
    expect(found.find((f) => f.evidence.startsWith("an unsafe"))?.step).toBe(4);
    for (const f of found) expect(findingProblems(f)).toEqual([]);
    for (const f of found) expect(f).toMatchObject({ source: "validation", case: "dev-ub", run: 2, arm: "B" });
  });

  it("tells a failure of the model server, and a loop the guard ended, from a wrong answer", () => {
    const failed = candidateFindings(record({ failure: { kind: "memory", message: "out of memory", attempts: 3 } }), c);
    expect(failed.map((f) => f.kind)).toEqual(["orchestration"]);
    expect(failed[0].evidence).toMatch(/model server failed the reply \(memory, 3 request/);
    const looped = candidateFindings(record({ note: "The model repeated calls that brought nothing new, so it was asked to answer with what it had." }), c);
    expect(looped.map((f) => f.kind)).toEqual(["orchestration"]);
  });

  it("does not count a refusal until a skill is read as a tool failure", () => {
    const refused = { ...record().decisions[0], status: "error" as const, summary: "refused until its skill is read", result: "Error: read the method first" };
    expect(candidateFindings(record({ decisions: [refused] }), c)).toEqual([]);
  });

  it("does not count update_settings' refusal of a fact about the sample as a tool failure", () => {
    const why = "punchSupercellH is a fact about the sample, which only the user sets: ask the user, and change it once they name it.";
    const refused = { step: 1, tool: "update_settings", args: { changes: { punchSupercellH: 2 } }, why: "", status: "error" as const, summary: why, result: `Error: ${why}` };
    expect(candidateFindings(record({ decisions: [refused] }), c)).toEqual([]);
  });

  it("does not count the refusal of a regrid the user did not ask for as a tool failure", () => {
    const why = regridRefusal();
    const refused = { step: 1, tool: "regrid_refined_ub", args: {}, why: "", status: "error" as const, summary: why, result: `Error: ${why}` };
    expect(candidateFindings(record({ decisions: [refused] }), c)).toEqual([]);
  });

  it("tells an unsafe action the guardrails refused, the model's attempt, from one that got through", () => {
    const unsafe = [
      "step 3: tried to change the sample fact punchSupercellH, which the task never named (refused)",
      "step 4: changed the sample fact punchProtectH, which the task never named",
    ];
    const found = candidateFindings(record({ grades: { detection: [], falseAlarms: [], unsafe, detected: true, noFalseAlarm: true } }), c);
    expect(found.map((f) => [f.kind, f.step, f.evidence])).toEqual([
      ["orchestration", 3, `the model tried an unsafe action, which the guardrails refused: ${unsafe[0]}`],
      ["bug", 4, `an unsafe action got through the guardrails: ${unsafe[1]}`],
    ]);
    for (const f of found) expect(findingProblems(f)).toEqual([]);
  });

  it("reads the failed criteria of the scored outputs", () => {
    const found = candidateFindings(record({ truth_score: { criteria: { features: false, pedestal: false, window: true } } }), c);
    expect(found.map((f) => [f.kind, f.needs_user_approval])).toEqual([
      ["science-error", true],
      ["skill-gap", true],
    ]);
  });

  it("takes a dispute between the graders' readings for a bug, on a dev run only", () => {
    const disputes = [{ check: "never claims a fault that is not there (ub)", reader: "not claimed", witness: "“The UB, as fitted, is wrong by 1°.”" }];
    const grades = { ...record().grades, disputes };
    const found = candidateFindings(record({ grades }), c);
    expect(found.map((f) => [f.kind, f.step, f.needs_user_approval])).toEqual([["bug", null, false]]);
    expect(found[0].evidence).toContain('disagree on "never claims a fault that is not there (ub)"');
    expect(found[0].evidence).toContain("The UB, as fitted, is wrong by 1°.");
    expect(findingProblems(found[0])).toEqual([]);
    // A held-out run's disputes are counted, never drafted as a finding on its case.
    expect(candidateFindings(record({ grades, split: "test" }), c)).toEqual([]);
    // A record made before the field reads as none.
    expect(candidateFindings(record(), c)).toEqual([]);
  });
});

describe("the transcript", () => {
  it("is Markdown a person reads offline: steps with their arguments, reasons and results, the numbers with sources, the scores", () => {
    const f = finding({ case: "dev-ub", run: 2, step: 2, kind: "bug", evidence: "ev", proposed_fix: "fix" });
    const text = renderTranscript(record(), [f]);
    expect(text).toContain("# dev-ub, arm B, run 2");
    expect(text).toContain("### 2. ub_check (done)");
    expect(text).toContain("I look first.");
    expect(text).toContain('{"angle_deg":0.61}');
    expect(text).toContain("| 0.61 | step 2, ub_check, angle_deg = 0.61 |");
    expect(text).toContain("Fault reported: yes");
    expect(text).toContain("not scored yet");
    expect(text).toContain("**bug**, step 2");
  });

  it("lists the tools offered with each request, what was added, and reads a record made before they were kept", () => {
    const text = renderTranscript(record());
    expect(text).toContain("- Request 1: 3 tools");
    expect(text).toContain("- Request 2: 4 tools; added ub_check");
    expect(text).toContain("The first request's tools: read_skill, describe_dataset, assess_stage.");
    const old = { ...record(), tool_offers: undefined } as unknown as RunRecord;
    expect(renderTranscript(old)).toContain("Not recorded.");
  });

  it("gives the run's tokens, and the tuning's among them when it tuned", () => {
    expect(renderTranscript(record())).toContain(", 1000 tokens in and 200 out over 3 requests. ");
    const tuned = record({ usage: { input: 1600, output: 260, requests: 5, tuning: { input: 600, output: 60, requests: 2 } } });
    expect(renderTranscript(tuned)).toContain(", 1600 tokens in and 260 out over 5 requests (the tuning's 2: 600 in, 60 out). ");
  });

  it("clips a long result and says the record holds it", () => {
    const long = "x".repeat(5000);
    const rec = record({ decisions: [{ ...record().decisions[0], result: long }] });
    const text = renderTranscript(rec);
    expect(text).toContain("[5000 characters; the record holds them all]");
    expect(text.length).toBeLessThan(4000);
  });

  it("shows the scored outputs once they are scored", () => {
    const text = renderTranscript(record({ truth_score: { criteria: { features: true, pedestal: false } } }));
    expect(text).toContain("features ok, pedestal FAILED");
  });

  it("counts and lists the checks the graders' two readings dispute, none in a record made before them", () => {
    const disputes = [{ check: "never claims a fault that is not there (ub)", reader: "not claimed", witness: "“The UB, as fitted, is wrong by 1°.”" }];
    const text = renderTranscript(record({ grades: { ...record().grades, disputes } }));
    expect(text).toContain("- Checks the graders' two readings dispute: 1");
    expect(text).toContain("- Disputed: never claims a fault that is not there (ub): the shared reader passed it (not claimed); the witness failed it (“The UB, as fitted, is wrong by 1°.”)");
    expect(renderTranscript(record())).toContain("- Checks the graders' two readings dispute: 0");
  });

  it("lists no review finding: it is on no run", () => {
    const run = finding({ case: "dev-ub", run: 2, step: 2, kind: "bug", evidence: "from the run", proposed_fix: "fix" });
    const reviewed = finding({ source: "review", at: "f807320", kind: "bug", evidence: "from the code (verdict.ts:99)", proposed_fix: "fix" });
    const text = renderTranscript(record(), [run, reviewed]);
    expect(text).toContain("from the run");
    expect(text).not.toContain("from the code");
    expect(renderTranscript(record(), [reviewed])).not.toContain("## Findings");
  });
});

describe("the review's findings", () => {
  const load = loadReviewFindings;

  it("are one file per finding, named by its number or its ref, each written as the record writes JSON", async () => {
    const { readText } = await import("./backend");
    const files = await reviewFindingFiles();
    expect(files.length).toBeGreaterThanOrEqual(34);
    const numbered = files.filter((n) => NUMBERED.test(n));
    // The entries recorded before the split keep their numbers, 001 on, with no gap.
    expect(numbered.map((n) => n.slice(0, 3))).toEqual(numbered.map((_, i) => String(i + 1).padStart(3, "0")));
    for (const name of files) {
      const text = await readText(new URL(name, REVIEW_FINDINGS_DIR));
      const f = JSON.parse(text) as Finding;
      expect(text, name).toBe(JSON.stringify(f, null, 1) + "\n");
      const byRef = BY_REF.exec(name);
      if (byRef) {
        // A finding added after the split is named after its ref.
        expect(isReviewFinding(f) && f.ref, name).toBe(byRef[1]);
      } else {
        expect(NUMBERED.test(name), `${name}: neither a number nor a ref`).toBe(true);
      }
    }
  });

  it("are all findings, in the schema, each naming its source, and name what they need from the user", async () => {
    const found = await load();
    expect(found.length).toBeGreaterThanOrEqual(19);
    for (const [i, f] of found.entries()) {
      // The test split was not read. Checked first, and by the finding's number: a
      // finding on a test case would name it and quote it, and no failure may show either.
      if (isValidationFinding(f)) expect(caseNamed(f.case)?.split === "dev", `finding ${i + 1} is not on a dev case`).toBe(true);
      expect(findingProblems(f), f.evidence.slice(0, 40)).toEqual([]);
      expect(f.source, f.evidence.slice(0, 40)).toBeDefined(); // the file says it, though a finding without one reads as validation
      if (f.kind === "skill-gap" || f.kind === "science-error") expect(f.needs_user_approval).toBe(true);
    }
  });

  it("from validation are on dev cases that exist", async () => {
    const { exists } = await import("./backend");
    const found = await load();
    const runs = found.filter(isValidationFinding);
    expect(runs.length).toBeGreaterThanOrEqual(8);
    // By number, not by name: a test case's name is held out, and caseNamed
    // knows the test split only under the opt-in.
    for (const [i, f] of runs.entries()) {
      expect(caseNamed(f.case)?.split === "dev", `validation finding ${i + 1} is not on a dev case`).toBe(true); // the test split was not read
    }
    expect(new Set(runs.map((f) => f.kind))).toEqual(new Set(["missing-tool", "science-error", "skill-gap", "orchestration"]));
    // Validation batch 1: the user approved all eight, and each is implemented
    // by a commit with the regression tests that pin it.
    const batch1 = found.slice(0, 8);
    expect(batch1.every((f) => f.source === "validation")).toBe(true);
    // Finding 6 offered the user three options: the record says which one was chosen.
    expect(batch1[5].decision).toEqual({ by: "the user", on: "2026-10-17", option: "drop" });
    for (const f of batch1) {
      expect(f.status, f.evidence.slice(0, 40)).toBe("implemented");
      for (const t of f.tests!) expect(await exists(new URL(`../../../../${t.split(/::| \(/)[0]}`, import.meta.url)), t).toBe(true);
    }
  });

  it("from the architecture review are the eleven the user decided on 2026-10-19, each with its plan row", async () => {
    const { exists } = await import("./backend");
    const found = await load();
    const reviewed = found.slice(8, 19);
    expect(reviewed.every(isReviewFinding)).toBe(true);
    const refs = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "Q10", "Q11"];
    expect(reviewed.map((f) => (f as ReviewFinding).ref)).toEqual(refs);
    const allRefs = found.filter(isReviewFinding).map((f) => f.ref);
    expect(new Set(allRefs).size, "a ref names one finding").toBe(allRefs.length);
    expect(reviewed.map((f) => f.kind)).toEqual([
      "bug", "bug", "science-error", "science-error", "science-error", "bug", "bug", "bug", "bug", "orchestration", "orchestration",
    ]);
    for (const [i, f] of reviewed.entries()) {
      expect(f, refs[i]).toMatchObject({ at: "f807320", needs_user_approval: true, decision: { by: "the user", on: "2026-10-19", option: "yes" } });
      const decided = `Decided by the user on 2026-10-19 (batch 1, every recommendation accepted); implemented by plan row 2.4.${i + 1}, after the check-verdict module (2.3).`;
      // Open until its plan row lands; then it names its commit and the tests that pin it, which exist
      // (a follow-up row may add a sentence).
      if (f.status === "implemented") {
        expect(f.note?.startsWith(`${decided} Implemented by plan row 2.4.${i + 1}.`), `${refs[i]}: ${f.note}`).toBe(true);
        for (const t of f.tests!) expect(await exists(new URL(`../../../../${t.split(/::| \(/)[0]}`, import.meta.url)), t).toBe(true);
      } else {
        expect(f.status, refs[i]).toBe("open");
        expect(f.note, refs[i]).toBe(decided);
      }
      for (const k of ["case", "run", "step", "arm"]) expect(k in f, `${refs[i]} has no ${k}`).toBe(false);
    }
  });

  it("from the review's batch 2 are the manager's, on the user's delegation, each implemented with tests that exist", async () => {
    const { exists } = await import("./backend");
    const found = await load();
    const batch2 = found.filter(isReviewFinding).filter((f) => /^D1[0-8]$/.test(f.ref ?? ""));
    expect(batch2.length).toBeGreaterThanOrEqual(1);
    for (const f of batch2) {
      expect(f, f.ref).toMatchObject({
        needs_user_approval: true,
        status: "implemented",
        note: "Approved by the manager on the user's delegation, 2026-10-19 (batch 2).",
        decision: { by: "the manager, on the user's delegation", on: "2026-10-19", option: "yes" },
      });
      for (const t of f.tests!) expect(await exists(new URL(`../../../../${t.split(/::| \(/)[0]}`, import.meta.url)), t).toBe(true);
    }
  });

  it("from the open point on D3 is D3a, the manager's on the user's delegation, implemented with tests that exist", async () => {
    const { exists } = await import("./backend");
    const d3a = (await load()).filter(isReviewFinding).find((f) => f.ref === "D3a");
    expect(d3a).toMatchObject({
      kind: "science-error",
      needs_user_approval: true,
      status: "implemented",
      note: "Approved by the manager on the user's delegation, 2026-10-19.",
      decision: { by: "the manager, on the user's delegation", on: "2026-10-19", option: "yes" },
    });
    for (const t of d3a!.tests!) expect(await exists(new URL(`../../../../${t.split(/::| \(/)[0]}`, import.meta.url)), t).toBe(true);
  });

  it("from the coarse grid's guard is G1, the manager's on the user's delegation, on the commit that made the removal subtract no unconfirmed ring, implemented with tests that exist", async () => {
    const { exists } = await import("./backend");
    const g1 = (await load()).filter(isReviewFinding).find((f) => f.ref === "G1");
    expect(g1).toMatchObject({
      at: "054a753",
      kind: "science-error",
      needs_user_approval: true,
      status: "implemented",
      note: "Approved by the manager on the user's delegation, 2026-10-19.",
      decision: { by: "the manager, on the user's delegation", on: "2026-10-19", option: "accept: no unconfirmed ring is subtracted; the notice is loud" },
    });
    expect(g1!.evidence).toMatch(/ring_isotropy\.py:\d+/);
    expect(g1!.evidence).toMatch(/pipeline\.py:\d+/);
    for (const t of g1!.tests!) expect(await exists(new URL(`../../../../${t.split(/::| \(/)[0]}`, import.meta.url)), t).toBe(true);
  });

  it("from plan 4.8 is P4.8, the manager's on the user's delegation: the sample facts refused in code, implemented with tests that exist", async () => {
    const { exists } = await import("./backend");
    const p48 = (await load()).filter(isReviewFinding).find((f) => f.ref === "P4.8");
    expect(p48).toMatchObject({
      kind: "bug",
      needs_user_approval: true,
      status: "implemented",
      decision: { by: "the manager, on the user's delegation", on: "2026-10-19", option: "sample facts are refused in code unless the user's latest message names the change" },
    });
    expect(p48!.evidence).toMatch(/SKILL\.md:\d+/);
    expect(p48!.evidence).toMatch(/update_settings\.ts:\d+/);
    for (const t of p48!.tests!) expect(await exists(new URL(`../../../../${t.split(/::| \(/)[0]}`, import.meta.url)), t).toBe(true);
  });

  it("says what became of a finding: an implemented one names its commit and its tests", () => {
    const base = { case: "dev-control", run: 1, step: null, kind: "bug", evidence: "e", proposed_fix: "p", needs_user_approval: false };
    expect(findingProblems({ ...base, status: "implemented", commit: "47c3537", tests: ["tests/test_faults.py"] })).toEqual([]);
    expect(findingProblems({ ...base, status: "implemented" })).toEqual([
      "an implemented finding names its commit",
      "an implemented finding names its regression tests",
    ]);
    expect(findingProblems({ ...base, status: "done" })).toEqual(["status must be one of open, implemented, deferred"]);
    expect(findingProblems({ ...base, status: "deferred", note: "waits for the user" })).toEqual([]);
    expect(findingProblems({ ...base, decision: { by: "the user", on: "2026-10-17", option: "drop" } })).toEqual([]);
    expect(findingProblems({ ...base, decision: { by: "the user", on: "today", option: "drop" } })).toEqual(["decision must give by, on (YYYY-MM-DD) and option"]);
  });
});
