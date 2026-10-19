// Constructed ΔPDFs for the symmetry check's known answers: sums of Gaussian
// peaks over the orbit of each feature under a point group, on fractional
// coordinates, and their sections as the backend cuts them. A point group's
// operations are isometries of its cell, so an orbit sum keeps the group
// exactly (to rounding); a feature added off its orbit breaks what it does
// not keep. Every ΔPDF here is centrosymmetric, as the transform makes a
// measured one. No measured data.

import type { Slice } from "../../api/types";
import { pointGroup, transpose, type Mat3, type Plane } from "../metrics/symmetry";

/** Generators of point groups, on (h, k, l), as a file declares them. */
export const HKL = {
  inversion: [[-1, 0, 0], [0, -1, 0], [0, 0, -1]],
  fourC: [[0, -1, 0], [1, 0, 0], [0, 0, 1]], // (h, k, l) → (−k, h, l)
  threeCubic: [[0, 0, 1], [1, 0, 0], [0, 1, 0]], // (h, k, l) → (l, h, k)
  mirrorC: [[1, 0, 0], [0, 1, 0], [0, 0, -1]],
  mirrorA: [[-1, 0, 0], [0, 1, 0], [0, 0, 1]],
  sixC: [[1, 1, 0], [-1, 0, 0], [0, 0, 1]], // (h, k, l) → (h + k, −h, l)
  mirrorAB: [[0, 1, 0], [1, 0, 0], [0, 0, 1]], // (h, k, l) → (k, h, l)
} satisfies Record<string, Mat3>;

/** The declared groups' generators: m-3m and its 4/mmm, 6/mmm. */
export const DECLARED = {
  "m-3m": [HKL.fourC, HKL.threeCubic, HKL.inversion],
  "4/mmm": [HKL.fourC, HKL.mirrorC, HKL.mirrorA],
  "6/mmm": [HKL.sixC, HKL.mirrorAB, HKL.mirrorC],
} satisfies Record<string, Mat3[]>;

/** A group's operations on the ΔPDF's fractional coordinates (each one's transpose), the identity first. */
export const directGroup = (generators: readonly Mat3[]): Mat3[] => pointGroup(generators)!.map(transpose);

export interface Cell {
  a: number;
  c: number;
  gamma: number; // 90: cubic or tetragonal; 120: hexagonal
}
export const CUBIC: Cell = { a: 4, c: 4, gamma: 90 };
export const HEXAGONAL: Cell = { a: 4, c: 6, gamma: 120 };

/** A feature: a Gaussian of `amp` and width `width` (Å) at the fractional vector `at`. */
export interface Feature {
  at: readonly number[];
  amp: number;
  width: number;
}

const apply = (m: Mat3, v: readonly number[]): number[] => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);

/** The features' images under the operations (with the identity, the features themselves). */
export const orbit = (features: readonly Feature[], ops: readonly Mat3[]): Feature[] => features.flatMap((f) => ops.map((m) => ({ ...f, at: apply(m, f.at) })));

/** The squared length (Å²) of a fractional vector in the cell. */
const length2 = (cell: Cell, d: readonly number[]): number => {
  const cosG = Math.cos((cell.gamma * Math.PI) / 180);
  return cell.a * cell.a * (d[0] * d[0] + d[1] * d[1] + 2 * cosG * d[0] * d[1]) + cell.c * cell.c * d[2] * d[2];
};

/** The ΔPDF of the features at a fractional point: each feature and its inverse (centrosymmetric). */
export function dpdfAt(cell: Cell, features: readonly Feature[], u: readonly number[]): number {
  let v = 0;
  for (const f of features) {
    for (const s of [1, -1]) {
      const d = [u[0] - s * f.at[0], u[1] - s * f.at[1], u[2] - s * f.at[2]];
      v += f.amp * Math.exp(-length2(cell, d) / (2 * f.width * f.width));
    }
  }
  return v;
}

/** The grid: `n` points per axis over ±`half` cells, each axis its own (n odd puts the origin on a voxel). */
export interface Grid {
  n: readonly [number, number, number];
  half: readonly [number, number, number];
}
export const GRID: Grid = { n: [41, 41, 41], half: [1, 1, 1] };

const fractions = (grid: Grid, axis: number): number[] =>
  Array.from({ length: grid.n[axis] }, (_v, i) => -grid.half[axis] + (2 * grid.half[axis] * i) / (grid.n[axis] - 1));

// The axes a plane's slice spans (its x, then its y) and the one it fixes.
const AXES: Record<Plane, readonly [number, number, number]> = { xy: [0, 1, 2], xz: [0, 2, 1], yz: [1, 2, 0] };

/**
 * The section at `value` Å along the plane's fixed axis, as fetchDpdfSlice
 * returns it (the grid's nearest, the first of two as near): axes in Å, the
 * angle between them the cell's, float32 data.
 */
export function cut(cell: Cell, features: readonly Feature[], plane: Plane, value: number, grid: Grid = GRID): Slice {
  const [p, q, k] = AXES[plane];
  const lengths = [cell.a, cell.a, cell.c];
  const along = (axis: number) => fractions(grid, axis);
  const fixed = along(k);
  let i = 0;
  for (let j = 1; j < fixed.length; j++) if (Math.abs(fixed[j] * lengths[k] - value) < Math.abs(fixed[i] * lengths[k] - value)) i = j;
  const [xs, ys] = [along(p), along(q)];
  const data = new Float32Array(xs.length * ys.length);
  const u = [0, 0, 0];
  u[k] = fixed[i];
  for (let iy = 0; iy < ys.length; iy++) {
    for (let ix = 0; ix < xs.length; ix++) {
      u[p] = xs[ix];
      u[q] = ys[iy];
      data[iy * xs.length + ix] = dpdfAt(cell, features, u);
    }
  }
  return {
    header: {
      nx: xs.length,
      ny: ys.length,
      x_axis: xs.map((x) => x * lengths[p]),
      y_axis: ys.map((y) => y * lengths[q]),
      x_label: `${"xyz"[p]} (Å)`,
      y_label: `${"xyz"[q]} (Å)`,
      cut_label: `${"xyz"[k]} = ${fixed[i] * lengths[k]} Å`,
      robust_max: 1,
      axes_angle: plane === "xy" ? cell.gamma : 90,
    },
    data,
  };
}
