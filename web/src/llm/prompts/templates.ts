// Message builders for each assistant feature.  Each returns the `messages`
// array for a chat-completions call; the run context always travels inside a
// fenced JSON block so the model can tell data from instructions.  When an image
// data-URL is supplied (vision opt-in), it is attached as a second content part
// on the triggering user message.

import type { ChatMessage, ContentPart } from "../provider/client";
import { contextToJson, type PipelineContext } from "../context/pipelineContext";
import { SYSTEM_PROMPT, TOOLS_PROMPT } from "./system";

const systemMessage = (tools: boolean): ChatMessage => ({
  role: "system",
  content: tools ? SYSTEM_PROMPT + "\n" + TOOLS_PROMPT : SYSTEM_PROMPT,
});

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
  { tools = false }: { tools?: boolean } = {},
): ChatMessage[] => [
  systemMessage(tools),
  { role: "user", content: contextBlock(context) },
  {
    role: "assistant",
    content: tools
      ? "Understood. I will assess this reduction from the metrics above and what the tools measure, quoting the numbers I rely on."
      : "Understood. I will assess this reduction using only the metrics above (and any image you attach), quoting the numbers I rely on.",
  },
  ...history.slice(-CHAT_HISTORY_TURNS).map((t) => ({ role: t.role, content: t.content })),
  { role: "user", content: withImage(userText, imageDataUrl) },
];

// The four one-click stage reviews.  Each is a focused instruction answered
// against the same shared context; `dpdf` and the reciprocal stages can carry an
// image so a vision model assesses the picture alongside the metrics.
export type ReviewStage = "rings" | "punch" | "backfill" | "flatten" | "dpdf";

const STAGE_INSTRUCTION: Record<ReviewStage, string> = {
  rings: "Assess the Al/powder ring removal for this cut. Using ring_removal, judge how completely the rings were subtracted and whether the subtraction over-shot into negative (over-subtracted) territory. If an image is attached, note any residual rings or dark halos. State the optimal display contrast to inspect it. Give a short verdict and one concrete suggestion if it can be improved.",
  punch: "Review the Bragg punch. From bragg_punch.leftover, say whether sharp peaks were left unpunched: missed lattice peaks (at_node) are a punch failure, off-lattice ones are satellites or spurious peaks; quote their hkl and σ, or confirm none survived. Then characterise the peak profile from bragg_punch.peak_profile (resolution-limited fraction, measured widths, anisotropy) and comment on whether the punch footprint looks appropriate. End with a verdict and any suggestion.",
  backfill: "Judge the backfill quality from the backfill metrics. Is the fill seamless (median_seam_sigma), are there bright residual plugs (bright_fill_fraction), and is there any strange periodic/checkerboard pattern (checkerboard_fraction)? If an image is attached, describe the filled regions. Give a verdict and a suggestion if warranted.",
  flatten: "Judge the radial flatten from the flatten metrics. Is the shell floor near zero and level across |Q| after the flatten (floor_after, after_floor_max_sigma), or is there a leftover trend or an over-subtraction? How much pedestal was removed (removed_fraction)? Give a verdict and a suggestion if warranted.",
  dpdf: "Analyse the 3D-ΔPDF features from delta_pdf. Are there features clearly stronger than the background noise (feature_snr, strong_feature_fraction)? Are the correlations anisotropic, and along what direction (anisotropy_ratio, anisotropy_angle_deg)? What is the trend with distance (radial_trend), and is the ΔPDF trustworthy (consistency_pearson_r)? If an image is attached, describe the pattern you see. Summarise the correlation picture in a few sentences.",
};

// With tools, a review must look beyond the opening cut before its verdict,
// with the tools that judge that stage.
const REVIEW_TOOLS: Record<ReviewStage, string> = {
  rings: "assess_stage rings and radial_profile",
  punch: "assess_stage punch and an off-zero cut",
  backfill: "assess_stage backfill and texture_check",
  flatten: "assess_stage flatten and radial_profile",
  dpdf: "assess_stage pdf and qmax_coverage",
};
const toolsReviewSuffix = (stage: ReviewStage): string =>
  ` Before your verdict, look beyond this cut with ${REVIEW_TOOLS[stage]}, and show the most telling cut in the viewer.`;

export const buildStageReviewMessages = (
  context: PipelineContext,
  stage: ReviewStage,
  imageDataUrl?: string | null,
  { tools = false }: { tools?: boolean } = {},
): ChatMessage[] => [
  systemMessage(tools),
  { role: "user", content: contextBlock(context) },
  {
    role: "assistant",
    content: tools
      ? "Understood. I will assess the requested stage from the metrics above, checking other cuts with the tools."
      : "Understood. I will assess the requested stage using only the metrics above and any attached image.",
  },
  { role: "user", content: withImage(STAGE_INSTRUCTION[stage] + (tools ? toolsReviewSuffix(stage) : ""), imageDataUrl) },
];

export const STAGE_REVIEW_LABELS: Record<ReviewStage, string> = {
  rings: "Assess ring removal",
  punch: "Review Bragg punch",
  backfill: "Check backfill",
  flatten: "Check flatten",
  dpdf: "Analyse ΔPDF features",
};
