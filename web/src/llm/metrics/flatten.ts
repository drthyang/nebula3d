// Flatten quality.  The flatten stage subtracts a smooth isotropic pedestal (a
// constant plus, optionally, a magnetic form-factor term, fitted to the low
// floor of each |Q| shell) so the diffuse sits on zero at every |Q|.  We
// compare the per-shell floors (the run's floor percentile, the 25th by
// default) before and after: after a good flatten they are near zero and the
// same at every |Q|.  A floor that still rises or falls with |Q| means the
// pedestal model missed; a floor well below zero means it over-subtracted.
// Only the shells inside the flatten's own fit range are judged (with the true
// |Q| known): the direct-beam core, punched and smoothly filled, and the box
// corners beyond the coverage say nothing of the fit.  The range and the
// percentile are the run's, as its output records them (flattenJudging).
//
// Whether a pedestal is left is judged on the outer half of the shells the
// counts reach (judgedShells, below), not on every shell past the fit range's
// start: docs/pilot-review.md, finding 8.

import type { FlattenSettings, ShellFloors } from "../../api/types";
import type { GridSlice, RadiusFn } from "./sliceStats";
import { median, radialFloorShells, robustStats, roundSig } from "./sliceStats";

// The flatten's default fit range in |Q| (Å⁻¹), as nebula3d.pipeline.FlattenParams.fit_q_range.
export const FLATTEN_FIT_Q: [number, number] = [0.8, 10.0];

// The flatten's default floor percentile (0–100), as nebula3d.pipeline.FlattenParams.floor_percentile.
export const FLATTEN_FLOOR_PERCENTILE = 25;

/**
 * What the flatten's floors are judged with: its fit range (Å⁻¹; null when
 * the run fitted every shell with a level) and its floor percentile (0–100).
 */
export interface FlattenJudging {
  fitQ: [number, number] | null;
  percentile: number;
  // Whether they are the run's own: false when its output records no
  // settings, and the flatten's defaults stand in for them.
  recorded: boolean;
}

/** Why a flatten is judged with the defaults: its output records no settings. */
export const FLATTEN_UNRECORDED_NOTE = `the flattened file records no flatten settings (written before the flatten recorded them): judged with the flatten's defaults, ${FLATTEN_FIT_Q[0]}–${FLATTEN_FIT_Q[1]} Å⁻¹ and the ${FLATTEN_FLOOR_PERCENTILE}th percentile`;

/**
 * The fit range and floor percentile a run's flatten is judged with (plan
 * 4.11): the ones it ran with, as its output records them
 * (VolumeMeta.flatten_settings, nebula3d.pipeline.read_flatten_settings),
 * each field it does not record, or records out of range, the flatten's
 * default. The Configure page's settings are another source, and not the
 * right one: they may have changed since the run, and only the file says
 * what made it.
 */
