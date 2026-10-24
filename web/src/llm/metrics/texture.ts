// Does the punch + backfill leave a pattern of its own in reciprocal space?
// Two signs, defined here on one cut through the ring-removed slice (before
// the punch), the punched slice (its holes are NaN) and the backfilled slice:
//
// - Fill bias.  Each filled hole against what the diffuse around it allows.
//   Holes filled systematically brighter (or darker) than that print a lattice
//   of spots (or dimples) onto the diffuse: a texture with the lattice's
//   period, which the ΔPDF turns into features at lattice vectors.
//   backfill.ts sizes the seam |fill − background| voxel by voxel; this asks
//   whether it has a sign.  The diffuse peaks at the nodes (thermal diffuse
//   scattering, short-range order at lattice vectors), so a sound fill sits
//   above its rim's median: on the validation's clean dev control the old
//   comparison with that median flagged all three cuts (88 to 96 % of the
//   holes brighter; docs/pilot-review.md, finding 4).  The reference is now
//   the measured rim's own radial trend continued into the hole: no lower
//   than the diffuse at the hole's edge (a flat continuation), no higher than
//   its rise continued linearly to the hole (a node-peaked one).  A fill in
//   between is what an interpolation of a node-peaked diffuse can give; only
//   the part outside that range is bias.  The linear continuation assumes the
//   diffuse rises about linearly over the few voxels between the rim and the
//   node, as the dev control's rims do; a cusp sharper than that (thermal
//   diffuse ∝ 1/q² right up to the node) can put a sound fill above it.  And a bias counts only when it is
//   also a sizeable share of the local diffuse level (FILL_BIAS_FLOOR): σ
//   shrinks as the counts grow, so a bias in σ alone flags any small one on
//   good statistics.
//   A cut is judged only where its grid leaves the holes room for their rims
//   (roomForRims): the rim's trend is the diffuse falling away from the
//   hole's own node, which holds on its side of the midpoint to the next node
//   only. On a grid too coarse for that the cut says why (not_judged), and
//   gives no verdict.
//   texture_check judges the fill bias in 3-D (plan 4.2): every punch hole of
//   the volume, each with its 3-D rim (nebula3d.analysis.fill_texture, served
//   by GET /api/volumes/{id}/texture and webbridge.volume_texture_json), by
//   this rule taken from the cut's plane to the volume, with the limits below
//   passed on. On a volume one plane thick the two are the same, hole for hole
//   (tests/test_fill_texture.py). A cut sees a hole as the section it cuts out
//   of it: a hole crossed at its edge reads against a rim that lies off its
//   node, where the diffuse is rounded, and a peak off the cut (a satellite) is
//   crossed at its pole or not at all. The volume judges each hole once, from
//   all of its rim. textureMetrics is the rule on a cut, as it was judged
//   before 4.2.
// - Azimuthal texture.  Per |Q| shell, how much the sector means vary around
//   the shell: before the punch over the unpunched voxels only (the diffuse
//   without its peaks), after the backfill over every voxel.  Fills that follow
//   the diffuse leave that variation unchanged (ratio ≈ 1); fills off the
//   diffuse add variation around the shell.  No hole's measure: it is read on
//   cuts (azimuthalTexture), texture_check's per_cut.

import type { TextureLimits } from "../../api/client";
import type { VolumeTexture } from "../../api/types";
import { GRID_TOO_COARSE } from "./coarse";
import { median, planarRadius, roundSig, type GridSlice, type RadiusFn } from "./sliceStats";

export interface TextureMetrics {
  n_holes: number;
  // Why the cut's grid is too coarse to judge its fills (roomForRims): then
  // the fill bias is not measured (null) and systematic_fill_bias is null.
  not_judged?: string;
  // Median over holes of the fill's distance outside the range the rim allows
  // (0 inside it), signed, in the rim's robust σ about its trend.
  median_fill_bias_sigma: number | null;
  // The same in units of the local diffuse level (the rim's median).
  median_fill_bias_level: number | null;
  // Shares of the holes filled above, and below, the range their rim allows.
  above_fraction: number | null;
  below_fraction: number | null;
  // The fills are systematically off their surroundings, in one direction (null: not judged).
  systematic_fill_bias: boolean | null;
  // Median over |Q| shells of the sector means' coefficient of variation.
  azimuthal_variation_before: number | null;
  azimuthal_variation_after: number | null;
  azimuthal_ratio: number | null; // after / before; ≈ 1 adds no texture
}

