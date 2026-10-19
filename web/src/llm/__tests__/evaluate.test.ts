// The tuning run's stage measurement against a mocked API: every principal
// plane is measured, cuts outside the grid are skipped, and the punch reports
// the share of measured voxels it removed.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../api/types";
import { loadPipelineContext } from "../context/loadContext";
import { evaluateStage, headline, outOfBounds } from "../tune/evaluate";
import { judge } from "../verdicts";
import { makeSlice } from "./helpers";

const api = vi.hoisted(() => ({
  fetchBraggProfile: vi.fn(),
  fetchConsistencyCheck: vi.fn(),
  fetchDpdfMeta: vi.fn(),
  fetchDpdfSlice: vi.fn(),
  fetchMeta: vi.fn(),
  fetchRingDiagnostics: vi.fn(),
  fetchRingIsotropy: vi.fn(),
  fetchSlice: vi.fn(),
}));
vi.mock("../../api/client", () => api);

const dataset: Dataset = {
  id: "demo",
  temperature: null,
  raw_name: "demo.nxs",
  stem: "demo",
  stages: ["raw", "ringremoved", "braggpunched"].map((name) => ({
    name,
    exists: true,
    kind: "hkl" as const,
    volume_id: `demo.${name}`,
  })),
};

beforeEach(() => {
  vi.resetAllMocks();
  api.fetchMeta.mockResolvedValue({
    shape: [21, 21, 21],
    h_range: [-2, 2],
    k_range: [-2, 2],
    l_range: [0.5, 1.5], // L = 0 is outside: the H–K cut is skipped
    lattice: { a: 4, b: 4, c: 4 },
  });
  api.fetchBraggProfile.mockResolvedValue({ has_profile: true, n_peaks: 12 });
  api.fetchSlice.mockImplementation(async (id: string) =>
    // 1 in 25 measured voxels punched (NaN) in the punched volume.
    makeSlice(25, 20, (_x, _y, ix) => (id.endsWith("braggpunched") && ix === 3 ? NaN : 1)),
  );
});

