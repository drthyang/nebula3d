// What the tools that act on the pipeline share (update_settings,
// run_pipeline, tune_pipeline): none acts while a run or a tuning run owns
// it, and the stages a call acts on are named once each, for the skill gate.

import { pipelineBusy, usePipelineStore } from "../../../state/pipelineStore";
import { useTuneStore } from "../../tune/tuner";

// Neither acts while a run or a tuning run is going: both own the pipeline.
export const checkIdle = () => {
  // A run that lost its connection to the server may still be running there
  // (pipelineBusy): it holds the pipeline as a running one does, in the words
  // the model reads for one (the validation frozen at 812e686 has no other).
  if (pipelineBusy(usePipelineStore.getState())) throw new Error("a pipeline run is in progress; wait for it to end");
  if (useTuneStore.getState().active) throw new Error("a tuning run is in progress; wait for it to end");
};

export const unique = <T>(xs: T[]): T[] => [...new Set(xs)];
