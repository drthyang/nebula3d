// One validation run, as the live runner makes each (validation.live.test.ts)
// and the replay tests drive it with a scripted model
// (validationRun.replay.test.ts): the app as a fresh page has it, the arm's
// opening on the run's own dataset, the agent loop within the run's time, and
// the run's record (validation.ts).
//
// Each run starts fresh (docs/evals.md, "Each run starts fresh"): no run reads
// what an earlier run left in the app. Besides its messages and its dataset, a
// run reads the app's stores and a few states held at module scope, and one an
// earlier run left would answer for it: run_log would read that run's log,
// current_view its page and cuts, a tuning run left going would have every
// change refused, and a server found refusing tools once would be asked
// without them for the rest of the plan. startFresh clears, before each run:
//
// - the pipeline store: the settings, to their defaults, and the job: its log,
//   how it ended, its id and whether it is going (run_log reads the log; no
//   tool acts while a run is going);
// - the tuning store: its run, its trials, its note and whether it is going
//   (tune_pipeline and the report read them; no tool acts while one is going);
// - the console's view stores: the page (navStore), the reciprocal viewer's
//   axis, cut and focus (viewerStore) and the ΔPDF viewer's cuts and colour
//   limit (dpdfStore), which current_view reads and show_in_viewer,
//   dpdf_contrast, run_pipeline and tune_pipeline set; and the selection
//   (datasetStore), which becomes the run's dataset;
// - the servers found refusing tools (agent.ts).
//
// A run cut short by its time limit may leave its agent loop, a pipeline run
// or a tuning run going. runCase lets the loop end first; startFresh stops a
// run or a tuning run still going and waits for it to end before it clears,
// so nothing it writes reaches the next run's stores, and no dataset changes
// while the next run is held to what it changed (changedElsewhere). One that
// does not end stops the runs.
//
// Kept, on purpose:
// - the token calibration (provider/tokens.ts): what each server's counts
//   taught the estimate, and the window an Ollama model last ran with. It is
//   the model's and its server's, not a run's, and carries over by design; the
//   record keeps the calibration each run started from (tokens_at_start);
// - what every run reads alike and none writes: the skills' texts, the tools'
//   facts, the inference tags (inference.ts), the parse cache of results
//   (readings/, a function of each text), the context an Ollama model supports
//   (read once), and the console's LLM settings (settings.ts), which only a
//   tuning run's proposals read;
// - what no run reads: the chat panel's transcript and its highlights (the
//   runner drives the agent loop itself), the crystal structure, the click
//   mode and the viewers' query cache (the tools fetch through the client).

import { fetchDatasets } from "../../api/client";
import type { Dataset } from "../../api/types";
import { useDatasetStore } from "../../state/datasetStore";
import { useDpdfStore } from "../../state/dpdfStore";
import { useNavStore } from "../../state/navStore";
import { usePipelineStore } from "../../state/pipelineStore";
import { useViewerStore } from "../../state/viewerStore";
import { forgetToolsUnsupported, runAgent, type AgentProgress } from "../agent";
import { loadPipelineContext } from "../context/loadContext";
import { tokenCalibration } from "../provider/tokens";
import type { LlmSettings } from "../settings";
import { CHAT_TOOLS } from "../tools";
import { stopTuning, useTuneStore } from "../tune/tuner";
import type { EvalRun } from "./harness";
import { OfferRecorder } from "./offers";
import { armSetup, buildRecord, changedElsewhere, WhyTracker, type ModelInfo, type RunContextWindow, type RunRecord } from "./validation";
import { costOf, type Job, type Price } from "./validationModels";

/** How long startFresh waits for a pipeline run or a tuning run the run before left going to end. */
export const SETTLE_MS = 120_000;

/** How long runCase waits for the agent loop of a run cut short to end. */
export const LET_GO_MS = 60_000;

/** A store as a fresh page has it. */
const reset = <S>(store: { getInitialState: () => S; setState: (s: S, replace: true) => void }): void =>
  store.setState(store.getInitialState(), true);

/** What is still going: a pipeline run, a tuning run, or nothing (null). */
const going = (): string | null =>
  useTuneStore.getState().active ? "a tuning run" : usePipelineStore.getState().running ? "a pipeline run" : null;

/** Waits until `p` settles or `ms` pass, whichever is first; never rejects. */
const settled = (p: Promise<unknown>, ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    p.then(done, done);
  });

/**
 * The app as a fresh page has it, on `dataset`: what a run reads cleared (this
 * module's header lists it, and what is kept). A pipeline run or a tuning run
 * still going is stopped and waited for, at most `settleMs`; one still going
 * then throws, as the next run would read it.
 */
