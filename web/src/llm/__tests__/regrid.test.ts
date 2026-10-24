// regrid_refined_ub on the synthetic crystal behind a mocked API
// (syntheticCrystal.ts): its gate (it runs only when the user's latest message
// asks for a regrid), the request it makes (the dataset, the punch cell as the
// Bragg nodes, q_max: the UB check's fit), the backend's refusals read as data
// and passed on in the backend's own words, and what it leaves alone: the
// selected dataset, the pipeline and the settings. docs/regrid.md.
//
// Hermetic and synthetic: no backend is called, and no measured data is used.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryClient } from "../../api/queryClient";
import type { RegridResult } from "../../api/types";
import { usePipelineStore } from "../../state/pipelineStore";
import { callTool, CHAT_TOOLS, factsOf, toolsWithSkills, type ToolContext } from "../tools";
import { contractDisagreements } from "../tools/contracts";
import { regridRefusal } from "../tune/catalog";
import { DATASET, DATASETS, freshConsole, installBackend, regridAnswer } from "./syntheticCrystal";

const api = vi.hoisted(() => ({
  fetchBraggProfile: vi.fn(),
  fetchConsistencyCheck: vi.fn(),
  fetchDataset: vi.fn(),
  fetchDpdfFeatures: vi.fn(),
  fetchDpdfMeta: vi.fn(),
  fetchDpdfSlice: vi.fn(),
  fetchMeta: vi.fn(),
  fetchRingDiagnostics: vi.fn(),
  fetchRingIsotropy: vi.fn(),
  fetchShellFloors: vi.fn(),
  fetchSlice: vi.fn(),
  fetchUbCheck: vi.fn(),
  fetchVolumeCoverage: vi.fn(),
  fetchVolumeTexture: vi.fn(),
  regridDataset: vi.fn(),
}));
vi.mock("../../api/client", () => api);

const ASKED = "The UB is turned: regrid the volume onto the refined UB.";
const ctxFor = (userMessage?: string): ToolContext => ({ dataset: DATASET, datasets: DATASETS, userMessage });
const regrid = (userMessage: string | undefined, args: Record<string, unknown> = {}) => callTool(ctxFor(userMessage), "regrid_refined_ub", args);

/** The backend's answer, with fields changed: a refusal of another kind. */
const answered = (fields: Partial<RegridResult>, turned = false) => api.regridDataset.mockResolvedValueOnce({ ...regridAnswer(DATASET.id, { turned }), ...fields });

beforeEach(() => {
  vi.clearAllMocks();
  installBackend(api);
  freshConsole();
});

describe("regrid_refined_ub's gate: the user's to run", () => {
  it("refuses a call the user's latest message does not ask for, before it reaches the backend", async () => {
    for (const said of [undefined, "", "Is the UB right?", "Refine the UB.", "Yes, do it.", "Is the punch clean? Take it to a 3D-ΔPDF you would trust."]) {
      const r = await regrid(said);
      expect(r.ok, String(said)).toBe(false);
      expect(r.text).toBe(`Error: ${regridRefusal()}`);
    }
    expect(api.regridDataset).not.toHaveBeenCalled();
  });

  it("refuses with the skills on and off alike, a skill read or not: no skill gate, only the user's asking", async () => {
    const off = await callTool({ ...ctxFor("Is the UB right?"), skills: false }, "regrid_refined_ub", {}, { tools: toolsWithSkills(CHAT_TOOLS, false) });
    const on = await callTool({ ...ctxFor("Is the UB right?"), skillsRead: new Set(["reduction-qc"]) }, "regrid_refined_ub", {});
    expect(off.text).toBe(on.text);
    const asked = await callTool({ ...ctxFor(ASKED), skillsRead: new Set() }, "regrid_refined_ub", {});
    expect(asked.ok, asked.text).toBe(true);
  });

  it("runs once the user's latest message asks for a regrid", async () => {
    const r = await regrid(ASKED);
    expect(r.ok, r.text).toBe(true);
    expect(api.regridDataset).toHaveBeenCalledTimes(1);
  });
});

