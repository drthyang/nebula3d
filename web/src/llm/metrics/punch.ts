// Bragg-punch quality.  Two questions: did any sharp peak escape the punch, and
// what do the punched peaks look like?  The first is answered by scanning the
// punched slice for peaks left in place (punched voxels are NaN holes, so a
// bright finite peak away from a hole is one the punch missed).  Each candidate
// is judged against its own neighbourhood — significant in the local scatter
// and wider than one voxel — so noise spikes at a noisy coverage edge are not
// taken for peaks; spikes where the local scatter is far above the slice's
// typical noise are counted apart.  With the cut known, each peak gets its HKL
// and is classed at a lattice node (a missed Bragg peak) or off-lattice (a
// satellite or a spurious peak, which the search punches unless its H plane is
// protected).  The second summarises the fitted BraggProfile — measured widths,
// how many peaks are resolution-limited, and how anisotropic they are.

import type { BraggProfile } from "../../api/types";
import type { GridSlice } from "./sliceStats";
import { median, pixelCoord, robustStats, roundSig } from "./sliceStats";

export interface SuspiciousPeak {
  xy: [number, number]; // physical (x, y) coordinate in the slice plane (r.l.u.)
  hkl?: [number, number, number]; // with the cut known
  at_node?: boolean; // within NODE_TOL of a lattice node (of the punch supercell)
  on_protected_plane?: boolean; // off-lattice, on an H plane the search leaves alone
  // Full width at half maximum above the local level, in voxels along the
  // slice's x and y; broad when either reaches BROAD_VOXELS.
  fwhm_voxels: [number, number];
  broad: boolean;
  intensity: number;
  local_background: number;
  // intensity / local_background — how far above its surroundings the peak is.
  contrast: number;
  // (intensity − local background) / the local robust σ (1.4826·MAD).
  sigma: number;
}

const robustScatter = (vals: number[], level: number): number => 1.4826 * median(vals.map((v) => Math.abs(v - level)));

// Median and robust scatter (1.4826·MAD) of a square annulus (inner..outer
// Chebyshev radius) of finite voxels around (ix, iy): the background a peak is
// judged against.  `loudest` is the largest scatter of the annulus's four
// sides (left, right, below, above): near the border of a noisy region one
// side is loud though the whole annulus, mostly quiet, is not.  `zeros` is the
// share of exact zeros: sparse counts (most voxels empty, a few single events,
// as at the coverage edge), where the MAD is 0 and any event reads thousands of
// σ.  Null with too few voxels to judge.
const annulusStats = (
  grid: GridSlice,
  ix: number,
  iy: number,
  inner = 3,
  outer = 6,
): { level: number; scatter: number; loudest: number; zeros: number } | null => {
  const { nx, ny } = grid.header;
  const data = grid.data;
  const vals: number[] = [];
  const sides: number[][] = [[], [], [], []];
  for (let dy = -outer; dy <= outer; dy++) {
    const y = iy + dy;
    if (y < 0 || y >= ny) continue;
    for (let dx = -outer; dx <= outer; dx++) {
      const x = ix + dx;
      if (x < 0 || x >= nx) continue;
      const cheb = Math.max(Math.abs(dx), Math.abs(dy));
      if (cheb < inner || cheb > outer) continue;
      const v = data[y * nx + x];
      if (!Number.isFinite(v)) continue;
      vals.push(v);
      if (dx <= -inner) sides[0].push(v);
      if (dx >= inner) sides[1].push(v);
      if (dy <= -inner) sides[2].push(v);
      if (dy >= inner) sides[3].push(v);
    }
  }
  if (vals.length < 20) return null;
  const level = median(vals);
  const loudest = Math.max(...sides.filter((side) => side.length >= 6).map((side) => robustScatter(side, median(side))));
  const zeros = vals.filter((v) => v === 0).length / vals.length;
  return { level, scatter: robustScatter(vals, level), loudest, zeros };
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

// How many of the 8 neighbours stand above `floor`: a resolved peak lifts
// several, a noise spike only itself.
const neighboursAbove = (grid: GridSlice, ix: number, iy: number, floor: number): number => {
  const { nx } = grid.header;
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dy) && grid.data[(iy + dy) * nx + ix + dx] > floor) n += 1;
    }
  }
  return n;
};

