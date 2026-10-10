// Flatten quality.  The flatten stage subtracts a smooth isotropic pedestal (a
// constant plus, optionally, a magnetic form-factor term, fitted to the low
// floor of each |Q| shell) so the diffuse sits on zero at every |Q|.  We
// compare the per-shell floors (25th percentile) before and after: after a good
// flatten they are near zero and the same at every |Q|.  A floor that still
// rises or falls with |Q| means the pedestal model missed; a floor well below
// zero means it over-subtracted.  Only the shells inside the flatten's own fit
// range are judged (with the true |Q| known): the direct-beam core, punched and
// smoothly filled, and the box corners beyond the coverage say nothing of the fit.

import type { GridSlice, RadiusFn } from "./sliceStats";
import { median, radialFloorShells, robustStats, roundSig } from "./sliceStats";

// The flatten's default fit range in |Q| (Å⁻¹), as nebula3d.pipeline.FlattenParams.fit_q_range.
export const FLATTEN_FIT_Q: [number, number] = [0.8, 10.0];

export interface FlattenMetrics {
  // Median pedestal removed (before − after) as a share of the backfilled
  // slice's median level.
  removed_fraction: number | null;
  // Mean shell floor in the inner / middle / outer third of the |Q| range.
  floor_before: [number, number, number] | null;
  floor_after: [number, number, number] | null;
  // Largest |shell floor| after the flatten, in robust σ of the flattened slice:
  // ≲ 1 is flat, several σ is a leftover trend or an over-subtraction.
  after_floor_max_sigma: number | null;
  after_negative_fraction: number | null;
  // Over every measured shell from the fit range's start out to the coverage
  // (not only the fit range): how the floor after the flatten follows |Q|.
  // floor_trend is the floors' rank correlation with |Q| — near ±1 a pedestal
  // the model left (a rising or falling background), near 0 level or only
  // oscillating.  floor_span_fraction is the floors' range as a share of the
  // backfilled slice's median level.  A trend near 1 with a span near or above
  // 1 is a leftover background, however small it reads in σ beside strong
  // diffuse structure.
  floor_trend: number | null;
  floor_span_fraction: number | null;
}

// Spearman rank correlation of y with its index (the shells' |Q| order).
const rankTrend = (y: number[]): number | null => {
  const n = y.length;
  if (n < 5) return null;
  const order = y.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const rank = new Array<number>(n);
  order.forEach(([, i], r) => (rank[i] = r));
  const m = (n - 1) / 2;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (i - m) * (rank[i] - m);
    sxx += (i - m) ** 2;
  }
  return sxx > 0 ? sxy / sxx : null;
};

const NBINS = 30;

// Mean of the finite floors in each third of the shells.
const thirds = (floors: number[]): [number, number, number] | null => {
  const out: number[] = [];
  for (let t = 0; t < 3; t++) {
    const lo = Math.round((t * floors.length) / 3);
    const hi = Math.round(((t + 1) * floors.length) / 3);
    const part = floors.slice(lo, hi).filter(Number.isFinite);
    if (!part.length) return null;
    out.push(roundSig(part.reduce((s, v) => s + v, 0) / part.length));
  }
  return out as [number, number, number];
};

// The floors of the shells inside `qRange` (all of them without one).
const floorsIn = (grid: GridSlice, radius?: RadiusFn, qRange?: [number, number]): number[] => {
  const { floors, centres } = radialFloorShells(grid, NBINS, radius);
  return qRange ? floors.filter((_f, i) => centres[i] >= qRange[0] && centres[i] <= qRange[1]) : floors;
};

// `before` = the backfilled slice, `after` = the flattened slice at the same cut;
// `qRange` limits the judged shells when `radius` is the true |Q|.
export const flattenMetrics = (
  before: GridSlice | null,
  after: GridSlice | null,
  radius?: RadiusFn,
  qRange?: [number, number],
): FlattenMetrics => {
  const nulls: FlattenMetrics = {
    removed_fraction: null,
    floor_before: null,
    floor_after: null,
    after_floor_max_sigma: null,
    after_negative_fraction: null,
    floor_trend: null,
    floor_span_fraction: null,
  };
  if (!after) return nulls;
  const afterStats = robustStats(after.data);
  const floorsAfter = floorsIn(after, radius, qRange);
  const sigma = afterStats && afterStats.sigma > 0 ? afterStats.sigma : null;
  const finiteAfter = floorsAfter.filter(Number.isFinite);
  // Every well-measured shell past the fit range's start (the direct-beam
  // core): the partial shells at the coverage edge, under a quarter of the
  // typical shell's voxels, would otherwise set the span.
  const shells = radialFloorShells(after, NBINS, radius);
  const filled = shells.counts.filter((c) => c > 0);
  const minCount = filled.length ? 0.25 * median(filled) : 0;
  const outward = shells.floors.filter(
    (f, i) => Number.isFinite(f) && shells.counts[i] >= minCount && (!qRange || shells.centres[i] >= qRange[0]),
  );
  const trend = rankTrend(outward);
  const out: FlattenMetrics = {
    ...nulls,
    floor_trend: trend != null ? roundSig(trend) : null,
    floor_after: thirds(floorsAfter),
    after_floor_max_sigma:
      sigma && finiteAfter.length ? roundSig(Math.max(...finiteAfter.map(Math.abs)) / sigma) : null,
    after_negative_fraction: afterStats ? roundSig(afterStats.negativeFraction) : null,
  };
  if (!before || before.data.length !== after.data.length) return out;

  out.floor_before = thirds(floorsIn(before, radius, qRange));
  const removed: number[] = [];
  const level: number[] = [];
  for (let i = 0; i < before.data.length; i++) {
    const b = before.data[i];
    const a = after.data[i];
    if (!Number.isFinite(b) || !Number.isFinite(a)) continue;
    removed.push(b - a);
    level.push(b);
  }
  const base = level.length ? median(level) : 0;
  if (removed.length && base > 0) out.removed_fraction = roundSig(median(removed) / base);
  if (outward.length >= 5 && base > 0) {
    out.floor_span_fraction = roundSig((Math.max(...outward) - Math.min(...outward)) / base);
  }
  return out;
};
