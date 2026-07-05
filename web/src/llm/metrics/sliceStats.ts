// Shared, pure statistics over a 2D slice (the binary-envelope `Slice`: a
// row-major Float32Array with NaN for masked voxels, plus physical x/y axes).
// These are the primitives every per-stage metric is built from, kept separate
// so they are trivially unit-testable without any of the domain logic.

import type { Slice } from "../../api/types";

// A minimal slice shape so metric code and tests need not build a full Slice.
export interface GridSlice {
  header: {
    nx: number;
    ny: number;
    x_axis: number[];
    y_axis: number[];
    robust_max?: number;
  };
  data: Float32Array | number[];
}

export const asGrid = (slice: Slice): GridSlice => slice;

const finiteOnly = (data: Float32Array | number[]): number[] => {
  const out: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
};

export const roundSig = (value: number, digits = 3): number =>
  Number.isFinite(value) && value !== 0 ? Number(value.toPrecision(digits)) : value;

export const mean = (values: number[]): number =>
  values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;

export const std = (values: number[]): number => {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) * (v - m), 0) / values.length);
};

// Percentile via linear interpolation on the sorted copy (p in [0, 1]).
export const percentile = (values: number[], p: number): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, p * (sorted.length - 1)));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
};

export const median = (values: number[]): number => percentile(values, 0.5);

export interface RobustStats {
  n: number;
  median: number;
  // Robust sigma from the median absolute deviation (×1.4826 → gaussian-σ).
  sigma: number;
  mad: number;
  p01: number;
  p99: number;
  max: number;
  min: number;
  negativeFraction: number;
}

// Robust summary of a slice's finite voxels — the basis for every "how bright is
// a feature versus the background" judgment downstream.
export const robustStats = (data: Float32Array | number[]): RobustStats | null => {
  const values = finiteOnly(data);
  if (!values.length) return null;
  const med = median(values);
  const mad = median(values.map((v) => Math.abs(v - med)));
  let negatives = 0;
  let max = -Infinity;
  let min = Infinity;
  for (const v of values) {
    if (v < 0) negatives += 1;
    if (v > max) max = v;
    if (v < min) min = v;
  }
  return {
    n: values.length,
    median: med,
    sigma: mad * 1.4826,
    mad,
    p01: percentile(values, 0.01),
    p99: percentile(values, 0.99),
    max,
    min,
    negativeFraction: negatives / values.length,
  };
};

// Azimuthally-averaged radial profile I(r) over `nbins` shells, where the radius
// of pixel (ix, iy) is sqrt((x·sx)^2 + (y·sy)^2) about the origin.  Powder rings
// (Al, sample-environment) are azimuthally-uniform bumps in this profile, so its
// shape before vs after ring removal is the direct evidence of how well they
// were subtracted.  `scaleX/scaleY` convert axis units (r.l.u.) toward Å⁻¹ so
// the shells are physically round; they default to 1 (index/rlu space).
export interface RadialProfile {
  r: number[]; // shell-centre radius
  intensity: number[]; // azimuthal mean intensity in the shell (NaN if empty)
  counts: number[];
}

export const radialProfile = (
  grid: GridSlice,
  nbins = 64,
  scaleX = 1,
  scaleY = 1,
): RadialProfile => {
  const { nx, ny, x_axis, y_axis } = grid.header;
  const data = grid.data;
  let rMax = 0;
  for (let iy = 0; iy < ny; iy++) {
    const yr = (y_axis[iy] ?? 0) * scaleY;
    for (let ix = 0; ix < nx; ix++) {
      const xr = (x_axis[ix] ?? 0) * scaleX;
      const r = Math.sqrt(xr * xr + yr * yr);
      if (r > rMax) rMax = r;
    }
  }
  const sums = new Array(nbins).fill(0);
  const counts = new Array(nbins).fill(0);
  const rSums = new Array(nbins).fill(0);
  const binScale = rMax > 0 ? nbins / rMax : 0;
  for (let iy = 0; iy < ny; iy++) {
    const yr = (y_axis[iy] ?? 0) * scaleY;
    const row = iy * nx;
    for (let ix = 0; ix < nx; ix++) {
      const v = data[row + ix];
      if (!Number.isFinite(v)) continue;
      const xr = (x_axis[ix] ?? 0) * scaleX;
      const r = Math.sqrt(xr * xr + yr * yr);
      let b = Math.floor(r * binScale);
      if (b >= nbins) b = nbins - 1;
      sums[b] += v;
      rSums[b] += r;
      counts[b] += 1;
    }
  }
  const intensity = sums.map((s, i) => (counts[i] ? s / counts[i] : NaN));
  const r = rSums.map((s, i) => (counts[i] ? s / counts[i] : ((i + 0.5) * rMax) / nbins));
  return { r, intensity, counts };
};

// A smooth radial baseline: rolling median of the profile over a ±`half`-bin
// window.  Ring peaks ride above this baseline; subtracting it isolates them.
export const rollingBaseline = (values: number[], half = 4): number[] =>
  values.map((_v, i) => {
    const window: number[] = [];
    for (let j = Math.max(0, i - half); j <= Math.min(values.length - 1, i + half); j++) {
      if (Number.isFinite(values[j])) window.push(values[j]);
    }
    return window.length ? median(window) : NaN;
  });

// Map a (col, row) grid index to its physical (x, y) coordinate.
export const pixelCoord = (grid: GridSlice, ix: number, iy: number): [number, number] => [
  grid.header.x_axis[ix] ?? 0,
  grid.header.y_axis[iy] ?? 0,
];
