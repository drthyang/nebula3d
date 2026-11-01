// A UB turned in the reduction, as the console says it (components/ubTurn.ts):
// one plain line per status, the result first and the remedy upstream, the
// details behind "?"; and the tail sweep's voxels on a view's plane.

import { describe, expect, it } from "vitest";

import type { Misorientation, TailSweepRecord } from "../../api/types";
import { sweptOnPlane, ubTurnText } from "../ubTurn";

const base: Misorientation = {
  status: "active",
  active: true,
  n_peaks: 105,
  n_rejected: 0,
  omega_rad: [0.0017, -0.0026, 0.0083],
  angle_deg: 0.5012,
  sigma_deg: 0.0024,
  axis: [0.19, -0.29, 0.94],
  axis_uvw: [0.24, -0.33, 1],
  axis_sigma_deg: 0.66,
  r2: 0.997,
  f_stat: 3000,
  p_value: 5.6e-260,
  rms_before: 0.08,
  rms_after: 0.005,
  max_shift: 0.1125,
  voxel_q: 0.0456,
  significant: true,
  explains: true,
  resolved: true,
  rules: { min_peaks: 8 },
  round1: { rotation_aware: true, stretched: 105, centred: 0 },
};

const sweep: TailSweepRecord = {
  setting: "auto",
  ran: true,
  reason: null,
  z_gate: 5,
  n_voxels: 697,
  nodes_searched: 105,
  counts: { swept: 44, clean: 58, extended: 2, broad: 1, capped: 0, shell_capped: 0, no_hole: 0 },
  tail_voxels: { before: 437, after: 7, left_alone: 7 },
  bright_fill: { before: 0, after: 0 },
  nodes: [],
  voxels_hkl: [
    [8.0, 1.0, 0.0],
    [8.035, 1.0, 0.0],
    [8.0, 1.035, 0.035],
  ],
};

describe("the UB turn's line", () => {
  it("says the turn first and the remedy upstream, with the sweep behind ?", () => {
    const t = ubTurnText(base, sweep)!;
    expect(t.line).toBe("UB turned 0.501° ± 0.002°; tails swept at 44 nodes. Refine the UB in the reduction.");
    expect(t.tone).toBe("warn");
    expect(t.detail).toContain("about [0.24 -0.33 1] (real space)");
    expect(t.detail).toContain("explains 100% of their offsets across Q");
    expect(t.detail).toContain("437 → 7");
    expect(t.detail).toContain("3 nodes left alone as diffuse-like");
    expect(t.detail).toContain("refine the UB in the data reduction");
    expect(t.detail).not.toMatch(/regrid/i); // the user's decision: no in-app regrid
  });

  it("says plainly when there is nothing to act on, and why", () => {
    expect(ubTurnText({ ...base, status: "not_significant", angle_deg: 0.0014, sigma_deg: 0.006 })!.line).toBe("No UB turn found (0.001° ± 0.006°).");
    expect(ubTurnText({ ...base, status: "not_explained", r2: 0.04 })!.line).toBe("Peak offsets are not one UB turn (explains 4%).");
    expect(ubTurnText({ ...base, status: "unresolved", angle_deg: 0.02, sigma_deg: 0.004 })!.line).toBe("UB turned 0.020° ± 0.004°, under half a voxel: nothing to sweep.");
    expect(ubTurnText({ ...base, status: "symmetrised", angle_deg: null })!.line).toBe("UB turn not readable on symmetrised data.");
    expect(ubTurnText({ ...base, status: "too_few_peaks", n_peaks: 3 })!.detail).toContain("3 were found");
    expect(ubTurnText(null)).toBeNull();
    expect(ubTurnText(undefined, sweep)).toBeNull();
  });
});

describe("the tail sweep's voxels on a plane", () => {
  it("are those within half a voxel of the cut, as the plane's (x, y)", () => {
    // The hk plane at L = 0: the first two voxels.
    expect(sweptOnPlane(sweep, 2, 0, 0.035, 0, 1)).toEqual([
      [8, 1],
      [8.035, 1],
    ]);
    // The kl plane at H = 8: the first and the third, as (K, L).
    expect(sweptOnPlane(sweep, 0, 8, 0.035, 1, 2)).toEqual([
      [1, 0],
      [1.035, 0.035],
    ]);
    expect(sweptOnPlane(null, 0, 8, 0.035, 1, 2)).toEqual([]);
    expect(sweptOnPlane(sweep, 0, 8, 0, 1, 2)).toEqual([]);
  });
});
