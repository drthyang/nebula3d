// Ring-removal quality.  Powder rings (Al, sample environment) are
// azimuthally-uniform bumps in the radial profile I(|Q|); a clean subtraction
// flattens them without carving the diffuse signal into negative territory.  We
// quantify the residual ring energy before vs after, whether the subtraction
// over-shot into negatives, and recommend a robust display ceiling so any
// leftover ring is actually visible at optimal contrast.

import type { GridSlice } from "./sliceStats";
import { percentile, radialProfile, robustStats, rollingBaseline, roundSig } from "./sliceStats";

// Fraction of the azimuthally-averaged radial intensity that sits in localized
// bumps above the rolling baseline — the "ring energy" of a slice.  Near zero
// means a smooth, ring-free radial profile.
export const ringEnergy = (grid: GridSlice, scaleX = 1, scaleY = 1): number => {
  const { intensity, counts } = radialProfile(grid, 64, scaleX, scaleY);
  const baseline = rollingBaseline(intensity, 4);
  let excess = 0;
  let total = 0;
  for (let i = 0; i < intensity.length; i++) {
    if (!counts[i] || !Number.isFinite(intensity[i]) || !Number.isFinite(baseline[i])) continue;
    const above = Math.max(0, intensity[i] - baseline[i]);
    excess += above;
    total += Math.abs(intensity[i]);
  }
  return total > 0 ? excess / total : 0;
};

export interface RingMetrics {
  before_ring_energy: number | null;
  after_ring_energy: number | null;
  // after/before — < 1 means rings were flattened; ≪ 1 is a clean removal.
  ring_energy_ratio: number | null;
  // Fraction of voxels driven below zero by the subtraction; a small number is
  // normal (noise), a large one signals over-subtraction that ate diffuse.
  over_subtraction_fraction: number | null;
  after_negative_fraction: number | null;
  // Recommended display ceiling (robust 99th pct of the ring-removed slice) so
  // leftover rings/diffuse are visible without the Bragg peaks blowing contrast.
  suggested_display_vmax: number | null;
  n_finite: number | null;
}

// `before` is the raw slice, `after` the ring-removed slice at the same cut.
// Either may be absent (metrics degrade to what is computable).  The scale args
// convert axis r.l.u. toward Å⁻¹ so the radial shells are physically round.
export const ringMetrics = (
  before: GridSlice | null,
  after: GridSlice | null,
  scaleX = 1,
  scaleY = 1,
): RingMetrics => {
  const beforeEnergy = before ? ringEnergy(before, scaleX, scaleY) : null;
  const afterEnergy = after ? ringEnergy(after, scaleX, scaleY) : null;
  const afterStats = after ? robustStats(after.data) : null;

  let overSub: number | null = null;
  if (before && after) {
    // Over-subtraction: voxels that were positive before but negative after.
    const b = before.data;
    const a = after.data;
    const n = Math.min(b.length, a.length);
    let flipped = 0;
    let positives = 0;
    for (let i = 0; i < n; i++) {
      if (Number.isFinite(b[i]) && b[i] > 0) {
        positives += 1;
        if (Number.isFinite(a[i]) && a[i] < 0) flipped += 1;
      }
    }
    overSub = positives > 0 ? flipped / positives : null;
  }

  const suggestedVmax = after
    ? percentile(
        Array.from(after.data).filter((v) => Number.isFinite(v) && v > 0),
        0.99,
      )
    : null;

  return {
    before_ring_energy: beforeEnergy != null ? roundSig(beforeEnergy) : null,
    after_ring_energy: afterEnergy != null ? roundSig(afterEnergy) : null,
    ring_energy_ratio:
      beforeEnergy && afterEnergy != null && beforeEnergy > 0
        ? roundSig(afterEnergy / beforeEnergy)
        : null,
    over_subtraction_fraction: overSub != null ? roundSig(overSub) : null,
    after_negative_fraction: afterStats ? roundSig(afterStats.negativeFraction) : null,
    suggested_display_vmax: suggestedVmax != null ? roundSig(suggestedVmax, 4) : null,
    n_finite: afterStats?.n ?? null,
  };
};