// The rim: measured voxels 1 to RIM voxels (chessboard) from the hole that the
// fill left as they were.  The backfill also writes a band just outside the
// punch (docs/algorithms/bragg_cleanup.md, "The gap band is filled too"):
// those voxels are fill, not rim.  Four voxels give the trend two rings at least.
export const RIM = 4;
const SECTORS = 24;
const SHELLS = 24;

/**
 * The share of the local diffuse level a systematic fill bias must reach to
 * count. A bias δ in holes covering a share p of reciprocal space adds a
 * lattice-periodic term whose ΔPDF features at lattice vectors scale as δ·p
 * against the diffuse's own modulation: with the punch's ~3 % of the volume
 * (the dev cases) and a modulation of a tenth to a third of the level, a fifth
 * of the level makes a few per cent of the ΔPDF's features, the size of
 * lattice-vector artefacts that had a fill replaced (the q_shell fill's 2.3 %,
 * docs/algorithms/bragg_cleanup.md). On the eight dev cases the default fill
 * reads at most 0.14 of the level outside the range its rim allows (the cut
 * case, five holes a cut); a fill set off by a tenth of the level reads 0.2 on
 * the K–L plane of the control. Provisional, as the 0.5σ and 75 % are.
 */
export const FILL_BIAS_FLOOR = 0.2;

// The rule's other limits, provisional as the floor is: a systematic fill bias
// also needs a median of FILL_BIAS_MIN_SIGMA of the rim's σ or more,
// FILL_BIAS_ONE_WAY of the judged holes or more leaning the median's way, and
// FILL_BIAS_MIN_HOLES holes judged or more.
export const FILL_BIAS_MIN_SIGMA = 0.5;
export const FILL_BIAS_ONE_WAY = 0.75;
export const FILL_BIAS_MIN_HOLES = 5;

/**
 * The rule's limits as texture_check asks the 3-D read to judge by them
 * (fetchVolumeTexture): this module's, whatever the backend's defaults (the
 * same values, nebula3d.analysis.bragg_fill_texture).
 */
export const FILL_BIAS_LIMITS: Required<TextureLimits> = {
  minSigma: FILL_BIAS_MIN_SIGMA,
  oneWay: FILL_BIAS_ONE_WAY,
  minHoles: FILL_BIAS_MIN_HOLES,
  floor: FILL_BIAS_FLOOR,
};

/**
 * The fill bias over every punch hole of the volume, each with its 3-D rim,
 * as texture_check reports it: the 3-D read's summary over the judged holes,
 * and systematic_fill_bias true or false where the rule applies, else null
 * with why (not_judged).
 */
export interface VolumeFillBias {
  n_holes: number;
  n_judged?: number; // the holes whose rims could be judged; not given on a grid too coarse
  // Why the fills are not judged: the grid too coarse for the median hole's
  // rim ("grid too coarse: …", as on a cut), too few holes judged, or none.
  not_judged?: string;
  median_fill_bias_sigma: number | null;
  median_fill_bias_level: number | null;
  above_fraction: number | null;
  below_fraction: number | null;
  // Shares of the judged holes filled above, and below, their range by
  // FILL_BIAS_FLOOR of their level or more.
  above_floor_fraction: number | null;
  below_floor_fraction: number | null;
  systematic_fill_bias: boolean | null;
}

/**
 * The 3-D read as texture_check reports it. On a grid too coarse for the
 * holes' rims no bias is measured (null), as on a cut (roomForRims): the
 * numbers would be read from rims past the midpoint to the next node. With
 * fewer than FILL_BIAS_MIN_HOLES holes judged the numbers stand, and the rule
 * gives no verdict.
 */
export function volumeFillBias(t: VolumeTexture): VolumeFillBias {
  const r = (x: number | null): number | null => (x === null ? null : roundSig(x));
  if (t.not_judged) {
    return {
      n_holes: t.n_holes,
      not_judged: t.not_judged,
      median_fill_bias_sigma: null,
      median_fill_bias_level: null,
      above_fraction: null,
      below_fraction: null,
      above_floor_fraction: null,
      below_floor_fraction: null,
      systematic_fill_bias: null,
    };
  }
  const why = t.judged ? null : t.n_holes ? `too few holes judged: ${t.n_judged} of ${t.n_holes}, under ${t.min_holes}` : "no filled punch hole";
  return {
    n_holes: t.n_holes,
    n_judged: t.n_judged,
    ...(why ? { not_judged: why } : {}),
    median_fill_bias_sigma: r(t.median_fill_bias_sigma),
    median_fill_bias_level: r(t.median_fill_bias_level),
    above_fraction: r(t.above_fraction),
    below_fraction: r(t.below_fraction),
    above_floor_fraction: r(t.above_floor_fraction),
    below_floor_fraction: r(t.below_floor_fraction),
    systematic_fill_bias: t.judged ? t.systematic_fill_bias : null,
  };
}

