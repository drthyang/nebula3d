// The checks ask for their slices volume by volume (api/sliceBatch.ts): a
// stage check reads each stage's volume once for its three planes, the ΔPDF
// once for its three sections, and the other checks likewise, so the
// in-browser worker (two volumes held) reads each volume once per check.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../api/types";
import { makeSlice } from "./helpers";

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

const batch = vi.hoisted(() => ({ readSlices: vi.fn(), readDpdfSlices: vi.fn() }));
vi.mock("../../api/sliceBatch", () => batch);

import { loadPipelineContext, readCuts } from "../context/loadContext";
import { evaluateStage } from "../tune/evaluate";

const HKL = ["raw", "ringremoved", "braggpunched", "backfilled", "flattened"];
const dataset: Dataset = {
  id: "demo",
  temperature: null,
  raw_name: "demo.nxs",
  stem: "demo",
  stages: [
    ...HKL.map((name) => ({ name, exists: true, kind: "hkl" as const, volume_id: `demo.${name}` })),
    { name: "delta_pdf", exists: true, kind: "delta_pdf" as const, volume_id: "demo.delta_pdf", source: "flattened" },
  ],
};

const PLANES = [
  { plane: "hk0", value: 0 },
  { plane: "h0l", value: 0 },
  { plane: "0kl", value: 0 },
];
const SECTIONS = [
  { plane: "xy", value: 0 },
  { plane: "xz", value: 0 },
  { plane: "yz", value: 0 },
];

beforeEach(() => {
  vi.resetAllMocks();
  api.fetchMeta.mockResolvedValue({ shape: [21, 21, 21], h_range: [-2, 2], k_range: [-2, 2], l_range: [-2, 2], lattice: { a: 4, b: 4, c: 4 } });
  api.fetchDpdfMeta.mockResolvedValue({ shape: [21, 21, 21], lattice: { a: 4, b: 4, c: 4 }, window_open_weight: 0.1, window_shape: "hann" });
  for (const f of [api.fetchBraggProfile, api.fetchConsistencyCheck, api.fetchProtectedLabels, api.fetchRingDiagnostics, api.fetchRingIsotropy, api.fetchShellFloors])
    f.mockRejectedValue(new Error("none"));
  batch.readSlices.mockImplementation((_id: string, cuts: unknown[]) => cuts.map(async () => makeSlice(21, 21, (x, y) => 1 + x * x + y * y)));
  batch.readDpdfSlices.mockImplementation((_id: string, cuts: unknown[]) => cuts.map(async () => makeSlice(21, 21, (x, y) => x - y)));
});

describe("a stage check", () => {
  it.each(["rings", "punch", "backfill", "flatten"] as const)("reads each stage's volume once for the three planes (%s)", async (stage) => {
    await evaluateStage(stage, dataset);
    expect(batch.readSlices.mock.calls).toEqual(HKL.map((name) => [`demo.${name}`, PLANES]));
    expect(batch.readDpdfSlices).not.toHaveBeenCalled();
    // Never plane by plane.
    expect(api.fetchSlice).not.toHaveBeenCalled();
  });

  it("reads the ΔPDF once for its three sections", async () => {
    await evaluateStage("pdf", dataset);
    expect(batch.readDpdfSlices.mock.calls).toEqual([["demo.delta_pdf", SECTIONS]]);
    expect(batch.readSlices).not.toHaveBeenCalled();
    expect(api.fetchDpdfSlice).not.toHaveBeenCalled();
  });

  it("skips a plane outside the grid for every volume alike", async () => {
    api.fetchMeta.mockResolvedValue({ shape: [21, 21, 21], h_range: [-2, 2], k_range: [-2, 2], l_range: [0.5, 1.5], lattice: { a: 4, b: 4, c: 4 } });
    await evaluateStage("punch", dataset);
    expect(batch.readSlices.mock.calls).toEqual(HKL.map((name) => [`demo.${name}`, PLANES.slice(1)]));
  });
});

describe("one cut's context", () => {
  it("asks each volume for its cut, and the ΔPDF for its section", async () => {
    await loadPipelineContext(dataset, { records: false });
    expect(batch.readSlices.mock.calls).toEqual(HKL.map((name) => [`demo.${name}`, [PLANES[0]]]));
    expect(batch.readDpdfSlices.mock.calls).toEqual([["demo.delta_pdf", [SECTIONS[0]]]]);
  });

  it("gives null for a slice that could not be read, and reads a cut it was not given alone", async () => {
    batch.readSlices.mockImplementation((id: string, cuts: unknown[]) =>
      cuts.map(async () => {
        if (id === "demo.raw") throw new Error("gone");
        return makeSlice(5, 5, () => 1);
      }),
    );
    const slices = readCuts(dataset, PLANES, []);
    expect(await slices.recip("raw", PLANES[1])).toBeNull();
    expect(await slices.recip("flattened", PLANES[2])).not.toBeNull();
    expect(batch.readSlices).toHaveBeenCalledTimes(5);
    await slices.recip("flattened", { plane: "hk0", value: 0.5 });
    expect(batch.readSlices).toHaveBeenLastCalledWith("demo.flattened", [{ plane: "hk0", value: 0.5 }]);
    // −0 is not +0: another cut.
    await slices.recip("flattened", { plane: "hk0", value: -0 });
    expect(batch.readSlices).toHaveBeenCalledTimes(7);
    await slices.dpdf(SECTIONS[0]);
    expect(batch.readDpdfSlices.mock.calls).toEqual([["demo.delta_pdf", [SECTIONS[0]]]]);
  });
});
