// A finished reply's steps in the transcript (chatStore.ts asRead): the
// overlay data stays out, the ring verdict's ring-output mark stays in.

import { describe, expect, it } from "vitest";

import type { AgentStep } from "../../agent";
import { useChatStore } from "../../chatStore";

describe("the transcript", () => {
  it("drops a step's overlay data and keeps its ring-output mark", () => {
    const step: AgentStep = {
      id: "0:c1",
      name: "assess_stage",
      args: { stage: "rings" },
      status: "done",
      result: "{}",
      full: "{}",
      overlay: { ringsAtGrid: [2.5], leftovers: [] },
      outcomes: [{ check: "rings", kind: "attention", ringOutput: { dataset: "demo", written: 100, runs: 1 } } as never],
    };
    useChatStore.getState().addTurn({ role: "assistant", content: "x", steps: [step] });
    const turns = useChatStore.getState().turns;
    const kept = turns[turns.length - 1].steps![0];
    expect(kept).not.toHaveProperty("overlay");
    expect(kept).not.toHaveProperty("full");
    expect(kept).not.toHaveProperty("outcomes");
    expect(kept.ringOutput).toEqual({ dataset: "demo", written: 100, runs: 1 });
  });
});
