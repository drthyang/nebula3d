// The tuning run's stage measurement against a mocked API: every principal
// plane is measured, cuts outside the grid are skipped, and the punch reports
// the share of measured voxels it removed.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../api/types";
import { evaluateStage, headline } from "../tune/evaluate";
import { judge } from "../verdicts";
import { makeSlice } from "./helpers";

const api = vi.hoisted(() => ({
  fetchBraggProfile: vi.fn(),
  fetchConsistencyCheck: vi.fn(),
  fetchDpdfMeta: vi.fn(),
  fetchDpdfSlice: vi.fn(),
  fetchMeta: vi.fn(),
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
    expect(e.window_weight_on_unmeasured).toBe(0.044);
    expect(e.window_shape).toBe("separable");
    expect(e.max_symmetry_break as number).toBeGreaterThan(1);
    expect(typeof e.worst_symmetry_op).toBe("string");
    expect(e.symmetry_declared).toBe(true);
    expect(headline("pdf", e)).toMatch(/ · unmeasured 0\.044 · symmetry off ≤ \d/);
    expect(judge("pdf", e).reasons).toContain("symmetry broken");
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
