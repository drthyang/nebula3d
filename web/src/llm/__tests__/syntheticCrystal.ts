// A synthetic crystal behind a mocked API: the made-up cubic crystal the
// tests of what NEBULA Pilot's model reads stand on (modelVisible.test.ts, and
// tokenBudget.test.ts, which measures how long its longest request grows).
// A test file mocks the API client (vi.mock of "../../api/client") with the
// functions in BackendMocks and hands them to installBackend, which answers
// every call from the crystal. No backend is called and no measured data is used.

import type { Mock } from "vitest";

import type {
  BraggPeakWidth,
  BraggProfile,
  ConsistencyCheck,
  Dataset,
  DeltaPdfMeta,
  DpdfFeatures,
  FlattenSettings,
  RingDiagnostics,
  RingIsotropy,
  ShellFloors,
  Slice,
  UbCheck,
  VolumeCoverage,
  VolumeMeta,
} from "../../api/types";
import { useDpdfStore } from "../../state/dpdfStore";
import { useNavStore } from "../../state/navStore";
import { usePipelineStore } from "../../state/pipelineStore";
import { useViewerStore } from "../../state/viewerStore";
import { useTuneStore } from "../tune/tuner";
import { shellFloorsOf } from "./shellFloors";

/** The API client's functions the crystal answers: the test file's mocks of them. */
export type BackendMocks = Record<
  | "fetchBraggProfile"
  | "fetchConsistencyCheck"
  | "fetchDataset"
  | "fetchDpdfFeatures"
  | "fetchDpdfMeta"
  | "fetchDpdfSlice"
  | "fetchMeta"
  | "fetchRingDiagnostics"
  | "fetchRingIsotropy"
  | "fetchShellFloors"
  | "fetchSlice"
  | "fetchUbCheck"
  | "fetchVolumeCoverage",
  Mock
>;

// A cubic cell of 4 Å on a 97³ grid, H, K, L ∈ [−3, 3]; its ΔPDF on a 49³ grid,
// x, y, z ∈ [−12, 12] Å. Rational functions and integer noise only, so every
// platform computes the same numbers.
const A = 4;
const QU = (2 * Math.PI) / A; // |Q| of one r.l.u., Å⁻¹
const axis = (half: number, step: number): number[] =>
  Array.from({ length: Math.round((2 * half) / step) + 1 }, (_v, i) => -half + i * step);
const R_AXIS = axis(3, 0.0625);
const D_AXIS = axis(12, 0.5);
const NR = R_AXIS.length; // 97
const ND = D_AXIS.length; // 49

/** Deterministic noise in [−1, 1) from grid indices. */
const noise = (i: number, j: number, k: number): number => ((i * 7919 + j * 104729 + k * 1299709) % 1009) / 504.5 - 1;
const lorentz = (d: number, w: number): number => 1 / (1 + (d / w) * (d / w));
const frac = (x: number): number => x - Math.round(x);

const RECIP_STAGE_NAMES = ["raw", "ringremoved", "braggpunched", "backfilled", "flattened"] as const;
type RecipStageName = (typeof RECIP_STAGE_NAMES)[number];

// Two datasets of the one crystal: in A the ring removal leaves 15 % of the
// powder ring, in B none. Each leaves one Bragg peak unpunched, at (2, 1, 0).
const RING_LEFT: Record<string, number> = { synthetic_a: 0.15, synthetic_b: 0 };
const MISSED_NODE = [2, 1, 0];
const RING_Q = 3.2; // Å⁻¹

function recipValue(stage: RecipStageName, ringLeft: number, h: number, k: number, l: number, idx: [number, number, number]): number {
  const q = QU * Math.sqrt(h * h + k * k + l * l);
  if (q < 0.25 || q > 4.4) return NaN; // the beam stop, and where the counts end (inside the box)
  // Rods of short-range order at half-integer H and K, over a rising background.
  const diffuse = 12 + 6 * lorentz(0.5 - Math.abs(frac(h)), 0.08) + 6 * lorentz(0.5 - Math.abs(frac(k)), 0.08);
  const background = 4 + 0.25 * q * q;
  const ring = 30 * lorentz(q - RING_Q, 0.12);
  // Sharp Bragg peaks at the integer nodes, within 0.1 r.l.u., where the punch
  // takes them out (all but one).
  const node = [Math.round(h), Math.round(k), Math.round(l)];
  const d = Math.sqrt((h - node[0]) * (h - node[0]) + (k - node[1]) * (k - node[1]) + (l - node[2]) * (l - node[2]));
  const origin = node.every((x) => x === 0);
  const bragg = origin || d >= 0.1 ? 0 : (1500 / (1 + 0.2 * q * q)) * lorentz(d, 0.02);
  const punched = !origin && d < 0.1 && !node.every((x, i) => x === MISSED_NODE[i]);
  const under = diffuse + background + 0.8 * noise(...idx);
  switch (stage) {
    case "raw":
      return under + ring + bragg;
    case "ringremoved":
      return under + ringLeft * ring + bragg;
    case "braggpunched":
      return punched ? NaN : under + ringLeft * ring + bragg;
    case "backfilled":
      return under + ringLeft * ring + (punched ? 0 : bragg);
    case "flattened":
      return under + ringLeft * ring + (punched ? 0 : bragg) - background - 12;
  }
}

