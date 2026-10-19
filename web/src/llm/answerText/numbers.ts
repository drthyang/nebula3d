// The numbers an answer writes, as written, and the numbers in its sources.
// Moved from the answer checks (answerChecks.ts) unchanged in what they read:
// each written number's text, value, tolerance and sign are as they were. A
// written number also says its unit and whether it sits in a vector.

export type Unit = "deg" | "inv_angstrom" | "angstrom" | "rlu" | "percent";

export interface WrittenNumber {
  text: string; // as written
  value: number;
  tolerance: number; // half a unit of the last digit written (of the last non-zero one, for a round integer)
  percent: boolean;
  signed: boolean; // written with a + or − of its own
  unit: Unit | null; // the unit written after it: °/deg, Å⁻¹, Å, r.l.u., %; null for none
  inVector: boolean; // a component of a vector in brackets: [1 1 0], (0.03, 0.02, 0), ⟨½ ½ 0⟩
}

const SUPERSCRIPT: Record<string, string> = { "⁻": "-", "⁺": "+", "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };

/**
 * Where Å's exponent −1 was, flatten leaves this private-use mark in its
 * place: neither a digit, a letter, a sign nor a point, so every number reads
 * as it did when the exponent was dropped, and the unit after one can be told
 * from Å.
 */
const PER_ANGSTROM = "";

/** Text with exponents as e-notation, unit exponents (Å⁻¹, Q²) and list markers dropped (Å⁻¹'s marked). */
function flatten(text: string): string {
  return text
    .replace(/\$/g, "")
    .replace(/\\(times|cdot)/g, "×")
    .replace(/\\[,;:! ]/g, " ")
    .replace(/\^\{([^}]*)\}/g, "^$1")
    .replace(/[⁻⁺⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => "^" + [...m].map((c) => SUPERSCRIPT[c]).join(""))
    .replace(/−/g, "-")
    .replace(/(\d(?:\.\d+)?)\s*[×x·]\s*10\s*\^\s*\(?([-+]?\d+)\)?/g, "$1e$2")
    .replace(/(?<![\d.])10\s*\^\s*\(?([-+]?\d+)\)?/g, "1e$1")
    .replace(/Å(\s*)\^\s*\(?-1\)?(?!\d)/g, `Å$1${PER_ANGSTROM}`)
    .replace(/\^\s*\(?[-+]?\d+\)?/g, "")
    .replace(/^\s*(?:[-*]\s+)?\(?\d+[.)]\s+/gm, "");
}

/** The unit written right after a number, in flattened text. */
function unitAfter(tail: string): Unit | null {
  if (/^\s*(°|deg(rees?)?\b)/i.test(tail)) return "deg";
  if (new RegExp(`^\\s*(Å\\s*${PER_ANGSTROM}|Å\\s?-1(?!\\d)|1/Å)`).test(tail)) return "inv_angstrom";
  if (/^\s*Å/.test(tail)) return "angstrom";
  if (/^\s*(r\.\s?l\.\s?u\b\.?|rlu\b)/i.test(tail)) return "rlu";
  return null;
}

/** A vector in brackets, in flattened text: two or more numbers (or ½, ¼, ¾) between [ ], ( ) or ⟨ ⟩. */
const COMPONENT = "[-+]?(?:\\d+(?:\\.\\d+)?(?:e[-+]?\\d+)?|[½¼¾])";
const VECTOR = new RegExp(`[[(⟨]\\s*${COMPONENT}(?:(?:\\s*,\\s*|\\s+)${COMPONENT})+\\s*[\\])⟩]`, "gi");

/** The numbers an answer writes, as written; numbers inside names (hk0, 3D, 6/mmm, 201x201) are not numbers. */
export function writtenNumbers(text: string): WrittenNumber[] {
  const out: WrittenNumber[] = [];
  // Thousands separators in prose ("12,345"); not in the sources, where a
  // comma separates a JSON list's items.
  const prose = flatten(text).replace(/(?<![\d.,])\d{1,3}(?:,\d{3})+(?![\d,]|\.\d)/g, (m) => m.replace(/,/g, ""));
  const vectors = [...prose.matchAll(VECTOR)].map((m) => [m.index, m.index + m[0].length] as const);
  const re = /(?<![A-Za-z_\d.^/])([-+]?)(\d+(?:\.(\d+))?)(?:e([-+]?\d+))?(\s*%)?(?![A-Za-z_\d/]|\.\d)/gi;
  for (const m of prose.matchAll(re)) {
    const [whole, sign, mantissa, decimals = "", exp, percent] = m;
    const scale = exp ? 10 ** Number(exp) : 1;
    const value = Number(`${sign}${mantissa}`) * scale;
    if (!Number.isFinite(value)) continue;
    // A round integer is as precise as its last non-zero digit: 1500 is 1532 rounded.
    const zeros = !decimals && !exp ? (/0+$/.exec(mantissa.replace(/^0+(?=\d)/, ""))?.[0].length ?? 0) : 0;
    const unit = decimals ? 10 ** -decimals.length : 10 ** Math.min(zeros, Math.max(mantissa.length - 1, 0));
    out.push({
      text: whole.trim(),
      value,
      tolerance: 0.5 * unit * scale,
      percent: Boolean(percent),
      signed: sign !== "",
      unit: percent ? "percent" : unitAfter(prose.slice(m.index + whole.length)),
      inVector: vectors.some(([from, to]) => m.index >= from && m.index < to),
    });
  }
  return out;
}

export interface SourceNumbers {
  all: number[]; // every number, as a magnitude, sorted
  negative: number[]; // the magnitudes of those written with a minus sign, sorted
  positive: number[]; // the magnitudes of the others, sorted
}

/** Every number in the sources, sorted: all of them, and by sign. A minus counts
 * only right before the digits with no digit or point before it, so a range
 * ("4-8") reads as two positive numbers. */
export function sourceNumbers(sources: string): SourceNumbers {
  const all: number[] = [];
  const negative: number[] = [];
  const positive: number[] = [];
  for (const m of flatten(sources).matchAll(/(?<![\d.])(-?)(\d+(?:\.\d+)?(?:e[-+]?\d+)?)/gi)) {
    const v = Math.abs(Number(m[2]));
    if (!Number.isFinite(v)) continue;
    all.push(v);
    (m[1] === "-" ? negative : positive).push(v);
  }
  const sort = (xs: number[]) => xs.sort((a, b) => a - b);
  return { all: sort(all), negative: sort(negative), positive: sort(positive) };
}
