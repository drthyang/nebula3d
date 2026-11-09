// A run's time has one definition (runMs): from its request to its end as
// heard. The Execution page's total and the Pilot's "done in" both read it;
// they said 00:24 and 31.5 s for one run (one from the first line to the
// last, the other to after the listings were read again).

import { describe, expect, it } from "vitest";

import { JOB_STATE_KEYS, runMs, usePipelineStore } from "../pipelineStore";
import { configOf } from "../configMemory";

describe("a run's time", () => {
  it("runs from the request to the end heard, whatever came after", () => {
    expect(runMs({ startedAt: 1_000, endedAt: 32_500, running: false, times: [8_000, 30_000] })).toBe(31_500);
  });

  it("runs to now while the run runs, and to its last line when its end was not heard", () => {
    expect(runMs({ startedAt: 1_000, endedAt: null, running: true, times: [8_000] }, 11_000)).toBe(10_000);
    expect(runMs({ startedAt: 1_000, endedAt: null, running: false, times: [8_000, 21_000] })).toBe(20_000);
    // A record from before the run's request was kept: its first line.
    expect(runMs({ startedAt: null, endedAt: null, running: false, times: [8_000, 21_000] })).toBe(13_000);
    expect(runMs({ startedAt: null, endedAt: null, running: false, times: [] })).toBeNull();
  });

  it("is job state, never a setting remembered or shown", () => {
    for (const k of ["startedAt", "endedAt"]) expect(JOB_STATE_KEYS.has(k)).toBe(true);
    const kept = configOf(usePipelineStore.getState()) as Record<string, unknown>;
    expect("startedAt" in kept || "endedAt" in kept).toBe(false);
  });
});
