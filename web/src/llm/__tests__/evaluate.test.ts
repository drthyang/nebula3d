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
    expect(e.leftover_at_nodes).toBe(0);
    expect(e.fitted_peaks).toBe(12);
    expect(e.leftover_on_protected_planes).toBe(0);
    expect(headline("punch", e)).toBe("0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.04");
  });

  it("counts a ring only where two planes see it; a one-plane bump is crystal scattering", async () => {
    const g = (r: number, r0: number) => Math.exp(-((r - r0) ** 2) / 0.5);
    // Raw: a powder ring at r = 6 on every plane, and on h0l alone a bump at
    // r = 12.  Ring-removed: the ring over-shot by 20 %, the h0l bump left.
    api.fetchSlice.mockImplementation(async (id: string, plane: string) =>
      makeSlice(161, 161, (x, y) => {
        const r = Math.hypot(x, y);
        const bump = plane === "h0l" ? 4 * g(r, 12) : 0;
        return id.endsWith("raw") ? 1 + 8 * g(r, 6) + bump : 1 - 0.2 * g(r, 6) + bump;
      }, { half: 20 }),
    );
    const e = await evaluateStage("rings", dataset);
    const dent = e.worst_ring_dent as { at: number; plane: string };
    expect(dent).not.toBeNull();
    expect(e.max_ring_left).toBe(0); // the h0l-only bump is not a ring left over
    const bumps = e.single_plane_bumps as { plane: string; at: number }[];
    expect(bumps.map((b) => b.plane)).toEqual(["h0l"]);
    expect(bumps[0].at).toBeGreaterThan(dent.at);
  });

  it("names the plane and |Q| of the worst ring residual in the headline", () => {
    const e = {
      mean_ring_energy_ratio: 0.24,
      max_over_subtraction_fraction: 0.03,
      max_ring_dent: 0.233,
      max_ring_left: 0,
      worst_ring_dent: { plane: "h0l", at: 7.58, residual_fraction: -0.233 },
      worst_ring_left: null,
    };
    expect(headline("rings", e)).toBe("ring ratio 0.24 · over-sub ≤ 0.03 · ring dent ≤ 0.233 (h0l, 7.58 Å⁻¹) · left ≤ 0");
  });
});
