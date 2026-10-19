// A synthetic grid of check results for the verdict tests: each rule on both
// sides of its limits, the words each tool writes or once wrote, and replies and reports
// built from them. Made-up numbers only; no measured data.
//
// The characterisation goldens (verdictGoldens.test.ts) were taken over this
// grid with the code before the check-verdict module, so the grid is data, not
// code under test: it names the kinds it expects only to write the labels a
// producer writes.

import type { AgentStep } from "../agent";
import type { Measured } from "../report/report";

type Obj = Record<string, unknown>;
type Kind = "pass" | "attention" | "info";
export type GridStage = "rings" | "punch" | "backfill" | "flatten" | "pdf";

// The labels assess_stage writes, as they read on 2026-10-19.
const LABEL: Record<Kind, string> = { pass: "meets its goal", attention: "needs attention", info: "not judged" };

export interface Variant {
  id: string;
  m: Obj;
  kind?: Kind; // a stage's kind by its rule, for the label a producer writes
}

const v = (id: string, m: Obj, kind?: Kind): Variant => ({ id, m, kind });

/** Each stage's evaluations: passing, each way of failing, and nothing to judge. */
export const STAGE_VARIANTS: Record<GridStage, Variant[]> = {
  rings: [
    v("clean", { mean_ring_energy_ratio: 0.3, max_over_subtraction_fraction: 0.01, max_ring_dent: 0, max_ring_left: 0 }, "pass"),
    v("left", { mean_ring_energy_ratio: 0.6, max_ring_dent: 0, max_ring_left: 0.12, worst_ring_left: { plane: "hk0", at: 3.2, residual_fraction: 0.12 } }, "attention"),
    v("dent", { mean_ring_energy_ratio: 0.3, max_ring_dent: 0.05, max_ring_left: 0, worst_ring_dent: { plane: "h0l", at: 2.1, residual_fraction: -0.05 } }, "attention"),
    v("unjudged", { mean_ring_energy_ratio: 0.3, max_ring_dent: null, max_ring_left: null, ring_rule: "not judged" }, "info"),
  ],
  punch: [
    v("clean", { leftover_at_nodes: 0, leftover_off_lattice_sharp: 0, leftover_off_lattice_broad: 4, mean_punched_fraction: 0.03 }, "pass"),
    v("at nodes", { leftover_at_nodes: 2, leftover_off_lattice_sharp: 0, mean_punched_fraction: 0.03 }, "attention"),
    // Sharp peaks on protected planes, recorded without their own count (before D5's 2.4.5): counted.
    v("protected sharp", { leftover_at_nodes: 0, leftover_off_lattice_sharp: 3, leftover_on_protected_planes: 3, leftover_off_lattice_broad: 0 }, "attention"),
    v("no sharp count", { leftover_at_nodes: 0, mean_punched_fraction: 0.02 }, "pass"),
    v("no node count", { leftover_off_lattice_sharp: 3 }, "info"),
  ],
  backfill: [
    v("clean", { mean_median_seam_sigma: 0.5, max_bright_fill_fraction: 0 }, "pass"),
    v("at 1σ", { mean_median_seam_sigma: 1, max_bright_fill_fraction: 0.001 }, "pass"),
    v("seam", { mean_median_seam_sigma: 1.5, max_bright_fill_fraction: 0.002 }, "attention"),
    v("no seam", { max_bright_fill_fraction: 0 }, "info"),
  ],
  flatten: [
    v("level", { max_after_floor_sigma: 1.7, max_floor_trend: 0.3, max_floor_span_fraction: 0.6, pedestal_left: false }, "pass"),
    v("pedestal", { max_after_floor_sigma: 1.8, max_floor_trend: 0.97, max_floor_span_fraction: 0.97, pedestal_left: true }, "attention"),
    v("falling", { max_after_floor_sigma: 0.5, max_floor_trend: -0.85, max_floor_span_fraction: 0.9 }, "attention"),
    v("at 0.8", { max_floor_trend: 0.8, max_floor_span_fraction: 0.8 }, "attention"),
    v("no trend", { max_after_floor_sigma: 0.8 }, "info"),
  ],
  pdf: [
    v("sound", { back_fft_pearson_r: 0.989, back_fft_pearson_r_even: 1, window_weight_on_unmeasured: 0.00024, window_shape: "ellipsoid", max_symmetry_break: 0, worst_symmetry_op: "mirror ⊥ a", symmetry_declared: true }, "pass"),
    v("even part short", { back_fft_pearson_r: 0.98, back_fft_pearson_r_even: 0.97, window_weight_on_unmeasured: 0.00024, symmetry_declared: true }, "attention"),
    v("old r, symmetrised", { back_fft_pearson_r: 0.98, back_fft_pearson_r_even: null, symmetry_declared: true, max_symmetry_break: 0.0001 }, "attention"),
    v("old r, declared none", { back_fft_pearson_r: 0.98, symmetry_declared: false }, "pass"),
    v("old r, not read", { back_fft_pearson_r: 0.98 }, "attention"),
    v("old r at 0.999", { back_fft_pearson_r: 0.999, symmetry_declared: true }, "pass"),
    v("window past", { back_fft_pearson_r_even: 1, window_weight_on_unmeasured: 0.0011, window_shape: "separable" }, "attention"),
    v("window at limit", { back_fft_pearson_r_even: 1, window_weight_on_unmeasured: 0.001 }, "pass"),
    v("symmetry broken", { back_fft_pearson_r_even: 1, window_weight_on_unmeasured: 0.0001, max_symmetry_break: 0.05, worst_symmetry_op: "six-fold (60°)", symmetry_declared: true }, "attention"),
    v("symmetry at limit", { back_fft_pearson_r_even: 1, max_symmetry_break: 0.001, symmetry_declared: true }, "pass"),
    v("asymmetry undeclared", { back_fft_pearson_r_even: 1, max_symmetry_break: 0.05, symmetry_declared: false }, "pass"),
    v("asymmetry, not read", { back_fft_pearson_r_even: 1, max_symmetry_break: 0.05, symmetry_declared: null }, "attention"),
    // Nothing measured: the ΔPDF's rule passes it.
    v("nothing measured", { back_fft_pearson_r: null, window_weight_on_unmeasured: null, max_symmetry_break: null }, "pass"),
  ],
};