export async function startFresh(dataset: Dataset, { settleMs = SETTLE_MS }: { settleMs?: number } = {}): Promise<void> {
  if (useTuneStore.getState().active) stopTuning();
  if (usePipelineStore.getState().running) await usePipelineStore.getState().cancel();
  const until = Date.now() + settleMs;
  while (going() && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
  const still = going();
  if (still) {
    throw new Error(`${still} the run before started is still going after ${Math.round(settleMs / 1000)} s; the next run would read it, so the runs stop here`);
  }
  reset(usePipelineStore);
  reset(useTuneStore);
  reset(useNavStore);
  reset(useViewerStore);
  reset(useDpdfStore);
  reset(useDatasetStore);
  useDatasetStore.getState().setDataset(dataset.id);
  forgetToolsUnsupported();
}

export interface RunSpec {
  job: Pick<Job, "case" | "arm" | "run">;
  dataset: Dataset; // the run's own, and the only one it sees
  model: ModelInfo; // as the record names it
  settings: Pick<LlmSettings, "baseUrl" | "model" | "apiKey" | "temperature">;
  rounds: number; // rounds of tool calls
  minutes: number; // the run's time limit
  price?: Price | null; // what its tokens cost; null: nothing
  context?: RunContextWindow | null; // the window it had, read before it (validationModels.runContext)
  settleMs?: number; // startFresh's wait
}

/**
 * One run: startFresh, the arm's opening on the dataset's context, the agent
 * loop with every tool the Pilot ships (the arm's switch decides what it is
 * offered), and its record. A run past its time limit is aborted, and given up
 * a minute later with the steps it had; its record says so.
 */
export async function runCase(spec: RunSpec): Promise<RunRecord> {
  const { job, dataset, settings, minutes } = spec;
  await startFresh(dataset, { settleMs: spec.settleMs });
  const { context: pipelineContext } = await loadPipelineContext(dataset);
  const setup = armSetup(job.arm, pipelineContext);
  const before = await fetchDatasets();
  // The calibration the run starts from, before its first request.
  const calibration = tokenCalibration(`${settings.baseUrl}|${settings.model}`);

  const why = new WhyTracker();
  let progress: AgentProgress = { content: "", reasoning: "", steps: [] };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), minutes * 60_000);
  let giveUp: ReturnType<typeof setTimeout> | undefined;
  // The abort stops the model's stream; a tool waiting on the backend may not hear
  // it, so the run is also given up a minute later, with the steps it had.
  const stalled = new Promise<never>((_, reject) => {
    giveUp = setTimeout(() => reject(new Error(`timed out after ${minutes} min`)), (minutes + 1) * 60_000);
  });
  // What goes over the wire to the model, request by request: the tools it was offered.
  const recorder = new OfferRecorder();
  const stopRecording = recorder.install();
  const t0 = performance.now();
  const started = new Date().toISOString();
  const loop = runAgent({
    messages: setup.messages,
    // Every tool the Pilot ships: the run's switch (ctx.skills) decides what arm C is offered.
    tools: CHAT_TOOLS,
    ctx: { dataset, datasets: [dataset], skills: setup.skills, skillsRead: setup.skillsRead },
    settings: { ...settings, attachImages: false, useTools: true, followViews: false },
    signal: abort.signal,
    usage: true,
    maxRounds: spec.rounds,
    onProgress: (p) => {
      progress = p;
      why.update(p);
    },
  });
  let evalRun: EvalRun;
  try {
    const result = await Promise.race([loop, stalled]);
    why.update(result);
    evalRun = {
      scenario: job.case.id,
      steps: result.steps,
      content: result.content,
      note: result.note,
      failure: result.failure ?? null,
      latencyMs: performance.now() - t0,
      usage: result.usage ?? null,
      verdict: result.verdict ?? null,
    };
  } catch (e) {
    why.update(progress);
    const error = abort.signal.aborted ? `timed out after ${minutes} min` : (e as Error).message;
    evalRun = { scenario: job.case.id, steps: progress.steps, content: progress.content, error, latencyMs: performance.now() - t0, usage: null };
  }
  clearTimeout(timer);
  clearTimeout(giveUp);
  abort.abort(); // lets go of anything still waiting on this run
  stopRecording();
  // A run cut short: its loop ends at its next look at the abort. Let it, so
  // nothing it still writes reaches the next run (startFresh stops what it started).
  await settled(loop, LET_GO_MS);

  const elsewhere = changedElsewhere(before, await fetchDatasets(), dataset.id);
  return buildRecord({
    case: job.case,
    arm: job.arm,
    run: job.run,
    dataset,
    model: spec.model,
    evalRun,
    why: why.why,
    maxRounds: spec.rounds,
    started,
    costUsd: costOf(evalRun.usage, spec.price ?? null),
    elsewhere,
    offers: recorder.offers,
    context: spec.context ?? null,
    tokensAtStart: { scale: calibration.scale, ollama_num_ctx: calibration.ollamaNumCtx },
  });
}
