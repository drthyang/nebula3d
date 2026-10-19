// The text the model reads, by class: the rule the manager set for the
// skills' switch (skills.ts), decided for RMC and applied the same way here.
//
// - A definition says what a field, a setting, a tool, a reading or a stage
//   is, its units, how it is computed (a check's verdict and the rule it is
//   computed by included), its limits as a measurement, or how to use the
//   tools (generic procedure: call them rather than guess, quote their
//   numbers, measure after a run). It stays with the skills off.
// - An inference says which reading, cut or check to use for a conclusion
//   ("reading"), what a value or a pattern is evidence of ("evidence"), or what
//   a finding calls for: a change, the check to run next, what to report
//   ("remedy"). It is the method: with the skills off (the validation's arm C)
//   the model reads none of it.
//
// The class is decided once, where the text is written: a text is a template
// whose `${inferred(kind, "…")}` spans are inference and the rest definition,
// or a sequence of such spans. Rendered whole it is the text as written, byte
// for byte (the console and arm B); rendered for arm C its inference spans are
// left out, and the spaces they leave are tidied. A text written once at load
// registers its spans under where it is written (`writtenInferences`), so the
// tests can list, and look for, every one; a text built for each call (a
// verdict with its numbers) takes its spans from constants written with
// `inference`, which register the same way.

export type InferenceKind = "reading" | "evidence" | "remedy";

/** A span of inference: left out with the skills off. */
export interface Inferred {
  readonly kind: InferenceKind;
  readonly text: string;
}

/** A span of a text: a definition (a string) or an inference. */
export type Span = string | Inferred;

const isInferred = (s: Span): s is Inferred => typeof s !== "string";

/** Where each inference span is written, and the text it sits in where that is written once. */
export interface WrittenInference {
  source: string;
  span: Inferred;
  in?: Tagged;
}

const WRITTEN: WrittenInference[] = [];
// The texts written once that hold inference, by their whole text: what a
// JSON value written from one is, with the skills off (withoutInference).
const BY_WHOLE = new Map<string, Tagged>();

/** Every inference span written at load: in a text written once, or a constant a text built for each call uses. */
export const writtenInferences = (): readonly WrittenInference[] => WRITTEN;

/**
 * A JSON value (a tool's result, the opening context) as the model reads it
 * with the skills off: every string that is, whole, a text written once with
 * inference becomes that text's definitions. A text built for each call (a
 * verdict with its numbers) is rendered by the switch where it is built.
 */
export function withoutInference(value: unknown): unknown {
  if (typeof value === "string") return BY_WHOLE.get(value)?.definitions ?? value;
  if (Array.isArray(value)) return value.map(withoutInference);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withoutInference(v)]));
  return value;
}

/** The spaces a left-out span leaves: two spaces as one, none before a line's end or a closing mark, nor at either end; at most one empty line. */
function tidy(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/ +([.,;:)])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[ \t]+|[ \t]+$/g, "");
}

/** A text as spans, each a definition or an inference. */
export class Tagged {
  constructor(readonly spans: readonly Span[]) {}

  /** The text whole, as written: with the skills on (the console, arm B). */
  get whole(): string {
    return this.spans.map((s) => (isInferred(s) ? s.text : s)).join("");
  }

  /** The text without its inference: with the skills off (arm C). */
  get definitions(): string {
    return this.hasInference ? tidy(this.spans.filter((s): s is string => !isInferred(s)).join("")) : this.whole;
  }

  /** The text as the switch has it: whole with the skills on, its definitions with them off. */
  text(skills: boolean): string {
    return skills ? this.whole : this.definitions;
  }

  get inferences(): readonly Inferred[] {
    return this.spans.filter(isInferred);
  }

  get hasInference(): boolean {
    return this.spans.some(isInferred);
  }

  /** The text whole, its inference spans marked ⟦…⟧: how the listing of what arm C does not read shows it. */
  get marked(): string {
    return this.spans.map((s) => (isInferred(s) ? `⟦${s.text}⟧` : s)).join("");
  }
}

/** A span of inference, inline in a template. */
export const inferred = (kind: InferenceKind, text: string): Inferred => ({ kind, text });

/** Which reading, cut or check to use for a conclusion. */
export const reading = (text: string): Inferred => inferred("reading", text);
/** What a value or a pattern is evidence of. */
export const evidence = (text: string): Inferred => inferred("evidence", text);
/** What a finding calls for: a change, the check to run next, what to report. */
export const remedy = (text: string): Inferred => inferred("remedy", text);

/** A span of inference written as a constant, for a text built for each call: registered under `source`. */
export function inference(source: string, kind: InferenceKind, text: string): Inferred {
  const span = inferred(kind, text);
  WRITTEN.push({ source, span });
  return span;
}

/** What a template takes between its strings: a number or a string (definition), an inference, or a tagged text. */
export type Value = string | number | Inferred | Tagged;

const spansOf = (strings: readonly string[], values: readonly Value[]): Span[] => {
  const spans: Span[] = [];
  strings.forEach((s, i) => {
    if (s) spans.push(s);
    if (i >= values.length) return;
    const v = values[i];
    if (v instanceof Tagged) spans.push(...v.spans);
    else spans.push(typeof v === "number" ? String(v) : v);
  });
  return spans;
};

/**
 * A text written once, at load: a template whose `${inferred(…)}` spans are
 * inference. Its spans are registered under `source` (the module and what the
 * text is), for the tests.
 */
export const written =
  (source: string) =>
  (strings: TemplateStringsArray, ...values: Value[]): Tagged => {
    const t = new Tagged(spansOf([...strings], values));
    for (const span of t.inferences) WRITTEN.push({ source, span, in: t });
    if (t.hasInference) BY_WHOLE.set(t.whole, t);
    return t;
  };

/** A text built for each call (a verdict with its numbers): its inference spans are constants written with `inference`. */
export const built = (strings: TemplateStringsArray, ...values: Value[]): Tagged => new Tagged(spansOf([...strings], values));

/** Spans joined as one text (lines of a prompt, parts of a description). */
export const joined = (parts: readonly (Span | Tagged)[], separator = ""): Tagged =>
  new Tagged(parts.flatMap((p, i) => [...(i && separator ? [separator] : []), ...(p instanceof Tagged ? p.spans : [p])]));
