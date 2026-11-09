// THY-81 through the dev-data bridge: the console's Pages path, the store's
// runs and the Pilot's tools reaching nebula3d.webbridge in CPython, on the
// dev control.
//
// - With the symmetry average on, a changed edge trim leaves the average
//   stale, and run_pipeline from the ring removal (the Pilot's rerun_from)
//   makes it again with every stage after it: the Configure page's stage
//   track then lists nothing stale. A current average is reused.
// - With the average off, a changed ring setting leaves the ring removal
//   stale, and run_pipeline from the punch makes it again with every stage
//   after it; current rings are reused.
// - A ring verdict's mark of the ring output (state/ringOutput.ts) goes stale
//   after a run of the Run button that recomputes the ring stage (Force on),
//   and the listing's date of the output moves with it; a run that reuses
//   the rings leaves it standing.

import { describe, expect, it } from "vitest";

import { fetchDataset, fetchStaleOutputs } from "../../../api/client";
import { enabledStages, formToParams, usePipelineStore } from "../../../state/pipelineStore";
import { ringOutputChanged, type RingOutputMark } from "../../../state/ringOutput";
import { devCase } from "./index";

/** The Configure page's stage track: the outputs a run with the form's settings would make again. */
const staleNow = async (datasetId: string): Promise<Record<string, string>> => {
  const s = usePipelineStore.getState();
  return (await fetchStaleOutputs({ dataset_id: datasetId, flatten_enabled: s.flatten, params: formToParams(s) })).stale;
};

/** The Run button's run (the Configure page's Run, the Execution page's Run again), Force as given. */
const runButton = async (datasetId: string, force: boolean): Promise<string> => {
  const s = usePipelineStore.getState();
  return s.runStages(enabledStages(s), { datasetId, force });
};

describe("a run from the ring removal with the symmetry average on, on the dev control", () => {
  it("makes a stale average again after the edge trim changed, and reuses a current one", async () => {
    const c = devCase("dev-control");
    const { id } = await c.dataset();
    usePipelineStore.getState().patch({ symmetryAverageEnabled: true, symmetryLaue: "m-3m" });
    expect(await runButton(id, false)).toBe("done");
    expect(await staleNow(id)).toEqual({});

    usePipelineStore.getState().patch({ edgeTrim: "0" });
    expect((await staleNow(id)).symmetrized).toBe("it was made with edge trim 1, now 0");
    const made = await c.tool("run_pipeline", { from_stage: "rings" });
    expect(made.ok, made.summary).toBe(true);
    expect(made.result.stages).toMatchObject({ symmetry_average: "computed", rings: "computed", pdf: "computed" });
    expect(usePipelineStore.getState().lastRun).toMatchObject({ forceFrom: "rings", force: false });
    expect(await staleNow(id)).toEqual({});

    const reused = await c.tool("run_pipeline", { from_stage: "rings" });
    expect(reused.ok, reused.summary).toBe(true);
    expect(reused.result.stages).not.toHaveProperty("symmetry_average");
    expect(reused.result.stages).toMatchObject({ rings: "computed" });
  });
});

describe("a run from the punch with the symmetry average off, on the dev control", () => {
  // A ring setting changed leaves the ring removal's output stale. The run
  // from the punch (the Pilot's rerun_from after a punch change, a Run card)
  // asked for the stages from the punch alone, so the punch read that output
  // as it was. Now it makes it again, with every stage after it, and reuses
  // a current one.
  it("makes stale rings again after a ring setting changed, and reuses current ones", async () => {
    const c = devCase("dev-control");
    const { id } = await c.dataset();
    expect(usePipelineStore.getState().symmetryAverageEnabled).toBe(false);
    expect(await staleNow(id)).toEqual({});

    usePipelineStore.getState().patch({ ringPooledWindow: "8" });
    expect(Object.keys(await staleNow(id))).toContain("ringremoved");
    const made = await c.tool("run_pipeline", { from_stage: "punch" });
    expect(made.ok, made.summary).toBe(true);
    expect(made.result.stages).toMatchObject({ rings: "computed", punch: "computed", pdf: "computed" });
    expect(usePipelineStore.getState().lastRun).toMatchObject({ forceFrom: "punch", force: false });
    expect(await staleNow(id)).toEqual({});

    const reused = await c.tool("run_pipeline", { from_stage: "punch" });
    expect(reused.ok, reused.summary).toBe(true);
    expect(reused.result.stages).not.toHaveProperty("rings");
    expect(reused.result.stages).toMatchObject({ punch: "computed", pdf: "computed" });
  });
});

describe("a ring verdict's mark of the ring output, on the dev control", () => {
  it("goes stale after a run that recomputes the rings, and stands after one that reuses them", async () => {
    const c = devCase("dev-control");
    const { id } = await c.dataset();
    const judged = async (): Promise<RingOutputMark> => {
      const r = await c.tool("assess_stage", { stage: "rings" });
      expect(r.ok, r.summary).toBe(true);
      const mark = r.outcomes.find((o) => o.check === "rings")?.ringOutput;
      expect(mark).toMatchObject({ dataset: id });
      return mark!;
    };
    const before = await judged();
    const written = before.written;
    expect(typeof written).toBe("number");

    expect(await runButton(id, false)).toBe("done");
    expect(ringOutputChanged(before, await fetchDataset(id))).toBe(false);

    expect(await runButton(id, true)).toBe("done");
    expect(ringOutputChanged(before)).toBe(true); // the console's own run says it
    const listing = await fetchDataset(id);
    expect(listing.stages.find((s) => s.name === "ringremoved")?.mtime).not.toBe(written); // and so does the listing
    expect(ringOutputChanged({ ...before, runs: before.runs + 1 }, listing)).toBe(true);
  });
});

describe("declaring a Laue class (the Laue card), on the dev control", () => {
  it("switches the symmetry average on: a run of what is stale makes every stage again, and the symmetry check judges the class", async () => {
    const c = devCase("dev-control");
    const { id } = await c.dataset();
    expect(usePipelineStore.getState().symmetryAverageEnabled).toBe(false);
    expect(await runButton(id, false)).toBe("done");
    const before = await c.tool("symmetry_check", {});
    expect(before.ok, before.summary).toBe(true);
    expect(before.summary).toMatch(/no symmetry declared/);

    // The card's fields (apply/proposals.ts, declareDraft), and auto mode's run from the average: everything stale.
    usePipelineStore.getState().patch({ symmetryAverageEnabled: true, symmetryLaue: "m-3m" });
    // Every output made from the raw volume is stale: the average is not made yet, and the rings now read it.
    expect(Object.keys(await staleNow(id))).toContain("ringremoved");
    const made = await c.tool("run_pipeline", {});
    expect(made.ok, made.summary).toBe(true);
    expect(made.result.stages).toMatchObject({ symmetry_average: "computed", rings: "computed", pdf: "computed" });
    expect(await staleNow(id)).toEqual({});
    const after = await c.tool("symmetry_check", {});
    expect(after.ok, after.summary).toBe(true);
    expect(after.summary).not.toMatch(/no symmetry declared/);
  });
});
