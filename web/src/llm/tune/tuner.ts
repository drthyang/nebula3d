// The tuning run: the pipeline, one stage at a time.  For each stage the app
// runs the user's settings first, asks the model for a few alternatives (checked
// against the catalog), runs each, asks the model which trial best meets the
// stage's goal, keeps that trial's output and puts its settings on the
// Configure page, and moves on — so every stage builds on the best result of
// the one before.  The loop is ordinary code; the model only proposes and picks.
//
// Every trial runs into its own folder, tuning/<run>/trials/<stage>-<n>/, and
// is measured through the server's view of it; keeping a trial copies it into
// the run's own chain, tuning/<run>/processed/, which the next stage reads.
// The dataset's processed/ files are never written (nebula3d.server.tuning).
// State lives in a module-scoped store so the run survives the panel closing.

import { create } from "zustand";

import { fetchDataset, promoteTrial, startTuningRun } from "../../api/client";
import { queryClient } from "../../api/queryClient";
import type { Dataset, TuningRun } from "../../api/types";
import { usePipelineStore, type PipelineConfig } from "../../state/pipelineStore";
import { completeChat, type ChatMessage } from "../provider/client";
import type { LlmSettings } from "../settings";
import {
  currentStageSettings,
  proposalToPatch,
  ProposalError,
  stageEnabled,
  stageParams,
  TRIAL_STAGES,
  TUNE_STAGES,
  type ParamValue,
  type TuneStage,
} from "./catalog";
import { evaluateStage, outOfBounds, type StageEvaluation } from "./evaluate";
import { buildJudgeMessages, buildProposeMessages, parseJsonReply, type TrialRecord } from "./prompts";

export interface Trial {
  n: number; // 1 = the user's settings
  changes: Record<string, ParamValue>; // vs trial 1, as the model named them
  settings: Record<string, ParamValue>; // the stage's full settings
  why?: string;
  status: "pending" | "running" | "done" | "error";
  evaluation?: StageEvaluation;
  error?: string;
  seconds?: number;
}

export type StageStatus =
  | "waiting"
  | "running"
  | "proposing"
  | "judging"
  | "applying"
  | "done"
  | "skipped"
  | "failed";

export interface StageRun {
  stage: TuneStage;
  tuned: boolean; // false: re-run once with the user's settings, between tuned stages
  status: StageStatus;
  trials: Trial[];
  best?: number;
  why?: string;
  message?: string;
}

interface TuneState {
  active: boolean;
  datasetLabel: string | null;
  run: TuningRun | null; // run.dataset_id views the run's kept outputs
  stages: StageRun[];
  error: string | null;
  finishedNote: string | null;
}

export const useTuneStore = create<TuneState>(() => ({
  active: false,
  datasetLabel: null,
  run: null,
  stages: [],
  error: null,
  finishedNote: null,
}));

const trialKey = (stage: TuneStage, n: number) => `${stage}-${n}`;

const setStage = (stage: TuneStage, patch: Partial<StageRun>) =>
  useTuneStore.setState((s) => ({ stages: s.stages.map((r) => (r.stage === stage ? { ...r, ...patch } : r)) }));

const setTrial = (stage: TuneStage, n: number, patch: Partial<Trial>) =>
  useTuneStore.setState((s) => ({
    stages: s.stages.map((r) =>
      r.stage === stage ? { ...r, trials: r.trials.map((t) => (t.n === n ? { ...t, ...patch } : t)) } : r,
    ),
  }));

const getStage = (stage: TuneStage): StageRun => useTuneStore.getState().stages.find((r) => r.stage === stage)!;

let controller: AbortController | null = null;

class Stopped extends Error {}
const checkStop = (signal: AbortSignal) => {
  if (signal.aborted) throw new Stopped();
};

const pipeline = () => usePipelineStore.getState();

// The stage's form fields as they are now — the user's settings for trial 1.
const snapshot = (stage: TuneStage): Partial<PipelineConfig> => {
  const s = pipeline();
  return Object.fromEntries(stageParams(stage).map((p) => [p.key, s[p.key]])) as Partial<PipelineConfig>;
};