// Sparse counts, not a measured level, around a would-be peak: an annulus this
// share exact zeros (a fraction of a percent of a well-measured volume), or one
// whose level is below this share of the slice's median — background-subtracted
// data leave the empty edge near, not at, zero, and a count there reads tens of
// local σ.
const SPARSE_ZEROS = 0.25;
const SPARSE_LEVEL = 0.1;

// A leftover this wide (FWHM in voxels, along either slice axis) is a broad
// diffuse maximum, not a reflection: Bragg and spurious peaks span 1–4 voxels
// FWHM on the measured grids, short-range-order maxima 5–12 along their broad
// axis.
const BROAD_VOXELS = 5;

// Full width at half maximum, in voxels, through (ix, iy) along (dx, dy).
const fwhmVoxels = (grid: GridSlice, ix: number, iy: number, dx: number, dy: number, half: number): number => {
  const { nx, ny } = grid.header;
  const above = (k: number) => {
    const x = ix + k * dx;
    const y = iy + k * dy;
    return x >= 0 && x < nx && y >= 0 && y < ny && grid.data[y * nx + x] > half;
  };
  let lo = 0;
  while (lo < 15 && above(-(lo + 1))) lo++;
  let hi = 0;
  while (hi < 15 && above(hi + 1)) hi++;
  return lo + hi + 1;
};

// A peak this close (r.l.u., per axis) to a lattice node counts as at the node.
export const NODE_TOL = 0.12;

export interface LeftoverScan {
  suspicious_peaks: SuspiciousPeak[];
  n_suspicious: number;
  // With the cut known: missed lattice peaks, and off-lattice ones — of which
  // n_on_protected sit on the H planes the off-lattice search leaves alone.
  n_at_nodes?: number;
  n_off_nodes?: number;
  n_on_protected?: number;
  // Off-lattice leftovers broad enough to be diffuse maxima (short-range order),
  // not sharp reflections.
  n_broad_off_nodes?: number;
  // Spikes in noisy or sparse-count regions (e.g. the coverage edge), not counted as peaks.
  n_skipped_noisy: number;
  scan_sigma_threshold: number;
}

export interface LeftoverScanOptions {
  sigmaThreshold?: number; // local σ a peak must reach
  noisyFactor?: number; // local scatter above this × the slice's: a noisy region
  minNeighbours?: number; // neighbours above 3 local σ: wider than one voxel
  topK?: number;
  toHkl?: (x: number, y: number) => [number, number, number];
  supercell?: [number, number, number]; // the volume's indexing cell, per axis
  // The off-lattice search's protected planes: H fractions and their half width.
  protectedH?: { fractions: number[]; halfWidth: number };
}

// Whether H lies within halfWidth of one of the fractions, modulo 1.
const onProtectedPlane = (h: number, { fractions, halfWidth }: { fractions: number[]; halfWidth: number }): boolean =>
  fractions.some((f) => {
    const d = Math.abs((((h - f) % 1) + 1) % 1);
    return Math.min(d, 1 - d) <= halfWidth;
  });

