// Close: unload the volume and return the console to the state it starts in,
// ready to load another. Every store and module cache resets the way it says
// beside its own definition (volumeReset.ts); the memory goes back too: the
// in-browser engine restarts (its WASM heap never shrinks), the native server
// lets go of the volumes it keeps for the views. No file is deleted, on disk
// or in the server's folders.

import { releaseServerCaches } from "../api/client";
import { PYODIDE_MODE, restartEngine } from "../api/pyodideEngine";
import { queryClient } from "../api/queryClient";
import type { Dataset } from "../api/types";
import { useChatStore } from "../llm/chatStore";
import { stopAssistant } from "../llm/session";
import { stopTuning, useTuneStore } from "../llm/tune/tuner";
import { useDatasetStore } from "./datasetStore";
import { closeStream, pipelineBusy, usePipelineStore } from "./pipelineStore";
import { sessionUnsaved } from "./session";
import { resetVolumeState } from "./volumeReset";

export const CLOSE_CONFIRM = "Close this volume? Unsaved settings will be lost.";

// How long Close waits for a cancelled native run to be heard to end, and
// for the requests already sent to finish.
const SETTLE_MS = 15_000;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const working = (): boolean =>
  pipelineBusy(usePipelineStore.getState()) || useChatStore.getState().busy || useTuneStore.getState().active;

/** Whether Close asks first: a run, a reply or a tuning run in progress, or session state not saved to a file. */
export function closeNeedsConfirm(dataset: Dataset | undefined): boolean {
  return working() || sessionUnsaved(dataset);
}

async function settle(done: () => boolean, ms: number): Promise<void> {
  for (const until = Date.now() + ms; !done() && Date.now() < until; ) await pause(50);
}

/** Unload the volume (ask first with closeNeedsConfirm). */
export async function closeVolume(): Promise<void> {
  // What runs stops first: the reply, a tuning run, and the pipeline run,
  // cancelled and heard to end (a native job's end comes over its stream).
  stopAssistant();
  if (useTuneStore.getState().active) stopTuning(); // it cancels its trial's run
  const run = usePipelineStore.getState();
  if (pipelineBusy(run)) await run.cancel();
  await settle(() => !usePipelineStore.getState().running && !useChatStore.getState().busy && !useTuneStore.getState().active, SETTLE_MS);
  closeStream();
  await pause(0); // a stopped run's last rejections land before the reset

  // The selection goes first, so the closed dataset's remembered settings
  // are not overwritten by the form's reset (configMemory.ts).
  useDatasetStore.getState().closeDataset();
  resetVolumeState();

  // The in-browser engine goes at once (what it was computing goes with it).
  if (PYODIDE_MODE) restartEngine();

  // The closed volume's queries lose their components on the next render.
  // The requests already sent finish (a native one would fill the server's
  // caches again after the release), then those queries are forgotten,
  // their slices with them, the server lets go of its cached volumes, and
  // the rest, the dataset list among them, are fetched afresh.
  await pause(50);
  if (!PYODIDE_MODE) await settle(() => queryClient.isFetching() === 0, SETTLE_MS);
  queryClient.removeQueries({ predicate: (q) => q.getObserversCount() === 0 });
  if (!PYODIDE_MODE) await releaseServerCaches().catch(() => undefined); // an older server keeps them until evicted
  await queryClient.resetQueries();
}
