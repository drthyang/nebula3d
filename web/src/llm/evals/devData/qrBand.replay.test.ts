// THY-68 through the dev-data bridge: the Q–R page's "Use in pipeline" sets
// Configure's ΔPDF |Q| band, the Configure page's stage track then lists the
// ΔPDF stale (the run's settings no longer match its record), and "Run from
// ΔPDF" makes the one ΔPDF every page reads with that band: its record (the
// Q–R page's settings line reads it) and the 3D-ΔPDF page's |Q| max say so,
// and nothing is stale after. Undo puts the band back, and the ΔPDF is stale
// again. Synthetic dev control only.

import { describe, expect, it } from "vitest";

import { fetchConsistencyMeta, fetchDataset, fetchDpdfMeta, fetchStaleOutputs } from "../../../api/client";
import { stageVolumeId } from "../../context/loadContext";
import { formToParams, usePipelineStore } from "../../../state/pipelineStore";
import { undoDecision } from "../../apply/actions";
import { runFromPdf, setPipelineBand, standingBand } from "../../apply/qrBand";
import { devCase } from "./index";

const TRUSTED = { isTrusted: true };

/** The Configure page's stage track: the outputs a run with the form's settings would make again. */
const staleNow = async (datasetId: string): Promise<Record<string, string>> => {
  const s = usePipelineStore.getState();
  return (await fetchStaleOutputs({ dataset_id: datasetId, flatten_enabled: s.flatten, params: formToParams(s) })).stale;
};

describe("Use in pipeline, then Run from ΔPDF, on the dev control", () => {
  it("makes the pipeline's ΔPDF with the Q–R page's |Q| band, and Undo leaves it stale again", async () => {
    const c = devCase("dev-control");
    const { id } = await c.dataset();
    expect(await staleNow(id)).toEqual({});
    const pdfId = stageVolumeId(await fetchDataset(id), "delta_pdf");
    expect(pdfId).toBeTruthy();
    const fullQMax = (await fetchDpdfMeta(pdfId!)).q_max;

    // The page's round trip with a band, as Apply asks for it: its span and the band to use.
    const span = Math.ceil((await fetchConsistencyMeta(id)).q_data_max);
    const band = { min: 0.5, max: Math.max(1, Math.floor(span / 2)) };
    expect(band.max).toBeLessThan(fullQMax ?? Infinity);
    const r = setPipelineBand(band, span, id, TRUSTED);
    expect(r.ok, r.ok ? "" : r.why).toBe(true);
    expect(Object.keys(await staleNow(id))).toContain("delta_pdf");

    expect(await runFromPdf(id)).toBe("done");
    expect(usePipelineStore.getState().lastRun).toMatchObject({ forceFrom: "pdf" });
    expect(await staleNow(id)).toEqual({});
    const settings = (await fetchConsistencyMeta(id)).settings;
    expect(settings.run_q_band).toEqual([band.min, band.max]);
    const banded = await fetchDpdfMeta(stageVolumeId(await fetchDataset(id), "delta_pdf")!);
    expect(banded.q_max).toBeLessThanOrEqual(band.max);

    expect(r.ok && undoDecision(standingBand(id)!, TRUSTED)).toBe(true);
    expect(usePipelineStore.getState()).toMatchObject({ pdfQMin: "", pdfQMax: "" });
    expect(Object.keys(await staleNow(id))).toContain("delta_pdf");
  });
});