describe("regrid_refined_ub's request", () => {
  it("regrids the selected dataset with the punch cell as the Bragg nodes, as ub_check fits", async () => {
    await regrid(ASKED);
    expect(api.regridDataset).toHaveBeenLastCalledWith("synthetic_a", [1, 1, 1], null);
    usePipelineStore.setState({ punchSupercellH: "2", punchSupercellK: "2", punchSupercellL: "1" });
    await regrid(ASKED, { q_max: 4 });
    expect(api.regridDataset).toHaveBeenLastCalledWith("synthetic_a", [2, 2, 1], 4);
    await regrid(ASKED, { q_max: "3.5" });
    expect(api.regridDataset).toHaveBeenLastCalledWith("synthetic_a", [2, 2, 1], 3.5);
  });

  it("checks q_max, and acts on nothing while a run owns the pipeline", async () => {
    expect((await regrid(ASKED, { q_max: -1 })).text).toBe("Error: invalid arguments — q_max must be positive");
    expect((await regrid(ASKED, { q_max: "x" })).text).toMatch(/invalid arguments — q_max must be a number/);
    usePipelineStore.setState({ running: true });
    expect((await regrid(ASKED)).text).toBe("Error: a pipeline run is in progress; wait for it to end");
    expect(api.regridDataset).not.toHaveBeenCalled();
  });

  it("passes on the backend's error: too few peaks to fit, no raw volume", async () => {
    api.regridDataset.mockRejectedValueOnce(new Error("too few Bragg peaks to fit (3 found, 6 needed)"));
    const r = await regrid(ASKED);
    expect(r.ok).toBe(false);
    expect(r.text).toBe("Error: too few Bragg peaks to fit (3 found, 6 needed)");
  });
});

