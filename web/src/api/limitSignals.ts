// What the in-browser engine last ran into of its limits (browserLimit.ts), as
// the engine saw it: a load the size gate refused, and a run that failed of
// one. An observable, as engineMemory.ts is, for the run-it-locally card
// (components/LocalHandoff.tsx). The engine sets them (pyodideEngine.ts):
// a successful load clears the refusal, each run's start clears the failure.

import type { BrowserLimit } from "./browserLimit";

export interface RefusedLoad {
  fileName: string;
  limit: BrowserLimit;
  at: number; // when (ms since the epoch)
}

export interface FailedRun {
  datasetId: string;
  limit: BrowserLimit;
  at: number;
}

export interface LimitSignals {
  refusedLoad: RefusedLoad | null;
  failedRun: FailedRun | null;
}

let state: LimitSignals = { refusedLoad: null, failedRun: null };
const listeners = new Set<(s: LimitSignals) => void>();

function publish(next: LimitSignals): void {
  if (next.refusedLoad === state.refusedLoad && next.failedRun === state.failedRun) return;
  state = next;
  for (const fn of listeners) fn(state);
}

export function getLimitSignals(): LimitSignals {
  return state;
}

export function subscribeLimitSignals(fn: (s: LimitSignals) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setRefusedLoad(fileName: string, limit: BrowserLimit): void {
  publish({ ...state, refusedLoad: { fileName, limit, at: Date.now() } });
}

export function clearRefusedLoad(): void {
  publish({ ...state, refusedLoad: null });
}

export function setFailedRun(datasetId: string, limit: BrowserLimit): void {
  publish({ ...state, failedRun: { datasetId, limit, at: Date.now() } });
}

export function clearFailedRun(): void {
  publish({ ...state, failedRun: null });
}