export const GRID_STAGES: readonly GridStage[] = ["rings", "punch", "backfill", "flatten", "pdf"];

const passing = (stage: GridStage): Variant => STAGE_VARIANTS[stage][0];

/** A stage's result as assess_stage writes it: its label, then its numbers. */
export const labelled = (x: Variant): Obj => ({ verdict: LABEL[x.kind!], ...x.m });

export const COVERAGE: Variant[] = [
  v("clean by weight", { verdict: "clean: the ΔPDF's ellipsoid window puts 2.4e-4 of its weight on unmeasured reciprocal space", window_weight_on_unmeasured: 0.00024, counts_end_inside_box: false }),
  v("too far by weight", { verdict: "too far: the ΔPDF's separable window puts 0.04 of its weight on unmeasured reciprocal space; taper it to the coverage (pdfWindowSupport) or set a |Q| band", window_weight_on_unmeasured: 0.04 }),
  // 1.04e-3 raw: past the limit here, 1.0e-3 in a ΔPDF evaluation's two figures (D6).
  v("too far at 1.04e-3", { verdict: "too far: the ΔPDF's ellipsoid window puts 0.001 of its weight on unmeasured reciprocal space; taper it to the coverage (pdfWindowSupport) or set a |Q| band", window_weight_on_unmeasured: 0.00104 }),
  v("reach inside", { verdict: "the transform reaches 6.283 Å⁻¹ (the window is tapered to the measured coverage), inside full coverage at 6.5 Å⁻¹", window_weight_on_unmeasured: null, transform_reach_q: 6.283 }),
  v("reach past", { verdict: "too far: the transform reaches 9.1 Å⁻¹ (the window tapers to zero at the box faces), past full coverage at 6.5 Å⁻¹; set a |Q| band at or below it, or taper the window to the coverage", window_weight_on_unmeasured: null }),
  v("no cell", { verdict: "no unit cell: |Q| is unknown, so the reach cannot be compared" }),
  v("no full shell", { verdict: "no |Q| shell is fully measured on these planes" }),
  v("no ΔPDF", { verdict: "no ΔPDF yet to read the box corner from" }),
  // Words no producer wrote, which the answer checks once matched (D10).
  v("legacy past", { verdict: "past full coverage: the window reaches the box corners" }),
  v("legacy unmeasured", { verdict: "unmeasured space inside the window" }),
  v("legacy not", { verdict: "not inside the coverage" }),
  v("upper case", { verdict: "Too far: the window reaches the box corners", window_weight_on_unmeasured: null }),
  v("counts end inside", {
    verdict:
      "clean: the ΔPDF's ellipsoid window (shrunk to 0.695 × to fit the coverage) puts 9.8e-4 of its weight on unmeasured reciprocal space; the raw counts end at 4.507 Å⁻¹, inside the box (its nearest face at 6.444 Å⁻¹), and no |Q| band is set, so only the window's taper keeps the transform on the counts: the band they allow is 0–4.5 Å⁻¹ (suggested_band), the user's to set",
    window_weight_on_unmeasured: 0.00098,
    raw_counts: { q_min_edge: null, q_max_edge: 4.507, fully_measured: [0.15, 4.45], box_face_q: 6.444 },
    suggested_band: [0, 4.5],
    counts_end_inside_box: true,
  }),
  v("counts end inside, a band set", {
    verdict: "clean: the ΔPDF's ellipsoid window puts 9.8e-4 of its weight on unmeasured reciprocal space",
    window_weight_on_unmeasured: 0.00098,
    raw_counts: { q_max_edge: 4.507, box_face_q: 6.444 },
    counts_end_inside_box: true,
  }),
  v("counts end, no edge", { verdict: "clean: the window puts 2e-4 of its weight on unmeasured reciprocal space", window_weight_on_unmeasured: 0.0002, raw_counts: { q_max_edge: null }, counts_end_inside_box: true }),
  v("weight only", { window_weight_on_unmeasured: 0.04 }),
];

