// The skill lint: each skill (.claude/skills/<name>/SKILL.md) read against the
// code it describes. It changes no skill. It checks that
//
// 1. every tool a skill names is in the registry (CHAT_TOOLS): a name in
//    backticks, or a bare snake_case word, that looks like a tool's;
// 2. every other name in backticks is a result field or a parameter of the
//    tools its step names (of any tool, in a step that names none), a setting
//    (configure_settings), or a name in OTHER_NAMES; and each claim in CLAIMS,
//    that a step's tool gives a quantity, holds on that tool's result. A
//    tool's fields are its result's keys and the keys one level in (a stage of
//    assess_stage, the rows of a list), as each tool returns them on the
//    synthetic crystal (syntheticCrystal.ts); deeper keys, such as
//    assess_stage's per-plane breakdown, a skill names by their path
//    (`tool.stage.field`);
// 3. every number a skill writes is classified: a gate (GATES), bound to the
//    constant it must equal, imported from the code or read off the rule that
//    holds it, or marked "no constant" with a note; or not a gate (NOT_GATES).
//    And the limits in UNSTATED, which a step's tool judges by, are among that
//    step's gates.
//
// What fails today is on the allow-list (ALLOWED), each entry with why: the
// user's skill-review queue (agent plan 5.2), not something this test fixes.
// A failure that is not on it fails the lint, and so does an entry that no
// longer fails: take it off the list. A table that no longer matches the
// skill's words (a phrase gone, a number nobody classified) fails too, and is
// never allow-listed: update the table with the skill.
//
// Hermetic and synthetic: the synthetic crystal behind a mocked API, stubbed
// runs, no model, no backend, no measured data.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { JobEvent } from "../../api/types";
import { usePipelineStore } from "../../state/pipelineStore";
import { OPEN_WEIGHT_OK } from "../metrics/coverage";
import { pedestalLeft } from "../metrics/flatten";
import { SECOND_GRAIN_DEG } from "../metrics/grains";
import { SYMMETRY_HOLDS } from "../metrics/symmetry";
import { FILL_BIAS_FLOOR } from "../metrics/texture";
import { allSkills, joinPath } from "../skills";
import { callTool, CHAT_TOOLS, type ToolContext } from "../tools";
import { TUNE_STAGES } from "../tune/catalog";
import { outOfBounds } from "../tune/evaluate";
import { useTuneStore } from "../tune/tuner";
import { BACK_FFT_R_OK, UB_TURNED } from "../verdicts/rules";
import { DATASET, DATASETS, freshConsole, installBackend } from "./syntheticCrystal";