// Correlations along the cell edges (−) and the face diagonals (+), each at
// every image under the cube's operations, with a ripple that keeps the cube's
// symmetry. Computed from the sorted |x|, |y|, |z|, so equivalent points get
// the same bits and the sections keep their symmetry exactly.
const SIGNS = [[1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1], [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1]];
const PERMUTATIONS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
const imagesOf = (v: number[]): number[][] => {
  const all = PERMUTATIONS.flatMap((p) => SIGNS.map((s) => p.map((from, i) => v[from] * s[i] + 0)));
  return all.filter((x, i) => all.findIndex((y) => y.every((c, n) => c === x[n])) === i);
};
const FEATURES: [number[], number][] = [
  ...imagesOf([4, 0, 0]).map((v): [number[], number] => [v, -25]),
  ...imagesOf([4, 4, 0]).map((v): [number[], number] => [v, 15]),
];
// A compact peak: a squared Lorentzian, its tails falling as d⁻⁴.
const blob = (d: number, w: number): number => lorentz(d, w) * lorentz(d, w);
function dpdfValue(x: number, y: number, z: number, idx: [number, number, number]): number {
  const [u, v, w] = [Math.abs(x), Math.abs(y), Math.abs(z)].sort((p, q) => p - q);
  const c = (ND - 1) / 2;
  const [i, j, k] = idx.map((n) => Math.abs(n - c)).sort((p, q) => p - q);
  let value = 400 * blob(Math.sqrt(u * u + v * v + w * w), 0.8) + 0.6 * noise(i, j, k);
  for (const [[px, py, pz], amp] of FEATURES) {
    value += amp * blob(Math.sqrt((u - px) * (u - px) + (v - py) * (v - py) + (w - pz) * (w - pz)), 0.6);
  }
  return value;
}

const PLANE_AXES: Record<string, { fixed: number; labels: [string, string] }> = {
  hk0: { fixed: 2, labels: ["H", "K"] },
  h0l: { fixed: 1, labels: ["H", "L"] },
  "0kl": { fixed: 0, labels: ["K", "L"] },
  xy: { fixed: 2, labels: ["x", "y"] },
  xz: { fixed: 1, labels: ["x", "z"] },
  yz: { fixed: 0, labels: ["y", "z"] },
};

/** A slice of a 3D function on `grid` at `value` along the plane's fixed axis. */
function makeCut(plane: string, value: number, grid: number[], f: (p: number[], idx: [number, number, number]) => number, real: boolean): Slice {
  const { fixed, labels } = PLANE_AXES[plane];
  const step = grid[1] - grid[0];
  const fixedIndex = Math.round((value - grid[0]) / step);
  const free = [0, 1, 2].filter((a) => a !== fixed);
  const n = grid.length;
  const data = new Float32Array(n * n);
  let robust = 0;
  for (let iy = 0; iy < n; iy++) {
    for (let ix = 0; ix < n; ix++) {
      const p = [0, 0, 0];
      const idx: [number, number, number] = [0, 0, 0];
      p[fixed] = value;
      idx[fixed] = fixedIndex;
      p[free[0]] = grid[ix];
      idx[free[0]] = ix;
      p[free[1]] = grid[iy];
      idx[free[1]] = iy;
      const v = f(p, idx);
      data[iy * n + ix] = v;
      if (Number.isFinite(v) && v > robust) robust = v;
    }
  }
  return {
    header: {
      nx: n,
      ny: n,
      x_axis: grid,
      y_axis: grid,
      x_label: labels[0],
      y_label: labels[1],
      cut_label: `${"HKLxyz"[(real ? 3 : 0) + fixed]}=${value}`,
      robust_max: robust,
      ...(real ? { axes_angle: 90 } : {}),
    },
    data,
  };
}

