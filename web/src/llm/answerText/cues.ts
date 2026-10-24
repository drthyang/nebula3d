// The words that make a span of an answer say less than a plain claim: it
// negates, says a thing is absent, doubts, weighs a condition, plans, or
// speaks of what could be, of what comes next or of what a step is for. The
// reader reports which are there and which opens the span; what each means
// for a verdict or a grade is the readers' policy (answerChecks.ts, the
// graders), not the reader's.

export type Cue = "negation" | "absence" | "doubt" | "conditional" | "plan" | "modal" | "sequence" | "purpose";

export const CUES: readonly Cue[] = ["negation", "absence", "doubt", "conditional", "plan", "modal", "sequence", "purpose"];

/**
 * Each class's words. negation: the answer checks' negations as they were
 * (answerChecks.ts); absence: what the graders' list added to them
 * (evals/checks.ts); doubt: the answer checks' other hedge on a claim; the
 * last five: the answer checks' words of a sentence that is not a verdict,
 * by class.
 */
const WORDS: Readonly<Record<Cue, string>> = {
  negation: "no|not|never|none|nothing|neither|nor|without|cannot|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|won't|lacks?",
  absence: "nowhere|too (few|weak|small|faint)|insufficient",
  doubt: "unlikely|doubt\\w*",
  conditional: "if|whether|unless",
  plan: "let me|i will|i'll|i'd|i'm going to",
  modal: "would|could|might|may",
  sequence: "once|until|next",
  purpose: "to check|to see",
};

/** A class's words anywhere in a span (a negation also as a contraction: "shouldn't"). */
const ANYWHERE = Object.fromEntries(CUES.map((c) => [c, new RegExp(`\\b(${WORDS[c]})\\b${c === "negation" ? "|n't\\b" : ""}`, "i")])) as Record<Cue, RegExp>;

/** A class's words opening a span, after any punctuation, bullet or quote before its first word. */
const OPENING = Object.fromEntries(CUES.map((c) => [c, new RegExp(`^[^A-Za-z0-9]*(${WORDS[c]})\\b`, "i")])) as Record<Cue, RegExp>;

/** The text as the cues read it: with *apostrophes*, a curly apostrophe (’) as a straight one. */
const asRead = (text: string, apostrophes: boolean): string => (apostrophes ? text.replace(/’/g, "'") : text);

/** The cue classes whose words the span holds. */
export function cuesIn(text: string, { apostrophes }: { apostrophes: boolean }): Set<Cue> {
  const read = asRead(text, apostrophes);
  return new Set(CUES.filter((c) => ANYWHERE[c].test(read)));
}

/** The cue class whose words open the span, or null. */
export function openingCue(text: string, { apostrophes }: { apostrophes: boolean }): Cue | null {
  const read = asRead(text, apostrophes);
  return CUES.find((c) => OPENING[c].test(read)) ?? null;
}