export const SYMMETRY: Variant[] = [
  v("kept", { section: "ΔPDF x–y section at z = 0 Å", cell: "hexagonal", symmetry_declared: true, verdict: "kept: every in-plane operation holds to 0.001 or better" }),
  v("not kept", { symmetry_declared: true, verdict: "not kept: six-fold (60°) (0.02); a symmetry the data were symmetrised with should hold to ~0.001 or better" }),
  v("not declared", { symmetry_declared: false, verdict: "not judged: the file declares no symmetry, so the section's asymmetry (0.02) is the data's own, counting noise included, not a break by a stage" }),
  v("nothing to test", { note: "no in-plane symmetry to test: the cell is neither hexagonal nor orthogonal, or the section is not centred on the origin" }),
];
/** Words no producer writes, read only from a reply. */
export const SYMMETRY_UPPER: Variant = v("upper case", { verdict: "Not kept: six-fold (60°) (0.02)" });

export const TEXTURE: Variant[] = [
  v("no bias", { per_cut: [{ cut: "H–K plane at L = 0", systematic_fill_bias: false }, { cut: "H–L plane at K = 0", systematic_fill_bias: false }] }),
  v("bias", { per_cut: [{ cut: "H–K plane at L = 0", systematic_fill_bias: false }, { cut: "H–L plane at K = 0", systematic_fill_bias: true }] }),
  v("no cuts", { per_cut: [] }),
  v("no per_cut", {}),
];

