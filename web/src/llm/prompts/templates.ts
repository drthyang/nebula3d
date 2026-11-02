// Message builders for each assistant feature.  Each returns the `messages`
// array for a chat-completions call.  Without tools, the run context travels
// inside a fenced JSON block so the model can tell data from instructions; with
// tools, the first message is a short summary of the dataset, none of it
// measured, and the model measures with the tools (THY-63 C1).  When an image
// data-URL is supplied (vision opt-in), it is attached as a second content part
// on the triggering user message.

import type { ChatMessage, ContentPart } from "../provider/client";
import { contextToJson, type PipelineContext } from "../context/pipelineContext";
import { MAX_TOOL_ROUNDS } from "../runPolicy";
import { skillsOn, skillsPrompt, type SkillsSwitch } from "../skills";
import { BACK_FFT_R_OK, EVEN_PART } from "../verdicts/rules";
import { CORE, IMAGE_LINE, roundsLine, SYSTEM } from "./system";

/** What the opening messages are built for: tools on or off, and the skills' switch (skills.ts; on unless false). */
export interface MessageOptions extends SkillsSwitch {
  tools?: boolean;
  // With tools: the rounds of calls a reply may make, which the system prompt
  // states as a limit: the run policy's maxRounds (MAX_TOOL_ROUNDS unless a
  // validation run gives its own).
  rounds?: number;
}

/** The system prompt's options: the messages' own, and whether a message carries an image. */
interface SystemOptions extends MessageOptions {
  image?: boolean;
}

/**
 * The system prompt, from its sections. Without tools: the domain and the
 * metrics the context carries (SYSTEM). With tools: the core (CORE: the
 * evidence rules, the checks that judge a run, acting, who decides what), the
 * rounds of calls a reply may make, a line on an attached image when a message
 * carries one, and with the skills on, the skills' names and descriptions,
 * which read_skill reads when the task calls for it. With the skills off (the
 * validation's arm C) that section is not there at all, and the others are
 * their definitions only, without their inference (inference.ts).
 */
export function systemPrompt({ tools = false, skills, rounds = MAX_TOOL_ROUNDS, image = false }: SystemOptions = {}): string {
  const on = skillsOn({ skills });
  if (!tools) return SYSTEM.text(on);
  const sections = [CORE.text(on), roundsLine(rounds)];
  if (image) sections.push(IMAGE_LINE);
  if (on) sections.push(skillsPrompt());
  return sections.join("\n");
}

const systemMessage = (options: SystemOptions): ChatMessage => ({ role: "system", content: systemPrompt(options) });

const contextBlock = (context: PipelineContext, skills?: boolean): string =>
  `Diagnostic context for this reduction (metrics computed from the current cut):\n\`\`\`json\n${contextToJson(context, undefined, { skills: skillsOn({ skills }) })}\n\`\`\``;

const listed = (xs: readonly (number | null)[], names: readonly string[]): string =>
  xs.flatMap((x, i) => (x == null ? [] : [`${names[i]} = ${x}`])).join(", ");

/**
 * The context a model with tools starts from (THY-63 C1): facts about the
 * dataset as this request found it (its name, cell, grid and ranges, whether
 * the raw volume is symmetrised, the outputs on disk), and no number measured
 * on a slice, which the model could otherwise answer from. Each fact the
 * context does not hold is left out. The same with the skills on and off.
 */
export function summaryBlock(context: PipelineContext): string {
  const s = context.summary ?? {};
  const lines: string[] = [];
  if (context.dataset) lines.push(`- dataset: ${context.dataset}`);
  const lat = context.lattice_A;
  const ang = context.cell_angles_deg;
  const lengths = lat ? listed([lat.a, lat.b, lat.c], ["a", "b", "c"]) : "";
  if (lengths) lines.push(`- cell: ${lengths} Å${ang ? `; ${listed([ang.alpha, ang.beta, ang.gamma], ["α", "β", "γ"])}°` : ""}`);
  if (context.grid) {
    const ranges = s.hkl_ranges ? `, ${s.hkl_ranges.map(([lo, hi], i) => `${"HKL"[i]} ${lo} to ${hi}`).join(", ")} r.l.u.` : "";
    lines.push(`- reciprocal grid: ${context.grid.join(" × ")} voxels${ranges}`);
  }
  if (s.symmetry) lines.push(`- raw volume: symmetrised with ${s.symmetry}`);
  else if (s.symmetry === null) lines.push(`- raw volume: not symmetrised (it declares no symmetry)${s.symmetry_declared_for ? `; ${s.symmetry_declared_for} is declared for it` : ""}`);
  if (s.stages_on_disk) {
    const outputs = s.stages_on_disk.filter((n) => n !== "raw");
    lines.push(`- on disk: ${s.stages_on_disk.join(", ") || "nothing"}${outputs.length ? "" : " (no stage output yet)"}`);
  }
  return ["Context: the dataset as this request found it. Nothing here is measured: the tools measure.", ...lines].join("\n");
}

