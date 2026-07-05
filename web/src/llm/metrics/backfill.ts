// Backfill quality.  A good backfill replaces each punched hole with a value
// that blends into the surrounding diffuse — no visible seam, no bright plug
// where the peak used to be, no periodic texture.  We locate the filled voxels
// (NaN in the punched slice, finite in the backfilled slice), measure each
// against its local background, and summarise: the seam magnitude at hole rims,
// how many fills sit implausibly bright, and whether the fill residuals
// alternate in a checkerboard (a classic interpolation artefact → "strange
// pattern").

import type { GridSlice } from "./sliceStats";
import { median, robustStats, roundSig } from "./sliceStats";

const localBackground = (grid: GridSlice, filled: Uint8Array, ix: number, iy: number): number => {
  const { nx, ny } = grid.header;
  const data = grid.data;
  const vals: number[] = [];
  for (let dy = -3; dy <= 3; dy++) {
    const y = iy + dy;
    if (y < 0 || y >= ny) continue;
    for (let dx = -3; dx <= 3; dx++) {
      const x = ix + dx;
      if (x < 0 || x >= nx) continue;
      const idx = y * nx + x;
      if (filled[idx]) continue; // only genuine (non-filled) neighbours
      const v = data[idx];
      if (Number.isFinite(v)) vals.push(v);
    }
  }
  return vals.length ? median(vals) : NaN;
};

export interface BackfillMetrics {
  n_filled: number | null;
  fill_coverage: number | null; // filled / total finite voxels
  // Median |fill − local background| in robust-σ units — the typical seam step.
  // ≲ 1 is a seamless blend; large means the fill sits above/below its rim.
  median_seam_sigma: number | null;
  p95_seam_sigma: number | null;
  // Fraction of fills more than 3σ brighter than their background (residual
  // plugs where a peak was not fully removed → visible bright dots).
  bright_fill_fraction: number | null;
  // Fraction of adjacent filled pairs whose residuals have opposite sign; ≈ 0.5
  // is random, approaching 1 means a checkerboard/grid interpolation artefact.
  checkerboard_fraction: number | null;
}

// `punched` = the Bragg-punched slice (holes are NaN); `filledSlice` = the
// backfilled slice at the same cut.  Both must share the grid shape.
export const backfillMetrics = (
  punched: GridSlice | null,
  filledSlice: GridSlice | null,
): BackfillMetrics => {
  const nulls: BackfillMetrics = {
    n_filled: null,
    fill_coverage: null,
    median_seam_sigma: null,
    p95_seam_sigma: null,
    bright_fill_fraction: null,
    checkerboard_fraction: null,
  };
  if (!punched || !filledSlice) return nulls;
  const { nx, ny } = filledSlice.header;
  if (punched.header.nx !== nx || punched.header.ny !== ny) return nulls;

  const pd = punched.data;
  const fd = filledSlice.data;
  const filled = new Uint8Array(nx * ny);
  let nFilled = 0;
  let nFinite = 0;
  for (let i = 0; i < nx * ny; i++) {
    if (Number.isFinite(fd[i])) nFinite += 1;
    if (!Number.isFinite(pd[i]) && Number.isFinite(fd[i])) {
      filled[i] = 1;
      nFilled += 1;
    }
  }
  if (!nFilled) {
    return { ...nulls, n_filled: 0, fill_coverage: nFinite ? 0 : null };
  }

  const stats = robustStats(fd);
  const sigma = stats && stats.sigma > 0 ? stats.sigma : 1;

  const residual = new Float64Array(nx * ny);
  const hasResidual = new Uint8Array(nx * ny);
  const seams: number[] = [];
  let bright = 0;
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const idx = iy * nx + ix;
      if (!filled[idx]) continue;
      const bg = localBackground(filledSlice, filled, ix, iy);
      if (!Number.isFinite(bg)) continue;
      const res = fd[idx] - bg;
      residual[idx] = res;
      hasResidual[idx] = 1;
      seams.push(Math.abs(res) / sigma);
      if (res > 3 * sigma) bright += 1;
    }
  }

  // Checkerboard: over horizontally-adjacent filled pairs with residuals, the
  // fraction whose residual signs disagree.
  let pairs = 0;
  let opposite = 0;
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx - 1; ix++) {
      const a = iy * nx + ix;
      const b = a + 1;
      if (!hasResidual[a] || !hasResidual[b]) continue;
      pairs += 1;
      if (residual[a] * residual[b] < 0) opposite += 1;
    }
  }

  const sortedSeams = [...seams].sort((x, y) => x - y);
  const p95 = sortedSeams.length
    ? sortedSeams[Math.min(sortedSeams.length - 1, Math.floor(0.95 * (sortedSeams.length - 1)))]
    : null;

  return {
    n_filled: nFilled,
    fill_coverage: nFinite ? roundSig(nFilled / nFinite) : null,
    median_seam_sigma: seams.length ? roundSig(median(seams)) : null,
    p95_seam_sigma: p95 != null ? roundSig(p95) : null,
    bright_fill_fraction: roundSig(bright / nFilled),
    checkerboard_fraction: pairs ? roundSig(opposite / pairs) : null,
  };
};
