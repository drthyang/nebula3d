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
//   (readings/, a function of each text) and the context an Ollama model
//   supports (read once);
// - what no run reads: the chat panel's transcript and its highlights (the
//   runner drives the agent loop itself), the crystal structure, the click
//   mode, the viewers' query cache (the tools fetch through the client) and
//   the console's LLM settings (settings.ts).
//
// The run's model answers every request the run makes: the agent loop's, and
// its tuning's (tune_pipeline's proposals and judgements, through the tool
// context's `model`), which in the app ask the model on the console's
// settings. The tuning's tokens are the run's: the record's usage adds them
// to the loop's and keeps them apart in `usage.tuning` (TuningTokens), and
// so its cost, and the paid model's spend (validationModels.ts), include them.
//
// The run runs under its validation policy (validationPolicy,
// validationModels.ts): its transport's as the app ships it, with the run's
// round limit and the validation's output cap on every request, the loop's
// and the tuning's, in either arm. The record keeps the policy (run_policy),
// and every request whose reply was cut at the cap, the loop's and the
// tuning's (truncated, TruncationTracker).
//
// A paid run is held to its spend budget (TuningGate): its reserve
// (SpendTracker, validationModels.ts) covers its agent loop and one tuning,
// each at its hard bound, so a tune_pipeline call after the run's tuning has
// sent a request runs only if the budget left beyond the reserve covers one
// more tuning, each drawing its share. One it does not cover is not run: the
// model reads why (TUNING_SKIPPED) and the run goes on; the record keeps the
// budget and the skip (tuning_budget). The gate wraps the tool runCase hands
// the agent loop; the tool, as offered and as the app runs it, is unchanged.

import { fetchDatasets } from "../../api/client";
import type { Dataset } from "../../api/types";
import { useDatasetStore } from "../../state/datasetStore";
import { useDpdfStore } from "../../state/dpdfStore";
import { useNavStore } from "../../state/navStore";
import { usePipelineStore } from "../../state/pipelineStore";
import { useViewerStore } from "../../state/viewerStore";
import { forgetToolsUnsupported, runAgent, type AgentProgress, type AgentStep } from "../agent";
import { loadPipelineContext } from "../context/loadContext";
import { stoppedAtLimit, type UsageReport } from "../provider/client";
import { tokenCalibration } from "../provider/tokens";
import type { Transport } from "../runPolicy";
import type { LlmSettings } from "../settings";
import { CHAT_TOOLS, type ChatTool } from "../tools";
import { stopTuning, useTuneStore } from "../tune/tuner";
import type { EvalRun, TokenCount } from "./harness";
import { OfferRecorder } from "./offers";
import {
  armSetup,
  buildRecord,
  changedElsewhere,
  TUNING_SKIPPED,
  WhyTracker,
  type ModelInfo,
  type RunContextWindow,
  type RunRecord,
  type TruncatedRequest,
  type Truncations,
  type TuningBudgetRecord,
} from "./validation";
import { costOf, covers, validationPolicy, type Job, type Price, type TuningBudget } from "./validationModels";

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

/**
 * What a run's tuning spends. Its requests go to the run's model
 * (tune_pipeline, through the tool context's `model`), and each one the server
 * answered reports its token counts to `report`, or null when the server gave
 * none.
 */
export class TuningTokens {
  readonly counted: Required<TokenCount> = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 };
  unreported = 0; // requests answered without counts

  /** The tuning's requests the server answered so far, with counts or without. */
  get answered(): number {
    return this.counted.requests + this.unreported;
  }

  readonly report: UsageReport = (usage) => {
    if (!usage) {
      this.unreported += 1;
      return;
    }
    this.counted.input += usage.input;
    this.counted.output += usage.output;
    this.counted.cacheRead += usage.cacheRead ?? 0;
    this.counted.cacheWrite += usage.cacheWrite ?? 0;
    this.counted.requests += 1;
  };

  /**
   * The run's usage with the tuning's added to the loop's, every count and the
   * requests, and kept apart in `tuning`. A run that tuned nothing keeps the
   * loop's as it was. Unknown (null) when the loop's is, or when the server
   * did not report a tuning request's counts: the total would be short.
   */
  addTo(loop: EvalRun["usage"]): EvalRun["usage"] {
    const t = this.counted;
    if (!t.requests && !this.unreported) return loop;
    if (!loop || this.unreported) return null;
    return {
      input: loop.input + t.input,
      output: loop.output + t.output,
      cacheRead: (loop.cacheRead ?? 0) + t.cacheRead,
      cacheWrite: (loop.cacheWrite ?? 0) + t.cacheWrite,
      requests: loop.requests + t.requests,
      tuning: { ...t },
    };
  }
}

/**
 * The requests of a run whose reply stopped at its output limit
 * (stoppedAtLimit): the agent loop's, as runAgent reports each (`loop`), and
 * the tuning's, from each request's stop reason (`tuning`, a UsageReport).
 */
export class TruncationTracker {
  private readonly cut: TruncatedRequest[] = [];
  private tuningRequests = 0; // the tuning's requests the server answered

  constructor(private readonly transport: Transport) {}

  readonly loop = ({ request, reason }: { request: number; reason: string }): void => {
    this.cut.push({ request, source: "loop", transport: this.transport, reason });
  };

  readonly tuning: UsageReport = (_usage, stopReason) => {
    this.tuningRequests += 1;
    if (stopReason && stoppedAtLimit(stopReason)) {
      this.cut.push({ request: this.tuningRequests, source: "tuning", transport: this.transport, reason: stopReason });
    }
  };

