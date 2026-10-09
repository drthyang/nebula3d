// Flatten quality.  The flatten stage subtracts a smooth isotropic pedestal (a
// constant plus, optionally, a magnetic form-factor term, fitted to the low
// floor of each |Q| shell) so the diffuse sits on zero at every |Q|.  We
// compare the per-shell floors (25th percentile) before and after: after a good
// flatten they are near zero and the same at every |Q|.  A floor that still
// rises or falls with |Q| means the pedestal model missed; a floor well below
// zero means it over-subtracted.

import type { GridSlice, RadiusFn } from "./sliceStats";
import { median, radialFloors, robustStats, roundSig } from "./sliceStats";

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
}

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

// `before` = the backfilled slice, `after` = the flattened slice at the same cut.
export const flattenMetrics = (
  before: GridSlice | null,
  after: GridSlice | null,
  radius?: RadiusFn,
): FlattenMetrics => {
  const nulls: FlattenMetrics = {
    removed_fraction: null,
    floor_before: null,
    floor_after: null,
    after_floor_max_sigma: null,
    after_negative_fraction: null,
  };
  if (!after) return nulls;
  const afterStats = robustStats(after.data);
  const floorsAfter = radialFloors(after, NBINS, radius);
  const sigma = afterStats && afterStats.sigma > 0 ? afterStats.sigma : null;
  const finiteAfter = floorsAfter.filter(Number.isFinite);
  const out: FlattenMetrics = {
    ...nulls,
    floor_after: thirds(floorsAfter),
    after_floor_max_sigma:
      sigma && finiteAfter.length ? roundSig(Math.max(...finiteAfter.map(Math.abs)) / sigma) : null,
    after_negative_fraction: afterStats ? roundSig(afterStats.negativeFraction) : null,
  };
  if (!before || before.data.length !== after.data.length) return out;

  out.floor_before = thirds(radialFloors(before, NBINS, radius));
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
  return out;
};