// Holes: voxels NaN in the punched slice but finite in the backfilled one,
// grouped into 4-connected components.
function findHoles(punched: GridSlice, filled: GridSlice): { holes: number[][]; mask: Uint8Array } {
  const { nx, ny } = punched.header;
  const mask = new Uint8Array(nx * ny);
  for (let i = 0; i < mask.length; i++) {
    if (!Number.isFinite(punched.data[i]) && Number.isFinite(filled.data[i])) mask[i] = 1;
  }
  const seen = new Uint8Array(nx * ny);
  const holes: number[][] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const hole: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      hole.push(i);
      const x = i % nx;
      const y = (i - x) / nx;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue;
        const j = yy * nx + xx;
        if (mask[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    holes.push(hole);
  }
  return { holes, mask };
}

/** How far a hole reaches from its centre, in voxels: chessboard, its bounding box's farthest edge. */
export function holeReach(hole: readonly number[], nx: number): number {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, sx = 0, sy = 0;
  for (const i of hole) {
    const x = i % nx;
    const y = (i - x) / nx;
    [x0, x1, y0, y1] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, y), Math.max(y1, y)];
    sx += x;
    sy += y;
  }
  const [cx, cy] = [sx / hole.length, sy / hole.length];
  return Math.max(x1 - cx, cx - x0, y1 - cy, cy - y0);
}

/**
 * The voxels between neighbouring nodes of a cut's grid: one r.l.u. along its
 * axis with the coarsest step (infinite with no step), to six figures, so the
 * axes' rounding (0.1 r.l.u. a voxel reads 9.999999999999991) moves no limit.
 */
export function nodeSpacing(cut: GridSlice): number {
  const steps = [cut.header.x_axis, cut.header.y_axis]
    .filter((a) => a.length > 1)
    .map((a) => Math.abs(a[1] - a[0]))
    .filter((step) => step > 0);
  return steps.length ? roundSig(1 / Math.max(...steps), 6) : Infinity;
}

/**
 * Whether the cut's grid leaves its holes room for their rims, or why not
 * ("grid too coarse: …"). The rim's trend is the diffuse falling away from
 * the hole's own node, which holds on that node's side of the midpoint to the
 * next node only: past it the diffuse turns toward the next one. A hole that
 * reaches r voxels from its centre (holeReach), its rim RIM more, keeps its
 * rim on its side when the nodes are 2·(r + RIM) voxels apart or more. The
 * nodes are the grid's (nodeSpacing): those of integer h, k and l (a
 * supercell's parent nodes lie further apart, so this errs toward not
 * judging). The rule reads the median hole, so the cut is judged only where
 * the median hole has that room. The backfill's gap band is the rim's first
 * ring or two, inside RIM: it adds nothing to the reach, and the trend keeps
 * two rings or more while the band is two voxels deep or less (holeBias asks
 * for two). nebula3d.analysis.bragg_fill_texture applies the same rule in 3-D.
 */
export function roomForRims(cut: GridSlice, reaches: readonly number[]): string | null {
  if (!reaches.length) return null;
  const spacing = nodeSpacing(cut);
  const need = 2 * (median([...reaches]) + RIM);
  if (!(need > spacing)) return null;
  const reach = roundSig(need / 2 - RIM, 2);
  return (
    `${GRID_TOO_COARSE}: the nodes are ${roundSig(spacing, 3)} voxels apart, under ${roundSig(need, 3)}: ` +
    `a hole reaches ${reach} voxel${reach === 1 ? "" : "s"} and its rim ${RIM} more`
  );
}

