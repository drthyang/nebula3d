// run_pipeline: runs the reduction pipeline on the selected dataset, as the Run
// button does, and reads the dataset's fresh listing into the context.

import { fetchDataset } from "../../../api/client";
import type { JobEvent } from "../../../api/types";
import { useNavStore } from "../../../state/navStore";
import { enabledStages, STAGE_LABELS, STAGES, usePipelineStore } from "../../../state/pipelineStore";
import { safe } from "../../context/loadContext";
import { TUNE_STAGES } from "../../tune/catalog";
import { ALL_STAGES, keysOf } from "../facts";
import { oneOf } from "../shared/args";
import { checkIdle } from "../shared/pipeline";
import type { ChatTool } from "../types";

const stageLabel = (stage?: string): string => (stage ? STAGE_LABELS[stage] ?? stage : "");

// One log line: "Bragg punch 45% · fitting 312 peaks".
const eventLine = (ev: JobEvent): string =>
  [
    stageLabel(ev.stage) + (ev.fraction != null && ev.status === "progress" ? ` ${Math.round(ev.fraction * 100)}%` : ""),
    ev.message,
  ]
    .filter(Boolean)
    .join(" · ");

export const run_pipeline: ChatTool = {
  name: "run_pipeline",
  facts: {
    label: "Ran the pipeline",
    runningLabel: "Running the pipeline",
    acts: "run",
    // It writes the stage outputs, and moves the console to the Execution page.
    invalidates: ["outputs", "view"],
    reportable: true,
    highlights: (args) => (args.from_stage === undefined ? ALL_STAGES : keysOf([args.from_stage])),
  },
  description:
    "Run the reduction pipeline on the selected dataset with the Configure page's settings, as the Run button does: " +
    "it writes the dataset's stage outputs, and the console shows the run on its Execution page while it goes. " +
    "Without from_stage, outputs that already exist are reused (unless the user switched Force on), so it computes " +
    "what is missing. With from_stage, that stage and every enabled stage after it are recomputed: use it after " +
    "update_settings. A run takes seconds to minutes. Returns how it ended, which stages were computed or reused, " +
    "and the outputs that now exist; measure them afterwards.",
  parameters: {
    type: "object",
    properties: {
      from_stage: {
        type: "string",
        enum: TUNE_STAGES,
        description: "Recompute from this stage on; omit to compute only what is missing",
      },
    },
  },
  run: async (args, ctx, io) => {
    checkIdle();
    const from = args.from_stage === undefined ? null : oneOf(args, "from_stage", TUNE_STAGES);
    const pipe = usePipelineStore.getState();
    const stages = enabledStages(pipe).filter(
      (st) => !from || STAGES.indexOf(st as (typeof STAGES)[number]) >= STAGES.indexOf(from),
    );
    if (!stages.length) throw new Error(`every stage${from ? ` from ${stageLabel(from)} on` : ""} is switched off`);
    const force = from ? true : pipe.force;

    useNavStore.getState().setTab("execution");
    let seen = 0;
    const unsubscribe = usePipelineStore.subscribe(({ events }) => {
      if (events.length === seen) return;
      seen = events.length;
      const ev = events[events.length - 1];
      const at = ev.stage ? stages.indexOf(ev.stage) : -1;
      io.progress?.((at >= 0 ? `${at + 1}/${stages.length} ` : "") + eventLine(ev));
    });
    const cancel = () => void usePipelineStore.getState().cancel();
    io.signal?.addEventListener("abort", cancel);
    const t0 = performance.now();
    let ended: string;
    try {
      ended = await usePipelineStore.getState().runStages(stages, { datasetId: ctx.dataset.id, force });
    } finally {
      unsubscribe();
      io.signal?.removeEventListener("abort", cancel);
    }
    const seconds = Math.round((performance.now() - t0) / 100) / 10;
    const events = usePipelineStore.getState().events;

    if (ended !== "done") {
      const failed = [...events].reverse().find((e) => e.status === "error");
      if (ended === "lost") throw new Error("the connection to the server was lost during the run, so how it ended is not known; the Execution page shows its end once the server answers");
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
    const result = {
      ended,
      seconds,
      stages: outcome,
      outputs: ctx.dataset.stages.filter((s) => s.exists).map((s) => s.name),
      log_tail: events.filter((e) => e.message).slice(-5).map(eventLine),
    };
    return {
      result,
      summary: `done in ${seconds} s · ${computed} computed, ${Object.keys(outcome).length - computed} reused`,
    };
  },
};