/** The first user message: the cut's metrics without tools, the dataset's summary with them. */
const openingContext = (context: PipelineContext, { tools = false, skills }: MessageOptions): string =>
  tools ? summaryBlock(context) : contextBlock(context, skills);

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
// models' context windows; the opening context is re-sent every call anyway.
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
  { tools = false, skills, rounds }: MessageOptions = {},
): ChatMessage[] => [
  systemMessage({ tools, skills, rounds, image: Boolean(imageDataUrl) }),
  { role: "user", content: openingContext(context, { tools, skills }) },
  {
    role: "assistant",
    content: tools
      ? "Understood. I will measure with the tools and quote the numbers I rely on."
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
  flatten: "Judge the radial flatten from the flatten metrics. Is the shell floor near zero and level across |Q| after the flatten (floor_after, floor_trend, floor_span_fraction), or is there a leftover trend or an over-subtraction? How much pedestal was removed (removed_fraction)? Give a verdict and a suggestion if warranted.",
  // The round trip as the ΔPDF's verdict judges it, in its rule's words (verdicts/rules.ts).
  dpdf: `Analyse the 3D-ΔPDF features from delta_pdf. Are there features clearly stronger than the background noise (feature_snr, strong_feature_fraction)? Are the correlations anisotropic, and along what direction (anisotropy_ratio, anisotropy_angle_deg)? What is the trend with distance (radial_trend), and what does the back-FFT round trip say (the ΔPDF's verdict judges it against ${EVEN_PART}, to an r of ${BACK_FFT_R_OK} or more; consistency_pearson_r is against the data)? If an image is attached, describe the pattern you see. Summarise the correlation picture in a few sentences.`,
};

// With tools, a review reads no cut's metrics from the context (THY-63 C1):
// it names the tools that measure and judge its stage. They are the system
// prompt's own checks (CORE), the Pilot's method rather than a skill's, so the
// skills' switch leaves them as they are.
const STAGE_INSTRUCTION_WITH_TOOLS: Record<ReviewStage, string> = {
  rings: "Assess the Al/powder ring removal: judge how completely the rings were subtracted and whether the subtraction over-shot into negative (over-subtracted) territory. If an image is attached, note any residual rings or dark halos. State the optimal display contrast to inspect it (measure_reciprocal_cut's suggested_display_vmax). Give a short verdict and one concrete suggestion if it can be improved.",
  punch: "Review the Bragg punch. Say whether sharp peaks were left unpunched: missed lattice peaks (at_node) are a punch failure, off-lattice ones are satellites or spurious peaks; quote their hkl and σ, or confirm none survived. Then characterise the fitted peaks (bragg_peaks: which are resolution-limited, their measured widths, their anisotropy) and comment on whether the punch footprint looks appropriate. End with a verdict and any suggestion.",
  backfill: "Judge the backfill quality. Is the fill seamless (median_seam_sigma), are there bright residual plugs (bright_fill_fraction), and is there any strange periodic/checkerboard pattern (checkerboard_fraction)? If an image is attached, describe the filled regions. Give a verdict and a suggestion if warranted.",
  flatten: "Judge the radial flatten. Is the shell floor near zero and level across |Q| after the flatten (floor_after, floor_trend, floor_span_fraction), or is there a leftover trend or an over-subtraction? How much pedestal was removed (removed_fraction)? Give a verdict and a suggestion if warranted.",
  // The round trip as the ΔPDF's verdict judges it, in its rule's words (verdicts/rules.ts).
  dpdf: `Analyse the 3D-ΔPDF features. Are there features clearly stronger than the background noise (feature_snr, strong_feature_fraction)? Are the correlations anisotropic, and along what direction (anisotropy_ratio, anisotropy_angle_deg)? What is the trend with distance (radial_trend), and what does the back-FFT round trip say (the ΔPDF's verdict judges it against ${EVEN_PART}, to an r of ${BACK_FFT_R_OK} or more; back_fft_pearson_r is against the data)? If an image is attached, describe the pattern you see. Summarise the correlation picture in a few sentences.`,
};
const REVIEW_TOOLS: Record<ReviewStage, string> = {
  rings: "assess_stage rings and radial_profile",
  punch: "assess_stage punch and an off-zero cut",
  backfill: "assess_stage backfill and texture_check",
  flatten: "assess_stage flatten and radial_profile",
  dpdf: "assess_stage pdf, qmax_coverage and measure_dpdf_cut",
};
const reviewWithTools = (stage: ReviewStage): string =>
  `${STAGE_INSTRUCTION_WITH_TOOLS[stage]} Before your verdict, check it with ${REVIEW_TOOLS[stage]}, and show the most telling cut in the viewer.`;

export const buildStageReviewMessages = (
  context: PipelineContext,
  stage: ReviewStage,
  imageDataUrl?: string | null,
  { tools = false, skills, rounds }: MessageOptions = {},
): ChatMessage[] => [
  systemMessage({ tools, skills, rounds, image: Boolean(imageDataUrl) }),
  { role: "user", content: openingContext(context, { tools, skills }) },
  {
    role: "assistant",
    content: tools
      ? "Understood. I will assess the requested stage with the tools."
      : "Understood. I will assess the requested stage using only the metrics above and any attached image.",
  },
  { role: "user", content: withImage(tools ? reviewWithTools(stage) : STAGE_INSTRUCTION[stage], imageDataUrl) },
];

export const STAGE_REVIEW_LABELS: Record<ReviewStage, string> = {
  rings: "Assess ring removal",
  punch: "Review Bragg punch",
  backfill: "Check backfill",
  flatten: "Check background correction",
  dpdf: "Analyse ΔPDF features",
};
