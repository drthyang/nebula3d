// The witness: a second, minimal reading of an answer's words for the
// graders, written apart from the reader (answerText/) and importing nothing,
// so that a fault in one is not a fault in the other. Duplicated on purpose.
//
// It reads an answer as graderReading.ts's port does: its sentences and its
// clauses, each with whether it negates, and the numbers it writes. This is
// the graders' own parse as it was before the shared reader (evals/checks.ts
// and evals/validation.ts), moved here unchanged.

/** A span of the answer, as the witness reads it (graderReading.ts: GradedSpan). */
export interface WitnessSpan {
  text: string;
  negated: boolean;
  tentative: boolean;
  question: boolean;
  numbers: number[];
  angles: number[];
}

/** An answer, as the witness reads it (graderReading.ts: GradedAnswer). */
export interface WitnessReading {
  sentences: WitnessSpan[];
  clauses: WitnessSpan[];
  numbers: number[];
}

const NEGATION = /\b(no|not|never|none|nothing|nowhere|neither|nor|without|cannot|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|won't|shouldn't|wouldn't|lacks?|too (few|weak|small|faint)|insufficient)\b|n't\b/i;

/** A leading answer word ("Yes,", "No:"), which answers and does not negate. */
const ANSWER_WORD = /^(yes|no)\s*[,:.!—–-]\s*/i;

/** The answer's sentences (lines and sentence ends split it). */
function sentences(text: string): string[] {
  return text
    .replace(/\*\*|__|`/g, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The answer's clauses: a sentence, or the part of one that a semicolon or a spaced dash sets off. */
function clauses(text: string): string[] {
  return sentences(text)
    .flatMap((s) => s.split(/;\s+|\s[—–]\s/))
    .map((s) => s.trim())
    .filter(Boolean);
}

const SUPERSCRIPT: Record<string, string> = { "⁻": "-", "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };

/** Every number the text writes: decimals, exponents (1e-3, 1×10⁻³, 1 x 10^-3, LaTeX 1 \times 10^{-3}) and percentages as written. */
function numbers(text: string): number[] {
  const flat = text
    .replace(/\$/g, "")
    .replace(/\\(times|cdot)/g, "×")
    .replace(/\^\{([^}]*)\}/g, "^$1")
    .replace(/[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => "^" + [...m].map((c) => SUPERSCRIPT[c]).join(""))
    .replace(/(\d)\s*[×x·]\s*10\s*\^?\s*\(?([-+−]?\d+)\)?/g, (_m, a, e) => `${a}e${String(e).replace("−", "-")}`)
    .replace(/−/g, "-");
  // A sign counts only where nothing alphanumeric precedes it: "0.8-10" is a range, not −10.
  return [...flat.matchAll(/(?<![\w)\]}.])[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?|\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi)]
    .map((m) => Number(m[0]))
    .filter(Number.isFinite);
}

/** A span: it negates unless the negation is a leading answer word. */
function span(text: string): WitnessSpan {
  const written = numbers(text);
  return { text, negated: NEGATION.test(text.replace(ANSWER_WORD, "")), tentative: false, question: false, numbers: written, angles: written };
}

/** An answer, as the witness reads it. */
export function witness(answer: string): WitnessReading {
  return { sentences: sentences(answer).map(span), clauses: clauses(answer).map(span), numbers: numbers(answer) };
}