// Scan the punched slice for peaks the punch missed; returns the strongest
// `topK` with the counts.
export const scanLeftoverPeaks = (
  grid: GridSlice,
  { sigmaThreshold = 8, noisyFactor = 4, minNeighbours = 2, topK = 8, toHkl, supercell = [1, 1, 1], protectedH }: LeftoverScanOptions = {},
): LeftoverScan => {
  const stats = robustStats(grid.data);
  const empty: LeftoverScan = {
    suspicious_peaks: [],
    n_suspicious: 0,
    n_skipped_noisy: 0,
    scan_sigma_threshold: sigmaThreshold,
    ...(toHkl ? { n_at_nodes: 0, n_off_nodes: 0 } : {}),
    ...(toHkl && protectedH ? { n_on_protected: 0 } : {}),
    ...(toHkl ? { n_broad_off_nodes: 0 } : {}),
  };
  if (!stats || stats.sigma <= 0) return empty;
  const { nx, ny } = grid.header;
  const data = grid.data;
  // A cheap pre-cut; the real test is against the local scatter.
  const floor = stats.median + 3 * stats.sigma;
  const found: SuspiciousPeak[] = [];
  let noisy = 0;
  for (let iy = 1; iy < ny - 1; iy++) {
    for (let ix = 1; ix < nx - 1; ix++) {
      const v = data[iy * nx + ix];
      if (!Number.isFinite(v) || v < floor) continue;
      if (!isCleanLocalMax(grid, ix, iy)) continue;
      const bg = annulusStats(grid, ix, iy);
      if (!bg) continue;
      if (bg.zeros >= SPARSE_ZEROS || (stats.median > 0 && bg.level < SPARSE_LEVEL * stats.median)) {
        noisy += 1;
        continue;
      }
      if (!(bg.scatter > 0)) continue;
      const sigma = (v - bg.level) / bg.scatter;
      if (sigma < sigmaThreshold) continue;
      if (neighboursAbove(grid, ix, iy, bg.level + 3 * bg.scatter) < minNeighbours) continue;
      if (bg.loudest > noisyFactor * stats.sigma) {
        noisy += 1;
        continue;
      }
      const [x, y] = pixelCoord(grid, ix, iy);
      const halfMax = bg.level + (v - bg.level) / 2;
      const fwhm: [number, number] = [fwhmVoxels(grid, ix, iy, 1, 0, halfMax), fwhmVoxels(grid, ix, iy, 0, 1, halfMax)];
      const peak: SuspiciousPeak = {
        xy: [roundSig(x, 4), roundSig(y, 4)],
        intensity: roundSig(v),
        local_background: roundSig(bg.level),
        contrast: roundSig(bg.level !== 0 ? v / bg.level : Infinity),
        sigma: roundSig(sigma),
        fwhm_voxels: fwhm,
        broad: Math.max(...fwhm) >= BROAD_VOXELS,
      };
      if (toHkl) {
        const hkl = toHkl(x, y);
        peak.hkl = hkl.map((c) => roundSig(c, 4)) as [number, number, number];
        peak.at_node = hkl.every((c, i) => Math.abs(c - supercell[i] * Math.round(c / supercell[i])) <= NODE_TOL);
        if (protectedH && !peak.at_node) peak.on_protected_plane = onProtectedPlane(hkl[0], protectedH);
      }
      found.push(peak);
    }
  }
  found.sort((a, b) => b.sigma - a.sigma);
  const atNodes = found.filter((p) => p.at_node).length;
  return {
    suspicious_peaks: found.slice(0, topK),
    n_suspicious: found.length,
    ...(toHkl ? { n_at_nodes: atNodes, n_off_nodes: found.length - atNodes } : {}),
    ...(toHkl && protectedH ? { n_on_protected: found.filter((p) => p.on_protected_plane).length } : {}),
    ...(toHkl ? { n_broad_off_nodes: found.filter((p) => !p.at_node && p.broad).length } : {}),
    n_skipped_noisy: noisy,
    scan_sigma_threshold: sigmaThreshold,
  };
};

export interface PeakProfileSummary {
  n_peaks: number;
  // Of those, punched at Bragg nodes, and punched off them by the search (the
  // leftover scan counts only what was missed; grain_check says what these are).
  n_at_lattice_nodes: number;
  n_search_off_lattice: number;
  search_note?: string;
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

  const offLattice = peaks.filter((p) => p.source_node_hkl == null).length;
  return {
    n_peaks: peaks.length,
    n_at_lattice_nodes: peaks.length - offLattice,
    n_search_off_lattice: offLattice,
    ...(offLattice
      ? { search_note: "peaks the search punched off the Bragg nodes; grain_check says whether they are a second grain or displaced Bragg peaks" }
      : {}),
    fit_kinds: fitKinds,
    resolution_limited_fraction: resKnown ? roundSig(resLimited / resKnown) : null,
    median_measured_width_q: axisWidths.map((w) =>
      w.length ? roundSig(median(w), 3) : null,
    ) as [number | null, number | null, number | null],
    median_anisotropy: anisotropies.length ? roundSig(median(anisotropies)) : null,
    width_units: profile.width_units?.q ?? null,
  };
};
