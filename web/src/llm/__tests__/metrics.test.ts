import { describe, expect, it } from "vitest";

import { qRadius } from "../context/pipelineContext";
import { backfillMetrics } from "../metrics/backfill";
import { dpdfMetrics } from "../metrics/dpdf";
import { flattenMetrics } from "../metrics/flatten";
import { ringEnergy, ringMetrics } from "../metrics/rings";
import { scanLeftoverPeaks, summarizePeakProfile } from "../metrics/punch";
import { percentile, robustStats } from "../metrics/sliceStats";
import type { BraggProfile } from "../../api/types";
import { makeSlice } from "./helpers";

describe("sliceStats", () => {
  it("robustStats ignores NaN and reports median/negative fraction", () => {
    const data = new Float32Array([1, 2, 3, 4, -1, NaN]);
    const s = robustStats(data)!;
    expect(s.n).toBe(5);
    expect(s.median).toBe(2);
    expect(s.negativeFraction).toBeCloseTo(0.2, 6);
  });

  it("percentile interpolates on the sorted values", () => {
    expect(percentile([0, 10], 0.5)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5], 0)).toBe(1);
    expect(percentile([1, 2, 3, 4, 5], 1)).toBe(5);
  });
});

describe("ring removal metrics", () => {
  const ringR = 6;
  const withRing = makeSlice(41, 41, (x, y) => {
    const r = Math.sqrt(x * x + y * y);
    return 1 + 8 * Math.exp(-((r - ringR) ** 2) / 0.5); // sharp azimuthal ring
  });
  const flat = makeSlice(41, 41, () => 1);

  it("a ring has more ring energy than a flat field", () => {
    expect(ringEnergy(withRing)).toBeGreaterThan(ringEnergy(flat) + 0.05);
  });

  it("ringMetrics reports a low ratio when the ring is removed", () => {
    const m = ringMetrics(withRing, flat);
    expect(m.ring_energy_ratio).not.toBeNull();
    expect(m.ring_energy_ratio!).toBeLessThan(0.5);
    expect(m.after_negative_fraction).toBe(0);
  });

  describe("ring residuals, judged at the raw rings", () => {
    // A finer grid, so the 128 radial bins each hold enough voxels.
    const fine = (f: (r: number) => number) => makeSlice(161, 161, (x, y) => f(Math.hypot(x, y)), { half: 20 });
    const ring = (r: number) => Math.exp(-((r - ringR) ** 2) / 0.5);
    const raw = fine((r) => 1 + 8 * ring(r));

    it("finds the ring and calls a clean removal level", () => {
      const m = ringMetrics(raw, fine(() => 1));
      expect(m.ring_residuals!.map((x) => x.at)).toEqual([expect.closeTo(ringR, 0)]);
      expect(Math.abs(m.ring_residuals![0].residual_fraction)).toBeLessThan(0.01);
      expect(m.worst_ring_dent).toBeNull();
    });

    it("sees a dent where the removal over-shot, though nothing goes negative", () => {
      // 20 % too much subtracted at the ring: the diffuse dips to 0.8 there.
      const m = ringMetrics(raw, fine((r) => 1 - 0.2 * ring(r)));
      expect(m.over_subtraction_fraction).toBe(0);
      expect(m.worst_ring_dent!.at).toBeCloseTo(ringR, 0);
      expect(m.worst_ring_dent!.residual_fraction).toBeLessThan(-0.05);
      expect(m.worst_ring_left).toBeNull();
    });

    it("calls a dent within the diffuse's own wiggle noise", () => {
      // A 3 % dent where the diffuse beside the ring ripples by ±5 %.
      const m = ringMetrics(raw, fine((r) => 1 + 0.05 * Math.sin(7 * r) - 0.03 * ring(r)));
      const [res] = m.ring_residuals!;
      expect(res.noise_fraction).toBeGreaterThan(0.02);
      expect(res.significant).toBe(false);
      expect(m.worst_ring_dent).toBeNull();
    });

    it("sees a ring left over", () => {
      const m = ringMetrics(raw, fine((r) => 1 + 2 * ring(r)));
      expect(m.worst_ring_left!.residual_fraction).toBeGreaterThan(0.2);
      expect(m.worst_ring_dent).toBeNull();
    });

    it("takes neither a dip away from the rings nor the coverage edge for a dent", () => {
      // The removal is clean at the ring; the diffuse sags at r ≈ 12 and falls off
      // past r = 18, where the raw cut has no ring.
      const after = fine((r) => (r > 18 ? 0.5 : 1 - 0.3 * Math.exp(-((r - 12) ** 2) / 0.5)));
      const m = ringMetrics(raw, after);
      expect(m.ring_residuals).toHaveLength(1);
      expect(m.worst_ring_dent).toBeNull();
    });
  });

  it("sees the ring under Bragg peaks and an incident-beam spot the ring stage leaves in place", () => {
    // A cut before the punch: sharp peaks (150×) on every integer node, a beam
    // spot at the origin, and an Al-like ring at r = 4.3; step 0.1 like a real cut.
    const d = (a: number) => Math.abs(a - Math.round(a));
    const rest = (x: number, y: number) =>
      150 * Math.exp(-(d(x) ** 2 + d(y) ** 2) / (2 * 0.06 ** 2)) + 200 * Math.exp(-(x * x + y * y) / (2 * 0.3 ** 2)) + 1;
    const ring = (x: number, y: number) => 8 * Math.exp(-((Math.hypot(x, y) - 4.3) ** 2) / (2 * 0.08 ** 2));
    const raw = makeSlice(161, 161, (x, y) => rest(x, y) + ring(x, y), { half: 8 });
    const cleaned = makeSlice(161, 161, rest, { half: 8 });
    expect(ringMetrics(raw, cleaned).ring_energy_ratio!).toBeLessThan(0.3);
  });

  it("flags over-subtraction when positive voxels flip negative", () => {
    const after = makeSlice(41, 41, () => -1);
    const m = ringMetrics(flat, after);
    expect(m.over_subtraction_fraction).toBe(1);
  });
});

