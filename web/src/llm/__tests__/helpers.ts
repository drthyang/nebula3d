import type { Bunching, ModulationDeclaration, ModulationRecord, ProtectedLabels, Slice } from "../../api/types";

// Build a synthetic Slice from a value function f(x, y).  Axes are centred on 0
// with unit spacing unless a range is given; NaN return marks a masked voxel.
export function makeSlice(
  nx: number,
  ny: number,
  f: (x: number, y: number, ix: number, iy: number) => number,
  { half = null as number | null }: { half?: number | null } = {},
): Slice {
  const hx = half ?? (nx - 1) / 2;
  const hy = half ?? (ny - 1) / 2;
  const x_axis = Array.from({ length: nx }, (_v, i) => -hx + (2 * hx * i) / (nx - 1));
  const y_axis = Array.from({ length: ny }, (_v, i) => -hy + (2 * hy * i) / (ny - 1));
  const data = new Float32Array(nx * ny);
  let robust = 0;
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const v = f(x_axis[ix], y_axis[iy], ix, iy);
      data[iy * nx + ix] = v;
      if (Number.isFinite(v) && v > robust) robust = v;
    }
  }
  return {
    header: {
      nx,
      ny,
      x_axis,
      y_axis,
      x_label: "H",
      y_label: "K",
      cut_label: "L=0",
      robust_max: robust,
    },
    data,
  };
}

// ---------------------------------------------------------------- what a run's search left alone
//
// Stand-ins for the backend's answers about the sample's modulation, for the
// tests that mock the API: the record of a run that declared k = (1/3, 0, 0)
// as planes, ± 0.08 r.l.u. (the backend's default until plan 4.15's P3; the
// default declares none since), and labels on a cut as GET /api/modulation/{id}/labels
// sends them. The backend computes these (nebula3d.modulation); the app never
// does: a test oracle, not a second implementation.

/** k = (1/3, 0, 0) declared as planes, as a run's record writes it. */
export const THIRDS_AS_PLANES: ModulationDeclaration = { k: [["1/3", "0", "0"]], order: 1, form: "planes", half_width: 0.08, normal: null };

/** Whether a coordinate lies in THIRDS_AS_PLANES's planes: within 0.08 of the centres 0.3333 and 0.6667 (mod 1), as the backend quantises them. */
export const onTheThirds = (h: number): boolean =>
  [0.3333, 0.6667].some((c) => {
    const d = Math.abs((((h - c) % 1) + 1) % 1);
    return Math.min(d, 1 - d) <= 0.08;
  });

/** Labels on `slice`'s grid: label(x, y) for each voxel (0: in no protected position). `recorded` false: a record from before the punch kept them. */
export function labelsOn(
  slice: Slice,
  label: (x: number, y: number) => number,
  { recorded = true, declared = THIRDS_AS_PLANES }: { recorded?: boolean; declared?: ModulationDeclaration | null } = {},
): ProtectedLabels {
  const { nx, ny, x_axis, y_axis } = slice.header;
  const data = new Float32Array(nx * ny);
  if (recorded) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) data[iy * nx + ix] = label(x_axis[ix], y_axis[iy]);
  return { header: { ...slice.header, robust_max: 1, recorded, declared: recorded ? declared : null, legend: [] }, data };
}

/** A record of a run whose sharp peaks off the lattice bunched at H ≡ ±1/3 (mod 1), as Bunching.to_json writes it. */
export const BUNCHED_AT_THIRDS: Bunching = {
  coordinate: "H",
  equivalents: [],
  period: 1,
  denominator: 3,
  values: [
    { value: "1/3", hits: 8 },
    { value: "2/3", hits: 6 },
  ],
  hits: 14,
  peaks: 17,
  expected: 1.9,
  p0: 0.112,
  p_value: 2.1e-11,
  alpha: 0.00135,
  tests: 24,
  half_width: 0.05,
  centres: [[0.3333, 0.5, 0]],
  mean_distance: 0.004,
  others: [],
  where: "H ≡ ±1/3 (mod 1)",
};

/** A punch record: what the search left alone (by default, nothing declared) and what it found. */
export const recordOf = ({ declared = null, bunching = null }: { declared?: ModulationDeclaration | null; bunching?: Bunching | null } = {}): ModulationRecord => ({
  declared,
  cell: [1, 1, 1],
  symmetry_ops: null,
  legacy: null,
  bunching,
});
