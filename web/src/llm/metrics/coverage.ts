// Is the ΔPDF's Qmax inside what was measured?  On a reciprocal cut through
// the origin: the share of each |Q| shell that was measured (finite in the raw
// slice), and the |Q| at which a circle leaves the grid.  A Qmax past full
// coverage puts partly unmeasured shells inside the transform's window; past
// the grid, reciprocal space that is not there at all.  Either rings through
// the ΔPDF unless the window is tapered to the coverage.

import { planarRadius, roundSig, type GridSlice, type RadiusFn } from "./sliceStats";

export interface CoverageShell {
  q: number; // shell centre
  measured: number; // finite share of the shell's voxels
}

export interface CoverageMetrics {
  // The largest |Q| whose whole circle stays on this cut's grid.
  box_q: number | null;
  // |Q| below which shells are not yet fully measured (a beam stop), 0 if none.
  low_q_gap: number | null;
  // Past that gap, where shells first fall below 95 % / 50 % measured (box_q if
  // they never do); null if no shell is ever that well measured.
  full_coverage_q: number | null;
  half_coverage_q: number | null;
  shells: CoverageShell[];
}

const FULL = 0.95;
const HALF = 0.5;
export const COVERAGE_SHELLS = 40; // so a coverage edge is known to within box_q / 40

export const coverageMetrics = (raw: GridSlice | null, radius: RadiusFn = planarRadius, nbins = COVERAGE_SHELLS): CoverageMetrics | null => {
  if (!raw) return null;
  const { nx, ny, x_axis, y_axis } = raw.header;
  if (nx < 2 || ny < 2) return null;
  let boxQ = Infinity;
  for (let ix = 0; ix < nx; ix++) {
    boxQ = Math.min(boxQ, radius(x_axis[ix], y_axis[0]), radius(x_axis[ix], y_axis[ny - 1]));
  }
  for (let iy = 0; iy < ny; iy++) {
    boxQ = Math.min(boxQ, radius(x_axis[0], y_axis[iy]), radius(x_axis[nx - 1], y_axis[iy]));
  }
  if (!(boxQ > 0) || !Number.isFinite(boxQ)) return null;

  const width = boxQ / nbins;
  const total = new Uint32Array(nbins);
  const measured = new Uint32Array(nbins);
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const b = Math.floor(radius(x_axis[ix], y_axis[iy]) / width);
      if (b >= nbins) continue;
      total[b] += 1;
      if (Number.isFinite(raw.data[iy * nx + ix])) measured[b] += 1;
    }
  }
  const shells: CoverageShell[] = [];
  const share: (number | null)[] = [];
  for (let b = 0; b < nbins; b++) {
    const f = total[b] >= 3 ? measured[b] / total[b] : null; // the origin's few voxels say little
    share.push(f);
    if (f !== null) shells.push({ q: roundSig((b + 0.5) * width), measured: roundSig(f) });
  }
  // Past the first shell at `level`, the inner edge of the first shell below it.
  // The gap is that first shell's inner edge, unless no shell inside it fell short.
  const reach = (level: number): { gap: number; edge: number } | null => {
    const first = share.findIndex((f) => f !== null && f >= level);
    if (first < 0) return null;
    const short = share.slice(0, first).some((f) => f !== null && f < level);
    const drop = share.findIndex((f, b) => b > first && f !== null && f < level);
    return { gap: short ? first * width : 0, edge: drop < 0 ? boxQ : drop * width };
  };
  const full = reach(FULL);
  const half = reach(HALF);
  return {
    box_q: roundSig(boxQ),
    low_q_gap: full ? roundSig(full.gap) : null,
    full_coverage_q: full ? roundSig(full.edge) : null,
    half_coverage_q: half ? roundSig(half.edge) : null,
    shells,
  };
};