const api = vi.hoisted(() => ({
  fetchBraggProfile: vi.fn(),
  fetchConsistencyCheck: vi.fn(),
  fetchDataset: vi.fn(),
  fetchDpdfFeatures: vi.fn(),
  fetchDpdfMeta: vi.fn(),
  fetchDpdfSlice: vi.fn(),
  fetchMeta: vi.fn(),
  fetchRingDiagnostics: vi.fn(),
  fetchRingIsotropy: vi.fn(),
  fetchShellFloors: vi.fn(),
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

type SkillName = "reduction-qc" | "bragg-node-audit" | "delta-pdf-interpretation";
const SKILL_NAMES: readonly SkillName[] = ["bragg-node-audit", "delta-pdf-interpretation", "reduction-qc"];

// ---------------------------------------------------------------- the code's limits

/** A limit in the code a skill's number must equal: what holds it, and its value. */
interface Limit {
  constant: string;
  value: number;
}

/** Files read as text: a limit held in Python, or in a constant its module does not export, and what the skills name. */
const SOURCES = repoKeyed(
  import.meta.glob(
    ["../../../../src/nebula3d/preprocessing/ring_isotropy.py", "../../../../src/nebula3d/server/tuning.py", "../metrics/rings.ts", "../../api/types.ts"],
    { query: "?raw", import: "default", eager: true },
  ),
);
/** The repository's files a skill may name (listed, not read). */
const REPO_FILES = new Set(
  Object.keys(
    repoKeyed(import.meta.glob(["../../../../docs/*.md", "../../../../examples/*.py", "../../../../src/nebula3d/*.py"], { query: "?raw", import: "default" })),
  ),
);

function repoKeyed<T>(files: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [joinPath("web/src/llm/__tests__", k), v]));
}

function source(path: string): string {
  const text = SOURCES[path];
  if (typeof text !== "string") throw new Error(`${path} is not among the lint's sources`);
  return text;
}

/** A Python dataclass field's default, read off its source. */
function pyDefault(path: string, cls: string, field: string): number {
  const text = source(path);
  const start = text.indexOf(`class ${cls}`);
  const rest = start < 0 ? "" : text.slice(start);
  const end = rest.indexOf("\nclass ", 1);
  const body = end > 0 ? rest.slice(0, end) : rest;
  const m = new RegExp(`^\\s+${field}\\s*:[^=\\n]*=\\s*([-+0-9._eE]+)`, "m").exec(body);
  if (!m) throw new Error(`no default for ${cls}.${field} in ${path}`);
  return Number(m[1].replace(/_/g, ""));
}

/** A TypeScript module's own constant, read off its source (one the module does not export). */
function tsConst(path: string, name: string): number {
  const m = new RegExp(`\\bconst ${name}\\s*(?::[^=]+)?=\\s*([-+0-9._eE]+)\\s*;`).exec(source(path));
  if (!m) throw new Error(`no constant ${name} in ${path}`);
  return Number(m[1]);
}

/**
 * Where an exported rule changes its answer: the limit written inside it as a
 * literal. `pred` is false at `lo`, true at `hi`, and changes once between.
 */
function boundary(pred: (x: number) => boolean, lo: number, hi: number): number {
  if (pred(lo) || !pred(hi)) throw new Error(`no boundary between ${lo} and ${hi}`);
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (pred(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

const RING_ISOTROPY = "src/nebula3d/preprocessing/ring_isotropy.py";

const LIMITS = {
  openWeight: { constant: "OPEN_WEIGHT_OK (metrics/coverage.ts)", value: OPEN_WEIGHT_OK },
  tuningWeight: {
    constant: "the tuning's limit, outOfBounds (tune/evaluate.ts), by the ΔPDF's rule",
    value: boundary((w) => outOfBounds("pdf", { window_weight_on_unmeasured: w }) !== null, 0, 1),
  },
  symmetryHolds: { constant: "SYMMETRY_HOLDS (metrics/symmetry.ts)", value: SYMMETRY_HOLDS },
  ringHeight: { constant: `IsotropyConfig.height_share (${RING_ISOTROPY})`, value: pyDefault(RING_ISOTROPY, "IsotropyConfig", "height_share") },
  ringDirections: { constant: `IsotropyConfig.direction_share (${RING_ISOTROPY})`, value: pyDefault(RING_ISOTROPY, "IsotropyConfig", "direction_share") },
  ringSnr: { constant: `IsotropyConfig.min_snr (${RING_ISOTROPY})`, value: pyDefault(RING_ISOTROPY, "IsotropyConfig", "min_snr") },
  ringCurve: { constant: `IsotropyConfig.curve_share (${RING_ISOTROPY})`, value: pyDefault(RING_ISOTROPY, "IsotropyConfig", "curve_share") },
  ringNoise: { constant: "NOISE_MULTIPLE (metrics/rings.ts)", value: tsConst("web/src/llm/metrics/rings.ts", "NOISE_MULTIPLE") },
  pedestalTrend: { constant: "pedestalLeft's trend limit (metrics/flatten.ts)", value: boundary((t) => pedestalLeft(t, 10) === true, 0, 1) },
  pedestalSpan: { constant: "pedestalLeft's span limit (metrics/flatten.ts)", value: boundary((s) => pedestalLeft(1, s) === true, 0, 10) },
  secondGrain: { constant: "SECOND_GRAIN_DEG (metrics/grains.ts)", value: SECOND_GRAIN_DEG },
  fillBiasFloor: { constant: "FILL_BIAS_FLOOR (metrics/texture.ts)", value: FILL_BIAS_FLOOR },
  backFftR: { constant: "BACK_FFT_R_OK (verdicts/rules.ts)", value: BACK_FFT_R_OK },
  ubTurn: {
    constant: "UB_TURN, read through UB_TURNED (verdicts/rules.ts)",
    value: boundary((x) => UB_TURNED({ orientation_change_deg: x, fit: "both", symmetrised: false }), 0, 10),
  },
} satisfies Record<string, Limit>;

const same = (a: number, b: number): boolean => a === b || Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b));

// ---------------------------------------------------------------- the tables

/**
 * A gate: a number a skill states as a threshold, a limit or a gate, in its
 * words (`phrase`, which holds it), and the limit in the code it must equal;
 * or `none`, with a note, where the code holds no constant for it.
 */
type Gate = { skill: SkillName; phrase: string; stated: number | null } & ({ limit: Limit } | { none: string });

const GATES: Gate[] = [
  // reduction-qc
  { skill: "reduction-qc", phrase: "the UB turned at 0.05° or more", stated: 0.05, limit: LIMITS.ubTurn },
  { skill: "reduction-qc", phrase: "up to about 1e-3 is clean", stated: 1e-3, limit: LIMITS.openWeight },
  { skill: "reduction-qc", phrase: "at least 0.15 of its median height", stated: 0.15, limit: LIMITS.ringHeight },
  { skill: "reduction-qc", phrase: "in 90 % of the directions", stated: 0.9, limit: LIMITS.ringDirections },
  { skill: "reduction-qc", phrase: "three times its noise above its flanks", stated: 3, limit: LIMITS.ringSnr },
  { skill: "reduction-qc", phrase: "a quarter of its height above a curve", stated: 0.25, limit: LIMITS.ringCurve },
  { skill: "reduction-qc", phrase: "beyond three times its plane's noise", stated: 3, limit: LIMITS.ringNoise },
  { skill: "reduction-qc", phrase: "holds to about 1e-3 or better", stated: 1e-3, limit: LIMITS.symmetryHolds },
  { skill: "reduction-qc", phrase: "more than 1e-3 of its weight on unmeasured space", stated: 1e-3, limit: LIMITS.tuningWeight },
  { skill: "reduction-qc", phrase: "a trend and a span both 0.8 or more", stated: 0.8, limit: LIMITS.pedestalTrend },
  { skill: "reduction-qc", phrase: "a trend and a span both 0.8 or more", stated: 0.8, limit: LIMITS.pedestalSpan },
  {
    skill: "reduction-qc",
    phrase: "the outer half of the shells the counts reach",
    stated: 0.5,
    none: "the judged range, not a line: the flatten's verdict reads the floors on the outer half of the shells the counts reach (judgedShells, metrics/flatten.ts), a fraction written in its code with no named constant (batch 1's provisional range; interview R10).",
  },
  // bragg-node-audit
  { skill: "bragg-node-audit", phrase: "A rotation under 2°", stated: 2, limit: LIMITS.secondGrain },
  {
    skill: "bragg-node-audit",
    phrase: "several Bragg widths broad",
    stated: null,
    none: "'several' names no number. The search's width limit (punchSearchMaxWidth) is off by default and its help suggests 2 Bragg widths; the punch's evaluation calls a leftover broad at a FWHM of 5 voxels or more (BROAD_VOXELS, a constant metrics/punch.ts keeps to itself). Interview B7.",
  },
  { skill: "bragg-node-audit", phrase: "a fifth of the local diffuse level", stated: 0.2, limit: LIMITS.fillBiasFloor },
  {
    skill: "bragg-node-audit",
    phrase: "an azimuthal ratio near 1",
    stated: 1,
    none: "texture_check reports azimuthal_ratio, and no rule judges it: the texture rule reads systematic_fill_bias only (verdicts/rules.ts). Interview B12.",
  },
  // delta-pdf-interpretation
  { skill: "delta-pdf-interpretation", phrase: "unmeasured space up to about 1e-3", stated: 1e-3, limit: LIMITS.openWeight },
  { skill: "delta-pdf-interpretation", phrase: "holds to about 1e-3 or better", stated: 1e-3, limit: LIMITS.symmetryHolds },
  { skill: "delta-pdf-interpretation", phrase: "a back-FFT r of 0.999 or more only shows the transform ran correctly", stated: 0.999, limit: LIMITS.backFftR },
  { skill: "delta-pdf-interpretation", phrase: "more than 1e-3 of its weight on unmeasured space", stated: 1e-3, limit: LIMITS.tuningWeight },
];

/** Numbers that are no gate: counts, positions, examples. */
const NOT_GATES: { skill: SkillName; phrase: string; why: string }[] = [
  { skill: "reduction-qc", phrase: "all three on a cubic cell", why: "the planes a cubic cell's symmetry makes equivalent" },
  { skill: "reduction-qc", phrase: "on all three planes", why: "the planes a cubic crystal's diffuse shows on" },
  { skill: "reduction-qc", phrase: "the opening cut at L = 0", why: "a cut's position" },
  { skill: "bragg-node-audit", phrase: "out of all three", why: "the three kinds of node the audit checks" },
  { skill: "bragg-node-audit", phrase: "The punch on three planes", why: "the planes assess_stage measures" },
  { skill: "bragg-node-audit", phrase: "has several causes", why: "a count of causes" },  { skill: "bragg-node-audit", phrase: "on three planes and an off-zero cut", why: "the cuts the checklist asks for" },
  { skill: "bragg-node-audit", phrase: "the opening cut at L = 0", why: "a cut's position" },
  { skill: "delta-pdf-interpretation", phrase: "the two sites'", why: "a pair's two sites" },
  { skill: "delta-pdf-interpretation", phrase: "a = 4.2 Å", why: "an example: the demo volume's cell" },
  { skill: "delta-pdf-interpretation", phrase: "⟨½ ½ 0⟩a", why: "an example vector" },
  { skill: "delta-pdf-interpretation", phrase: "⟨1 ½ ½⟩a and ⟨2 0 0⟩a", why: "example vectors" },
  { skill: "delta-pdf-interpretation", phrase: "each (001) layer", why: "an example plane" },
  { skill: "delta-pdf-interpretation", phrase: "the z = 0 plane", why: "an example plane" },
  { skill: "delta-pdf-interpretation", phrase: "gives all three", why: "the three quantities dpdf_peaks gives: a feature's vector, sign and size" },
  { skill: "reduction-qc", phrase: "from 0.025 to 0.066 to 0.107", why: "evidence, not a line: what the Q² term did to the scored pedestal span on the validation's clean controls (batch 1, finding 5)" },
  { skill: "delta-pdf-interpretation", phrase: "Taking a back-FFT r near 1 as proof", why: "a failure mode quoting trust check 4, whose gate is in GATES" },
];

/**
 * The limits a step's tool judges by, which the step should state among its
 * gates. Which numbers a skill states is the user's call (interview X3, agent
 * plan 5.3): each entry is a question for the review, and one the user
 * declines leaves this table with the decision noted.
 */
const UNSTATED: { skill: SkillName; step: string; tool: string; limit: Limit; words: string }[] = [
  { skill: "reduction-qc", step: "**The UB.**", tool: "ub_check", limit: LIMITS.ubTurn, words: "a turn of 0.05° or more from an unsymmetrised fit is a UB turned (D4)" },
  { skill: "reduction-qc", step: "**Powder rings.**", tool: "assess_stage", limit: LIMITS.ringSnr, words: "a ring's height three times its noise" },
  { skill: "reduction-qc", step: "**Powder rings.**", tool: "assess_stage", limit: LIMITS.ringCurve, words: "a quarter of the height above a curve through the flanks" },
  { skill: "reduction-qc", step: "**Powder rings.**", tool: "assess_stage", limit: LIMITS.ringNoise, words: "a leftover or a dent counts beyond three times its plane's noise" },
  { skill: "reduction-qc", step: "**The flatten floor.**", tool: "assess_stage", limit: LIMITS.pedestalTrend, words: "a pedestal: a floor trend of 0.8 or more" },
  { skill: "reduction-qc", step: "**The flatten floor.**", tool: "assess_stage", limit: LIMITS.pedestalSpan, words: "a pedestal: a span of 0.8 or more of the diffuse level" },
  { skill: "bragg-node-audit", step: "**The backfill.**", tool: "texture_check", limit: LIMITS.fillBiasFloor, words: "a fill bias counts at a fifth of the local diffuse level" },
];

// Field names a tool could give the symmetry a file declares under.
const SYMMETRY_FIELDS = ["symmetry", "symmetry_declared", "declared_symmetry", "symmetry_from", "point_group"];

/**
 * A skill's claim that the tools its step names give a quantity (`what`, in
 * the words of `phrase`): one of `fields` is in one of those tools' results.
 * A field with a dot is a path into the result.
 */
const CLAIMS: { skill: SkillName; phrase: string; what: string; fields: string[] }[] = [
  // reduction-qc
  { skill: "reduction-qc", phrase: "the stages on disk", what: "the stages on disk", fields: ["stages"] },
  { skill: "reduction-qc", phrase: "the reciprocal grid and its range", what: "the reciprocal grid", fields: ["reciprocal.grid"] },
  { skill: "reduction-qc", phrase: "the reciprocal grid and its range", what: "the reciprocal grid's range", fields: ["reciprocal.H"] },
  { skill: "reduction-qc", phrase: "its range, and the cell", what: "the cell", fields: ["cell"] },
  { skill: "reduction-qc", phrase: "and the symmetry the file declares", what: "the symmetry the file declares", fields: SYMMETRY_FIELDS },
  { skill: "reduction-qc", phrase: "Note whether the volume is symmetrised", what: "whether the volume is symmetrised", fields: ["symmetrised"] },
  { skill: "reduction-qc", phrase: "with the punch cell as the Bragg nodes", what: "the Bragg nodes it fits", fields: ["bragg_nodes_every"] },
  { skill: "reduction-qc", phrase: "only the changes that commute with the symmetry operations can be fitted", what: "whether only the symmetric part was fitted", fields: ["fit", "symmetrised"] },
  { skill: "reduction-qc", phrase: "Read the radial offsets by |Q| band and direction", what: "the radial offsets by |Q| band and direction", fields: ["radial.direction"] },
  { skill: "reduction-qc", phrase: "the share of the transform window's weight on unmeasured space", what: "the window's weight on unmeasured space", fields: ["window_weight_on_unmeasured"] },
  { skill: "reduction-qc", phrase: "`assess_stage` for the rings", what: "the rings' assessment", fields: ["rings"] },
  { skill: "reduction-qc", phrase: "`assess_stage` for the flatten", what: "the flatten's assessment", fields: ["flatten"] },
  { skill: "reduction-qc", phrase: "a span small against the diffuse level", what: "the floors' span against the diffuse level", fields: ["flatten.floor_span_fraction"] },
  { skill: "reduction-qc", phrase: "An operation the data were symmetrised with holds", what: "each operation's difference", fields: ["ops.rms_difference"] },
  { skill: "reduction-qc", phrase: "fits only the symmetric part of the UB on a symmetrised volume", what: "which part of the UB was fitted", fields: ["fit"] },
  // bragg-node-audit
  { skill: "bragg-node-audit", phrase: "the cell, the symmetry the file declares", what: "the cell", fields: ["cell"] },
  { skill: "bragg-node-audit", phrase: "the cell, the symmetry the file declares", what: "the symmetry the file declares", fields: SYMMETRY_FIELDS },
  { skill: "bragg-node-audit", phrase: "the punch cell (", what: "the punch cell", fields: ["settings.punchSupercellH"] },
  { skill: "bragg-node-audit", phrase: "the search's protected H planes", what: "the search's protected H planes", fields: ["settings.punchProtectH"] },
  { skill: "bragg-node-audit", phrase: "`assess_stage` for the punch", what: "the punch's assessment", fields: ["punch"] },
  { skill: "bragg-node-audit", phrase: "check an off-zero cut too", what: "the peaks left at nodes on an off-zero cut", fields: ["bragg_punch_leftover.n_at_nodes"] },
  { skill: "bragg-node-audit", phrase: "the peaks left at nodes", what: "the peaks left at nodes", fields: ["punch.leftover_at_nodes"] },
  { skill: "bragg-node-audit", phrase: "the sharp peaks off the lattice", what: "the sharp peaks off the lattice", fields: ["punch.leftover_off_lattice_sharp"] },
  { skill: "bragg-node-audit", phrase: "the broad maxima kept", what: "the broad maxima kept", fields: ["punch.leftover_off_lattice_broad"] },
  { skill: "bragg-node-audit", phrase: "how much was punched to get there", what: "how much was punched", fields: ["punch.mean_punched_fraction"] },
  { skill: "bragg-node-audit", phrase: "grouped into symmetry orbits", what: "the off-lattice orbits", fields: ["off_lattice_orbits"] },
  { skill: "bragg-node-audit", phrase: "tested against the nodes", what: "the orbits beside the nodes", fields: ["near_bragg_nodes"] },
  { skill: "bragg-node-audit", phrase: "as a rotated copy of the lattice", what: "the rotated copy", fields: ["rotated_copy.indexed"] },
  { skill: "bragg-node-audit", phrase: "the same search at random directions", what: "the random directions' control", fields: ["random_control"] },
  {
    skill: "bragg-node-audit",
    phrase: "no cut whose fills sit systematically outside the range their rims allow",
    what: "whether a cut's fills sit systematically outside their rims' range",
    fields: ["per_cut.systematic_fill_bias"],
  },
  { skill: "bragg-node-audit", phrase: "an azimuthal ratio near 1", what: "the azimuthal ratio", fields: ["per_cut.azimuthal_ratio"] },
  // delta-pdf-interpretation
  // Trust check 1 reads the settings that made the ΔPDF on disk: not the next run's (configure_settings, settings.*).
  { skill: "delta-pdf-interpretation", phrase: "the window's shape and scale", what: "the window's shape", fields: ["window_shape"] },
  { skill: "delta-pdf-interpretation", phrase: "the window's shape and scale", what: "the window's scale", fields: ["window_scale"] },
  { skill: "delta-pdf-interpretation", phrase: "`consistency_details`: the |Q| band", what: "the |Q| band", fields: ["q_band"] },
  { skill: "delta-pdf-interpretation", phrase: "the symmetry used", what: "the symmetry used", fields: SYMMETRY_FIELDS },
  { skill: "delta-pdf-interpretation", phrase: "`qmax_coverage`: the window's weight on unmeasured space", what: "the window's weight on unmeasured space", fields: ["window_weight_on_unmeasured"] },
  { skill: "delta-pdf-interpretation", phrase: "the band inside the raw counts' edges", what: "the raw counts' edges", fields: ["raw_counts.q_max_edge"] },
  { skill: "delta-pdf-interpretation", phrase: "each one the data were symmetrised with holds", what: "each operation's difference", fields: ["ops.rms_difference"] },
  { skill: "delta-pdf-interpretation", phrase: "`assess_stage` for the ΔPDF", what: "the ΔPDF's assessment", fields: ["pdf"] },
  { skill: "delta-pdf-interpretation", phrase: "a back-FFT r of 0.999 or more only shows", what: "the back-FFT r against the even part", fields: ["pdf.back_fft_pearson_r_even", "pearson_r_even"] },
  { skill: "delta-pdf-interpretation", phrase: "the range is set from the sections", what: "the colour range", fields: ["applied.limit"] },
  {
    skill: "delta-pdf-interpretation",
    phrase: "its vector in Å and in lattice units, its sign, its size",
    what: "a feature's vector, sign and size",
    fields: ["features.vectors_A", "features.sign", "features.size_sigma"],
  },
];

/** Names in backticks that are no tool, field, parameter or setting, and how each is checked. */
const OTHER_NAMES: { name: string; what: string; holds: () => boolean }[] = [
  { name: "docs/SKILL_INTERVIEWS.md", what: "the interview guide", holds: () => REPO_FILES.has("docs/SKILL_INTERVIEWS.md") },
  { name: "examples/refine_ub.py", what: "the UB refinement example", holds: () => REPO_FILES.has("examples/refine_ub.py") },
  { name: "nebula3d.demo", what: "the demo volume's module", holds: () => REPO_FILES.has("src/nebula3d/demo.py") },
  { name: "processed/", what: "a dataset's outputs, which tuning never writes", holds: () => source("src/nebula3d/server/tuning.py").includes("``processed/``") },
  { name: "edge_trim", what: "the pipeline's edge trim, a run parameter", holds: () => /\bedge_trim\?:/.test(source("web/src/api/types.ts")) },
  { name: "+ b·Q²", what: "the flatten's Q² term, as a formula (flattenQ2)", holds: () => true },
  { name: "b·Q²", what: "the flatten's Q² term, as a formula (flattenQ2)", holds: () => true },
];

// ---------------------------------------------------------------- the allow-list

type Kind = "tool" | "field" | "setting" | "name" | "claim" | "gate" | "unstated";

/**
 * Today's failures: the user's skill-review queue (agent plan 5.2). Each says
 * what the skill names and why it fails. Fix the skill (with the user), then
 * take the entry off: the lint fails while an entry no longer fails.
 */
const ALLOWED: { skill: SkillName; kind: Kind; names: string; why: string }[] = [];

// ---------------------------------------------------------------- the skills, in units

/** A step, a bullet, a paragraph or a heading of a skill: the scope a name is read in. */
interface Unit {
  skill: SkillName;
  where: string; // for the messages
  text: string; // whitespace collapsed, list markers and link targets dropped
  ticks: string[]; // the names in backticks
  words: string[]; // the bare snake_case words
  tools: string[]; // the registry's tools it names
}

const TOOL_NAMES = new Set(CHAT_TOOLS.map((t) => t.name));
const SNAKE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

function unitsOf(name: SkillName): Unit[] {
  const skill = allSkills().find((s) => s.name === name);
  if (!skill) throw new Error(`no skill ${name}`);
  const blocks: { section: string; lines: string[] }[] = [{ section: "description", lines: [skill.description] }];
  let section = "introduction";
  let open: { section: string; lines: string[] } | null = null;
  let blank = false;
  for (const line of skill.body.split("\n")) {
    if (!line.trim()) {
      blank = true;
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      section = heading[1].trim();
      blocks.push({ section, lines: [line.replace(/^#+\s+/, "")] });
      open = null;
    } else if (!open || (!/^\s/.test(line) && (blank || /^(\d+\.|[-*])\s/.test(line)))) {
      open = { section, lines: [line] };
      blocks.push(open);
    } else {
      open.lines.push(line);
    }
    blank = false;
  }
  return blocks.map(({ section, lines }) => {
    const joined = lines
      .map((l) => l.replace(/^\s*(?:\d+\.|[-*])\s+(?:\[[ x]\]\s+)?/, ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    // A link keeps its label in the text; the label names a reference (skills.ts checks those), not a tool or field.
    const text = joined.replace(/\]\([^)]*\)/g, "]");
    const prose = joined.replace(/\[[^\]]*\]\([^)]*\)/g, " ");
    const item = /^(\d+)\.\s+(?:\*\*(.+?)\*\*)?/.exec(lines[0]);
    const head = item ? `${item[1]}${item[2] ? ` (${item[2]})` : ""}` : `"${text.slice(0, 50)}${text.length > 50 ? "…" : ""}"`;
    const ticks = [...prose.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
    const words = [...prose.replace(/`[^`]*`/g, " ").matchAll(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g)].map((m) => m[0]);
    const tools = [...new Set([...ticks, ...words].filter((t) => TOOL_NAMES.has(t)))];
    return { skill: name, where: `${name}, ${section} ${head}`, text, ticks, words, tools };
  });
}

const UNITS: Record<SkillName, Unit[]> = Object.fromEntries(SKILL_NAMES.map((n) => [n, unitsOf(n)])) as Record<SkillName, Unit[]>;

/** Every start of `phrase` in `text`. */
function occurrences(text: string, phrase: string): number[] {
  const at: number[] = [];
  for (let i = text.indexOf(phrase); i >= 0; i = text.indexOf(phrase, i + 1)) at.push(i);
  return at;
}

const unitsWith = (skill: SkillName, phrase: string): Unit[] => UNITS[skill].filter((u) => u.text.includes(phrase));
const countIn = (skill: SkillName, phrase: string): number => UNITS[skill].reduce((n, u) => n + occurrences(u.text, phrase).length, 0);

// ---------------------------------------------------------------- numbers in the text

interface NumberToken {
  at: number;
  end: number;
  text: string;
  value: number | null; // null: a word that names no number ("several")
}

const WORD_VALUES: Record<string, number | null> = {
  half: 0.5,
  third: 1 / 3,
  thirds: 1 / 3,
  quarter: 0.25,
  quarters: 0.25,
  fifth: 0.2,
  fifths: 0.2,
  tenth: 0.1,
  tenths: 0.1,
  twice: 2,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  several: null,
};

// A figure not inside a word (3D, h0l, 2h and flattenQ2 are no numbers), with
// its per cent; or a number written as a word.
const NUMBER = new RegExp(
  `(?<![\\w.\\/·-])(\\d+\\/\\d+|\\d+(?:\\.\\d+)?(?:e[-+]?\\d+)?)(?![\\w.]?\\w)(\\s*(?:%|per cent))?|\\b(${Object.keys(WORD_VALUES).join("|")})\\b`,
  "gi",
);

function numbersIn(text: string): NumberToken[] {
  return [...text.matchAll(NUMBER)].map((m) => {
    const at = m.index ?? 0;
    const end = at + m[0].length;
    if (m[3]) return { at, end, text: m[0], value: WORD_VALUES[m[3].toLowerCase()] };
    const [a, b] = m[1].split("/");
    const value = b !== undefined ? Number(a) / Number(b) : Number(m[1]);
    return { at, end, text: m[0], value: m[2] ? value / 100 : value };
  });
}

// ---------------------------------------------------------------- the tools' results

/** What a tool's results hold: its fields (two levels) and every path into them. */
interface Shape {
  fields: Set<string>;
  paths: Set<string>;
}

const SHAPES = new Map<string, Shape>();
const PARAMS = new Map<string, Set<string>>(CHAT_TOOLS.map((t) => [t.name, propertyNames(t.parameters)]));
let SETTINGS = new Set<string>();

function propertyNames(schema: unknown, out = new Set<string>()): Set<string> {
  if (!schema || typeof schema !== "object") return out;
  const { properties, items } = schema as { properties?: Record<string, unknown>; items?: unknown };
  for (const [k, v] of Object.entries(properties ?? {})) {
    out.add(k);
    propertyNames(v, out);
  }
  if (items) propertyNames(items, out);
  return out;
}

/** Walk a result: lists are transparent, so a list's rows give their keys one level below the list's own. */
function walk(value: unknown, prefix: string, depth: number, shape: Shape): void {
  if (Array.isArray(value)) {
    for (const v of value) walk(v, prefix, depth, shape);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [k, v] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (depth <= 2) shape.fields.add(k);
    shape.paths.add(path);
    walk(v, path, depth + 1, shape);
  }
}

const has = (tool: string, field: string): boolean => {
  const shape = SHAPES.get(tool);
  return !!shape && (field.includes(".") ? shape.paths.has(field) : shape.fields.has(field));
};

/** Where else a name is a field, or deeper down: for the messages. */
function elsewhere(name: string): string {
  const fields = CHAT_TOOLS.filter((t) => has(t.name, name)).map((t) => t.name);
  const deeper = CHAT_TOOLS.flatMap((t) => [...(SHAPES.get(t.name)?.paths ?? [])].filter((p) => p.endsWith(`.${name}`)).map((p) => `${t.name}.${p}`));
  const parts = [
    fields.length ? `a field of ${fields.join(", ")}` : "",
    deeper.length ? `deeper in ${deeper.slice(0, 3).join(", ")}${deeper.length > 3 ? ", …" : ""}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join("; ") : "in no tool's result";
}

// The tool names' first and last words: a snake_case name that shares one looks like a tool's.
const firstWord = (name: string): string => name.split("_")[0];
const lastWord = (name: string): string => name.slice(name.lastIndexOf("_") + 1);
const TOOL_WORDS = { first: new Set([...TOOL_NAMES].map(firstWord)), last: new Set([...TOOL_NAMES].map(lastWord)) };
const looksLikeTool = (name: string): boolean => SNAKE.test(name) && (TOOL_WORDS.first.has(firstWord(name)) || TOOL_WORDS.last.has(lastWord(name)));

const RUN_EVENTS: JobEvent[] = [
  { type: "progress", stage: "punch", status: "done", fraction: 1, message: "13 peaks punched" },
  { type: "progress", stage: "flatten", status: "done", fraction: 1, message: "floor fitted on 32 shells" },
];

/** One or more calls of every tool, as modelVisible.test.ts samples them; assess_stage for each stage too. */
const SAMPLES: { name: string; args: Record<string, unknown>; before?: () => void }[] = [
  { name: "read_skill", args: { name: "reduction-qc" } },
  { name: "describe_dataset", args: {} },
  { name: "current_view", args: {} },
  { name: "measure_reciprocal_cut", args: { plane: "h0l", value: 1 } },
  { name: "measure_dpdf_cut", args: { plane: "xz", value: 0 } },
  { name: "assess_stage", args: {} },
  ...TUNE_STAGES.map((stage) => ({ name: "assess_stage", args: { stage } })),
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
  { name: "run_log", args: {}, before: () => usePipelineStore.setState({ events: RUN_EVENTS, terminal: "done", running: false }) },
  { name: "compare_datasets", args: { kind: "reciprocal", plane: "hk0", value: 0 } },
  { name: "configure_settings", args: {} },
  { name: "update_settings", args: { changes: { punchMinSig: 6 } } },
  {
    name: "run_pipeline",
    args: { from_stage: "punch" },
    before: () =>
      usePipelineStore.setState({
        runStages: vi.fn(async () => {
          usePipelineStore.setState({ events: RUN_EVENTS, running: false, terminal: "done" });
          return "done";
        }),
      }),
  },
  {
    name: "tune_pipeline",
    args: { stages: ["punch"], trials_per_stage: 2 },
    before: () =>
      tuner.startTuning.mockImplementation(async () => {
        const evaluation = { leftover_at_nodes: 0, leftover_off_lattice_sharp: 0, leftover_off_lattice_broad: 2, mean_punched_fraction: 0.031 };
        useTuneStore.setState({
          active: false,
          finishedNote: "Done.",
          stages: [
            {
              stage: "punch",
              tuned: true,
              status: "done",
              best: 1,
              why: "Trial 1 met the goal.",
              trials: [{ n: 1, changes: {}, settings: {}, status: "done", evaluation }],
            },
          ],
        });
      }),
  },
  { name: "show_in_viewer", args: { view: "dpdf", plane: "xy", value: 4 } },
];

beforeAll(async () => {
  installBackend(api);
  for (const s of SAMPLES) {
    freshConsole();
    s.before?.();
    const ctx: ToolContext = { dataset: DATASET, datasets: DATASETS, skillsRead: new Set<string>(SKILL_NAMES) };
    const run = await callTool(ctx, s.name, s.args);
    if (!run.ok) throw new Error(`${s.name} ${JSON.stringify(s.args)}: ${run.text}`);
    const text = run.full ?? run.text;
    const shape = SHAPES.get(s.name) ?? { fields: new Set<string>(), paths: new Set<string>() };
    SHAPES.set(s.name, shape);
    if (s.name === "read_skill") continue; // the skill's text, no fields
    const result: unknown = JSON.parse(text);
    walk(result, "", 1, shape);
    if (s.name === "configure_settings") SETTINGS = new Set(Object.keys((result as { settings: Record<string, unknown> }).settings));
  }
});
afterAll(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- the checks

interface Violation {
  skill: SkillName;
  kind: Kind;
  names: string;
  message: string;
}

const key = (v: { skill: string; kind: string; names: string }): string => `${v.skill} · ${v.kind} · ${v.names}`;

/** The violations of these kinds against the allow-list: none new, none stale. */
function expectAllowed(kinds: readonly Kind[], found: Violation[]): void {
  const allowed = new Map(ALLOWED.filter((a) => kinds.includes(a.kind)).map((a) => [key(a), a]));
  const seen = new Map(found.map((v) => [key(v), v]));
  const failing = [...seen.values()].filter((v) => !allowed.has(key(v))).map((v) => v.message);
  const stale = [...allowed.keys()].filter((k) => !seen.has(k));
  expect(
    { failing, stale },
    "failing: a skill disagrees with the code; fix the skill (with the user), or add it to ALLOWED with why. stale: allowed, and no longer failing; take it off ALLOWED",
  ).toEqual({ failing: [], stale: [] });
}

const ALL_UNITS = SKILL_NAMES.flatMap((n) => UNITS[n]);

/** A name in backticks, or a bare snake_case word, read in its unit: a violation, or null when it checks out. */
function checkName(name: string, u: Unit): Violation | null {
  const at = (kind: Kind, message: string): Violation => ({ skill: u.skill, kind, names: name, message: `${u.where}: ${message}` });
  if (TOOL_NAMES.has(name)) return null;
  const dotted = /^([a-z][a-z0-9_]*)\.(.+)$/.exec(name);
  if (dotted && TOOL_NAMES.has(dotted[1])) {
    return SHAPES.get(dotted[1])?.paths.has(dotted[2]) ? null : at("field", `\`${name}\`: ${dotted[1]}'s result has no ${dotted[2]}`);
  }
  const other = OTHER_NAMES.find((o) => o.name === name);
  const otherChecks = (o: (typeof OTHER_NAMES)[number]): Violation | null => (o.holds() ? null : at("name", `\`${name}\` (${o.what}) no longer checks out`));
  if (SNAKE.test(name)) {
    const scope = u.tools.length ? u.tools : [...TOOL_NAMES];
    if (scope.some((t) => has(t, name) || PARAMS.get(t)?.has(name))) return null;
    if (other) return otherChecks(other);
    const anywhere = CHAT_TOOLS.some((t) => has(t.name, name) || PARAMS.get(t.name)?.has(name));
    if (!anywhere && looksLikeTool(name)) return at("tool", `\`${name}\` is no tool in the registry`);
    return at("field", `\`${name}\` is no field or parameter of ${u.tools.length ? u.tools.join(", ") : "any tool"}; it is ${elsewhere(name)}`);
  }
  // A setting, camelCase: `punchSupercellH/K/L` is punchSupercellH, punchSupercellK and punchSupercellL.
  if (/^[a-z]+[A-Z][A-Za-z0-9]*(?:\/[A-Z0-9]+)*$/.test(name)) {
    const [first, ...rest] = name.split("/");
    const names = [first, ...rest.map((x) => first.slice(0, first.length - x.length) + x)];
    const missing = names.filter((n) => !SETTINGS.has(n));
    return missing.length ? at("setting", `\`${name}\`: no setting ${missing.join(", ")} (configure_settings)`) : null;
  }
  if (other) return otherChecks(other);
  return at("name", `\`${name}\` is no tool, field, parameter or setting, and not in OTHER_NAMES`);
}

describe("the skill lint", () => {
  it("reads the three skills, and samples every tool", () => {
    expect(allSkills().map((s) => s.name)).toEqual(SKILL_NAMES);
    expect([...new Set(SAMPLES.map((s) => s.name))].sort()).toEqual([...TOOL_NAMES].sort());
    for (const t of TOOL_NAMES) if (t !== "read_skill") expect(SHAPES.get(t)?.fields.size, `${t}'s result has fields`).toBeGreaterThan(0);
  });

  it("finds every tool a skill names in the registry", () => {
    const found = ALL_UNITS.flatMap((u) => [...u.ticks, ...u.words].map((n) => checkName(n, u))).filter((v): v is Violation => v?.kind === "tool");
    expectAllowed(["tool"], found);
  });

  it("finds every field, parameter, setting and other name a skill names in backticks", () => {
    const found = ALL_UNITS.flatMap((u) => [...u.ticks, ...u.words].map((n) => checkName(n, u))).filter(
      (v): v is Violation => !!v && v.kind !== "tool",
    );
    expectAllowed(["field", "setting", "name"], found);
  });

  it("holds each claim that a step's tool gives a quantity", () => {
    const drift: string[] = [];
    const found: Violation[] = [];
    for (const c of CLAIMS) {
      const units = unitsWith(c.skill, c.phrase);
      if (units.length !== 1) {
        drift.push(`${c.skill}: "${c.phrase}" is in ${units.length} places`);
        continue;
      }
      const u = units[0];
      if (u.tools.some((t) => c.fields.some((f) => has(t, f)))) continue;
      const where = CHAT_TOOLS.flatMap((t) => c.fields.filter((f) => has(t.name, f)).map((f) => `${t.name} (${f})`));
      found.push({
        skill: c.skill,
        kind: "claim",
        names: c.what,
        message: `${u.where}: ${u.tools.length ? u.tools.join(" and ") : "the step names no tool, so nothing"} gives ${c.what}; ${where.length ? `it is in ${where.join(", ")}` : "no tool gives it"}`,
      });
    }
    expect(drift, "CLAIMS no longer match the skills' words: update them").toEqual([]);
    expectAllowed(["claim"], found);
  });

  it("classifies every number a skill writes: a gate, or not a gate", () => {
    const drift: string[] = [];
    for (const g of GATES) {
      const n = countIn(g.skill, g.phrase);
      if (n !== 1) {
        drift.push(`${g.skill}: the gate "${g.phrase}" is in ${n} places`);
        continue;
      }
      const values = numbersIn(g.phrase).map((t) => t.value);
      if (!values.some((v) => (v === null ? g.stated === null : g.stated !== null && same(v, g.stated)))) {
        drift.push(`${g.skill}: "${g.phrase}" does not state ${g.stated}`);
      }
    }
    for (const x of NOT_GATES) if (countIn(x.skill, x.phrase) < 1) drift.push(`${x.skill}: "${x.phrase}" (not a gate) is gone`);
    for (const u of ALL_UNITS) {
      const spans = [...GATES, ...NOT_GATES]
        .filter((e) => e.skill === u.skill)
        .flatMap((e) => occurrences(u.text, e.phrase).map((at) => [at, at + e.phrase.length] as const));
      for (const t of numbersIn(u.text)) {
        if (!spans.some(([a, b]) => a <= t.at && t.end <= b)) {
          drift.push(`${u.where}: "${t.text}" in "…${u.text.slice(Math.max(0, t.at - 40), t.end + 30)}…" is in neither GATES nor NOT_GATES`);
        }
      }
    }
    expect(drift, "a number no table classifies, or a table entry the skill no longer holds: update GATES or NOT_GATES").toEqual([]);
  });

  it("binds every gate a skill states to the constant it must equal", () => {
    const found: Violation[] = [];
    for (const g of GATES) {
      if (!("limit" in g) || (g.stated !== null && same(g.stated, g.limit.value))) continue;
      const u = unitsWith(g.skill, g.phrase)[0];
      found.push({
        skill: g.skill,
        kind: "gate",
        names: g.phrase,
        message: `${u?.where ?? g.skill}: "${g.phrase}" states ${g.stated}; ${g.limit.constant} is ${g.limit.value}`,
      });
    }
    for (const g of GATES) if ("none" in g) expect(g.none.length, `${g.skill}: "${g.phrase}" says why it has no constant`).toBeGreaterThan(20);
    expectAllowed(["gate"], found);
  });

  it("states among a step's gates the limits its tool judges by", () => {
    const drift: string[] = [];
    const found: Violation[] = [];
    for (const x of UNSTATED) {
      const units = unitsWith(x.skill, x.step);
      if (units.length !== 1 || !units[0].tools.includes(x.tool)) {
        drift.push(`${x.skill}: the step "${x.step}" is in ${units.length} places, or names no ${x.tool}`);
        continue;
      }
      const stated = GATES.some((g) => g.skill === x.skill && "limit" in g && g.limit === x.limit && units[0].text.includes(g.phrase));
      if (!stated) {
        found.push({
          skill: x.skill,
          kind: "unstated",
          names: x.limit.constant,
          message: `${units[0].where}: ${x.tool} judges by ${x.limit.constant} = ${x.limit.value} (${x.words}), which the step does not state`,
        });
      }
    }
    expect(drift, "UNSTATED no longer matches the skills: update it").toEqual([]);
    expectAllowed(["unstated"], found);
  });

  it("keeps the allow-list well formed: every entry a known skill and kind, with why", () => {
    const kinds: Kind[] = ["tool", "field", "setting", "name", "claim", "gate", "unstated"];
    for (const a of ALLOWED) {
      expect(SKILL_NAMES).toContain(a.skill);
      expect(kinds).toContain(a.kind);
      expect(a.why.length, key(a)).toBeGreaterThan(40);
    }
    expect(new Set(ALLOWED.map(key)).size).toBe(ALLOWED.length);
  });
});
