// The check-verdict module at its interface: measurements in, an outcome out
// (its kind, reasons, words and the data's problems), for every check's rule
// at its boundaries.

import { describe, expect, it } from "vitest";

import { judge, UNROUNDED, WORDS, type CheckId, type Kind, type Reason } from "../verdicts";

type Obj = Record<string, unknown>;

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
    c("sharp peaks on protected planes count (D5)", { leftover_at_nodes: 0, leftover_off_lattice_sharp: 3, leftover_on_protected_planes: 3 }, "attention", ["sharp off-lattice"]),
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
    c("an old r, no symmetry declared: not judged", { back_fft_pearson_r: 0.98, symmetry_declared: false }, "pass"),
    c("the window at the limit", { back_fft_pearson_r_even: 1, window_weight_on_unmeasured: 0.001 }, "pass", ["window within limit"]),
    c("the window past it", { back_fft_pearson_r_even: 1, window_weight_on_unmeasured: 0.0011 }, "attention", ["window past limit"]),
    c("the symmetry held to 1e-3", { max_symmetry_break: 0.001, symmetry_declared: true }, "pass"),
    c("the symmetry broken", { max_symmetry_break: 0.0011, worst_symmetry_op: "six-fold (60°)" }, "attention", ["symmetry broken"]),
    c("an asymmetry the file declares no symmetry for", { max_symmetry_break: 0.05, symmetry_declared: false }, "pass"),
    c("every fault", { back_fft_pearson_r_even: 0.9, window_weight_on_unmeasured: 0.04, max_symmetry_break: 0.05 }, "attention", ["back-FFT", "window past limit", "symmetry broken"]),
    c("faults, the window within", { back_fft_pearson_r_even: 0.9, window_weight_on_unmeasured: 1e-4 }, "attention", ["back-FFT", "window within limit"]),
    // D15: the ΔPDF's rule passes an evaluation that measured nothing.
    c("nothing measured (D15)", { back_fft_pearson_r: null, window_weight_on_unmeasured: null, max_symmetry_break: null }, "pass"),
  ],
};

describe("judge: a stage's evaluation", () => {
  for (const [stage, cases] of Object.entries(STAGE_CASES) as [keyof typeof STAGE_CASES, Case[]][]) {
    for (const x of cases) {
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

  it("compares the ΔPDF's window as its evaluation shows it, its raw weight kept beside (D6)", () => {
    // evaluate.ts writes the weight at two figures, and keeps the raw one where JSON never reads it.
    const shown = { back_fft_pearson_r_even: 1, window_weight_on_unmeasured: 0.001, [UNROUNDED]: { window_weight_on_unmeasured: 0.00104 } };
    expect(judge("pdf", shown)).toMatchObject({ kind: "pass", reasons: ["window within limit"] });
    expect(JSON.stringify(shown)).toBe('{"back_fft_pearson_r_even":1,"window_weight_on_unmeasured":0.001}');
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
    ["the raw weight past the limit (D6)", { window_weight: 0.00104 }, "attention", ["window past limit"], "too far: the ΔPDF's ellipsoid window puts 0.001 of its weight on unmeasured reciprocal space; taper it to the coverage (pdfWindowSupport) or set a |Q| band"],
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
  }

  it("texture: a cut whose fill is biased one way needs attention; no cut, nothing to judge", () => {
    const cut = (bias: boolean) => ({ cut: "H–K plane at L = 0", systematic_fill_bias: bias });
    expect(judge("texture", { per_cut: [cut(false), cut(true)] })).toEqual({ check: "texture", kind: "attention", reasons: ["fill bias"], dataProblems: [], words: null });
    expect(judge("texture", { per_cut: [cut(false)] })).toMatchObject({ kind: "pass", reasons: [], words: null });
    expect(judge("texture", { per_cut: [] })).toMatchObject({ kind: "info", reasons: ["nothing to judge"] });
    expect(judge("texture", {})).toMatchObject({ kind: "info", reasons: ["nothing to judge"] });
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
  const GRAIN: [string, Obj, Kind, Reason[], string][] = [
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
    ],
    [
      "most beside nodes, unsymmetrised",
      { near_bragg_nodes: 28 },
      "attention",
      ["no second grain", "peaks beside nodes"],
      "no second grain of this phase: a rotated copy of the Bragg lattice indexes only 3 of the 40 strongest off-lattice orbits (random directions: 5). 28 of them sit within a quarter of the node spacing of a Bragg node, offset by a median 1.23° of rotation (a lower bound: a node at an angle to the rotation axis moves less): the Bragg peaks themselves, off their nodes by about that angle (refine the UB). 12 lie farther from any node; their origin is open (another phase, multiple scattering, or an artefact)",
    ],
  ];
  for (const [why, over, kind, reasons, words] of GRAIN) {
    it(`grain: ${why}`, () => {
      expect(judge("grain", facts(over) as never)).toEqual({ check: "grain", kind, reasons, dataProblems: [], words, criterion: WORDS.criterion.grains });
    });
  }

  const UB: [string, Obj, Kind, Reason[], string[]][] = [
    ["turned under 0.05°", { fit: "both", symmetrised: false, orientation_change_deg: 0.049 }, "pass", [], []],
    ["turned 0.05°", { fit: "both", symmetrised: false, orientation_change_deg: 0.05 }, "attention", ["UB turned"], ["the UB is turned by 0.05°"]],
    ["symmetrised: not judged right (D4)", { fit: "symmetric", symmetrised: true, orientation_change_deg: 0 }, "attention", ["symmetrised"], []],
    ["a symmetric fit's turn is no data problem (D4)", { fit: "symmetric", symmetrised: false, orientation_change_deg: 0.3 }, "attention", ["UB turned"], []],
    ["a recording's angle_deg, for the answer checks only (D4)", { angle_deg: 0.4 }, "attention", ["UB turned"], []],
    ["the origin shifted", { fit: "both", symmetrised: false, orientation_change_deg: 0.001, origin_shift_rlu: [0.0305, 0.0195, 0] }, "pass", [], ["the HKL origin is shifted by (0.0305, 0.0195, 0) r.l.u."]],
    ["turned, and the origin shifted", { fit: "both", orientation_change_deg: 0.2, origin_shift_rlu: [0.03, 0, 0] }, "attention", ["UB turned"], ["the UB is turned by 0.2°", "the HKL origin is shifted by (0.03, 0, 0) r.l.u."]],
    ["no angle, not symmetrised: right (D16)", {}, "pass", [], []],
  ];
  for (const [why, m, kind, reasons, dataProblems] of UB) {
    it(`ub: ${why}`, () => {
      expect(judge("ub", m)).toEqual({ check: "ub", kind, reasons, dataProblems, words: null });
    });
  }
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
        // D15 and D16 are the rules that pass on nothing; the symmetry's
        // rule holds an empty list of operations kept.
        if (["rings", "punch", "backfill", "flatten", "texture", "grain"].includes(check)) {
          expect(o, `${check} ${JSON.stringify(m)}`).toMatchObject({ kind: "info", reasons: ["nothing to judge"] });
        }
      }
    }
  });
});
