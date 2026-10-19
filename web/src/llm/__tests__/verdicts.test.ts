// The check-verdict module at its interface: measurements in, an outcome out
// (its kind, reasons, words and the data's problems), for every check's rule
// at its limits, and the seam's round trip.

import { describe, expect, it } from "vitest";

import type { AgentStep } from "../agent";
import { shownGrains, type GrainFacts } from "../metrics/grains";
import { judge, UNROUNDED, verdicts, WORDS, type CheckId, type Kind, type Outcome, type Reason } from "../verdicts";

type Obj = Record<string, unknown>;

// ---------------------------------------------------------------- the seam

const PASSING_RUN: AgentStep = {
  id: "all",
  name: "assess_stage",
  args: { stage: "all" },
  status: "done",
  result: JSON.stringify({
    rings: { verdict: "meets its goal", max_ring_left: 0, max_ring_dent: 0 },
    punch: { verdict: "meets its goal", leftover_at_nodes: 0 },
    backfill: { verdict: "meets its goal", mean_median_seam_sigma: 0.5 },
    flatten: { verdict: "meets its goal", max_floor_trend: 0.3, max_floor_span_fraction: 0.6 },
    pdf: { verdict: "meets its goal", back_fft_pearson_r_even: 1 },
  }),
};

/**
 * The seam's round trip: a tool's result with the outcomes its producer
 * judged beside it, and the same result with its words and numbers only (a
 * recording), give the same verdicts, alone and after a passing run.
 */
function roundTrip(name: string, result: unknown, outcomes: Outcome[]): void {
  const words: AgentStep = { id: "words", name, args: {}, status: "done", result: JSON.stringify(result) };
  const sidecar: AgentStep = { ...words, id: "sidecar", outcomes };
  for (const before of [[], [PASSING_RUN]]) {
    expect(verdicts({ reply: [...before, sidecar] }), JSON.stringify(result).slice(0, 200)).toEqual(verdicts({ reply: [...before, words] }));
  }
}

/** A stage's result as assess_stage writes it, and its outcome. */
function roundTripStage(stage: CheckId, m: Obj): void {
  const o = judge(stage, m as never);
  roundTrip("assess_stage", { [stage]: o.words === null ? m : { verdict: o.words, criterion: o.criterion, headline: "–", ...m } }, [o]);
}

interface Case {
  m: Obj;
  kind: Kind;
  reasons: Reason[];
  why: string;
}

const c = (why: string, m: Obj, kind: Kind, reasons: Reason[] = []): Case => ({ why, m, kind, reasons });

