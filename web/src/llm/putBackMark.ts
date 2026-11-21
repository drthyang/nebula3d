// The mark an auto run leaves in its steps where it put a fix's outputs back
// without a run (auto/controller.ts, putBack). The outputs of the stages from
// the fix's stage on changed there, as a run of the pipeline would have
// changed them: a check made before it measured outputs that are gone. The
// readers that hold a measurement to the last run that recomputed its stage
// (evidence.ts, recomputedAt; tools/shared/ringGate.ts) take the mark as such
// a run.
//
// It is a step in the run's record only, the app's own bookkeeping. It is no
// tool: no model is offered it, and nothing a model reads names it (it is not
// seeded into a reply, the digest and the phase prompts hold no step, and an
// auto reply has no chat history). Its result holds the stages alone, no
// number, so it is no source of one. The console shows no row for it: the
// fix's own row says the fix was put back.
// A leaf module (a type alone comes in), so the tools' own modules can read it.

import type { AgentStep } from "./agent";

/** The mark's name, where a step's tool name goes. No tool has it. */
export const OUTPUTS_PUT_BACK = "outputs_put_back";

/** Whether a step is the mark. */
export const isPutBackMark = (s: Pick<AgentStep, "name">): boolean => s.name === OUTPUTS_PUT_BACK;

/** Whether an id is a mark's: not one of the app's own calls ("auto:…"), so no list of those shows it. */
export const putBackMarkId = (run: string, n: number): string => `put-back:${run}:${n}`;

/** The mark for outputs put back: `stages`, those whose outputs changed (the stages a run from the fix's stage would have computed), worded as a run's result words them. */
export function putBackMark(id: string, stages: readonly string[]): AgentStep {
  return { id, name: OUTPUTS_PUT_BACK, args: {}, status: "done", result: JSON.stringify({ stages: Object.fromEntries(stages.map((s) => [s, "computed"])) }) };
}
