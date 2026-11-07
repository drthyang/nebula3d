// An auto run's record (docs/pilot-auto-mode-design.md §2.5): the plan and
// each row's outcome, the clock, the limits and what was spent, the pause
// and why, the facts asked and answered, the run's steps and replies, and
// the settings snapshot Undo puts back. The controller (controller.ts)
// writes it; the Auto panel (components/AutoPanel.tsx) and the report
// (report.ts) read it.
// Kept in sessionStorage over a reload, in session files (state/session.ts),
// and read back value by value (readAutoRun). A run that was under way when
// the page reloaded comes back stopped, its row marked so, and Resume
// restarts that row. The model reads none of it but the digest
// (prompts.ts). Steps are kept as the transcript keeps them (no outcomes, no
// whole result, no overlay); one read from a session file is marked
// `restored`, and never counts as evidence (agent.ts, toolStepsIn).

import { create } from "zustand";

import { resetsWithVolume } from "../../state/volumeReset";
import type { PipelineConfig } from "../../state/pipelineStore";
import type { AgentStep } from "../agent";
import type { RunClock } from "../clock";
import { NO_USAGE, type Usage } from "../usage";
import type { SeedForm } from "../agent";
import { RUN_STAGES, type RunStage } from "../tune/catalog";
import { AUTO_LIMITS, freshPlan, ROW_IDS, type AutoLimits, type LimitHit, type PlanRow, type RowId, type RowStatus } from "./plan";

export type AutoState = "running" | "paused" | "stopped" | "done";

/** Why a run waits for you. */
export type AutoPause =
  | { kind: "fact"; proposal: string; before: RowId } // a sample fact, before the row it holds back
  | { kind: "failure"; what: "model" | "run"; message: string }; // the model server, or a pipeline run, failed

/** A fact the run asked you, and your answer. */
export interface AutoFact {
  proposal: string;
  title: string;
  shown: string; // "1 → 2"
  status: "open" | "applied" | "declined";
}

export interface AutoRun {
  id: string;
  dataset: string;
  state: AutoState;
  pause: AutoPause | null;
  plan: PlanRow[];
  at: RowId | null; // the row in progress, or stopped in
  now: string; // what it is doing, one plain line
  clock: RunClock;
  limits: AutoLimits;
  replies: number; // model replies started
  usage: Usage; // the replies' requests
  costUsd: number | null; // what they cost; null: an unpriced model (cost.ts)
  limit: LimitHit | null; // the limit that ended the fixes
  ended: string | null; // how the run ended, one line
  snapshot: Partial<PipelineConfig>; // the settings when it started, for Undo
  decisions: string[]; // the decisions made in it (auto mode's and yours), by id
  facts: AutoFact[];
  held: { proposal: string; title: string }[]; // ring changes the ring gate held: logged, never paused for
  steps: AgentStep[]; // the run's steps in order: the app's own and its replies'
  turns: number[]; // the chat turns of its replies
  turnAt: number[]; // for each of those turns, how many of the run's steps came before it: where the transcript shows the app's own steps
  reportTurn: number | null;
  pendingRun: RunStage | null; // a change applied whose run has not finished: Resume runs it first
  seedForm: SeedForm | null; // the form a transport took the seeded checks in, once found
}

interface AutoStore {
  run: AutoRun | null;
  // The app's own step under way, or the last one done, whole (its overlay
  // data with it): what the Highlights follow (examine/store.ts). Never kept.
  live: AgentStep | null;
}

const KEY = "nebula3d.pilot.auto.v1";

// A step as the record keeps it: what the model read, without what serves the live reply alone.
export const keptStep = (s: AgentStep): AgentStep => {
  const { outcomes, full, overlay, progress, ...kept } = s;
  void full;
  void overlay;
  void progress;
  const ringOutput = outcomes?.find((o) => o.check === "rings")?.ringOutput;
  return ringOutput ? { ...kept, ringOutput } : kept;
};

const forStorage = (r: AutoRun): AutoRun => ({ ...r, steps: r.steps.map(keptStep) });

const restore = (): AutoRun | null => {
  try {
    const run = readAutoRun(JSON.parse(sessionStorage.getItem(KEY) ?? "null"), { fromFile: false });
    return run && interrupted(run);
  } catch {
    return null; // no storage (private mode, tests)
  }
};

export const useAutoStore = create<AutoStore>(() => ({ run: restore(), live: null }));

useAutoStore.subscribe((s, prev) => {
  if (s.run === prev.run) return;
  try {
    if (s.run) sessionStorage.setItem(KEY, JSON.stringify(forStorage(s.run)));
    else sessionStorage.removeItem(KEY);
  } catch {
    // Full or blocked: the record just does not survive a reload.
  }
});

