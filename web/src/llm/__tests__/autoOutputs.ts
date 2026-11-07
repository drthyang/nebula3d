// What the stubbed runs' outputs follow, for auto mode's tests (autoHarness.ts):
// the settings the last run ran with, and the test's own change to an
// evaluation on top of the crystal's. A leaf module (types alone come in), so
// a test file's mock of tune/evaluate can import it without a cycle.

import type { PipelineConfig } from "../../state/pipelineStore";
import type { TuneStage } from "../tune/catalog";

export const outputs = {
  ranWith: {} as Partial<PipelineConfig>,
  tweak: ((_stage: TuneStage, e: Record<string, unknown>) => e) as (stage: TuneStage, e: Record<string, unknown>, ranWith: Partial<PipelineConfig>) => Record<string, unknown>,
};