const STAGE_CASES: Record<"rings" | "punch" | "backfill" | "flatten" | "pdf", Case[]> = {
  rings: [
    c("no ring left or dented", { max_ring_left: 0, max_ring_dent: 0 }, "pass"),
    c("a ring left", { max_ring_left: 0.12, max_ring_dent: 0 }, "attention", ["ring left"]),
    c("a ring dented", { max_ring_left: 0, max_ring_dent: 0.05 }, "attention", ["ring dent"]),
    c("both", { max_ring_left: 0.1, max_ring_dent: 0.1 }, "attention", ["ring left", "ring dent"]),
    c("the 3D test could not run", { max_ring_left: null, max_ring_dent: 0 }, "info", ["nothing to judge"]),
  ],
  punch: [
    c("nothing missed", { leftover_at_nodes: 0, leftover_off_lattice_sharp: 0, leftover_off_lattice_broad: 9 }, "pass"),
    c("no sharp count: none", { leftover_at_nodes: 0 }, "pass"),
    c("peaks missed at nodes", { leftover_at_nodes: 2, leftover_off_lattice_sharp: 0 }, "attention", ["missed at nodes"]),
    c("the sharp peaks on protected planes stay by design (D5)", { leftover_at_nodes: 0, leftover_off_lattice_sharp: 3, leftover_on_protected_planes: 3, leftover_on_protected_planes_sharp: 3 }, "pass"),
    c("a sharp peak off the protected planes is one the search left (D5)", { leftover_at_nodes: 0, leftover_off_lattice_sharp: 4, leftover_on_protected_planes_sharp: 3 }, "attention", ["sharp off-lattice"]),
    c("an evaluation without the protected planes' sharp count counts every sharp one (D5)", { leftover_at_nodes: 0, leftover_off_lattice_sharp: 3, leftover_on_protected_planes: 3 }, "attention", ["sharp off-lattice"]),
    c("both", { leftover_at_nodes: 1, leftover_off_lattice_sharp: 1 }, "attention", ["missed at nodes", "sharp off-lattice"]),
    c("no node count", { leftover_off_lattice_sharp: 3 }, "info", ["nothing to judge"]),
  ],
  backfill: [
    c("a seam of 1σ", { mean_median_seam_sigma: 1 }, "pass"),
    c("a seam past 1σ", { mean_median_seam_sigma: 1.0001 }, "attention", ["seam"]),
    c("no seam", { max_bright_fill_fraction: 0 }, "info", ["nothing to judge"]),
  ],
  flatten: [
    c("a trend and a span of 0.8: a pedestal", { max_floor_trend: 0.8, max_floor_span_fraction: 0.8 }, "attention", ["pedestal"]),
    c("a falling floor", { max_floor_trend: -0.85, max_floor_span_fraction: 0.9 }, "attention", ["pedestal"]),
    c("a trend under 0.8", { max_floor_trend: 0.79, max_floor_span_fraction: 0.9 }, "pass"),
    c("the floor in σ is reported, not judged", { max_after_floor_sigma: 3, max_floor_trend: 0.31, max_floor_span_fraction: 0.6 }, "pass"),
    c("no span", { max_floor_trend: 0.9 }, "info", ["nothing to judge"]),
  ],
  pdf: [
    c("the even part reproduced", { back_fft_pearson_r: 0.989, back_fft_pearson_r_even: 0.999 }, "pass"),
    c("the even part short", { back_fft_pearson_r_even: 0.9989 }, "attention", ["back-FFT"]),
    c("an old r, the data declared symmetrised", { back_fft_pearson_r: 0.998, symmetry_declared: true }, "attention", ["back-FFT"]),
    c("an old r, no symmetry declared: not judged, and nothing else measured (D15)", { back_fft_pearson_r: 0.98, symmetry_declared: false }, "info", ["nothing to judge"]),
    c("the window at the limit", { back_fft_pearson_r_even: 1, window_weight_on_unmeasured: 0.001 }, "pass", ["window within limit"]),
    c("the window past it", { back_fft_pearson_r_even: 1, window_weight_on_unmeasured: 0.0011 }, "attention", ["window past limit"]),
    c("the symmetry held to 1e-3", { max_symmetry_break: 0.001, symmetry_declared: true }, "pass"),
    c("the symmetry broken", { max_symmetry_break: 0.0011, worst_symmetry_op: "six-fold (60°)" }, "attention", ["symmetry broken"]),
    c("an asymmetry the file declares no symmetry for", { max_symmetry_break: 0.05, symmetry_declared: false }, "pass"),
    c("every fault", { back_fft_pearson_r_even: 0.9, window_weight_on_unmeasured: 0.04, max_symmetry_break: 0.05 }, "attention", ["back-FFT", "window past limit", "symmetry broken"]),
    c("faults, the window within", { back_fft_pearson_r_even: 0.9, window_weight_on_unmeasured: 1e-4 }, "attention", ["back-FFT", "window within limit"]),
    // D15: an evaluation that measured nothing is not judged (it passed before 2.4b.5).
    c("nothing measured: not judged (D15)", { back_fft_pearson_r: null, window_weight_on_unmeasured: null, max_symmetry_break: null }, "info", ["nothing to judge"]),
  ],
};

