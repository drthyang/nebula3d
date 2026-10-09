// loadPipelineContext's data wiring: the pipeline's saved back-FFT check must
// reach the ΔPDF section of the context the model reads, and a missing or
// failed check must leave it null without breaking the rest of the context.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ConsistencyCheck, Dataset } from "../../api/types";
import { loadPipelineContext } from "../context/loadContext";
import { makeSlice } from "./helpers";

const api = vi.hoisted(() => ({
  fetchBraggProfile: vi.fn(),
  fetchConsistencyCheck: vi.fn(),
  fetchDpdfMeta: vi.fn(),
  fetchDpdfSlice: vi.fn(),
  fetchMeta: vi.fn(),
  fetchSlice: vi.fn(),
}));
vi.mock("../../api/client", () => api);

const dataset: Dataset = {
  id: "demo",
  temperature: null,
  raw_name: "demo.nxs",
  stem: "demo",
  stages: [
    { name: "raw", exists: true, kind: "hkl", volume_id: "demo.raw" },
    { name: "delta_pdf", exists: true, kind: "delta_pdf", volume_id: "demo.delta_pdf" },
  ],
};

const check = (metrics: ConsistencyCheck["metrics"]): ConsistencyCheck => ({
  dataset_id: "demo",
  check_path: "/work/processed/demo_delta_pdf_consistency.json",
  has_check: metrics !== null,
  metrics,
});

const METRICS = {
  pearson_r: 0.97812,
  normalized_rms: 0.20931,
  rms: 0.01,
  n_voxels: 1000,
  per_plane_r: {},
  q_band: null,
  crop_hkl: null,
  apodization: "none",
};

beforeEach(() => {
  vi.resetAllMocks();
  const missing = () => Promise.reject(new Error("404"));
  api.fetchMeta.mockImplementation(missing);
  api.fetchDpdfMeta.mockImplementation(missing);
  api.fetchSlice.mockImplementation(missing);
  api.fetchBraggProfile.mockImplementation(missing);
  api.fetchDpdfSlice.mockResolvedValue(makeSlice(21, 21, (x, y) => Math.cos(x) * Math.cos(y)));
});

describe("loadPipelineContext", () => {
  it("passes the pipeline's saved back-FFT check into the ΔPDF context", async () => {
    api.fetchConsistencyCheck.mockResolvedValue(check(METRICS));
    const { context } = await loadPipelineContext(dataset);
    expect(api.fetchConsistencyCheck).toHaveBeenCalledWith("demo");
    expect(context.delta_pdf?.consistency_pearson_r).toBe(0.978);
    expect(context.delta_pdf?.consistency_normalized_rms).toBe(0.209);
  });

  it("leaves consistency null when the check never ran", async () => {
    api.fetchConsistencyCheck.mockResolvedValue(check(null));
    const { context } = await loadPipelineContext(dataset);
    expect(context.delta_pdf).toBeDefined();
    expect(context.delta_pdf?.consistency_pearson_r).toBeNull();
  });

  it("tolerates a failed check fetch", async () => {
    api.fetchConsistencyCheck.mockRejectedValue(new Error("500"));
    const { context } = await loadPipelineContext(dataset);
    expect(context.delta_pdf).toBeDefined();
    expect(context.delta_pdf?.consistency_pearson_r).toBeNull();
  });

  it("skips the check when the dataset has no ΔPDF", async () => {
    const noDpdf = { ...dataset, stages: dataset.stages.filter((s) => s.kind !== "delta_pdf") };
    const { context } = await loadPipelineContext(noDpdf);
    expect(api.fetchConsistencyCheck).not.toHaveBeenCalled();
    expect(context.delta_pdf).toBeUndefined();
  });
});
