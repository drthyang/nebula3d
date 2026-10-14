// The findings schema and a run's offline transcript, without a model.

import { describe, expect, it } from "vitest";

import { APPROVAL_BY_DEFAULT, candidateFindings, finding, findingProblems, FINDING_KINDS, renderTranscript, type Finding } from "./findings";
import { caseNamed, type RunRecord } from "./validation";

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
    expect(findingProblems({ ...good, note: "x" })).toEqual(["unknown field note"]);
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

  it("reads the failed criteria of the scored outputs", () => {
    const found = candidateFindings(record({ truth_score: { criteria: { features: false, pedestal: false, window: true } } }), c);
    expect(found.map((f) => [f.kind, f.needs_user_approval])).toEqual([
      ["science-error", true],
      ["skill-gap", true],
    ]);
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
});

describe("the review's findings", () => {
  it("are all findings, in the schema, on cases that exist, and name what they need from the user", async () => {
    const { readText } = await import("./backend");
    const found = JSON.parse(await readText(new URL("../../../../docs/evals/validation/review-findings.json", import.meta.url))) as Finding[];
    expect(found.length).toBeGreaterThanOrEqual(8);
    for (const f of found) {
      expect(findingProblems(f), f.evidence.slice(0, 40)).toEqual([]);
      expect(caseNamed(f.case), f.case).toBeDefined();
      expect(caseNamed(f.case)!.split).toBe("dev"); // the test split was not read
      if (f.kind === "skill-gap" || f.kind === "science-error") expect(f.needs_user_approval).toBe(true);
    }
    expect(new Set(found.map((f) => f.kind))).toEqual(new Set(["missing-tool", "science-error", "skill-gap", "orchestration"]));
  });
});
