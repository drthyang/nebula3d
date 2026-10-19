// What NEBULA Pilot's model sees, written to readable file snapshots
// (__snapshots__/model-visible/): the opening messages the app builds, every
// tool's definition, the other text the model reads (stage goals, verdict
// criteria, the skills' listing, the stage-review and tuning prompts), a sample
// of each tool's result as the executor hands it over, and the text the answer
// checks and the agent loop send back. A diff in a snapshot is a change to what
// the model sees, and is reviewed as one. Update them from web/ with
// `npx vitest run src/llm/__tests__/modelVisible.test.ts -u`, then read the diff
// (-u last: placed before the file, it takes the path as its value and runs
// the whole suite).
//
// Hermetic and synthetic: a made-up cubic crystal (a = 4 Å) behind a mocked
// API, stubbed pipeline and tuning runs, a scripted model and a frozen clock.
// No model is loaded, no backend or API is called, and no measured data is used.
//
// Tool results sampled: all 24 tools in CHAT_TOOLS. None skipped. Covered in part:
// - read_skill: one skill's body; not a reference (those are docs/algorithms
//   pages, read as written).
// - run_pipeline, tune_pipeline: the runs are stubs; what is sampled is the
//   tool's own account of a fake run (the stages it ran, the trials it kept).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  BraggPeakWidth,
  BraggProfile,
  ConsistencyCheck,
  Dataset,
  DeltaPdfMeta,
  DpdfFeatures,
  JobEvent,
  RingIsotropy,
  Slice,
  UbCheck,
  VolumeCoverage,
  VolumeMeta,
} from "../../api/types";
import { useDpdfStore } from "../../state/dpdfStore";
import { useNavStore } from "../../state/navStore";
import { usePipelineStore } from "../../state/pipelineStore";
import { useViewerStore } from "../../state/viewerStore";
import { runAgent, type AgentStep } from "../agent";
import { answerIssues, issuesPrompt } from "../answerChecks";
import { compactResult } from "../compact";
import { loadPipelineContext } from "../context/loadContext";
import type { PipelineContext } from "../context/pipelineContext";
import { armSetup, TASK } from "../evals/validation";
import { toolsFor } from "../localTools";
import { buildChatMessages, buildStageReviewMessages, type ReviewStage } from "../prompts/templates";
import type { ChatMessage, StreamDelta, ToolCall } from "../provider/client";
import { NAMED_REFERENCES } from "../references";
import { CRITERIA, NOT_DECLARED, VERDICT_LABEL } from "../report/report";
import { DEFAULT_SETTINGS, type LlmSettings } from "../settings";
import { allSkills, skillsPrompt } from "../skills";
import { CHAT_TOOLS, MAX_RESULT_CHARS, runToolCall, toolSpecs, type AgentTool, type ToolContext } from "../tools";
import { currentStageSettings } from "../tune/catalog";
import { buildJudgeMessages, buildProposeMessages, STAGE_GOALS, TUNE_SYSTEM } from "../tune/prompts";
import { useTuneStore } from "../tune/tuner";

const api = vi.hoisted(() => ({
  fetchBraggProfile: vi.fn(),
  fetchConsistencyCheck: vi.fn(),
  fetchDataset: vi.fn(),
  fetchDpdfFeatures: vi.fn(),
  fetchDpdfMeta: vi.fn(),
  fetchDpdfSlice: vi.fn(),
  fetchMeta: vi.fn(),
  fetchRingIsotropy: vi.fn(),
  fetchSlice: vi.fn(),
  fetchUbCheck: vi.fn(),
  fetchVolumeCoverage: vi.fn(),
}));
vi.mock("../../api/client", () => api);

const tuner = vi.hoisted(() => ({ startTuning: vi.fn() }));
vi.mock("../tune/tuner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tune/tuner")>()),
  startTuning: tuner.startTuning,
}));

const model = vi.hoisted(() => ({ streamChat: vi.fn() }));
vi.mock("../provider/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../provider/client")>()),
  streamChat: model.streamChat,
}));

