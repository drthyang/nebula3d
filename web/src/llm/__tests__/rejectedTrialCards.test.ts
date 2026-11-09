// A setting the answer names with a value a tuning in this conversation tried
// and did not keep gets no "Suggested in the answer" card (apply/proposals.ts,
// rejectedTrials): the run's later replies offered the ring stack window 2.5
// and the punch footprint "own", which its tunings had just rejected.

import { beforeEach, describe, expect, it } from "vitest";

import { usePipelineStore } from "../../state/pipelineStore";
import type { AgentStep } from "../agent";
import { buildProposals, rejectedTrials } from "../apply/proposals";

const tuning = (stage: string, chosen: number | undefined, trials: { n: number; changes: Record<string, unknown>; result?: string }[]): AgentStep => ({
  id: `t-${stage}`,
  name: "tune_pipeline",
  args: { stages: [stage] },
  status: "done",
  result: JSON.stringify({ minutes: 3, stages: [{ stage, status: "done", tuned: true, ...(chosen != null && { chosen_trial: chosen, of: trials.length, changes: {} }), trials }] }),
});

const cards = (answer: string, earlierSteps: AgentStep[]) =>
  buildProposals({ turn: 4, steps: [], answer, config: usePipelineStore.getState(), dataset: "demo", firstId: 1, earlierSteps }).filter((p) => p.source.via === "answer");

beforeEach(() => usePipelineStore.setState({ ...usePipelineStore.getInitialState(), running: false }));

describe("a suggestion a tuning already rejected", () => {
  const rings = tuning("rings", 1, [
    { n: 1, changes: {}, result: "ring ratio 0.13" },
    { n: 2, changes: { ringPooledWindow: 2.5 }, result: "ring ratio 0.14" },
  ]);

  it("gets no card; another value of the same setting still does", () => {
    expect(cards("Try `ringPooledWindow` 2.5 next.", [rings])).toEqual([]);
    expect(cards("Try `ringPooledWindow` 7.5 next.", [rings]).map((p) => p.change)).toEqual([{ ringPooledWindow: "7.5" }]);
  });

  it("counts only trials that ran and were not kept, of a tuning that chose", () => {
    const kept = tuning("rings", 2, [
      { n: 1, changes: {}, result: "ring ratio 0.13" },
      { n: 2, changes: { ringPooledWindow: 2.5 }, result: "ring ratio 0.12" },
    ]);
    const notRun = tuning("rings", 1, [{ n: 1, changes: {}, result: "ring ratio 0.13" }, { n: 2, changes: { ringPooledWindow: 2.5 } }]);
    const stopped = tuning("rings", undefined, [{ n: 1, changes: {}, result: "ring ratio 0.13" }, { n: 2, changes: { ringPooledWindow: 2.5 }, result: "ring ratio 0.14" }]);
    for (const t of [kept, notRun, stopped]) expect(rejectedTrials([t])).toEqual([]);
    expect(rejectedTrials([rings])).toHaveLength(1);
    expect(cards("Try `ringPooledWindow` 2.5 next.", [kept])).toHaveLength(1);
  });
});
