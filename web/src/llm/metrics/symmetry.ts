// In-plane symmetry of a real-space section through the origin.  The section is
// compared with its image under each operation of the cell's in-plane point
// group: the RMS of the difference over the voxel pairs that are both finite,
// as a share of the section's RMS.  A volume symmetrised over a Laue group and
// processed alike at every equivalent voxel gives a ΔPDF with that symmetry to
// rounding; a share well above that is a stage that broke it (index-space
// neighbourhoods an operation does not map onto themselves), or a symmetry the
// data do not have.  Which operations the sample has is the user's to say: the
// numbers are reported for each.
//
// The section's grid is the FFT's oblique one (x ∥ a, y ∥ b at the cell's
// angle), so an operation is a map of index offsets from the origin voxel:
// on a hexagonal cell the 60° rotation sends u·a + v·b to (u − v)·a + u·b.

import type { GridSlice } from "./sliceStats";
import { roundSig } from "./sliceStats";

export interface SectionSymmetry {
  op: string;
  rms_difference: number; // RMS(v − v∘op) / RMS(v) over the pairs
  pairs: number;
}

type OffsetMap = (dx: number, dy: number) => [number, number];

const HEXAGONAL: Record<string, OffsetMap> = {
  "six-fold (60°)": (dx, dy) => [dx - dy, dx],
  "three-fold (120°)": (dx, dy) => [-dy, dx - dy],
  "two-fold (180°)": (dx, dy) => [-dx, -dy],
  "mirror (a ↔ b)": (dx, dy) => [dy, dx],
};

const orthogonal = (square: boolean): Record<string, OffsetMap> => ({
  "mirror ⊥ a": (dx, dy) => [-dx, dy],
  "mirror ⊥ b": (dx, dy) => [dx, -dy],
  "two-fold (180°)": (dx, dy) => [-dx, -dy],
  ...(square ? { "four-fold (90°)": (dx: number, dy: number): [number, number] => [-dy, dx] } : {}),
});

// The index of the axis value nearest 0, if the axis is symmetric about it.
const originIndex = (axis: number[]): number | null => {
  let c = 0;
  for (let i = 1; i < axis.length; i++) if (Math.abs(axis[i]) < Math.abs(axis[c])) c = i;
  const step = axis.length > 1 ? Math.abs(axis[1] - axis[0]) : 1;
  if (Math.abs(axis[c]) > 0.01 * step) return null;
  return c;
};

/** The section's agreement with its images, or null when its grid is not
 * centred on the origin or its cell has no in-plane symmetry to test. */
export const sectionSymmetry = (
  grid: GridSlice,
  cell: { a: number; b: number },
): { kind: "hexagonal" | "orthogonal"; ops: SectionSymmetry[] } | null => {
  const { nx, ny, x_axis, y_axis } = grid.header;
  const angle = grid.header.axes_angle ?? 90;
  const equal = Math.abs(cell.a / cell.b - 1) < 0.01;
  const kind = Math.abs(angle - 120) < 1 && equal ? "hexagonal" : Math.abs(angle - 90) < 1 ? "orthogonal" : null;
  const cx = originIndex(x_axis);
  const cy = originIndex(y_axis);
  if (!kind || cx == null || cy == null) return null;
  const maps = kind === "hexagonal" ? HEXAGONAL : orthogonal(equal);
  const data = grid.data;
  const ops: SectionSymmetry[] = [];
  for (const [op, map] of Object.entries(maps)) {
    let diff2 = 0;
    let val2 = 0;
    let pairs = 0;
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const v = data[iy * nx + ix];
        if (!Number.isFinite(v)) continue;
        const [dx, dy] = map(ix - cx, iy - cy);
        const jx = cx + dx;
        const jy = cy + dy;
        if (jx < 0 || jx >= nx || jy < 0 || jy >= ny) continue;
        const w = data[jy * nx + jx];
        if (!Number.isFinite(w)) continue;
        diff2 += (v - w) ** 2;
        val2 += v * v;
        pairs += 1;
      }
    }
    if (pairs && val2 > 0) ops.push({ op, rms_difference: roundSig(Math.sqrt(diff2 / val2), 2), pairs });
  }
  return { kind, ops };
};
