// The Highlights' tones as colours (index.css tokens): the overlay layer
// (HighlightLayer) and the legend (ExamineBar) draw with the same.

import type { Tone } from "../llm/examine/overlays";

/** Each tone's colour (index.css tokens): the views and the legend draw with the same. */
export const TONE: Record<Tone, string> = {
  red: "var(--red)",
  amber: "var(--amber)",
  green: "var(--green)",
  cyan: "var(--hl-cyan)",
  grey: "var(--hl-grey)",
  white: "#ffffff",
  r2: "var(--r2)",
  accent: "var(--accent-hi)",
  blue: "var(--hl-blue)",
  teal: "var(--hl-teal)",
};
