// The coverage of a reciprocal cut: where a circle leaves the grid, and where
// measured shells end, past a beam-stop gap at the origin.

import { describe, expect, it } from "vitest";

import { coverageMetrics } from "../metrics/coverage";
import { makeSlice } from "./helpers";

describe("coverageMetrics", () => {
  // A 81×81 grid over [-10, 10]: measured between r = 1 and r = 7.
  const raw = makeSlice(81, 81, (x, y) => {
    const r = Math.hypot(x, y);
    return r >= 1 && r < 7 ? 1 : NaN;
  }, { half: 10 });

  it("finds the grid edge, the beam-stop gap, and where full coverage ends", () => {
    const m = coverageMetrics(raw)!;
    expect(m.box_q).toBe(10);
    expect(m.low_q_gap!).toBeGreaterThan(0.9);
    expect(m.low_q_gap!).toBeLessThan(1.6);
    expect(m.full_coverage_q!).toBeGreaterThan(6.4);
    expect(m.full_coverage_q!).toBeLessThanOrEqual(7);
    expect(m.shells[m.shells.length - 1].measured).toBe(0);
  });

  it("reaches the grid edge when everything was measured", () => {
    const full = makeSlice(41, 41, () => 1, { half: 10 });
    const m = coverageMetrics(full)!;
    expect(m.low_q_gap).toBe(0);
    expect(m.full_coverage_q).toBe(10);
  });
});