async function ask(messages: ChatMessage[], llm: LlmSettings, signal: AbortSignal): Promise<Record<string, unknown> | null> {
  const text = await completeChat({
    baseUrl: llm.baseUrl,
    model: llm.model,
    messages,
    temperature: llm.temperature,
    apiKey: llm.apiKey || undefined,
    signal,
  });
  return parseJsonReply(text);
}

// Run the stage as trial n of the run, with the form as it stands, into the
// trial's own folder; measure it through the server's view of that trial.
async function runTrial(
  stage: TuneStage,
  n: number,
  dataset: Dataset,
  run: TuningRun,
  signal: AbortSignal,
): Promise<boolean> {
  checkStop(signal);
  setTrial(stage, n, { status: "running" });
  const t0 = performance.now();
  const trial = trialKey(stage, n);
  const end = await pipeline().runStages(TRIAL_STAGES[stage], {
    datasetId: dataset.id,
    tuning: { run_id: run.run_id, trial },
  });
  checkStop(signal);
  const seconds = Math.round((performance.now() - t0) / 100) / 10;
  if (end !== "done") {
    setTrial(stage, n, { status: "error", error: `the run ended: ${end}`, seconds });
    return false;
  }
  try {
    const view = await fetchDataset(`${run.dataset_id}~${trial}`);
    const evaluation = await evaluateStage(stage, view);
    setTrial(stage, n, { status: "done", evaluation, seconds });
    return true;
  } catch (e) {
    setTrial(stage, n, { status: "error", error: `measuring the output failed: ${(e as Error).message}`, seconds });
    return false;
  }
}

const records = (run: StageRun): TrialRecord[] =>
  run.trials
    .filter((t) => t.status === "done" || t.status === "error")
    .map((t) => ({ trial: t.n, settings: t.settings, metrics: t.evaluation, error: t.error }));

const sameSettings = (a: Record<string, ParamValue>, b: Record<string, ParamValue>) =>
  Object.keys({ ...a, ...b }).every((k) => a[k] === b[k]);

// Keep trial n: copy it into the run's chain, where the next stage reads it.
async function keep(stage: TuneStage, n: number, run: TuningRun, signal: AbortSignal): Promise<void> {
  await promoteTrial(run.run_id, trialKey(stage, n));
  checkStop(signal);
  await queryClient.invalidateQueries();
}

