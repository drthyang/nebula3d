// run_pipeline: runs the reduction pipeline on the selected dataset, as the Run
// button does, and reads the dataset's fresh listing into the context. The run
// and what the model reads of it are shared/runPipeline.ts's.

import { TUNE_STAGES } from "../../tune/catalog";
import { ALL_STAGES, keysOf } from "../facts";
import { oneOf } from "../shared/args";
import { checkIdle } from "../shared/pipeline";
import { runPipelineFrom } from "../shared/runPipeline";
import type { ChatTool } from "../types";

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
    "Run the reduction pipeline on the selected dataset with the Configure page's settings, as the Run button does; the console shows it on its Execution page. Without from_stage, outputs that still follow from the settings and inputs are reused (unless Force is on) and the rest recomputed; with from_stage, that stage and every enabled one after it are recomputed: use it after update_settings. Seconds to minutes. Returns how it ended, the stages computed or reused, and the outputs, to measure next.",
  parameters: {
    type: "object",
    properties: {
      from_stage: {
        type: "string",
        enum: TUNE_STAGES,
        description: "Recompute from this stage on; omit to compute only what is missing or stale",
      },
    },
  },
  run: async (args, ctx, io) => {
    checkIdle();
    const from = args.from_stage === undefined ? null : oneOf(args, "from_stage", TUNE_STAGES);
    return runPipelineFrom(from, ctx, io);
  },
};