  toRecord(): Truncations {
    const of = (source: TruncatedRequest["source"]) => this.cut.filter((c) => c.source === source).length;
    return { loop: of("loop"), tuning: of("tuning"), requests: this.cut.map((c) => ({ ...c })) };
  }
}

/** Dollars to the micro-dollar, as the record keeps them. */
const usd6 = (usd: number): number => Math.round(usd * 1e6) / 1e6;

/**
 * A paid run's spend budget for its tunings past the first (TuningBudget,
 * SpendTracker.tuningBudget). The run's reserve covers its agent loop and one
 * tuning, each at its hard bound. A tune_pipeline call made once the run's
 * tuning has had a request answered (`answered`, TuningTokens) is a tuning past
 * that one: it runs only if what the budget has left covers one more, and draws
 * that share. One the budget does not cover is not run: the call's error is
 * TUNING_SKIPPED, which the model reads, the run goes on, and the record keeps
 * the skip. A run without a budget (a local model: nothing is paid) tunes as
 * often as it asks.
 */
export class TuningGate {
  private drawn = 0;
  private readonly skips: number[] = []; // what the budget had left at each skip

  constructor(
    private readonly budget: TuningBudget | null,
    private readonly answered: () => number,
  ) {}

  /** Lets a tuning start, drawing its share when it is past the run's first; throws TUNING_SKIPPED, and keeps the skip, when the budget does not cover it. */
  admit(): void {
    if (!this.budget || this.answered() === 0) return;
    const left = this.budget.leftUsd - this.drawn;
    if (!covers(left, this.budget.perTuningUsd)) {
      this.skips.push(left);
      throw new Error(TUNING_SKIPPED);
    }
    this.drawn += this.budget.perTuningUsd;
  }

  /** The tools with tune_pipeline held to the budget, as offered unchanged; without a budget, the tools as they are. */
  tools(tools: ChatTool[]): ChatTool[] {
    if (!this.budget) return tools;
    return tools.map((tool) =>
      tool.name !== "tune_pipeline"
        ? tool
        : {
            ...tool,
            run: async (args, ctx, io) => {
              this.admit();
              return tool.run(args, ctx, io);
            },
          },
    );
  }

  /** The record's tuning_budget: the budget, and each skip at its step among the run's `steps`; null without a budget. */
  toRecord(steps: readonly AgentStep[]): TuningBudgetRecord | null {
    if (!this.budget) return null;
    const at = steps.flatMap((s, i) => (s.name === "tune_pipeline" && s.summary === TUNING_SKIPPED ? [i + 1] : []));
    return {
      left_usd: usd6(this.budget.leftUsd),
      per_tuning_usd: this.budget.perTuningUsd,
      skipped: this.skips.map((left, k) => ({ step: at[k] ?? null, left_usd: usd6(left) })),
    };
  }
}

export interface RunSpec {
  job: Pick<Job, "case" | "arm" | "run">;
  dataset: Dataset; // the run's own, and the only one it sees
  model: ModelInfo; // as the record names it
  settings: Pick<LlmSettings, "baseUrl" | "model" | "apiKey" | "temperature">; // temperature null: none is sent
  rounds: number; // rounds of tool calls
  minutes: number; // the run's time limit
  price?: Price | null; // what its tokens cost; null: nothing
  context?: RunContextWindow | null; // the window it had, read before it (validationModels.runContext)
  // A paid run's budget for its tunings past the first (SpendTracker.tuningBudget,
  // TuningGate); null: none, every tuning runs (nothing is paid).
  tuningBudget?: TuningBudget | null;
  settleMs?: number; // startFresh's wait
}

/**
 * One run: startFresh, the arm's opening on the dataset's context, the agent
 * loop with every tool the Pilot ships (the arm's switch decides what it is
 * offered) under the run's validation policy, and its record. A run past its
 * time limit is aborted, and given up a minute later with the steps it had;
 * its record says so.
 */
export async function runCase(spec: RunSpec): Promise<RunRecord> {
  const { job, dataset, settings, minutes } = spec;
  const policy = validationPolicy(settings, spec.rounds);
  const cut = new TruncationTracker(policy.transport);
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
  // What goes over the wire to the model, request by request: the tools it was
  // offered. A request sent while a tuning run is going is the tuning's (the
  // loop waits for its tool to end): it offers no tools, and usage.tuning counts it.
  const recorder = new OfferRecorder(() => useTuneStore.getState().active);
  const stopRecording = recorder.install();
  // The tuning's requests go to the run's model under the run's output cap,
  // and their tokens are the run's.
  const tuning = new TuningTokens();
  const tuningUsage: UsageReport = (usage, stopReason) => {
    tuning.report(usage);
    cut.tuning(usage, stopReason);
  };
  const tuningModel = { settings, usage: tuningUsage, ...(policy.outputCap.tuning != null ? { maxTokens: policy.outputCap.tuning } : {}) };
  // A paid run's tunings past its first, held to its spend budget.
  const gate = new TuningGate(spec.tuningBudget ?? null, () => tuning.answered);
  const t0 = performance.now();
  const started = new Date().toISOString();
  const loop = runAgent({
    messages: setup.messages,
    // Every tool the Pilot ships: the run's switch (ctx.skills) decides what arm C is offered.
    tools: gate.tools(CHAT_TOOLS),
    ctx: { dataset, datasets: [dataset], skills: setup.skills, skillsRead: setup.skillsRead, model: tuningModel },
    settings: { ...settings, attachImages: false, useTools: true, followViews: false },
    policy,
    signal: abort.signal,
    usage: true,
    onTruncated: cut.loop,
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
      usage: tuning.addTo(result.usage ?? null),
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
    policy,
    truncated: cut.toRecord(),
    tuningBudget: gate.toRecord(evalRun.steps),
  });
}
