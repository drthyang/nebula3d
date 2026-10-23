// The analysis report: assembled from measured tool results (never from the
// model's text), judged by each check's stated criterion, and rendered as a
// self-contained HTML page and as Markdown with every piece of text escaped.

import { describe, expect, it } from "vitest";

import type { Slice } from "../../api/types";
import { rasterize } from "../report/figures";
import { reportHtml, reportMarkdown } from "../report/render";
import { buildReport, fmt, type ReportInput } from "../report/report";
import { judge, verdicts, type Outcome } from "../verdicts";

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

// A run on a grid too coarse for the ring check (made-up numbers): the ring removal
// left four ring candidates unconfirmed, and says so; every other stage meets its goal.
const NOTICE_DEFINITION =
  "4 ring candidates (shells that may be powder rings or the crystal's own scattering) detected but not confirmed at this grid (needs ≥ 1 voxel across 0.16 Å⁻¹); not subtracted.";
const NOTICE = `${NOTICE_DEFINITION} Use a finer grid, or, from the Python API, set pooled_confirm_rings=False to subtract every candidate, the crystal's own shells included.`;
const COARSE = "grid too coarse: 0.99 voxels across a ring's width (at most 0.16 Å⁻¹), under 1";
const COARSE_RUN = {
  ...input().measured,
  rings: { notice: NOTICE, mean_ring_energy_ratio: 1, max_over_subtraction_fraction: 0, max_ring_dent: null, max_ring_left: null, ring_rule: `not judged: ${COARSE}` },
  punch: { leftover_at_nodes: 0, leftover_off_lattice_sharp: 0 },
};

