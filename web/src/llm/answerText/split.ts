// Where an answer's sentences and clauses begin and end.

/** Markdown emphasis, which no reading keeps. */
const EMPHASIS = /\*\*|__|`/g;

/** The answer's sentences: lines and sentence ends split it, its Markdown emphasis out. */
export function sentenceTexts(text: string): string[] {
  return text
    .replace(EMPHASIS, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A leading answer word ("Yes,", "No:"), not the "No" of "No ring is left". */
export const ANSWER_WORD = /^(yes|no)\s*[,:.!—–-]\s*/i;

/** A sentence's leading answer word, and the sentence without it. */
export function answerWordOf(sentence: string): { answer: "yes" | "no" | null; rest: string } {
  const m = ANSWER_WORD.exec(sentence);
  return m ? { answer: m[1].toLowerCase() === "yes" ? "yes" : "no", rest: sentence.slice(m[0].length) } : { answer: null, rest: sentence };
}

/** A label before a colon this short (in words) keeps what follows it in its clause: "Ring removal: clean". */
const SHORT_LABEL = 3;

/**
 * A sentence's clauses, its answer word out: it splits at "; ", at a spaced
 * dash (" — ", " – ") when *dashes*, and at ": " after a label of more than
 * three words, so "The UB is fine: the fit changed nothing" makes its claim
 * without the next clause's negation.
 */
export function clauseTexts(rest: string, { dashes }: { dashes: boolean }): string[] {
  return rest
    .split(dashes ? /;\s+|\s[—–]\s/ : /;\s+/)
    .map((s) => s.trim())
    .flatMap((s) => {
      const parts = s.split(/:\s+/);
      return parts.length > 1 && parts[0].split(/\s+/).length <= SHORT_LABEL ? [s] : parts;
    })
    .map((c) => c.trim())
    .filter(Boolean);
}