export const GRAIN: Variant[] = [
  v("a second grain", { off_lattice_orbits: 60, judged: 40, near_bragg_nodes: 3, rotated_copy: { indexed: 30, misorientation_deg: 23.1 }, random_control: 2, verdict: "a second grain: one rotation of the Bragg lattice indexes 30 of the 40 strongest off-lattice orbits (random directions: 2), misoriented by 23.1° from the main grain" }),
  v("UB off", { off_lattice_orbits: 60, judged: 40, near_bragg_nodes: 40, rotated_copy: { indexed: 38, misorientation_deg: 0.9 }, random_control: 2, verdict: "the off-lattice peaks are the crystal's own Bragg peaks with the UB off: one rotation of 0.9° puts 38 of the 40 strongest orbits back on the Bragg lattice (random directions: 2); refine the UB" }),
  v("no grain", { off_lattice_orbits: 60, judged: 40, near_bragg_nodes: 3, rotated_copy: { indexed: 3, misorientation_deg: 24.5 }, random_control: 5, verdict: "no second grain of this phase: a rotated copy of the Bragg lattice indexes only 3 of the 40 strongest off-lattice orbits (random directions: 5)" }),
  v("no grain, beside nodes", { off_lattice_orbits: 60, judged: 40, near_bragg_nodes: 28, near_offset_angle_deg: { median: 1.2, quartiles: [0.9, 1.6] }, rotated_copy: { indexed: 3, misorientation_deg: 24.5 }, random_control: 5, verdict: "no second grain of this phase: a rotated copy of the Bragg lattice indexes only 3 of the 40 strongest off-lattice orbits (random directions: 5). 28 of them sit within a quarter of the node spacing of a Bragg node, offset by a median 1.2° of rotation (a lower bound: a node at an angle to the rotation axis moves less): the Bragg peaks themselves, off their nodes by about that angle (refine the UB)" }),
  v("half beside nodes", { judged: 40, near_bragg_nodes: 20, verdict: "no second grain of this phase: a rotated copy of the Bragg lattice indexes only 2 of the 40 strongest off-lattice orbits (random directions: 4)" }),
  v("no peaks", { off_lattice_orbits: 0, judged: 0, near_bragg_nodes: 0, near_offset_angle_deg: null, far: [], rotated_copy: null, random_control: 0, verdict: "no off-lattice peaks were recorded by the punch's search" }),
  v("no words", { judged: 40, near_bragg_nodes: 30 }),
];

export const UB: Variant[] = [
  v("right", { fit: "both", symmetrised: false, orientation_change_deg: 0.01, origin_shift_rlu: null, unexplained: false }),
  v("at 0.05°", { fit: "both", symmetrised: false, orientation_change_deg: 0.05, origin_shift_rlu: null }),
  v("turned", { fit: "both", symmetrised: false, orientation_change_deg: 0.601, origin_shift_rlu: null }),
  v("symmetrised", { fit: "symmetric", symmetrised: true, orientation_change_deg: 0, origin_shift_rlu: null }),
  v("symmetrised, turned", { fit: "symmetric", symmetrised: true, orientation_change_deg: 0.3 }),
  v("symmetric fit, unsymmetrised", { fit: "symmetric", symmetrised: false, orientation_change_deg: 0.3 }),
  v("legacy angle", { angle_deg: 0.4 }),
  v("origin shifted", { fit: "both", symmetrised: false, orientation_change_deg: 0.001, origin_shift_rlu: [0.0305, 0.0195, 0], unexplained: true }),
  v("turned, origin shifted", { fit: "both", symmetrised: false, orientation_change_deg: 0.2, origin_shift_rlu: [0.03, 0, 0] }),
  v("nothing", {}),
];

// ---------------------------------------------------------------- replies

let serial = 0;
export const step = (name: string, result: unknown, args: Obj = {}, status: AgentStep["status"] = "done"): AgentStep => ({
  id: `g${serial++}`,
  name,
  args,
  status,
  result: typeof result === "string" ? result : JSON.stringify(result),
});

export const assess = (stages: Partial<Record<GridStage, Obj>>, args: Obj = { stage: "all" }): AgentStep => step("assess_stage", stages, args);
const one = (stage: GridStage, m: Obj): AgentStep => assess({ [stage]: m }, { stage });
const allOf = (over: Partial<Record<GridStage, Obj>> = {}): AgentStep =>
  assess(Object.fromEntries(GRID_STAGES.map((s) => [s, over[s] ?? labelled(passing(s))])));
export const rerun = (stages?: Partial<Record<GridStage | "pdf_check", string>>): AgentStep =>
  step("run_pipeline", stages ? { ended: "done", stages } : { ended: "done" }, { from_stage: "flatten" });
const FROM_FLATTEN = { rings: "reused", punch: "reused", backfill: "reused", flatten: "computed", pdf: "computed" };
const MISSING = (stage: GridStage): Obj => ({ missing: `no ${stage} output yet; run_pipeline computes it` });

export interface ReplyCase {
  id: string;
  steps: AgentStep[];
}

