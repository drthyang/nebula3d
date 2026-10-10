// The analysis report: assembled from measured tool results (never from the
// model's text), judged by each stage's stated goal, and rendered as a
// self-contained HTML page and as Markdown with every piece of text escaped.

import { describe, expect, it } from "vitest";

import type { Slice } from "../../api/types";
import { rasterize } from "../report/figures";
import { reportHtml, reportMarkdown } from "../report/render";
import { buildReport, fmt, type ReportInput } from "../report/report";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

// Numbers from a measured run (assess_stage all, texture_check, qmax_coverage, symmetry_check).
const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  created: new Date("2026-10-10T14:00:00Z"),
  question: "Assess the run <script>alert(1)</script>",
  answer: "Ring removal is **not clean**: a ring is left at 10.3 Å⁻¹.",
  steps: [
    { tool: "assess_stage", summary: "Ring removal: ring ratio 0.954", ok: true },
    { tool: "qmax_coverage", summary: "clean", ok: true },
  ],
  model: { provider: "LM Studio", model: "meta/muse-glimmer", local: true },
  dataset: { label: "90K", rawName: "sample_90K.nxs", temperature: "90K" },
  settings: [{ stage: "pdf", values: { pdfApod: "gaussian", pdfWindowShape: "auto" } }],
  sampleFacts: { punchCell: "2,2,2" },
  tuning: null,
  measured: {
    describe: {
      stages: ["raw", "flattened", "delta_pdf"],
      reciprocal: { grid: [401, 401, 401], H: [-20, 20], K: [-20, 20], L: [-20, 20] },
      cell: { a: 8.03, b: 8.02, c: 10.03, alpha: 90, beta: 90, gamma: 120 },
      delta_pdf: { grid: [405, 405, 405], x: [-34, 34], y: [-34, 34], z: [-42, 42] },
    },
    rings: { mean_ring_energy_ratio: 0.954, max_over_subtraction_fraction: 0, max_ring_dent: 0, max_ring_left: 0.408, worst_ring_left: { plane: "0kl", at: 10.3 }, single_plane_bumps: [{}, {}, {}] },
    punch: { leftover_at_nodes: 16, leftover_off_lattice_sharp: 8, leftover_off_lattice_broad: 360, mean_punched_fraction: 0.099, fitted_peaks: 16681 },
    backfill: { mean_median_seam_sigma: 0.0848, max_bright_fill_fraction: 0.000312 },
    flatten: { max_after_floor_sigma: 0.411, max_floor_trend: 0.129, max_floor_span_fraction: 0.378 },
    pdf: { back_fft_pearson_r: 1, back_fft_normalized_rms: 6.46e-15, mean_feature_snr: 1180, window_weight_on_unmeasured: 3.2e-6, window_shape: "ellipsoid" },
    texture: { per_cut: [{ systematic_fill_bias: false }, { systematic_fill_bias: false }, { systematic_fill_bias: false }] },
    coverage: { verdict: "clean: the window puts 3.2e-6 of its weight on unmeasured reciprocal space", raw_counts: { q_min_edge: 0.519, q_max_edge: 16.7, box_face_q: 12.53 }, band_check: "no |Q| band is set" },
    symmetry: { verdict: "kept: every in-plane operation holds to 0.001 or better" },
  },
  figures: [
    { title: "Raw, H–K plane at L = 0", caption: "shared scale", dataUrl: PNG },
    { title: "Not a PNG", caption: "dropped", dataUrl: "javascript:alert(1)" },
  ],
  goals: { rings: "Remove powder rings.", punch: "Missed lattice peaks must reach 0." },
  ...over,
});

describe("buildReport", () => {
  it("judges each stage by its stated goal, from the measured numbers", () => {
    const r = buildReport(input());
    const verdict = Object.fromEntries(r.checks.map((c) => [c.title, c.verdict]));
    expect(verdict).toEqual({ "Ring removal": "attention", "Bragg punch": "attention", Backfill: "pass", Flatten: "pass", "3D-ΔPDF": "pass" });
    expect(r.kind).toBe("Assessment");
    expect(r.checks[0].headline).toContain("left ≤ 0.408 (0kl, 10.3 Å⁻¹)");
    expect(r.checks[0].goal).toBe("Remove powder rings.");
    expect(r.dataset.cell).toBe("a = 8.03 Å, b = 8.02 Å, c = 10.03 Å; α, β, γ = 90°, 90°, 120°");
    expect(r.dataset.grid).toBe("401 × 401 × 401");
    // Every miss becomes a caveat, with its numbers; the narrative is labelled the model's.
    expect(r.caveats.some((c) => c.startsWith("Bragg punch: 16 missed at nodes"))).toBe(true);
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
            why: "Your settings are kept. Trial 2 was not a candidate: its window puts 0.057 of its weight on unmeasured reciprocal space.",
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

  it("prints tiny and huge numbers in exponent form", () => {
    expect(fmt(3.2e-6)).toBe("3.2e-6");
    expect(fmt(2.5e6)).toBe("2.5e+6");
    expect(fmt(0.954)).toBe("0.954");
    expect(fmt(16681)).toBe("16681"); // a count is not rounded
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
    expect(md.split("\n")[0]).toBe("# NEBULA Pilot report — 90K");
    expect(md).toContain("| Bragg punch | needs attention | 16 missed at nodes · 8 sharp off-lattice · 360 broad maxima kept · punched 0.099 |");
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
