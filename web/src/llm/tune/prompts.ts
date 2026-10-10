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
    "Remove powder/Al rings: mean_ring_energy_ratio as low as the trials reach on every plane (its floor is set by the diffuse, not 0; near 0.4–0.5 can be ring-free), while over_subtraction_fraction and after_negative_fraction stay small (a few percent from noise), and each raw ring ends level with the diffuse beside it: max_ring_dent (how far the deepest ring sits below its flanks, a share of the diffuse there; the subtraction over-shot, even where no voxel goes negative) and max_ring_left (a ring left over) both 0: they count only residuals beyond 3 × their plane's noise_fraction, so any value above 0 is a real dent or leftover (worst_ring_dent and worst_ring_left say on which plane and at which |Q|). Only rings seen on two or more planes count: a bump on one plane only (single_plane_bumps) is the crystal's own scattering, which the ring removal must leave, not a miss (per_plane marks it single_plane_bump and leaves it out of that plane's worst_ring_dent and worst_ring_left). Lower ring energy bought by over-subtracting (negatives or ring dents rising) is worse, not better.",
  punch:
    "Remove every sharp peak that should go while punching as little as possible (punched_fraction small): every punched voxel is diffuse signal thrown away and later backfilled. Missed lattice peaks (leftover_at_nodes) must reach 0 on every plane; off-lattice sharp peaks (leftover_off_lattice) are satellites or spurious peaks the search punches unless their H planes are protected: leftover_on_protected_planes of them sit on protected planes and stay by design (whether they are real is the user's call), while the rest are peaks the search left, so fewer of those is better where they are spurious. leftover_off_lattice splits into leftover_off_lattice_sharp (punch candidates) and leftover_off_lattice_broad (FWHM ≥ 5 voxels along a slice axis: diffuse maxima such as short-range order, which are the signal, not peaks to punch). Fewer leftovers win only if the punched fraction does not grow substantially; lowering the significance or the search floor punches noise and diffuse maxima, raising them leaves weak peaks.",
  backfill:
    "Fill punched holes seamlessly: median_seam_sigma ≲ 1, bright_fill_fraction small (no bright plugs where peaks were), checkerboard_fraction near 0.5 (near 1 is a periodic interpolation artefact).",
  flatten:
    "Bring the per-|Q|-shell floor to about 0 and level across |Q| (floor_after near 0 in all thirds, after_floor_max_sigma ≲ 1) without over-subtracting (floors well below 0), and leave no pedestal across the whole coverage: max_floor_trend (|rank correlation| of the floors with |Q|) well below 1 and max_floor_span_fraction well below 1. A trend near 1 with a span near 1 or more is a background the model missed, however small it reads in σ: a rising one wants flattenQ2 and a fit range reaching the coverage (flattenFitQMax), not a free-form estimator, which also removes isotropic pair correlations.",
  pdf:
    "The ΔPDF must show features above noise (feature_snr) with the transform's reach inside the measured coverage. back_fft_pearson_r must stay near 1, but without a band or crop the round trip is the identity, so it cannot rank trials: a drop below ~0.999 only flags a transform problem. Apodization trades real-space resolution against truncation ripples; prefer the default unless another is clearly better on feature_snr without the reach leaving the coverage.",
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
