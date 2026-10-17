// Flatten quality.  The flatten stage subtracts a smooth isotropic pedestal (a
// constant plus, optionally, a magnetic form-factor term, fitted to the low
// floor of each |Q| shell) so the diffuse sits on zero at every |Q|.  We
// compare the per-shell floors (25th percentile) before and after: after a good
// flatten they are near zero and the same at every |Q|.  A floor that still
// rises or falls with |Q| means the pedestal model missed; a floor well below
// zero means it over-subtracted.  Only the shells inside the flatten's own fit
// range are judged (with the true |Q| known): the direct-beam core, punched and
// smoothly filled, and the box corners beyond the coverage say nothing of the fit.
//
// Whether a pedestal is left is judged on the outer half of the shells the
// counts reach (judgedShells, below), not on every shell past the fit range's
// start: docs/pilot-review.md, finding 8.

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
  // Over the outer half of the shells the counts reach (judgedShells): how the
  // floor after the flatten follows |Q|. floor_trend is the floors' rank
  // correlation with |Q| — near ±1 a pedestal the model left (a rising or
  // falling background), near 0 level or only oscillating.
  // floor_span_fraction is the floors' range as a share of the backfilled
  // slice's median level.  A trend near 1 with a span near or above 1 is a
  // leftover background, however small it reads in σ beside strong diffuse
  // structure.  floor_judged_q is the |Q| range of the shells judged.
  floor_trend: number | null;
  floor_span_fraction: number | null;
  floor_judged_q: [number, number] | null;
}

// A shell the counts reach: at least this share of its voxels on the cut is
// measured (qmax_coverage's "fully measured"). The partial shell at a coverage
// edge holds the voxels nearest the edge only.
export const FULL_SHELL = 0.95;

/**
 * The shells a pedestal is judged on (indices into radialFloorShells): those
 * the counts reach (FULL_SHELL), from half the outermost one's |Q| outward, and
 * not inside the fit range's start.
 *
 * Why the outer half. The floors after a flatten that fits a constant follow
 * the crystal's own diffuse level (and any broad low-|Q| hump of the
 * background), which rises to its strongest shells at low |Q| and falls past
 * them: on the dev control a hump at 1.7 Å⁻¹ of 0.9 of the diffuse level, then
 * floors that oscillate about zero out to 9 Å⁻¹. A rank trend over all shells
 * reads that fall as a trend wherever the coverage is short: the dev control
 * restricted to the 0.8–4.4 Å⁻¹ its cut twin measures reads −0.79 on H–K,
 * the same as the cut case itself (−0.77; −0.82 on its worst plane), whose
 * planted truth has no pedestal (span 0.015 of the diffuse level). An
 * inelastic background (b·Q², thermal diffuse and multiphonon, Compton) is
 * largest and rises fastest at high |Q|, where the diffuse's own oscillation
 * is damped: the outer half of the measured range is where a pedestal shows
 * and the crystal's floor does not. On the eight dev cases, judged so, only
 * the planted |Q|² background reads as a pedestal (trend 0.97, span 0.97;
 * with the Q² term on, 0.02 and 0.33), the cut case reads trend 0.93 with a
 * span of 0.49, and the controls stay under 0.62 and 0.65. The validation's
 * scorer judges the pedestal on the outer shells too (3.5 Å⁻¹ out to the
 * coverage, nebula3d.validation.score). Provisional, as the 0.8 limits are.
 */
export function judgedShells(
  shells: { floors: number[]; centres: number[]; counts: number[]; totals: number[] },
  qRange?: [number, number],
): number[] {
  const reached = shells.floors
    .map((_f, i) => i)
    .filter(
      (i) =>
        Number.isFinite(shells.floors[i]) &&
        shells.totals[i] > 0 &&
        shells.counts[i] >= FULL_SHELL * shells.totals[i] &&
        (!qRange || shells.centres[i] >= qRange[0]),
    );
  if (!reached.length) return [];
  const outer = Math.max(...reached.map((i) => shells.centres[i]));
  return reached.filter((i) => shells.centres[i] >= 0.5 * outer);
}

/**
 * Whether the flatten left a pedestal: the floors still follow |Q| (a rank
 * correlation of 0.8 or more in magnitude) over a span of 0.8 or more of the
 * diffuse level. Null when either is not measured. The rule the report and
 * assess_stage judge by (docs/pilot-review.md), and the one a skill can
 * point at when it asks whether to turn the Q² term on.
 */
export const pedestalLeft = (trend: number | null | undefined, span: number | null | undefined): boolean | null =>
  trend == null || span == null ? null : Math.abs(trend) >= 0.8 && span >= 0.8;

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

// Mean of the finite floors in each third of them: the thirds of the shells
// the counts reach, so a volume whose counts end inside the box has them too.
const thirds = (all: number[]): [number, number, number] | null => {
  const floors = all.filter(Number.isFinite);
  const out: number[] = [];
  for (let t = 0; t < 3; t++) {
    const lo = Math.round((t * floors.length) / 3);
    const hi = Math.round(((t + 1) * floors.length) / 3);
    const part = floors.slice(lo, hi);
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
    floor_judged_q: null,
  };
  if (!after) return nulls;
  const afterStats = robustStats(after.data);
  const floorsAfter = floorsIn(after, radius, qRange);
  const sigma = afterStats && afterStats.sigma > 0 ? afterStats.sigma : null;
  const finiteAfter = floorsAfter.filter(Number.isFinite);
  // The outer half of the shells the counts reach (judgedShells).
  const shells = radialFloorShells(after, NBINS, radius);
  const judged = judgedShells(shells, qRange);
  const outward = judged.map((i) => shells.floors[i]);
  const trend = rankTrend(outward);
  const out: FlattenMetrics = {
    ...nulls,
    floor_trend: trend != null ? roundSig(trend) : null,
    floor_judged_q: judged.length
      ? [roundSig(shells.centres[judged[0]]), roundSig(shells.centres[judged[judged.length - 1]])]
      : null,
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