describe("buildReport", () => {
  it("judges each stage by its stated criterion, from the measured numbers", () => {
    const r = buildReport(input());
    const verdict = Object.fromEntries(r.checks.map((c) => [c.title, c.verdict]));
    expect(verdict).toEqual({ "Ring removal": "attention", "Bragg punch": "attention", Backfill: "pass", "Background correction": "pass", "3D-ΔPDF": "pass" });
    // Whether the goal is met is computed from those checks, not taken from the model's words.
    expect(r.achieved).toEqual({ met: false, text: "not met: needs attention: Ring removal, Bragg punch" });
    expect(reportMarkdown(r)).toContain("**Goal: not met: needs attention: Ring removal, Bragg punch.** *Computed from the checks below, not from the model's words.*");
    expect(reportHtml(r)).toContain("<b>Goal: not met: needs attention: Ring removal, Bragg punch.</b>");
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
    expect(r.caveats).toContain("Not measured (no output, or the measurement failed): Background correction.");
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

describe("a card states only what it judges", () => {
  it("shows the symmetry_check's verdict on the 3D-ΔPDF's card", () => {
    const r = buildReport(input({ measured: { ...input().measured, symmetry: { verdict: "not kept: six-fold (60°) (0.05)" } } }));
    const pdf = r.checks.find((c) => c.title === "3D-ΔPDF")!;
    expect(pdf.verdict).toBe("attention");
    expect(pdf.headline).toMatch(/ · symmetry broken$/);
  });

  it("counts qmax_coverage's \"too far\" on the 3D-ΔPDF's card, though the evaluation's weight is within the limit (D2, 2.4.2)", () => {
    // Synthetic measurements: the window reaches 9.1 Å⁻¹ (to zero at the box faces), past full coverage at 6.5 Å⁻¹; then 6.283 Å⁻¹, inside it.
    const reach = { window_weight: null, window: "the ΔPDF's ellipsoid window", unit_cell: true, full_coverage_q: 6.5, shell: 0.1, band_set: false, counts: { counts_end_inside_box: false } };
    const past = judge("coverage", { ...reach, reach: 9.1, reach_from: "the window tapers to zero at the box faces" });
    const inside = judge("coverage", { ...reach, reach: 6.283, reach_from: "the window is tapered to the measured coverage" });
    const card = (coverage: Outcome, kept: boolean) => {
      const measured = { ...input().measured, coverage: { verdict: coverage.words, window_weight_on_unmeasured: null }, ...(kept ? { outcomes: [coverage] } : {}) };
      return buildReport(input({ measured }));
    };
    // As the measurement pass keeps the tool's outcome, and as its words read.
    for (const kept of [true, false]) {
      const r = card(past, kept);
      expect(r.checks.find((c) => c.title === "3D-ΔPDF")!.verdict).toBe("attention");
      expect(r.achieved.text).toBe("not met: needs attention: Ring removal, Bragg punch, 3D-ΔPDF");
      expect(card(inside, kept).checks.find((c) => c.title === "3D-ΔPDF")!.verdict).toBe("pass");
    }
    expect(card(past, true).checks.find((c) => c.title === "3D-ΔPDF")!.details).toContainEqual(["Coverage", past.words]);
  });

  it("counts the punch's sharp leftovers outside the protected planes, and shows those on them on their own line (D5, 2.4.5b)", () => {
    // Synthetic measurements: five sharp off-lattice leftovers, three of them on protected planes.
    const punch = { leftover_at_nodes: 0, leftover_off_lattice_sharp: 5, leftover_on_protected_planes: 4, leftover_on_protected_planes_sharp: 3, leftover_off_lattice_broad: 7, mean_punched_fraction: 0.03 };
    const card = (m: Record<string, unknown>) => buildReport(input({ measured: { ...input().measured, punch: m } })).checks.find((c) => c.title === "Bragg punch")!;
    const two = card(punch);
    expect(two.verdict).toBe("attention");
    // The headline names them too, so nothing on those planes goes unsaid.
    expect(two.headline).toBe("0 missed at nodes · 2 sharp off-lattice (3 more on protected planes, kept) · 7 broad maxima kept · punched 0.03");
    expect(two.details).toContainEqual(["Sharp off-lattice leftovers (outside the protected planes)", "2"]);
    expect(two.details).toContainEqual(["Sharp leftovers on protected planes (kept by design)", "3"]);
    expect(two.criterion).toMatch(/no sharp peak left off the lattice outside the protected planes/);
    // All of them on the protected planes: none counted, and the card passes.
    const none = card({ ...punch, leftover_off_lattice_sharp: 3 });
    expect([none.verdict, none.headline]).toEqual(["pass", "0 missed at nodes · 0 sharp off-lattice (3 more on protected planes, kept) · 7 broad maxima kept · punched 0.03"]);
    // An evaluation recorded without the split counts every sharp one, under the old label.
    const old = card({ leftover_at_nodes: 0, leftover_off_lattice_sharp: 5, leftover_on_protected_planes: 4 });
    expect(old.details).toContainEqual(["Sharp off-lattice leftovers", "5"]);
    expect(old.details.map(([k]) => k)).not.toContain("Sharp leftovers on protected planes (kept by design)");
  });

  it("leaves the 3D-ΔPDF's card not judged without a ΔPDF evaluation, unless the coverage or the symmetry needs attention (D9, 2.4.9)", () => {
    // Synthetic measurements: every other stage passes; no ΔPDF evaluation was run.
    const sound = { ...input().measured, rings: { max_ring_left: 0, max_ring_dent: 0 }, punch: { leftover_at_nodes: 0, leftover_off_lattice_sharp: 0 }, pdf: null };
    const r = buildReport(input({ measured: sound }));
    expect(r.checks.find((c) => c.title === "3D-ΔPDF")!.verdict).toBe("info");
    expect(r.achieved).toEqual({ met: null, text: "not judged: not measured: 3D-ΔPDF" });
    expect(reportMarkdown(r)).toContain("| 3D-ΔPDF | not judged |");
    // The coverage too far (a separable window putting 0.04 of its weight on unmeasured space): the card needs attention.
    const far = judge("coverage", { window_weight: 0.04, window: "the ΔPDF's separable window", unit_cell: true, full_coverage_q: null, reach: null, reach_from: "", shell: 0.1, band_set: false, counts: { counts_end_inside_box: false } });
    const r2 = buildReport(input({ measured: { ...sound, coverage: { verdict: far.words, window_weight_on_unmeasured: 0.04 } } }));
    expect(r2.checks.find((c) => c.title === "3D-ΔPDF")!.verdict).toBe("attention");
    expect(r2.achieved).toEqual({ met: false, text: "not met: needs attention: 3D-ΔPDF" });
  });

  it("names a turned UB in its goal, as {{achieved}} does, from ub_check's result (Q11, 2.4.11)", () => {
    // Synthetic measurements: every stage passes; ub_check's fit turned the UB by 0.6° and found the origin shifted.
    const sound = { ...input().measured, rings: { max_ring_left: 0, max_ring_dent: 0 }, punch: { leftover_at_nodes: 0, leftover_off_lattice_sharp: 0 } };
    const ub = { fit: "both", symmetrised: false, orientation_change_deg: 0.6, origin_shift_rlu: [0.03, 0, 0] };
    const goal = "met: every stage meets its goal; data problems no setting fixes: the UB is turned by 0.6°; the HKL origin is shifted by (0.03, 0, 0) r.l.u.";
    // As the measurement pass keeps the tool's outcome, and from its result.
    for (const measured of [{ ...sound, ub, outcomes: [judge("ub", ub)] }, { ...sound, ub }]) {
      const r = buildReport(input({ measured }));
      expect(r.achieved).toEqual({ met: true, text: goal });
      expect(reportMarkdown(r)).toContain(`**Goal: ${goal}.**`);
    }
    // A right UB names nothing; a symmetrised volume's UB is not judged, and names nothing either.
    expect(buildReport(input({ measured: { ...sound, ub: { fit: "both", symmetrised: false, orientation_change_deg: 0.01 } } })).achieved.text).toBe("met: every stage meets its goal");
    expect(buildReport(input({ measured: { ...sound, ub: { fit: "symmetric", symmetrised: true, orientation_change_deg: 0.3 } } })).achieved.text).toBe("met: every stage meets its goal");
  });

  it("counts the ΔPDF evaluation's own symmetry break on its card, symmetry_check kept or not run (D13, 2.4b.4)", () => {
    // Synthetic: a sound round trip, the window inside, and an x–y section off its six-fold by 0.05 on data declared symmetrised.
    const sound = { ...input().measured, rings: { max_ring_left: 0, max_ring_dent: 0 }, punch: { leftover_at_nodes: 0, leftover_off_lattice_sharp: 0 } };
    const pdf = { back_fft_pearson_r_even: 1, window_weight_on_unmeasured: 1e-4, max_symmetry_break: 0.05, worst_symmetry_op: "six-fold (60°)", symmetry_declared: true };
    for (const symmetry of [input().measured.symmetry, null]) {
      const r = buildReport(input({ measured: { ...sound, pdf, symmetry } }));
      expect(r.checks.find((c) => c.title === "3D-ΔPDF")!.verdict).toBe("attention");
      expect(r.achieved.text).toBe("not met: needs attention: 3D-ΔPDF");
    }
    // Held to 1e-3: a pass.
    expect(buildReport(input({ measured: { ...sound, pdf: { ...pdf, max_symmetry_break: 0.001 } } })).checks.find((c) => c.title === "3D-ΔPDF")!.verdict).toBe("pass");
  });

  it("counts a fill bias on the Backfill card whether or not it judged the seam, made for it when the backfill was not measured (D14, 2.4b.4)", () => {
    // Synthetic: one of two cuts filled systematically one way; the seam not measured, or the backfill not measured at all.
    const texture = { per_cut: [{ systematic_fill_bias: true }, { systematic_fill_bias: false }] };
    const sound = { ...input().measured, rings: { max_ring_left: 0, max_ring_dent: 0 }, punch: { leftover_at_nodes: 0, leftover_off_lattice_sharp: 0 }, texture };
    for (const backfill of [{ max_bright_fill_fraction: 0 }, null]) {
      const r = buildReport(input({ measured: { ...sound, backfill } }));
      const card = r.checks.find((c) => c.title === "Backfill")!;
      expect(card.verdict).toBe("attention");
      expect(card.headline).toMatch(/ · fill bias on 1 of 2 cuts$/);
      expect(r.achieved.text).toBe("not met: needs attention: Backfill");
    }
  });

  it("leaves the 3D-ΔPDF's card not judged when its evaluation measured nothing (D15, 2.4b.5)", () => {
    // Synthetic: an evaluation with no round trip, no window weight and no section symmetry; the coverage clean.
    const sound = { ...input().measured, rings: { max_ring_left: 0, max_ring_dent: 0 }, punch: { leftover_at_nodes: 0, leftover_off_lattice_sharp: 0 } };
    const nothing = { back_fft_pearson_r: null, back_fft_pearson_r_even: null, window_weight_on_unmeasured: null, max_symmetry_break: null };
    const r = buildReport(input({ measured: { ...sound, pdf: nothing } }));
    expect(r.checks.find((c) => c.title === "3D-ΔPDF")!.verdict).toBe("info");
    expect(r.achieved).toEqual({ met: null, text: "not judged: not measured: 3D-ΔPDF" }); // met before 2.4b.5
    // As a reply's {{achieved}} reads it.
    expect(verdicts({ reply: [{ id: "a", name: "assess_stage", args: { stage: "pdf" }, status: "done", result: JSON.stringify({ pdf: nothing }) }] }).achieved?.stages.pdf).toBe("info");
  });

  it("says the ring candidates the removal left unconfirmed on its grid on its card and among the caveats (G1)", () => {
    const r = buildReport(input({ measured: COARSE_RUN }));
    const card = r.checks.find((c) => c.title === "Ring removal")!;
    expect(card.verdict).toBe("info");
    expect(card.details[0]).toEqual(["Not subtracted", NOTICE]);
    expect(card.details).toContainEqual(["Not judged", COARSE]);
    expect(r.caveats[0]).toBe(`Ring removal: ${NOTICE}`);
    expect(reportMarkdown(r)).toContain(NOTICE);
    expect(reportHtml(r)).toContain(NOTICE.replace(/'/g, "&#39;"));
    // Without a notice, neither the line nor the caveat.
    const plain = buildReport(input());
    expect(plain.checks[0].details.map(([k]) => k)).not.toContain("Not subtracted");
    expect(plain.caveats.filter((c) => c.startsWith("Ring removal: ") && c.includes("not confirmed at this grid"))).toEqual([]);
  });

  it("says why its goal is not judged on a grid too coarse for the ring check, as {{achieved}} does, not that the stage was not measured (G1)", () => {
    const r = buildReport(input({ measured: COARSE_RUN }));
    expect(r.achieved).toEqual({ met: null, text: "not judged: Ring removal (grid too coarse for the ring check)" });
    expect(verdicts({ report: COARSE_RUN }).achieved).toMatchObject({ notMeasured: [], notJudged: ["Ring removal (grid too coarse for the ring check)"] });
    // Beside a stage not measured: each with its own words.
    const noFlatten = buildReport(input({ measured: { ...COARSE_RUN, flatten: null } }));
    expect(noFlatten.achieved.text).toBe("not judged: Ring removal (grid too coarse for the ring check); not measured: Background correction");
    // A ring check that judged nothing for another reason reads as before.
    const rings = { max_ring_dent: null, max_ring_left: null, ring_rule: "not judged: the test of each bump in 3D could not run" };
    expect(buildReport(input({ measured: { ...COARSE_RUN, rings } })).achieved.text).toBe("not judged: not measured: Ring removal");
  });

  it("reports the flatten's floor in σ without judging it, by the pedestal rule", () => {
    // The validation's dev volumes (docs/pilot-review.md finding 6): floors of
    // 1.5 to 1.8σ on all eight, whatever the flatten did.
    const flatten = { max_after_floor_sigma: 1.72, max_floor_trend: 0.314, max_floor_span_fraction: 0.601, pedestal_left: false };
    const card = buildReport(input({ measured: { ...input().measured, flatten } })).checks.find((c) => c.title === "Background correction")!;
    expect(card.verdict).toBe("pass"); // "needs attention" under the 1σ clause
    expect(card.details).toContainEqual(["Largest leftover floor (reported, not judged)", "1.72 σ"]);
    expect(card.criterion).toMatch(/^No pedestal: .* The largest floor in σ is reported, not judged/);
  });

  it("counts the fill bias on the Backfill card, whose criterion says so", () => {
    const texture = { per_cut: [{ systematic_fill_bias: true }, { systematic_fill_bias: false }] };
    const card = buildReport(input({ measured: { ...input().measured, texture } })).checks.find((c) => c.title === "Backfill")!;
    expect(card.verdict).toBe("attention");
    expect(card.headline).toMatch(/ · fill bias on 1 of 2 cuts$/);
    expect(card.criterion).toMatch(/no cut whose fill is biased one way/);
  });
});
