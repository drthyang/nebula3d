// The tuning run's stage measurement against a mocked API: every principal
// plane is measured, cuts outside the grid are skipped, and the punch reports
// the share of measured voxels it removed.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset, FlattenSettings } from "../../api/types";
import { usePipelineStore } from "../../state/pipelineStore";
import { loadPipelineContext } from "../context/loadContext";
import { UNRECORDED_PROTECTION_NOTE } from "../context/pipelineContext";
import { offLatticeBunching } from "../metrics/bunching";
import { FLATTEN_UNRECORDED_NOTE, pedestalLeft } from "../metrics/flatten";
import { operationName } from "../metrics/symmetry";
import { evaluateStage, headline, outOfBounds } from "../tune/evaluate";
import { judge } from "../verdicts";
import { cut, directGroup, HKL, orbit } from "./constructedDpdf";
import { BUNCHED_AT_THIRDS, labelsOn, makeSlice, onTheThirds, recordOf, THIRDS_AS_PLANES } from "./helpers";
import { shellFloorsOf } from "./shellFloors";

const api = vi.hoisted(() => ({
  fetchBraggProfile: vi.fn(),
  fetchConsistencyCheck: vi.fn(),
  fetchDpdfMeta: vi.fn(),
  fetchDpdfSlice: vi.fn(),
  fetchMeta: vi.fn(),
  fetchProtectedLabels: vi.fn(),
  fetchRingDiagnostics: vi.fn(),
  fetchRingIsotropy: vi.fn(),
  fetchShellFloors: vi.fn(),
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

/** A punched cut's grid in the punch's tests below: 73 voxels over ±2.4 r.l.u. */
const CUT_GRID = makeSlice(73, 73, () => 0, { half: 2.4 });
/** The run's labels of k = (1/3, 0, 0) declared as planes, the H planes 1/3 and 2/3 (± 0.08), on each cut: H is x on h0l, the cut itself on 0kl. */
const protectThirds = () =>
  api.fetchProtectedLabels.mockImplementation(async (_id: string, plane: string, value: number) =>
    labelsOn(CUT_GRID, (x) => (onTheThirds(plane === "0kl" ? value : x) ? 1 : 0)),
  );

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
    // on the declared protected H planes (1/3 and 2/3 mod 1), more than the eight the
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
    // What the run's search left alone, from its record: the declared H planes, on each cut's grid.
    protectThirds();
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

  // The same twelve satellites on h0l, and the run's labels of what its search left alone.
  const satellitesOnTheThirds = () => {
    const noise = (ix: number, iy: number) => ((ix * 7919 + iy * 104729) % 1000) / 500 - 1;
    const bump = (cx: number, cy: number) => (ix: number, iy: number) => 2 * Math.exp(-((ix - cx) ** 2 + (iy - cy) ** 2) / 2);
    const satellites = [...[11, 26, 41, 56].flatMap((ix) => [bump(ix, 21), bump(ix, 36)]), ...[16, 31, 46, 61].map((ix) => bump(ix, 51))];
    api.fetchSlice.mockImplementation(async (id: string, plane: string) =>
      makeSlice(73, 73, (_x, _y, ix, iy) => 1 + 0.02 * noise(ix, iy) + (id.endsWith("braggpunched") && plane === "h0l" ? satellites.reduce((s, f) => s + f(ix, iy), 0) : 0), { half: 2.4 }),
    );
  };

  it("marks what the run's search left alone, from its record, never from the form (plan 4.15)", async () => {
    satellitesOnTheThirds();
    // The form declares other planes, or none: the run's labels mark the thirds all the same.
    protectThirds();
    for (const form of [{ modulationK: "1/2, 0, 0", modulationForm: "planes" }, { modulationK: "none", modulationForm: "" }]) {
      usePipelineStore.setState(form);
      const e = await evaluateStage("punch", dataset);
      expect([e.leftover_off_lattice_sharp, e.leftover_on_protected_planes_sharp], JSON.stringify(form)).toEqual([12, 12]);
    }
    expect(api.fetchProtectedLabels).toHaveBeenCalledWith("demo", "h0l", 0);
    // A run whose search left nothing alone marks none, whatever the form declares: every sharp one counts.
    usePipelineStore.setState({ modulationK: "1/3, 0, 0", modulationForm: "planes" });
    api.fetchProtectedLabels.mockImplementation(async () => labelsOn(CUT_GRID, () => 0, { declared: null }));
    const none = await evaluateStage("punch", dataset);
    expect([none.leftover_off_lattice_sharp, none.leftover_on_protected_planes_sharp]).toEqual([12, 0]);
    expect(judge("punch", none)).toMatchObject({ kind: "attention", reasons: ["sharp off-lattice"] });
    usePipelineStore.setState({ modulationK: "", modulationForm: "" });
  });

  it("marks none on a run whose record predates what its search left alone, and the context says why", async () => {
    satellitesOnTheThirds();
    api.fetchProtectedLabels.mockImplementation(async () => labelsOn(CUT_GRID, () => 1, { recorded: false }));
    const e = await evaluateStage("punch", dataset);
    expect([e.leftover_off_lattice_sharp, e.leftover_on_protected_planes, e.leftover_on_protected_planes_sharp]).toEqual([12, 0, 0]);
    const { context } = await loadPipelineContext(dataset, { recip: { plane: "h0l", value: 0 }, dpdf: null, records: false });
    expect(context.bragg_punch?.leftover).not.toHaveProperty("n_on_protected");
    expect(context.notes).toContain(`bragg punch: ${UNRECORDED_PROTECTION_NOTE}`);
  });

  it("puts the run's sharp peaks off the lattice bunched at one fraction to the user, beside the verdict it leaves as it was (plan 4.15)", async () => {
    api.fetchBraggProfile.mockResolvedValue({ has_profile: true, n_peaks: 12, modulation: recordOf({ declared: THIRDS_AS_PLANES, bunching: BUNCHED_AT_THIRDS }) });
    const e = await evaluateStage("punch", dataset);
    expect(e.off_lattice_bunching).toEqual(offLatticeBunching(recordOf({ bunching: BUNCHED_AT_THIRDS })));
    expect(judge("punch", e)).toEqual(judge("punch", { ...e, off_lattice_bunching: undefined }));
    // No bunching in the record, or no record of it: no question.
    for (const modulation of [recordOf({ declared: THIRDS_AS_PLANES }), null, undefined]) {
      api.fetchBraggProfile.mockResolvedValue({ has_profile: true, n_peaks: 12, modulation });
      expect(await evaluateStage("punch", dataset)).not.toHaveProperty("off_lattice_bunching");
    }
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
      "4 ring candidates (shells that may be powder rings or the crystal's own scattering) detected but not confirmed at this grid (needs ≥ 1 voxel across 0.16 Å⁻¹); not subtracted. Use a finer grid, or, from the Python API, set pooled_confirm_rings=False to subtract every candidate, the crystal's own shells included.";
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
      summary: null,
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

  it("gives the ring stage's own record of its shells, after its notice, where it wrote one", async () => {
    ringAndBump();
    judgeIn3d();
    const summary = "Al a=4.041 Å; removed 15 (Al 14); left 2: 10.21 Al533 member, 10.33 Al622 member";
    const record = { dataset_id: "demo", diagnostics_path: "p", has_diagnostics: true, status: "fitted", unconfirmed_at_grid: null, summary };
    api.fetchRingDiagnostics.mockResolvedValue(record);
    const e = await evaluateStage("rings", dataset);
    expect(e.stage_shells).toBe(summary);
    expect(Object.keys(e)[0]).toBe("stage_shells");
    api.fetchRingDiagnostics.mockResolvedValue({ ...record, summary: null });
    expect(await evaluateStage("rings", dataset)).not.toHaveProperty("stage_shells");
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

  it("tests the declared group's operations that map the x–y section onto itself, as symmetry_check judges them; with none declared, the cell's in-plane ones", async () => {
    const withPdf: Dataset = {
      ...dataset,
      stages: [...dataset.stages, { name: "delta_pdf", exists: true, kind: "delta_pdf" as const, volume_id: "demo.delta_pdf" }],
    };
    // A tetragonal ΔPDF symmetrised over 4/m: it keeps the four-fold and the
    // mirror ⊥ c, and not the mirrors ⊥ a and ⊥ b, which 4/m lacks.
    const fourOverM = [HKL.fourC, HKL.mirrorC];
    const cell = { a: 4, c: 6, gamma: 90 };
    const features = orbit([0, 0.25].map((w) => ({ at: [0.3, 0.1, w], amp: 1, width: 0.35 })), directGroup(fourOverM));
    const lattice = { a: cell.a, b: cell.a, c: cell.c, alpha: 90, beta: 90, gamma: 90 };
    api.fetchConsistencyCheck.mockResolvedValue({ has_check: false });
    api.fetchDpdfMeta.mockResolvedValue({ lattice, window_open_weight: 0, window_shape: "ellipsoid" });
    api.fetchDpdfSlice.mockImplementation(async (_id: string, plane: "xy" | "xz" | "yz", value: number) => cut(cell, features, plane, value));
    const raw = { shape: [41, 41, 41], h_range: [-4, 4], k_range: [-4, 4], l_range: [-4, 4], lattice };

    api.fetchMeta.mockResolvedValue({ ...raw, symmetry: "4/m", symmetry_ops: fourOverM });
    const declared = await evaluateStage("pdf", withPdf);
    expect(declared.max_symmetry_break as number).toBeLessThan(1e-6);
    // An entry of the group symmetry_check judges: a rotation with its product with the inversion.
    const onSection = directGroup(fourOverM).filter((m) => m[2][0] === 0 && m[2][1] === 0);
    const entries = [...onSection.slice(1).filter((m) => operationName(m).includes("fold")).map((m) => `${operationName(m)} / ${operationName(m.map((r) => r.map((x) => -x + 0)))}`), "inversion"];
    expect(entries).toContain(declared.worst_symmetry_op);
    expect(judge("pdf", declared).reasons).not.toContain("symmetry broken");

    // No operations declared, only the name: the cell's in-plane ones, as before, the mirrors ⊥ a and ⊥ b among them.
    api.fetchMeta.mockResolvedValue({ ...raw, symmetry: "4/m" });
    const named = await evaluateStage("pdf", withPdf);
    expect(["mirror ⊥ a", "mirror ⊥ b"]).toContain(named.worst_symmetry_op);
    expect(named.max_symmetry_break as number).toBeGreaterThan(0.05);
    expect(judge("pdf", named).reasons).toContain("symmetry broken");
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

// Volumes built to a known answer, as tests/test_shell_floors.py's _ball: a
// cubic cell of 4 Å on 81³ points over ±4 r.l.u., measured out to 6 Å⁻¹ (the
// box's faces at 6.28 Å⁻¹, so every shell the counts reach is whole). The
// flattened stage is a uniform diffuse, 0.2 of a deterministic u in [0, 1),
// plus what the flatten left; its input is that plus the 0.25 it took out.
// The planes are the volume's own cuts through the origin, and the whole
// volume's floors are measured as the server measures them (shellFloorsOf).
// Each shell's floor is the diffuse's 25th percentile, 0.05, plus the
// pedestal at its |Q|.
describe("the flatten's pedestal, over the whole volume (4.1)", () => {
  const N = 81;
  const HALF = 4;
  const QU = (2 * Math.PI) / 4;
  const AXIS = Array.from({ length: N }, (_v, i) => -HALF + (2 * HALF * i) / (N - 1));
  const MID = (N - 1) / 2;
  const u = (i: number, j: number, k: number) => {
    const x = Math.sin(i * 12.9898 + j * 78.233 + k * 37.719) * 43758.5453;
    return x - Math.floor(x);
  };
  const qOf = (h: number, k: number, l: number) => QU * Math.hypot(h, k, l);
  const withFlat: Dataset = {
    ...dataset,
    stages: [...dataset.stages, ...["backfilled", "flattened"].map((name) => ({ name, exists: true, kind: "hkl" as const, volume_id: `demo.${name}` }))],
  };
  const cell = { shape: [N, N, N], h_range: [-HALF, HALF], k_range: [-HALF, HALF], l_range: [-HALF, HALF], lattice: { a: 4, b: 4, c: 4 } };
  const DEFAULT_RECORD = { fit_q_range: [0.8, 10] as [number, number], floor_percentile: 25, q_step: 0.05 };

  /** Build the stages with `pedestal` left (h, k, l, |Q| → its height), mock the API with them, and evaluate the flatten. */
  async function evaluateWith(pedestal: (h: number, k: number, l: number, q: number) => number, record: unknown = DEFAULT_RECORD) {
    const after = (h: number, k: number, l: number, idx: [number, number, number]) => {
      const q = qOf(h, k, l);
      return q > 6 ? NaN : 0.2 * u(...idx) + pedestal(h, k, l, q);
    };
    const before = (h: number, k: number, l: number, idx: [number, number, number]) => after(h, k, l, idx) + 0.25;
    const volume = (f: typeof after) => ({ axes: [AXIS, AXIS, AXIS] as [number[], number[], number[]], q: qOf, value: f });
    const floors = shellFloorsOf(volume(after), volume(before), { id: "demo.flattened", flatten: record as FlattenSettings | null });
    api.fetchMeta.mockResolvedValue(cell);
    api.fetchShellFloors.mockResolvedValue(floors);
    // A plane's point (x, y) as (h, k, l) and its voxel.
    const at: Record<string, (x: number, y: number, ix: number, iy: number) => [number, number, number, [number, number, number]]> = {
      hk0: (x, y, ix, iy) => [x, y, 0, [ix, iy, MID]],
      h0l: (x, y, ix, iy) => [x, 0, y, [ix, MID, iy]],
      "0kl": (x, y, ix, iy) => [0, x, y, [MID, ix, iy]],
    };
    api.fetchSlice.mockImplementation(async (id: string, plane: string) =>
      makeSlice(N, N, (x, y, ix, iy) => (id.endsWith("backfilled") ? before : after)(...at[plane](x, y, ix, iy)), { half: HALF }),
    );
    const e = await evaluateStage("flatten", withFlat);
    const planes = Object.values(e.per_plane as Record<string, { floor_trend: number; floor_span_fraction: number; floor_judged_q: [number, number] }>);
    return { e, floors, planes };
  }
  // What the planes alone would have judged, the largest of their trends and spans (the rule before 4.1).
  const byPlanes = (planes: { floor_trend: number; floor_span_fraction: number }[]) =>
    pedestalLeft(Math.max(...planes.map((p) => Math.abs(p.floor_trend))), Math.max(...planes.map((p) => p.floor_span_fraction)));

  it("reads a flat floor as no pedestal, on the planes and over the volume", async () => {
    const { e, planes } = await evaluateWith(() => 0);
    expect(e.floor_judged_q).toEqual([3.02, 5.97]); // the outer half of the 0–6 Å⁻¹ the counts reach (3.025–5.975, to three figures)
    expect(e.floor_span_fraction as number).toBeLessThan(0.05);
    expect(e.pedestal_left).toBe(false);
    expect(judge("flatten", e)).toMatchObject({ kind: "pass", reasons: [] });
    expect(byPlanes(planes)).toBe(false);
    expect(headline("flatten", e)).toBe(`floor ≤ ${e.max_after_floor_sigma}σ · trend ${e.floor_trend} · span ${e.floor_span_fraction} · no pedestal`);
  });

  it("reads an isotropic pedestal at the span and trend it was built with, as the planes do", async () => {
    const b = 0.06; // b·|Q|²: 9b at 3 Å⁻¹, 36b at 6 Å⁻¹
    const { e, floors, planes } = await evaluateWith((_h, _k, _l, q) => b * q * q);
    const [lo, hi] = e.floor_judged_q as [number, number];
    expect([lo, hi]).toEqual([3.02, 5.97]);
    expect(e.floor_trend).toBe(1);
    // The span built in: b·(hi² − lo²) over the flatten input's level.
    expect(e.floor_span_fraction as number).toBeCloseTo((b * (hi * hi - lo * lo)) / floors.level!, 1);
    expect(Math.abs((e.floor_span_fraction as number) / ((b * (hi * hi - lo * lo)) / floors.level!) - 1)).toBeLessThan(0.02);
    expect(e.pedestal_left).toBe(true);
    expect(judge("flatten", e)).toMatchObject({ kind: "attention", reasons: ["pedestal"] });
    // The planes read it too, with a span a little higher: a plane's median
    // level weights the inner shells more than the volume's does (#37: 5 % on this pedestal).
    for (const p of planes) expect([p.floor_trend, p.floor_span_fraction >= 0.8]).toEqual([1, true]);
    const planeSpan = Math.min(...planes.map((p) => p.floor_span_fraction));
    expect(e.floor_span_fraction as number).toBeLessThan(planeSpan);
    expect(e.floor_span_fraction as number).toBeGreaterThan(0.85 * planeSpan);
    expect(headline("flatten", e)).toMatch(/ · pedestal left$/);
  });

  it("sees a pedestal the three planes miss: one off the planes h = 0, k = 0 and l = 0", async () => {
    const b = 0.06;
    const off = (h: number, k: number, l: number, q: number) => (h === 0 || k === 0 || l === 0 ? 0 : b * q * q);
    const { e, planes } = await evaluateWith(off);
    for (const p of planes) expect(p.floor_span_fraction).toBeLessThan(0.2); // a level floor on every plane
    expect(byPlanes(planes)).toBe(false); // the planes' rule passed it
    expect(e.floor_trend as number).toBeGreaterThanOrEqual(0.99);
    expect(e.floor_span_fraction as number).toBeGreaterThanOrEqual(0.8);
    expect(judge("flatten", e)).toMatchObject({ kind: "attention", reasons: ["pedestal"] });
  });

  it("judges the volume's shells from the run's fit range, read with the floors (4.11), and says when the file records none", async () => {
    // The run fitted 5–10 Å⁻¹ only: below 5 Å⁻¹ its model, extrapolated, sits
    // too high, and the floors climb 1 per Å⁻¹ up to it; from 5 out they are level.
    const climb = (_h: number, _k: number, _l: number, q: number) => (q < 5 ? q - 5 : 0);
    const run = await evaluateWith(climb, { ...DEFAULT_RECORD, fit_q_range: [5, 10] });
    expect((run.e.floor_judged_q as number[])[0]).toBeGreaterThanOrEqual(5);
    for (const p of run.planes) expect(p.floor_judged_q[0]).toBeGreaterThanOrEqual(5);
    expect(run.e.pedestal_left).toBe(false);
    expect(run.e).not.toHaveProperty("settings_note");
    expect(api.fetchMeta).not.toHaveBeenCalledWith("demo.flattened"); // the record came with the floors
    // The same floors without the record: judged with the defaults, which read the climb, and said so.
    const old = await evaluateWith(climb, null);
    expect(old.e.floor_judged_q).toEqual([3.02, 5.97]);
    expect(old.e.pedestal_left).toBe(true);
    expect(old.e.settings_note).toBe(FLATTEN_UNRECORDED_NOTE);
  });

  it("does not judge the pedestal when the volume's floors cannot be read, or were read without the flatten's input", async () => {
    const { e, floors } = await evaluateWith((_h, _k, _l, q) => 0.06 * q * q);
    api.fetchShellFloors.mockRejectedValue(new Error("500"));
    const unread = await evaluateStage("flatten", withFlat);
    expect([unread.floor_trend, unread.floor_span_fraction, unread.pedestal_left]).toEqual([null, null, null]);
    expect(judge("flatten", unread)).toMatchObject({ kind: "info", reasons: ["nothing to judge"] });
    // Without the input there is no diffuse level: the volume's own median is no span's denominator.
    api.fetchShellFloors.mockResolvedValue({ ...floors, before_id: null });
    const alone = await evaluateStage("flatten", withFlat);
    expect([alone.floor_trend, alone.floor_span_fraction, alone.pedestal_left]).toEqual([e.floor_trend, null, null]);
  });

  it("reads an evaluation recorded before 4.1 by the planes' largest trend and span, as then", () => {
    const old = { max_after_floor_sigma: 1.8, max_floor_trend: 0.97, max_floor_span_fraction: 0.97, pedestal_left: true };
    expect(judge("flatten", old)).toMatchObject({ kind: "attention", reasons: ["pedestal"] });
    expect(headline("flatten", old)).toBe("floor ≤ 1.8σ · trend ≤ 0.97 · span ≤ 0.97 · pedestal left");
    expect(headline("flatten", { max_after_floor_sigma: 0.8 })).toBe("floor ≤ 0.8σ · trend ≤ – · span ≤ –"); // not measured: not said
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
