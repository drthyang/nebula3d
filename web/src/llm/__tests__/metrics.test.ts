import { describe, expect, it } from "vitest";

import { backfillMetrics } from "../metrics/backfill";
import { dpdfMetrics } from "../metrics/dpdf";
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

  it("flags over-subtraction when positive voxels flip negative", () => {
    const after = makeSlice(41, 41, () => -1);
    const m = ringMetrics(flat, after);
    expect(m.over_subtraction_fraction).toBe(1);
  });
});

describe("bragg punch metrics", () => {
  it("detects a bright spike left unpunched", () => {
    const slice = makeSlice(41, 41, (_x, _y, ix, iy) => {
      if (ix === 20 && iy === 20) return 100; // an un-punched peak
      return 1 + 0.01 * ((ix * 7 + iy * 13) % 5); // mild texture
    });
    const scan = scanLeftoverPeaks(slice);
    expect(scan.n_suspicious).toBeGreaterThanOrEqual(1);
    expect(scan.suspicious_peaks[0].sigma).toBeGreaterThan(6);
    expect(scan.suspicious_peaks[0].xy).toEqual([0, 0]);
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
