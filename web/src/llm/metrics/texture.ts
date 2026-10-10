// Does the punch + backfill leave a pattern of its own in reciprocal space?
// Two signs, on one cut through the ring-removed slice (before the punch), the
// punched slice (its holes are NaN) and the backfilled slice:
//
// - Fill bias.  Each filled hole against the unpunched voxels on its rim.  A
//   good fill sits at the level of its surroundings, above it in about half the
//   holes.  Holes filled systematically brighter (or darker) print a lattice of
//   spots (or dimples) onto the diffuse: a texture with the lattice's period,
//   which the ΔPDF turns into features at lattice vectors.  backfill.ts sizes
//   the seam |fill − background| voxel by voxel; this asks whether it has a sign.
// - Azimuthal texture.  Per |Q| shell, how much the sector means vary around
//   the shell: before the punch over the unpunched voxels only (the diffuse
//   without its peaks), after the backfill over every voxel.  Fills that follow
//   the diffuse leave that variation unchanged (ratio ≈ 1); fills off the
//   diffuse add variation around the shell.

import { median, planarRadius, roundSig, type GridSlice, type RadiusFn } from "./sliceStats";

export interface TextureMetrics {
  n_holes: number;
  // Median over holes of (mean fill − rim median) / rim robust σ, signed.
  median_fill_bias_sigma: number | null;
  // Share of holes filled above their rim's median; ≈ 0.5 is unbiased.
  brighter_fraction: number | null;
  // The fills are systematically off their surroundings, in one direction.
  systematic_fill_bias: boolean;
  // Median over |Q| shells of the sector means' coefficient of variation.
  azimuthal_variation_before: number | null;
  azimuthal_variation_after: number | null;
  azimuthal_ratio: number | null; // after / before; ≈ 1 adds no texture
}

const RIM = 2; // rim width around a hole, in voxels
const SECTORS = 24;
const SHELLS = 24;

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

// Each hole's signed bias in rim σ, or null when its rim is too thin to judge.
function holeBias(hole: number[], mask: Uint8Array, punched: GridSlice, filled: GridSlice): number | null {
  const { nx, ny } = punched.header;
  const inRim = new Set<number>();
  for (const i of hole) {
    const x = i % nx;
    const y = (i - x) / nx;
    for (let dy = -RIM; dy <= RIM; dy++) {
      for (let dx = -RIM; dx <= RIM; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue;
        const j = yy * nx + xx;
        if (!mask[j] && Number.isFinite(punched.data[j])) inRim.add(j);
      }
    }
  }
  if (inRim.size < 6) return null;
  const rim = [...inRim].map((j) => filled.data[j]).filter(Number.isFinite);
  const level = median(rim);
  const sigma = 1.4826 * median(rim.map((v) => Math.abs(v - level)));
  if (!(sigma > 0)) return null;
  let sum = 0;
  for (const i of hole) sum += filled.data[i];
  return (sum / hole.length - level) / sigma;
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
  const biases = holes.map((h) => holeBias(h, mask, punched, filled)).filter((b): b is number => b !== null);
  const bias = biases.length ? median(biases) : null;
  const brighter = biases.length ? biases.filter((b) => b > 0).length / biases.length : null;
  const varBefore =
    before && before.data.length === punched.data.length
      ? azimuthalVariation(before, radius, (i) => Number.isFinite(punched.data[i]))
      : null;
  const varAfter = azimuthalVariation(filled, radius, () => true);
  return {
    n_holes: holes.length,
    median_fill_bias_sigma: bias === null ? null : roundSig(bias),
    brighter_fraction: brighter === null ? null : roundSig(brighter),
    systematic_fill_bias:
      biases.length >= 5 && bias !== null && brighter !== null && Math.abs(bias) >= 0.5 && (brighter <= 0.25 || brighter >= 0.75),
    azimuthal_variation_before: varBefore === null ? null : roundSig(varBefore),
    azimuthal_variation_after: varAfter === null ? null : roundSig(varAfter),
    azimuthal_ratio: varBefore && varAfter !== null ? roundSig(varAfter / varBefore) : null,
  };
};
