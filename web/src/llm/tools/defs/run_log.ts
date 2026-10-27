// run_log: the log of the last pipeline run in this session.

import { STAGES, usePipelineStore } from "../../../state/pipelineStore";
import { num, oneOf } from "../shared/args";
import { ToolArgError, type ChatTool } from "../types";

export const run_log: ChatTool = {
  name: "run_log",
  facts: { label: "Read the run log", acts: null, reachesBackend: false, highlights: ["log"], measures: false },
  description:
    "The log of the last pipeline run in this session: each stage's start, skip, result and error lines (how many ring shells were fitted, peaks punched, voxels left unmeasured, the back-FFT r, …) and how the run ended. Use it to explain a result or a failure.",
  parameters: {
    type: "object",
    properties: {
      stage: { type: "string", enum: STAGES, description: "Only this stage's lines (default all)" },
      limit: { type: "integer", minimum: 1, maximum: 60, description: "The last N lines (default 30)" },
    },
  },
  run: async (args) => {
    const { events, terminal, running } = usePipelineStore.getState();
    if (!events.length) throw new Error("no pipeline run in this session yet");
    const stage = args.stage === undefined ? null : oneOf(args, "stage", STAGES);
    const limit = Math.round(num(args, "limit", 30));
    if (limit < 1 || limit > 60) throw new ToolArgError("limit must be within [1, 60]");
    const lines = events
      .filter((e) => e.message && (!stage || e.stage === stage))
      .slice(-limit)
      .map((e) => ({ stage: e.stage ?? null, status: e.status ?? null, message: e.message }));
    const ended = running ? "still running" : (terminal ?? "unknown");
    return {
      result: { ended, lines },
      summary: `${lines.length} line${lines.length === 1 ? "" : "s"} · ${ended}`,
      view: { view: "execution", label: "the run log" },
    };
  },
};
