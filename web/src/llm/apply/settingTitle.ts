// A setting's name as the console shows it, for the app's own lines (the
// cards, the Changes list, a step's line in the transcript and the Auto
// panel, a tuning trial's row): its stage's word and its Configure label
// ("Punch footprint", "Ring stack window (°)"), never its key (punchFootprint).
// The keys stay what the model and the tools read.

import { settingLabel } from "../../pages/configSections";
import { TUNE_PARAMS, type TuneStage } from "../tune/catalog";

const STAGE_WORD: Record<TuneStage, string> = { rings: "Ring", punch: "Punch", backfill: "Backfill", flatten: "Background", pdf: "ΔPDF" };

const lowerFirst = (s: string): string => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/** A method setting's name on a card: its stage's word and its Configure label (pages/configSections.ts). */
export const methodTitle = (key: string, stage: TuneStage): string => `${STAGE_WORD[stage]} ${lowerFirst(settingLabel(key))}`;

/** Any setting's name in the app's words: a method setting's with its stage's word, another's Configure label. */
export function settingTitle(key: string): string {
  const p = TUNE_PARAMS.find((x) => x.key === key);
  return p ? methodTitle(key, p.stage) : settingLabel(key);
}

/** A trial card's changes ("punchFootprint=own, …", as the record and the since line keep them) in console names: "Punch footprint own". */
export const trialChangesText = (to: string): string =>
  to.replace(/\b([a-z][A-Za-z0-9]*)=/g, (_, key: string) => `${settingTitle(key)} `);
