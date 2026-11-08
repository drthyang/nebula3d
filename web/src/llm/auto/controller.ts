// Auto mode's controller (docs/pilot-auto-mode-design.md §2): an app-side
// loop that works through a fixed, visible plan (plan.ts): preflight, a run,
// check and fix each stage, then the report.
//
//  - The app runs the checks and the pipeline itself, and moves on by the
//    verdicts the checks computed (verdicts/), never by the model's words.
//  - The model is asked only to fix a stage whose checks need attention (at
//    most limits.fixesPerStage tries) and to write the report. Each of those
//    is an ordinary Pilot reply (session.ts, askAssistant) with no chat
//    history: the dataset's summary, a digest of the run with no measured
//    number, and a fixed phase prompt (prompts.ts), its checks seeded as the
//    reply's first steps (agent.ts, tools/round.ts: seedRound), as a round of
//    calls or in the prompt's message on a transport that refuses that
//    (transport.ts). Its user words are "": it names no fact about the
//    sample, whatever its message holds.
//  - The controller never changes a setting on its own. Settings change only
//    through the model's own calls under every guard (the skill gate, the
//    ring gate, the sample-fact guard, update_settings' checks) or through
//    your click on a card. The one exception, accepted 2026-11-07 (design
//    §8, question 3): a fix that made its stage's check worse (plan.ts,
//    madeWorse) is put back, exactly as an Undo puts it back, logged as auto
//    mode's, and never a change a click made.
//  - A sample fact pauses the run just before the row it holds back
//    (plan.ts, factRow); it applies on your own click alone (a click grant,
//    llm/consent.ts, through the card's own Apply), which the run never
//    makes; Skip declines it. The time it waits for you is not counted.
//  - Every change and run is logged in the decision log as auto mode's
//    (apply/decisions.ts), so the next reply's "since the last reply" line
//    says so; Undo of auto changes (undoAutoRun) puts back the run's changes,
//    a click-made one only on your own click.
//  - Limits (plan.ts, AUTO_LIMITS) end the fixes and send the run to its
//    report, which names the limit. Pause (stopAuto) aborts the reply or the
//    pipeline run under way; Resume restarts the row it stopped in, running
//    first a change whose run had not finished. Stop (endAuto) ends the run
//    there with the app's report from what exists: no model reply, no cost.
//
// The record (store.ts) is what the Auto panel (components/AutoPanel.tsx)
// renders; the app's own step under way is published whole (store.ts, `live`)
// for the Highlights to follow.

import { fetchDataset } from "../../api/client";
import type { Dataset } from "../../api/types";
import { configOf } from "../../state/configMemory";
import { usePipelineStore, type PipelineConfig } from "../../state/pipelineStore";
import { toolStepsIn, type AgentStep } from "../agent";
import { dismissCard, applyOnClick, undoable, undoDecision } from "../apply/actions";
import { addProposals, logDecision, nextProposalNumber, updateProposal, useDecisionStore, type Decision } from "../apply/decisions";
import { buildProposals, cardSetting, runProposal, runStageFor, SETTING_KEYS, type Proposal } from "../apply/proposals";
import { marksMade } from "../answerChecks";
import { useChatStore } from "../chatStore";
import { overLimit, pauseClock, resumeClock, startClock, stopClock } from "../clock";
import type { ClickEvent } from "../consent";
import { hklVolumeId, loadPipelineContext, safe, stageVolumeId } from "../context/loadContext";
import type { PipelineContext } from "../context/pipelineContext";
import { askAssistant, type ReplyOutcome } from "../session";
import type { UsageReport } from "../provider/client";
import { autoPolicyOf, type RunPolicy } from "../runPolicy";
import { loadSettings, type LlmSettings } from "../settings";
import { callTool, CHAT_TOOLS, factsOf, type AgentTool, type ToolContext } from "../tools";
import { openView } from "../tools/openView";
import { BRAGG, DPDF, examining } from "../examine/overlays";
import { useNavStore } from "../../state/navStore";
import { useTuneStore } from "../tune/tuner";
import { RUN_STAGES, type ParamValue, type RunStage } from "../tune/catalog";
import { addUsage, measured, notCounted, type Usage } from "../usage";
import { costOf, priceOf, type Price } from "./cost";
import {
  factRow,
  holdsBack,
  isFactCard,
  isStage,
  LIMIT_WORDS,
  limitsOf,
  madeWorse,
  ordinal,
  countWord,
  rowIndex,
  ROW_IDS,
  stageKind,
  STAGE_CHECKS,
  type AutoLimits,
  type Call,
  type LimitHit,
  type PlanRow,
  type RowId,
  type RowStatus,
  type Stage,
} from "./plan";
import { problemsFound } from "./problems";
import { autoMessages, digest, fixLabel, fixPrompt, REPORT_LABEL, REPORT_PROMPT } from "./prompts";
import { keptStep, newRun, patchRow, patchRun, rowOf, useAutoStore, type AutoFact, type AutoRun } from "./store";
import { seedFormFor } from "./transport";

/** What a run starts from. */
export interface AutoStart {
  ctx: Pick<ToolContext, "dataset" | "datasets">;
  settings?: LlmSettings; // the console's unless given
  limits?: Partial<AutoLimits>;
  // The dataset's summary for each reply's context (loadContext.ts unless given).
  loadContext?: (dataset: Dataset) => Promise<PipelineContext>;
  now?: () => number; // the clock (tests give a fake one)
  // Each request cut at the output cap (autoPolicyOf): a reply's (agent.ts,
  // onTruncated) and a tuning run's in it (its stop reason); the eval records them.
  truncations?: Truncations;
}

