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
// - a curly apostrophe reads as a straight one ("isn’t");
// - a span that ends with a question mark asks; one that a condition or a
//   plan opens ("If …", "I will …") is tentative;
// - a number glued to a letter is a name's, not a number (hk0, 3D, 201x201);
// - a span's angles are its numbers in degrees, or where it writes none, its
//   bare numbers (no unit, no power) outside brackets: an axis [1 1 0] is
//   no angle.

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

/** A number the text writes, with what is written around it. */
interface Found {
  value: number;
  exponent: boolean; // written after a caret: a power, as Å⁻¹'s −1, not a quantity
  degrees: boolean; // ° (or LaTeX ^\circ) or deg after it
  unit: boolean; // some other unit after it: %, Å, r.l.u.
  inBrackets: boolean; // one of two or more numbers in [ ], ( ) or ⟨ ⟩
}

/** A vector: two or more numbers (or ½) in brackets, set apart by commas or spaces. */
const ITEM = "[-+]?(?:\\d+(?:\\.\\d+)?(?:e[-+]?\\d+)?|[½¼¾])";
const BRACKETED = new RegExp(`[[(⟨]\\s*${ITEM}(?:\\s*,\\s*${ITEM}|\\s+${ITEM})+\\s*[\\])⟩]`, "gi");

/**
 * Every number the text writes: decimals, exponents (1e-3, 1×10⁻³, 1 x 10^-3,
 * LaTeX 1 \times 10^{-3}) and percentages as written; a number glued to a
 * letter is a name's (hk0, 3D, 201x201), not a number.
 */
function found(text: string): Found[] {
  const flat = text
    .replace(/\$/g, "")
    .replace(/\\(times|cdot)/g, "×")
    .replace(/\^\{([^}]*)\}/g, "^$1")
    .replace(/[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => "^" + [...m].map((c) => SUPERSCRIPT[c]).join(""))
    .replace(/(\d)\s*[×x·]\s*10\s*\^?\s*\(?([-+−]?\d+)\)?/g, (_m, a, e) => `${a}e${String(e).replace("−", "-")}`)
    .replace(/−/g, "-")
    // A power of ten alone (10⁻³) is one number, and so is 12,345 in prose.
    .replace(/(?<![\d.])10\s*\^\s*\(?([-+]?\d+)\)?/g, (_m, e) => `1e${e}`)
    .replace(/\b\d{1,3}(?:,\d{3})+\b(?![,.]\d)/g, (m) => m.replace(/,/g, ""));
  const brackets = [...flat.matchAll(BRACKETED)].map((m) => [m.index, m.index + m[0].length]);
  const out: Found[] = [];
  // A sign counts only where nothing alphanumeric precedes it: "0.8-10" is a range, not −10.
  for (const m of flat.matchAll(/(?<![\w)\]}.])[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?|\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi)) {
    const value = Number(m[0]);
    const before = flat.slice(0, m.index);
    const after = flat.slice(m.index + m[0].length);
    if (!Number.isFinite(value) || /[A-Za-z]$/.test(before) || /^[A-Za-z]/.test(after)) continue;
    out.push({
      value,
      exponent: /\^\s*\(?$/.test(before),
      degrees: /^\s*(°|\^\s*\\circ\b|\\degree\b|deg)/i.test(after),
      unit: /^\s*(%|Å|r\.\s?l\.\s?u|rlu\b)/i.test(after),
      inBrackets: brackets.some(([from, to]) => m.index >= from && m.index < to),
    });
  }
  return out;
}

/** The angles among a span's numbers: those in degrees; where it writes none, its bare numbers outside brackets. */
function angles(numbers: Found[]): number[] {
  const degrees = numbers.filter((n) => n.degrees);
  return (degrees.length ? degrees : numbers.filter((n) => !n.exponent && !n.unit && !n.inBrackets)).map((n) => n.value);
}

/** Words that put what follows them as a condition or a plan, when they come first. */
const LEADING_CONDITION_OR_PLAN = /^[^a-z0-9]*(if|whether|unless|let me|i will|i'll|i'd|i'm going to)\b/i;

/** A span: whether it negates, is tentative (*words*: the span without a leading answer word) or asks, and its numbers. */
function span(text: string, words: string): WitnessSpan {
  const numbers = found(text);
  return {
    text,
    negated: negates(words),
    tentative: LEADING_CONDITION_OR_PLAN.test(words.replace(/’/g, "'")),
    question: text.endsWith("?"),
    numbers: numbers.map((n) => n.value),
    angles: angles(numbers),
  };
}

/** An answer, as the witness reads it. */
export function witness(answer: string): WitnessReading {
  return {
    sentences: sentences(answer).map((s) => span(s, s.replace(ANSWER_WORD, ""))),
    clauses: clauses(answer).map((c) => span(c, c)),
    numbers: found(answer).map((n) => n.value),
  };
}
