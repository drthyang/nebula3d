// Ring-removal quality.  Powder rings (Al, sample environment) are
// azimuthally-uniform bumps in the radial profile I(|Q|); a clean subtraction
// flattens them without carving the diffuse signal into negative territory.  We
// quantify the residual ring energy before vs after, whether the subtraction
// over-shot into negatives or dented the diffuse at the rings, and recommend a
// robust display ceiling so any leftover ring is actually visible at optimal
// contrast.

import type { GridSlice, RadiusFn } from "./sliceStats";
import { median, percentile, radialProfile, robustStats, rollingBaseline, roundSig } from "./sliceStats";

// The median radial profile with sparse shells left out (under a quarter of the
// typical shell's voxels): the few voxels nearest the origin sit on the incident
// beam, and the partial shells in the box corners are mostly edge.  The median,
// not the mean: ring removal runs before the Bragg punch, and a shell's mean is
// dominated by the few Bragg-peak voxels in it (see radialProfile).
const guardedProfile = (grid: GridSlice, radius: RadiusFn | undefined, nbins: number) => {
  const profile = radialProfile(grid, nbins, radius, "median");
  const filled = profile.counts.filter((c) => c > 0);
  const minCount = filled.length ? 0.25 * median(filled) : 0;
  return { r: profile.r, intensity: profile.intensity.map((v, i) => (profile.counts[i] >= minCount ? v : NaN)) };
};

// Fraction of the azimuthal-median radial intensity that sits in localized
// bumps above the rolling baseline — the "ring energy" of a slice.  Near zero
// means a smooth, ring-free radial profile.
export const ringEnergy = (grid: GridSlice, radius?: RadiusFn): number => {
  const { intensity } = guardedProfile(grid, radius, 64);
  const baseline = rollingBaseline(intensity, 4);
  let excess = 0;
  let total = 0;
  for (let i = 0; i < intensity.length; i++) {
    if (!Number.isFinite(intensity[i]) || !Number.isFinite(baseline[i])) continue;
    excess += Math.max(0, intensity[i] - baseline[i]);
    total += Math.abs(intensity[i]);
  }
  return total > 0 ? excess / total : 0;
};

// Ring residuals: the removal judged at the rings themselves.  The raw slice's
// rings are the bumps of its radial profile above the rolling baseline, by
// RING_SIGMA × the profile's robust scatter about it, spanning the bins above
// EDGE_SIGMA ×.  At each, the ring-removed profile is compared with a line
// through the ring's flanks (FLANK_BINS each side, clear of every ring), as a
// share of that line: > 0 is ring left over, < 0 a dent — the subtraction
// over-shot into the diffuse, though no voxel need go negative.  The flanks'
// own scatter about the line (noise_fraction, the same share) is the yardstick:
// one plane's profile is noisy, and the diffuse beside a ring is not flat, so a
// residual counts (significant) only beyond NOISE_MULTIPLE × that scatter, and
// beyond MIN_RESIDUAL.
// Rolling-baseline dips cannot stand in for this: beside a raw ring the
// baseline is lifted, so the diffuse there reads as a dip that the removal then
// seems to cure.  A ring needs flanks on both sides, so the coverage edge is
// never extrapolated.
const RING_BINS = 128;
const RING_SIGMA = 4;
const EDGE_SIGMA = 2;
const FLANK_BINS = 3;
const NOISE_MULTIPLE = 3;
const MIN_RESIDUAL = 0.005;

export interface RingResidual {
  at: number; // the ring's |Q| (Å⁻¹ with a cell)
  residual_fraction: number; // mean over the ring of (after − flank line) / flank line
  noise_fraction: number; // RMS of the flanks about their line / flank line
  significant: boolean; // |residual_fraction| > NOISE_MULTIPLE × noise_fraction and > MIN_RESIDUAL
}