export function flattenJudging(settings: FlattenSettings | null | undefined): FlattenJudging {
  if (!settings || typeof settings !== "object") return { fitQ: FLATTEN_FIT_Q, percentile: FLATTEN_FLOOR_PERCENTILE, recorded: false };
  const r = settings.fit_q_range;
  const range =
    Array.isArray(r) && r.length === 2 && r.every((x) => typeof x === "number" && Number.isFinite(x)) && r[0] < r[1] ? ([r[0], r[1]] as [number, number]) : null;
  const p = settings.floor_percentile;
  return {
    fitQ: r === null ? null : (range ?? FLATTEN_FIT_Q),
    percentile: typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 100 ? p : FLATTEN_FLOOR_PERCENTILE,
    recorded: true,
  };
}

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
 *
 * Over the whole volume's shells (volumePedestal, plan 4.1), on the dev
 * cases at 161³: the planted background trend 0.996, span 1.30 (with the Q²
 * term on, 0.76 and 0.46), the cut case 0.16 and 0.19, the other controls
 * under 0.11 and 0.65. Where the counts fill the box, the volume's outer half
 * runs into its corners (5.6–11.1 Å⁻¹ there, the planes' 4.7–9.0): shells
 * past the nearest face hold only the corners' voxels, and they set the
 * controls' largest spans and most of the planted one's.
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

/** The limit both the floors' trend (in magnitude) and their span reach for a pedestal left (pedestalLeft). */
export const PEDESTAL_LIMIT = 0.8;

/**
 * Whether the flatten left a pedestal: the floors still follow |Q| (a rank
 * correlation of 0.8 or more in magnitude) over a span of 0.8 or more of the
 * diffuse level. Null when either is not measured. The rule the report and
 * assess_stage judge by (docs/pilot-review.md), and the one a skill can
 * point at when it asks whether to turn the Q² term on.
 */
export const pedestalLeft = (trend: number | null | undefined, span: number | null | undefined): boolean | null =>
  trend == null || span == null ? null : Math.abs(trend) >= PEDESTAL_LIMIT && span >= PEDESTAL_LIMIT;

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

/** The pedestal rule's numbers: what pedestalLeft judges, and the |Q| of the first and last shell they were read over. */
export interface Pedestal {
  floor_trend: number | null; // the judged floors' rank correlation with |Q|
  floor_span_fraction: number | null; // their range over the diffuse level
  floor_judged_q: [number, number] | null;
}

/**
 * The pedestal rule's numbers over `shells` (a plane's, radialFloorShells, or
 * the whole volume's, volumePedestal): the floors of the shells judgedShells
 * picks, their rank trend with |Q| (five shells or more), and their span over
 * `level`, the diffuse level (null: not known, no span).
 */
export function pedestalOf(
  shells: { floors: number[]; centres: number[]; counts: number[]; totals: number[] },
  level: number | null,
  qRange?: [number, number],
): Pedestal {
  const judged = judgedShells(shells, qRange);
  const outward = judged.map((i) => shells.floors[i]);
  const trend = rankTrend(outward);
  return {
    floor_trend: trend != null ? roundSig(trend) : null,
    floor_span_fraction: outward.length >= 5 && level != null && level > 0 ? roundSig((Math.max(...outward) - Math.min(...outward)) / level) : null,
    floor_judged_q: judged.length ? [roundSig(shells.centres[judged[0]]), roundSig(shells.centres[judged[judged.length - 1]])] : null,
  };
}

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

// The floors (at the `percentile`, 0–100) of the shells inside `qRange` (all of them without one).
const floorsIn = (grid: GridSlice, radius: RadiusFn | undefined, qRange: [number, number] | undefined, percentile: number): number[] => {
  const { floors, centres } = radialFloorShells(grid, NBINS, radius, percentile / 100);
  return qRange ? floors.filter((_f, i) => centres[i] >= qRange[0] && centres[i] <= qRange[1]) : floors;
};

// `before` = the backfilled slice, `after` = the flattened slice at the same cut;
// `qRange` limits the judged shells when `radius` is the true |Q|, and
// `percentile` (0–100) is each shell's floor: the run's fit range and floor
// percentile (flattenJudging), else the flatten's defaults.
export const flattenMetrics = (
  before: GridSlice | null,
  after: GridSlice | null,
  radius?: RadiusFn,
  qRange?: [number, number],
  percentile: number = FLATTEN_FLOOR_PERCENTILE,
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
  const floorsAfter = floorsIn(after, radius, qRange, percentile);
  const sigma = afterStats && afterStats.sigma > 0 ? afterStats.sigma : null;
  const finiteAfter = floorsAfter.filter(Number.isFinite);
  // The outer half of the shells the counts reach (judgedShells), the span a
  // share of the diffuse level when the flatten's input is at hand.
  const shells = radialFloorShells(after, NBINS, radius, percentile / 100);
  const paired = before !== null && before.data.length === after.data.length;
  let base = 0;
  let removedFraction: number | null = null;
  if (paired) {
    const removed: number[] = [];
    const level: number[] = [];
    for (let i = 0; i < before.data.length; i++) {
      const b = before.data[i];
      const a = after.data[i];
      if (!Number.isFinite(b) || !Number.isFinite(a)) continue;
      removed.push(b - a);
      level.push(b);
    }
    base = level.length ? median(level) : 0;
    if (removed.length && base > 0) removedFraction = roundSig(median(removed) / base);
  }
  const pedestal = pedestalOf(shells, paired ? base : null, qRange);
  return {
    ...nulls,
    removed_fraction: removedFraction,
    floor_before: paired ? thirds(floorsIn(before, radius, qRange, percentile)) : null,
    floor_after: thirds(floorsAfter),
    after_floor_max_sigma:
      sigma && finiteAfter.length ? roundSig(Math.max(...finiteAfter.map(Math.abs)) / sigma) : null,
    after_negative_fraction: afterStats ? roundSig(afterStats.negativeFraction) : null,
    ...pedestal,
  };
};

/**
 * The pedestal over the whole volume (plan 4.1): the same rule over the
 * floors of every voxel of the flatten's own shells (ShellFloors,
 * nebula3d.preprocessing.shell_floors) in place of a plane's 30, the judged
 * shells from the run's fit range (fitQ, flattenJudging), the span a share
 * of the flatten input's level over the voxels measured in both. Measured
 * without the flatten's input (`before_id` null) the level is the volume's
 * own, no diffuse level: the span is not measured then.
 *
 * Why the volume. A plane's floors see the background only along its own
 * directions, and the three principal planes all the sphere only where the
 * background is isotropic: a pedestal off them is missed, and the crystal's
 * own diffuse in them reads as a trend. Every voxel weighs the same in the
 * volume, so each shell's floor is the whole sphere's. Its shells run past
 * the planes', into the box's corners where the counts reach them.
 */
export function volumePedestal(floors: ShellFloors, fitQ: [number, number] | null): Pedestal {
  const shells = { floors: floors.floors.map((f) => (f == null ? NaN : f)), centres: floors.centres, counts: floors.counts, totals: floors.totals };
  return pedestalOf(shells, floors.before_id ? floors.level : null, fitQ ?? undefined);
}
