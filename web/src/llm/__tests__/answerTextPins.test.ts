// The differences the answer checks and the graders keep in reading an
// answer's words, each named where it lives and pinned here with both
// readings, in the manner of verdictPins.test.ts. The two read one reader
// (answerText/); a difference is a policy over its reading. Unifying one
// flips its flag (or deletes its rule, as its comment says); its pin then
// shows the readings agree.

import { describe, expect, it } from "vitest";

import type { AgentStep } from "../agent";
import { clauses, contradictions, W1_GATE_SPLITS_AT_DASHES, W2_GATE_NEGATES_ABSENCE, W9_GATE_READS_CURLY_APOSTROPHE } from "../answerChecks";
import { readAnswer } from "../answerText";

let n = 0;
const step = (name: string, result: unknown, args: Record<string, unknown> = {}): AgentStep => ({ id: `w${n++}`, name, args, status: "done", result: JSON.stringify(result) });
const contradicted = (text: string, ...steps: AgentStep[]): string[] => contradictions(text, steps).map((t) => t.id);
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
  });

  it("the curly apostrophe: the answer checks read “isn’t” as no negation (their blind spot until after the validation); the graders as “isn't”", () => {
    expect(W9_GATE_READS_CURLY_APOSTROPHE).toBe(false);
    expect(contradicted("The UB isn’t off by 0.4°.", UB_RIGHT)).toEqual(["ub"]);
    expect(contradicted("The UB isn't off by 0.4°.", UB_RIGHT)).toEqual([]);
    expect(graderCues("The UB isn’t off by 0.4°.").has("negation")).toBe(true);
  });
});
