// Bragg-punch quality.  Two questions: did any sharp peak escape the punch, and
// what do the punched peaks look like?  The first is answered by scanning the
// punched slice for peaks left in place (punched voxels are NaN holes).  Each
// candidate is judged against its own neighbourhood — significant in the local
// scatter and wider than one voxel — so noise spikes at a noisy coverage edge
// are not taken for peaks; spikes where the local scatter is far above the
// slice's typical noise are counted apart.  With the cut known, each peak gets
// its HKL and is classed at a lattice node (a missed Bragg peak) or off-lattice
// (a satellite or a spurious peak, which the search punches unless the run left
// its position alone: the sample's declared modulation, read from the run's
// punch record as labels on the cut, never from the form).
//
// With the cut before the punch as well (THY-43), the maxima beside a punch
// hole are judged too, not skipped: a Bragg peak whose shape the footprint
// does not follow (a doublet, a streak, a width that grows with |Q|) leaves its
// excess at the hole's rim, and a scan of clean maxima alone never sees it.
// Each hole is the punch's cut through one peak: it is a Bragg node's when it
// reaches within NODE_TOL_VOXELS of a node, and its peak is the cut's maximum
// inside it before the punch. A maximum beside such a hole (or within
// BRAGG_REACH_Q of its peak, a lobe the hole missed) holding TAIL_SHARE or more
// of that peak is a Bragg tail; under it, a faint rim (the far wing of a strong
// peak), counted but not judged. The direct beam's neighbourhood is no Bragg
// node and is left out. The second question summarises the fitted
// BraggProfile — measured widths, how many peaks are resolution-limited, and
// how anisotropic they are.

import type { BraggProfile } from "../../api/types";
import { reading, written } from "../inference";
import type { GridSlice } from "./sliceStats";
import { median, pixelCoord, robustStats, roundSig } from "./sliceStats";

// What the search's count is (a definition), and which check says what they are
// (inference: inference.ts; with the skills off the context carries the first only).
const SEARCH_NOTE = written("metrics/punch.ts: the context's peak_profile.search_note")`peaks the search punched off the Bragg nodes${reading(
  "; grain_check says whether they are a second grain or displaced Bragg peaks",
)}`;

