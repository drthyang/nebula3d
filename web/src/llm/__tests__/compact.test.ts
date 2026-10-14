// A tool result shortened to save room: its readings and numbers stay, lists
// and long texts go, and a result that would not shrink is left as it is.

import { describe, expect, it } from "vitest";

import { COMPACTED, compactResult, isCompacted } from "../compact";

const assessment = {
  rings: {
    verdict: "needs attention",
    criterion: "No powder ring left above, or dented below, three times its plane's noise. ".repeat(3),
    headline: "ring ratio 0.713 · left ≤ 0.149 (hk0, 2.45 Å⁻¹)",
    mean_ring_energy_ratio: 0.713,
    max_ring_left: 0.149,
    worst_ring_left: { plane: "hk0", at: 2.45, residual_fraction: 0.149 },
    ring_rule: { direction_share: 0.9, height_share: 0.15 },
    shells_judged: [{ at: 1.68, ring: false }, { at: 2.45, ring: true }, { at: 3.16, ring: false }, { at: 3.66, ring: true }, { at: 4.59, ring: false }],
    per_plane: { hk0: { ring_residuals: [{ at: 1.68, residual_fraction: 0.516 }] }, h0l: { ring_residuals: [] } },
    goal: "Remove powder/Al rings: ".repeat(20),
  },
  measured_on: ["H–K plane at L = 0", "H–L plane at K = 0", "K–L plane at H = 0"],
};

describe("compactResult", () => {
  it("keeps the verdict, headline and numbers, and drops the per-plane lists and long texts", () => {
    const short = JSON.parse(compactResult(JSON.stringify(assessment)));
    expect(short).toEqual({
      rings: {
        verdict: "needs attention",
        headline: "ring ratio 0.713 · left ≤ 0.149 (hk0, 2.45 Å⁻¹)",
        mean_ring_energy_ratio: 0.713,
        max_ring_left: 0.149,
        worst_ring_left: { plane: "hk0", at: 2.45, residual_fraction: 0.149 },
        ring_rule: { direction_share: 0.9, height_share: 0.15 },
        shells_judged: "(5 items)",
      },
      measured_on: ["H–K plane at L = 0", "H–L plane at K = 0", "K–L plane at H = 0"],
      compacted: COMPACTED,
    });
  });

  it("cuts a long text that is not JSON, and leaves a short or unshrinkable result alone", () => {
    const long = "x".repeat(1000);
    const cut = compactResult(long);
    expect(cut.length).toBeLessThan(500);
    expect(isCompacted(cut)).toBe(true);
    expect(compactResult('{"got":7}')).toBe('{"got":7}');
    expect(compactResult("plain words")).toBe("plain words");
  });
});