describe("bragg punch metrics", () => {
  // Deterministic noise in [-1, 1).
  const noise = (ix: number, iy: number) => (((ix * 7919 + iy * 104729) % 1000) / 500) - 1;
  // A peak a few voxels wide at (cx, cy) on a noisy field.
  const peakAt = (cx: number, cy: number, height: number) => (ix: number, iy: number) =>
    height * Math.exp(-((ix - cx) ** 2 + (iy - cy) ** 2) / 2);

  it("finds a resolved peak left unpunched, judged against its own neighbourhood", () => {
    const bump = peakAt(20, 20, 2);
    const slice = makeSlice(41, 41, (_x, _y, ix, iy) => 1 + 0.02 * noise(ix, iy) + bump(ix, iy));
    const scan = scanLeftoverPeaks(slice);
    expect(scan.n_suspicious).toBe(1);
    expect(scan.suspicious_peaks[0].sigma).toBeGreaterThan(8);
    expect(scan.suspicious_peaks[0].xy).toEqual([0, 0]);
  });

  it("takes a one-voxel spike for noise, and skips a noisy region", () => {
    const spike = makeSlice(41, 41, (_x, _y, ix, iy) => 1 + 0.02 * noise(ix, iy) + (ix === 20 && iy === 20 ? 5 : 0));
    expect(scanLeftoverPeaks(spike).n_suspicious).toBe(0);
    // A loud band (x > 30) with a resolved bump in it: skipped, not reported.
    const bump = peakAt(35, 20, 6);
    const edge = makeSlice(41, 41, (_x, _y, ix, iy) => 1 + (ix > 28 ? 0.6 : 0.02) * noise(ix, iy) + bump(ix, iy));
    const scan = scanLeftoverPeaks(edge);
    expect(scan.n_suspicious).toBe(0);
  });

  it("classes a peak at a lattice node or off-lattice when the cut is known", () => {
    // x, y span -2..2 r.l.u.: (1, 1) is a node, (0.5, -1) is not.
    const at = peakAt(30, 30, 2);
    const off = peakAt(25, 10, 2);
    const slice = makeSlice(41, 41, (_x, _y, ix, iy) => 1 + 0.02 * noise(ix, iy) + at(ix, iy) + off(ix, iy), { half: 2 });
    const scan = scanLeftoverPeaks(slice, { toHkl: (x, y) => [x, y, 0] });
    expect(scan.n_at_nodes).toBe(1);
    expect(scan.n_off_nodes).toBe(1);
    const byNode = Object.fromEntries(scan.suspicious_peaks.map((p) => [String(p.at_node), p.hkl]));
    expect(byNode.true).toEqual([1, 1, 0]);
    expect(byNode.false).toEqual([0.5, -1, 0]);
    // On a 2× supercell, (1, 1) is no longer a parent node.
    expect(scanLeftoverPeaks(slice, { toHkl: (x, y) => [x, y, 0], supercell: [2, 2, 1] }).n_at_nodes).toBe(0);
  });

  it("finds nothing on a punched (NaN-holed) smooth field", () => {
    const slice = makeSlice(41, 41, (_x, _y, ix, iy) => {
      if (ix === 20 && iy === 20) return NaN; // punched hole
      return 1;
    });
    expect(scanLeftoverPeaks(slice).n_suspicious).toBe(0);
  });

  it("summarizes the fitted peak profile", () => {
    const profile = {
      peaks: [
        { fit_kind: "moment", resolution_limited: [true, true, false], measured_width_q: [0.02, 0.02, 0.06] },
        { fit_kind: "moment", resolution_limited: [true, true, true], measured_width_q: [0.02, 0.02, 0.02] },
      ],
      width_units: { q: "A^-1" },
    } as unknown as BraggProfile;
    const s = summarizePeakProfile(profile)!;
    expect(s.n_peaks).toBe(2);
    expect(s.resolution_limited_fraction).toBe(1);
    expect(s.median_anisotropy!).toBeGreaterThanOrEqual(1);
    expect(s.width_units).toBe("A^-1");
  });
});

