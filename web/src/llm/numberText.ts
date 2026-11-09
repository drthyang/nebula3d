// Numbers in the words the app shows (the chat, the report, a filled-in
// reference): never float noise. A tool rounds what it measures, but a value
// a tool hands over whole (a ratio of two floats, an axis sample of a float32
// grid) reads as 0.000003141592653589793 when JavaScript writes it out, and a
// model that copies a number copies it as written. The app layer rounds what
// it shows: a number with more than NOISE_FIGURES significant figures is float
// noise, shown to SHOWN_FIGURES; a tiny one is written in exponent form, as
// the checks write theirs (2.4e-4, not 0.00024).

/** More significant figures than this is float noise, not a measurement. */
export const NOISE_FIGURES = 8;
/** What float noise is shown to. */
export const SHOWN_FIGURES = 4;

/** The significant figures a decimal literal is written with ("0.000120" → 3, "1.5e-7" → 2). */
function figures(literal: string): number {
  const mantissa = literal.replace(/^[-+]/, "").replace(/e[-+]?\d+$/i, "");
  return mantissa.replace(".", "").replace(/^0+/, "").length;
}

/** A number as the app writes it: float noise rounded, a tiny one in exponent form (9.93e-6). */
export function numberText(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  const r = figures(String(x)) > NOISE_FIGURES ? Number(x.toPrecision(SHOWN_FIGURES)) : x;
  if (r === 0) return "0";
  return Math.abs(r) < 1e-3 ? r.toExponential() : String(r);
}

// A decimal literal, signed or not, with an exponent or not; not part of a
// word, a version (0.4.0) or an address, and not the integer before a dot.
const DECIMAL = /(?<![\p{L}\p{N}_.])([-+]?(?:\d+\.\d+|\.\d+)(?:e[-+]?\d+)?)(?![\p{L}\p{N}_]|\.\d)/giu;

/** `text` with every decimal written with more than NOISE_FIGURES significant figures rounded (numberText). */
export function tidyNumbers(text: string): string {
  if (!/\d\.\d{8}/.test(text) && !/\d{9}/.test(text)) return text;
  return text.replace(DECIMAL, (literal) => (figures(literal) > NOISE_FIGURES ? numberText(Number(literal)) : literal));
}
