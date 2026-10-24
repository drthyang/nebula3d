// The graders, graded: each check passes the run it should and fails the one
// it should, including the traps real answers set them (numbers in LaTeX, a
// range read as a negative, a negation that read as a claim).

import { describe, expect, it } from "vitest";

import type { AgentStep } from "../agent";
import { answers, asserts, didNotRun, measured, mentions, neverAsserts, quotes, ran, readSkillBefore } from "./checks";
import type { Check, EvalRun } from "./harness";
import { saysRingLeft } from "./scenarios";

const step = (name: string, args: Record<string, unknown> = {}, result: unknown = {}, status: AgentStep["status"] = "done"): AgentStep => ({
  id: `${name}-${Math.random()}`,
  name,
  args,
  status,
  result: JSON.stringify(result),
});
const run = (content: string, steps: AgentStep[] = [], extra: Partial<EvalRun> = {}): EvalRun =>
  ({ scenario: "t", steps, content, latencyMs: 0, ...extra }) as EvalRun;
const passes = (check: Check, r: EvalRun) => check.grade(r).pass;

describe("what the model called", () => {
  it("counts a call only when it ran without an error, and says when it ran but not as needed", () => {
    const check = ran("assess_stage", (a) => a.stage === "rings", "for the rings");
    expect(passes(check, run("", [step("assess_stage", { stage: "rings" })]))).toBe(true);
    expect(passes(check, run("", [step("assess_stage", { stage: "rings" }, {}, "error")]))).toBe(false);
    const wrong = check.grade(run("", [step("assess_stage", { stage: "punch" })]));
    expect(wrong.pass).toBe(false);
    expect(wrong.detail).toMatch(/called, but not as needed/);
  });

  it("counts any attempt against a call that must not happen", () => {
    expect(passes(didNotRun("run_pipeline"), run("", []))).toBe(true);
    expect(passes(didNotRun("run_pipeline"), run("", [step("run_pipeline", {}, {}, "error")]))).toBe(false);
  });

  it("checks that a skill was read before the change it gates", () => {
    const check = readSkillBefore("bragg-node-audit", "update_settings");
    const read = step("read_skill", { name: "bragg-node-audit" });
    const change = step("update_settings", { changes: { punchMinSig: 6 } });
    expect(passes(check, run("", [read, change]))).toBe(true);
    expect(passes(check, run("", [change]))).toBe(false);
    expect(passes(check, run("", [step("read_skill", { name: "bragg-node-audit", reference: "bragg_cleanup" }), change]))).toBe(false);
  });
});

describe("what it answered", () => {
  it("needs an answer: not empty, not an error, not cut off", () => {
    expect(passes(answers, run("A ring is left."))).toBe(true);
    expect(passes(answers, run("  "))).toBe(false);
    expect(passes(answers, run("A ring", [], { error: "HTTP 500" }))).toBe(false);
    expect(passes(answers, run("A ring", [], { note: "The reply was cut off: the context window is full." }))).toBe(false);
  });

  it("does not take a negated sentence for a claim, and does not miss an affirmed one", () => {
    const left = asserts(/\bring\b[^.]*\bleft\b/i, "that a ring is left");
    expect(passes(left, run("One ring is left at 7.2 Å⁻¹."))).toBe(true);
    expect(passes(left, run("No ring is left."))).toBe(false);
    expect(passes(left, run("No, a ring is left at 7.2 Å⁻¹."))).toBe(true); // "No," answers the question
  });

  it("reads a claim across a number's decimal point", () => {
    expect(passes(saysRingLeft, run("Part of the ring at 2.45 Å⁻¹ is left on hk0."))).toBe(true);
    expect(passes(saysRingLeft, run("The ring at 2.45 Å⁻¹ was removed. Nothing is left."))).toBe(false);
  });

  it("can require a negated claim", () => {
    const none = mentions(/\bno second grain\b/i, "that there is no second grain");
    expect(passes(none, run("There is no second grain."))).toBe(true);
    expect(passes(none, run("There may be a second grain."))).toBe(false);
  });

  it("forbids a claim, not its negation (\"too few to show a second grain\" claims none)", () => {
    const check = neverAsserts(/\bsecond grain\b/i, "a second grain");
    expect(passes(check, run("Five orbits are too few to show a second grain."))).toBe(true);
    expect(passes(check, run("There is no second grain."))).toBe(true);
    expect(passes(check, run("The peaks show a second grain."))).toBe(false);
  });
});

describe("numbers checked against the run's own tool results", () => {
  const assessed = [
    step("assess_stage", { stage: "rings" }, { rings: { worst_ring_left: { at: 7.234 } } }),
    step("assess_stage", { stage: "rings" }, { rings: { worst_ring_left: { at: 7.9 } } }),
  ];

  it("reads the last call's value at a path", () => {
    expect(measured("assess_stage", "rings.worst_ring_left.at")(run("", assessed))).toBe(7.9);
    expect(measured("assess_stage", "rings.nope")(run("", assessed))).toBeNull();
    expect(measured("assess_stage", "rings.worst_ring_left.at", (a) => a.stage === "punch")(run("", assessed))).toBeNull();
  });

  it("passes a number within the tolerance, absolute or relative, and fails one outside it", () => {
    const abs = quotes("the ring's |Q|", measured("assess_stage", "rings.worst_ring_left.at"), 0.3);
    expect(passes(abs, run("A ring is left at 7.8 Å⁻¹.", assessed))).toBe(true);
    expect(passes(abs, run("A ring is left at 7.2 Å⁻¹.", assessed))).toBe(false); // the first call's value, not the last
    const rel = quotes("the weight", measured("qmax_coverage", "w"), 0.1, { relative: true });
    const covered = [step("qmax_coverage", {}, { w: 4.1e-6 })];
    expect(passes(rel, run("It puts $4.0 \\times 10^{-6}$ of its weight there.", covered))).toBe(true);
    expect(passes(rel, run("It puts 5e-6 of its weight there.", covered))).toBe(false);
  });

  it("fails when the tools never measured what the answer must quote", () => {
    const check = quotes("the ring's |Q|", measured("assess_stage", "rings.worst_ring_left.at"), 0.3);
    const r = check.grade(run("A ring is left at 7.2 Å⁻¹."));
    expect(r.pass).toBe(false);
    expect(r.detail).toMatch(/no the ring's \|Q\| in the tool results/);
  });

  it("credits only what the model read: a field only the whole result (`full`) holds is not credited", () => {
    // The model read ub_check's result fitted, without the turn; the step keeps the whole beside it.
    const fitted: AgentStep = {
      ...step("ub_check", {}, { fit: "both", left_out: ["orientation_change_deg"] }),
      full: JSON.stringify({ fit: "both", orientation_change_deg: 0.61 }),
    };
    const turn = measured("ub_check", "orientation_change_deg");
    expect(turn(run("", [fitted]))).toBeNull();
    const check = quotes("the UB's turn", turn, 0.05);
    const r = check.grade(run("The UB is turned by 0.61°.", [fitted]));
    expect(r.pass).toBe(false);
    expect(r.detail).toMatch(/no the UB's turn in the tool results/);
    // The same field in the text the model read is credited.
    expect(passes(check, run("The UB is turned by 0.61°.", [{ ...fitted, result: fitted.full }]))).toBe(true);
  });
});
