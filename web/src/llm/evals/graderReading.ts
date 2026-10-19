// How the graders read an answer's words: a port, so that what a grader
// decides (checks.ts, validation.ts) is apart from how the words were read.
// A reader gives the answer's sentences and clauses, each with whether it
// negates, whether it is tentative (a condition or a plan opens it), whether
// it asks, the numbers it writes and the angles among them, and every number
// the answer writes.
//
// One adapter for now: the witness (witness.ts), the graders' own parse.

import type { Check, EvalRun } from "./harness";
import { witness } from "./witness";

export interface GradedSpan {
  text: string; // as written (a sentence's with its answer word)
  negated: boolean; // it negates what it says (a leading answer word does not)
  tentative: boolean; // a condition or a plan opens it
  question: boolean; // it asks
  numbers: number[]; // the numbers it writes
  angles: number[]; // the angles among them
}

export interface GradedAnswer {
  sentences: GradedSpan[]; // what checks.ts reads
  clauses: GradedSpan[]; // what validation.ts reads
  numbers: number[]; // every number the answer writes
}

export type GraderReader = (answer: string) => GradedAnswer;

/** The reader the graders read an answer by. */
export const graderReader: GraderReader = witness;

/** What a check decides of an answer, read, in its run. */
export type Decide = (answer: GradedAnswer, run: EvalRun) => { pass: boolean; detail: string };

/** A check on an answer's words: it decides on the answer as the graders' reader reads it. */
export function readCheck(name: string, decide: Decide): Check {
  return { name, grade: (run) => decide(graderReader(run.content), run) };
}