// The datasets: every stage on disk.
const datasetOf = (stem: string): Dataset => ({
  id: stem,
  temperature: null,
  raw_name: `${stem}.nxs`,
  stem,
  stages: [
    ...RECIP_STAGE_NAMES.map((name) => ({ name, exists: true, kind: "hkl" as const, volume_id: `${stem}.${name}` })),
    { name: "delta_pdf", exists: true, kind: "delta_pdf" as const, volume_id: `${stem}.delta_pdf` },
  ],
});
export const DATASET = datasetOf("synthetic_a");
const OTHER = datasetOf("synthetic_b");
export const DATASETS = [DATASET, OTHER];

const LATTICE = { a: A, b: A, c: A, alpha: 90, beta: 90, gamma: 90 };
const MMM = [
  [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1], [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1],
].map(([a, b, c]) => [[a, 0, 0], [0, b, 0], [0, 0, c]]);

// What the default flatten records in its output (nebula3d.pipeline.FlattenParams).
const FLATTEN_RECORD: FlattenSettings = {
  estimator: "model",
  fit_q_range: [0.8, 10],
  floor_percentile: 25,
  ion: null,
  min_count: 20,
  q2_term: false,
  q_range: null,
  q_step: 0.05,
  smooth: 0.1,
  snip_width: 0.3,
};

const volumeMeta = (id: string): VolumeMeta => ({
  id,
  stage: id.split(".")[1],
  kind: "hkl",
  shape: [NR, NR, NR],
  h_range: [-3, 3],
  k_range: [-3, 3],
  l_range: [-3, 3],
  lattice: LATTICE,
  ub_matrix: [[QU, 0, 0], [0, QU, 0], [0, 0, QU]],
  planes: ["hk0", "h0l", "0kl"],
  symmetry: "mmm",
  symmetry_ops: MMM,
  sigma: "measured",
  // The flattened stage records the settings its flatten ran with; no other stage does.
  flatten_settings: id.endsWith(".flattened") ? FLATTEN_RECORD : null,
});

const dpdfMeta = (id: string): DeltaPdfMeta => ({
  id,
  shape: [ND, ND, ND],
  x_range: [-12, 12],
  y_range: [-12, 12],
  z_range: [-12, 12],
  lattice: LATTICE,
  q_max: 8.162,
  planes: ["xy", "xz", "yz"],
  window_shape: "ellipsoid",
  window_scale: 1,
  window_open_weight: 2.4e-4,
});

const peak = (index: number, hkl: [number, number, number], q: number, intensity: number, significance: number, node: boolean): BraggPeakWidth => ({
  index,
  source_node_hkl: node ? hkl : null,
  center_hkl: hkl,
  q_abs: q,
  intensity,
  local_background: 16,
  significance,
  width_hkl: [0.12, 0.12, 0.12],
  width_q: [0.19, 0.19, 0.19],
  measured_width_hkl: node ? [0.06, 0.06, 0.07] : [0.1, 0.09, 0.12],
  measured_width_q: node ? [0.094, 0.094, 0.11] : [0.157, 0.141, 0.188],
  resolution_limited: node ? [true, true, false] : [false, false, false],
  principal_directions_hkl: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  fit_kind: "covariance",
});
const BRAGG_PROFILE: BraggProfile = {
  dataset_id: "synthetic_a",
  profile_path: null,
  has_profile: true,
  schema_version: 3,
  width_labels: ["a*", "b*", "c*"],
  width_units: { q: "Å⁻¹", hkl: "r.l.u." },
  n_peaks: 14,
  fit_covariance: true,
  punch_frame: "spherical",
  peaks: [
    peak(0, [1, 0, 0], 1.571, 1250, 310, true),
    peak(1, [0, 1, 0], 1.571, 1240, 305, true),
    peak(2, [1, 1, 0], 2.221, 1060, 262, true),
    peak(3, [1, 1, 1], 2.721, 900, 221, true),
    peak(4, [2, 0, 0], 3.142, 760, 188, true),
    peak(5, [2, 1, 0], 3.512, 640, 160, true),
    // Off the lattice: what the search punched at half-integer positions.
    peak(6, [1.5, 0.5, 0], 2.483, 96, 22, false),
    peak(7, [0.5, 1.5, 0], 2.483, 94, 21, false),
    peak(8, [1.5, -0.5, 0], 2.483, 90, 20, false),
    peak(9, [2.5, 0.5, 0], 4.005, 61, 14, false),
    peak(10, [0.5, 2.5, 0], 4.005, 60, 14, false),
    peak(11, [1.5, 1.5, 0], 3.332, 55, 12, false),
    peak(12, [0.5, 0.5, 1], 1.924, 52, 11, false),
    peak(13, [1.5, 0.5, 1], 2.938, 48, 10, false),
  ],
};