describe("backfill metrics", () => {
  it("reports a seamless fill when holes match their surroundings", () => {
    const punched = makeSlice(31, 31, (_x, _y, ix, iy) => (ix === 15 && iy === 15 ? NaN : 5));
    const filled = makeSlice(31, 31, () => 5);
    const m = backfillMetrics(punched, filled);
    expect(m.n_filled).toBe(1);
    expect(m.median_seam_sigma).toBe(0);
    expect(m.bright_fill_fraction).toBe(0);
  });

  it("flags a bright residual plug where a peak was not removed", () => {
    const punched = makeSlice(31, 31, (_x, _y, ix, iy) => (ix === 15 && iy === 15 ? NaN : 1));
    const filled = makeSlice(31, 31, (_x, _y, ix, iy) => (ix === 15 && iy === 15 ? 50 : 1));
    const m = backfillMetrics(punched, filled);
    expect(m.bright_fill_fraction).toBe(1);
    expect(m.median_seam_sigma!).toBeGreaterThan(1);
  });
});

describe("delta pdf metrics", () => {
  it("measures feature SNR and anisotropy of a directional pattern", () => {
    // A horizontal ridge of strong features away from the origin.
    const slice = makeSlice(61, 61, (x, y) => {
      const noise = 0.05 * Math.sin(x * 3.1 + y * 2.7);
      if (Math.abs(y) < 1.2 && Math.abs(x) > 6) return 3 + noise;
      return noise;
    });
    const m = dpdfMetrics(slice)!;
    expect(m.feature_snr!).toBeGreaterThan(5);
    expect(m.strong_feature_fraction!).toBeGreaterThan(0);
    expect(m.anisotropy_ratio!).toBeGreaterThan(1.5);
    // Ridge runs along x → major axis near 0°.
    expect(Math.abs(m.anisotropy_angle_deg!)).toBeLessThan(20);
  });

  it("measures directions in true Cartesian space on an oblique section", () => {
    // A ridge along the oblique diagonal h = v.  On a hexagonal ab-plane
    // (axes at 120°) a + b points at 60°, not the 45° a right angle would give.
    const ridge = (x: number, y: number) => {
      const noise = 0.05 * Math.sin(x * 3.1 + y * 2.7);
      return Math.abs(x - y) < 1.2 && Math.abs(x) > 6 ? 3 + noise : noise;
    };
    const square = dpdfMetrics(makeSlice(61, 61, ridge))!;
    expect(square.anisotropy_angle_deg!).toBeCloseTo(45, 0);
    const hex = makeSlice(61, 61, ridge);
    hex.header.axes_angle = 120;
    const m = dpdfMetrics(hex)!;
    expect(m.anisotropy_angle_deg!).toBeCloseTo(60, 0);
  });

  it("handles a full-resolution slice without overflowing the stack", () => {
    // 401×401 ≈ 160k voxels — a spread into Math.max(...) would overflow here.
    const big = makeSlice(401, 401, (x, y) => 0.01 * Math.sin(x + y) + (Math.abs(x) < 2 && Math.abs(y) > 8 ? 2 : 0));
    expect(() => dpdfMetrics(big)).not.toThrow();
    const m = dpdfMetrics(big)!;
    expect(m.feature_snr!).toBeGreaterThan(0);
  });

  it("passes through consistency metrics when no slice is given", () => {
    const m = dpdfMetrics(null, {
      consistency: {
        pearson_r: 0.97,
        normalized_rms: 0.04,
      } as never,
    })!;
    expect(m.consistency_pearson_r).toBe(0.97);
    expect(m.feature_snr).toBeNull();
  });
});

