// Which tool results still describe the outputs on disk. A run (a tool whose
// facts say it changes the outputs: run_pipeline) recomputes stages and leaves
// the rest as they were (its result says which: "computed" or "reused"), so a
// measurement taken before it is evidence for a stage it reused and stale for
// one it computed. The answer checks (answerChecks.ts) and the computed verdict
// (verdict.ts) count a stage's measurement only when it came after that stage
// was last computed.

import type { AgentStep } from "./agent";
import { factsOf } from "./tools";

export const PIPELINE_STAGES = ["rings", "punch", "backfill", "flatten", "pdf"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

/** The step index of the last run that recomputed each stage (-1: none in this reply). */
export function recomputedAt(steps: readonly AgentStep[]): Record<PipelineStage, number> {
  const at = Object.fromEntries(PIPELINE_STAGES.map((s) => [s, -1])) as Record<PipelineStage, number>;
  steps.forEach((step, i) => {
    if (!factsOf(step.name).invalidates.includes("outputs") || step.status !== "done") return;
    let stages: Record<string, unknown> | null = null;
    try {
      const r = JSON.parse(step.result ?? "") as { stages?: Record<string, unknown> };
      stages = r && typeof r.stages === "object" ? r.stages : null;
    } catch {
      stages = null;
    }
    // A result that does not say which stages it computed changed them all.
    for (const s of PIPELINE_STAGES) if (!stages || stages[s] === "computed") at[s] = i;
  });
  return at;
}

/** Whether step `i` measured `stage` as it now is: after the last run that recomputed it (always, for none). */
export const current = (at: Record<PipelineStage, number>, stage: PipelineStage | null, i: number): boolean =>
  stage === null || i > at[stage];

/** The successful steps of a tool, with their index, newest first, whose result parses to an object. */
export function resultsNewestFirst(steps: readonly AgentStep[], name: string): { index: number; result: Record<string, unknown> }[] {
  const out: { index: number; result: Record<string, unknown> }[] = [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s.name !== name || s.status !== "done" || !s.result) continue;
    try {
      const r: unknown = JSON.parse(s.result);
      if (r && typeof r === "object" && !Array.isArray(r)) out.push({ index: i, result: r as Record<string, unknown> });
    } catch {
      // a trimmed or non-JSON result holds no fields
    }
  }
  return out;
}
