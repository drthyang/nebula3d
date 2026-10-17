// The analysis report: assembled from measured tool results (never from the
// model's text), judged by each check's stated criterion, and rendered as a
// self-contained HTML page and as Markdown with every piece of text escaped.

import { describe, expect, it } from "vitest";

import type { Slice } from "../../api/types";
import { rasterize } from "../report/figures";
import { reportHtml, reportMarkdown } from "../report/render";
import { buildReport, fmt, stageCheck, type ReportInput } from "../report/report";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

// Made-up numbers in the shape of a real run (assess_stage all, texture_check, qmax_coverage, symmetry_check).
const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  created: new Date("2026-10-10T14:00:00Z"),
  question: "Assess the run <script>alert(1)</script>",
  answer: "Ring removal is **not clean**: a ring is left at 7.2 Å⁻¹.",
  steps: [
    { tool: "assess_stage", summary: "Ring removal: ring ratio 0.912", ok: true },
    { tool: "qmax_coverage", summary: "clean", ok: true },
  ],
  model: { provider: "LM Studio", model: "meta/muse-glimmer", local: true },
  dataset: { label: "150K", rawName: "sample_150K.nxs", temperature: "150K" },
  settings: [{ stage: "pdf", values: { pdfApod: "gaussian", pdfWindowShape: "auto" } }],
  sampleFacts: { punchCell: "2,2,2" },
  tuning: null,
  measured: {
    describe: {
      stages: ["raw", "flattened", "delta_pdf"],
      reciprocal: { grid: [401, 401, 401], H: [-20, 20], K: [-20, 20], L: [-20, 20] },
      cell: { a: 6.12, b: 6.11, c: 9.41, alpha: 90, beta: 90, gamma: 120 },
      delta_pdf: { grid: [405, 405, 405], x: [-34, 34], y: [-34, 34], z: [-42, 42] },
    },
    rings: { mean_ring_energy_ratio: 0.912, max_over_subtraction_fraction: 0, max_ring_dent: 0, max_ring_left: 0.37, worst_ring_left: { plane: "0kl", at: 7.2 }, single_plane_bumps: [{}, {}, {}] },
    punch: { leftover_at_nodes: 12, leftover_off_lattice_sharp: 5, leftover_off_lattice_broad: 240, mean_punched_fraction: 0.081, fitted_peaks: 12045 },
    backfill: { mean_median_seam_sigma: 0.0712, max_bright_fill_fraction: 0.000275 },
    flatten: { max_after_floor_sigma: 0.352, max_floor_trend: 0.141, max_floor_span_fraction: 0.33 },
    pdf: { back_fft_pearson_r: 1, back_fft_normalized_rms: 5.1e-15, mean_feature_snr: 950, window_weight_on_unmeasured: 4.1e-6, window_shape: "ellipsoid" },
    texture: { per_cut: [{ systematic_fill_bias: false }, { systematic_fill_bias: false }, { systematic_fill_bias: false }] },
    coverage: { verdict: "clean: the window puts 4.1e-6 of its weight on unmeasured reciprocal space", raw_counts: { q_min_edge: 0.61, q_max_edge: 14.2, box_face_q: 11.05 }, band_check: "no |Q| band is set" },
    symmetry: { verdict: "kept: every in-plane operation holds to 0.001 or better" },
  },
  figures: [
    { title: "Raw, H–K plane at L = 0", caption: "shared scale", dataUrl: PNG },
    { title: "Not a PNG", caption: "dropped", dataUrl: "javascript:alert(1)" },
  ],
  ...over,
});

