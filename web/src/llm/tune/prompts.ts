// Prompts for the tuning run.  Two small, structured questions per stage — what
// to try, and which trial was best — each answered in JSON that the app checks
// before acting on it.  Each stage's goal names its trade-off explicitly, so a
// cleaner number bought by destroying diffuse signal is not mistaken for a win.

import type { ChatMessage } from "../provider/client";
import { describeStageParams, TUNE_STAGE_LABELS, type ParamValue, type TuneStage } from "./catalog";
import type { StageEvaluation } from "./evaluate";

export const TUNE_SYSTEM = [
  "You tune nebula3d, a pipeline that cleans a 3D reciprocal-space diffuse-scattering volume",
  "and Fourier-transforms it into a 3D-ΔPDF. Stages run in order: ring removal, Bragg punch,",
  "backfill, flatten, ΔPDF. You tune one stage at a time; each stage reads the output the",
  "earlier stages settled on. For each stage you are asked to propose settings to try, then",
  "to pick the best trial from metrics measured on the three principal planes. Diffuse",
  "scattering is the signal: never trade it away for a cleaner-looking number. Change as",
  "little as possible, and keep the user's settings unless a trial is clearly better.",
  "Reply with one JSON object only, no other text.",
].join("\n");

export const STAGE_GOALS: Record<TuneStage, string> = {
  rings:
    "Remove powder/Al rings: mean_ring_energy_ratio as low as the trials reach on every plane (its floor is set by the diffuse, not 0; near 0.4–0.5 can be ring-free), while over_subtraction_fraction and after_negative_fraction stay small (a few percent from noise). Lower ring energy bought by over-subtracting (negatives rising) is worse, not better.",
  punch:
    "Remove every sharp peak that should go while punching as little as possible (punched_fraction small): every punched voxel is diffuse signal thrown away and later backfilled. Missed lattice peaks (leftover_at_nodes) must reach 0 on every plane; off-lattice sharp peaks (leftover_off_lattice) are satellites or spurious peaks the search punches unless their H planes are protected, so fewer is better only where they are spurious. Fewer leftovers win only if the punched fraction does not grow substantially; lowering the significance or the search floor punches noise and diffuse maxima, raising them leaves weak peaks.",
  backfill:
    "Fill punched holes seamlessly: median_seam_sigma ≲ 1, bright_fill_fraction small (no bright plugs where peaks were), checkerboard_fraction near 0.5 (near 1 is a periodic interpolation artefact).",
  flatten:
    "Bring the per-|Q|-shell floor to about 0 and level across |Q| (floor_after near 0 in all thirds, after_floor_max_sigma ≲ 1) without over-subtracting (floors well below 0).",
  pdf:
    "The ΔPDF must reproduce the cleaned data (back_fft_pearson_r close to 1, back_fft_normalized_rms low) and show features above noise (feature_snr). Apodization trades real-space resolution against truncation ripples; prefer the default unless another is clearly better on r and RMS.",
};

export interface TrialRecord {
  trial: number;
  settings: Record<string, ParamValue>;
  metrics?: StageEvaluation;
  error?: string;
}

const json = (v: unknown) => JSON.stringify(v);

export const buildProposeMessages = ({
  stage,
  current,
  earlier,
  trials,
  count,
}: {
  stage: TuneStage;
  current: Record<string, ParamValue>;
  earlier: Record<string, Record<string, ParamValue>>;
  trials: TrialRecord[];
  count: number;
}): ChatMessage[] => [
  { role: "system", content: TUNE_SYSTEM },
  {
    role: "user",
    content: [
      `Stage: ${TUNE_STAGE_LABELS[stage]}.`,
      `Goal: ${STAGE_GOALS[stage]}`,
      "",
      "Settings you may change (use these names exactly):",
      describeStageParams(stage),
      "",
      `Current settings: ${json(current)}`,
      `Settings already chosen for earlier stages: ${json(earlier)}`,
      `Trials so far (trial 1 = the current settings): ${json(trials)}`,
      "",
      `Propose up to ${count} new settings to try, each different from every trial so far and`,
      "each changing as few settings as possible, with a one-sentence reason tied to the metrics.",
      'Reply as {"candidates": [{"changes": {"<setting>": <value>}, "why": "<reason>"}]}.',
      'If the current settings already meet the goal, reply {"candidates": []}.',
    ].join("\n"),
  },
];

export const buildJudgeMessages = ({ stage, trials }: { stage: TuneStage; trials: TrialRecord[] }): ChatMessage[] => [
  { role: "system", content: TUNE_SYSTEM },
  {
    role: "user",
    content: [
      `Stage: ${TUNE_STAGE_LABELS[stage]}.`,
      `Goal: ${STAGE_GOALS[stage]}`,
      "",
      `Trials (trial 1 = the user's settings): ${json(trials)}`,
      "",
      "Pick the trial that best meets the goal. Keep trial 1 unless another is clearly better;",
      "a small gain in one number is not worth a change. Quote the numbers behind your choice.",
      'Reply as {"best": <trial number>, "why": "<two sentences>"}.',
    ].join("\n"),
  },
];

// The first JSON object in a reply, tolerating code fences and a reasoning
// model's <think> block around it.
export function parseJsonReply(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(cleaned.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
