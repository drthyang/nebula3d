// How the graders read an answer's words: a port, so that what a grader
// decides (checks.ts, validation.ts) is apart from how the words were read.
// A reader gives the answer's sentences and clauses, each with whether it
// negates, whether it is tentative (a condition or a plan opens it), whether
// it asks, the numbers it writes and the angles among them, and every number
// the answer writes.
//
// Two adapters:
// - the shared reader, over the one reader of an answer's words
//   (answerText/), which the answer checks read too: what the graders grade by;
// - the witness (witness.ts), an independent minimal parse with the same
//   rules written apart.

import { readAnswer, type Span, type WrittenNumber } from "../answerText";
import type { Check, EvalRun } from "./harness";

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

const values = (ns: readonly WrittenNumber[]): number[] => ns.map((n) => n.value);

/**
 * The angles a span writes: its numbers in degrees (° or deg); where it
 * writes none, its bare numbers (no unit) outside a vector, so an axis
 * written as [1 1 0] is no angle.
 */
function anglesOf(ns: readonly WrittenNumber[]): number[] {
  const degrees = ns.filter((n) => n.unit === "deg");
  return values(degrees.length ? degrees : ns.filter((n) => n.unit === null && !n.inVector));
}

/**
 * A span as the graders read it: a negation or an absence negates (W2); a
 * condition or a plan that opens it makes it tentative (a hedge later in it
 * does not, W4); a question mark ends a question. Its numbers are the app's
 * reading of them (writtenNumbers: a number inside a name such as hk0, 3D or
 * 6/mmm is none), each as written: a percentage is its own number (W7).
 */
function graded(s: Span): GradedSpan {
  return {
    text: s.text,
    negated: s.cues.has("negation") || s.cues.has("absence"),
    tentative: s.opens === "conditional" || s.opens === "plan",
    question: s.question,
    numbers: values(s.numbers),
    angles: anglesOf(s.numbers),
  };
}

/**
 * The shared reader: the answer read by answerText/ with its own options (a
 * clause ends at a spaced dash too, W1; a curly apostrophe reads as a
 * straight one), the answer word apart as the answer checks read it.
 */
export const sharedReader: GraderReader = (answer) => {
  const read = readAnswer(answer);
  return { sentences: read.sentences.map(graded), clauses: read.clauses.map(graded), numbers: values(read.numbers) };
};

/** The reader the graders grade by. */
export const graderReader: GraderReader = sharedReader;

/** What a check decides of an answer, read, in its run. */
export type Decide = (answer: GradedAnswer, run: EvalRun) => { pass: boolean; detail: string };

/** A check on an answer's words: it decides on the answer as the graders' reader reads it. */
export function readCheck(name: string, decide: Decide): Check {
  return { name, grade: (run) => decide(graderReader(run.content), run) };
}