export interface SuspiciousPeak {
  xy: [number, number]; // physical (x, y) coordinate in the slice plane (r.l.u.)
  hkl?: [number, number, number]; // with the cut known
  at_node?: boolean; // within NODE_TOL_VOXELS of a lattice node (of the punch supercell), beside no punch hole
  // Beside a punch hole (with the cut before the punch): at the rim of a punched peak.
  beside_hole?: true;
  // A Bragg tail: beside a Bragg node's hole, or within BRAGG_REACH_Q of its
  // peak, and holding TAIL_SHARE or more of that peak's height above the level.
  bragg_tail?: true;
  // Under TAIL_SHARE of its punched peak: a faint rim, counted, not judged.
  faint?: true;
  // Its height above the local level over that of the punched peak it is
  // beside (or within reach of), before the punch.
  share?: number;
  // Off-lattice, in a position the run's search left alone (a plane or a
  // satellite of the declared modulation, by the run's punch record).
  on_protected_plane?: boolean;
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
// diffuse maximum, not a reflection: on measured grids Bragg and spurious
// peaks stay narrower, while broad maxima (short-range order, for one) reach
// it along their broad axis.
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

// A peak this close to a lattice node, in voxels along each axis of the slice,
// counts as at the node. A maximum on the grid is placed to half a voxel, and a
// node's peak sits off it by the UB's error and its own centre (which the punch
// fits): a voxel or so. It was 0.12 r.l.u. until THY-43, which along a long
// cell axis can be under one voxel, so a peak one voxel off its node read as
// off the lattice; in voxels it is the same on every axis of any cell, and
// still under half the spacing of the nodes along any axis with five voxels or
// more per r.l.u.
export const NODE_TOL_VOXELS = 2;
// Along the cut's own axis (no measured position: the cut is where it was
// asked), the old tolerance in r.l.u.
export const NODE_TOL_CUT = 0.12;
// How far (|Q|, Å⁻¹) a Bragg peak's tail reaches from the peak a punch hole cut:
// the default integer footprint's largest radius (the resolution ellipsoid's
// 0.115 Å⁻¹ at its 2× cap, with the 0.02 margin). A lobe this close to a
// punched peak and not touching its hole is that peak's; the satellites of a
// declared modulation are classed first, whatever their distance.
export const BRAGG_REACH_Q = 0.25;
// A maximum beside a Bragg hole is a tail when it holds this share or more of
// the punched peak's height (above its local level). On the synthetic dev
// cases the rims reach 1.3 % (strong peaks' far wings, which every footprint
// leaves): set conservatively above them, at 2.3× (see THY-43).
export const TAIL_SHARE = 0.03;
// The direct beam: no Bragg node, and its own punch (the incident-beam
// footprint, which reaches 0.30 Å⁻¹ by default). A maximum this close to the
// origin, or beside the hole at the origin, is left out.
export const BEAM_Q = 0.35;

export interface LeftoverScan {
  suspicious_peaks: SuspiciousPeak[];
  n_suspicious: number;
  // With the cut known: missed lattice peaks, and off-lattice ones — of which
  // n_on_protected sit in the positions the run's search left alone.
  n_at_nodes?: number;
  n_off_nodes?: number;
  n_on_protected?: number;
  // Off-lattice leftovers broad enough to be diffuse maxima (short-range order),
  // not sharp reflections.
  n_broad_off_nodes?: number;
  // With the cut before the punch: the Bragg tails, the maxima beside a punch
  // hole (of any class), and the faint rims among them (under TAIL_SHARE of
  // their peak), which no other count holds.
  n_bragg_tails?: number;
  n_beside_holes?: number;
  n_faint?: number;
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
  // What the run's search left alone, on this cut's grid: which protected
  // position each voxel lies in, 0 for none (GET /api/modulation/{id}/labels,
  // from the run's punch record). Without it no peak is marked; a grid that is
  // not the cut's marks none either.
  protectedLabels?: GridSlice | null;
  // The cut before the punch (the ring-removed stage's), on the same grid:
  // with toHkl, the maxima beside a punch hole are judged (Bragg tails), and
  // a maximum beside unmeasured space is skipped, as the coverage edge. Without
  // it, or on another grid, a maximum beside a hole is skipped, as before.
  before?: GridSlice | null;
  // The punched cut whose holes these are, when the grid scanned is another
  // stage's (the backfilled cut, its holes filled); the grid itself by default.
  punched?: GridSlice | null;
  // |Q| (Å⁻¹) of a reciprocal vector (H K L): for the Bragg reach and the beam.
  // Without it, neither is measured in Å⁻¹ (no lobe off a hole is a tail; the
  // beam is the hole at the origin alone).
  qOf?: (hkl: [number, number, number]) => number;
}

const sameGrid = (a: GridSlice | null | undefined, b: GridSlice): a is GridSlice => !!a && a.header.nx === b.header.nx && a.header.ny === b.header.ny;

/** The punch's holes on a cut: finite before, NaN after, 8-connected, each with its peak before the punch. */
interface Holes {
  label: Int32Array; // 0: no hole; else the hole's number
  peak: number[]; // by number: the cut's maximum inside it before the punch
  at: [number, number][]; // its (ix, iy)
  bragg: boolean[]; // reaches within NODE_TOL_VOXELS of a node
  beam: boolean[]; // reaches within NODE_TOL_VOXELS of the origin
}

function punchHoles(punched: GridSlice, before: GridSlice, nearNode: (ix: number, iy: number) => "origin" | "node" | null): Holes {
  const { nx, ny } = punched.header;
  const n = nx * ny;
  const isHole = (i: number) => Number.isFinite(before.data[i]) && !Number.isFinite(punched.data[i]);
  const label = new Int32Array(n);
  const holes: Holes = { label, peak: [NaN], at: [[0, 0]], bragg: [false], beam: [false] };
  const stack: number[] = [];
  for (let start = 0; start < n; start++) {
    if (label[start] || !isHole(start)) continue;
    const id = holes.peak.length;
    holes.peak.push(-Infinity);
    holes.at.push([0, 0]);
    holes.bragg.push(false);
    holes.beam.push(false);
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const ix = i % nx;
      const iy = (i - ix) / nx;
      const v = before.data[i];
      if (v > holes.peak[id]) {
        holes.peak[id] = v;
        holes.at[id] = [ix, iy];
      }
      const near = nearNode(ix, iy);
      if (near === "origin") holes.beam[id] = true;
      else if (near === "node") holes.bragg[id] = true;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = ix + dx;
          const y = iy + dy;
          if (x < 0 || x >= nx || y < 0 || y >= ny) continue;
          const j = y * nx + x;
          if (!label[j] && isHole(j)) {
            label[j] = id;
            stack.push(j);
          }
        }
      }
    }
  }
  // The beam's hole is no Bragg node's.
  for (let id = 1; id < holes.peak.length; id++) if (holes.beam[id]) holes.bragg[id] = false;
  return holes;
}

