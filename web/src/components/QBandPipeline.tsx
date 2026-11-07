// The Q–R page's row for the pipeline's ΔPDF (THY-68): the |Q| band the
// pipeline's ΔPDF is made with, "Use in pipeline" to make it the band applied
// here (llm/apply/qrBand.ts), then "Run from ΔPDF" while that ΔPDF is stale,
// and Undo. One plain line; the details behind "?". The |R| band, a mask
// after the transform the pipeline has no step for, stays on this page, and
// the line says so while one is applied.

import { useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { fetchStaleOutputs } from "../api/client";
import { useBootStatus } from "../api/hooks";
import { PYODIDE_MODE } from "../api/pyodideEngine";
import type { StageParamsIn } from "../api/types";
import { undoDecision } from "../llm/apply/actions";
import { useDecisionStore } from "../llm/apply/decisions";
import { bandFields, bandText, pipelineBandWhy, pipelineHas, runFromPdf, runPdfWhy, setPipelineBand, standingBand, type QBand } from "../llm/apply/qrBand";
import { useAutoStore } from "../llm/auto/store";
import { formToParams, usePipelineStore } from "../state/pipelineStore";
import { HelpTip } from "./ui";

const USE_HELP =
  "Apply and Save change this page only: the 3D-ΔPDF page and the Pilot read the pipeline's ΔPDF. " +
  "Use in pipeline sets Configure's ΔPDF |Q| band to the band applied here; Run from ΔPDF then makes that ΔPDF again with it. " +
  "Undo, here or in the Pilot's Changes list, puts the band before back.";

const R_HELP =
  "The |R| band masks the ΔPDF after the transform, a step the pipeline does not have, so only the |Q| band goes to Configure. " +
  "Save ΔPDF keeps both bands, in a file of its own.";

export function QBandPipeline({
  datasetId,
  band,
  rBand,
  spanMax,
  computing,
}: {
  datasetId: string | undefined;
  band: QBand | null; // the |Q| band applied on the page (null: full)
  rBand: QBand | null; // the |R| band applied on the page (null: full)
  spanMax: number; // the page's |Q| span, Å⁻¹
  computing: boolean;
}) {
  const boot = useBootStatus();
  const pdfQMin = usePipelineStore((s) => s.pdfQMin);
  const pdfQMax = usePipelineStore((s) => s.pdfQMax);
  const running = usePipelineStore((s) => s.running);
  usePipelineStore((s) => s.pdfEnabled);
  useAutoStore((s) => s.run?.state);
  const params = usePipelineStore((s) => JSON.stringify(formToParams(s)));
  const flatten = usePipelineStore((s) => s.flatten);
  // The record, to follow the standing change and its line (Undo's, here or in the Changes list).
  useDecisionStore((s) => s.decisions);
  const standing = standingBand(datasetId);
  const note = useDecisionStore((s) => (standing ? s.notes[standing.id] : undefined));
  const [why, setWhy] = useState<string | null>(null);

  // Whether the pipeline's ΔPDF is stale with the settings as they are (the
  // band set, or put back): the Configure page's stage track's question (the
  // backend's resume rule).
  const staleQ = useQuery({
    queryKey: ["stale-outputs-qr", datasetId, params, flatten],
    queryFn: () => fetchStaleOutputs({ dataset_id: datasetId ?? "", flatten_enabled: flatten, params: JSON.parse(params) as StageParamsIn }),
    enabled: Boolean(datasetId && (band || rBand || standing)) && !running && (!PYODIDE_MODE || boot.ready),
    staleTime: Infinity,
    retry: false,
  });

  if (!datasetId || (!band && !rBand && !standing)) return null;

  const pipeline = bandText({ pdfQMin, pdfQMax });
  const applied = bandText(bandFields(band, spanMax));
  const canUse = band ? pipelineBandWhy(band, spanMax) : "No |Q| band applied here.";
  const inPipeline = band !== null && pipelineHas(band, spanMax);
  const staleWhy = staleQ.data?.stale.delta_pdf;
  const pdfStale = staleQ.data ? staleWhy !== undefined : staleQ.isError;
  const runWhy = runPdfWhy();
  // One next step at a time: Use while the band is not the pipeline's, then Run while its ΔPDF is stale.
  const showUse = band !== null && !standing && !inPipeline;

  const onUse = (e: React.MouseEvent) => {
    const r = setPipelineBand(band, spanMax, datasetId, e.nativeEvent);
    setWhy(r.ok ? null : r.why);
  };
  const onRun = () => {
    setWhy(null);
    runFromPdf(datasetId).catch((e: Error) => setWhy(e.message));
  };

  return (
    <div className="ws-row qr-pipe" aria-label="Pipeline ΔPDF">
      <span className="qr-pipe-what">
        Pipeline ΔPDF: |Q| {pipeline}
        {staleQ.data &&
          (pdfStale ? (
            <span className="qr-pipe-stale" title={`Stale: ${staleWhy}`}>
              {" "}
              · stale
            </span>
          ) : (
            <span className="qr-pipe-ok"> · up to date</span>
          ))}
      </span>
      {showUse && (
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={computing || canUse !== null}
          title={canUse ?? `Set Configure's ΔPDF |Q| band to ${applied}`}
          onClick={onUse}
        >
          Use {applied} in pipeline
        </button>
      )}
      {pdfStale && !showUse && (
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={runWhy !== null}
          title={runWhy ?? "Make the pipeline's ΔPDF again with Configure's settings (and any stale stage before it)"}
          onClick={onRun}
        >
          {running ? "Running…" : "Run from ΔPDF"}
        </button>
      )}
      {standing && (
        <button type="button" className="btn btn-ghost btn-sm" disabled={running} title={`Put back the |Q| band ${standing.shown.from}`} onClick={(e) => undoDecision(standing, e.nativeEvent)}>
          Undo
        </button>
      )}
      <HelpTip className="helptip--wide">{USE_HELP}</HelpTip>
      {rBand && (
        <span className="qr-pipe-r">
          The |R| band stays on this page. <HelpTip className="helptip--wide">{R_HELP}</HelpTip>
        </span>
      )}
      {(why || note) && <span className="qr-pipe-note">{why ?? note}</span>}
    </div>
  );
}
