// Does the punch + backfill leave a pattern of its own in reciprocal space?
// Two signs, on one cut through the ring-removed slice (before the punch), the
// punched slice (its holes are NaN) and the backfilled slice:
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
// - Azimuthal texture.  Per |Q| shell, how much the sector means vary around
//   the shell: before the punch over the unpunched voxels only (the diffuse
//   without its peaks), after the backfill over every voxel.  Fills that follow
//   the diffuse leave that variation unchanged (ratio ≈ 1); fills off the
//   diffuse add variation around the shell.

import { median, planarRadius, roundSig, type GridSlice, type RadiusFn } from "./sliceStats";

export interface TextureMetrics {
  n_holes: number;
  // Median over holes of the fill's distance outside the range the rim allows
  // (0 inside it), signed, in the rim's robust σ about its trend.
  median_fill_bias_sigma: number | null;
  // The same in units of the local diffuse level (the rim's median).
  median_fill_bias_level: number | null;
  // Shares of the holes filled above, and below, the range their rim allows.
  above_fraction: number | null;
  below_fraction: number | null;
  // The fills are systematically off their surroundings, in one direction.
  systematic_fill_bias: boolean;
  // Median over |Q| shells of the sector means' coefficient of variation.
  azimuthal_variation_before: number | null;
  azimuthal_variation_after: number | null;
  azimuthal_ratio: number | null; // after / before; ≈ 1 adds no texture
}

// The rim: measured voxels 1 to RIM voxels (chessboard) from the hole that the
// fill left as they were.  The backfill also writes a band just outside the
// punch (docs/algorithms/bragg_cleanup.md, "The gap band is filled too"):
// those voxels are fill, not rim.  Four voxels give the trend two rings at least.
const RIM = 4;
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
  const judged = holes.map((h) => holeBias(h, mask, punched, filled)).filter((b) => b !== null);
  const inSigma = judged.map((h) => h.bias / h.sigma);
  const inLevel = judged.filter((h) => Math.abs(h.level) > 0).map((h) => h.bias / Math.abs(h.level));
  const bias = inSigma.length ? median(inSigma) : null;
  const biasLevel = inLevel.length ? median(inLevel) : null;
  const above = judged.length ? judged.filter((h) => h.bias > 0).length / judged.length : null;
  const below = judged.length ? judged.filter((h) => h.bias < 0).length / judged.length : null;
  const oneWay = bias !== null && above !== null && below !== null && (bias > 0 ? above >= 0.75 : below >= 0.75);
  const varBefore =
    before && before.data.length === punched.data.length
      ? azimuthalVariation(before, radius, (i) => Number.isFinite(punched.data[i]))
      : null;
  const varAfter = azimuthalVariation(filled, radius, () => true);
  return {
    n_holes: holes.length,
    median_fill_bias_sigma: bias === null ? null : roundSig(bias),
    median_fill_bias_level: biasLevel === null ? null : roundSig(biasLevel),
    above_fraction: above === null ? null : roundSig(above),
    below_fraction: below === null ? null : roundSig(below),
    systematic_fill_bias:
      judged.length >= 5 &&
      bias !== null &&
      Math.abs(bias) >= 0.5 &&
      biasLevel !== null &&
      Math.abs(biasLevel) >= FILL_BIAS_FLOOR &&
      oneWay,
    azimuthal_variation_before: varBefore === null ? null : roundSig(varBefore),
    azimuthal_variation_after: varAfter === null ? null : roundSig(varAfter),
    azimuthal_ratio: varBefore && varAfter !== null ? roundSig(varAfter / varBefore) : null,
  };
};