/** Where the requests cut at the output cap are told (evals/validationRun.ts, TruncationTracker, takes these). */
export interface Truncations {
  loop: (cut: { request: number; reason: string }) => void;
  tuning: UsageReport;
}

interface Session {
  abort: AbortController;
  reply: AbortController | null; // the reply under way: the spend limit stops it alone
  settings: LlmSettings;
  policy: RunPolicy; // the replies' (autoPolicyOf): the output cap where the transport ships none
  truncations: Truncations | null;
  price: Price | null;
  loadContext: (dataset: Dataset) => Promise<PipelineContext>;
  now: () => number;
  work: { dataset: Dataset; datasets: Dataset[] }; // the dataset as the run's last call left it
  dearestReply: number; // the most one reply has cost so far, US dollars
  unwatch: (() => void) | null; // the pause's watch of the fact's card
}

let session: Session | null = null;
let loop: Promise<void> | null = null;

/** Thrown inside a row once the run has paused or stopped: the loop returns. */
class Halt extends Error {}

const run = (): AutoRun => {
  const r = useAutoStore.getState().run;
  if (!r) throw new Halt("no run");
  return r;
};

const settingsNow = (): Partial<PipelineConfig> => configOf(usePipelineStore.getState());

// The tools a fix reply holds: all but the run (the app runs from the change)
// and the regrid (only the user asks for one). The report's: the reading
// ones, and the console's view.
// Every reply comes after the run: the pre-run tools (preRun: ring_survey) are none of theirs.
const AFTER_RUN: AgentTool[] = CHAT_TOOLS.filter((t) => !factsOf(t.name).preRun);
export const FIX_TOOLS: AgentTool[] = AFTER_RUN.filter((t) => !factsOf(t.name).startsRuns || t.name === "tune_pipeline").filter((t) => factsOf(t.name).acts !== "dataset");
export const REPORT_TOOLS: AgentTool[] = AFTER_RUN.filter((t) => !factsOf(t.name).actsOnPipeline && factsOf(t.name).acts !== "dataset");

/** The checks the report rests on (as report/collect.ts measures them), on the outputs as they are. */
export function finalChecks(dataset: Dataset): Call[] {
  return [
    { name: "assess_stage", args: { stage: "all" } },
    { name: "texture_check", args: {} },
    { name: "qmax_coverage", args: {} },
    ...(dataset.stages.some((s) => s.kind === "delta_pdf" && s.exists) ? [{ name: "symmetry_check", args: {} }] : []),
    ...(stageVolumeId(dataset, "braggpunched") ? [{ name: "grain_check", args: {} }] : []),
    ...(hklVolumeId(dataset) ? [{ name: "ub_check", args: {} }] : []),
  ];
}

// ---------------------------------------------------------------- the API

/**
 * Start an auto run on `ctx`'s dataset; resolves when it pauses, stops or
 * ends. Refused while a reply, a tuning run or a pipeline run is under way,
 * or an auto run is open (Resume it, or End it).
 */
export async function startAuto(start: AutoStart): Promise<void> {
  const blocked = startBlocked();
  if (blocked) throw new Error(blocked);
  const s = openSession(start);
  const limits = limitsOf(start.limits);
  useAutoStore.setState({
    run: newRun({
      id: `A${s.now()}`,
      dataset: start.ctx.dataset.id,
      clock: startClock(s.now(), limits.minutes * 60_000),
      limits,
      snapshot: settingsNow(),
      costUsd: s.price ? 0 : null,
    }),
  });
  return go();
}

/**
 * Why a run cannot start now, or null: an auto run open, a reply, a tuning run
 * or a pipeline run under way. Read again whenever it is shown: a start
 * refused while the demo's run went on is said only while that run goes on
 * (refusalNote).
 */
export function startBlocked(): string | null {
  const open = useAutoStore.getState().run;
  if (open && open.state !== "done") return "an auto run is open: resume it or end it first";
  if (useChatStore.getState().busy) return "wait for the reply to end";
  if (useTuneStore.getState().active || usePipelineStore.getState().running) return "wait for the run under way to end";
  return null;
}

/**
 * The note under the chip after a refused start (`refused`): the reason that
 * holds now, and none once it no longer does. The note once kept the reason
 * of the moment it was refused until the next click: in the Pyodide build,
 * where a reload empties the engine and the demo is loaded and run again, a
 * click during that run left "wait for the run under way to end" standing
 * long after the run had ended (THY-65 PR 7's browser check).
 */
export const refusalNote = (refused: boolean, blocked: string | null): string | null => (refused && blocked ? `Not started: ${blocked}.` : null);

/** Resume a paused or stopped run (Retry after a failure): it restarts the row it stopped in. `start`: after a reload, the dataset and settings. */
export async function resumeAuto(start?: AutoStart): Promise<void> {
  const r = useAutoStore.getState().run;
  if (!r || r.state === "done" || r.state === "running") return;
  if (r.pause?.kind === "fact") return; // it waits for your Apply or Skip
  // The loop a stop or a pause ended unwinds first: one loop at a time.
  if (loop) await loop;
  if (!session) {
    if (!start) throw new Error("resume needs the dataset after a reload");
    openSession(start);
  }
  wake();
  return go();
}

/** Stop the run: the reply or the pipeline run under way is aborted, and the row it was in marked stopped. Resume restarts that row. */
export function stopAuto(): void {
  const r = useAutoStore.getState().run;
  if (!r || r.state === "done") return;
  session?.unwatch?.();
  if (session) session.unwatch = null;
  const at = r.at;
  patchRun((x) => ({
    state: "stopped",
    pause: null,
    now: "Stopped by you.",
    clock: pauseClock(x.clock, now()),
    plan: x.plan.map((row) => (row.id === at && !finished(row.status) ? { ...row, status: "stopped" as const } : row)),
  }));
  session?.abort.abort();
}