describe("evaluateStage", () => {
  it("measures the punch on the planes inside the grid", async () => {
    const e = await evaluateStage("punch", dataset);
    expect(Object.keys(e.per_plane as object)).toEqual(["h0l", "0kl"]);
    expect(api.fetchSlice).not.toHaveBeenCalledWith(expect.anything(), "hk0", expect.anything());
    expect(e.mean_punched_fraction).toBe(0.04);
    expect(e.total_leftover_peaks).toBe(0);
    expect(e.leftover_at_nodes).toBe(0);
    expect(e.fitted_peaks).toBe(12);
    expect(e.leftover_on_protected_planes).toBe(0);
    expect(headline("punch", e)).toBe("0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.04");
    expect(e).not.toHaveProperty("sigma_note");
  });

  it("counts every sharp leftover on the protected planes, on its own line, and leaves them out of the verdict (D5, 2.4.5)", async () => {
    // Synthetic punched cuts, 1/15 r.l.u. a voxel. On h0l (K = 0), twelve sharp peaks
    // on the default protected H planes (1/3 and 2/3 mod 1), more than the eight the
    // chat's context lists; on 0kl (H = 0, no protected plane), none, or one stray.
    const noise = (ix: number, iy: number) => ((ix * 7919 + iy * 104729) % 1000) / 500 - 1;
    const bump = (cx: number, cy: number) => (ix: number, iy: number) => 2 * Math.exp(-((ix - cx) ** 2 + (iy - cy) ** 2) / 2);
    const onThirds = [11, 26, 41, 56]; // H = −5/3, −2/3, 1/3, 4/3
    const onTwoThirds = [16, 31, 46, 61]; // H = −4/3, −1/3, 2/3, 5/3
    const satellites = [...onThirds.map((ix) => bump(ix, 21)), ...onThirds.map((ix) => bump(ix, 36)), ...onTwoThirds.map((ix) => bump(ix, 51))]; // L = −1, 0, 1
    const stray = bump(43, 36); // K = 7/15, L = 0 on 0kl
    const punched = (peaks: { h0l: typeof satellites; "0kl": typeof satellites }) =>
      api.fetchSlice.mockImplementation(async (id: string, plane: "h0l" | "0kl") =>
        makeSlice(73, 73, (_x, _y, ix, iy) => 1 + 0.02 * noise(ix, iy) + (id.endsWith("braggpunched") ? peaks[plane].reduce((s, f) => s + f(ix, iy), 0) : 0), { half: 2.4 }),
      );
    punched({ h0l: satellites, "0kl": [] });
    const e = await evaluateStage("punch", dataset);
    expect([e.leftover_at_nodes, e.leftover_off_lattice_sharp, e.leftover_on_protected_planes, e.leftover_on_protected_planes_sharp]).toEqual([0, 12, 12, 12]);
    expect(judge("punch", e)).toMatchObject({ kind: "pass", reasons: [] });
    // The chat's context still lists the strongest eight; the counts hold all twelve.
    const { context } = await loadPipelineContext(dataset, { recip: { plane: "h0l", value: 0 }, dpdf: null, records: false });
    expect([context.bragg_punch?.leftover.suspicious_peaks.length, context.bragg_punch?.leftover.n_on_protected]).toEqual([8, 12]);
    // A sharp peak off the protected planes: one the search left.
    punched({ h0l: satellites, "0kl": [stray] });
    const left = await evaluateStage("punch", dataset);
    expect([left.leftover_off_lattice_sharp, left.leftover_on_protected_planes_sharp]).toEqual([13, 12]);
    expect(judge("punch", left)).toMatchObject({ kind: "attention", reasons: ["sharp off-lattice"] });
  });

  it("passes on the raw volume's note when its σ is √|I| of normalized data", async () => {
    const meta = await api.fetchMeta();
    const note = "No σ came with this volume, so σ is taken as √|I| …";
    api.fetchMeta.mockImplementation(async (id: string) =>
      id === "demo.raw" ? { ...meta, sigma: "estimated", sigma_note: note } : meta);
    const e = await evaluateStage("punch", dataset);
    expect(e.sigma_note).toBe(note);
  });

  // Raw: a powder ring at r = 6 on every plane, and on h0l a bump at r = 12
  // (the crystal's own). Ring-removed: the ring over-shot by 20 %, the bump left.
  const ringAndBump = () => {
    const g = (r: number, r0: number) => Math.exp(-((r - r0) ** 2) / 0.5);
    api.fetchSlice.mockImplementation(async (id: string, plane: string) =>
      makeSlice(161, 161, (x, y) => {
        const r = Math.hypot(x, y);
        const bump = plane === "h0l" ? 4 * g(r, 12) : 0;
        return id.endsWith("raw") ? 1 + 8 * g(r, 6) + bump : 1 - 0.2 * g(r, 6) + bump;
      }, { half: 20 }),
    );
  };
  // The 3D test: the inner shell (r = 6, 2π·6/4 ≈ 9.4 Å⁻¹) rises in every direction,
  // the outer one (≈ 18.8 Å⁻¹) does not.
  const judgeIn3d = () =>
    api.fetchRingIsotropy.mockImplementation(async (_id: string, shells: { q: number; fwhm: number }[]) => ({
      id: "demo.raw",
      rule: { direction_share: 0.9, height_share: 0.15 },
      shells: shells.map((sh) => ({ q_center: sh.q, fwhm: sh.fwhm, n_cells: 128, median_height: 1, relative_height: 1, isotropy: sh.q < 14 ? 0.95 : -0.4, is_ring: sh.q < 14, not_judged: null })),
    }));

  it("counts only the bumps the 3D test confirms as rings; the others are the crystal's own", async () => {
    ringAndBump();
    judgeIn3d();
    const e = await evaluateStage("rings", dataset);
    // One call, on the raw volume, with each shell the planes' bumps make.
    expect(api.fetchRingIsotropy).toHaveBeenCalledTimes(1);
    const [id, shells] = api.fetchRingIsotropy.mock.calls[0] as [string, { q: number }[]];
    expect(id).toBe("demo.raw");
    expect(shells.map((sh) => Math.round(sh.q / ((2 * Math.PI) / 4)))).toEqual([6, 12]);
    const dent = e.worst_ring_dent as { at: number; plane: string };
    expect(dent).not.toBeNull();
    expect(e.max_ring_left).toBe(0); // the bump at 12 is not a ring left over
    const judged = e.shells_judged as { at: number; ring: boolean }[];
    expect(judged.map((x) => x.ring)).toEqual([true, false]);
    expect(judged[1].at).toBeGreaterThan(dent.at);
    expect(e.ring_rule).toEqual({ direction_share: 0.9, height_share: 0.15 });
    // The plane's own detail agrees: its bump is marked, and is not its worst ring.
    type Plane = { worst_ring_left: unknown; worst_ring_dent: { at: number } | null; ring_residuals: { at: number; ring?: boolean }[] };
    const h0l = (e.per_plane as Record<string, Plane>).h0l;
    expect(h0l.worst_ring_left).toBeNull();
    expect(h0l.worst_ring_dent?.at).toBe(dent.at);
    expect(h0l.ring_residuals.find((x) => x.at > dent.at)?.ring).toBe(false);
    expect(h0l.ring_residuals.find((x) => x.at === dent.at)?.ring).toBe(true);
  });

  it("does not judge the rings when the 3D test cannot run", async () => {
    ringAndBump();
    api.fetchRingIsotropy.mockRejectedValue(new Error("404 Not Found"));
    const e = await evaluateStage("rings", dataset);
    expect(e.max_ring_left).toBeNull();
    expect(e.max_ring_dent).toBeNull();
    expect(e.ring_rule).toMatch(/^not judged/);
    expect(judge("rings", e)).toMatchObject({ kind: "info", reasons: ["nothing to judge"] });
  });

  it("does not judge the rings on a grid too coarse for the 3D test, and says why, with a bump on the planes or none", async () => {
    const coarse = "grid too coarse: 0.99 voxels across a ring's width (at most 0.16 Å⁻¹), under 1";
    api.fetchRingIsotropy.mockImplementation(async (_id: string, shells: { q: number; fwhm: number }[]) => ({
      id: "demo.raw",
      rule: { direction_share: 0.9, height_share: 0.15 },
      shells: shells.map((sh) => ({ q_center: sh.q, fwhm: sh.fwhm, n_cells: 0, median_height: null, relative_height: null, isotropy: null, is_ring: false, not_judged: coarse })),
      not_judged: coarse,
    }));
    ringAndBump();
    const e = await evaluateStage("rings", dataset);
    expect([e.max_ring_left, e.max_ring_dent, e.shells_judged]).toEqual([null, null, undefined]);
    expect(e.ring_rule).toBe(`not judged: ${coarse}`);
    expect(judge("rings", e)).toMatchObject({ kind: "info", reasons: ["grid too coarse"] });
    expect(headline("rings", e)).toMatch(/ring dent ≤ – · left ≤ –$/);
    // No bump on any plane: on such a grid that is no evidence either, so the grid's limit is asked all the same.
    api.fetchSlice.mockImplementation(async () => makeSlice(161, 161, () => 1, { half: 20 }));
    api.fetchRingIsotropy.mockClear();
    const flat = await evaluateStage("rings", dataset);
    expect(api.fetchRingIsotropy).toHaveBeenCalledWith("demo.raw", []);
    expect(flat.ring_rule).toBe(`not judged: ${coarse}`);
    expect(judge("rings", flat)).toMatchObject({ kind: "info", reasons: ["grid too coarse"] });
  });

  it("says first what the ring removal left unconfirmed on its grid, from its diagnostics, and nothing where it left none (G1)", async () => {
    const coarse = "grid too coarse: 0.99 voxels across a ring's width (at most 0.16 Å⁻¹), under 1";
    const notice =
      "4 rings detected but not confirmed at this grid (needs ≥ 1 voxel across 0.16 Å⁻¹); not subtracted. Use a finer grid, or set pooled_confirm_rings=False to subtract every detected ring.";
    api.fetchRingIsotropy.mockImplementation(async (_id: string, shells: { q: number; fwhm: number }[]) => ({
      id: "demo.raw",
      rule: { direction_share: 0.9, height_share: 0.15 },
      shells: shells.map((sh) => ({ q_center: sh.q, fwhm: sh.fwhm, n_cells: 0, median_height: null, relative_height: null, isotropy: null, is_ring: false, not_judged: coarse })),
      not_judged: coarse,
    }));
    const record = {
      dataset_id: "demo",
      diagnostics_path: "processed/demo_ringremoved_diagnostics.json",
      has_diagnostics: true,
      status: "no_confirmed_rings",
      unconfirmed_at_grid: { count: 4, needs: "1 voxel across 0.16 Å⁻¹", notice, q_centers: [2.668, 3.071, 4.36, 5.165] },
    };
    api.fetchRingDiagnostics.mockResolvedValue(record);
    ringAndBump();
    const e = await evaluateStage("rings", dataset);
    expect(api.fetchRingDiagnostics).toHaveBeenCalledWith("demo");
    expect(Object.keys(e)[0]).toBe("notice");
    expect(e.notice).toBe(notice);
    expect(e.ring_rule).toBe(`not judged: ${coarse}`);
    expect(judge("rings", e)).toMatchObject({ kind: "info", reasons: ["grid too coarse"] });
    // A removal that left none, diagnostics that give none, or none to read: no notice.
    for (const answer of [{ ...record, status: "fitted", unconfirmed_at_grid: null }, { ...record, has_diagnostics: false, status: null, unconfirmed_at_grid: null }]) {
      api.fetchRingDiagnostics.mockResolvedValue(answer);
      expect(await evaluateStage("rings", dataset)).not.toHaveProperty("notice");
    }
    api.fetchRingDiagnostics.mockRejectedValue(new Error("404 Not Found"));
    expect(await evaluateStage("rings", dataset)).not.toHaveProperty("notice");
  });

  it("asks for the grid's limit with no bump on the planes, and passes an empty shell list as before where the grid is fine", async () => {
    api.fetchSlice.mockImplementation(async () => makeSlice(161, 161, () => 1, { half: 20 }));
    judgeIn3d();
    const e = await evaluateStage("rings", dataset);
    expect(api.fetchRingIsotropy).toHaveBeenCalledWith("demo.raw", []);
    expect([e.max_ring_left, e.max_ring_dent, e.shells_judged]).toEqual([0, 0, []]);
    expect(judge("rings", e)).toMatchObject({ kind: "pass" });
  });

  it("reports the ΔPDF window's weight on unmeasured space and the section's symmetry", async () => {
    const withPdf: Dataset = {
      ...dataset,
      stages: [...dataset.stages, { name: "delta_pdf", exists: true, kind: "delta_pdf" as const, volume_id: "demo.delta_pdf" }],
    };
    api.fetchConsistencyCheck.mockResolvedValue({ has_check: false });
    api.fetchDpdfMeta.mockResolvedValue({ lattice: { a: 6, b: 6, c: 9 }, window_open_weight: 0.0436, window_shape: "separable" });
    // A section that changes sign under the two-fold: not symmetric.
    api.fetchDpdfSlice.mockImplementation(async () => {
      const s = makeSlice(21, 21, (x) => x);
      return { ...s, header: { ...s.header, axes_angle: 120 } };
    });
    api.fetchMeta.mockResolvedValue({ ...(await api.fetchMeta()), symmetry: "6/mmm" }); // declared symmetrised
    const e = await evaluateStage("pdf", withPdf);
    expect(e.window_weight_on_unmeasured).toBe(0.0436); // three figures (2.4.6b)
    expect(e.window_shape).toBe("separable");
    expect(e.max_symmetry_break as number).toBeGreaterThan(1);
    expect(typeof e.worst_symmetry_op).toBe("string");
    expect(e.symmetry_declared).toBe(true);
    expect(headline("pdf", e)).toMatch(/ · unmeasured 0\.0436 · symmetry off ≤ \d/);
    expect(judge("pdf", e).reasons).toContain("symmetry broken");
  });

  it("judges the ΔPDF's window by its raw weight, as qmax_coverage does: 1.04e-3 is past 1e-3 (D6, 2.4.6), and shows it so (2.4.6b)", async () => {
    const withPdf: Dataset = {
      ...dataset,
      stages: [...dataset.stages, { name: "delta_pdf", exists: true, kind: "delta_pdf" as const, volume_id: "demo.delta_pdf" }],
    };
    // A sound round trip on synthetic sections; the window's weight on unmeasured space is the only fault.
    api.fetchConsistencyCheck.mockResolvedValue({ has_check: true, metrics: { pearson_r: 0.99, normalized_rms: 0.1, pearson_r_even: 1, normalized_rms_even: 0, odd_share: 0.01 } });
    api.fetchDpdfSlice.mockImplementation(async () => makeSlice(21, 21, (x, y) => Math.cos(x) * Math.cos(y)));
    const evaluate = async (weight: number) => {
      api.fetchDpdfMeta.mockResolvedValue({ lattice: { a: 3.9, b: 3.9, c: 3.9 }, window_open_weight: weight, window_shape: "ellipsoid" });
      return evaluateStage("pdf", withPdf);
    };
    const past = await evaluate(0.00104);
    // Shown to three figures (2.4.6b): 0.00104 beside its verdict, where two showed 0.001.
    expect(past.window_weight_on_unmeasured).toBe(0.00104);
    expect(headline("pdf", past)).toMatch(/ · unmeasured 0\.00104 · /);
    expect(judge("pdf", past)).toMatchObject({ kind: "attention", reasons: ["window past limit"] });
    expect(outOfBounds("pdf", past)).toMatch(/^its window puts 0\.00104 of its weight/);
    // qmax_coverage reads the same raw weight the same way.
    const coverage = { window: "the ΔPDF's ellipsoid window", unit_cell: true, full_coverage_q: null, reach: null, reach_from: "", shell: 0.1, band_set: false, counts: { counts_end_inside_box: false } };
    expect(judge("coverage", { ...coverage, window_weight: 0.00104 }).kind).toBe("attention");
    // At 1e-3, within the limit, to both.
    const at = await evaluate(0.001);
    expect([judge("pdf", at).kind, outOfBounds("pdf", at), judge("coverage", { ...coverage, window_weight: 0.001 }).kind]).toEqual(["pass", null, "pass"]);
    // Past the limit at the fourth figure: shown 0.001, still judged raw.
    const fourth = await evaluate(0.0010004);
    expect([fourth.window_weight_on_unmeasured, judge("pdf", fourth).kind]).toEqual([0.001, "attention"]);
    // A tiny weight, in exponent form, to three figures.
    expect(headline("pdf", await evaluate(0.000976))).toMatch(/ · unmeasured 9\.76e-4 · /);
  });

  it("does not judge a symmetry the file never declared: unsymmetrised data differ from their images by their own noise", async () => {
    const withPdf: Dataset = {
      ...dataset,
      stages: [...dataset.stages, { name: "delta_pdf", exists: true, kind: "delta_pdf" as const, volume_id: "demo.delta_pdf" }],
    };
    api.fetchConsistencyCheck.mockResolvedValue({ has_check: true, metrics: { pearson_r: 0.9999, normalized_rms: 0.01 } });
    api.fetchDpdfMeta.mockResolvedValue({ lattice: { a: 6, b: 6, c: 9 }, window_open_weight: 0, window_shape: "separable" });
    api.fetchDpdfSlice.mockImplementation(async () => {
      const s = makeSlice(21, 21, (x) => x);
      return { ...s, header: { ...s.header, axes_angle: 120 } };
    });
    const e = await evaluateStage("pdf", withPdf); // the mocked volume declares no symmetry
    expect(e.symmetry_declared).toBe(false);
    expect(e.max_symmetry_break as number).toBeGreaterThan(1); // still measured, and reported
    expect(headline("pdf", e)).toMatch(/ · no symmetry declared \(asymmetry \d/);
    expect(judge("pdf", e).kind).toBe("pass"); // nothing else fails
    // The rule still bites where symmetry is declared.
    expect(judge("pdf", { ...e, symmetry_declared: true })).toMatchObject({ kind: "attention", reasons: ["symmetry broken", "window within limit"] });
  });

  it("judges the round trip against the data's even part: the clean control passes, a transform fault does not", async () => {
    // docs/pilot-review.md finding 3: the dev control, unsymmetrised, reads r = 0.989
    // against the data (its odd part is counting noise) and 1 against the even part.
    const withPdf: Dataset = {
      ...dataset,
      stages: [...dataset.stages, { name: "delta_pdf", exists: true, kind: "delta_pdf" as const, volume_id: "demo.delta_pdf" }],
    };
    const control = { pearson_r: 0.989014, normalized_rms: 0.125311, pearson_r_even: 1, normalized_rms_even: 0, odd_share: 0.021851 };
    api.fetchConsistencyCheck.mockResolvedValue({ has_check: true, metrics: control });
    api.fetchDpdfMeta.mockResolvedValue({ lattice: { a: 3.9, b: 3.9, c: 3.9 }, window_open_weight: null, window_shape: "separable" });
    api.fetchDpdfSlice.mockImplementation(async () => makeSlice(21, 21, (x, y) => Math.cos(x) * Math.cos(y)));
    const e = await evaluateStage("pdf", withPdf); // declares no symmetry
    expect([e.back_fft_pearson_r, e.back_fft_pearson_r_even, e.back_fft_odd_share]).toEqual([0.98901, 1, 0.0219]);
    expect(headline("pdf", e)).toMatch(/^r 0\.98901 \(even part 1\) · RMS 0\.1253/);
    expect(judge("pdf", e).kind).toBe("pass"); // failed at r < 0.999 before
    // A transform that loses part of the ΔPDF falls short of its own even part.
    expect(judge("pdf", { ...e, back_fft_pearson_r_even: 0.97 }).reasons).toContain("back-FFT");
    // A check recorded before the even part was compared: r against the data is
    // judged only where the file declares the data symmetrised.
    const old = { ...e, back_fft_pearson_r_even: null };
    expect(judge("pdf", old).kind).toBe("pass");
    expect(judge("pdf", { ...old, symmetry_declared: true, max_symmetry_break: 1e-4 }).reasons).toEqual(["back-FFT"]);
    expect(judge("pdf", { ...old, symmetry_declared: true, max_symmetry_break: 1e-4, back_fft_pearson_r: 0.9995 }).kind).toBe("pass");
  });

  it("says whether the flatten left a pedestal, so the Q² term's question has a stated answer", async () => {
    const withFlat: Dataset = {
      ...dataset,
      stages: [...dataset.stages, ...["backfilled", "flattened"].map((name) => ({ name, exists: true, kind: "hkl" as const, volume_id: `demo.${name}` }))],
    };
    api.fetchMeta.mockResolvedValue({ shape: [81, 81, 81], h_range: [-10, 10], k_range: [-10, 10], l_range: [-10, 10], lattice: { a: 4, b: 4, c: 4 } });
    const lumpy = (x: number, y: number) => 0.8 * Math.cos(1.3 * x) * Math.cos(1.1 * y);
    // A |Q|² floor the flatten left, spanning more than the diffuse level over
    // the outer half of the coverage, where the pedestal is judged.
    const q2 = (x: number, y: number) => 0.25 * Math.hypot(x, y) ** 2 / 4;
    const evaluate = async (after: (x: number, y: number) => number) => {
      api.fetchSlice.mockImplementation(async (id: string) =>
        makeSlice(81, 81, id.endsWith("backfilled") ? (x, y) => 4 + q2(x, y) + lumpy(x, y) : after, { half: 10 }),
      );
      return evaluateStage("flatten", withFlat);
    };
    const rising = await evaluate((x, y) => q2(x, y) + lumpy(x, y));
    expect(rising.pedestal_left).toBe(true);
    expect(headline("flatten", rising)).toMatch(/ · pedestal left$/);
    const level = await evaluate(lumpy);
    expect(level.pedestal_left).toBe(false);
    expect(headline("flatten", level)).toMatch(/ · no pedestal$/);
    expect(headline("flatten", { max_after_floor_sigma: 0.8 })).toBe("floor ≤ 0.8σ · trend ≤ – · span ≤ –"); // not measured: not said
  });

  it("names the plane and |Q| of the worst ring residual in the headline", () => {
    const e = {
      mean_ring_energy_ratio: 0.24,
      max_over_subtraction_fraction: 0.03,
      max_ring_dent: 0.187,
      max_ring_left: 0,
      worst_ring_dent: { plane: "h0l", at: 6.35, residual_fraction: -0.187 },
      worst_ring_left: null,
    };
    expect(headline("rings", e)).toBe("ring ratio 0.24 · over-sub ≤ 0.03 · ring dent ≤ 0.187 (h0l, 6.35 Å⁻¹) · left ≤ 0");
  });
});

describe("the punch's headline (D5)", () => {
  it("counts the sharp leftovers on protected planes apart, and names them whenever there are any", () => {
    const e = { leftover_at_nodes: 0, leftover_off_lattice_sharp: 5, leftover_on_protected_planes_sharp: 3, leftover_off_lattice_broad: 7, mean_punched_fraction: 0.03 };
    expect(headline("punch", e)).toBe("0 missed at nodes · 2 sharp off-lattice (3 more on protected planes, kept) · 7 broad maxima kept · punched 0.03");
    expect(headline("punch", { ...e, leftover_on_protected_planes_sharp: 0 })).toBe("0 missed at nodes · 5 sharp off-lattice · 7 broad maxima kept · punched 0.03");
    // An evaluation recorded before the count was split out counts every sharp one, as before.
    const old = { leftover_at_nodes: 0, leftover_off_lattice_sharp: 5, leftover_off_lattice_broad: 7, mean_punched_fraction: 0.03 };
    expect(headline("punch", old)).toBe("0 missed at nodes · 5 sharp off-lattice · 7 broad maxima kept · punched 0.03");
  });
});
