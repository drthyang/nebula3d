// The tuning run's stage measurement against a mocked API: every principal
// plane is measured, cuts outside the grid are skipped, and the punch reports
// the share of measured voxels it removed.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../api/types";
import { evaluateStage, headline } from "../tune/evaluate";
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
    expect(e.fitted_peaks).toBe(12);
    expect(headline("punch", e)).toBe("0 leftover · punched 0.04");
  });
});