const CONSISTENCY: ConsistencyCheck = {
  dataset_id: "synthetic_a",
  check_path: "synthetic_a_delta_pdf_consistency.json",
  has_check: true,
  metrics: {
    pearson_r: 0.99714,
    normalized_rms: 0.07132,
    rms: 0.512,
    n_voxels: 117649,
    per_plane_r: { "+0.000": 0.99691 },
    q_band: null,
    crop_hkl: null,
    apodization: "gaussian",
    pearson_r_even: 0.99999981,
    normalized_rms_even: 2.1e-7,
    odd_share: 0.00421,
    n_voxels_even: 117649,
  },
};

const COVERAGE: VolumeCoverage = {
  id: "synthetic_a.raw",
  q: [],
  counted: [],
  q_min_edge: 0.25,
  q_max_edge: 4.4,
  full_q_min: 0.3,
  full_q_max: 4.35,
  measured_q_max: 4.35, // NaN past the counts, as in its cuts: the measured voxels end with them
  box_q: 4.712,
  box_corner_q: 8.162,
  q_step: 0.1,
};

const UB_CHECK: UbCheck = {
  id: "synthetic_a.raw",
  fit: "both",
  cell_nodes: [1, 1, 1],
  operations: 8,
  operations_from: "synthetic_a.nxs",
  symmetry_break: 0.0012,
  symmetrised: false,
  passes: [{ q_max: 4.4, n_found: 120, n_used: 112, rms_start: 0.0123, rms: 0.0119, angle_deg: 0.003 }],
  n_searched: 130,
  n_used: 112,
  n_rejected: 8,
  rms_start: 0.0123,
  rms: 0.0119,
  angle_deg: 0.003,
  axis_uvw: [0.12, -0.31, 0.94],
  cell_start: [4, 4, 4, 90, 90, 90],
  cell: [4.0012, 4.0009, 3.9994, 90.01, 89.99, 90],
  transform: [[0.9997, 0, 0], [0, 0.9998, 0], [0, 0, 1.0002]],
  ub_start: [[QU, 0, 0], [0, QU, 0], [0, 0, QU]],
  ub: [[QU, 0, 0], [0, QU, 0], [0, 0, QU]],
  radial: [
    { q_lo: 0, q_hi: 2, direction: "in-plane", n: 40, before: 0.0004, after: 0.0001 },
    { q_lo: 2, q_hi: null, direction: "oblique", n: 72, before: 0.0003, after: -0.0001 },
  ],
  voxel_q: 0.0982,
  mean_offset_rlu: { before: [0.0011, -0.0007, 0.0002], after: [0.0009, -0.0006, 0.0002], standard_error: [0.0008, 0.0008, 0.0009], n: 112 },
};

// The ΔPDF's features grouped as the backend groups them: by the point group
// the raw file declares (mmm, volumeMeta below). Its orbits are smaller than
// the cube's, so each cube orbit of the crystal's correlations is three
// entries: ⟨1 0 0⟩ one vector each, ⟨1 1 0⟩ two.
const mmmOrbit = (sign: 1 | -1, length: number, size: number, value: number, rlu: number[][]): DpdfFeatures["groups"][number] => ({
  sign, length, size_sigma: size, mean_size_sigma: size, value, n: rlu.length, multiplicity: rlu.length,
  vectors: rlu.map((v) => v.map((x) => A * x)), vectors_rlu: rlu, sizes_sigma: rlu.map(() => size),
});
const DPDF_FEATURES: DpdfFeatures = {
  id: "synthetic_a.delta_pdf",
  sigma: 0.71,
  min_sigma: 5,
  origin_radius: 1.8,
  n_extrema: 26,
  grouped_by: "declared symmetry (mmm: 8 operations, r ≡ −r)",
  groups: [
    mmmOrbit(-1, 4, 35.2, -25, [[1, 0, 0]]),
    mmmOrbit(-1, 4, 35.2, -25, [[0, 1, 0]]),
    mmmOrbit(-1, 4, 35.2, -25, [[0, 0, 1]]),
    mmmOrbit(1, 5.657, 21.1, 15, [[1, 1, 0], [1, -1, 0]]),
    mmmOrbit(1, 5.657, 21.1, 15, [[1, 0, 1], [1, 0, -1]]),
    mmmOrbit(1, 5.657, 21.1, 15, [[0, 1, 1], [0, 1, -1]]),
  ],
};