/**
 * Stop the run for good (the panel's Stop; Pause is stopAuto): the step under
 * way is aborted and unwinds first (what a fix reply changed is logged, its
 * run owed), then the run ends with the app's report from what exists (its
 * plan, its checks' own lines, the facts, the decisions; the report measures
 * the outputs afresh when opened, report/collect.ts): no model reply, no
 * cost. The rows it did not reach are marked not checked. `by`: who stopped
 * it, as the report says ("you"; the eval's run limit).
 */
export async function endAuto(by = "you"): Promise<void> {
  const r = useAutoStore.getState().run;
  if (!r || r.state === "done") return;
  if (r.state === "running") stopAuto();
  session?.unwatch?.();
  if (session) session.unwatch = null;
  // One loop at a time: the one the stop ended unwinds before the run ends.
  if (loop) await loop;
  const x = useAutoStore.getState().run;
  if (!x || x.id !== r.id || x.state === "done") return;
  const owed = x.pendingRun ? ` A change's run had not finished (${x.pendingRun} on): the outputs are those from before it.` : "";
  const ended = `Stopped by ${by}: the app's report, from what the run checked, with no model reply.${owed}`;
  const at = x.at;
  patchRun((y) => ({
    state: "done",
    pause: null,
    appReport: "stopped",
    // What the run's checks found so far, as the final checks' list would (auto/problems.ts).
    problems: y.problems !== undefined ? y.problems : problemsFound(y.steps),
    ended,
    now: `Stopped by ${by}.`,
    clock: stopClock(y.clock, now()),
    plan: y.plan.map((row): PlanRow => {
      if (row.id === "report") return { ...row, status: "done", detail: `the app's alone: stopped by ${by}, no model reply` };
      if (finished(row.status)) return row;
      if (row.id === at) return { ...row, status: "stopped" };
      return { ...row, status: "skipped", detail: `not checked: stopped by ${by}` };
    }),
  }));
  session = null;
}

/**
 * Apply the fact the run waits for, on the user's own click or key press
 * (`event`, the DOM's: a click grant is made only from a trusted one,
 * apply/actions.ts), with edited values (Edit) or the card's. The run goes
 * on once the card is applied, by this or by the card's own Apply.
 */
export async function applyFact(event: ClickEvent, edited?: Record<string, unknown>): Promise<void> {
  const r = useAutoStore.getState().run;
  if (r?.pause?.kind !== "fact" || !session) return;
  const p = useDecisionStore.getState().proposals.find((x) => x.id === (r.pause as { proposal: string }).proposal);
  if (!p) return;
  await applyOnClick(p, { ...session.work }, event, edited);
}

/** Skip the fact the run waits for: declined, and the run goes on; the report lists it as an open question. */
export function skipFact(): void {
  const r = useAutoStore.getState().run;
  if (r?.pause?.kind !== "fact") return;
  const p = useDecisionStore.getState().proposals.find((x) => x.id === (r.pause as { proposal: string }).proposal);
  if (p) dismissCard(p);
}

/**
 * Undo the run's changes: each change it made, newest first, put back while
 * its fields still hold it (apply/actions.ts, undoDecision); a change your
 * click made only on your own click (`event`). A Run card follows. Returns
 * how many were put back.
 */
export function undoAutoRun(event?: ClickEvent): number {
  const r = useAutoStore.getState().run;
  if (!r || r.state === "running") return 0;
  let n = 0;
  for (const id of [...r.decisions].reverse()) {
    const d = useDecisionStore.getState().decisions.find((x) => x.id === id);
    if (d && undoable(d) && undoDecision(d, event)) n += 1;
  }
  return n;
}

/**
 * How many of a run's changes Undo auto changes would put back: those still
 * standing (not undone already, by the run itself or by you). A run whose
 * changes are all back already offers no Undo.
 */
export function standingAutoChanges(run: { decisions: string[] } | null, decisions: readonly Decision[]): number {
  if (!run) return 0;
  return run.decisions.filter((id) => {
    const d = decisions.find((x) => x.id === id);
    return !!d && undoable(d);
  }).length;
}

/** The promise of the loop under way, if any (tests wait on it). */
export const autoLoop = (): Promise<void> | null => loop;

// ---------------------------------------------------------------- the loop

function openSession(start: AutoStart): Session {
  const settings = start.settings ?? loadSettings();
  session?.unwatch?.();
  session = {
    abort: new AbortController(),
    reply: null,
    settings,
    policy: autoPolicyOf(settings),
    truncations: start.truncations ?? null,
    price: priceOf(settings),
    loadContext: start.loadContext ?? (async (d) => (await loadPipelineContext(d)).context),
    now: start.now ?? Date.now,
    work: { dataset: start.ctx.dataset, datasets: start.ctx.datasets },
    dearestReply: 0,
    unwatch: null,
  };
  return session;
}

const now = (): number => (session ? session.now() : Date.now());

const FINISHED: readonly RowStatus[] = ["passed", "fixed", "attention", "not judged", "done", "skipped"];
const finished = (s: RowStatus): boolean => FINISHED.includes(s);

// Back to work after a pause or a stop: the clock goes again, and the row it stopped in restarts.
function wake(): void {
  if (session) session.abort = new AbortController();
  settleFacts();
  patchRun((r) => ({
    state: "running",
    pause: null,
    clock: resumeClock(r.clock, now()),
    plan: r.plan.map((row) => (row.status === "stopped" || row.status === "failed" || row.status === "needs you" ? { ...row, status: "pending" as const } : row)),
  }));
}

