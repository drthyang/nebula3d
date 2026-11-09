// Auto mode's revert-worse rule (auto/plan.ts, madeWorse) on the ring
// removal: a fix that changes the ring model and leaves far more ring than
// it took dent away is worse, and put back. Made-up numbers.

import { describe, expect, it } from "vitest";

import type { AgentStep } from "../agent";
import { madeWorse } from "../auto/plan";

const rings = (m: Record<string, unknown>): AgentStep[] => [
  {
    id: `a${JSON.stringify(m).length}`,
    name: "assess_stage",
    args: { stage: "rings" },
    status: "done",
    result: JSON.stringify({ rings: { mean_ring_energy_ratio: 0.2, max_over_subtraction_fraction: 0.03, shells_judged: [], ...m } }),
  },
];

describe("a ring fix judged against the checks before it", () => {
  it("is worse when it trades a dent for a larger ring left (the pooled model swapped for another)", () => {
    const before = rings({ max_ring_left: 0.09, max_ring_dent: 0.18, mean_ring_energy_ratio: 0.12 });
    const after = rings({ max_ring_left: 0.4, max_ring_dent: 0.05, mean_ring_energy_ratio: 0.25 });
    expect(madeWorse("rings", before, after)).toBe(true);
  });

  it("is worse when every residual grows, and not when the worst one shrinks", () => {
    const before = rings({ max_ring_left: 0.09, max_ring_dent: 0.18 });
    expect(madeWorse("rings", before, rings({ max_ring_left: 0.12, max_ring_dent: 0.2 }))).toBe(true);
    expect(madeWorse("rings", before, rings({ max_ring_left: 0.12, max_ring_dent: 0.1 }))).toBe(false);
    expect(madeWorse("rings", before, before)).toBe(false);
  });
});