/** Replies over the grid: each result alone, each in a run that otherwise passes, and the orders and reruns that decide which result counts. */
export function replyCases(): ReplyCase[] {
  const out: ReplyCase[] = [];
  const add = (id: string, steps: AgentStep[]) => out.push({ id, steps });
  for (const stage of GRID_STAGES) {
    for (const x of STAGE_VARIANTS[stage]) {
      add(`${stage} ${x.id}, labelled, alone`, [one(stage, labelled(x))]);
      add(`${stage} ${x.id}, numbers only, alone`, [one(stage, x.m)]);
      add(`${stage} ${x.id}, labelled, in a passing run`, [allOf({ [stage]: labelled(x) })]);
    }
    const first = STAGE_VARIANTS[stage][0];
    // A label that disagrees with the numbers, one that is no label, and none.
    add(`${stage}: "needs attention" over passing numbers`, [one(stage, { ...first.m, verdict: LABEL.attention })]);
    add(`${stage}: "not judged" over passing numbers`, [one(stage, { ...first.m, verdict: LABEL.info })]);
    add(`${stage}: words that are no label, over passing numbers`, [one(stage, { ...first.m, verdict: "pass" })]);
    add(`${stage}: words that are no label, over failing numbers`, [one(stage, { ...STAGE_VARIANTS[stage][1].m, verdict: "fine" })]);
    add(`${stage}: missing`, [one(stage, MISSING(stage))]);
    add(`${stage}: missing after needs attention`, [one(stage, labelled(STAGE_VARIANTS[stage][1])), one(stage, MISSING(stage))]);
    add(`${stage}: missing after meets its goal`, [one(stage, labelled(first)), one(stage, MISSING(stage))]);
    // Which result counts: the newest, the newest that decides.
    add(`${stage}: needs attention, then not judged`, [one(stage, labelled(STAGE_VARIANTS[stage][1])), one(stage, { ...first.m, verdict: LABEL.info })]);
    add(`${stage}: meets its goal, then not judged`, [one(stage, labelled(first)), one(stage, { ...first.m, verdict: LABEL.info })]);
    add(`${stage}: needs attention, then meets its goal`, [one(stage, labelled(STAGE_VARIANTS[stage][1])), one(stage, labelled(first))]);
    add(`${stage}: meets its goal, then needs attention`, [one(stage, labelled(first)), one(stage, labelled(STAGE_VARIANTS[stage][1]))]);
    add(`${stage}: a passing result that did not parse, after needs attention`, [one(stage, labelled(STAGE_VARIANTS[stage][1])), step("assess_stage", `{"${stage}": {"verdict": "meets its goal"`, { stage })]);
    add(`${stage}: a passing result that failed, after needs attention`, [one(stage, labelled(STAGE_VARIANTS[stage][1])), step("assess_stage", { [stage]: labelled(first) }, { stage }, "error")]);
  }
  add("every stage passes", [allOf()]);
  add("every stage passes, numbers only", [assess(Object.fromEntries(GRID_STAGES.map((s) => [s, passing(s).m])))]);
  add("every stage missing", [assess(Object.fromEntries(GRID_STAGES.map((s) => [s, MISSING(s)])))]);
  add("a stage list that is not an object", [assess({ rings: "clean", punch: [1, 2] } as unknown as Partial<Record<GridStage, Obj>>)]);
  add("an unparsed result only", [step("assess_stage", "Error: the server is gone", { stage: "all" })]);
  add("no steps", []);
  add("a reading tool only", [step("describe_dataset", { grid: [97, 97, 97] })]);

  // Reruns: a stage measured before the last run that computed it is stale.
  add("a rerun from the flatten after a passing run", [allOf(), rerun(FROM_FLATTEN)]);
  add("a rerun from the flatten, then the flatten and the ΔPDF measured again", [
    allOf(),
    rerun(FROM_FLATTEN),
    one("flatten", labelled(STAGE_VARIANTS.flatten[1])),
    one("pdf", labelled(passing("pdf"))),
  ]);
  add("a rerun that says nothing of its stages", [allOf(), rerun()]);
  add("a failed rerun", [allOf(), step("run_pipeline", "Error: the run failed", { from_stage: "rings" }, "error")]);
  add("a stage failing before a rerun that reused it", [allOf({ rings: labelled(STAGE_VARIANTS.rings[1]) }), rerun(FROM_FLATTEN)]);

  // The checks on the result, each in a run that otherwise passes, alone, and after a rerun.
  // Each tool's variants, with a passing and a failing one to pair them with.
  const checks: [string, Variant[], Variant, Variant][] = [
    ["qmax_coverage", COVERAGE, COVERAGE[0], COVERAGE[1]],
    ["symmetry_check", [...SYMMETRY, SYMMETRY_UPPER], SYMMETRY[0], SYMMETRY[1]],
    ["texture_check", TEXTURE, TEXTURE[0], TEXTURE[1]],
    ["grain_check", GRAIN, GRAIN[2], GRAIN[0]],
    ["ub_check", UB, UB[0], UB[2]],
  ];
  for (const [tool, variants, pass, fail] of checks) {
    for (const x of variants) {
      add(`${tool} ${x.id}, alone`, [step(tool, x.m)]);
      add(`${tool} ${x.id}, in a passing run`, [allOf(), step(tool, x.m)]);
      add(`${tool} ${x.id}, before a rerun from the flatten`, [allOf(), step(tool, x.m), rerun(FROM_FLATTEN), one("flatten", labelled(passing("flatten"))), one("pdf", labelled(passing("pdf")))]);
      add(`${tool} ${x.id}, in a run where the flatten needs attention`, [allOf({ flatten: labelled(STAGE_VARIANTS.flatten[1]) }), step(tool, x.m)]);
      // Which of two results counts: this one before and after a passing and a failing one.
      for (const other of [pass, fail]) {
        if (other === x || (x === pass && other === fail)) continue; // the anchors' own pair comes once, from the failing one
        add(`${tool} ${x.id}, then ${other.id}`, [step(tool, x.m), step(tool, other.m)]);
        add(`${tool} ${other.id}, then ${x.id}`, [step(tool, other.m), step(tool, x.m)]);
      }
    }
  }
  // Two checks together, and every check at once.
  add("every check passes", [allOf(), step("qmax_coverage", COVERAGE[0].m), step("symmetry_check", SYMMETRY[0].m), step("texture_check", TEXTURE[0].m), step("grain_check", GRAIN[2].m), step("ub_check", UB[0].m)]);
  add("every check fails", [
    allOf(Object.fromEntries(GRID_STAGES.map((s) => [s, labelled(STAGE_VARIANTS[s][1])]))),
    step("qmax_coverage", COVERAGE[1].m),
    step("symmetry_check", SYMMETRY[1].m),
    step("texture_check", TEXTURE[1].m),
    step("grain_check", GRAIN[0].m),
    step("ub_check", UB[2].m),
  ]);
  add("data problems only", [step("qmax_coverage", COVERAGE[12].m), step("ub_check", UB[8].m)]);
  add("a second grain and a UB off, then a UB check that finds it right", [step("grain_check", GRAIN[0].m), step("grain_check", GRAIN[1].m), step("ub_check", UB[0].m)]);
  add("an unknown tool's verdict", [step("verdict_tool", { verdict: "needs attention" })]);
  return out;
}