function go(): Promise<void> {
  loop = drive().finally(() => {
    loop = null;
  });
  return loop;
}

async function drive(): Promise<void> {
  for (;;) {
    const r = useAutoStore.getState().run;
    if (!r || r.state !== "running" || !session || session.abort.signal.aborted) return;
    const row = r.plan.find((x) => !finished(x.status));
    if (!row) return finish();
    try {
      holdFor(row.id);
      patchRun({ at: row.id });
      if (row.id === "preflight") await preflight();
      else if (row.id === "run") await runRow();
      else if (row.id === "report") await reportRow();
      else await stageRow(row.id);
    } catch (e) {
      // Paused, stopped or ended already (a stop unwinds what was under way): nothing more to record.
      const now = useAutoStore.getState().run;
      if (e instanceof Halt || !now || now.state !== "running" || !session || session.abort.signal.aborted || (e as Error)?.name === "AbortError") return;
      try {
        fail("run", (e as Error)?.message ?? String(e));
      } catch {
        // fail halts
      }
      return;
    }
  }
}

function finish(): void {
  const r = run();
  const ended = r.limit ? `Ended at ${LIMIT_WORDS[r.limit]}, with its report.` : "Done, with its report.";
  patchRun((x) => ({ state: "done", at: null, now: ended, ended, clock: stopClock(x.clock, now()) }));
  session?.unwatch?.();
  session = null;
}

// A failure pauses the run (§2.5): Retry (resumeAuto) restarts the row.
function fail(what: "model" | "run", message: string): never {
  if (run().state !== "running") throw new Halt(message);
  const at = run().at;
  patchRun((x) => ({
    state: "paused",
    pause: { kind: "failure", what, message },
    now: what === "model" ? `The model server failed: ${message}` : `The pipeline run failed: ${message}`,
    clock: pauseClock(x.clock, now()),
    plan: x.plan.map((row) => (row.id === at ? { ...row, status: "failed" as const } : row)),
  }));
  throw new Halt(message);
}

const stopped = (): boolean => !session || session.abort.signal.aborted;
const halt = (): never => {
  throw new Halt("stopped");
};

// ---------------------------------------------------------------- facts

/** The open facts, in the order they were found, and the row each holds back. */
const openFacts = (r: AutoRun): { fact: AutoFact; row: RowId }[] => {
  const proposals = useDecisionStore.getState().proposals;
  return r.facts.flatMap((f) => {
    const p = proposals.find((x) => x.id === f.proposal);
    return f.status === "open" && p?.status === "open" ? [{ fact: f, row: factRow(p) }] : [];
  });
};

/** Pause before `row` for the first open fact that holds it back. */
function holdFor(row: RowId): void {
  const r = run();
  const ran = rowOf(r, "run").status === "done";
  const hold = openFacts(r).find((f) => holdsBack(f.row, row, ran));
  if (hold) pauseForFact(hold.fact, row);
}

function pauseForFact(fact: AutoFact, before: RowId): never {
  patchRun((x) => ({
    state: "paused",
    pause: { kind: "fact", proposal: fact.proposal, before },
    at: before,
    now: `Needs you: ${fact.title} ${fact.shown}.`,
    clock: pauseClock(x.clock, now()),
    plan: x.plan.map((row) => (row.id === before ? { ...row, status: "needs you" as const } : row)),
  }));
  watchFact(fact.proposal);
  throw new Halt("needs you");
}

// The card's Apply or Dismiss, by any path (the pinned card, the card under
// a reply, applyFact, skipFact): the run records your answer and goes on.
function watchFact(id: string): void {
  if (!session) return;
  session.unwatch?.();
  const settled = (): Proposal | null => {
    const p = useDecisionStore.getState().proposals.find((x) => x.id === id);
    return p && p.status !== "open" ? p : null;
  };
  const answer = () => {
    const p = settled();
    if (!p || !session) return;
    session.unwatch?.();
    session.unwatch = null;
    answered(p);
  };
  session.unwatch = useDecisionStore.subscribe(answer);
}

function answered(p: Proposal): void {
  const r = run();
  if (r.pause?.kind !== "fact" || r.pause.proposal !== p.id) return;
  void (async () => {
    if (loop) await loop;
    wake();
    await go();
  })();
}

/**
 * Your answers to the run's facts, by any path (also while the run was
 * stopped): each recorded, applied or declined, with its decision. What an
 * applied fact changes is computed again from its stage on (§2.4): once the
 * run is done, its rows from there are checked afresh after a run from it.
 */
function settleFacts(): void {
  const r = run();
  const { proposals, decisions } = useDecisionStore.getState();
  const ran = rowOf(r, "run").status === "done";
  let from: RunStage | null = r.pendingRun;
  const ids: string[] = [];
  const facts = r.facts.map((f) => {
    const p = proposals.find((x) => x.id === f.proposal);
    if (f.status !== "open" || !p || p.status === "open") return f;
    const d = [...decisions].reverse().find((x) => x.proposal === p.id && x.action !== "undo");
    if (d && !r.decisions.includes(d.id)) ids.push(d.id);
    const applied = p.status === "applied";
    if (applied && ran) {
      const at = d?.runFrom ?? p.runFrom ?? stageOfFact(p);
      if (!from || RUN_STAGES.indexOf(at) < RUN_STAGES.indexOf(from)) from = at;
    }
    return { ...f, status: applied ? ("applied" as const) : ("declined" as const) };
  });
  const first: Stage | null = from ? (from === "symmetry_average" ? "rings" : from) : null;
  patchRun((x) => ({
    facts,
    decisions: [...x.decisions, ...ids],
    pendingRun: from,
    plan: first ? x.plan.map((row) => (isStage(row.id) && rowIndex(row.id) >= rowIndex(first) ? { ...row, status: "pending" as const, detail: undefined } : row)) : x.plan,
  }));
}

