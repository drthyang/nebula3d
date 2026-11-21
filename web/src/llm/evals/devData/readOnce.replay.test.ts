// What a Pilot check makes the in-browser worker read, through the dev-data
// bridge (the Pages path: the engine's Worker messages answered by
// nebula3d.webbridge, which holds two volumes and one ΔPDF as in a tab): each
// volume once per check, where plane by plane across the stages every slice
// read one.

import { describe, expect, it } from "vitest";

import { engine } from "../../../api/pyodideEngine";
import { devCase } from "./index";

/** The whole-volume and whole-ΔPDF reads `run` makes in the worker. */
async function reads(run: () => Promise<unknown>): Promise<{ volumes: number; dpdfs: number; held: number }> {
  const before = await engine.readCounts();
  await run();
  const after = await engine.readCounts();
  return { volumes: after.volume_reads - before.volume_reads, dpdfs: after.dpdf_reads - before.dpdf_reads, held: after.volumes_cached };
}

describe("what a check reads in the worker, on the dev control", () => {
  it("reads each stage's volume once for a stage check, the ΔPDF once for its own", async () => {
    const c = devCase("dev-control");
    await c.dataset();
    const read: Record<string, number> = {};
    for (const stage of ["rings", "punch", "backfill", "flatten"]) {
      const r = await reads(async () => expect((await c.tool("assess_stage", { stage })).ok).toBe(true));
      read[stage] = r.volumes;
      expect(r.dpdfs, stage).toBe(0);
      expect(r.held).toBeLessThanOrEqual(2);
    }
    // Five stages' volumes, each once: the three planes come together (one
    // fewer where the check before left a volume in the cache). Besides the
    // slices, the ring check's 3-D test of each bump reads the raw volume for
    // itself, and the flatten's shell floors read the flattened volume and
    // the flatten's input: they are no slices.
    const most = { rings: 6, punch: 5, backfill: 5, flatten: 7 };
    for (const [stage, n] of Object.entries(most)) expect(read[stage], stage).toBeLessThanOrEqual(n);
    const pdf = await reads(async () => expect((await c.tool("assess_stage", { stage: "pdf" })).ok).toBe(true));
    expect(pdf).toMatchObject({ volumes: 0, dpdfs: 1 });
  });

  it("reads the ΔPDF once for the symmetry check, and three volumes once each for the fills' texture", async () => {
    const c = devCase("dev-control");
    await c.dataset();
    const symmetry = await reads(async () => expect((await c.tool("symmetry_check", {})).ok).toBe(true));
    expect(symmetry).toMatchObject({ volumes: 0, dpdfs: 1 });
    const texture = await reads(async () => expect((await c.tool("texture_check", {})).ok).toBe(true));
    // Its three planes of the ring-removed, punched and backfilled volumes;
    // the backend's own pass over the holes reads its two volumes besides.
    expect(texture.volumes).toBeLessThanOrEqual(5);
  });
});
