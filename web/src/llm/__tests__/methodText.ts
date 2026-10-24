// What of the method a text the model reads still holds, for the tests of the
// skills' switch (skills.ts: the validation's arm C): the skills' names and
// the sentences of their text it holds, and the names of the tools, the stages
// and the skills that a send-back's own words name. A send-back may quote the
// model's own words (“…”), which name what the model wrote; its own words, the
// rest, are held to name none.

import { PIPELINE_STAGES } from "../evidence";
import { allSkills } from "../skills";
import { CHAT_TOOLS } from "../tools";
import { TUNE_STAGE_LABELS, TUNE_STAGES } from "../tune/catalog";

/** The registry's tool names. */
export const TOOL_NAMES: readonly string[] = CHAT_TOOLS.map((t) => t.name);

/** The stages, by the names the code gives them: evidence.ts's and catalog.ts's, and the catalog's labels. */
export const STAGE_NAMES: readonly string[] = [...new Set([...PIPELINE_STAGES, ...TUNE_STAGES, ...Object.values(TUNE_STAGE_LABELS)])];

/** The skills' names. */
export const SKILL_NAMES: readonly string[] = allSkills().map((s) => s.name);

/** A text as the sentence check reads it: lower case, without Markdown's emphasis and code marks, its whitespace one space. */
export const normalise = (text: string): string => text.toLowerCase().replace(/[`*]/g, "").replace(/\s+/g, " ").trim();

export interface SkillSentence {
  skill: string;
  sentence: string; // normalised, without its closing punctuation
  words: number;
}

/**
 * The sentences of each skill's text, its description and its body,
 * normalised: the text cut into its Markdown blocks (paragraphs, list items,
 * headings, without their marks), each block at a sentence's end, a step's
 * bold label ("**Know the data.**") a sentence of its own.
 */
export function skillSentences(): SkillSentence[] {
  return allSkills().flatMap((s) =>
    [s.description, s.body]
      .flatMap((text) => text.split(/\n\s*\n|\n(?=\s*(?:[-*]|\d+\.|#+)\s)/))
      .map((block) => block.replace(/^\s*(?:[-*]\s+(?:\[[ x]\]\s+)?|\d+\.\s+|#+\s+)/, "").replace(/[`*]/g, ""))
      .flatMap((block) => block.split(/(?<=[.!?])\s+/))
      .map((sentence) => normalise(sentence).replace(/[.!?:;,]+$/, ""))
      .filter(Boolean)
      .map((sentence) => ({ skill: s.name, sentence, words: sentence.split(" ").length })),
  );
}

/** The skills' sentences of at least `minWords` words that a text holds whole (each normalised). */
export function skillSentencesIn(text: string, minWords: number): SkillSentence[] {
  const hay = normalise(text);
  return skillSentences().filter((s) => s.words >= minWords && hay.includes(s.sentence));
}

/** The skills' names a text holds, case aside. */
export const skillNamesIn = (text: string): string[] => SKILL_NAMES.filter((n) => text.toLowerCase().includes(n));

/** The quotations of the model's own words in a send-back. */
export const quotations = (text: string): string[] => [...text.matchAll(/“([^”]*)”/g)].map((m) => m[1]);

/** A send-back's own words: the text with its quotations of the model's words taken out. */
export const ownWords = (text: string): string => text.replace(/“[^”]*”/g, "“”");

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether `name` stands in `text` as a name, not inside another word: case aside, and Δ as δ. */
const names = (text: string, name: string): boolean =>
  new RegExp(`(^|[^a-z0-9_])${escape(name.toLowerCase())}($|[^a-z0-9_])`).test(text.toLowerCase());

/** The tools, stages and skills a send-back's own words name, and the word "skill" itself. */
export function namedInOwnWords(text: string): string[] {
  const own = ownWords(text);
  return [
    ...TOOL_NAMES.filter((n) => names(own, n)).map((n) => `tool ${n}`),
    ...STAGE_NAMES.filter((n) => names(own, n)).map((n) => `stage ${n}`),
    ...SKILL_NAMES.filter((n) => names(own, n)).map((n) => `skill ${n}`),
    ...(/\bskills?\b/i.test(own) ? ["the word skill"] : []),
  ];
}
