// What the Auto panel shows of a run (components/AutoPanel.tsx), as plain
// words: each plan row's tone, state and aside, the run's progress, its clock
// against the limit and the time it waited for you, kept apart. Pure: the
// run's record and the time in, words out. UI only: the model reads none of it.

import { elapsedMs, formatDuration, pausedMs, totalMs, type RunClock } from "../clock";
import { isStage, ROW_TITLES, type PlanRow, type RowId } from "./plan";
import type { AutoRun } from "./store";

// The plan's rows as the panel names them.
export const TITLES: Record<RowId, string> = { ...ROW_TITLES, run: "Run pipeline" };

export const STATE_WORD: Record<AutoRun["state"], string> = { running: "Running", paused: "Paused", stopped: "Stopped", done: "Done" };

/** A row's look: its dot and its tone. */
export function rowTone(status: PlanRow["status"]): "done" | "now" | "wait" | "bad" | "muted" | "todo" {
  switch (status) {
    case "passed":
    case "fixed":
    case "done":
      return "done";
    case "running":
    case "fixing":
      return "now";
    case "needs you":
    case "stopped":
      return "wait";
    case "attention":
    case "failed":
      return "bad";
    case "not judged":
    case "skipped":
      return "muted";
    default:
      return "todo";
  }
}

/** A row's state, right-aligned: a word or two, result first. */
export function rowMeta(row: PlanRow): string {
  switch (row.status) {
    case "pending":
      return "";
    case "running":
      return row.id === "report" ? "writing" : row.id === "run" ? "running" : "checking";
    case "fixing":
      return "fixing";
    default:
      return row.status;
  }
}

/** A row's aside, after its name: what it covers, or which fix it is on. */
export function rowSub(row: PlanRow, fixesPerStage: number): string | null {
  if (row.id === "preflight" && row.status !== "done") return "coverage, UB, Laue";
  if (isStage(row.id) && row.tries > 0 && (row.status === "fixing" || row.status === "running")) return `fix ${row.tries} of ${fixesPerStage}`;
  if (isStage(row.id) && row.tries > 0 && (row.status === "fixed" || row.status === "attention")) return `${row.tries} fix${row.tries === 1 ? "" : "es"}`;
  return null;
}

const FINISHED = new Set<PlanRow["status"]>(["passed", "fixed", "attention", "not judged", "done", "skipped"]);

/** How far the plan has come, 0 to 1: its finished rows, and half of the one under way. */
export function progressOf(run: Pick<AutoRun, "plan" | "at" | "state">): number {
  const done = run.plan.filter((r) => FINISHED.has(r.status)).length;
  const under = run.state !== "done" && run.at && !FINISHED.has(run.plan.find((r) => r.id === run.at)?.status ?? "pending") ? 0.5 : 0;
  return Math.min(1, (done + under) / run.plan.length);
}

/** The row the run is on, or stopped in, or the last one it finished. */
export const currentRow = (run: AutoRun): PlanRow | null =>
  (run.at && run.plan.find((r) => r.id === run.at)) || [...run.plan].reverse().find((r) => r.status !== "pending") || null;

// A token count in a few characters: 950, 12.3k, 1.2M.
export const compact = (n: number): string => (n < 1000 ? String(n) : n < 1e6 ? `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k` : `${(n / 1e6).toFixed(1)}M`);

/** The run's clock: the time it has worked, alone (the limit is enforced, not shown: the user, 2026-11-07). */
export function clockText(clock: RunClock, now: number): string {
  return formatDuration(elapsedMs(clock, now));
}

/** The time it waited for you, kept apart, and the whole time: null while it has not waited. */
export function pausedText(clock: RunClock, now: number): string | null {
  const p = pausedMs(clock, now);
  return p >= 1000 ? `paused ${formatDuration(p)} · total ${formatDuration(totalMs(clock, now))}` : null;
}

