// regrid_refined_ub through the dev-data bridge, on the dev case with a turned
// UB (dev-ub): the console's Pages path, the tool's call reaching
// nebula3d.webbridge.dataset_regrid_json in CPython, in the bridge's own
// workspace (never data/). The user asks for the regrid, the agent loop hands
// that message to the tool, and the regridded volume is written as a new
// dataset beside the raw one; ub_check on the new dataset reads no turn, a
// second request names the dataset the first one made (nothing overwritten),
// and a regrid of the new dataset is refused: its UB is no longer turned.
// docs/regrid.md.

import { describe, expect, it } from "vitest";

import { fetchDataset, fetchDatasets } from "../../../api/client";
import { CHAT_TOOLS, type ToolContext } from "../../tools";
import { contractDisagreements } from "../../tools/contracts";
import { regridRefusal } from "../../tune/catalog";
import { UB_TURNED } from "../../verdicts/rules";
import { devCase } from "./index";

const ASK = "The UB is turned: regrid the volume onto the refined UB.";
const tool = (name: string) => CHAT_TOOLS.find((t) => t.name === name)!;

/** A tool run as the app runs it, on `ctx`, its result as JSON reads it. */
const runOn = async (name: string, ctx: ToolContext): Promise<Record<string, unknown>> =>
  JSON.parse(JSON.stringify((await tool(name).run({}, ctx, {})).result)) as Record<string, unknown>;

describe("regrid_refined_ub on dev-ub, through the dev-data bridge", () => {
  it("is refused when the user's latest message does not ask for it, and nothing is written", async () => {
    const c = devCase("dev-ub");
    await c.dataset(); // the case's fresh workspace
    const before = (await fetchDatasets()).map((d) => d.id);
    const r = await c.replay("Is the UB right?", [{ calls: [{ name: "regrid_refined_ub" }] }, { text: "I did not regrid." }]);
    const step = r.steps.find((s) => s.name === "regrid_refined_ub")!;
    expect(step.status).toBe("error");
    expect(step.result).toBe(`Error: ${regridRefusal()}`);
    expect((await fetchDatasets()).map((d) => d.id)).toEqual(before);
  });

  it("writes the regridded volume as a new dataset when asked, and ub_check on it reads no turn", async () => {
    const c = devCase("dev-ub");
    const original = await c.dataset();
    const r = await c.replay(ASK, [
      { calls: [{ name: "ub_check" }] },
      { calls: [{ name: "regrid_refined_ub" }] },
      { text: "The regridded volume is {{regrid_refined_ub.file}}, a new dataset." },
    ]);
    const [check] = r.results("ub_check");
    const [out] = r.results("regrid_refined_ub");
    const turn = check.orientation_change_deg as number;
    console.log(
      `dev-ub at n=${c.n}: ub_check turned ${turn}° (fit ${String(check.fit)}); the regrid ${out.written ? `wrote ${String(out.file)}` : `refused: ${JSON.stringify(out.refusal)}`}, ` +
        `turn ${String(out.turn_deg)}°, RMS ${String(out.rms_start)} → ${String(out.rms)} Å⁻¹, ${String(out.voxels_outside)} measured voxels outside (${String(out.voxels_outside_share)})`,
    );
    expect(UB_TURNED(check)).toBe(true);
    expect(out).toMatchObject({ written: true, refusal: null, source_file: original.raw_name, refined_on: original.raw_name, symmetrised: false });
    // The fit is ub_check's: the turn it acted on is the one ub_check reported.
    expect(Math.abs((out.turn_deg as number) - turn)).toBeLessThan(0.001);
    expect(out.rms as number).toBeLessThan(out.rms_start as number);
    expect(out.file).toBe(`${original.stem}_regridded.nxs`);
    expect(r.note).toBeUndefined();

    // A new dataset of its own, beside the original, which stays selected and as it was.
    const id = out.dataset_id as string;
    expect(id).not.toBe(original.id);
    expect((await fetchDatasets()).map((d) => d.id)).toEqual(expect.arrayContaining([original.id, id]));
    const regridded = await fetchDataset(id);
    expect(regridded.raw_name).toBe(out.file);
    expect(regridded.stages.filter((s) => s.exists).map((s) => s.name)).toEqual(["raw"]);
    expect((await c.dataset()).id).toBe(original.id);

    // ub_check on the new dataset reads no turn.
    const after = await runOn("ub_check", { dataset: regridded, datasets: [original, regridded] });
    console.log(`dev-ub regridded: ub_check turned ${String(after.orientation_change_deg)}°, RMS ${String(after.rms_start)} → ${String(after.rms)} Å⁻¹`);
    expect(UB_TURNED(after)).toBe(false);
    expect(after.orientation_change_deg as number).toBeLessThan(0.05);

    // Asked again: the backend refuses an existing target and names it; nothing is overwritten.
    const again = await runOn("regrid_refined_ub", { dataset: original, datasets: [original, regridded], userMessage: ASK });
    expect(again).toMatchObject({ written: false, dataset_id: id, file: out.file });
    expect((again.refusal as { code: string }).code).toBe("target_exists");

    // The new dataset's own UB is right: a regrid of it is refused, nothing written.
    const twice = await runOn("regrid_refined_ub", { dataset: regridded, datasets: [original, regridded], userMessage: ASK });
    expect(twice).toMatchObject({ written: false, dataset_id: null, file: null });
    expect((twice.refusal as { code: string }).code).toBe("turn_below_noise");
    expect(twice.turn_deg as number).toBeLessThan(twice.turn_threshold_deg as number);
    // Each live result keeps the tool's contract: written, refused before the fit, refused after it.
    for (const result of [out, again, twice]) expect(contractDisagreements("regrid_refined_ub", result)).toEqual([]);
    expect((await fetchDatasets()).map((d) => d.id).filter((d) => d.startsWith(`${id}_`))).toEqual([]);
  });
});