async function tuneStage(
  stage: TuneStage,
  dataset: Dataset,
  run: TuningRun,
  trialsPerStage: number,
  earlier: Record<string, Record<string, ParamValue>>,
  llm: LlmSettings,
  signal: AbortSignal,
): Promise<void> {
  const base = snapshot(stage);
  const baseSettings = currentStageSettings(stage, pipeline());
  useTuneStore.setState((s) => ({
    stages: s.stages.map((r) =>
      r.stage === stage
        ? { ...r, status: "running", trials: [{ n: 1, changes: {}, settings: baseSettings, status: "pending" }] }
        : r,
    ),
  }));
  if (!(await runTrial(stage, 1, dataset, run, signal))) {
    setStage(stage, { status: "failed", message: "The run with your settings failed; tuning stopped here." });
    throw new Error(`${stage}: the run with the current settings failed`);
  }

  // Ask for alternatives; a reply that fails the catalog gets one retry with the reasons.
  if (trialsPerStage > 1) {
    setStage(stage, { status: "proposing" });
    let messages = buildProposeMessages({
      stage,
      current: baseSettings,
      earlier,
      trials: records(getStage(stage)),
      count: trialsPerStage - 1,
    });
    const accepted: { patch: Partial<PipelineConfig>; changes: Record<string, ParamValue>; settings: Record<string, ParamValue>; why?: string }[] = [];
    for (let attempt = 0; attempt < 2 && !accepted.length; attempt++) {
      const reply = await ask(messages, llm, signal);
      checkStop(signal);
      const candidates = Array.isArray(reply?.candidates) ? (reply!.candidates as unknown[]) : null;
      if (!candidates) {
        if (attempt === 0) {
          messages = [...messages, { role: "user", content: 'That was not the JSON asked for. Reply only with {"candidates": [...]}.' }];
          continue;
        }
        break;
      }
      if (!candidates.length) break; // the model is content with the current settings
      const problems: string[] = [];
      for (const c of candidates.slice(0, trialsPerStage - 1)) {
        const changes = (c as { changes?: unknown })?.changes;
        if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
          problems.push("a candidate had no changes object");
          continue;
        }
        try {
          const patch = proposalToPatch(stage, changes as Record<string, unknown>);
          const settings = currentStageSettings(stage, { ...pipeline(), ...base, ...patch });
          const seen = [baseSettings, ...accepted.map((a) => a.settings)];
          if (seen.some((s) => sameSettings(s, settings))) {
            problems.push(`${JSON.stringify(changes)} repeats a trial`);
            continue;
          }
          const why = (c as { why?: unknown }).why;
          accepted.push({ patch, changes: changes as Record<string, ParamValue>, settings, why: typeof why === "string" ? why : undefined });
        } catch (e) {
          if (!(e instanceof ProposalError)) throw e;
          problems.push(e.message);
        }
      }
      if (!accepted.length && problems.length && attempt === 0) {
        messages = [...messages, { role: "user", content: `None of those can run: ${problems.join("; ")}. Propose again.` }];
      }
    }

    for (const [i, cand] of accepted.entries()) {
      const n = i + 2;
      useTuneStore.setState((s) => ({
        stages: s.stages.map((r) =>
          r.stage === stage
            ? { ...r, status: "running", trials: [...r.trials, { n, changes: cand.changes, settings: cand.settings, why: cand.why, status: "pending" }] }
            : r,
        ),
      }));
    }
    for (const [i, cand] of accepted.entries()) {
      pipeline().patch({ ...base, ...cand.patch });
      await runTrial(stage, i + 2, dataset, run, signal);
    }

    // Pick the best trial.  A trial past a hard limit of its stage (a ΔPDF
    // window on unmeasured space) is no candidate while your settings keep it.
    const done = getStage(stage).trials.filter((t) => t.status === "done");
    const baseOut = outOfBounds(stage, done.find((t) => t.n === 1)?.evaluation);
    const barred = new Map(
      baseOut ? [] : done.flatMap((t) => {
        const reason = outOfBounds(stage, t.evaluation);
        return reason ? [[t.n, reason] as const] : [];
      }),
    );
    const eligible = done.filter((t) => !barred.has(t.n));
    let best = 1;
    let why = "Only your settings ran, so they are kept.";
    if (eligible.length > 1) {
      setStage(stage, { status: "judging" });
      const trials = records(getStage(stage)).filter((r) => !barred.has(r.trial));
      const reply = await ask(buildJudgeMessages({ stage, trials }), llm, signal);
      checkStop(signal);
      const pick = Number(reply?.best);
      if (eligible.some((t) => t.n === pick)) {
        best = pick;
        why = typeof reply?.why === "string" ? reply.why : "";
      } else {
        why = "The model's choice could not be read, so your settings are kept.";
      }
    } else if (barred.size) {
      why = "Your settings are kept.";
    } else if (!accepted.length) {
      why = "The model proposed nothing it judged better, so your settings are kept.";
    }
    for (const [n, reason] of barred) why += ` Trial ${n} was not a candidate: ${reason}.`;

    // Keep the best trial's output in the run's chain and its settings in Configure.
    const chosen = best === 1 ? {} : accepted[best - 2].patch;
    pipeline().patch({ ...base, ...chosen });
    setStage(stage, { status: "applying", best, why });
    await keep(stage, best, run, signal);
    setStage(stage, { status: "done", best, why });
    return;
  }
  await keep(stage, 1, run, signal);
  setStage(stage, { status: "done", best: 1, why: "One trial per stage: your settings were run and kept." });
}