// The 3D test of each bump: the one at the powder ring's |Q| rises in nearly every direction.
const ringIsotropy = (id: string, shells: { q: number; fwhm: number }[]): RingIsotropy => ({
  id,
  rule: { direction_share: 0.9, height_share: 0.15 },
  shells: shells.map((s) => {
    const ring = Math.abs(s.q - RING_Q) < 0.15;
    return {
      q_center: s.q,
      fwhm: s.fwhm,
      n_cells: 400,
      median_height: ring ? 4 : 1,
      relative_height: ring ? 0.2 : 0.05,
      isotropy: ring ? 0.86 : 0.04,
      is_ring: ring,
      not_judged: null,
    };
  }),
});

// What the ring removal recorded: the powder ring confirmed, none left unconfirmed.
const ringDiagnostics = (id: string): RingDiagnostics => ({
  dataset_id: id,
  diagnostics_path: `processed/${id}_ringremoved_diagnostics.json`,
  has_diagnostics: true,
  status: "fitted",
  unconfirmed_at_grid: null,
});

// The whole volume's shell floors of a dataset's flattened stage, on the
// flatten's shells, with its input's level (the server's shell-floors): once per dataset.
const floorsByStem = new Map<string, ShellFloors>();
function shellFloors(id: string): ShellFloors {
  const stem = id.split(".")[0];
  const hit = floorsByStem.get(stem);
  if (hit) return hit;
  const left = RING_LEFT[stem];
  const q = (h: number, k: number, l: number) => QU * Math.sqrt(h * h + k * k + l * l);
  const stage = (name: RecipStageName) => ({
    axes: [R_AXIS, R_AXIS, R_AXIS] as [number[], number[], number[]],
    q,
    value: (h: number, k: number, l: number, idx: [number, number, number]) => recipValue(name, left, h, k, l, idx),
  });
  const out = shellFloorsOf(stage("flattened"), stage("backfilled"), { id: `${stem}.flattened`, flatten: FLATTEN_RECORD });
  floorsByStem.set(stem, out);
  return out;
}

/** Answer every mocked API call from the crystal. */
export function installBackend(api: BackendMocks): void {
  const stemOf = (id: string) => id.split(".")[0];
  api.fetchMeta.mockImplementation(async (id: string) => volumeMeta(id));
  api.fetchShellFloors.mockImplementation(async (id: string) => shellFloors(id));
  api.fetchDpdfMeta.mockImplementation(async (id: string) => dpdfMeta(id));
  api.fetchSlice.mockImplementation(async (id: string, plane: string, value: number) => {
    const [stem, stage] = id.split(".") as [string, RecipStageName];
    const left = RING_LEFT[stem];
    return makeCut(plane, value, R_AXIS, (p, idx) => recipValue(stage, left, p[0], p[1], p[2], idx), false);
  });
  api.fetchDpdfSlice.mockImplementation(async (_id: string, plane: string, value: number) =>
    makeCut(plane, value, D_AXIS, (p, idx) => dpdfValue(p[0], p[1], p[2], idx), true),
  );
  api.fetchBraggProfile.mockImplementation(async (id: string) => ({ ...BRAGG_PROFILE, dataset_id: id }));
  api.fetchConsistencyCheck.mockImplementation(async (id: string) => ({ ...CONSISTENCY, dataset_id: id }));
  api.fetchVolumeCoverage.mockImplementation(async (id: string) => ({ ...COVERAGE, id }));
  api.fetchUbCheck.mockImplementation(async (id: string) => ({ ...UB_CHECK, id }));
  api.fetchDpdfFeatures.mockImplementation(async (id: string) => ({ ...DPDF_FEATURES, id }));
  api.fetchRingIsotropy.mockImplementation(async (id: string, shells: { q: number; fwhm: number }[]) => ringIsotropy(id, shells));
  // The grid is fine (0.0625 r.l.u., 0.098 Å⁻¹ a voxel): the ring removal left no ring unconfirmed.
  api.fetchRingDiagnostics.mockImplementation(async (id: string) => ringDiagnostics(id));
  api.fetchDataset.mockImplementation(async (id: string) => DATASETS.find((d) => d.id === stemOf(id)));
}

// The console as a fresh session leaves it: default settings, no run, the
// reciprocal viewer at L = 0 and the ΔPDF viewer at z = 4 Å.
export function freshConsole(): void {
  usePipelineStore.setState(usePipelineStore.getInitialState(), true);
  useTuneStore.setState({ active: false, stages: [], error: null, finishedNote: null });
  useNavStore.setState({ tab: "reciprocal" });
  useViewerStore.setState({ fixedAxis: "L", cutIndex: (NR - 1) / 2 });
  useDpdfStore.setState({ cutX: (ND - 1) / 2, cutY: (ND - 1) / 2, cutZ: 32, limit: null });
}