const stageOfFact = (p: Proposal): RunStage => {
  const row = factRow(p);
  return row === "run" || !isStage(row) ? "rings" : row;
};

/** Keep the cards a phase's steps lead to: facts to ask before the row they hold back, ring changes the gate held logged, never asked. */
function takeCards(ps: readonly Proposal[]): void {
  const facts = ps.filter(isFactCard);
  const held = ps.filter((p) => p.held === "ring");
  if (!facts.length && !held.length) return;
  patchRun((x) => ({
    facts: [...x.facts, ...facts.filter((p) => !x.facts.some((f) => f.proposal === p.id)).map((p) => ({ proposal: p.id, title: p.title, shown: p.shown.from ? `${p.shown.from} → ${p.shown.to}` : p.shown.to, status: "open" as const, at: x.steps.length }))],
    held: [...x.held, ...held.map((p) => ({ proposal: p.id, title: p.title }))],
  }));
}

/** The cards an app phase's steps lead to (no reply: turn 0, shown where the run pins them). */
function cardsFrom(steps: readonly AgentStep[]): void {
  const ps = buildProposals({
    turn: 0,
    steps,
    answer: "",
    config: usePipelineStore.getState(),
    dataset: session!.work.dataset.id,
    firstId: nextProposalNumber(),
  }).filter((p) => !alreadyAsked(p));
  addProposals(ps);
  takeCards(ps);
}

// A card the run asked already, answered or not, or one open still: not asked twice.
function alreadyAsked(p: Proposal): boolean {
  const r = run();
  const asked = new Set([...r.facts.map((f) => f.proposal), ...r.held.map((h) => h.proposal)]);
  const same = (q: Proposal) => q.kind === p.kind && JSON.stringify(q.fields) === JSON.stringify(p.fields) && JSON.stringify(q.change) === JSON.stringify(p.change);
  return useDecisionStore.getState().proposals.some((q) => q.id !== p.id && (q.status === "open" || asked.has(q.id)) && same(q));
}

// ---------------------------------------------------------------- the app's own steps

let stepNumber = 0;

/** One call the app makes itself, kept as the run's step. */
async function appStep(call: Call): Promise<AgentStep> {
  const s = session!;
  // The app's own call: no reply's steps, no user words naming anything.
  const ctx: ToolContext = { dataset: s.work.dataset, datasets: s.work.datasets, userMessage: "" };
  stepNumber += 1;
  const id = `auto:${run().id}:${stepNumber}`;
  patchRun({ now: `${factsOf(call.name).runningLabel}…` });
  useAutoStore.setState({ live: { id, name: call.name, args: call.args, status: "running" } });
  // Follow: the console goes to the page the check examines as it starts, so the
  // "Now examining" bar and the overlays follow the step under way.
  if (s.settings.followViews) followTo(call);
  let out: Awaited<ReturnType<typeof callTool>>;
  try {
    out = await callTool(ctx, call.name, call.args, { signal: s.abort.signal });
  } finally {
    if (useAutoStore.getState().live?.id === id && useAutoStore.getState().live?.status === "running") useAutoStore.setState({ live: null });
  }
  if (ctx.dataset !== s.work.dataset) s.work.dataset = ctx.dataset;
  if (stopped()) halt();
  const step: AgentStep = {
    id,
    name: call.name,
    args: out.args,
    status: out.ok ? "done" : "error",
    summary: out.summary,
    result: out.text,
    ...(out.full !== undefined ? { full: out.full } : {}),
    ...(out.view ? { view: out.view } : {}),
    ...(out.outcomes ? { outcomes: out.outcomes } : {}),
  };
  patchRun((x) => ({ steps: [...x.steps, keptStep(step)] }));
  useAutoStore.setState({ live: out.overlay ? { ...step, overlay: out.overlay } : step, work: s.work.dataset });
  // Follow, as a reply's steps do (agent.ts): the console goes to the figure the step looked at.
  if (step.status === "done" && step.view && s.settings.followViews) openView(step.view);
  return step;
}

/** The page a check examines (examine/overlays.ts, examining): the Bragg page, the ΔPDF's, or the cleanup page; none for a run. */
function followTo(call: Call): void {
  const views = Object.keys(examining({ name: call.name, args: call.args })?.views ?? {});
  if (!views.length) return;
  useNavStore.getState().setTab(views.includes(BRAGG) ? "bragg" : views.includes(DPDF) ? "dpdf" : "reciprocal");
}

const evidenceOf = (steps: readonly AgentStep[]): PlanRow["evidence"] =>
  steps.map((s) => ({ step: s.id, label: factsOf(s.name).label, text: s.summary ?? "" }));

async function preflight(): Promise<void> {
  patchRow("preflight", { status: "running" });
  const d = session!.work.dataset;
  const context = await safe(session!.loadContext(d));
  const calls: Call[] = [
    { name: "qmax_coverage", args: {} },
    // The raw volume's powder rings, nothing removed (THY-43): the Al lines,
    // the phase their neighbours may be, the rings no line explains.
    ...(hklVolumeId(d) ? [{ name: "ring_survey", args: {} }] : []),
    ...(hklVolumeId(d) ? [{ name: "ub_check", args: {} }] : []),
    ...(stageVolumeId(d, "braggpunched") ? [{ name: "grain_check", args: {} }] : []),
    // The Laue classes compared on the raw volume, only where it is not symmetrised already.
    ...(hklVolumeId(d) && context?.summary?.symmetry == null ? [{ name: "compare_laue_classes", args: {} }] : []),
  ];
  const steps: AgentStep[] = [];
  for (const c of calls) steps.push(await appStep(c));
  cardsFrom(steps);
  patchRow("preflight", { status: "done", detail: `${countWord(steps.filter((s) => s.status === "done").length)} checks ran`, evidence: evidenceOf(steps) });
}