// ---------------------------------------------------------------- the answers held to them

/** One claim per topic that it is fine, and for the grain and the UB one that it is not. */
export const CLAIMS: Record<string, string> = {
  "rings ok": "The ring removal is clean.",
  "punch ok": "The punch removed every Bragg peak; nothing is left at the nodes.",
  "backfill ok": "The backfill is clean.",
  "flatten ok": "The flatten meets its goal.",
  "pdf ok": "The 3D-ΔPDF meets its goal.",
  "coverage ok": "The window stays inside the coverage.",
  "symmetry ok": "The ΔPDF keeps its six-fold symmetry.",
  "grain ok": "There is no second grain.",
  "grain not ok": "The off-lattice peaks show a second grain.",
  "ub ok": "The UB is right.",
  "ub not ok": "The UB is off by half a degree; refine it.",
};
/** A claim that the whole run succeeded. */
export const SUCCESS = "The 3D-ΔPDF is ready for analysis.";

// ---------------------------------------------------------------- reports

export interface ReportCase {
  id: string;
  measured: Measured;
}

const BASE: Measured = {
  rings: passing("rings").m,
  punch: passing("punch").m,
  backfill: passing("backfill").m,
  flatten: passing("flatten").m,
  pdf: passing("pdf").m,
  texture: TEXTURE[0].m,
  coverage: COVERAGE[0].m,
  symmetry: SYMMETRY[0].m,
  grains: GRAIN[2].m,
};