describe("buildReport", () => {
  it("judges each stage by its stated criterion, from the measured numbers", () => {
    const r = buildReport(input());
    const verdict = Object.fromEntries(r.checks.map((c) => [c.title, c.verdict]));
    expect(verdict).toEqual({ "Ring removal": "attention", "Bragg punch": "attention", Backfill: "pass", Flatten: "pass", "3D-ΔPDF": "pass" });
    expect(r.kind).toBe("Assessment");
    expect(r.checks[0].headline).toContain("left ≤ 0.37 (0kl, 7.2 Å⁻¹)");
    expect(r.checks[0].criterion).toMatch(/^No powder ring left above, or dented below, three times its plane's noise/);
    expect(r.dataset.cell).toBe("a = 6.12 Å, b = 6.11 Å, c = 9.41 Å; α, β, γ = 90°, 90°, 120°");
    expect(r.dataset.grid).toBe("401 × 401 × 401");
    // Every miss becomes a caveat, with its numbers; the narrative is labelled the model's.
    expect(r.caveats.some((c) => c.startsWith("Bragg punch: 12 missed at nodes"))).toBe(true);
    expect(r.caveats.some((c) => /summary is written by the model/.test(c))).toBe(true);
  });

  it("says which stages were not measured, and what a tuning run changed or refused", () => {
    const r = buildReport(
      input({
        measured: { ...input().measured, flatten: null },
        steps: [{ tool: "tune_pipeline", summary: "Tuned", ok: true }],
        tuning: [
          {
            stage: "pdf",
            why: "Your settings are kept. Trial 2 was not a candidate: its window puts 0.043 of its weight on unmeasured reciprocal space.",
            trials: [
              { n: 1, changes: "your settings", headline: "r 1", chosen: true },
              { n: 2, changes: "pdfWindowShape=separable", headline: "r 1", chosen: false },
            ],
          },
          { stage: "punch", why: "fewer leftovers", trials: [{ n: 1, changes: "your settings", headline: "", chosen: false }, { n: 2, changes: "punchMinSig=3", headline: "", chosen: true }] },
        ],
      }),
    );
    expect(r.kind).toBe("Tuning");
    expect(r.caveats).toContain("Not measured (no output, or the measurement failed): Flatten.");
    expect(r.caveats.some((c) => /Tuning, 3D-ΔPDF: .*Trial 2 was not a candidate/.test(c))).toBe(true);
    expect(r.caveats.some((c) => /Tuning, Bragg punch: the model's proposal punchMinSig=3 replaced your settings/.test(c))).toBe(true);
  });

  it("reports the second-grain test, and flags displaced Bragg peaks as well as a grain", () => {
    const grains = {
      off_lattice_peaks: 900,
      off_lattice_orbits: 72,
      judged: 40,
      near_bragg_nodes: 28,
      near_offset_angle_deg: { median: 1.2, quartiles: [0.9, 1.6] },
      far: [{ q: 6.45 }, { q: 3.87 }],
      rotated_copy: { indexed: 3, misorientation_deg: 24.5 },
      random_control: 5,
      verdict: "no second grain of this phase: a rotated copy of the Bragg lattice indexes only 3 of the 40 strongest off-lattice orbits (random directions: 5). 28 of them sit within a quarter of the node spacing of a Bragg node",
    };
    const r = buildReport(input({ measured: { ...input().measured, grains } }));
    const g = r.checks.find((c) => c.title === "Second grain")!;
    expect(r.checks.map((c) => c.title).indexOf("Second grain")).toBe(2); // after the punch
    expect(g.verdict).toBe("attention");
    expect(g.headline).toBe("one grain, UB off · 28 of 40 orbits beside Bragg nodes (≥ 1.2°) · one rotation indexes 3, random 5");
    expect(g.details).toContainEqual(["Farther from any node (strongest, |Q| in Å⁻¹)", "6.45, 3.87"]);
    expect(g.criterion).toMatch(/^One grain, its UB right/);

    const clean = buildReport(input({ measured: { ...input().measured, grains: { ...grains, near_bragg_nodes: 3, near_offset_angle_deg: null, verdict: "no second grain of this phase: …" } } }));
    expect(clean.checks.find((c) => c.title === "Second grain")!.verdict).toBe("pass");
    const twin = buildReport(input({ measured: { ...input().measured, grains: { ...grains, near_bragg_nodes: 1, verdict: "a second grain: one rotation …" } } }));
    expect(twin.checks.find((c) => c.title === "Second grain")!.headline.startsWith("a second grain")).toBe(true);
    expect(twin.caveats.some((c) => c.startsWith("Second grain: a second grain"))).toBe(true);
  });

  it("prints tiny and huge numbers in exponent form", () => {
    expect(fmt(4.1e-6)).toBe("4.1e-6");
    expect(fmt(2.5e6)).toBe("2.5e+6");
    expect(fmt(0.912)).toBe("0.912");
    expect(fmt(12045)).toBe("12045"); // a count is not rounded
    expect(fmt(null)).toBe("–");
  });
});

describe("rendering", () => {
  it("makes a self-contained HTML page with every piece of text escaped", () => {
    const html = reportHtml(buildReport(input()));
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).not.toContain("<script>");
    expect(html).toContain("Assess the run &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toMatch(/(src|href)="https?:/); // nothing fetched from elsewhere
    expect(html).toContain(`<img src="${PNG}"`);
    expect(html).not.toContain("javascript:"); // only PNG data URLs are images
    expect(html).toContain("<strong>not clean</strong>"); // the model's Markdown, rendered
    expect(html).toContain("needs attention");
  });

  it("writes the same report as Markdown", () => {
    const md = reportMarkdown(buildReport(input()));
    expect(md.split("\n")[0]).toBe("# NEBULA Pilot report — 150K");
    expect(md).toContain("| Bragg punch | needs attention | 12 missed at nodes · 5 sharp off-lattice · 240 broad maxima kept · punched 0.081 |");
    expect(md).toContain(`![Raw, H–K plane at L = 0](${PNG})`);
    expect(md).not.toContain("javascript:");
    expect(md).toContain("## The model's summary");
  });
});

describe("rasterize", () => {
  const slice = (angle: number): Slice => {
    const n = 21;
    const axis = Array.from({ length: n }, (_v, i) => i - 10);
    const data = new Float32Array(n * n);
    data[(10 + 5) * n + (10 + 5)] = 100; // the voxel at (x, y) = (5, 5)
    data[10 * n + 0] = NaN;
    return { header: { nx: n, ny: n, x_axis: axis, y_axis: axis, x_label: "x", y_label: "y", cut_label: "", robust_max: 100, axes_angle: angle }, data };
  };
  const at = (rgba: Uint8ClampedArray, n: number, X: number, Y: number, half: number) => {
    const cc = Math.floor(((X + half) / (2 * half)) * n);
    const rr = Math.floor(((half - Y) / (2 * half)) * n);
    return Array.from(rgba.slice((rr * n + cc) * 4, (rr * n + cc) * 4 + 3));
  };
  const opts = { n: 84, half: 21, colormap: "inferno", scale: "lin" as const, levels: { lo: 0, hi: 100, soft: 1 }, diverging: false };

  it("puts a voxel where the viewers draw it, y up, oblique axes at their angle", () => {
    const square = rasterize(slice(90), opts);
    expect(at(square, 84, 5, 5, 21)).not.toEqual([0, 0, 4]); // hot, not the colormap's floor
    // On a 120° grid (5, 5) in axis units sits at X = 5 + 5·cos120° = 2.5, Y = 5·sin120°.
    const hex = rasterize(slice(120), opts);
    const hot = at(hex, 84, 2.5, 5 * Math.sin((2 * Math.PI) / 3), 21);
    expect(hot).toEqual(at(square, 84, 5, 5, 21));
    expect(at(hex, 84, 5, 5, 21)).not.toEqual(hot);
  });

  it("draws masked voxels grey and the space outside the data dark", () => {
    const r = rasterize(slice(90), opts);
    expect(at(r, 84, -10, 0, 21)).toEqual([128, 128, 128]);
    expect(at(r, 84, 20.5, 20.5, 21)).toEqual([13, 17, 23]);
  });
});

describe("a stage's check states only what it judges", () => {
  it("judges the 3D-ΔPDF's symmetry from its worst in-plane break", () => {
    const base = { back_fft_pearson_r: 0.9995, window_weight_on_unmeasured: 1e-4 };
    const broken = stageCheck("pdf", { ...base, max_symmetry_break: 0.05, worst_symmetry_op: "six-fold (60°)" });
    expect(broken?.verdict).toBe("attention");
    expect(broken?.headline).toMatch(/symmetry broken/);
    expect(stageCheck("pdf", { ...base, max_symmetry_break: 5e-4 })?.verdict).toBe("pass");
    expect(stageCheck("pdf", base)?.verdict).toBe("pass");
  });

  it("judges the flatten by the pedestal rule, and reports its floor in σ without judging it", () => {
    // The validation's dev volumes (docs/pilot-review.md finding 6): floors of
    // 1.5 to 1.8σ on all eight, whatever the flatten did.
    const control = stageCheck("flatten", { max_after_floor_sigma: 1.72, max_floor_trend: 0.314, max_floor_span_fraction: 0.601, pedestal_left: false })!;
    expect(control.verdict).toBe("pass"); // "needs attention" under the 1σ clause
    expect(control.details).toContainEqual(["Largest leftover floor (reported, not judged)", "1.72 σ"]);
    expect(control.criterion).toMatch(/^No pedestal: .* The largest floor in σ is reported, not judged/);
    const planted = { max_after_floor_sigma: 1.8, max_floor_trend: 0.975, max_floor_span_fraction: 0.971 };
    expect(stageCheck("flatten", planted)!.verdict).toBe("attention");
    expect(stageCheck("flatten", { max_after_floor_sigma: 1.52, max_floor_trend: 0.025, max_floor_span_fraction: 0.333 })!.verdict).toBe("pass");
    expect(stageCheck("flatten", { max_after_floor_sigma: 0.8 })!.verdict).toBe("info"); // no trend or span: nothing judged
  });

  it("does not promise a fill-bias check a stage's evaluation never makes", () => {
    const c = stageCheck("backfill", { mean_median_seam_sigma: 0.6 });
    expect(c?.verdict).toBe("pass");
    expect(c?.criterion).toMatch(/texture_check's to say/);
    expect(c?.criterion).not.toMatch(/no cut whose fill is biased/);
  });
});