// Closing the volume ends the conversation, and the run with it.
resetsWithVolume(useAutoStore, { fresh: () => ({ run: null, live: null }) });

/** Change the run (none: nothing). */
export function patchRun(patch: Partial<AutoRun> | ((r: AutoRun) => Partial<AutoRun>)): void {
  useAutoStore.setState((s) => (s.run ? { run: { ...s.run, ...(typeof patch === "function" ? patch(s.run) : patch) } } : {}));
}

/** Change one row of the plan. */
export function patchRow(id: RowId, patch: Partial<PlanRow>): void {
  patchRun((r) => ({ plan: r.plan.map((row) => (row.id === id ? { ...row, ...patch } : row)) }));
}

export const rowOf = (r: AutoRun, id: RowId): PlanRow => r.plan.find((x) => x.id === id)!;

/** Whether a run holds the console: under way, not waiting for you or stopped. */
export const autoBusy = (): boolean => useAutoStore.getState().run?.state === "running";

/** Whether a run is open: under way, paused or stopped (not done). */
export const autoOpen = (): boolean => {
  const s = useAutoStore.getState().run?.state;
  return s === "running" || s === "paused" || s === "stopped";
};

/** A run under way when the page went away: stopped there, its row marked stopped, its clock paused (at `now`, when it is read back). */
export function interrupted(r: AutoRun, now = Date.now()): AutoRun {
  if (r.state !== "running") return r;
  return {
    ...r,
    state: "stopped",
    now: "Stopped: the page reloaded.",
    plan: r.plan.map((row) => (row.id === r.at && (row.status === "running" || row.status === "fixing") ? { ...row, status: "stopped" as const } : row)),
    clock: r.clock.pausedAt === null && r.clock.endedAt === null ? { ...r.clock, pausedAt: Math.max(r.clock.startedAt, now) } : r.clock,
  };
}

/** A fresh run's record. */
export function newRun(fields: Pick<AutoRun, "id" | "dataset" | "clock" | "limits" | "snapshot" | "costUsd">): AutoRun {
  return {
    ...fields,
    state: "running",
    pause: null,
    plan: freshPlan(),
    at: null,
    now: "Starting.",
    replies: 0,
    usage: { ...NO_USAGE },
    limit: null,
    ended: null,
    decisions: [],
    facts: [],
    held: [],
    steps: [],
    turns: [],
    turnAt: [],
    reportTurn: null,
    pendingRun: null,
    seedForm: null,
  };
}

/** The record as a session file keeps it. */
export const autoForFile = (): AutoRun | null => {
  const r = useAutoStore.getState().run;
  return r ? forStorage(r) : null;
};

/** Replace the record with a saved one (a session file's, read by readAutoRun). */
export function restoreAutoRun(run: AutoRun | null): void {
  useAutoStore.setState({ run: run && interrupted(run), live: null });
}

// --------------------------------------------------------------- reading back

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const oneOf = <T extends string>(v: unknown, xs: readonly T[]): v is T => isStr(v) && (xs as readonly string[]).includes(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isStr) : []);
const numbers = (v: unknown): number[] => (Array.isArray(v) ? v.filter(isNum) : []);

const STATES: readonly AutoState[] = ["running", "paused", "stopped", "done"];
const STATUSES: readonly RowStatus[] = ["pending", "running", "fixing", "passed", "fixed", "attention", "not judged", "done", "needs you", "stopped", "failed", "skipped"];
const LIMITS: readonly LimitHit[] = ["time", "replies", "cost"];
const STEP_STATUSES = ["running", "done", "error", "stopped"] as const;

function readRow(v: unknown, id: RowId): PlanRow {
  const fresh = freshPlan().find((r) => r.id === id)!;
  if (!isObj(v) || v.id !== id) return fresh;
  return {
    ...fresh,
    status: oneOf(v.status, STATUSES) ? v.status : "pending",
    tries: isNum(v.tries) ? Math.max(0, Math.floor(v.tries)) : 0,
    ...(isStr(v.detail) ? { detail: v.detail } : {}),
    ...(oneOf(v.outcome, ["pass", "attention", "info"] as const) ? { outcome: v.outcome } : {}),
    ...(Array.isArray(v.evidence)
      ? { evidence: v.evidence.flatMap((e) => (isObj(e) && isStr(e.step) && isStr(e.label) && isStr(e.text) ? [{ step: e.step, label: e.label, text: e.text }] : [])) }
      : {}),
  };
}

