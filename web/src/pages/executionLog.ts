// How the Execution page shows a run's log lines: each line's colour, from its
// status and its marks. Pure, so it is tested without the page.

import type { Dataset, JobEvent, StageStatus } from "../api/types";

/**
 * Whether a line holds a warning (⚠): something the run says the user must not
 * miss. A stage's done line can end on one, as the ring removal's does when its
 * grid is too coarse to confirm the ring candidates it detected (it subtracts none, and
 * says how many): the line, and the stage's summary that shows it, read as a
 * warning, not as a success.
 */
export const warns = (message: string | null | undefined): boolean => Boolean(message?.includes("⚠"));

/**
 * Whether a run failed because the measured coverage left the 3D-ΔPDF's window
 * no room around Q = 0 (the backend's WindowSupportError, WINDOW_SUPPORT_MESSAGE
 * in nebula3d/analysis/delta_pdf.py; in the browser its traceback ends on it):
 * the page then offers "Symmetrize here".
 */
export const WINDOW_SUPPORT_MARK = "No measured region around Q = 0 for the 3D-ΔPDF window";
export const windowSupportFailed = (message: string | null | undefined): boolean => Boolean(message?.includes(WINDOW_SUPPORT_MARK));

/** A log line's colour class, from its status and its marks (✗, ⚠, ✓, ■). */
export function logClass(ev: JobEvent): string {
  const m = ev.message ?? "";
  if (ev.status === "error" || m.startsWith("✗")) return "error";
  if (warns(m)) return "warn";
  if (ev.status === "done" || ev.status === "skip" || m.startsWith("✓")) return "success";
  if (ev.status === "start") return "blue";
  if (m.startsWith("■")) return "warn";
  if (ev.type === "done" || ev.type === "cancelled") return "dim";
  return "info";
}

// ---------------------------------------------------------------------------
// The run's phase and each stage's state, from the job's events.
// ---------------------------------------------------------------------------

// "lost": the connection to the run's job was lost and how it ended is not known (yet).
export type Phase = "idle" | "running" | "done" | "cancelled" | "error" | "lost";
export type NodeState = "done" | "active" | "failed" | "cancelled" | "pending" | "notrun" | "stale" | "unknown";

export interface StageInfo {
  status: string;
  fraction: number | null;
  message?: string;
  firstT: number;
  lastT: number;
}

/** Each stage's latest status, fraction and message, and its first and last times. */
export function stageInfo(events: readonly JobEvent[], times: readonly number[]): Record<string, StageInfo> {
  const out: Record<string, StageInfo> = {};
  events.forEach((ev, i) => {
    if (!ev.stage || !ev.status) return;
    const cur = out[ev.stage];
    if (!cur) {
      out[ev.stage] = { status: ev.status, fraction: ev.fraction ?? null, message: ev.message, firstT: times[i], lastT: times[i] };
    } else {
      cur.status = ev.status;
      cur.fraction = ev.fraction ?? null;
      cur.message = ev.message ?? cur.message;
      cur.lastT = times[i];
    }
  });
  return out;
}

/**
 * The run's phase. Only a run in progress is "running": a run that is not, and
 * has events but no end (saved mid-way), ended without saying how, which is
 * shown as a failure rather than a spinner that never stops.
 */
export function runPhase(running: boolean, terminal: string | null, events: number): Phase {
  if (running) return "running";
  if (terminal === "done" || terminal === "cancelled" || terminal === "error" || terminal === "lost") return terminal;
  return events > 0 ? "error" : "idle";
}

// The pipeline's stages in order (state/pipelineStore.ts STAGES).
const ORDER = ["symmetry_average", "rings", "punch", "backfill", "flatten", "pdf", "pdf_check"];

export interface StageStates {
  states: Record<string, NodeState>;
  inRun: string[]; // the shown stages the run was asked for, in order
  doneCount: number; // of those, the ones done or reused
  activeStage: string | null;
  activeFrac: number | null;
  staleAfter: Record<string, string>; // a stale stage the run did not ask for → the stage this run recomputed before it
}

/**
 * Each shown stage's state. A stage of the run: done (computed or reused),
 * active, failed, cancelled, or pending. A stage the run was not asked for: stale
 * when this run recomputed a stage before it and its output is still there
 * (made from what that stage wrote before), else not in this run. A stage of
 * the run that reused its output (skip) when that output is stale (`isStale`,
 * api/stale.ts) is stale too, not done; so is one it computed from a stale
 * input, once the listing was read after the run (`listingAfterRun`: before
 * that, the listing still dates the output the stage replaced). With the connection to the run lost,
 * a stage that had not ended is unknown. Without a record of what the run was
 * asked for, every shown stage counts as part of it.
 */
export function stageStates({
  visible,
  info,
  phase,
  runStages,
  hasOutput,
  isStale = () => false,
  listingAfterRun = false,
}: {
  visible: readonly string[];
  info: Record<string, StageInfo>;
  phase: Phase;
  runStages: readonly string[] | null;
  hasOutput: (stage: string) => boolean;
  isStale?: (stage: string) => boolean; // the stage's output is stale (api/stale.ts)
  listingAfterRun?: boolean; // the outputs isStale reads were listed after the run ended
}): StageStates {
  const inRun = runStages ? visible.filter((s) => runStages.includes(s)) : [...visible];
  const states: Record<string, NodeState> = {};
  const staleAfter: Record<string, string> = {};
  let doneCount = 0;
  let activeStage: string | null = null;
  let activeFrac: number | null = null;
  for (const stage of visible) {
    const s = info[stage];
    if (!inRun.includes(stage)) {
      const before = inRun.find((r) => ORDER.indexOf(r) < ORDER.indexOf(stage) && info[r]?.status === "done");
      if (before && hasOutput(stage)) {
        states[stage] = "stale";
        staleAfter[stage] = before;
      } else states[stage] = "notrun";
      continue;
    }
    if ((s?.status === "skip" || (s?.status === "done" && listingAfterRun && phase === "done")) && isStale(stage)) states[stage] = "stale";
    else if (!s) states[stage] = phase === "lost" ? "unknown" : "pending";
    else if (s.status === "done" || s.status === "skip") {
      states[stage] = "done";
      doneCount += 1;
    } else if (s.status === "error") states[stage] = "failed";
    else if (phase === "cancelled") states[stage] = "cancelled";
    else if (phase === "lost") states[stage] = "unknown";
    else if (phase === "error") states[stage] = "failed";
    else if (phase === "done") {
      states[stage] = "done"; // the run finished: the stage did, without its own last word
      doneCount += 1;
    } else {
      states[stage] = "active";
      activeStage = stage;
      activeFrac = s.fraction;
    }
  }
  return { states, inRun, doneCount, activeStage, activeFrac, staleAfter };
}

/**
 * The outputs a run's stage states are read against: those of the dataset the
 * run was made on (not the sidebar's selection, which may have changed since),
 * and none for a tuning trial, which writes into its own folder and leaves the
 * dataset's outputs as they were.
 */
export function runOutputs(
  run: { datasetId: string; tuning?: unknown } | null,
  datasets: readonly Dataset[],
  selected: string | null,
): readonly StageStatus[] | null {
  if (run?.tuning) return null;
  const id = run?.datasetId || selected;
  return datasets.find((d) => d.id === id)?.stages ?? null;
}
