// What the tools that act on the pipeline share (update_settings,
// run_pipeline, tune_pipeline): none acts while a run or a tuning run owns
// it, and the stages a call acts on are named once each, for the skill gate.

import { usePipelineStore } from "../../../state/pipelineStore";
import { useTuneStore } from "../../tune/tuner";

// Neither acts while a run or a tuning run is going: both own the pipeline.
export const checkIdle = () => {
  if (usePipelineStore.getState().running) throw new Error("a pipeline run is in progress; wait for it to end");
  if (useTuneStore.getState().active) throw new Error("a tuning run is in progress; wait for it to end");
};

export const unique = <T>(xs: T[]): T[] => [...new Set(xs)];
