// What a Pilot check makes the in-browser worker read, through the dev-data
// bridge (the Pages path: the engine's Worker messages answered by
// nebula3d.webbridge, which holds two volumes and one ΔPDF as in a tab): each
// volume once per check, where plane by plane across the stages every slice
// read one.

import { describe, expect, it } from "vitest";

import { engine } from "../../../api/pyodideEngine";
import { forgetSlices, resetSliceStoreCounts, sliceStoreCounts } from "../../../api/sliceStore";
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
    forgetSlices();
    const read: Record<string, number> = {};
    for (const stage of ["rings", "punch", "backfill", "flatten"]) {
      forgetSlices(); // each check as if nothing were kept (the next test keeps them)
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
    forgetSlices();
    const symmetry = await reads(async () => expect((await c.tool("symmetry_check", {})).ok).toBe(true));
    expect(symmetry).toMatchObject({ volumes: 0, dpdfs: 1 });
    const texture = await reads(async () => expect((await c.tool("texture_check", {})).ok).toBe(true));
    // Its three planes of the ring-removed, punched and backfilled volumes;
    // the backend's own pass over the holes reads its two volumes besides.
    expect(texture.volumes).toBeLessThanOrEqual(5);
  });

  it("reads no volume again for the checks that follow, gives them the same results, and reads again after a run", async () => {
    const c = devCase("dev-control");
    await c.dataset();
    forgetSlices();
    resetSliceStoreCounts();
    const stages = ["rings", "punch", "backfill", "flatten", "pdf"];
    const each: Record<string, unknown> = {};
    for (const stage of stages) each[stage] = (await c.tool("assess_stage", { stage })).result;
    expect(sliceStoreCounts().kept).toBe(18); // five volumes' three planes and the ΔPDF's three sections, once

    // The final checks: every stage again. No slice is read again; the
    // backend's own passes over a volume (the rings' 3-D test on the raw
    // volume, the shell floors on the flattened one and the flatten's input)
    // are no slices.
    let all: Awaited<ReturnType<typeof c.tool>> | undefined;
    const again = await reads(async () => {
      all = await c.tool("assess_stage", { stage: "all" });
    });
    expect(all?.ok, all?.summary).toBe(true);
    expect(again.dpdfs).toBe(0);
    expect(again.volumes).toBeLessThanOrEqual(3);
    expect(sliceStoreCounts().kept).toBe(18);
    // The same check with nothing kept gives the same result, to the letter.
    forgetSlices();
    const fresh = await c.tool("assess_stage", { stage: "all" });
    expect(JSON.stringify(all?.result)).toBe(JSON.stringify(fresh.result));
    for (const stage of stages) {
      forgetSlices();
      expect(JSON.stringify((await c.tool("assess_stage", { stage })).result), stage).toBe(JSON.stringify(each[stage]));
    }

    // A run: the files may have changed, so every version is gone and every slice is read again.
    await c.tool("assess_stage", { stage: "punch" });
    const kept = sliceStoreCounts().kept;
    const made = await c.tool("run_pipeline", { from_stage: "backfill" });
    expect(made.ok, made.summary).toBe(true);
    const after = await reads(async () => expect((await c.tool("assess_stage", { stage: "punch" })).ok).toBe(true));
    expect(after.volumes).toBe(5);
    expect(sliceStoreCounts().kept).toBe(kept + 15);
  });
});
