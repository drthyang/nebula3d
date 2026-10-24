// The limits and constants Python and TypeScript both hold, pinned: each
// fails when the two sides differ. A constant is shared when one side judges
// or reads what the other makes (the ring test's reason, the window's
// tolerance), when both apply one rule documented as the same (the fills'
// texture, nebula3d.analysis.bragg_fill_texture: "texture.ts's values"), or
// when the TypeScript tells the model what the Python does (the ring rule's
// shares in its criterion, a blank setting's default). Each pin names where
// each side holds its value; a pin that fails means one side changed: change
// the other with it, or, when the difference is meant, move the pin to
// INDEPENDENT with the reason.
//
// INDEPENDENT lists the copies kept apart on purpose, never pinned; ONE_SIDED
// the limits checked for a counterpart that the other language does not hold.
//
// The Python values come from importing this checkout's package with the
// replay project's interpreter (globalSetup.ts), hence the replay project; a
// TypeScript module's own constant, which it does not export, is read off its
// source. No dev case is built, no model or API is called.

import { beforeAll, describe, expect, it } from "vitest";

import { ORIGIN_EXCLUDED } from "../../components/dpdfLevels";
import { FORMS, kVectors, MAX_ORDER, MODULATION_DEFAULTS } from "../../state/modulation";
import { STAGES, usePipelineStore } from "../../state/pipelineStore";
import { bridgeConfig, nodeModules } from "../evals/devData/bridgeWorker";
import { GRID_TOO_COARSE, isTooCoarse } from "../metrics/coarse";
import { OPEN_WEIGHT_OK } from "../metrics/coverage";
import { FLATTEN_FIT_Q, FULL_SHELL } from "../metrics/flatten";
import { percentile, radialFloorShells, type GridSlice } from "../metrics/sliceStats";
import { FILL_BIAS_FLOOR, FILL_BIAS_MIN_HOLES, FILL_BIAS_MIN_SIGMA, FILL_BIAS_ONE_WAY, RIM, roomForRims } from "../metrics/texture";
import { joinPath } from "../skills";
import { SAMPLE_PARAMS, TUNE_PARAMS, TUNE_STAGES, type SampleParam, type TuneParam } from "../tune/catalog";
import { UB_TURNED, WORDS } from "../verdicts/rules";

// ---------------------------------------------------------------- the TypeScript side

/** Modules whose own constants are read off their source. */
const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>(["../metrics/texture.ts"], {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  ).map(([k, v]) => [joinPath("web/src/llm/__tests__", k), v]),
);

/** The number(s) `pattern` captures in a module's source; it must hold the pattern. */
function written(path: string, pattern: RegExp): number[] {
  const m = pattern.exec(SOURCES[path] ?? "");
  if (!m) throw new Error(`${path} no longer reads ${pattern}: find where it holds the limit now and update this pin`);
  return m.slice(1).map(Number);
}

const TEXTURE = "web/src/llm/metrics/texture.ts";

