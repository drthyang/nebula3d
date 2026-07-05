// Message builders for each assistant feature.  Each returns the `messages`
// array for a chat-completions call; the run context always travels inside a
// fenced JSON block so the model can tell data from instructions.  When an image
// data-URL is supplied (vision opt-in), it is attached as a second content part
// on the triggering user message.

import type { ChatMessage, ContentPart } from "../provider/client";
import { contextToJson, type PipelineContext } from "../context/pipelineContext";
import { SYSTEM_PROMPT } from "./system";

const contextBlock = (context: PipelineContext): string =>
  `Diagnostic context for this reduction (metrics computed from the current cut):\n\`\`\`json\n${contextToJson(context)}\n\`\`\``;

// Attach an optional image to a text prompt, producing either a plain string or
// the multimodal content-parts array the vision path needs.
const withImage = (text: string, imageDataUrl?: string | null): string | ContentPart[] => {
  if (!imageDataUrl) return text;
  return [
    { type: "text", text },
    { type: "image_url", image_url: { url: imageDataUrl } },
  ];
};

// Keep only the newest turns so long conversations stay inside small local
// models' context windows; the diagnostic context is re-sent every call anyway.
export const CHAT_HISTORY_TURNS = 8;

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export const buildChatMessages = (
  context: PipelineContext,
  history: HistoryTurn[],
  userText: string,
  imageDataUrl?: string | null,
): ChatMessage[] => [
  { role: "system", content: SYSTEM_PROMPT },
  { role: "user", content: contextBlock(context) },
  {
    role: "assistant",
    content: "Understood. I will assess this reduction using only the metrics above (and any image you attach), quoting the numbers I rely on.",
  },
  ...history.slice(-CHAT_HISTORY_TURNS).map((t) => ({ role: t.role, content: t.content })),
  { role: "user", content: withImage(userText, imageDataUrl) },
];

// The four one-click stage reviews.  Each is a focused instruction answered
// against the same shared context; `dpdf` and the reciprocal stages can carry an
// image so a vision model assesses the picture alongside the metrics.
export type ReviewStage = "rings" | "punch" | "backfill" | "dpdf";

const STAGE_INSTRUCTION: Record<ReviewStage, string> = {
  rings: "Assess the Al/powder ring removal for this cut. Using ring_removal, judge how completely the rings were subtracted and whether the subtraction over-shot into negative (over-subtracted) territory. If an image is attached, note any residual rings or dark halos. State the optimal display contrast to inspect it. Give a short verdict and one concrete suggestion if it can be improved.",
  punch: "Review the Bragg punch. From bragg_punch.leftover, say whether any suspicious sharp peaks were left unpunched (quote their position, contrast and σ), or confirm none survived. Then characterise the peak profile from bragg_punch.peak_profile (resolution-limited fraction, measured widths, anisotropy) and comment on whether the punch radii look appropriate. End with a verdict and any suggestion.",
  backfill: "Judge the backfill quality from the backfill metrics. Is the fill seamless (median_seam_sigma), are there bright residual plugs (bright_fill_fraction), and is there any strange periodic/checkerboard pattern (checkerboard_fraction)? If an image is attached, describe the filled regions. Give a verdict and a suggestion if warranted.",
  dpdf: "Analyse the 3D-ΔPDF features from delta_pdf. Are there features clearly stronger than the background noise (feature_snr, strong_feature_fraction)? Are the correlations anisotropic, and along what direction (anisotropy_ratio, anisotropy_angle_deg)? What is the trend with distance (radial_trend), and is the ΔPDF trustworthy (consistency_pearson_r)? If an image is attached, describe the pattern you see. Summarise the correlation picture in a few sentences.",
};

export const buildStageReviewMessages = (
  context: PipelineContext,
  stage: ReviewStage,
  imageDataUrl?: string | null,
): ChatMessage[] => [
  { role: "system", content: SYSTEM_PROMPT },
  { role: "user", content: contextBlock(context) },
  {
    role: "assistant",
    content: "Understood. I will assess the requested stage using only the metrics above and any attached image.",
  },
  { role: "user", content: withImage(STAGE_INSTRUCTION[stage], imageDataUrl) },
];

export const STAGE_REVIEW_LABELS: Record<ReviewStage, string> = {
  rings: "Assess ring removal",
  punch: "Review Bragg punch",
  backfill: "Check backfill",
  dpdf: "Analyse ΔPDF features",
};
