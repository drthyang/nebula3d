// The witness: a second, minimal reading of an answer's words for the
// graders, written apart from the reader (answerText/) and importing nothing,
// so that a fault in one is not a fault in the other. Duplicated on purpose.
//
// It reads an answer as graderReading.ts's port does: its sentences and its
// clauses, each with whether it negates, and the numbers it writes. It began
// as the graders' own parse before the shared reader (evals/checks.ts and
// evals/validation.ts), and takes the shared reader's rules, written here
// again in its own words:
//
// - a sentence's leading answer word ("Yes,", "No:") is no negation, and no
//   part of its clauses;
// - a clause ends at "; ", at a spaced dash, and at ": " after a label of
//   more than three words;
// - a curly apostrophe reads as a straight one ("isn’t").

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

/** Whether the words negate, a curly apostrophe read as a straight one. */
const negates = (words: string): boolean => NEGATION.test(words.replace(/’/g, "'"));

/** The answer's sentences (lines and sentence ends split it). */
function sentences(text: string): string[] {
  return text
    .replace(/\*\*|__|`/g, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Up to three words before a colon are a label, which stays with what follows it ("Ring removal: clean"). */
function atColons(part: string): string[] {
  const pieces = part.split(/:\s+/);
  const label = pieces[0].split(/\s+/);
  return pieces.length > 1 && label.length > 3 ? pieces : [part];
}

/** The answer's clauses: each sentence, its answer word off, cut at "; ", a spaced dash, and a colon after a long label. */
function clauses(text: string): string[] {
  return sentences(text)
    .map((s) => s.replace(ANSWER_WORD, ""))
    .flatMap((s) => s.split(/;\s+|\s[—–]\s/))
    .map((s) => s.trim())
    .flatMap(atColons)
    .map((s) => s.trim())
    .filter(Boolean);
}

const SUPERSCRIPT: Record<string, string> = { "⁻": "-", "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };

/** Every number the text writes: decimals, exponents (1e-3, 1×10⁻³, 1 x 10^-3, LaTeX 1 \times 10^{-3}) and percentages as written. */
export function witnessNumbers(text: string): number[] {
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

/** A span: whether it negates (*words*: the span without a leading answer word), and its numbers. */
function span(text: string, words: string): WitnessSpan {
  const written = witnessNumbers(text);
  return { text, negated: negates(words), tentative: false, question: false, numbers: written, angles: written };
}

/** An answer, as the witness reads it. */
export function witness(answer: string): WitnessReading {
  return {
    sentences: sentences(answer).map((s) => span(s, s.replace(ANSWER_WORD, ""))),
    clauses: clauses(answer).map((c) => span(c, c)),
    numbers: witnessNumbers(answer),
  };
}
