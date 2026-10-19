// Which tool results still describe the outputs on disk. A run (a tool whose
// facts say it changes the outputs: run_pipeline) recomputes stages and leaves
// the rest as they were (its result says which: "computed" or "reused"), so a
// measurement taken before it is evidence for a stage it reused and stale for
// one it computed. The answer checks (answerChecks.ts) and the check-verdict
// module's readers (verdicts/) count a stage's measurement only when it came
// after that stage was last computed. Each reads what the tools found, whole
// (`found`, readings/), however much of it the model read.

import type { AgentStep } from "./agent";
import { found, type Found } from "./readings";
import { factsOf } from "./tools";

export const PIPELINE_STAGES = ["rings", "punch", "backfill", "flatten", "pdf"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** The step index of the last run that recomputed each stage (-1: none in this reply). */
export function recomputedAt(steps: readonly AgentStep[]): Record<PipelineStage, number> {
  const at = Object.fromEntries(PIPELINE_STAGES.map((s) => [s, -1])) as Record<PipelineStage, number>;
  steps.forEach((step, i) => {
    // Its own check of the status: a run that failed changed nothing, where a
    // run whose result says nothing (`found` reads null) changed every stage.
    if (!factsOf(step.name).invalidates.includes("outputs") || step.status !== "done") return;
    const r = found(step);
    const stages = r && typeof r.stages === "object" ? (r.stages as Readonly<Record<string, unknown>> | null) : null;
    // A result that does not say which stages it computed changed them all.
    for (const s of PIPELINE_STAGES) if (!stages || stages[s] === "computed") at[s] = i;
  });
  return at;
}

/** Whether step `i` measured `stage` as it now is: after the last run that recomputed it (always, for none). */
export const current = (at: Record<PipelineStage, number>, stage: PipelineStage | null, i: number): boolean =>
  stage === null || i > at[stage];

/** The successful steps of a tool, with their index, newest first, and what each found (its whole result, an object). */
export function resultsNewestFirst(steps: readonly AgentStep[], name: string): { index: number; result: Found }[] {
  const out: { index: number; result: Found }[] = [];
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].name !== name) continue;
    const r = found(steps[i]); // null: an error, or a result that holds no fields
    if (r) out.push({ index: i, result: r });
  }
  return out;
}