describe("regrid_refined_ub's result", () => {
  it("writes the new dataset, says what it is and what the regrid cost, and lists it in the console", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const ctx = ctxFor(ASKED);
    api.regridDataset.mockResolvedValueOnce(regridAnswer(DATASET.id, { turned: true }));
    const r = await callTool(ctx, "regrid_refined_ub", {});
    expect(r.ok, r.text).toBe(true);
    const out = JSON.parse(r.text);
    expect(out).toEqual({
      written: true,
      refusal: null,
      dataset_id: "synthetic_a_regridded",
      file: "synthetic_a_regridded.nxs",
      source_file: "synthetic_a.nxs",
      refined_on: "synthetic_a.nxs",
      fit: "both",
      bragg_nodes_every: [1, 1, 1],
      turn_deg: 0.3001,
      turn_threshold_deg: 0.05,
      axis_uvw: [0.12, -0.31, 0.94],
      rms_start: 0.0171,
      rms: 0.0002,
      cell_start: "4.0000, 4.0000, 4.0000 Å; 90.000°, 90.000°, 90.000°",
      cell: "4.0012, 4.0009, 3.9994 Å; 90.010°, 89.990°, 90.000°",
      peaks_used: 112,
      symmetrised: false,
      measured_before: 812400,
      measured_after: 808150,
      voxels_outside: 4120,
      voxels_outside_share: 0.0051,
    });
    expect(r.summary).toBe("wrote synthetic_a_regridded.nxs (dataset synthetic_a_regridded); turn 0.3001°, RMS 0.0171 → 0.0002 Å⁻¹");
    expect(contractDisagreements("regrid_refined_ub", out)).toEqual([]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["datasets"] });
    // It selects nothing, runs nothing and changes no setting: the new dataset is the user's to reduce.
    expect(ctx.dataset).toBe(DATASET);
    expect(usePipelineStore.getState()).toMatchObject({ running: false, events: [] });
    invalidate.mockRestore();
  });

  it("reads a turn within the fit's noise as the backend's refusal, nothing written, in the backend's words", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const r = await regrid(ASKED);
    expect(r.ok, r.text).toBe(true);
    const out = JSON.parse(r.text);
    expect(out).toMatchObject({ written: false, dataset_id: null, file: null, turn_deg: 0.003, turn_threshold_deg: 0.05, measured_before: null });
    expect(out.refusal).toEqual(regridAnswer(DATASET.id).refusal);
    expect(r.summary).toBe("nothing written: turn_below_noise; turn 0.0030°");
    expect(contractDisagreements("regrid_refined_ub", out)).toEqual([]);
    expect(invalidate).not.toHaveBeenCalled();
    invalidate.mockRestore();
  });

  it("reads each of the backend's refusals as data, with the fields it came before null", async () => {
    const beforeFit = {
      dataset_id: null, file: null, refined_on: null, fit: null, turn_deg: null, axis_uvw: null, ub_start: null, ub: null,
      cell_start: null, cell: null, rms_start: null, rms: null, n_used: null,
    } satisfies Partial<RegridResult>;
    const refusals: [Partial<RegridResult>, Record<string, unknown>][] = [
      // An existing target: refused before the fit, and it names the dataset in the way.
      [
        { ...beforeFit, fit: "both", refusal: { code: "target_exists", reason: "synthetic_a_regridded.nxs already exists beside synthetic_a.nxs: regridding never overwrites a file, and nothing was written. Use that dataset, or move the file away to regrid again." }, dataset_id: "synthetic_a_regridded", file: "synthetic_a_regridded.nxs" },
        { dataset_id: "synthetic_a_regridded", file: "synthetic_a_regridded.nxs", fit: "both", turn_deg: null },
      ],
      // A symmetrised volume without its unsymmetrised source: only the symmetric fit applies.
      [
        { ...beforeFit, fit: "symmetric", refusal: { code: "symmetrised_without_source", reason: "synthetic_a.nxs is symmetrised under the 8 operations declared for it (it differs from its images by 1.2e-07): a turned UB shows there as rings around the nodes, not as shifts, so only the symmetric fit applies, and it cannot turn the UB. Regridding needs the unsymmetrised volume it was made from, and synthetic_a.nxs names none as its source. Nothing was written." } },
        { dataset_id: null, fit: "symmetric", cell: null, rms: null },
      ],
    ];
    for (const [fields, expected] of refusals) {
      answered(fields);
      const r = await regrid(ASKED);
      expect(r.ok, r.text).toBe(true);
      const out = JSON.parse(r.text);
      expect(out.written).toBe(false);
      expect(out.refusal).toEqual(fields.refusal);
      expect(out).toMatchObject(expected);
      expect(r.summary).toBe(`nothing written: ${fields.refusal!.code}`);
      expect(contractDisagreements("regrid_refined_ub", out), fields.refusal!.code).toEqual([]);
    }
  });

  it("is called again as often as the model calls it: a second call names the dataset the first one wrote", async () => {
    // It acts (its facts), so the repeat guard never stands in for it; the backend refuses the second as an existing target.
    expect(factsOf("regrid_refined_ub").acts).toBe("dataset");
    answered({}, true);
    answered({ refusal: { code: "target_exists", reason: "synthetic_a_regridded.nxs already exists beside synthetic_a.nxs." }, written: false, dataset_id: "synthetic_a_regridded", file: "synthetic_a_regridded.nxs", turn_deg: null, rms_start: null, rms: null, measured_before: null, measured_after: null, voxels_outside: null, voxels_outside_share: null, axis_uvw: null, cell_start: null, cell: null, n_used: null, refined_on: null });
    const first = JSON.parse((await regrid(ASKED)).text);
    const second = JSON.parse((await regrid(ASKED)).text);
    expect(first.written).toBe(true);
    expect(second).toMatchObject({ written: false, dataset_id: first.dataset_id, file: first.file });
    expect(second.refusal.code).toBe("target_exists");
  });
});
