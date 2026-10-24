// One reader of an answer's words (plan 3.2), for the answer checks
// (answerChecks.ts) and the validation's graders (evals/graderReading.ts)
// alike. It reads an answer into plain data: its sentences and their clauses,
// the cues each holds (cues.ts) and the cue that opens it, whether it asks,
// and the numbers it writes with their units (numbers.ts). It holds no topic
// and no claim, and decides nothing: what a negation or a hedge does to a
// verdict or a grade is each reader's policy, and where the two keep
// different policies each is named and pinned (answerTextPins.test.ts).

import { cuesIn, openingCue, type Cue } from "./cues";
import { writtenNumbers, type WrittenNumber } from "./numbers";
import { answerWordOf, clauseTexts, sentenceTexts } from "./split";

export { CUES, type Cue } from "./cues";
export { sourceNumbers, writtenNumbers, type SourceNumbers, type Unit, type WrittenNumber } from "./numbers";
export { ANSWER_WORD } from "./split";

/** A stretch of an answer, read. */
export interface Span {
  text: string; // as written, Markdown emphasis out (a sentence's with its answer word, a clause's without)
  cues: ReadonlySet<Cue>; // the cue classes whose words it holds (a sentence's, after its answer word)
  opens: Cue | null; // the cue class whose words open it
  question: boolean; // it ends with a question mark
  numbers: readonly WrittenNumber[]; // the numbers it writes, as written
}

/** A sentence: lines and sentence ends split an answer into them. */
export interface Sentence extends Span {
  answer: "yes" | "no" | null; // a leading answer word ("Yes,", "No:"), which is no negation
  clauses: readonly Span[]; // its claims: it split at "; ", at ": " after a long label, and at a spaced dash (with dashes)
}

export interface AnswerReading {
  sentences: readonly Sentence[];
  clauses: readonly Span[]; // every sentence's, in order
  numbers: readonly WrittenNumber[]; // every number the answer writes, as written
}

export interface ReadOptions {
  dashes?: boolean; // split a clause at a spaced dash (default true)
  apostrophes?: boolean; // read a curly apostrophe (’) as a straight one in the cues (default true)
}

function span(text: string, cueText: string, apostrophes: boolean): Span {
  return {
    text,
    cues: cuesIn(cueText, { apostrophes }),
    opens: openingCue(cueText, { apostrophes }),
    question: text.endsWith("?"),
    numbers: writtenNumbers(text),
  };
}

/** An answer's words, read. */
export function readAnswer(text: string, { dashes = true, apostrophes = true }: ReadOptions = {}): AnswerReading {
  const sentences = sentenceTexts(text).map((s): Sentence => {
    const { answer, rest } = answerWordOf(s);
    return {
      ...span(s, rest, apostrophes),
      answer,
      clauses: clauseTexts(rest, { dashes }).map((c) => span(c, c, apostrophes)),
    };
  });
  return { sentences, clauses: sentences.flatMap((s) => s.clauses), numbers: writtenNumbers(text) };
}