export const ringResiduals = (before: GridSlice, after: GridSlice, radius?: RadiusFn): RingResidual[] => {
  const raw = guardedProfile(before, radius, RING_BINS);
  const cleaned = guardedProfile(after, radius, RING_BINS).intensity;
  const baseline = rollingBaseline(raw.intensity, 4);
  const bump = raw.intensity.map((v, i) => v - baseline[i]);
  const finite = bump.filter(Number.isFinite);
  if (finite.length < 16) return [];
  const centre = median(finite);
  // Floored at 0.2 % of the profile level, so a noiseless profile still has a scale.
  const level = median(raw.intensity.filter(Number.isFinite).map(Math.abs));
  const scatter = Math.max(1.4826 * median(finite.map((v) => Math.abs(v - centre))), 0.002 * level);
  if (!(scatter > 0)) return [];
  const above = (i: number, k: number) => Number.isFinite(bump[i]) && bump[i] > k * scatter;

  const rings: { peak: number; lo: number; hi: number }[] = [];
  for (let p = 1; p < RING_BINS - 1; p++) {
    if (!above(p, RING_SIGMA) || !(bump[p] >= bump[p - 1]) || !(bump[p] >= bump[p + 1])) continue;
    if (rings.length && p <= rings[rings.length - 1].hi) continue; // the same ring's plateau
    let lo = p;
    while (lo > 0 && above(lo - 1, EDGE_SIGMA)) lo--;
    let hi = p;
    while (hi < RING_BINS - 1 && above(hi + 1, EDGE_SIGMA)) hi++;
    rings.push({ peak: p, lo, hi });
  }
  const inRing = new Array<boolean>(RING_BINS).fill(false);
  for (const { lo, hi } of rings) for (let i = lo; i <= hi; i++) inRing[i] = true;

  const out: RingResidual[] = [];
  for (const { peak, lo, hi } of rings) {
    const flank = (from: number, to: number) => {
      const bins: number[] = [];
      for (let i = from; i <= to; i++) {
        if (i >= 0 && i < RING_BINS && !inRing[i] && Number.isFinite(cleaned[i]) && Number.isFinite(raw.r[i])) bins.push(i);
      }
      return bins;
    };
    const left = flank(lo - 1 - FLANK_BINS, lo - 2);
    const right = flank(hi + 2, hi + 1 + FLANK_BINS);
    if (!left.length || !right.length || left.length + right.length < 3) continue;
    // Least-squares line through the flanks.
    const xs = [...left, ...right].map((i) => raw.r[i]);
    const ys = [...left, ...right].map((i) => cleaned[i]);
    const mx = xs.reduce((s, x) => s + x, 0) / xs.length;
    const my = ys.reduce((s, y) => s + y, 0) / ys.length;
    const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    const slope = sxx > 0 ? xs.reduce((s, x, k) => s + (x - mx) * (ys[k] - my), 0) / sxx : 0;
    let resid = 0;
    let under = 0;
    let n = 0;
    for (let i = lo; i <= hi; i++) {
      if (!Number.isFinite(cleaned[i])) continue;
      const line = my + slope * (raw.r[i] - mx);
      resid += cleaned[i] - line;
      under += line;
      n += 1;
    }
    if (!n || !(under > 0)) continue;
    const scatter2 = xs.reduce((acc, x, k) => acc + (ys[k] - (my + slope * (x - mx))) ** 2, 0) / Math.max(xs.length - 2, 1);
    const fraction = resid / under;
    const noise = Math.sqrt(scatter2) / (under / n);
    out.push({
      at: roundSig(raw.r[peak], 3),
      residual_fraction: roundSig(fraction),
      noise_fraction: roundSig(noise),
      significant: Math.abs(fraction) > Math.max(NOISE_MULTIPLE * noise, MIN_RESIDUAL),
    });
  }
  return out;
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
  // Each raw ring's residual after the removal (see ringResiduals), and the
  // deepest dent (most negative) and largest leftover (most positive) of those
  // beyond the noise.
  ring_residuals: RingResidual[] | null;
  worst_ring_dent: RingResidual | null;
  worst_ring_left: RingResidual | null;
  // Recommended display ceiling (robust 99th pct of the ring-removed slice) so
  // leftover rings/diffuse are visible without the Bragg peaks blowing contrast.
  suggested_display_vmax: number | null;
  n_finite: number | null;
}

// `before` is the raw slice, `after` the ring-removed slice at the same cut.
// Either may be absent (metrics degrade to what is computable).  `radius` is the
// |Q| of an in-plane point, so the radial shells follow the rings for any cell.
export const ringMetrics = (
  before: GridSlice | null,
  after: GridSlice | null,
  radius?: RadiusFn,
): RingMetrics => {
  const beforeEnergy = before ? ringEnergy(before, radius) : null;
  const afterEnergy = after ? ringEnergy(after, radius) : null;
  const afterStats = after ? robustStats(after.data) : null;
  const residuals = before && after ? ringResiduals(before, after, radius) : null;
  const worst = (sign: 1 | -1) =>
    (residuals ?? []).reduce<RingResidual | null>(
      (best, r) =>
        r.significant && sign * r.residual_fraction > 0 && (!best || sign * r.residual_fraction > sign * best.residual_fraction) ? r : best,
      null,
    );

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
    ring_residuals: residuals,
    worst_ring_dent: worst(-1),
    worst_ring_left: worst(1),
    suggested_display_vmax: suggestedVmax != null ? roundSig(suggestedVmax, 4) : null,
    n_finite: afterStats?.n ?? null,
  };
};