// Each hole's signed bias outside the range its rim allows, with the rim's
// robust σ about its trend and its median (the local level), or null when the
// rim is too thin to judge.
function holeBias(
  hole: number[],
  mask: Uint8Array,
  punched: GridSlice,
  filled: GridSlice,
): { bias: number; sigma: number; level: number } | null {
  const { nx, ny } = punched.header;
  let x0 = nx, x1 = -1, y0 = ny, y1 = -1;
  for (const i of hole) {
    const x = i % nx;
    const y = (i - x) / nx;
    [x0, x1, y0, y1] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, y), Math.max(y1, y)];
  }
  const inHole = new Set(hole);
  // The hole's edge is s = 0; a voxel outside sits at its chessboard distance
  // from the hole (s ≥ 1), one inside at 1 − its distance to the outside.
  const outside: number[] = [];
  for (let y = Math.max(0, y0 - 1); y <= Math.min(ny - 1, y1 + 1); y++) {
    for (let x = Math.max(0, x0 - 1); x <= Math.min(nx - 1, x1 + 1); x++) if (!inHole.has(y * nx + x)) outside.push(y * nx + x);
  }
  const cheb = (i: number, j: number) => Math.max(Math.abs((i % nx) - (j % nx)), Math.abs(Math.floor(i / nx) - Math.floor(j / nx)));
  const rimS: number[] = [];
  const rimV: number[] = [];
  for (let y = Math.max(0, y0 - RIM); y <= Math.min(ny - 1, y1 + RIM); y++) {
    for (let x = Math.max(0, x0 - RIM); x <= Math.min(nx - 1, x1 + RIM); x++) {
      const j = y * nx + x;
      const p = punched.data[j];
      // Measured, and left as it was by the fill.
      if (mask[j] || !Number.isFinite(p) || filled.data[j] !== p) continue;
      let d = Infinity;
      for (const i of hole) d = Math.min(d, cheb(i, j));
      if (d >= 1 && d <= RIM) {
        rimS.push(d);
        rimV.push(p);
      }
    }
  }
  if (rimV.length < 8 || new Set(rimS).size < 2) return null;
  // The rim's trend: I = a + b·s by least squares.
  const n = rimS.length;
  const ms = rimS.reduce((t, v) => t + v, 0) / n;
  const mv = rimV.reduce((t, v) => t + v, 0) / n;
  let sxy = 0, sxx = 0;
  for (let k = 0; k < n; k++) [sxy, sxx] = [sxy + (rimS[k] - ms) * (rimV[k] - mv), sxx + (rimS[k] - ms) ** 2];
  const b = sxx > 0 ? sxy / sxx : 0;
  const a = mv - b * ms;
  const level = median(rimV);
  const sigma = 1.4826 * median(rimV.map((v, k) => Math.abs(v - (a + b * rimS[k]))));
  if (!(sigma > 0)) return null;
  let sum = 0;
  let sMean = 0;
  for (const i of hole) {
    sum += filled.data[i];
    let depth = Infinity;
    for (const j of outside) depth = Math.min(depth, cheb(i, j));
    sMean += 1 - depth;
  }
  const fill = sum / hole.length;
  sMean /= hole.length;
  // Flat: the diffuse at the hole's edge, carried in. Node-peaked: the rim's
  // rise continued linearly to the hole's voxels.
  const flat = a + b;
  const peaked = a + b * sMean;
  const [lo, hi] = flat <= peaked ? [flat, peaked] : [peaked, flat];
  const bias = fill > hi ? fill - hi : fill < lo ? fill - lo : 0;
  return { bias, sigma, level };
}

// Median over shells of the coefficient of variation of the sector means,
// counting only the voxels `keep` accepts.
function azimuthalVariation(grid: GridSlice, radius: RadiusFn, keep: (i: number) => boolean): number | null {
  const { nx, ny, x_axis, y_axis } = grid.header;
  let rMax = 0;
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) rMax = Math.max(rMax, radius(x_axis[ix], y_axis[iy]));
  }
  if (!(rMax > 0)) return null;
  const sums = new Float64Array(SHELLS * SECTORS);
  const counts = new Uint32Array(SHELLS * SECTORS);
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const i = iy * nx + ix;
      const v = grid.data[i];
      if (!Number.isFinite(v) || !keep(i)) continue;
      const shell = Math.min(SHELLS - 1, Math.floor((radius(x_axis[ix], y_axis[iy]) / rMax) * SHELLS));
      const angle = Math.atan2(y_axis[iy], x_axis[ix]) + Math.PI;
      const sector = Math.min(SECTORS - 1, Math.floor((angle / (2 * Math.PI)) * SECTORS));
      sums[shell * SECTORS + sector] += v;
      counts[shell * SECTORS + sector] += 1;
    }
  }
  const cvs: number[] = [];
  for (let s = 1; s < SHELLS; s++) {
    const means: number[] = [];
    for (let k = 0; k < SECTORS; k++) {
      const n = counts[s * SECTORS + k];
      if (n >= 4) means.push(sums[s * SECTORS + k] / n);
    }
    if (means.length < SECTORS / 2) continue; // a shell the cut barely covers
    const m = means.reduce((a, b) => a + b, 0) / means.length;
    if (!(Math.abs(m) > 0)) continue;
    const sd = Math.sqrt(means.reduce((a, b) => a + (b - m) ** 2, 0) / means.length);
    cvs.push(sd / Math.abs(m));
  }
  return cvs.length ? median(cvs) : null;
}