describe("judge: a stage's evaluation", () => {
  for (const [stage, cases] of Object.entries(STAGE_CASES) as [keyof typeof STAGE_CASES, Case[]][]) {
    for (const x of cases) {
      it(`${stage}: ${x.why}, the same verdicts as a sidecar and as words`, () => roundTripStage(stage, x.m));
      it(`${stage}: ${x.why}`, () => {
        const o = judge(stage, x.m);
        expect(o).toEqual({
          check: stage,
          kind: x.kind,
          reasons: x.reasons,
          dataProblems: [],
          words: WORDS.label[x.kind],
          criterion: stage === "backfill" ? expect.stringMatching(/texture_check's to say\.$/) : WORDS.criterion[stage],
        });
      });
    }
  }

  it("compares the ΔPDF's raw window weight, kept beside the one its evaluation shows (D6)", () => {
    // A weight shown rounded (two figures before 2.4.6b, three since), the raw one kept where JSON never reads it.
    const shown = { back_fft_pearson_r_even: 1, window_weight_on_unmeasured: 0.001, [UNROUNDED]: { window_weight_on_unmeasured: 0.00104 } };
    expect(judge("pdf", shown)).toMatchObject({ kind: "attention", reasons: ["window past limit"] });
    expect(JSON.stringify(shown)).toBe('{"back_fft_pearson_r_even":1,"window_weight_on_unmeasured":0.001}');
  });

  it("gives a stage with no output yet no verdict, as its tool writes none, the same by either reading", () => {
    expect(judge("pdf", { missing: "no delta_pdf output yet; run_pipeline computes it" })).toEqual({ check: "pdf", kind: "info", reasons: ["no output"], dataProblems: [], words: null });
    for (const stage of ["rings", "punch", "backfill", "flatten", "pdf"] as const) roundTripStage(stage, { missing: `no ${stage} output yet` });
  });

  it("states the backfill's own criterion without the fill bias it does not measure", () => {
    expect(judge("backfill", { mean_median_seam_sigma: 0.6 }).criterion).not.toMatch(/no cut whose fill is biased/);
    expect(WORDS.criterion.backfill).toMatch(/no cut whose fill is biased one way/);
  });
});

describe("judge: the checks on the result", () => {
  const reach = {
    window_weight: null,
    window: "the ΔPDF's ellipsoid window",
    unit_cell: true,
    full_coverage_q: 6.5,
    reach: 6.283,
    reach_from: "the window is tapered to the measured coverage",
    shell: 0.1,
    band_set: false,
    counts: { counts_end_inside_box: false },
  };
  const counts = { counts_end_inside_box: true, raw_counts: { q_max_edge: 4.507, box_face_q: 6.444 }, suggested_band: [0, 4.5] };
  const COVERAGE: [string, Obj, Kind, Reason[], string, string[]?][] = [
    ["a recorded weight at the limit", { window_weight: 0.001 }, "pass", ["window within limit"], "clean: the ΔPDF's ellipsoid window puts 0.001 of its weight on unmeasured reciprocal space"],
    ["a tiny weight, in exponent form", { window_weight: 4.1e-6 }, "pass", ["window within limit"], "clean: the ΔPDF's ellipsoid window puts 4.1e-6 of its weight on unmeasured reciprocal space"],
    // Three figures (2.4.6b): past the limit, and shown so.
    ["the raw weight past the limit (D6)", { window_weight: 0.00104 }, "attention", ["window past limit"], "too far: the ΔPDF's ellipsoid window puts 0.00104 of its weight on unmeasured reciprocal space; taper it to the coverage (pdfWindowSupport) or set a |Q| band"],
    ["a tiny weight, to three figures (2.4.6b)", { window_weight: 0.000976 }, "pass", ["window within limit"], "clean: the ΔPDF's ellipsoid window puts 9.76e-4 of its weight on unmeasured reciprocal space"],
    ["the reach inside full coverage", {}, "pass", ["reach inside coverage"], "the transform reaches 6.283 Å⁻¹ (the window is tapered to the measured coverage), inside full coverage at 6.5 Å⁻¹"],
    ["the reach one shell past it", { reach: 6.6 }, "pass", ["reach inside coverage"], "the transform reaches 6.6 Å⁻¹ (the window is tapered to the measured coverage), inside full coverage at 6.5 Å⁻¹"],
    ["the reach past it", { reach: 6.61 }, "attention", ["reach past coverage"], "too far: the transform reaches 6.61 Å⁻¹ (the window is tapered to the measured coverage), past full coverage at 6.5 Å⁻¹; set a |Q| band at or below it, or taper the window to the coverage"],
    ["no unit cell", { unit_cell: false }, "info", ["nothing to judge"], "no unit cell: |Q| is unknown, so the reach cannot be compared"],
    ["no shell fully measured", { full_coverage_q: null }, "info", ["nothing to judge"], "no |Q| shell is fully measured on these planes"],
    ["no ΔPDF to read the corner from", { reach: null }, "info", ["nothing to judge"], "no ΔPDF yet to read the box corner from"],
    [
      "the counts ending inside the box, no band set",
      { window_weight: 0.00098, window: "the ΔPDF's ellipsoid window (shrunk to 0.695 × to fit the coverage)", counts },
      "pass",
      ["window within limit"],
      "clean: the ΔPDF's ellipsoid window (shrunk to 0.695 × to fit the coverage) puts 9.8e-4 of its weight on unmeasured reciprocal space; the raw counts end at 4.507 Å⁻¹, inside the box (its nearest face at 6.444 Å⁻¹), and no |Q| band is set, so only the window's taper keeps the transform on the counts: the band they allow is 0–4.5 Å⁻¹ (suggested_band), the user's to set",
      ["the counts end at 4.507 Å⁻¹, inside the box"],
    ],
    ["the counts ending inside, a band set: a data problem, no note", { window_weight: 0.00098, counts, band_set: true }, "pass", ["window within limit"], "clean: the ΔPDF's ellipsoid window puts 9.8e-4 of its weight on unmeasured reciprocal space", ["the counts end at 4.507 Å⁻¹, inside the box"]],
  ];
  for (const [why, over, kind, reasons, words, dataProblems = []] of COVERAGE) {
    it(`coverage: ${why}`, () => {
      expect(judge("coverage", { ...reach, ...over } as never)).toEqual({ check: "coverage", kind, reasons, dataProblems, words });
    });
    it(`coverage: ${why}, the same verdicts as a sidecar and as words`, () => {
      const m = { ...reach, ...over } as typeof reach & { counts: Obj };
      const o = judge("coverage", m as never);
      roundTrip("qmax_coverage", { verdict: o.words, window_weight_on_unmeasured: m.window_weight, ...m.counts }, [o]);
    });
  }

  const ops = (rms: number) => [{ op: "six-fold (60°)", rms_difference: rms }, { op: "two-fold (180°)", rms_difference: 0 }];
  const SYMMETRY: [string, Obj, Kind, Reason[], string | null][] = [
    ["every operation held to 1e-3", { ops: ops(0.001), declared: "6/mmm" }, "pass", [], "kept: every in-plane operation holds to 0.001 or better"],
    ["one past it", { ops: ops(0.0011), declared: "6/mmm" }, "attention", ["symmetry broken"], "not kept: six-fold (60°) (0.0011); a symmetry the data were symmetrised with should hold to ~0.001 or better"],
    ["a file read, no symmetry declared", { ops: ops(0.02), declared: null }, "info", ["not declared"], "not judged: the file declares no symmetry, so the section's asymmetry (0.02) is the data's own, counting noise included, not a break by a stage"],
    ["an empty declaration", { ops: ops(0.02), declared: "" }, "info", ["not declared"], "not judged: the file declares no symmetry, so the section's asymmetry (0.02) is the data's own, counting noise included, not a break by a stage"],
    ["the file not read: judged", { ops: ops(0.02), declared: undefined }, "attention", ["symmetry broken"], "not kept: six-fold (60°) (0.02); a symmetry the data were symmetrised with should hold to ~0.001 or better"],
    ["no operation to test", { ops: null, declared: "6/mmm" }, "info", ["nothing to judge"], null],
  ];
  for (const [why, m, kind, reasons, words] of SYMMETRY) {
    it(`symmetry: ${why}`, () => {
      expect(judge("symmetry", m as never)).toEqual({ check: "symmetry", kind, reasons, dataProblems: [], words });
    });
    it(`symmetry: ${why}, the same verdicts as a sidecar and as words`, () => {
      const o = judge("symmetry", m as never);
      roundTrip("symmetry_check", m.ops === null ? { note: "no in-plane symmetry to test" } : { ops: m.ops, symmetry_declared: m.declared === undefined ? null : Boolean(m.declared), verdict: o.words }, [o]);
    });
  }

  it("texture: a cut whose fill is biased one way needs attention; no cut, nothing to judge", () => {
    const cut = (bias: boolean) => ({ cut: "H–K plane at L = 0", systematic_fill_bias: bias });
    expect(judge("texture", { per_cut: [cut(false), cut(true)] })).toEqual({ check: "texture", kind: "attention", reasons: ["fill bias"], dataProblems: [], words: null });
    expect(judge("texture", { per_cut: [cut(false)] })).toMatchObject({ kind: "pass", reasons: [], words: null });
    expect(judge("texture", { per_cut: [] })).toMatchObject({ kind: "info", reasons: ["nothing to judge"] });
    expect(judge("texture", {})).toMatchObject({ kind: "info", reasons: ["nothing to judge"] });
    for (const m of [{ per_cut: [cut(false), cut(true)] }, { per_cut: [cut(false)] }, { per_cut: [] }, {}]) roundTrip("texture_check", m, [judge("texture", m)]);
  });

  const facts = (over: Obj) => ({
    off_lattice_orbits: 60,
    judged: 40,
    near_bragg_nodes: 3,
    near_offset_angle_deg: { median: 1.234, quartiles: [0.9, 1.6] as [number, number] },
    far: [{ hkl: [2.31, 0.5, 1] as [number, number, number], q: 3.871, offset_q: 0.4 }],
    rotated_copy: { indexed: 3, misorientation_deg: 24.51 },
    random_control: 5,
    symmetrised: false,
    ...over,
  });
  const GRAIN: [string, Obj, Kind, Reason[], string, string[]?][] = [
    ["no off-lattice peaks", { judged: 0, near_bragg_nodes: 0, near_offset_angle_deg: null, far: [] }, "pass", [], "no off-lattice peaks were recorded by the punch's search"],
    [
      "one rotation of 23° indexing most",
      { rotated_copy: { indexed: 30, misorientation_deg: 23.104 }, random_control: 2 },
      "attention",
      ["second grain"],
      "a second grain: one rotation of the Bragg lattice indexes 30 of the 40 strongest off-lattice orbits (random directions: 2), misoriented by 23.1° from the main grain",
    ],
    [
      "a rotation at 2°: a grain",
      { rotated_copy: { indexed: 30, misorientation_deg: 2 }, random_control: 2 },
      "attention",
      ["second grain"],
      "a second grain: one rotation of the Bragg lattice indexes 30 of the 40 strongest off-lattice orbits (random directions: 2), misoriented by 2° from the main grain",
    ],
    [
      "a rotation under 2°, judged unrounded: the UB, though it reads 2°",
      { rotated_copy: { indexed: 30, misorientation_deg: 1.996 }, random_control: 2 },
      "attention",
      ["UB off"],
      "the off-lattice peaks are the crystal's own Bragg peaks with the UB off: one rotation of 2° puts 30 of the 40 strongest orbits back on the Bragg lattice (random directions: 2); refine the UB",
      // The data's problem (D3), at the angle the verdict shows.
      ["the UB is off by 2° (one rotation puts the off-lattice peaks back on the Bragg lattice)"],
    ],
    [
      "too few indexed against the control",
      { rotated_copy: { indexed: 20, misorientation_deg: 23 }, random_control: 6 },
      "pass",
      ["no second grain"],
      "no second grain of this phase: a rotated copy of the Bragg lattice indexes only 20 of the 40 strongest off-lattice orbits (random directions: 6). 37 lie farther from any node; their origin is open (another phase, multiple scattering, or an artefact)",
    ],
    [
      "half of them beside nodes, a symmetrised volume",
      { near_bragg_nodes: 20, symmetrised: true, far: [] },
      "attention",
      ["no second grain", "peaks beside nodes"],
      "no second grain of this phase: a rotated copy of the Bragg lattice indexes only 3 of the 40 strongest off-lattice orbits (random directions: 5). 20 of them sit within a quarter of the node spacing of a Bragg node, offset by a median 1.23° of rotation (a lower bound: a node at an angle to the rotation axis moves less): copies of the crystal's own Bragg peaks, displaced by symmetrising data whose UB is off by about that angle; a UB refined on the unsymmetrised data would put them back on the nodes",
      // The UB off, by at least the median offset (D3a).
      ["the UB is off by at least 1.23° (the strongest off-lattice peaks sit beside Bragg nodes)"],
    ],
    [
      "most beside nodes, unsymmetrised",
      { near_bragg_nodes: 28 },
      "attention",
      ["no second grain", "peaks beside nodes"],
      "no second grain of this phase: a rotated copy of the Bragg lattice indexes only 3 of the 40 strongest off-lattice orbits (random directions: 5). 28 of them sit within a quarter of the node spacing of a Bragg node, offset by a median 1.23° of rotation (a lower bound: a node at an angle to the rotation axis moves less): the Bragg peaks themselves, off their nodes by about that angle (refine the UB). 12 lie farther from any node; their origin is open (another phase, multiple scattering, or an artefact)",
      ["the UB is off by at least 1.23° (the strongest off-lattice peaks sit beside Bragg nodes)"],
    ],
  ];
  for (const [why, over, kind, reasons, words, dataProblems = []] of GRAIN) {
    it(`grain: ${why}`, () => {
      expect(judge("grain", facts(over) as never)).toEqual({ check: "grain", kind, reasons, dataProblems, words, criterion: WORDS.criterion.grains });
    });
    it(`grain: ${why}, the same verdicts as a sidecar and as words`, () => {
      const g = facts(over) as unknown as GrainFacts;
      const o = judge("grain", g);
      roundTrip("grain_check", { ...shownGrains(g, o.words!), off_lattice_peaks: 900 }, [o]);
    });
  }

  // With the skills off (the validation's arm C) each check's words are their
  // definitions (inference.ts): the verdict and its numbers, with no remedy and
  // no reading of what a pattern is evidence of. Kinds, reasons and data
  // problems are the same either way; words without inference read the same.
  const OFF: Record<string, string> = {
    "the raw weight past the limit (D6)": "too far: the ΔPDF's ellipsoid window puts 0.00104 of its weight on unmeasured reciprocal space",
    "the reach past it": "too far: the transform reaches 6.61 Å⁻¹ (the window is tapered to the measured coverage), past full coverage at 6.5 Å⁻¹",
    "a file read, no symmetry declared": "not judged: the file declares no symmetry",
    "an empty declaration": "not judged: the file declares no symmetry",
    "a rotation under 2°, judged unrounded: the UB, though it reads 2°":
      "the off-lattice peaks are the crystal's own Bragg peaks with the UB off: one rotation of 2° puts 30 of the 40 strongest orbits back on the Bragg lattice (random directions: 2)",
    "too few indexed against the control":
      "no second grain of this phase: a rotated copy of the Bragg lattice indexes only 20 of the 40 strongest off-lattice orbits (random directions: 6). 37 lie farther from any node",
    "half of them beside nodes, a symmetrised volume":
      "no second grain of this phase: a rotated copy of the Bragg lattice indexes only 3 of the 40 strongest off-lattice orbits (random directions: 5). 20 of them sit within a quarter of the node spacing of a Bragg node, offset by a median 1.23° of rotation (a lower bound: a node at an angle to the rotation axis moves less)",
    "most beside nodes, unsymmetrised":
      "no second grain of this phase: a rotated copy of the Bragg lattice indexes only 3 of the 40 strongest off-lattice orbits (random directions: 5). 28 of them sit within a quarter of the node spacing of a Bragg node, offset by a median 1.23° of rotation (a lower bound: a node at an angle to the rotation axis moves less). 12 lie farther from any node",
  };
  it("with the skills off, words are their definitions: no remedy, no reading of evidence; the verdicts the same", () => {
    const cases: [string, CheckId, Obj][] = [
      ...COVERAGE.map(([why, over]) => [why, "coverage", { ...reach, ...over }] as [string, CheckId, Obj]),
      ...SYMMETRY.map(([why, m]) => [why, "symmetry", m] as [string, CheckId, Obj]),
      ...GRAIN.map(([why, over]) => [why, "grain", facts(over)] as [string, CheckId, Obj]),
    ];
    for (const [why, check, m] of cases) {
      const on = judge(check, m as never);
      const off = judge(check, m as never, { skills: false });
      expect({ ...off, words: null }, why).toEqual({ ...on, words: null });
      expect(off.words, why).toBe(why in OFF ? OFF[why] : on.words);
    }
    expect(Object.keys(OFF).every((why) => cases.some(([w]) => w === why))).toBe(true);
  });

  const UB: [string, Obj, Kind, Reason[], string[]][] = [
    ["turned under 0.05°", { fit: "both", symmetrised: false, orientation_change_deg: 0.049 }, "pass", [], []],
    ["turned 0.05°", { fit: "both", symmetrised: false, orientation_change_deg: 0.05 }, "attention", ["UB turned"], ["the UB is turned by 0.05°"]],
    ["symmetrised: not judged, so not right (D4)", { fit: "symmetric", symmetrised: true, orientation_change_deg: 0 }, "attention", ["symmetrised"], []],
    ["symmetrised: a symmetric fit's turn is no data problem (D4)", { fit: "symmetric", symmetrised: true, orientation_change_deg: 0.3 }, "attention", ["symmetrised"], []],
    ["a symmetric fit, whatever the flag says, is not judged (D4)", { fit: "symmetric", symmetrised: false, orientation_change_deg: 0.3 }, "attention", ["symmetrised"], []],
    ["a recording's angle_deg is the turn, to every reader (D4)", { angle_deg: 0.4 }, "attention", ["UB turned"], ["the UB is turned by 0.4°"]],
    ["the origin shifted", { fit: "both", symmetrised: false, orientation_change_deg: 0.001, origin_shift_rlu: [0.0305, 0.0195, 0] }, "pass", [], ["the HKL origin is shifted by (0.0305, 0.0195, 0) r.l.u."]],
    ["turned, and the origin shifted", { fit: "both", orientation_change_deg: 0.2, origin_shift_rlu: [0.03, 0, 0] }, "attention", ["UB turned"], ["the UB is turned by 0.2°", "the HKL origin is shifted by (0.03, 0, 0) r.l.u."]],
    ["no angle, not symmetrised: not judged (D16)", {}, "info", ["nothing to judge"], []],
  ];
  for (const [why, m, kind, reasons, dataProblems] of UB) {
    it(`ub: ${why}`, () => {
      expect(judge("ub", m)).toEqual({ check: "ub", kind, reasons, dataProblems, words: null });
    });
    it(`ub: ${why}, the same verdicts as a sidecar and as words`, () => roundTrip("ub_check", m, [judge("ub", m)]));
  }
});

describe("the seam: the producer's outcomes first", () => {
  it("reads a step's sidecar before its words", () => {
    const clean = { verdict: "clean: the ΔPDF's ellipsoid window puts 2.4e-4 of its weight on unmeasured reciprocal space", window_weight_on_unmeasured: 0.00024 };
    const said: Outcome = { check: "coverage", kind: "attention", reasons: ["window past limit"], dataProblems: [], words: "too far" };
    const step: AgentStep = { id: "c", name: "qmax_coverage", args: {}, status: "done", result: JSON.stringify(clean), outcomes: [said] };
    expect(verdicts({ reply: [step] }).checks.coverage).toBe("attention");
    expect(verdicts({ reply: [{ ...step, outcomes: undefined }] }).checks.coverage).toBe("pass");
    // A step that failed holds none, whatever it carries.
    expect(verdicts({ reply: [{ ...step, status: "error" }] }).checks.coverage).toBeUndefined();
  });
});

describe("judge is total", () => {
  const junk: unknown[] = [{}, { max_ring_left: "0" }, { leftover_at_nodes: Number.NaN }, { mean_median_seam_sigma: Infinity }, { per_cut: [null] }, { ops: [] }, null, undefined];
  const checks: CheckId[] = ["rings", "punch", "backfill", "flatten", "pdf", "coverage", "symmetry", "texture", "grain", "ub"];
  it("never throws; with nothing to judge it says so, and attention always says why", () => {
    for (const check of checks) {
      for (const m of junk) {
        const o = judge(check, m as never);
        expect(["pass", "attention", "info"]).toContain(o.kind);
        if (o.kind === "attention") expect(o.reasons.length).toBeGreaterThan(0);
        // No rule passes on nothing (D15, D16); the symmetry's rule holds an
        // empty list of operations kept, and the coverage's reads its counts.
        if (["rings", "punch", "backfill", "flatten", "pdf", "texture", "grain", "ub"].includes(check)) {
          expect(o, `${check} ${JSON.stringify(m)}`).toMatchObject({ kind: "info", reasons: ["nothing to judge"] });
        }
      }
    }
  });
});
