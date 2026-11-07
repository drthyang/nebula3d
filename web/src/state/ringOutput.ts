// The ring removal's output, as the 3D ring verdicts judged on it hold it.
//
// A ring verdict (assess_stage's rings) is the ring gate's evidence for a
// change to the ring removal (llm/tools/shared/ringGate.ts), and a card's own
// "Check rings in 3D" is its card's (llm/apply/actions.ts). Each stands only
// while the output it judged is the one there now. That is the stage records'
// notion of staleness (nebula3d.pipeline.stage_staleness): an output written
// after the one a later stage read is another output, whatever its settings.
// So any run that recomputes the ring stage, from any source, makes every
// verdict judged before it stale:
//
// - a run of this console: the Pilot's run_pipeline, a Run card, the
//   Configure page's Run, the Execution page's Run again or Retry, a restored
//   session's Recompute. Each is a run of the pipeline store, which logs the
//   ring stage's events: one that is not a skip (reused, or switched off)
//   counts, from its start, so a run stopped inside the stage counts too. A
//   tuning trial writes into its own folder, not the dataset's outputs, and
//   does not count.
// - a run outside it (the command line, another window): only the listing's
//   date of the output shows it, once the listing is read again.
//
// A verdict keeps a mark of the output (ringOutputMark): which dataset, the
// output's date as the listing had it, and how many of this console's runs
// had recomputed the stage by then. UI only: nothing here reaches the model.

import type { Dataset } from "../api/types";
import { pipelineBusy, usePipelineStore, type RunRecord } from "./pipelineStore";

/** The ring removal's output as a verdict judged it (ringOutputMark). */
export interface RingOutputMark {
  dataset: string;
  written: number | null; // the output's date as the listing had it (POSIX s); null: none listed
  runs: number; // this console's runs that had recomputed the ring stage of `dataset` by then
}

type Listing = Pick<Dataset, "id" | "stages">;

/** The ring removal's output, as the dataset lists it. */
export const RING_OUTPUT = "ringremoved";

const written = (dataset: Listing): number | null => {
  const s = dataset.stages.find((x) => x.name === RING_OUTPUT && x.exists);
  return s && typeof s.mtime === "number" ? s.mtime : null;
};

// This console's runs that recomputed the ring stage, by dataset.
const recomputed = new Map<string, number>();
const runsOf = (dataset: string): number => recomputed.get(dataset) ?? 0;

/** Whether a run's event is the ring stage computing: anything but its skip (reused, or switched off). */
export const recomputesRingStage = (e: { stage?: string; status?: string }): boolean => e.stage === "rings" && !!e.status && e.status !== "skip";

// Count each run of the pipeline store once, at its first ring-stage event
// that is not a skip. A new run replaces the store's events and its record
// (lastRun) together.
let run: RunRecord | null = null;
let counted = false;
let scanned = 0;
usePipelineStore.subscribe((s) => {
  if (s.lastRun !== run) {
    run = s.lastRun;
    counted = false;
    scanned = 0;
  }
  if (!run || run.tuning || counted) return;
  for (; scanned < s.events.length; scanned += 1) {
    if (recomputesRingStage(s.events[scanned])) {
      counted = true;
      recomputed.set(run.datasetId, runsOf(run.datasetId) + 1);
      return;
    }
  }
});

/** The ring removal's output of `dataset` as it stands now, for a verdict judged on it. */
export function ringOutputMark(dataset: Listing): RingOutputMark {
  return { dataset: dataset.id, written: written(dataset), runs: runsOf(dataset.id) };
}

/**
 * Whether the ring output a verdict judged (`mark`) is no longer the one
 * there: a run of this console recomputed the ring stage since, or one is
 * remaking the dataset's outputs now; or, given the dataset as it is listed
 * now (`dataset`), that is another dataset, or the output's date differs
 * from the one the verdict saw (written since, or gone).
 */
export function ringOutputChanged(mark: RingOutputMark, dataset?: Listing | null): boolean {
  if (runsOf(mark.dataset) !== mark.runs) return true;
  const pipe = usePipelineStore.getState();
  if (pipelineBusy(pipe) && pipe.lastRun?.datasetId === mark.dataset && !pipe.lastRun.tuning) return true;
  if (!dataset) return false;
  return dataset.id !== mark.dataset || written(dataset) !== mark.written;
}
