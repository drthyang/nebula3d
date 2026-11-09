// A run of the pipeline from a stage, as run_pipeline runs it and reads its
// result for the model: run_pipeline's own run (tools/defs/run_pipeline.ts),
// and an Apply card's Run (apply/actions.ts), which may start from the
// symmetry average, a stage run_pipeline's from_stage does not name. When
// the punch's record says its sharp peaks off the lattice bunch at one
// commensurate fraction, the result carries the question for the user
// (metrics/bunching.ts).

import { fetchBraggProfile, fetchDataset } from "../../../api/client";
import type { JobEvent } from "../../../api/types";
import { useNavStore } from "../../../state/navStore";
import { enabledStages, runFrom, runMs, STAGE_LABELS, STAGES, usePipelineStore } from "../../../state/pipelineStore";
import { safe, stageVolumeId } from "../../context/loadContext";
import { offLatticeBunching } from "../../metrics/bunching";
import type { RunStage } from "../../tune/catalog";
import type { ToolContext, ToolIO, ToolOutcome } from "../types";
import { checkIdle } from "./pipeline";

// The stages as the tool's lines name them to the model: the console's labels
// (STAGE_LABELS), but the flatten keeps the name the model's other texts give
// it while the validation frozen at 812e686 waits for its live runs
// (docs/evals.md, "The freeze"); the console calls it "Background correction".
const TOOL_STAGE_LABELS: Record<string, string> = { ...STAGE_LABELS, flatten: "Flatten" };
const stageLabel = (stage?: string): string => (stage ? TOOL_STAGE_LABELS[stage] ?? stage : "");

// One log line: "Bragg punch 45% · fitting 312 peaks".
const eventLine = (ev: JobEvent): string =>
  [
    stageLabel(ev.stage) + (ev.fraction != null && ev.status === "progress" ? ` ${Math.round(ev.fraction * 100)}%` : ""),
    ev.message,
  ]
    .filter(Boolean)
    .join(" · ");

const stageIndex = (stage: string): number => (STAGES as readonly string[]).indexOf(stage);

/**
 * Run the pipeline from `from` (null: as the Run button does), as run_pipeline
 * does, and read the result the model reads: run_pipeline's own run, and an
 * Apply card's Run from a stage the model has no name for (the symmetry
 * average). The run is runFrom's: the enabled stages before `from` (the
 * symmetry average while it is on, the ring removal, ...) are reused while
 * their records say they still follow, and recomputed when they do not, or
 * are missing. The result names a stage the run takes only
 * for that (one before `from`) where the run computed it, so a run that
 * reused them reads as it did when they were not part of it.
 */
export async function runPipelineFrom(from: RunStage | null, ctx: ToolContext, io: ToolIO): Promise<ToolOutcome> {
  checkIdle();
  const pipe = usePipelineStore.getState();
  const downstream = enabledStages(pipe).filter((st) => !from || stageIndex(st) >= stageIndex(from));
  if (!downstream.length) throw new Error(`every stage${from ? ` from ${stageLabel(from)} on` : ""} is switched off`);
  const { stages, force, forceFrom } = runFrom(pipe, from);
  // The stages the run takes before `from` only to reuse them while they
  // still follow: one it reused is no part of the result.
  const upstream = new Set(stages.filter((st) => !downstream.includes(st)));
  const reusedUpstream = (e: { stage?: string; status?: string }): boolean => !!e.stage && upstream.has(e.stage) && e.status === "skip";

  useNavStore.getState().setTab("execution");
  let seen = 0;
  const unsubscribe = usePipelineStore.subscribe(({ events }) => {
    if (events.length === seen) return;
    seen = events.length;
    const ev = events[events.length - 1];
    if (!ev) return; // the log emptied (a run starting): nothing to say yet
    const at = ev.stage ? stages.indexOf(ev.stage) : -1;
    io.progress?.((at >= 0 ? `${at + 1}/${stages.length} ` : "") + eventLine(ev));
  });
  const cancel = () => void usePipelineStore.getState().cancel();
  io.signal?.addEventListener("abort", cancel);
  // The run's time as the Execution page shows it (runMs: from its request to
  // its end as heard), not to when this call resumed, after the listings were
  // read again.
  let ended: string;
  try {
    ended = await usePipelineStore.getState().runStages(stages, { datasetId: ctx.dataset.id, force, ...(forceFrom ? { forceFrom } : {}) });
  } finally {
    unsubscribe();
    io.signal?.removeEventListener("abort", cancel);
  }
  const seconds = Math.round((runMs(usePipelineStore.getState()) ?? 0) / 100) / 10;
  const events = usePipelineStore.getState().events.filter((e) => !reusedUpstream(e));

  if (ended !== "done") {
    // The job's own end (end: the server's reason for a failed job, shown on
    // the Execution page) is not among the lines the model reads.
    const failed = [...events].reverse().find((e) => e.status === "error" && !e.end);
    throw new Error(`the run ${ended === "cancelled" ? "was cancelled" : "failed"}${failed ? `: ${eventLine(failed)}` : ""}`);
  }
  // The last word on each stage: done = computed, skip = its output was reused.
  const outcome: Record<string, string> = {};
  for (const e of events) {
    if (e.stage && (e.status === "done" || e.status === "skip")) outcome[e.stage] = e.status === "done" ? "computed" : "reused";
  }
  const fresh = await safe(fetchDataset(ctx.dataset.id));
  if (fresh) ctx.dataset = fresh;
  const computed = Object.values(outcome).filter((o) => o === "computed").length;
  // The punch's record of the outputs as they now are: its sharp peaks off
  // the lattice bunched at one commensurate fraction, put to the user.
  const record = stageVolumeId(ctx.dataset, "braggpunched") ? await safe(fetchBraggProfile(ctx.dataset.id)) : null;
  const bunching = offLatticeBunching(record?.modulation);
  const result = {
    ended,
    seconds,
    stages: outcome,
    outputs: ctx.dataset.stages.filter((s) => s.exists).map((s) => s.name),
    log_tail: events.filter((e) => e.message).slice(-5).map(eventLine),
    ...(bunching ? { off_lattice_bunching: bunching } : {}),
  };
  return {
    result,
    summary: `done in ${seconds} s · ${computed} computed, ${Object.keys(outcome).length - computed} reused`,
  };
}