/** A run of the pipeline by the app: from `from`, or (null) what is missing or stale; logged as auto mode's. */
async function appRun(from: RunStage | null): Promise<AgentStep> {
  if (from) patchRun({ pendingRun: from });
  // From the symmetry average, which run_pipeline does not name: a run of everything missing or stale, which recomputes it.
  const step = await appStep({ name: "run_pipeline", args: from && from !== "symmetry_average" ? { from_stage: from } : {} });
  if (step.status !== "done") fail("run", step.summary ?? "the run did not finish");
  patchRun({ pendingRun: null });
  logRun(from);
  cardsFrom([step]);
  return step;
}

function logRun(from: RunStage | null): void {
  const s = session!;
  // An open Run card the run covers is the run's: applied by it. A run of
  // what is missing or stale (from null) covers any.
  const open = useDecisionStore
    .getState()
    .proposals.find((p) => p.kind === "run" && p.status === "open" && p.dataset === s.work.dataset.id && (!from || RUN_STAGES.indexOf(p.runFrom ?? "rings") >= RUN_STAGES.indexOf(from)));
  const p = open ?? runProposal(`P${nextProposalNumber()}`, lastTurn(), s.work.dataset.id, from ?? "rings", "auto mode's run", "auto");
  if (open) updateProposal(open.id, { status: "applied" });
  else addProposals([{ ...p, status: "applied" }]);
  const title = from ? p.title : "Run of what is missing or stale";
  const d = logDecision({ proposal: p.id, kind: "run", title, shown: p.shown, action: "apply", by: "auto", at: now(), before: {}, after: {}, ...(from ? { runFrom: from } : {}) });
  patchRun((x) => ({ decisions: [...x.decisions, d.id] }));
}

const lastTurn = (): number => {
  const turns = useChatStore.getState().turns;
  return turns[turns.length - 1]?.id ?? 0;
};

async function runRow(): Promise<void> {
  patchRow("run", { status: "running" });
  const step = await appRun(null);
  patchRow("run", { status: "done", detail: step.summary, evidence: evidenceOf([step]) });
}

async function checkStage(stage: Stage): Promise<AgentStep[]> {
  const steps: AgentStep[] = [];
  for (const c of STAGE_CHECKS[stage]) steps.push(await appStep(c));
  cardsFrom(steps);
  return steps;
}

const STATUS_OF: Record<"pass" | "attention" | "info", RowStatus> = { pass: "passed", attention: "attention", info: "not judged" };

async function stageRow(stage: Stage): Promise<void> {
  patchRow(stage, { status: "running" });
  // A change applied whose run did not finish (a stop, a failure, a fact applied): run it first.
  const pending = run().pendingRun;
  if (pending) await appRun(pending);
  let checks = await checkStage(stage);
  let kind = stageKind(stage, checks);
  patchRow(stage, { outcome: kind, evidence: evidenceOf(checks) });
  if (kind !== "attention") {
    patchRow(stage, { status: STATUS_OF[kind], detail: kind === "pass" ? "passed" : "not judged" });
    return;
  }
  const limits = run().limits;
  let putBack = 0; // fixes put back for making it worse
  while (rowOf(run(), stage).tries < limits.fixesPerStage) {
    holdFor(stage);
    const hit = limitBeforeFix();
    if (hit) return endFixes(hit, stage);
    const tries = rowOf(run(), stage).tries + 1;
    patchRow(stage, { status: "fixing", tries });
    const before = settingsNow();
    let reply: ReplyOutcome | null = null;
    let changes: Decision[] = [];
    let from: RunStage = stage;
    try {
      reply = await modelReply({ label: fixLabel(stage, tries, limits.fixesPerStage), prompt: fixPrompt(stage), seed: checks, rounds: limits.fixRounds });
    } finally {
      // What the reply changed is logged however it ended (a stop, a failure,
      // the spend limit), and its run is owed: Resume, or the report, runs it first.
      changes = logChanges(before, reply?.turn ?? lastTurn());
      if (changes.length) {
        from = runStageFor(changes.flatMap((d) => Object.keys(d.after)), stage, usePipelineStore.getState() as PipelineConfig) ?? stage;
        patchRun((x) => ({ pendingRun: x.pendingRun && RUN_STAGES.indexOf(x.pendingRun) < RUN_STAGES.indexOf(from) ? x.pendingRun : from }));
      }
    }
    if (!reply) return endFixes("cost", stage);
    if (changes.length) {
      from = run().pendingRun ?? from;
      await appRun(from);
      const after = await checkStage(stage);
      if (madeWorse(stage, checks, after)) {
        // Put back exactly what the fix changed, while it stands (§8, question 3).
        for (const d of [...changes].reverse()) {
          const now = useDecisionStore.getState().decisions.find((x) => x.id === d.id);
          if (now && undoDecision(now, undefined, "auto")) {
            const undo = useDecisionStore.getState().decisions.find((x) => x.undoes === d.id);
            if (undo) patchRun((x) => ({ decisions: [...x.decisions, undo.id] }));
          }
        }
        await appRun(from);
        checks = await checkStage(stage);
        putBack += 1;
        patchRow(stage, { detail: `its ${ordinal(tries)} fix made it worse: put back` });
      } else {
        checks = after;
      }
      kind = stageKind(stage, checks);
      patchRow(stage, { outcome: kind, evidence: evidenceOf(checks) });
      if (kind !== "attention") {
        patchRow(stage, { status: kind === "pass" ? "fixed" : "not judged", detail: kind === "pass" ? `passed after its ${ordinal(tries)} fix` : "not judged after a fix" });
        return;
      }
    }
  }
  const tries = rowOf(run(), stage).tries;
  const back = putBack ? ` (${countWord(putBack)} put back: ${putBack === 1 ? "it" : "they"} made it worse)` : "";
  patchRow(stage, { status: "attention", detail: `still needs attention after ${countWord(tries)} fix${tries === 1 ? "" : "es"}${back}` });
}

