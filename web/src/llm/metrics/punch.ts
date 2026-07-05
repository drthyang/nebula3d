// Bragg-punch quality.  Two questions: did any sharp peak escape the punch, and
// what do the punched peaks look like?  The first is answered by scanning the
// punched slice for local maxima that tower over their local background yet were
// left in place (punched voxels are NaN holes, so a bright finite spike away
// from a hole is a peak the punch missed).  The second summarises the fitted
// BraggProfile — measured widths, how many peaks are resolution-limited, and how
// anisotropic they are — so the assistant can comment on the peak profile.

import type { BraggProfile } from "../../api/types";
import type { GridSlice } from "./sliceStats";
import { median, pixelCoord, robustStats, roundSig } from "./sliceStats";

export interface SuspiciousPeak {
  xy: [number, number]; // physical (x, y) coordinate in the slice plane (r.l.u.)
  intensity: number;
  local_background: number;
  // intensity / local_background — how far above its surroundings the spike is.
  contrast: number;
  // (intensity − median) / robust σ of the whole slice.
  sigma: number;
}

// Median of a square annulus (inner..outer Chebyshev radius) of finite voxels
// around (ix, iy) — the local background a spike is judged against.
const annulusBackground = (
  grid: GridSlice,
  ix: number,
  iy: number,
  inner = 3,
  outer = 6,
): number => {
  const { nx, ny } = grid.header;
  const data = grid.data;
  const vals: number[] = [];
  for (let dy = -outer; dy <= outer; dy++) {
    const y = iy + dy;
    if (y < 0 || y >= ny) continue;
    for (let dx = -outer; dx <= outer; dx++) {
      const x = ix + dx;
      if (x < 0 || x >= nx) continue;
      const cheb = Math.max(Math.abs(dx), Math.abs(dy));
      if (cheb < inner || cheb > outer) continue;
      const v = data[y * nx + x];
      if (Number.isFinite(v)) vals.push(v);
    }
  }
  return vals.length ? median(vals) : NaN;
};

// Is (ix, iy) a strict local maximum over its 8-neighbourhood, with no NaN
// neighbour (NaN = a punched hole, so we would be sitting on a punch edge)?
const isCleanLocalMax = (grid: GridSlice, ix: number, iy: number): boolean => {
  const { nx, ny } = grid.header;
  const data = grid.data;
  const v = data[iy * nx + ix];
  if (!Number.isFinite(v)) return false;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const y = iy + dy;
      const x = ix + dx;
      if (x < 0 || x >= nx || y < 0 || y >= ny) return false;
      const nv = data[y * nx + x];
      if (!Number.isFinite(nv)) return false; // adjacent to a punched hole
      if (nv > v) return false;
    }
  }
  return true;
};

export interface LeftoverScan {
  suspicious_peaks: SuspiciousPeak[];
  n_suspicious: number;
  scan_sigma_threshold: number;
  scan_contrast_threshold: number;
}

// Scan the punched slice for peaks the punch missed.  A candidate must be a
// clean local maximum, stand `sigmaThreshold` robust σ above the median, and be
// `contrastThreshold`× its local background.  Returns the strongest `topK`.
export const scanLeftoverPeaks = (
  grid: GridSlice,
  {
    sigmaThreshold = 6,
    contrastThreshold = 4,
    topK = 8,
  }: { sigmaThreshold?: number; contrastThreshold?: number; topK?: number } = {},
): LeftoverScan => {
  const stats = robustStats(grid.data);
  const empty: LeftoverScan = {
    suspicious_peaks: [],
    n_suspicious: 0,
    scan_sigma_threshold: sigmaThreshold,
    scan_contrast_threshold: contrastThreshold,
  };
  if (!stats || stats.sigma <= 0) return empty;
  const { nx, ny } = grid.header;
  const data = grid.data;
  const floor = stats.median + sigmaThreshold * stats.sigma;
  const found: SuspiciousPeak[] = [];
  for (let iy = 1; iy < ny - 1; iy++) {
    for (let ix = 1; ix < nx - 1; ix++) {
      const v = data[iy * nx + ix];
      if (!Number.isFinite(v) || v < floor) continue;
      if (!isCleanLocalMax(grid, ix, iy)) continue;
      const bg = annulusBackground(grid, ix, iy);
      if (!Number.isFinite(bg)) continue;
      const contrast = bg !== 0 ? v / bg : Infinity;
      if (contrast < contrastThreshold) continue;
      found.push({
        xy: [roundSig(pixelCoord(grid, ix, iy)[0], 4), roundSig(pixelCoord(grid, ix, iy)[1], 4)],
        intensity: roundSig(v),
        local_background: roundSig(bg),
        contrast: roundSig(contrast),
        sigma: roundSig((v - stats.median) / stats.sigma),
      });
    }
  }
  found.sort((a, b) => b.sigma - a.sigma);
  return {
    suspicious_peaks: found.slice(0, topK),
    n_suspicious: found.length,
    scan_sigma_threshold: sigmaThreshold,
    scan_contrast_threshold: contrastThreshold,
  };
};

export interface PeakProfileSummary {
  n_peaks: number;
  fit_kinds: Record<string, number>;
  // Fraction of peaks flagged resolution-limited on at least one axis (they sag
  // to the half-voxel floor — the punch radius, not the peak, sets their width).
  resolution_limited_fraction: number | null;
  // Median measured peak FWHM per reciprocal axis (Å⁻¹), null where unmeasured.
  median_measured_width_q: [number | null, number | null, number | null];
  // Median principal-axis anisotropy (widest/narrowest measured width) — > ~1.5
  // means the peaks are elongated, hinting at satellites or diffuse rods.
  median_anisotropy: number | null;
  width_units: string | null;
}

// Distil the fitted BraggProfile into a compact peak-shape summary.
export const summarizePeakProfile = (profile: BraggProfile | null | undefined): PeakProfileSummary | null => {
  if (!profile || !profile.peaks?.length) return null;
  const peaks = profile.peaks;
  const fitKinds: Record<string, number> = {};
  let resLimited = 0;
  let resKnown = 0;
  const axisWidths: number[][] = [[], [], []];
  const anisotropies: number[] = [];

  for (const p of peaks) {
    fitKinds[p.fit_kind] = (fitKinds[p.fit_kind] ?? 0) + 1;
    if (p.resolution_limited) {
      resKnown += 1;
      if (p.resolution_limited.some(Boolean)) resLimited += 1;
    }
    const mw = p.measured_width_q;
    if (mw) {
      mw.forEach((w, i) => {
        if (Number.isFinite(w) && w > 0) axisWidths[i].push(w);
      });
      const finite = mw.filter((w) => Number.isFinite(w) && w > 0);
      if (finite.length >= 2) {
        anisotropies.push(Math.max(...finite) / Math.min(...finite));
      }
    }
  }

  return {
    n_peaks: peaks.length,
    fit_kinds: fitKinds,
    resolution_limited_fraction: resKnown ? roundSig(resLimited / resKnown) : null,
    median_measured_width_q: axisWidths.map((w) =>
      w.length ? roundSig(median(w), 3) : null,
    ) as [number | null, number | null, number | null],
    median_anisotropy: anisotropies.length ? roundSig(median(anisotropies)) : null,
    width_units: profile.width_units?.q ?? null,
  };
};