function readStep(v: unknown, fromFile: boolean): AgentStep | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.name) || !isObj(v.args) || !oneOf(v.status, STEP_STATUSES)) return null;
  if (!["summary", "result"].every((k) => v[k] === undefined || isStr(v[k]))) return null;
  const step: AgentStep = {
    id: v.id,
    name: v.name,
    args: v.args,
    status: v.status === "running" ? "stopped" : v.status,
    ...(isStr(v.summary) ? { summary: v.summary } : {}),
    ...(isStr(v.result) ? { result: v.result } : {}),
    ...(isObj(v.view) ? { view: v.view as unknown as NonNullable<AgentStep["view"]> } : {}),
    ...(isObj(v.ringOutput) ? { ringOutput: v.ringOutput as unknown as NonNullable<AgentStep["ringOutput"]> } : {}),
  };
  return fromFile || v.restored === true ? { ...step, restored: true } : step;
}

function readUsage(v: unknown): Usage {
  if (!isObj(v)) return { ...NO_USAGE };
  const n = (k: string) => (isNum(v[k]) ? (v[k] as number) : 0);
  return { input: n("input"), output: n("output"), cacheRead: n("cacheRead"), cacheWrite: n("cacheWrite"), requests: n("requests"), estimated: n("estimated"), ...(n("uncounted") ? { uncounted: n("uncounted") } : {}) };
}

function readClock(v: unknown): RunClock | null {
  if (!isObj(v) || !isNum(v.startedAt) || !isNum(v.pausedMs)) return null;
  return {
    startedAt: v.startedAt,
    pausedMs: v.pausedMs,
    pausedAt: isNum(v.pausedAt) ? v.pausedAt : null,
    endedAt: isNum(v.endedAt) ? v.endedAt : null,
    ...(isNum(v.limitMs) ? { limitMs: v.limitMs } : {}),
  };
}

function readPause(v: unknown): AutoPause | null {
  if (!isObj(v)) return null;
  if (v.kind === "fact" && isStr(v.proposal) && oneOf(v.before, ROW_IDS)) return { kind: "fact", proposal: v.proposal, before: v.before };
  if (v.kind === "failure" && oneOf(v.what, ["model", "run"] as const) && isStr(v.message)) return { kind: "failure", what: v.what, message: v.message };
  return null;
}

/**
 * A saved record (storage, a session file) read back: only well-formed
 * parts, each of its type; a step from a file is marked restored. Null when
 * it is no record.
 */
export function readAutoRun(v: unknown, { fromFile }: { fromFile: boolean }): AutoRun | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.dataset) || !oneOf(v.state, STATES)) return null;
  const clock = readClock(v.clock);
  if (!clock) return null;
  const plan = ROW_IDS.map((id) => readRow(Array.isArray(v.plan) ? v.plan.find((r) => isObj(r) && r.id === id) : undefined, id));
  const l = isObj(v.limits) ? v.limits : {};
  const limits = Object.fromEntries(Object.entries(AUTO_LIMITS).map(([k, d]) => [k, isNum(l[k]) ? l[k] : d])) as unknown as AutoLimits;
  const settings = isObj(v.snapshot) ? Object.fromEntries(Object.entries(v.snapshot).filter(([, x]) => isStr(x) || typeof x === "boolean")) : {};
  return {
    id: v.id,
    dataset: v.dataset,
    state: v.state,
    pause: readPause(v.pause),
    plan,
    at: oneOf(v.at, ROW_IDS) ? v.at : null,
    now: isStr(v.now) ? v.now : "",
    clock,
    limits,
    replies: isNum(v.replies) ? v.replies : 0,
    usage: readUsage(v.usage),
    costUsd: isNum(v.costUsd) ? v.costUsd : null,
    limit: oneOf(v.limit, LIMITS) ? v.limit : null,
    ended: isStr(v.ended) ? v.ended : null,
    snapshot: settings as Partial<PipelineConfig>,
    decisions: strings(v.decisions).filter((d) => /^D\d+$/.test(d)),
    facts: Array.isArray(v.facts)
      ? v.facts.flatMap((f) => (isObj(f) && isStr(f.proposal) && isStr(f.title) && isStr(f.shown) && oneOf(f.status, ["open", "applied", "declined"] as const) ? [{ proposal: f.proposal, title: f.title, shown: f.shown, status: f.status }] : []))
      : [],
    held: Array.isArray(v.held) ? v.held.flatMap((h) => (isObj(h) && isStr(h.proposal) && isStr(h.title) ? [{ proposal: h.proposal, title: h.title }] : [])) : [],
    steps: Array.isArray(v.steps) ? v.steps.map((s) => readStep(s, fromFile)).filter((s): s is AgentStep => !!s) : [],
    turns: numbers(v.turns),
    turnAt: numbers(v.turnAt),
    reportTurn: isNum(v.reportTurn) ? v.reportTurn : null,
    pendingRun: oneOf(v.pendingRun, RUN_STAGES) ? v.pendingRun : null,
    seedForm: oneOf(v.seedForm, ["round", "message"] as const) ? v.seedForm : null,
  };
}
