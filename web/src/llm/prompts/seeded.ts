// The checks an auto-mode phase already ran, as the reply's first steps
// (tools/round.ts, seedRound), written into the phase's message for a
// transport that refuses a round of tool calls the model did not make
// (Claude with its thinking replayed: a turn that called tools must open with
// the model's own thinking block; auto/transport.ts). Model-visible: each
// step's tool, its arguments and its result exactly as the round would have
// sent them, numbered as the reply's steps are, before the phase's request.
// The steps are registered as the reply's own all the same (agent.ts), so the
// answer checks, {{tool.field}} and the ring gate read them as they read a
// round.

import type { AgentStep } from "../agent";

/** The steps as the message carries them, then the request (`prompt`) after them. */
export function seededMessage(steps: readonly Pick<AgentStep, "name" | "args" | "result">[], prompt: string): string {
  const listed = steps.map((s, i) => `[step ${i + 1}] ${s.name} ${JSON.stringify(s.args)}\n${s.result ?? ""}`);
  return [`Checks already run for this request, as tool calls (each result as its tool returned it):`, ...listed, prompt].join("\n\n");
}