/** A limit ends the fixes: the stage stays as its checks found it, the stages after it are not checked, and the run goes to its report. */
function endFixes(hit: LimitHit, stage: Stage): void {
  patchRun((x) => ({
    limit: x.limit ?? hit,
    plan: x.plan.map((row) =>
      row.id === stage
        ? { ...row, status: "attention" as const, detail: `still needs attention: ${LIMIT_WORDS[hit]} ended its fixes` }
        : isStage(row.id) && !finished(row.status)
          ? { ...row, status: "skipped" as const, detail: `not checked: ${LIMIT_WORDS[hit]}` }
          : row,
    ),
  }));
}

/** The limit a fix would pass: the time, the replies (one kept for the report), or the spend (room kept for the report). */
function limitBeforeFix(): LimitHit | null {
  const r = run();
  const s = session!;
  if (overLimit(r.clock, now())) return "time";
  if (r.replies + 2 > r.limits.replies) return "replies";
  if (r.costUsd !== null && r.costUsd + 2 * s.dearestReply > r.limits.costUsd) return "cost";
  return null;
}

/** The settings a fix reply changed, logged as auto mode's decisions, one a setting. */
function logChanges(before: Partial<PipelineConfig>, turn: number): Decision[] {
  const after = settingsNow();
  const changed = new Set(Object.keys(after).filter((k) => before[k as keyof PipelineConfig] !== after[k as keyof PipelineConfig]));
  if (!changed.size) return [];
  const s = session!;
  const text = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));
  const pick = (from: Partial<PipelineConfig>, keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, from[k as keyof PipelineConfig]])) as Partial<PipelineConfig>;
  const covered = new Set<string>();
  const groups: { key: string | null; fields: string[] }[] = [];
  for (const key of SETTING_KEYS) {
    const c = cardSetting(key)!;
    let fields: string[];
    try {
      fields = Object.keys(c.write(c.read(after as PipelineConfig)));
    } catch {
      continue;
    }
    const mine = fields.filter((f) => changed.has(f) && !covered.has(f));
    if (!mine.length) continue;
    mine.forEach((f) => covered.add(f));
    groups.push({ key, fields });
  }
  const rest = [...changed].filter((f) => !covered.has(f));
  if (rest.length) groups.push({ key: null, fields: rest });
  const out: Decision[] = [];
  for (const g of groups) {
    const c = g.key ? cardSetting(g.key) : undefined;
    const shown = c
      ? { from: text(c.read({ ...after, ...before } as PipelineConfig)), to: text(c.read(after as PipelineConfig)) }
      : { from: g.fields.map((f) => `${f} ${text(before[f as keyof PipelineConfig])}`).join(", "), to: g.fields.map((f) => `${f} ${text(after[f as keyof PipelineConfig])}`).join(", ") };
    const runFrom = runStageFor(g.key ? [g.key] : g.fields, c?.stage ?? null, after as PipelineConfig);
    const p: Proposal = {
      id: `P${nextProposalNumber()}`,
      turn,
      kind: "setting",
      title: c?.title ?? "Settings",
      change: g.key && c ? { [g.key]: c.read(after as PipelineConfig) as ParamValue } : {},
      fields: pick(after, g.fields),
      from: pick(before, g.fields),
      shown,
      ...(runFrom ? { runFrom } : {}),
      source: { via: "auto" },
      evidence: [],
      dataset: s.work.dataset.id,
      status: "applied",
    };
    addProposals([p]);
    const d = logDecision({ proposal: p.id, kind: "setting", title: p.title, shown, action: "apply", by: "auto", at: now(), before: p.from, after: p.fields, ...(runFrom ? { runFrom } : {}) });
    out.push(d);
  }
  patchRun((x) => ({ decisions: [...x.decisions, ...out.map((d) => d.id)] }));
  return out;
}

// ---------------------------------------------------------------- the model's replies

/**
 * One model reply of the run (a fix, the report), with no chat history and
 * its checks seeded. Null when the spend limit stopped it. A stop halts the
 * run; a failure of the model server pauses it (Retry restarts the row).
 */