describe("ring metrics on a hexagonal cell", () => {
  // a = b = 4 Å, γ = 120°: on the H–K plane the r.l.u. axes meet at 60°, so a
  // powder ring (one |Q|) is an ellipse in (H, K), not a circle.
  const meta = { lattice: { a: 4, b: 4, c: 6, alpha: 90, beta: 90, gamma: 120 } };
  const q = qRadius("hk0", 0, meta)!;
  const R = 3; // Å⁻¹
  const ring = makeSlice(121, 121, (h, k) => 1 + 8 * Math.exp(-((q(h, k) - R) ** 2) / (2 * 0.03 ** 2)), { half: 3 });
  // What the context used before: |Q| as if a* ⊥ b*, |a*| = 2π/a.
  const s = (2 * Math.PI) / 4;
  const orthogonal = (h: number, k: number) => Math.hypot(h * s, k * s);

  it("|Q| follows the reciprocal metric", () => {
    // |a*| = 2π / (a sin γ), and a*, b* meet at γ* = 60°: |a* − b*| = |a*|,
    // |a* + b*| = √3·|a*|.
    const aStar = (2 * Math.PI) / (4 * Math.sin((120 * Math.PI) / 180));
    expect(q(1, 0)).toBeCloseTo(aStar, 10);
    expect(q(1, -1)).toBeCloseTo(aStar, 10);
    expect(q(1, 1)).toBeCloseTo(Math.sqrt(3) * aStar, 10);
  });

  it("keeps a ring in one radial shell, where orthogonal axes smear it", () => {
    const sharp = ringEnergy(ring, q);
    const smeared = ringEnergy(ring, orthogonal);
    expect(sharp).toBeGreaterThan(2 * smeared);
    const flat = makeSlice(121, 121, () => 1, { half: 3 });
    expect(ringMetrics(ring, flat, q).ring_energy_ratio!).toBeLessThan(0.05);
  });

  it("puts an off-zero cut's |Q| above the plane's distance from the origin", () => {
    const qc = qRadius("hk0", 0.5, meta)!;
    expect(qc(0, 0)).toBeCloseTo((2 * Math.PI) / 6 * 0.5, 10); // c* ⊥ the H–K plane here
  });
});

describe("flatten metrics", () => {
  const pedestal = (x: number, y: number) => 5 + 0.5 * Math.hypot(x, y);
  // Diffuse texture with its 25th percentile near 0 in every shell.
  const diffuse = (x: number, y: number) => Math.sin(3 * x) * Math.cos(2 * y);
  const before = makeSlice(81, 81, (x, y) => pedestal(x, y) + diffuse(x, y));
  const good = makeSlice(81, 81, (x, y) => diffuse(x, y));
  const partial = makeSlice(81, 81, (x, y) => 0.5 * (pedestal(x, y) - 5) + diffuse(x, y));

  it("a flatten that removes the pedestal leaves a flat floor", () => {
    const m = flattenMetrics(before, good);
    expect(m.after_floor_max_sigma!).toBeLessThan(1);
    expect(m.removed_fraction!).toBeGreaterThan(0.9);
    expect(m.floor_before![2]).toBeGreaterThan(m.floor_before![0]); // the pedestal rises with |Q|
  });

  it("a leftover |Q| trend shows up as a high floor", () => {
    const m = flattenMetrics(before, partial);
    expect(m.after_floor_max_sigma!).toBeGreaterThan(3);
    expect(m.floor_after![2]).toBeGreaterThan(m.floor_after![0]);
  });

  it("judges only the shells inside the fit range", () => {
    // A smooth offset in the direct-beam core (r < 6) is outside the 8–40 range.
    const core = makeSlice(81, 81, (x, y) => diffuse(x, y) + (Math.hypot(x, y) < 6 ? 6 : 0));
    expect(flattenMetrics(before, core).after_floor_max_sigma!).toBeGreaterThan(3);
    expect(flattenMetrics(before, core, undefined, [8, 40]).after_floor_max_sigma!).toBeLessThan(1);
    // A misfit inside the range still shows.
    expect(flattenMetrics(before, partial, undefined, [8, 40]).after_floor_max_sigma!).toBeGreaterThan(2);
  });
});