const SNAPSHOTS = "./__snapshots__/model-visible";
const UPDATE = "Update from web/: `npx vitest run src/llm/__tests__/modelVisible.test.ts -u`, then read the diff.";

// ---------------------------------------------------------------- a synthetic crystal

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
const DATASET = datasetOf("synthetic_a");
const OTHER = datasetOf("synthetic_b");
const DATASETS = [DATASET, OTHER];

const LATTICE = { a: A, b: A, c: A, alpha: 90, beta: 90, gamma: 90 };
const MMM = [
  [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1], [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1],
].map(([a, b, c]) => [[a, 0, 0], [0, b, 0], [0, 0, c]]);

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
  box_q: 4.712,
  box_corner_q: 8.162,
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

const DPDF_FEATURES: DpdfFeatures = {
  id: "synthetic_a.delta_pdf",
  sigma: 0.71,
  min_sigma: 5,
  origin_radius: 1.8,
  n_extrema: 26,
  groups: [
    {
      sign: -1, length: 4, size_sigma: 35.2, value: -25, n: 3,
      vectors: [[4, 0, 0], [0, 4, 0], [0, 0, 4]],
      vectors_rlu: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      sizes_sigma: [35.2, 35.2, 35.2],
    },
    {
      sign: 1, length: 5.657, size_sigma: 21.1, value: 15, n: 6,
      vectors: [[4, 4, 0], [4, -4, 0], [4, 0, 4], [4, 0, -4], [0, 4, 4], [0, 4, -4]],
      vectors_rlu: [[1, 1, 0], [1, -1, 0], [1, 0, 1], [1, 0, -1], [0, 1, 1], [0, 1, -1]],
      sizes_sigma: [21.1, 21.1, 21.1, 21.1, 21.1, 21.1],
    },
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

function installBackend(): void {
  const stemOf = (id: string) => id.split(".")[0];
  api.fetchMeta.mockImplementation(async (id: string) => volumeMeta(id));
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
  api.fetchDataset.mockImplementation(async (id: string) => DATASETS.find((d) => d.id === stemOf(id)));
}

// The console as a fresh session leaves it: default settings, no run, the
// reciprocal viewer at L = 0 and the ΔPDF viewer at z = 4 Å.
function freshConsole(): void {
  usePipelineStore.setState(usePipelineStore.getInitialState(), true);
  useTuneStore.setState({ active: false, stages: [], error: null, finishedNote: null });
  useNavStore.setState({ tab: "reciprocal" });
  useViewerStore.setState({ fixedAxis: "L", cutIndex: (NR - 1) / 2 });
  useDpdfStore.setState({ cutX: (ND - 1) / 2, cutY: (ND - 1) / 2, cutZ: 32, limit: null });
}

// A frozen clock that only the stubbed runs move.
let clock = 0;

beforeAll(() => {
  installBackend();
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});
afterAll(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- rendering

/** A fence longer than any run of backticks in the text, so the text stays as written. */
function fence(text: string, lang = "text"): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const f = "`".repeat(longest + 1);
  return `${f}${lang}\n${text}\n${f}`;
}

const contentText = (m: ChatMessage): string => (typeof m.content === "string" ? m.content : pretty(m.content));

function renderMessages(messages: ChatMessage[], from = 0): string {
  return messages
    .slice(from)
    .map((m, i) => {
      const id = m.tool_call_id ? ` (answers ${m.tool_call_id})` : "";
      const calls = m.tool_calls?.length ? `\n\nTool calls:\n\n${fence(pretty(m.tool_calls), "json")}` : "";
      return `### ${from + i}. ${m.role}${id}\n\n${fence(contentText(m))}${calls}`;
    })
    .join("\n\n");
}

/** JSON indented two spaces, with a list of plain values kept on one line. */
function pretty(value: unknown, pad = ""): string {
  const inner = `${pad}  `;
  if (Array.isArray(value)) {
    if (value.every((x) => x === null || typeof x !== "object")) return `[${value.map((x) => JSON.stringify(x)).join(", ")}]`;
    return `[\n${value.map((x) => inner + pretty(x, inner)).join(",\n")}\n${pad}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) return "{}";
    return `{\n${entries.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${pretty(x, inner)}`).join(",\n")}\n${pad}}`;
  }
  return JSON.stringify(value);
}

/** A result as the model reads it: JSON shown indented (it reads it on one line), anything else as is. */
function showResult(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text);
    // Indenting changes only the whitespace: the one-line form is JSON.stringify's.
    if (JSON.stringify(parsed) === text) return fence(pretty(parsed), "json");
  } catch {
    // not JSON: shown as it is
  }
  return fence(text);
}

const doc = (title: string, intro: string, body: string): string => `# ${title}\n\n${intro}\n\n${UPDATE}\n\n${body}\n`;

// ---------------------------------------------------------------- the opening context

let context: PipelineContext;

beforeAll(async () => {
  freshConsole();
  context = (await loadPipelineContext(DATASET)).context;
});

const QUESTION = "How clean is this reduction?";

// ---------------------------------------------------------------- 1. the opening messages

describe("1. the system prompt and the first user message, as the app builds them", () => {
  const tools = (ts: AgentTool[]) => `Tools offered (${ts.length}): ${ts.map((t) => t.name).join(", ")}.`;

  it("arm B: tools on, skills on (the Pilot as shipped)", async () => {
    const b = armSetup("B", CHAT_TOOLS, buildChatMessages(context, [], TASK, null, { tools: true }));
    await expect(
      doc(
        "Opening messages: tools on, skills on (validation arm B)",
        "`buildChatMessages(context, [], TASK, null, { tools: true })` over the synthetic context, as `armSetup(\"B\")` passes it on; TASK is the validation task (evals/validation.ts). A chat question takes TASK's place in the last message.\n\n" +
          tools(b.tools),
        renderMessages(b.messages),
      ),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/1-chat-arm-b.md`);
  });

  it("arm C: tools on, skills off (read_skill and the skill listing taken away)", async () => {
    const messages = buildChatMessages(context, [], TASK, null, { tools: true });
    const c = armSetup("C", CHAT_TOOLS, messages);
    // Arm C differs from B by the listing only.
    expect(c.messages[0].content).toBe((messages[0].content as string).replace(skillsPrompt(), ""));
    await expect(
      doc(
        "Opening messages: tools on, skills off (validation arm C)",
        "The same messages as arm B with the skills' listing cut from the system prompt, as `armSetup(\"C\")` builds them (evals/validation.ts).\n\n" +
          tools(c.tools),
        renderMessages(c.messages),
      ),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/1-chat-arm-c.md`);
  });

  it("tools off: the fixed-cut metrics only", async () => {
    const messages = buildChatMessages(context, [], QUESTION, null, { tools: false });
    await expect(
      doc(
        "Opening messages: tools off",
        "`buildChatMessages(context, [], question, null, { tools: false })`: what a model reads with Tools off, or one that cannot call tools. No tools are offered.\n\n" +
          "There is no separate system prompt for a local model: it reads the same messages, with fewer tools offered (2-local-tools.md).",
        renderMessages(messages),
      ),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/1-chat-tools-off.md`);
  });
});

// ---------------------------------------------------------------- 2. the tools

describe("2. the tools, as sent to the model", () => {
  it("every tool in CHAT_TOOLS, in registry order", async () => {
    const specs = toolSpecs(CHAT_TOOLS);
    const body = specs
      .map(
        (s, i) =>
          `## ${i + 1}. ${s.function.name}\n\n${fence(s.function.description)}\n\nParameters:\n\n${fence(pretty(s.function.parameters), "json")}`,
      )
      .join("\n\n");
    await expect(
      doc(
        "Tool definitions",
        `\`toolSpecs(CHAT_TOOLS)\`: each tool's name, description and parameters' JSON schema, as sent with every request (${specs.length} tools, ${JSON.stringify(specs).length} characters as JSON).`,
        body,
      ),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/2-tools.md`);
  });

  it("the tools a local model is offered, by question", async () => {
    const questions = [
      ["a generic question", QUESTION],
      ["a ΔPDF question", "What are the strongest pair correlations in the 3D-ΔPDF?"],
      ["a flatten question", "Is there a background left after the flatten?"],
      ["an action request", "Raise the punch significance to 6 and rerun the pipeline."],
    ];
    const body = questions
      .map(([what, q]) => {
        const offered = toolsFor(q, CHAT_TOOLS);
        return `## ${what}\n\n> ${q}\n\n${offered.length} tools: ${offered.map((t) => t.name).join(", ")}.`;
      })
      .join("\n\n");
    await expect(
      doc(
        "Tools offered to a local model",
        "`toolsFor(question, CHAT_TOOLS)` (localTools.ts): a model on a local server is offered these with its first request; a tool it calls by name all the same runs and stays offered. Their definitions are in 2-tools.md.",
        body,
      ),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/2-local-tools.md`);
  });
});

// ---------------------------------------------------------------- 3. the other text

describe("3. the other text the model reads", () => {
  it("the stage-review prompts", async () => {
    const stages: ReviewStage[] = ["rings", "punch", "backfill", "flatten", "dpdf"];
    const chat = { on: buildChatMessages(context, [], QUESTION, null, { tools: true }), off: buildChatMessages(context, [], QUESTION, null, { tools: false }) };
    const reviews = stages.map((stage) => ({
      stage,
      on: buildStageReviewMessages(context, stage, null, { tools: true }),
      off: buildStageReviewMessages(context, stage, null, { tools: false }),
    }));
    // The system prompt and the context are the chat's (1-chat-*.md).
    for (const r of reviews) {
      expect(r.on.slice(0, 2)).toEqual(chat.on.slice(0, 2));
      expect(r.off.slice(0, 2)).toEqual(chat.off.slice(0, 2));
    }
    const body = [
      `## The assistant's acknowledgement\n\nTools on:\n\n${fence(contentText(reviews[0].on[2]))}\n\nTools off:\n\n${fence(contentText(reviews[0].off[2]))}`,
      ...reviews.map((r) => {
        expect(r.on[2]).toEqual(reviews[0].on[2]);
        expect(r.off[2]).toEqual(reviews[0].off[2]);
        return `## ${r.stage}\n\nTools on:\n\n${fence(contentText(r.on[3]))}\n\nTools off:\n\n${fence(contentText(r.off[3]))}`;
      }),
    ].join("\n\n");
    await expect(
      doc(
        "Stage-review prompts",
        "`buildStageReviewMessages(context, stage, null, { tools })`: the one-click reviews. Their system prompt and context message are the chat's (1-chat-arm-b.md, 1-chat-tools-off.md); the acknowledgement and the instruction follow.",
        body,
      ),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/3-stage-reviews.md`);
  });

  it("the skills' listing", async () => {
    const readSkill = CHAT_TOOLS.find((t) => t.name === "read_skill")!;
    const names = (readSkill.parameters as { properties: { name: { enum: string[] } } }).properties.name.enum;
    expect(names).toEqual(allSkills().map((s) => s.name));
    await expect(
      doc(
        "The skills' listing",
        "`skillsPrompt()` (skills.ts): appended to the system prompt with tools on (arm B; arm C goes without it). read_skill's `name` takes the same names.",
        `${fence(skillsPrompt())}\n\nread_skill's names: ${names.join(", ")}.`,
      ),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/3-skills.md`);
  });

  it("the stage goals, the verdicts' criteria and labels, and the named references", async () => {
    const section = (title: string, entries: Record<string, string>) =>
      `## ${title}\n\n${Object.entries(entries).map(([k, v]) => `### ${k}\n\n${fence(v)}`).join("\n\n")}`;
    const body = [
      section("STAGE_GOALS (tune/prompts.ts): each stage's goal, in assess_stage's single-stage result and the tuning prompts", STAGE_GOALS),
      section("CRITERIA (report/report.ts): the rule behind each verdict, in assess_stage's result as criterion", CRITERIA),
      section("VERDICT_LABEL (report/report.ts): how a verdict reads in the tools' results", VERDICT_LABEL),
      section("NAMED_REFERENCES (references.ts): the references the app fills besides a tool's fields", NAMED_REFERENCES),
      section("NOT_DECLARED (report/report.ts): the symmetry verdict on a volume that declares none, for an asymmetry of 0.02", {
        "NOT_DECLARED(0.02)": NOT_DECLARED(0.02),
      }),
    ].join("\n\n");
    await expect(
      doc("Stage goals and verdict text", "The fixed text the tools' results and the tuning prompts carry.", body),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/3-goals-and-verdicts.md`);
  });

  it("the tuning prompts", async () => {
    const config = usePipelineStore.getInitialState();
    const evaluation = { leftover_at_nodes: 1, leftover_off_lattice_sharp: 0, leftover_off_lattice_broad: 2, mean_punched_fraction: 0.031 };
    const trials = [{ trial: 1, settings: currentStageSettings("punch", config), metrics: evaluation }];
    const propose = buildProposeMessages({
      stage: "punch",
      current: currentStageSettings("punch", config),
      earlier: { rings: currentStageSettings("rings", config) },
      trials,
      count: 2,
    });
    const judge = buildJudgeMessages({
      stage: "punch",
      trials: [
        ...trials,
        { trial: 2, settings: { ...currentStageSettings("punch", config), punchMinSig: 4 }, metrics: { ...evaluation, leftover_at_nodes: 0, mean_punched_fraction: 0.033 } },
      ],
    });
    expect(propose[0].content).toBe(TUNE_SYSTEM);
    await expect(
      doc(
        "Tuning prompts",
        "What tune_pipeline asks the model, stage by stage (tune/prompts.ts), shown for the punch with the default settings and synthetic trials: what to try, then which trial was best.",
        `## What to try\n\n${renderMessages(propose)}\n\n## Which trial was best\n\n${renderMessages(judge)}`,
      ),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/3-tuning-prompts.md`);
  });
});

// ---------------------------------------------------------------- 4. the tools' results

interface Sample {
  name: string;
  args: Record<string, unknown> | string; // a string is sent as the arguments' text
  note?: string;
  ctx?: Partial<ToolContext>;
  before?: () => void;
}

const RUN_EVENTS: JobEvent[] = [
  { type: "progress", stage: "rings", status: "skip", message: "ring-removed output exists" },
  { type: "progress", stage: "punch", status: "start", message: "Bragg punch" },
  { type: "progress", stage: "punch", status: "done", fraction: 1, message: "13 peaks punched, 1 below the significance gate" },
  { type: "progress", stage: "backfill", status: "done", fraction: 1, message: "13 holes filled" },
  { type: "progress", stage: "flatten", status: "done", fraction: 1, message: "floor fitted on 32 shells" },
  { type: "progress", stage: "pdf", status: "done", fraction: 1, message: "3D-ΔPDF written" },
  { type: "progress", stage: "pdf_check", status: "done", fraction: 1, message: "back-FFT r = 0.99714" },
];

const SAMPLES: Sample[] = [
  { name: "read_skill", args: { name: "bragg-node-audit" } },
  { name: "describe_dataset", args: {} },
  { name: "current_view", args: {} },
  { name: "measure_reciprocal_cut", args: { plane: "h0l", value: 1 } },
  { name: "measure_dpdf_cut", args: { plane: "xz", value: 0 } },
  { name: "assess_stage", args: {} },
  { name: "assess_stage", args: { stage: "flatten" } },
  { name: "texture_check", args: {} },
  { name: "qmax_coverage", args: {} },
  { name: "symmetry_check", args: {} },
  { name: "dpdf_contrast", args: {} },
  { name: "dpdf_peaks", args: {} },
  { name: "grain_check", args: {} },
  { name: "ub_check", args: {} },
  { name: "radial_profile", args: {} },
  { name: "line_profile", args: { stage: "flattened", along: "H", at: { K: 0.5, L: 0 } } },
  { name: "bragg_peaks", args: {} },
  { name: "consistency_details", args: {} },
  {
    name: "run_log",
    args: {},
    before: () => usePipelineStore.setState({ events: RUN_EVENTS, terminal: "done", running: false }),
  },
  { name: "compare_datasets", args: { kind: "reciprocal", plane: "hk0", value: 0 } },
  { name: "configure_settings", args: {} },
  {
    name: "update_settings",
    args: { changes: { punchMinSig: 6 } },
    note: "with the punch's skill (bragg-node-audit) read in the conversation",
    ctx: { skillsRead: new Set(["bragg-node-audit"]) },
  },
  {
    name: "run_pipeline",
    args: { from_stage: "punch" },
    note: "a stubbed run of 42.3 s",
    before: () =>
      usePipelineStore.setState({
        runStages: vi.fn(async () => {
          usePipelineStore.setState({ running: true, events: [] });
          for (const ev of RUN_EVENTS) usePipelineStore.setState((s) => ({ events: [...s.events, ev] }));
          clock += 42_300;
          usePipelineStore.setState({ running: false, terminal: "done" });
          return "done";
        }),
      }),
  },
  {
    name: "tune_pipeline",
    args: { stages: ["punch"], trials_per_stage: 2 },
    note: "a stubbed tuning run of 5.2 min, the punch's skill read",
    ctx: { skillsRead: new Set(["bragg-node-audit"]) },
    before: () =>
      tuner.startTuning.mockImplementation(async () => {
        clock += 312_000;
        const evaluation = { leftover_at_nodes: 1, leftover_off_lattice_sharp: 0, leftover_off_lattice_broad: 2, mean_punched_fraction: 0.031 };
        useTuneStore.setState({
          active: false,
          finishedNote: "Done. The punch's settings changed; run the pipeline from the punch to write them.",
          stages: [
            {
              stage: "punch",
              tuned: true,
              status: "done",
              best: 2,
              why: "Trial 2 punched the missed node (1 → 0 at nodes) for 0.002 more punched fraction.",
              trials: [
                { n: 1, changes: {}, settings: {}, status: "done", evaluation },
                { n: 2, changes: { punchMinSig: 4 }, settings: {}, status: "done", evaluation: { ...evaluation, leftover_at_nodes: 0, mean_punched_fraction: 0.033 } },
              ],
            },
          ],
        });
      }),
  },
  { name: "show_in_viewer", args: { view: "dpdf", plane: "xy", value: 4 } },
];

// What the executor sends back for a call it cannot run.
const ERRORS: Sample[] = [
  { name: "delete_dataset", args: {}, note: "a tool that does not exist" },
  { name: "measure_reciprocal_cut", args: "{plane: hk0", note: "arguments that are not JSON" },
  { name: "measure_reciprocal_cut", args: { plane: "hk0", value: 7 }, note: "a cut outside the data" },
  { name: "update_settings", args: { changes: { punchMinSig: 6 } }, note: "a change before its stage's skill was read", ctx: { skillsRead: new Set() } },
  { name: "tune_pipeline", args: { stages: ["flatten"] }, note: "tuning before its stage's skill was read", ctx: { skillsRead: new Set() } },
];

async function runSample(s: Sample) {
  freshConsole();
  s.before?.();
  const call: ToolCall = {
    id: "call_1",
    type: "function",
    function: { name: s.name, arguments: typeof s.args === "string" ? s.args : JSON.stringify(s.args) },
  };
  return runToolCall(call, CHAT_TOOLS, { dataset: DATASET, datasets: DATASETS, ...s.ctx });
}

const sampleTitle = (s: Sample): string =>
  `${s.name} ${typeof s.args === "string" ? s.args : JSON.stringify(s.args)}${s.note ? ` (${s.note})` : ""}`;

describe("4. a sample of each tool's result, as the model reads it", () => {
  it("covers every tool", () => {
    expect([...new Set(SAMPLES.map((s) => s.name))].sort()).toEqual(CHAT_TOOLS.map((t) => t.name).sort());
  });

  it("each tool's result text after runToolCall", async () => {
    const parts: string[] = [];
    const compacted: string[] = [];
    for (const s of SAMPLES) {
      const run = await runSample(s);
      expect(run.ok, `${sampleTitle(s)}: ${run.text}`).toBe(true);
      const size = run.full
        ? `${run.text.length} characters sent: trimmed by fitResult from ${run.full.length} to the limit of ${CHAT_TOOLS.find((t) => t.name === s.name)?.maxResultChars ?? MAX_RESULT_CHARS}`
        : `${run.text.length} characters sent`;
      parts.push(`## ${sampleTitle(s)}\n\n${size}.\n\n${showResult(run.text)}`);
      if (s.name === "assess_stage" && !compacted.length) {
        compacted.push(`## ${sampleTitle(s)}\n\n${showResult(compactResult(run.text))}`);
      }
    }
    const errors: string[] = [];
    for (const s of ERRORS) {
      const run = await runSample(s);
      expect(run.ok).toBe(false);
      errors.push(`## ${sampleTitle(s)}\n\n${fence(run.text)}`);
    }
    await expect(
      doc(
        "Tool results",
        "Each tool called through `runToolCall` (tools/index.ts) against the synthetic crystal, and the text the model reads back: `ToolRun.text`, after `fitResult` trims a long result to valid JSON. JSON is shown indented; the model reads it on one line, as `JSON.stringify` writes it.",
        `${parts.join("\n\n")}\n\n# Calls the executor refuses\n\n${errors.join("\n\n")}\n\n` +
          "# An older result, shortened\n\nA local model's request past its soft budget has its older results shortened (`compactResult`, compact.ts); the first assess_stage sample above reads so:\n\n" +
          compacted.join("\n\n"),
      ),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/4-tool-results.md`);
  });
});

// ---------------------------------------------------------------- 5. what is sent back

const step = (name: string, args: Record<string, unknown>, result: unknown): AgentStep => ({
  id: `${name}:${JSON.stringify(args)}`,
  name,
  args,
  status: "done",
  result: JSON.stringify(result),
});

// A rings assessment that needs attention, a flatten run, and a ΔPDF window check.
const RINGS = step("assess_stage", { stage: "rings" }, {
  rings: {
    verdict: VERDICT_LABEL.attention,
    criterion: CRITERIA.rings,
    headline: "ring ratio 0.62 · over-sub ≤ 0.004 · ring dent ≤ 0 · left ≤ 0.12 (hk0, 3.2 Å⁻¹)",
    mean_ring_energy_ratio: 0.62,
    max_over_subtraction_fraction: 0.004,
    max_ring_dent: 0,
    max_ring_left: 0.12,
    worst_ring_left: { plane: "hk0", at: 3.2, residual_fraction: 0.12 },
  },
});
const RERUN = step("run_pipeline", { from_stage: "rings" }, { ended: "done", seconds: 42.3, stages: { rings: "computed", punch: "computed" } });
const COVERED = step("qmax_coverage", {}, { verdict: "clean: the ΔPDF's ellipsoid window puts 2.4e-4 of its weight on unmeasured reciprocal space", window_weight_on_unmeasured: 2.4e-4 });

const REPLIES: { what: string; reply: string; steps: AgentStep[] }[] = [
  {
    what: "an answer that stands on its evidence",
    reply: "The ring removal needs attention: a ring is left at 3.2 Å⁻¹, {{assess_stage.rings.max_ring_left}} of the diffuse there.",
    steps: [RINGS],
  },
  {
    what: "a number from nowhere",
    reply: "The ring removal needs attention: a ring is left at 3.4 Å⁻¹, 0.27 of the diffuse there.",
    steps: [RINGS],
  },
  {
    what: "a reference that names nothing",
    reply: "The ring removal needs attention: a ring is left at 3.2 Å⁻¹, {{assess_stage.rings.max_ring_residual}} of the diffuse there.",
    steps: [RINGS],
  },
  {
    what: "a verdict without its tool",
    reply: "The flatten left no pedestal, and the window stays inside the coverage.",
    steps: [COVERED],
  },
  {
    what: "a verdict from before the last run",
    reply: "The ring removal needs attention: a ring is left at 3.2 Å⁻¹.",
    steps: [RINGS, RERUN],
  },
  {
    what: "a verdict the tool contradicts, and a success the checks do not give",
    reply: "The ring removal is clean, so the 3D-ΔPDF is ready for analysis.",
    steps: [RINGS],
  },
];

describe("5. the text sent back to the model", () => {
  it("the answer checks' prompt, for canned replies", async () => {
    const body = REPLIES.map(({ what, reply, steps }) => {
      const sources = steps.map((s) => s.result ?? "").join("\n");
      const issues = answerIssues(reply, steps, sources);
      const tools = steps.map((s) => `${s.name} ${JSON.stringify(s.args)}`).join(", ");
      const sent = issues ? fence(issuesPrompt(issues)) : "Nothing: the answer goes to the user, its references filled in.";
      return `## ${what}\n\nTools run in the reply: ${tools}.\n\nThe answer:\n\n${fence(reply)}\n\nSent back to the model:\n\n${sent}`;
    }).join("\n\n");
    expect(answerIssues(REPLIES[0].reply, REPLIES[0].steps, REPLIES[0].steps[0].result!)).toBeNull();
    await expect(
      doc(
        "Answer checks",
        "`answerIssues` and `issuesPrompt` (answerChecks.ts) on canned replies: what the agent loop sends back, once, before a failing answer reaches the user. Each reply's number sources here are its tools' results.",
        body,
      ),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/5-answer-checks.md`);
  });

  it("the agent loop's own messages, in a scripted reply", async () => {
    freshConsole();
    const seen: { messages: ChatMessage[]; tools: string[]; toolChoice?: string }[] = [];
    const call = (id: string): StreamDelta => ({ toolCalls: [{ id, type: "function", function: { name: "describe_dataset", arguments: "{}" } }] });
    const script: StreamDelta[][] = [
      [call("call_1")],
      [call("call_2")], // the same call again: pointed at the first result
      [call("call_3")], // and again: two rounds with nothing new, asked to answer
      [{ content: "The grid is 97 × 97 × 97 voxels and the cell edge is 7.3 Å." }], // a number from nowhere
      [{ content: "The grid is 97 × 97 × 97 voxels and the cell edge is {{describe_dataset.cell.a}} Å." }],
    ];
    model.streamChat.mockImplementation((args: { messages: ChatMessage[]; tools?: { function: { name: string } }[]; toolChoice?: string }) => {
      seen.push({ messages: [...args.messages], tools: (args.tools ?? []).map((t) => t.function.name), toolChoice: args.toolChoice });
      const reply = script.shift() ?? [];
      return (async function* () {
        for (const d of reply) yield d;
      })();
    });
    const messages = buildChatMessages(context, [], "What grid and cell does this dataset have?", null, { tools: true });
    // A cloud URL: no window plan to fetch, every tool offered.
    const settings: LlmSettings = { ...DEFAULT_SETTINGS, baseUrl: "https://scripted.invalid/v1", model: "scripted", useTools: true, followViews: false };
    const result = await runAgent({
      messages,
      tools: CHAT_TOOLS,
      ctx: { dataset: DATASET, datasets: DATASETS, skillsRead: new Set(), earlierResults: [] },
      settings,
      signal: new AbortController().signal,
    });
    expect(seen).toHaveLength(5);
    expect(result.content).toBe("The grid is 97 × 97 × 97 voxels and the cell edge is 4 Å.");
    const requests = seen
      .map((r, i) => `${i + 1}. ${r.messages.length} messages, ${r.tools.length} tools offered${r.toolChoice ? `, tool_choice ${r.toolChoice}` : ""}`)
      .join("\n");
    await expect(
      doc(
        "The agent loop's messages",
        "A scripted reply through `runAgent` (agent.ts): the model calls describe_dataset three times with the same arguments, is asked to answer, answers with a number from nowhere, is sent the answer checks' prompt, and answers again. Shown: each request, then the messages the loop added after the opening four (1-chat-arm-b.md).",
        `## The requests\n\n${requests}\n\n## The conversation after the opening messages, as the last request sent it\n\n${renderMessages(seen[seen.length - 1].messages, messages.length)}`,
      ),
    ).toMatchFileSnapshot(`${SNAPSHOTS}/5-agent-loop.md`);
  });
});