// Scan the punched slice for peaks the punch missed; returns the strongest
// `topK` with the counts.
export const scanLeftoverPeaks = (
  grid: GridSlice,
  { sigmaThreshold = 8, noisyFactor = 4, minNeighbours = 2, topK = 8, toHkl, supercell = [1, 1, 1], protectedLabels, before, punched, qOf }: LeftoverScanOptions = {},
): LeftoverScan => {
  const stats = robustStats(grid.data);
  // A voxel the run left alone: its label, on the cut's own grid.
  const labels = protectedLabels && protectedLabels.header.nx === grid.header.nx && protectedLabels.header.ny === grid.header.ny ? protectedLabels.data : null;
  // The rims are judged with the cut before the punch, on this grid, and the cut known.
  const pre = toHkl && sameGrid(before, grid) ? before : null;
  const holed = pre ? (sameGrid(punched, grid) ? punched : grid) : null;
  const empty: LeftoverScan = {
    suspicious_peaks: [],
    n_suspicious: 0,
    n_skipped_noisy: 0,
    scan_sigma_threshold: sigmaThreshold,
    ...(toHkl ? { n_at_nodes: 0, n_off_nodes: 0 } : {}),
    ...(toHkl && labels ? { n_on_protected: 0 } : {}),
    ...(toHkl ? { n_broad_off_nodes: 0 } : {}),
    ...(pre ? { n_bragg_tails: 0, n_beside_holes: 0, n_faint: 0 } : {}),
  };
  if (!stats || stats.sigma <= 0) return empty;
  const { nx, ny } = grid.header;
  const data = grid.data;
  const { x_axis, y_axis } = grid.header;
  // Each H K L axis's tolerance: NODE_TOL_VOXELS of the slice's voxels along
  // it (the r.l.u. one voxel step moves it), NODE_TOL_CUT along the cut's own.
  const tol: [number, number, number] = [NODE_TOL_CUT, NODE_TOL_CUT, NODE_TOL_CUT];
  if (toHkl && nx > 1 && ny > 1) {
    const o = toHkl(x_axis[0], y_axis[0]);
    const ex = toHkl(x_axis[1], y_axis[0]);
    const ey = toHkl(x_axis[0], y_axis[1]);
    for (let i = 0; i < 3; i++) {
      const moved = Math.abs(ex[i] - o[i]) + Math.abs(ey[i] - o[i]);
      if (moved > 0) tol[i] = NODE_TOL_VOXELS * moved + 1e-9;
    }
  }
  const nodeOf = (hkl: [number, number, number]): [number, number, number] =>
    hkl.map((c, i) => supercell[i] * Math.round(c / supercell[i])) as [number, number, number];
  const near = (hkl: [number, number, number]) => hkl.every((c, i) => Math.abs(c - supercell[i] * Math.round(c / supercell[i])) <= tol[i]);
  const holes = pre && holed && toHkl
    ? punchHoles(holed, pre, (ix, iy) => {
        const hkl = toHkl(x_axis[ix], y_axis[iy]);
        if (!near(hkl)) return null;
        return nodeOf(hkl).every((c) => c === 0) ? "origin" : "node";
      })
    : null;
  // Each Bragg hole's peak, in H K L, for the reach of its tail.
  const holePeakHkl = holes && toHkl ? holes.at.map(([hx, hy], h) => (holes.bragg[h] ? toHkl(x_axis[hx], y_axis[hy]) : null)) : [];
  // A cheap pre-cut; the real test is against the local scatter.
  const floor = stats.median + 3 * stats.sigma;
  const found: SuspiciousPeak[] = [];
  let noisy = 0;
  for (let iy = 1; iy < ny - 1; iy++) {
    for (let ix = 1; ix < nx - 1; ix++) {
      const v = data[iy * nx + ix];
      if (!Number.isFinite(v) || v < floor) continue;
      // The punch holes beside it (with the cut before the punch); else a clean maximum.
      const adjacent: number[] = [];
      if (holes && pre) {
        let ok = true;
        for (let dy = -1; dy <= 1 && ok; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const j = (iy + dy) * nx + ix + dx;
            // Beside unmeasured space: the coverage edge, skipped as before.
            if (!Number.isFinite(pre.data[j])) {
              ok = false;
              break;
            }
            const h = holes.label[j];
            if (h && !adjacent.includes(h)) adjacent.push(h);
            if (!dx && !dy) continue;
            // A maximum over its measured neighbours (a hole's are NaN on the
            // punched cut, its fill on the backfilled one).
            if (Number.isFinite(data[j]) ? data[j] > v : !h) {
              ok = false;
              break;
            }
          }
        }
        if (!ok) continue;
      } else if (!isCleanLocalMax(grid, ix, iy)) continue;
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
      const hkl = toHkl ? toHkl(x, y) : null;
      // The direct beam's neighbourhood: no Bragg node.
      if (holes && hkl && (adjacent.some((h) => holes.beam[h]) || (qOf && qOf(hkl) <= BEAM_Q))) continue;
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
      if (hkl) {
        peak.hkl = hkl.map((c) => roundSig(c, 4)) as [number, number, number];
        const beside = adjacent.length > 0;
        peak.at_node = !beside && near(hkl);
        if (beside) peak.beside_hole = true;
        if (holes && !peak.at_node) {
          // The Bragg node's hole it is beside (the brightest), else, not
          // beside any, the one whose peak is within BRAGG_REACH_Q of it.
          let parent: number | null = null;
          for (const h of adjacent) if (holes.bragg[h] && (parent === null || holes.peak[h] > holes.peak[parent])) parent = h;
          if (parent === null && !beside && qOf) {
            let best = Infinity;
            for (let h = 1; h < holePeakHkl.length; h++) {
              const p = holePeakHkl[h];
              if (!p) continue;
              const d = qOf([hkl[0] - p[0], hkl[1] - p[1], hkl[2] - p[2]]);
              if (d <= BRAGG_REACH_Q && d < best) [best, parent] = [d, h];
            }
          }
          // Its share of the peak punched beside it: its own hole's, else the brightest it touches.
          let ref = parent;
          if (ref === null) for (const h of adjacent) if (ref === null || holes.peak[h] > holes.peak[ref]) ref = h;
          if (ref !== null && holes.peak[ref] > bg.level) peak.share = roundSig((v - bg.level) / (holes.peak[ref] - bg.level), 2);
          const onProtected = labels ? labels[iy * nx + ix] > 0 : false;
          if (!onProtected && peak.share !== undefined && peak.share < TAIL_SHARE) peak.faint = true;
          else if (!onProtected && parent !== null) peak.bragg_tail = true;
        }
        if (labels && !peak.at_node) peak.on_protected_plane = labels[iy * nx + ix] > 0;
      }
      found.push(peak);
    }
  }
  found.sort((a, b) => b.sigma - a.sigma);
  const atNodes = found.filter((p) => p.at_node).length;
  // Off the lattice: neither at a node, nor a Bragg tail, nor a faint rim.
  const off = found.filter((p) => !p.at_node && !p.bragg_tail && !p.faint);
  return {
    suspicious_peaks: found.slice(0, topK),
    n_suspicious: found.length,
    ...(toHkl ? { n_at_nodes: atNodes, n_off_nodes: off.length } : {}),
    ...(toHkl && labels ? { n_on_protected: off.filter((p) => p.on_protected_plane).length } : {}),
    ...(toHkl ? { n_broad_off_nodes: off.filter((p) => p.broad).length } : {}),
    ...(holes
      ? {
          n_bragg_tails: found.filter((p) => p.bragg_tail).length,
          n_beside_holes: found.filter((p) => p.beside_hole).length,
          n_faint: found.filter((p) => p.faint).length,
        }
      : {}),
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
    ...(offLattice ? { search_note: SEARCH_NOTE.whole } : {}),
    fit_kinds: fitKinds,
    resolution_limited_fraction: resKnown ? roundSig(resLimited / resKnown) : null,
    median_measured_width_q: axisWidths.map((w) =>
      w.length ? roundSig(median(w), 3) : null,
    ) as [number | null, number | null, number | null],
    median_anisotropy: anisotropies.length ? roundSig(median(anisotropies)) : null,
    width_units: profile.width_units?.q ?? null,
  };
};
