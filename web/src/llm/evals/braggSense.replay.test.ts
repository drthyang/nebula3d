// THY-43 on the validation's dev cases, through the Pages path (the client,
// the engine and the CPython bridge to nebula3d.webbridge; nothing recorded):
//
// - the pre-run Bragg sensing keeps the defaults on the synthetic cases, whose
//   peaks are round and declared symmetric or not symmetrised at all: no
//   footprint, no constraint dropped, no symmetry to declare; on the replays'
//   coarse grid it judges nothing, and says why;
// - the punch check, which now judges the maxima beside the punch's holes,
//   finds no Bragg tail on the clean control's default run, and none left
//   after the fill: its verdict is the one it was.
//
// The sensing needs a grid that resolves a peak's shape (a voxel under the
// resolution ellipsoid's 0.115 Å⁻¹): the validation's own, 161 voxels.

import { describe, expect, it } from "vitest";

import { devCase, type DevCaseId } from "./devData";
import { DEV_GRIDS } from "./devData/bridgeWorker";

/** The validation's own grid, fine enough for the peaks' shapes. */
const FINE = { n: DEV_GRIDS[1] } as const;

const sensed = async (id: DevCaseId, opts?: Parameters<typeof devCase>[1]) => {
  const c = devCase(id, opts);
  const r = await c.tool("bragg_sense", {});
  expect(r.ok, JSON.stringify(r.result)).toBe(true);
  return r.result;
};

describe("the pre-run Bragg sensing on the dev cases", () => {
  it.each(["dev-control", "dev-ub"] as const)("keeps the defaults on %s, with nothing to declare", async (id) => {
    const out = await sensed(id, FINE);
    expect(out.recommend).toBe("keep the defaults");
    expect(String(out.footprint)).toMatch(/^punchFootprint own \(keep\): /);
    expect(out).not.toHaveProperty("constraints");
    expect(out).not.toHaveProperty("q");
    expect(out).not.toHaveProperty("symmetry");
  });

  it("judges nothing on the replays' coarse grid, and says why", async () => {
    const out = await sensed("dev-control");
    expect(String(out.shape)).toMatch(/^grid too coarse: a voxel spans /);
    expect(out.recommend).toBe("keep the defaults");
  });
});

describe("the punch check beside the holes, on the clean control", () => {
  it("finds no Bragg tail and none after the fill; the verdict stands", async () => {
    const c = devCase("dev-control");
    const r = await c.tool("assess_stage", { stage: "punch" });
    expect(r.ok, JSON.stringify(r.result)).toBe(true);
    const punch = r.result.punch as Record<string, unknown>;
    expect(punch.verdict).toBe("meets its goal");
    expect([punch.leftover_at_nodes, punch.leftover_bragg_tails, punch.left_after_backfill]).toEqual([0, 0, 0]);
    expect(String(punch.headline)).toMatch(/^0 missed at nodes · 0 Bragg tails · /);
  });
});
