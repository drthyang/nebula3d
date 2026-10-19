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

describe("judge is total", () => {
  const junk: unknown[] = [{}, { max_ring_left: "0" }, { leftover_at_nodes: Number.NaN }, { mean_median_seam_sigma: Infinity }, null, undefined];
  const checks: CheckId[] = ["rings", "punch", "backfill", "flatten", "pdf"];
  it("never throws; with nothing to judge it says so, and attention always says why", () => {
    for (const check of checks) {
      for (const m of junk) {
        const o = judge(check, m as Obj);
        expect(["pass", "attention", "info"]).toContain(o.kind);
        if (o.kind === "attention") expect(o.reasons.length).toBeGreaterThan(0);
        // D15 is the one rule that passes on nothing.
        if (check !== "pdf") expect(o).toMatchObject({ kind: "info", reasons: ["nothing to judge"] });
      }
    }
  });
});