export interface TuneOptions {
  dataset: Dataset;
  stages: TuneStage[];
  trialsPerStage: number; // including the user's settings
  llm: LlmSettings;
}

export async function startTuning({ dataset, stages, trialsPerStage, llm }: TuneOptions): Promise<void> {
  if (useTuneStore.getState().active || pipeline().running) return;
  const abort = new AbortController();
  controller = abort;
  const cfg = pipeline();
  // From the first stage to tune onwards: tune the chosen stages, and re-run the
  // others in between once, so each tuned stage reads up-to-date inputs.
  const first = TUNE_STAGES.findIndex((s) => stages.includes(s));
  const order = first < 0 ? [] : TUNE_STAGES.slice(first);
  // The stages after the last tuned one are re-run only if a tuned stage changed
  // its settings: otherwise they would only reproduce the processed outputs.
  const lastTuned = order.reduce((at, s, i) => (stages.includes(s) ? i : at), -1);
  let changed = false;
  useTuneStore.setState({
    active: true,
    datasetLabel: dataset.temperature ?? dataset.stem,
    run: null,
    error: null,
    finishedNote: null,
    stages: order.map((stage) => ({
      stage,
      tuned: stages.includes(stage),
      status: stageEnabled(stage, cfg) ? "waiting" : "skipped",
      trials: [],
      message: stageEnabled(stage, cfg) ? undefined : "Switched off on the Configure page.",
    })),
  });
  const earlier: Record<string, Record<string, ParamValue>> = {};
  try {
    const firstRun = order.find((s) => stageEnabled(s, cfg));
    if (!firstRun) throw new Error("none of the chosen stages is switched on");
    const run = await startTuningRun(dataset.id, firstRun);
    useTuneStore.setState({ run });
    for (const [i, stage] of order.entries()) {
      if (!stageEnabled(stage, pipeline())) continue;
      if (i > lastTuned && !changed) {
        setStage(stage, {
          status: "skipped",
          message: "Not re-run: the tuned stages kept your settings, so your processed output stands.",
        });
        continue;
      }
      if (stages.includes(stage)) {
        await tuneStage(stage, dataset, run, trialsPerStage, earlier, llm, abort.signal);
        const kept = useTuneStore.getState().stages.find((r) => r.stage === stage)?.best ?? 1;
        if (kept !== 1) changed = true;
      } else {
        setStage(stage, {
          status: "running",
          message: "Re-run with your settings (not tuned), on the stages kept before it.",
          trials: [{ n: 1, changes: {}, settings: currentStageSettings(stage, pipeline()), status: "pending" }],
        });
        if (!(await runTrial(stage, 1, dataset, run, abort.signal))) {
          throw new Error(`${stage}: the run with your settings failed`);
        }
        await keep(stage, 1, run, abort.signal);
        setStage(stage, { status: "done", best: 1 });
      }
      earlier[stage] = currentStageSettings(stage, pipeline());
    }
    useTuneStore.setState({
      finishedNote: changed
        ? "Done. Your processed files are unchanged; the tuned outputs are in this run's own folder (open them below), and the chosen settings are on the Configure page."
        : "Done. Your settings won every tuned stage, so nothing changed: your processed files and settings stand, and the later stages were not re-run.",
    });
  } catch (e) {
    if (e instanceof Stopped || (e as Error).name === "AbortError") {
      if (pipeline().running) await pipeline().cancel();
      useTuneStore.setState({
        finishedNote: "Stopped. Your processed files are unchanged; the stages kept so far are in this run's own folder.",
      });
    } else {
      useTuneStore.setState({ error: (e as Error).message });
    }
    useTuneStore.setState((s) => ({
      stages: s.stages.map((r) => (["waiting", "done", "skipped", "failed"].includes(r.status) ? r : { ...r, status: "failed" })),
    }));
  } finally {
    if (controller === abort) controller = null;
    useTuneStore.setState({ active: false });
  }
}

export function stopTuning(): void {
  controller?.abort();
  if (pipeline().running) void pipeline().cancel();
}