/** Reports over the grid: one measurement changed at a time, and the measurements a report can lack. */
export function reportCases(): ReportCase[] {
  const out: ReportCase[] = [];
  const add = (id: string, over: Measured) => out.push({ id, measured: { ...BASE, ...over } });
  add("every check passes", {});
  for (const stage of GRID_STAGES) {
    for (const x of STAGE_VARIANTS[stage]) add(`${stage} ${x.id}`, { [stage]: x.m });
    add(`${stage} labelled as needing attention over passing numbers`, { [stage]: { ...passing(stage).m, verdict: LABEL.attention } });
    add(`no ${stage}`, { [stage]: null });
  }
  for (const x of COVERAGE) add(`coverage ${x.id}`, { coverage: x.m });
  for (const x of SYMMETRY) add(`symmetry ${x.id}`, { symmetry: x.m });
  for (const x of TEXTURE) add(`texture ${x.id}`, { texture: x.m });
  for (const x of GRAIN) add(`grain ${x.id}`, { grains: x.m });
  add("no coverage, symmetry, texture or grain", { coverage: null, symmetry: null, texture: null, grains: null });
  // The ΔPDF's card: its window from the evaluation, else the coverage's weight.
  const noWeight = { ...passing("pdf").m, window_weight_on_unmeasured: null };
  add("the ΔPDF without a weight, the coverage too far by weight", { pdf: noWeight, coverage: COVERAGE[1].m });
  add("the ΔPDF without a weight, the coverage at 1.04e-3", { pdf: noWeight, coverage: COVERAGE[2].m });
  add("the ΔPDF without a weight, the coverage too far by reach", { pdf: noWeight, coverage: COVERAGE[4].m });
  add("the ΔPDF without a weight, a weight with no words", { pdf: noWeight, coverage: COVERAGE[15].m });
  add("the ΔPDF's weight inside, the coverage too far by weight", { coverage: COVERAGE[1].m });
  add("the ΔPDF's weight past, the coverage clean", { pdf: STAGE_VARIANTS.pdf[6].m });
  // Without a ΔPDF evaluation, the card is judged from the coverage and the symmetry (D9).
  add("no ΔPDF evaluation, the coverage clean", { pdf: null });
  add("no ΔPDF evaluation, the coverage too far by weight", { pdf: null, coverage: COVERAGE[1].m });
  add("no ΔPDF evaluation, the symmetry not kept", { pdf: null, symmetry: SYMMETRY[1].m });
  add("no ΔPDF evaluation, the symmetry alone", { pdf: null, coverage: null, symmetry: SYMMETRY[2].m });
  add("no ΔPDF evaluation, the coverage alone, reach past", { pdf: null, symmetry: null, coverage: COVERAGE[4].m });
  add("no ΔPDF, coverage or symmetry", { pdf: null, coverage: null, symmetry: null });
  // The evaluation's own symmetry break, and symmetry_check's.
  add("the evaluation's symmetry broken, symmetry_check kept", { pdf: STAGE_VARIANTS.pdf[8].m });
  add("the evaluation's symmetry broken, no symmetry_check", { pdf: STAGE_VARIANTS.pdf[8].m, symmetry: null });
  add("the evaluation sound, symmetry_check not kept", { symmetry: SYMMETRY[1].m });
  // The fill bias: on the backfill's card, when there is one.
  add("a fill bias, the seam clean", { texture: TEXTURE[1].m });
  add("a fill bias, the seam failing", { texture: TEXTURE[1].m, backfill: STAGE_VARIANTS.backfill[2].m });
  add("a fill bias, no seam", { texture: TEXTURE[1].m, backfill: STAGE_VARIANTS.backfill[3].m });
  add("a fill bias, no backfill", { texture: TEXTURE[1].m, backfill: null });
  add("nothing measured", { rings: null, punch: null, backfill: null, flatten: null, pdf: null, texture: null, coverage: null, symmetry: null, grains: null });
  add("only a grain", { rings: null, punch: null, backfill: null, flatten: null, pdf: null, texture: null, coverage: null, symmetry: null, grains: GRAIN[0].m });
  return out;
}
