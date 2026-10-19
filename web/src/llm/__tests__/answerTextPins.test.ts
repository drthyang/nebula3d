// The differences the answer checks and the graders keep in reading an
// answer's words, each named where it lives and pinned here with both
// readings, in the manner of verdictPins.test.ts. The two read one reader
// (answerText/); a difference is a policy over its reading. Unifying one
// flips its flag (or deletes its rule, as its comment says); its pin then
// shows the readings agree.

import { describe, expect, it } from "vitest";

import type { AgentStep } from "../agent";
import {
  clauses,
  contradictions,
  untracedNumbers,
  verdictsIn,
  W1_GATE_SPLITS_AT_DASHES,
  W2_GATE_NEGATES_ABSENCE,
  W9_GATE_READS_CURLY_APOSTROPHE,
} from "../answerChecks";
import { readAnswer } from "../answerText";
import { quotes } from "../evals/checks";
import { sharedReader } from "../evals/graderReading";
import type { Check, EvalRun } from "../evals/harness";
import { saysRingLeft } from "../evals/scenarios";
import { caseNamed, detectionChecks, falseAlarmChecks, type ValidationCase } from "../evals/validation";
import { UB_TURNED } from "../verdicts/rules";

let n = 0;
const step = (name: string, result: unknown, args: Record<string, unknown> = {}): AgentStep => ({ id: `w${n++}`, name, args, status: "done", result: JSON.stringify(result) });
const contradicted = (text: string, ...steps: AgentStep[]): string[] => contradictions(text, steps).map((t) => t.id);
const run = (content: string): EvalRun => ({ scenario: "pin", steps: [], content, latencyMs: 0, usage: null });
/** Every check passes the answer. */
const passes = (checks: readonly Check[], text: string): boolean => checks.every((k) => k.grade(run(text)).pass);
const CONTROL = caseNamed("dev-control")!;
const RINGS = caseNamed("dev-rings")!;
/** The case's check that the answer says its fault. */
const saysTheFault = (c: ValidationCase, fault: string): Check => detectionChecks(c).find((k) => k.name === `says the fault (${fault})`)!;
const NO_GRAIN = step("grain_check", { judged: 40, near_bragg_nodes: 3, verdict: "no second grain of this phase: a rotated copy of the Bragg lattice indexes only 3 of the 40 strongest off-lattice orbits (random directions: 5)" });
const UB_RIGHT = step("ub_check", { fit: "both", symmetrised: false, orientation_change_deg: 0.01 });
/** The graders' reading of a clause's cues: the reader's, with its options on. */
const graderCues = (text: string) => readAnswer(text).clauses[0].cues;

describe("the answer checks' reading, kept and named", () => {
  it("W1: the answer checks do not split a clause at a spaced dash; the graders do", () => {
    expect(W1_GATE_SPLITS_AT_DASHES).toBe(false);
    const text = "The ring removal is clean — a ring is left on hk0.";
    expect(clauses(text)).toEqual([text]);
    expect(readAnswer(text).clauses.map((c) => c.text)).toEqual(["The ring removal is clean", "a ring is left on hk0."]);
  });

  it("W2: the answer checks negate on a negation alone, not on an absence; the graders negate on both", () => {
    expect(W2_GATE_NEGATES_ABSENCE).toBe(false);
    // "Too few to show a second grain" claims none to the graders, and claims one to the answer checks.
    const text = "Five orbits are too few to show a second grain.";
    expect(contradicted(text, NO_GRAIN)).toEqual(["grain"]);
    expect([...graderCues(text)]).toEqual(["absence"]);
    expect(sharedReader(text).sentences[0].negated).toBe(true);
  });

  it("W3: doubt is the answer checks' alone: they take no doubted claim as made; the graders do", () => {
    const text = "I doubt the UB is wrong by 0.4°.";
    expect(contradicted(text, UB_RIGHT)).toEqual([]);
    expect(contradicted("The UB is wrong by 0.4°.", UB_RIGHT)).toEqual(["ub"]);
    expect(sharedReader(text).clauses[0].negated).toBe(false);
    expect(passes(falseAlarmChecks(CONTROL), text)).toBe(false);
  });

  it("W4: the answer checks' hedges are anywhere in a clause; the graders' only where a condition or a plan opens it", () => {
    const later = "A powder ring is left at 2.2 Å⁻¹ if the default sectors are used.";
    expect(verdictsIn(later).has("rings")).toBe(false);
    expect(sharedReader(later).clauses[0].tentative).toBe(false);
    expect(passes([saysTheFault(RINGS, "rings")], later)).toBe(true);
    const first = "If the default sectors are used, a powder ring is left at 2.2 Å⁻¹.";
    expect(verdictsIn(first).has("rings")).toBe(false);
    expect(passes([saysTheFault(RINGS, "rings")], first)).toBe(false);
  });

  it("W5: no hedge excuses an alarm: a fault raised as a condition is charged by the graders, and is no verdict to the answer checks", () => {
    const text = "If the UB is wrong by 0.4°, re-index the sample.";
    expect(contradicted(text, UB_RIGHT)).toEqual([]);
    expect(passes(falseAlarmChecks(CONTROL), text)).toBe(false);
  });

  it("W6: checks.ts reads sentences, validation.ts reads clauses", () => {
    const text = "The ring is left at 2.2 Å⁻¹; no other ring is there.";
    expect(passes([saysRingLeft], text)).toBe(false); // the sentence negates
    expect(passes([saysTheFault(RINGS, "rings")], text)).toBe(true); // its first clause does not
  });

  it("W7: a percentage is also read as a share by the answer checks only", () => {
    expect(untracedNumbers("It punched 12 % of the peaks.", '{"share": 0.12}')).toEqual([]);
    const share = quotes("the share", () => 0.12, 0.001);
    expect(passes([share], "It punched 12 % of the peaks.")).toBe(false);
    expect(passes([share], "It punched 0.12 of the peaks.")).toBe(true);
  });

  it("W8: a symmetrised fit's turn is not judged by the app; the grader charges an answer that calls it a turn", () => {
    expect(UB_TURNED({ fit: "symmetric", symmetrised: true, orientation_change_deg: 0.3 })).toBe(false);
    expect(UB_TURNED({ fit: "both", symmetrised: false, orientation_change_deg: 0.3 })).toBe(true);
    expect(passes(falseAlarmChecks(CONTROL), "The UB is turned by 0.3°.")).toBe(false);
  });

  it("the curly apostrophe: the answer checks read “isn’t” as no negation (their blind spot until after the validation); the graders as “isn't”", () => {
    expect(W9_GATE_READS_CURLY_APOSTROPHE).toBe(false);
    expect(contradicted("The UB isn’t off by 0.4°.", UB_RIGHT)).toEqual(["ub"]);
    expect(contradicted("The UB isn't off by 0.4°.", UB_RIGHT)).toEqual([]);
    expect(graderCues("The UB isn’t off by 0.4°.").has("negation")).toBe(true);
    expect(sharedReader("The UB isn’t off by 0.4°.").clauses[0].negated).toBe(true);
  });
});
