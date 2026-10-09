// The assistant's tools against a mocked API: argument checking, the line
// profile's row/column pick, the Bragg-peak sort, and show_in_viewer moving
// the console's stores.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BraggProfile, Dataset, VolumeMeta } from "../../api/types";
import { useDpdfStore } from "../../state/dpdfStore";
import { useNavStore } from "../../state/navStore";
import { useViewerStore } from "../../state/viewerStore";
import { CHAT_TOOLS, runToolCall, type ToolContext } from "../tools";
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
  temperature: "T1",
  raw_name: "demo.nxs",
  stem: "demo",
  stages: [
    { name: "raw", exists: true, kind: "hkl", volume_id: "demo.raw" },
    { name: "flattened", exists: true, kind: "hkl", volume_id: "demo.flattened" },
    { name: "delta_pdf", exists: true, kind: "delta_pdf", volume_id: "demo.delta_pdf" },
  ],
};
const ctx: ToolContext = { dataset, datasets: [dataset] };

const META: VolumeMeta = {
  id: "demo.raw",
  stage: "raw",
  kind: "hkl",
  shape: [21, 21, 11],
  h_range: [-2, 2],
  k_range: [-2, 2],
  l_range: [-1, 1],
  lattice: { a: 4, b: 4, c: 6, alpha: 90, beta: 90, gamma: 90 },
  planes: ["hk0", "h0l", "0kl"],
};

const run = (name: string, args: object) =>
  runToolCall({ id: "c", type: "function", function: { name, arguments: JSON.stringify(args) } }, CHAT_TOOLS, ctx);

beforeEach(() => {
  vi.resetAllMocks();
  api.fetchMeta.mockResolvedValue(META);
  api.fetchDpdfMeta.mockResolvedValue({
    id: "demo.delta_pdf",
    shape: [41, 41, 21],
    x_range: [-20, 20],
    y_range: [-20, 20],
    z_range: [-10, 10],
    lattice: META.lattice,
    q_max: 6,
    planes: ["xy", "xz", "yz"],
  });
});

describe("runToolCall", () => {
  it("reports unparseable arguments and unknown tools to the model", async () => {
    const bad = await runToolCall({ id: "c", type: "function", function: { name: "describe_dataset", arguments: "{oops" } }, CHAT_TOOLS, ctx);
    expect(bad.ok).toBe(false);
    expect(bad.text).toMatch(/not a JSON object/);
    const unknown = await run("delete_everything", {});
    expect(unknown.text).toMatch(/no tool named delete_everything/);
  });

  it("rejects an out-of-range cut with the valid range", async () => {
    const r = await run("measure_reciprocal_cut", { plane: "hk0", value: 5 });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/invalid arguments — L = 5 is outside the data range \[-1, 1\]/);
  });

  it("rejects an unknown plane", async () => {
    const r = await run("measure_reciprocal_cut", { plane: "hkl", value: 0 });
    expect(r.text).toMatch(/plane must be one of hk0, h0l, 0kl/);
  });
});

describe("line_profile", () => {
  it("reads the row through the requested coordinate and finds its maximum", async () => {
    // hk0 plane: x = H, y = K.  A peak on the K = 1 row at H = 0.6.
    api.fetchSlice.mockResolvedValue(
      makeSlice(21, 21, (x, y) => (Math.abs(y - 1) < 1e-9 && Math.abs(x - 0.6) < 1e-9 ? 50 : 1), { half: 2 }),
    );
    const r = await run("line_profile", { stage: "flattened", along: "H", at: { K: 1, L: 0 }, n_points: 21 });
    expect(r.ok).toBe(true);
    expect(api.fetchSlice).toHaveBeenCalledWith("demo.flattened", "hk0", 0);
    const res = JSON.parse(r.text);
    expect(res.through).toEqual({ K: 1, L: 0 });
    expect(res.max).toEqual({ at: 0.6, value: 50 });
    expect(res.points).toHaveLength(21);
  });

  it("reads a column when the line runs along the plane's y axis", async () => {
    // Line along L through H = 0.4, K = 0 → the h0l plane (x = H, y = L) at K = 0,
    // on the meta's grid: H ∈ [-2, 2] (21 points), L ∈ [-1, 1] (11 points).
    const slice = makeSlice(21, 11, () => 0);
    slice.header.x_axis = Array.from({ length: 21 }, (_v, i) => -2 + 0.2 * i);
    slice.header.y_axis = Array.from({ length: 11 }, (_v, i) => -1 + 0.2 * i);
    slice.data[3 * 21 + 12] = 9; // L = -0.4 (row 3), H = 0.4 (column 12)
    api.fetchSlice.mockResolvedValue(slice);
    const r = await run("line_profile", { stage: "raw", along: "L", at: { H: 0.4, K: 0 } });
    expect(api.fetchSlice).toHaveBeenCalledWith("demo.raw", "h0l", 0);
    const res = JSON.parse(r.text);
    expect(res.through).toEqual({ H: 0.4, K: 0 });
    expect(res.max).toEqual({ at: -0.4, value: 9 });
  });
});

describe("bragg_peaks", () => {
  it("sorts by significance by default and by distance on request", async () => {
    const peak = (hkl: [number, number, number], sig: number) => ({
      index: 0,
      source_node_hkl: null,
      center_hkl: hkl,
      q_abs: 1,
      intensity: 10,
      local_background: 1,
      significance: sig,
      width_hkl: [0.1, 0.1, 0.1],
      width_q: [0.1, 0.1, 0.1],
      measured_width_q: [0.05, 0.05, 0.1],
      principal_directions_hkl: [],
      fit_kind: "covariance",
    });
    api.fetchBraggProfile.mockResolvedValue({
      has_profile: true,
      n_peaks: 3,
      punch_frame: "spherical",
      peaks: [peak([1, 0, 0], 8), peak([2, 0, 0], 30), peak([0, 1, 0], 12)],
    } as unknown as BraggProfile);
    const bySig = JSON.parse((await run("bragg_peaks", {})).text);
    expect(bySig.peaks.map((p: { hkl: number[] }) => p.hkl)).toEqual([[2, 0, 0], [0, 1, 0], [1, 0, 0]]);
    expect(bySig.peaks[0].anisotropy).toBe(2);
    const near = JSON.parse((await run("bragg_peaks", { near_hkl: [0, 1, 0], limit: 1 })).text);
    expect(near.peaks).toEqual([expect.objectContaining({ hkl: [0, 1, 0] })]);
  });
});

describe("show_in_viewer", () => {
  it("opens the cleanup page at the cut on the right axis", async () => {
    const r = await run("show_in_viewer", { view: "cleanup", plane: "h0l", value: 0.5 });
    expect(r.ok).toBe(true);
    expect(r.view).toMatchObject({ view: "cleanup", axis: "K", value: 0.5, label: "H–L plane at K = 0.5" });
    expect(useViewerStore.getState().fixedAxis).toBe("K");
    expect(useViewerStore.getState().focus).toEqual({ axis: "K", value: 0.5 });
    expect(useNavStore.getState().tab).toBe("reciprocal");
  });

  it("opens the ΔPDF page with the cut index for the section", async () => {
    await run("show_in_viewer", { view: "dpdf", plane: "xy", value: 5 });
    const s = useDpdfStore.getState();
    // z ∈ [-10, 10] over 21 points → z = 5 is index 15; x and y stay centred.
    expect([s.cutX, s.cutY, s.cutZ]).toEqual([20, 20, 15]);
    expect(useNavStore.getState().tab).toBe("dpdf");
  });
});