async function modelReply({ label, prompt, seed, rounds }: { label: string; prompt: string; seed: readonly AgentStep[]; rounds: number }): Promise<ReplyOutcome | null> {
  const s = session!;
  const r = run();
  const proposals = useDecisionStore.getState().proposals;
  const decisions = useDecisionStore.getState().decisions.filter((d) => r.decisions.includes(d.id));
  const context = await s.loadContext(s.work.dataset);
  if (stopped()) halt();
  const messages = autoMessages(context, digest({ plan: r.plan, fixesPerStage: r.limits.fixesPerStage, limit: r.limit, decisions, proposals }), prompt, rounds);
  // The run's earlier steps are this reply's evidence besides its own, the seeded ones its own.
  const seeded = new Set(seed.map((x) => x.id));
  const earlier = r.steps.filter((x) => !seeded.has(x.id));
  const reply = new AbortController();
  s.reply = reply;
  const stopReply = () => reply.abort();
  s.abort.signal.addEventListener("abort", stopReply, { once: true });
  let spent = 0;
  let capped = false;
  patchRun((x) => ({ replies: x.replies + 1, now: `${label}…` }));
  const onUsage = (u: Usage) => {
    patchRun((x) => {
      const usage = addUsage(x.usage, u);
      const cost = s.price ? costOf(usage, s.price) : null;
      if (s.price) spent += costOf(u, s.price);
      if (cost !== null && cost >= x.limits.costUsd && !capped) {
        capped = true;
        reply.abort();
      }
      return { usage, costUsd: cost };
    });
  };
  // A tuning run in the reply asks the run's model, and its requests count in
  // the run's spend as the reply's do (tune_pipeline reads ctx.model).
  const ctx: ToolContext = {
    dataset: s.work.dataset,
    datasets: s.work.datasets,
    skillsRead: new Set(),
    skillsReadEarlier: new Set(),
    earlierSteps: toolStepsIn([{ steps: earlier }]),
    marksEarlier: new Set(marksMade(earlier)),
    model: {
      settings: s.settings,
      usage: (u, stopReason) => {
        onUsage(u ? measured(u) : notCounted());
        s.truncations?.tuning(u, stopReason);
      },
      ...(s.policy.outputCap.tuning != null ? { maxTokens: s.policy.outputCap.tuning } : {}),
    },
  };
  let out: ReplyOutcome | null;
  try {
    out = await askAssistant({
      label,
      messages,
      tools: prompt === REPORT_PROMPT ? REPORT_TOOLS : FIX_TOOLS,
      ctx,
      settings: s.settings,
      signal: reply.signal,
      onUsage,
      agent: {
        seed: { steps: seed, form: seedFormFor(s.settings, r.seedForm) },
        userMessage: "",
        maxRounds: rounds,
        policy: { ...s.policy, maxRounds: rounds },
        ...(s.truncations ? { onTruncated: s.truncations.loop } : {}),
        onSeedForm: (form) => patchRun({ seedForm: form }),
      },
    });
  } finally {
    s.abort.signal.removeEventListener("abort", stopReply);
    s.reply = null;
    s.dearestReply = Math.max(s.dearestReply, spent);
  }
  if (stopped()) halt();
  if (!out) fail("model", "a reply was under way in the chat");
  // The chat's own Stop on the reply stops the run.
  if (out.stopped && !capped) {
    keepReplySteps(out);
    stopAuto();
    halt();
  }
  if (out.turn !== null) patchRun((x) => ({ turns: [...x.turns, out!.turn!], turnAt: [...x.turnAt, x.steps.length] }));
  if (capped) {
    keepReplySteps(out);
    patchRun((x) => ({ limit: x.limit ?? "cost" }));
    return null;
  }
  if (out.error) fail("model", out.error);
  if (out.result?.failure) {
    keepReplySteps(out);
    fail("model", out.result.failure.message);
  }
  keepReplySteps(out);
  // The cards the reply led to (session.ts made them): facts to ask, held ring changes logged.
  if (out.turn !== null) takeCards(useDecisionStore.getState().proposals.filter((p) => p.turn === out!.turn && p.status === "open" && !alreadyAsked(p)));
  // A run in the reply (a tuning run's kept trial) may have changed the outputs.
  const fresh = await safe(fetchDataset(s.work.dataset.id));
  if (fresh) s.work.dataset = fresh;
  return out;
}

/** The reply's own steps join the run's (the seeded ones are the run's already). */
function keepReplySteps(out: ReplyOutcome): void {
  const turn = out.turn === null ? null : useChatStore.getState().turns.find((t) => t.id === out.turn);
  const steps = (out.result?.steps ?? turn?.steps ?? []).filter((x) => !/:seed_\d+$/.test(x.id));
  if (steps.length) patchRun((x) => ({ steps: [...x.steps, ...steps.map(keptStep)] }));
}

async function reportRow(): Promise<void> {
  patchRow("report", { status: "running" });
  // A change whose run is owed (the spend limit stopped its reply): the report measures the outputs of the settings in place.
  const pending = run().pendingRun;
  if (pending) await appRun(pending);
  const checks: AgentStep[] = [];
  for (const c of finalChecks(session!.work.dataset)) checks.push(await appStep(c));
  // The problems they found, computed from their outcomes: the report's list, never the model's.
  patchRun({ problems: problemsFound(checks) });
  const r = run();
  // The report is the model's while a reply and the spend allow it; else the app's alone, which names the limit.
  const noModel: LimitHit | null = r.replies + 1 > r.limits.replies ? "replies" : r.costUsd !== null && r.costUsd >= r.limits.costUsd ? "cost" : null;
  if (noModel) {
    patchRun((x) => ({ limit: x.limit ?? noModel, appReport: "limit" }));
    patchRow("report", { status: "done", detail: `written without the model: ${LIMIT_WORDS[noModel]}`, evidence: evidenceOf(checks) });
    return;
  }
  const reply = await modelReply({ label: REPORT_LABEL, prompt: REPORT_PROMPT, seed: checks, rounds: r.limits.reportRounds });
  // Cut short by the spend limit with no turn kept: the report is the app's alone.
  patchRun({ reportTurn: reply?.turn ?? null, ...(reply?.turn == null ? { appReport: "limit" as const } : {}) });
  patchRow("report", { status: "done", detail: reply ? "written" : `cut short: ${LIMIT_WORDS.cost}`, evidence: evidenceOf(checks) });
}

// The plan's rows in order, for the panel and the tests.
export const PLAN_ROWS: readonly RowId[] = ROW_IDS;