export const textureMetrics = (
  before: GridSlice | null,
  punched: GridSlice | null,
  filled: GridSlice | null,
  radius: RadiusFn = planarRadius,
): TextureMetrics | null => {
  if (!punched || !filled || punched.data.length !== filled.data.length) return null;
  const { holes, mask } = findHoles(punched, filled);
  const coarse = roomForRims(punched, holes.map((h) => holeReach(h, punched.header.nx)));
  const judged = coarse ? [] : holes.map((h) => holeBias(h, mask, punched, filled)).filter((b) => b !== null);
  const inSigma = judged.map((h) => h.bias / h.sigma);
  const inLevel = judged.filter((h) => Math.abs(h.level) > 0).map((h) => h.bias / Math.abs(h.level));
  const bias = inSigma.length ? median(inSigma) : null;
  const biasLevel = inLevel.length ? median(inLevel) : null;
  const above = judged.length ? judged.filter((h) => h.bias > 0).length / judged.length : null;
  const below = judged.length ? judged.filter((h) => h.bias < 0).length / judged.length : null;
  const oneWay =
    bias !== null && above !== null && below !== null && (bias > 0 ? above >= FILL_BIAS_ONE_WAY : below >= FILL_BIAS_ONE_WAY);
  return {
    n_holes: holes.length,
    ...(coarse ? { not_judged: coarse } : {}),
    median_fill_bias_sigma: bias === null ? null : roundSig(bias),
    median_fill_bias_level: biasLevel === null ? null : roundSig(biasLevel),
    above_fraction: above === null ? null : roundSig(above),
    below_fraction: below === null ? null : roundSig(below),
    systematic_fill_bias: coarse
      ? null
      : judged.length >= FILL_BIAS_MIN_HOLES &&
        bias !== null &&
        Math.abs(bias) >= FILL_BIAS_MIN_SIGMA &&
        biasLevel !== null &&
        Math.abs(biasLevel) >= FILL_BIAS_FLOOR &&
        oneWay,
    ...azimuthalTexture(before, punched, filled, radius),
  };
};

/** The azimuthal texture on one cut: how much the sector means vary around the |Q| shells before the punch and after the backfill, and the ratio. */
export interface AzimuthalTexture {
  azimuthal_variation_before: number | null;
  azimuthal_variation_after: number | null;
  azimuthal_ratio: number | null; // after / before; ≈ 1 adds no texture
}

/**
 * The azimuthal texture on one cut: per |Q| shell the sector means' spread,
 * before the punch over the voxels the punch left (the diffuse without its
 * peaks) and after the backfill over every voxel, each the median over the
 * shells. Without the punched or backfilled cut, nothing; without the cut
 * before the punch, the variation after alone.
 */
export function azimuthalTexture(
  before: GridSlice | null,
  punched: GridSlice | null,
  filled: GridSlice | null,
  radius: RadiusFn = planarRadius,
): AzimuthalTexture {
  if (!punched || !filled || punched.data.length !== filled.data.length) {
    return { azimuthal_variation_before: null, azimuthal_variation_after: null, azimuthal_ratio: null };
  }
  const varBefore =
    before && before.data.length === punched.data.length
      ? azimuthalVariation(before, radius, (i) => Number.isFinite(punched.data[i]))
      : null;
  const varAfter = azimuthalVariation(filled, radius, () => true);
  return {
    azimuthal_variation_before: varBefore === null ? null : roundSig(varBefore),
    azimuthal_variation_after: varAfter === null ? null : roundSig(varAfter),
    azimuthal_ratio: varBefore && varAfter !== null ? roundSig(varAfter / varBefore) : null,
  };
}