/** Where a rule's answer changes: false at lo, true at hi (skillLint.test.ts's). */
function boundary(pred: (x: number) => boolean, lo: number, hi: number): number {
  if (pred(lo) || !pred(hi)) throw new Error(`no boundary between ${lo} and ${hi}`);
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (pred(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** A cut of `n` × 1 voxels on an axis over ±1 r.l.u., the values given. */
const cutOf = (n: number, values: number[] = Array.from({ length: n }, (_v, i) => i)): GridSlice => {
  const axis = Array.from({ length: n }, (_v, i) => -1 + (2 * i) / (n - 1));
  return { header: { nx: n, ny: 1, x_axis: axis, y_axis: axis }, data: Float32Array.from(values) } as GridSlice;
};

// The cases the room-for-rims rule is compared on (#60): the holes' reaches
// and the points over ±1 r.l.u. (10, 20, 8 and 7 voxels between nodes), the
// rule's boundary (a need of 10 on a spacing of 10) and the singular among them.
const ROOM_CASES: [reaches: number[], points: number][] = [
  [[3], 21],
  [[3], 41],
  [[1, 1, 2], 21],
  [[1], 17],
  [[2, 3, 4, 5], 21],
  [[3], 15],
];

// ---------------------------------------------------------------- the Python side

/**
 * The page's default for each setting the tuning and update_settings name
 * (tune/catalog.ts, "what a blank field means"), as the package's
 * PipelineParams holds it: a Python expression over `p = PipelineParams()`,
 * written as the TypeScript side reads it. ringNFourier is INDEPENDENT.
 */
const BACKEND_DEFAULT: Record<string, string> = {
  ringModel: "p.rings.ring_model",
  ringPooledSectors: "p.rings.pooled_sectors",
  ringPooledWindow: "p.rings.pooled_window_deg",
  ringGlobalSubtraction: "p.rings.global_subtraction",
  punchMinSig: "p.punch.min_significance",
  punchMode: "p.punch.mode",
  punchHGuard: "p.punch.integer_h_guard_hkl",
  // The page's floor sets both (server/params.py): they must be one value.
  punchSearchFloor: "p.punch.search_min_intensity if p.punch.search_min_intensity == p.punch.search_min_prominence else None",
  punchFootprint: "p.punch.punch_footprint",
  punchProfileNSigma: "p.punch.profile_n_sigma",
  // Off: None in the package, 0 on the page (server/params.py maps 0 to None).
  punchSearchMaxWidth: "p.punch.search_max_width_ratio or 0",
  punchMargin: "p.punch.margin",
  punchFitUnconstrained: "p.punch.integer_fit_unconstrained",
  backfillMethod: "p.backfill.method",
  flattenQ2: "p.flatten.q2_term",
  flattenFitQMax: "p.flatten.fit_q_range[1]",
  flattenEstimator: "p.flatten.estimator",
  pdfApod: "p.delta_pdf.apodization",
  pdfWindowShape: "p.delta_pdf.window_shape",
  pdfWindowSupport: "p.delta_pdf.window_support",
  // The sample's facts. The modulation's blank declaration is the backend's own
  // (state/modulation.ts names none of it): its fields' defaults are pinned below.
  punchSupercellH: "p.punch.supercell[0]",
  punchSupercellK: "p.punch.supercell[1]",
  punchSupercellL: "p.punch.supercell[2]",
};

/** A catalog default as the Python expression above reads it: a setting's, or a fact's as a blank form shows it. */
const pageDefault = (param: TuneParam | SampleParam): unknown =>
  "defaultValue" in param ? param.defaultValue : param.read(usePipelineStore.getInitialState());

const SCRIPT = String.raw`
import dataclasses, inspect, json, sys
import numpy as np
from nebula3d import modulation, pipeline
from nebula3d.analysis import bragg_fill_texture as ft, coverage, dpdf_features, ub_refine
from nebula3d.analysis.delta_pdf import _prepare_forward, compute_delta_pdf
from nebula3d.preprocessing import ring_isotropy
from nebula3d.server import tuning

args = json.loads(sys.argv[1])
p = pipeline.PipelineParams()
iso = ring_isotropy.IsotropyConfig()

def default(fn, name):
    return inspect.signature(fn).parameters[name].default

def reads_k(text):
    try:
        return modulation.Modulation.parse({"k": text}) is not None
    except ValueError:
        return False

def too_coarse(reach, n):
    axis = np.linspace(-1.0, 1.0, n)
    blank = {f.name: None for f in dataclasses.fields(ft.HoleTexture)}
    holes = ft.HoleTexture(**{**blank, "voxels": np.arange(len(reach)), "reach": np.asarray(reach, float),
                              "rim": ft.RIM, "node_spacing": ft.node_spacing((axis, axis))})
    return holes.too_coarse

print(json.dumps({
    "support_tol": default(compute_delta_pdf, "support_tol"),
    "prepare_support_tol": default(_prepare_forward, "support_tol"),
    "fill": {k: default(ft.fill_texture, k) for k in ("rim", "min_rim", "min_sigma", "one_way", "min_holes", "floor")},
    "fill_constants": {"rim": ft.RIM, "min_rim": ft.MIN_RIM_VOXELS, "min_sigma": ft.MIN_SIGMA, "one_way": ft.ONE_WAY,
                       "min_holes": ft.MIN_HOLES, "floor": ft.FILL_BIAS_FLOOR},
    "room": [too_coarse(reach, n) for reach, n in args["room"]],
    "node_test_reason": ft.NODE_TEST_TOO_COARSE,
    "grid_too_coarse": ring_isotropy.GRID_TOO_COARSE,
    "height_share": iso.height_share,
    "direction_share": iso.direction_share,
    "ub_turn": ub_refine.UB_TURN,
    "fit_q_range": list(p.flatten.fit_q_range),
    "floor_percentile": p.flatten.floor_percentile,
    "min_count": p.flatten.min_count,
    "coverage_full": coverage.FULL,
    "origin_excluded": dpdf_features.ORIGIN_EXCLUDED,
    "stages": list(pipeline.STAGES),
    "tune_stages": list(tuning.TUNE_STAGES),
    "defaults": {k: eval(expr, {"p": p}) for k, expr in args["defaults"].items()},
    "modulation": {
        "defaults": {f.name: f.default for f in dataclasses.fields(modulation.Modulation) if f.name in ("order", "form", "half_width")},
        "half_width": modulation.HALF_WIDTH,
        "max_order": modulation.MAX_ORDER,
        "forms": list(modulation.FORMS),
        "reads_k": [reads_k(t) for t in args["k_texts"]],
    },
}))
`;

/** k as people write it, read by both sides (Modulation.parse; state/modulation.ts kVectors). */
const K_TEXTS = [
  "1/3, 0, 0",
  "(1/3,0,0)",
  "[0.2, 0, 1/2]",
  "1/3 0 0; ⟨0 1/3 0⟩",
  "−1/3, 0, 0",
  "1e-1, 0, 0",
  "0.3333, 0, 0",
  "1/3,,0,0",
  "thirds",
  "1/3, 0",
  "1/3, 0, 0, 0",
  "1/0, 0, 0",
  "0, 0, 0",
  "0/3, 0, 0",
  "1/3, 0, 0; 0, 0, 0",
  "1/3, x, 0",
];

type Py = {
  support_tol: number;
  prepare_support_tol: number;
  fill: Record<"rim" | "min_rim" | "min_sigma" | "one_way" | "min_holes" | "floor", number>;
  fill_constants: Record<"rim" | "min_rim" | "min_sigma" | "one_way" | "min_holes" | "floor", number>;
  room: (string | null)[];
  node_test_reason: string;
  grid_too_coarse: string;
  height_share: number;
  direction_share: number;
  ub_turn: number;
  fit_q_range: [number, number];
  floor_percentile: number;
  min_count: number;
  coverage_full: number;
  origin_excluded: number;
  stages: string[];
  tune_stages: string[];
  defaults: Record<string, unknown>;
  modulation: { defaults: Record<"order" | "form" | "half_width", unknown>; half_width: number; max_order: number; forms: string[]; reads_k: boolean[] };
};

let py: Py;

beforeAll(async () => {
  const node = await nodeModules();
  const { python, src } = bridgeConfig();
  const env = { ...node.env, PYTHONPATH: [src, node.env.PYTHONPATH].filter(Boolean).join(node.delimiter), MPLBACKEND: "Agg" };
  const run = node.spawnSync(python, ["-c", SCRIPT, JSON.stringify({ room: ROOM_CASES, defaults: BACKEND_DEFAULT, k_texts: K_TEXTS })], { env, encoding: "utf8" });
  if (run.error || run.status !== 0) throw new Error(`${python} could not read the package's limits: ${run.error?.message ?? run.stderr}`);
  py = JSON.parse(run.stdout) as Py;
});

// ---------------------------------------------------------------- the pins

/** One shared limit: where each side holds it, and its value there. */
interface Pin {
  name: string;
  ts: string;
  py: string;
  values: () => [ts: unknown, python: unknown];
}

const PINS: Pin[] = [
  {
    name: "the window's weight on unmeasured space (1e-3)",
    ts: "OPEN_WEIGHT_OK, metrics/coverage.ts",
    py: "support_tol, nebula3d.analysis.delta_pdf.compute_delta_pdf (and _prepare_forward)",
    values: () => [[OPEN_WEIGHT_OK, OPEN_WEIGHT_OK], [py.support_tol, py.prepare_support_tol]],
  },
  {
    name: "the fill bias's floor, a share of the local diffuse level",
    ts: "FILL_BIAS_FLOOR, metrics/texture.ts",
    py: "FILL_BIAS_FLOOR and fill_texture(floor=), nebula3d.analysis.bragg_fill_texture",
    values: () => [[FILL_BIAS_FLOOR, FILL_BIAS_FLOOR], [py.fill_constants.floor, py.fill.floor]],
  },
  {
    name: "the fill's rim depth, in voxels",
    ts: "RIM, metrics/texture.ts",
    py: "RIM and fill_texture(rim=)",
    values: () => [[RIM, RIM], [py.fill_constants.rim, py.fill.rim]],
  },
  {
    name: "the fewest rim voxels a hole is judged on",
    ts: "holeBias's `rimV.length < 8`, metrics/texture.ts",
    py: "MIN_RIM_VOXELS and fill_texture(min_rim=)",
    values: () => {
      const [n] = written(TEXTURE, /rimV\.length < ([0-9]+)/);
      return [[n, n], [py.fill_constants.min_rim, py.fill.min_rim]];
    },
  },
  // The TypeScript names them since 4.2's TypeScript half (FILL_BIAS_LIMITS, the
  // limits it sends the backend's 3-D texture and checks it was judged by).
  {
    name: "a systematic fill bias's median, in the rim's σ",
    ts: "FILL_BIAS_MIN_SIGMA, metrics/texture.ts",
    py: "MIN_SIGMA and fill_texture(min_sigma=)",
    values: () => [[FILL_BIAS_MIN_SIGMA, FILL_BIAS_MIN_SIGMA], [py.fill_constants.min_sigma, py.fill.min_sigma]],
  },
  {
    name: "a systematic fill bias's share of the holes one way",
    ts: "FILL_BIAS_ONE_WAY, metrics/texture.ts",
    py: "ONE_WAY and fill_texture(one_way=)",
    values: () => [[FILL_BIAS_ONE_WAY, FILL_BIAS_ONE_WAY], [py.fill_constants.one_way, py.fill.one_way]],
  },
  {
    name: "the fewest judged holes a systematic fill bias needs",
    ts: "FILL_BIAS_MIN_HOLES, metrics/texture.ts",
    py: "MIN_HOLES and fill_texture(min_holes=)",
    values: () => [[FILL_BIAS_MIN_HOLES, FILL_BIAS_MIN_HOLES], [py.fill_constants.min_holes, py.fill.min_holes]],
  },
  {
    name: "the fills' room for their rims, and what a grid too coarse for it says (#60)",
    ts: "roomForRims and nodeSpacing, metrics/texture.ts",
    py: "HoleTexture.too_coarse and node_spacing, nebula3d.analysis.bragg_fill_texture",
    values: () => [ROOM_CASES.map(([reaches, n]) => roomForRims(cutOf(n), reaches)), py.room],
  },
  {
    name: "how a reason the grid gives for judging nothing opens (#60)",
    ts: "GRID_TOO_COARSE, metrics/coarse.ts (isTooCoarse reads the ring test's reason by it)",
    py: "GRID_TOO_COARSE, nebula3d.preprocessing.ring_isotropy",
    values: () => [GRID_TOO_COARSE, py.grid_too_coarse],
  },
  {
    name: "the ring rule's shares, as the rings' criterion states them",
    ts: "WORDS.criterion.rings, verdicts/rules.ts: 'at least 0.15 of its median height in 90 % of directions'",
    py: "IsotropyConfig.height_share and .direction_share, nebula3d.preprocessing.ring_isotropy",
    values: () => {
      const m = /at least ([0-9.]+) of its median height in ([0-9.]+) % of directions/.exec(WORDS.criterion.rings);
      if (!m) throw new Error("the rings' criterion no longer states the ring rule's shares as this pin reads them: update the pin");
      return [[Number(m[1]), Number(m[2]) / 100], [py.height_share, py.direction_share]];
    },
  },
  {
    name: "a UB turned, in degrees",
    ts: "UB_TURN, read through UB_TURNED, verdicts/rules.ts",
    py: "UB_TURN, nebula3d.analysis.ub_refine (the regrid's threshold too)",
    values: () => [
      boundary((x) => UB_TURNED({ orientation_change_deg: x, fit: "both", symmetrised: false }), 0, 10),
      py.ub_turn,
    ],
  },
  {
    name: "the flatten's fit range in |Q|, Å⁻¹",
    ts: "FLATTEN_FIT_Q, metrics/flatten.ts; flattenFitQMax's 'from 0.8' and default, tune/catalog.ts",
    py: "FlattenParams.fit_q_range, nebula3d.pipeline",
    values: () => {
      const fitQMax = TUNE_PARAMS.find((p) => p.key === "flattenFitQMax")!;
      const from = /\(from ([0-9.]+)\)/.exec(fitQMax.help);
      return [[FLATTEN_FIT_Q, [Number(from?.[1]), fitQMax.defaultValue]], [py.fit_q_range, py.fit_q_range]];
    },
  },
  {
    name: "a shell's floor: its percentile, and the fewest voxels it is taken from",
    ts: "radialFloorShells' defaults (p, minCount), metrics/sliceStats.ts, as flattenMetrics takes them",
    py: "FlattenParams.floor_percentile and .min_count, nebula3d.pipeline (flatten_floors' FLOOR_PERCENTILE and MIN_COUNT are the same defaults)",
    values: () => {
      const values = Array.from({ length: 100 }, (_v, i) => i);
      const floor = radialFloorShells(cutOf(100, values), 1, () => 0).floors[0];
      const counted = (n: number) => Number.isFinite(radialFloorShells(cutOf(n), 1, () => 0).floors[0]);
      // The TypeScript floor of 0…99 is that percentile of them, and a shell counts from that many voxels.
      return [
        [floor, [counted(py.min_count - 1), counted(py.min_count)]],
        [percentile(values, py.floor_percentile / 100), [false, true]],
      ];
    },
  },
  // The coverage itself, its half-measured edges and their resolution (one
  // shell), is measured in Python alone and read through the adapters: only
  // the flatten's own "fully measured" share is held on both sides.
  {
    name: "a fully measured shell",
    ts: "FULL_SHELL, metrics/flatten.ts",
    py: "FULL, nebula3d.analysis.coverage",
    values: () => [FULL_SHELL, py.coverage_full],
  },
  {
    name: "the ΔPDF origin's disk, a share of the half-width",
    ts: "ORIGIN_EXCLUDED, components/dpdfLevels.ts (dpdf_contrast, and the section metrics of metrics/dpdf.ts)",
    py: "ORIGIN_EXCLUDED, nebula3d.analysis.dpdf_features (dpdf_peaks)",
    values: () => [ORIGIN_EXCLUDED, py.origin_excluded],
  },
  {
    name: "the pipeline's stages, and the tuning's",
    ts: "STAGES, state/pipelineStore.ts; TUNE_STAGES, tune/catalog.ts",
    py: "STAGES, nebula3d.pipeline; TUNE_STAGES, nebula3d.server.tuning",
    values: () => [[[...STAGES], [...TUNE_STAGES]], [py.stages, py.tune_stages]],
  },
  {
    name: "a declared modulation's blank fields, its highest order and its forms",
    ts: "MODULATION_DEFAULTS, MAX_ORDER and FORMS, state/modulation.ts (what the Pilot and the report show for a blank order, form or half width)",
    py: "Modulation's field defaults, HALF_WIDTH, MAX_ORDER and FORMS, nebula3d.modulation",
    values: () => [
      [{ order: MODULATION_DEFAULTS.order, form: MODULATION_DEFAULTS.form, half_width: MODULATION_DEFAULTS.halfWidth }, MODULATION_DEFAULTS.halfWidth, MAX_ORDER, [...FORMS]],
      [py.modulation.defaults, py.modulation.half_width, py.modulation.max_order, py.modulation.forms],
    ],
  },
  {
    name: "which k a declaration takes: the page and the Pilot refuse before a run what the backend would refuse",
    ts: "kVectors, state/modulation.ts (the Pilot's update_settings and the request's syntax)",
    py: "Modulation.parse, nebula3d.modulation",
    values: () => [Object.fromEntries(K_TEXTS.map((t) => [t, kVectors(t) !== null])), Object.fromEntries(K_TEXTS.map((t, i) => [t, py.modulation.reads_k[i]]))],
  },
  {
    name: "each setting's default: what a blank field means",
    ts: "defaultValue, TUNE_PARAMS and SAMPLE_PARAMS, tune/catalog.ts",
    py: "PipelineParams(), nebula3d.pipeline (BACKEND_DEFAULT names each field)",
    values: () => {
      const params = [...TUNE_PARAMS, ...SAMPLE_PARAMS].filter((p) => p.key in BACKEND_DEFAULT);
      return [Object.fromEntries(params.map((p) => [p.key, pageDefault(p)])), py.defaults];
    },
  },
];

/**
 * Copies of one quantity kept apart on purpose: never pinned. Each says
 * where the two sit, what they are today, and why they stay independent.
 */
const INDEPENDENT: { name: string; ts: string; py: string; why: string }[] = [
  {
    name: "the scorer's window weight (1e-3)",
    ts: "OPEN_WEIGHT_OK, metrics/coverage.ts",
    py: "TOLERANCES['open_weight'], nebula3d.validation.score",
    why: "the scorer's tolerances are fixed before any run, with their reasons, and score every arm alike; they are independent of the tools by design (score.py), so a change to a tool's limit never moves a score",
  },
  {
    name: "the scorer's rings left and diffuse kept (0.15, 0.85)",
    ts: "the ring rule's 0.15 of the height (WORDS.criterion.rings)",
    py: "TOLERANCES['ring_left'] and ['shell_kept'], nebula3d.validation.score",
    why: "the scorer's own bound on a planted ring's contrast left, a different quantity from the ring test's share of a ring's height; independent by design (score.py)",
  },
  {
    name: "the scorer's pedestal (span 0.25 from 3.5 Å⁻¹, shells 0.1 Å⁻¹)",
    ts: "PEDESTAL_LIMIT (0.8), metrics/flatten.ts; the outer half of the shells the counts reach",
    py: "TOLERANCES['pedestal_span'], PEDESTAL_Q_MIN and SHELL_STEP, nebula3d.validation.score",
    why: "the scorer measures the output against the planted truth; the flatten check sees no truth: independent by design (score.py)",
  },
  {
    name: "the grader's UB noise (0.1°)",
    ts: "the answer grader's turn below which a UB alarm is noise, evals/validation.ts (UB_NOISE_DEG, #70)",
    py: "UB_TURN (0.05°), nebula3d.analysis.ub_refine, and the app's UB_TURN",
    why: "the grader keeps its own rule until the shared answer reader (plan 3.2): verdicts/rules.ts and docs/evals.md say so (#70)",
  },
  {
    name: "a ring matched by |Q| (0.1 Å⁻¹)",
    ts: "RING_MATCH_Q, tune/evaluate.ts: the planes' bumps one shell",
    py: "RING_MATCH_Q, nebula3d.validation.arm_a: a confirmed ring that is a planted one",
    why: "one name and one value for two measures: arm A's matches its log to the case's truth, the evaluation's groups bumps into shells; arm A is the validation's baseline, kept apart from the tools",
  },
  {
    name: "the texture order of the patched and parametric ring models (8 on the page, 6 in the package)",
    ts: "ringNFourier's defaultValue, tune/catalog.ts, and the store's '8', state/pipelineStore.ts",
    py: "RingParams.n_fourier, nebula3d._ringplane",
    why: "kept apart on purpose (AGENT_PLAN 4.12); tests/test_defaults_agreed.py pins both",
  },
  {
    name: "dpdf_peaks' defaults (5 σ, 12 entries)",
    ts: "dpdf_peaks' min_sigma and limit, tools/defs/dpdf_peaks.ts",
    py: "strongest_features(min_sigma=, limit=), nebula3d.analysis.dpdf_features, and the bridge's and the server's",
    why: "each side's default for its own callers: the tool always sends both, so the package's defaults serve only its Python and HTTP callers",
  },
];

/**
 * The limits checked for a counterpart that the other language does not
 * hold: nothing to pin until it does.
 */
const ONE_SIDED: { name: string; holds: string; why: string }[] = [
  { name: "BACK_FFT_R_OK (0.999)", holds: "verdicts/rules.ts", why: "the pipeline reports the round trip's r, and judges nothing by it" },
  { name: "the pedestal's limits (PEDESTAL_LIMIT 0.8)", holds: "metrics/flatten.ts", why: "the package measures the floors (flatten_floors) and judges no pedestal; tests/test_shell_floors.py ports the rule as a test" },
  { name: "SYMMETRY_HOLDS (1e-3)", holds: "metrics/symmetry.ts", why: "the package's symmetry_break (ub_refine.SYMMETRISED, 1e-4) is another measure, of the reciprocal volume" },
  { name: "SECOND_GRAIN_DEG, NODE_TOL, BROAD_VOXELS, NOISE_MULTIPLE", holds: "metrics/grains.ts, punch.ts, rings.ts", why: "the grain check, the leftover scan and the ring residuals run in TypeScript only" },
  { name: "ub_check's unexplained offset (a quarter voxel, 0.8 of it left)", holds: "tools/defs/ub_check.ts", why: "the package fits; tests/test_faults.py ports the rule as a test" },
  { name: "the ring test's min_snr (3) and curve_share (0.25)", holds: "IsotropyConfig, nebula3d.preprocessing.ring_isotropy", why: "no TypeScript text states them (the skills' lint lists them, UNSTATED in skillLint.test.ts)" },
  { name: "SAMPLES_PER_FWHM (2) and the ring test's direction cells", holds: "nebula3d.preprocessing.ring_isotropy", why: "the TypeScript reads the test's reason (GRID_TOO_COARSE, pinned), not its limits" },
];

describe("the limits Python and TypeScript both hold", () => {
  for (const pin of PINS) {
    it(pin.name, () => {
      const [ts, python] = pin.values();
      expect(ts, `TypeScript: ${pin.ts}; Python: ${pin.py}`).toEqual(python);
    });
  }

  it("every setting the catalog defaults is pinned or independent", () => {
    const keys = [...TUNE_PARAMS, ...SAMPLE_PARAMS].map((p) => p.key as string);
    // ringNFourier is INDEPENDENT; the modulation's blank is the backend's own
    // declaration, which the TypeScript never names (its fields' defaults are pinned above).
    expect(keys.filter((k) => !(k in BACKEND_DEFAULT) && k !== "ringNFourier" && k !== "modulation")).toEqual([]);
    expect(Object.keys(BACKEND_DEFAULT).filter((k) => !keys.includes(k))).toEqual([]);
  });

  it("isTooCoarse reads the ring test's reason, as the ring check gets it", () => {
    const reason = `${py.grid_too_coarse}: 0.99 voxels across a ring's width (at most 0.16 Å⁻¹), under 1`;
    expect([isTooCoarse(reason), isTooCoarse(`not judged: ${reason}`)]).toEqual([true, true]);
    expect(py.room.filter((r): r is string => r !== null).every(isTooCoarse)).toBe(true);
  });

  it("isTooCoarse reads the 3-D texture read's reason on a grid too coarse for the punch's node test (G3)", () => {
    // nebula3d.analysis.bragg_fill_texture.NODE_TEST_TOO_COARSE: the fills are
    // not judged where the punch's record carries its node test's notice.
    expect(py.node_test_reason).toBe("grid too coarse (the punch's node test could not resolve the holes at this grid)");
    expect([isTooCoarse(py.node_test_reason), isTooCoarse(`not judged: ${py.node_test_reason}`)]).toEqual([true, true]);
  });

  it("keeps a limit pinned or independent, never both, and every entry with its reason", () => {
    const pinned = new Set(PINS.map((p) => p.name));
    expect(INDEPENDENT.filter((x) => pinned.has(x.name))).toEqual([]);
    for (const x of [...INDEPENDENT, ...ONE_SIDED]) expect(x.why.length, x.name).toBeGreaterThan(20);
  });
});
