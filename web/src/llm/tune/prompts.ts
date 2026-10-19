// Prompts for the tuning run.  Two small, structured questions per stage — what
// to try, and which trial was best — each answered in JSON that the app checks
// before acting on it.  Each stage's goal names its trade-off explicitly, so a
// cleaner number bought by destroying diffuse signal is not mistaken for a win.

import type { ChatMessage } from "../provider/client";
import { WORDS } from "../verdicts";
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

// Each stage's goal sits with its rule in the check-verdict module
// (verdicts/rules.ts): in assess_stage's single-stage result and here.
export const STAGE_GOALS: Record<TuneStage, string> = WORDS.goal;

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
