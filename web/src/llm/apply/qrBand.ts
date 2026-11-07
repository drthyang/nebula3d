// "Use in pipeline" on the Q–R page (THY-68): the |Q| band applied there
// becomes Configure's ΔPDF |Q| band (pdfQMin, pdfQMax), so a run from the
// ΔPDF makes the one ΔPDF every page reads with that band. The Q–R page's
// Apply recomputes its own round trip only, and Save writes a file of its
// own; neither changes the pipeline's ΔPDF.
//
// The |Q| band is the user's alone to set (proposals.ts, heldFor): here their
// own click on the page sets it, as an edit on Configure would, so it needs a
// trusted click (llm/consent.ts) and no grant. It goes through the form's
// settings as any edit does (the stage track then marks the ΔPDF stale), and
// is logged in the Apply cards' record (decisions.ts) as theirs ("you
// (click)"), so the Changes list and the report list it and Undo puts it
// back. Like an edit on Configure, the model is told nothing of it: the
// decision is marked `page`, and the "since the last reply" line leaves it
// out (since.ts). Its proposal has no reply (turn QR_TURN), so no card shows
// under an answer.
//
// The |R| band does not carry over: it masks the ΔPDF after the transform,
// a step the pipeline does not have. Save keeps both bands in its own file.

import { pdfQBandPatch } from "../../state/pdfBand";
import { useNavStore } from "../../state/navStore";
import { runFrom, usePipelineStore, type PipelineConfig } from "../../state/pipelineStore";
import { autoBusy } from "../auto/store";
import { isTrustedClick, type ClickEvent } from "../consent";
import { addProposals, logDecision, nextProposalNumber, useDecisionStore, type Decision } from "./decisions";

/** A band the Q–R page applied, in Å⁻¹ (null: the full span). */
export interface QBand {
  min: number;
  max: number;
}

type BandFields = Pick<PipelineConfig, "pdfQMin" | "pdfQMax">;

/** The turn a page's proposal is filed under: no reply's, so no card shows in the chat. */
export const QR_TURN = -1;

/** What the Changes list and the report call the change. */
export const QR_BAND_TITLE = "ΔPDF |Q| band";

/** Configure's band fields for the band the page applied (null: full), on the page's |Q| span. */
export function bandFields(band: QBand | null, spanMax: number): BandFields {
  return band ? pdfQBandPatch(band.min, band.max, spanMax) : { pdfQMin: "", pdfQMax: "" };
}

/** The band as the cards' lines show it: "full", or "1.00–5.00 Å⁻¹". */
export const bandText = (f: BandFields): string => (f.pdfQMax ? `${f.pdfQMin || "0"}–${f.pdfQMax} Å⁻¹` : "full");

const current = (): BandFields => {
  const s = usePipelineStore.getState();
  return { pdfQMin: s.pdfQMin, pdfQMax: s.pdfQMax };
};

const same = (a: BandFields, b: BandFields): boolean => a.pdfQMin === b.pdfQMin && a.pdfQMax === b.pdfQMax;

/** Whether Configure's band already reads as `band`. */
export const pipelineHas = (band: QBand | null, spanMax: number): boolean => same(current(), bandFields(band, spanMax));

/** Why "Use in pipeline" cannot set `band` now, or null when it can. */
export function pipelineBandWhy(band: QBand | null, spanMax: number): string | null {
  const f = bandFields(band, spanMax);
  if (f.pdfQMax && Number(f.pdfQMin || 0) >= Number(f.pdfQMax)) return "The band is empty: widen it first.";
  if (usePipelineStore.getState().running) return "Wait for the run to end.";
  if (autoBusy()) return "Wait for the auto run to pause.";
  if (same(current(), f)) return "Configure already uses this |Q| band.";
  return null;
}

export type PipelineBandResult = { ok: true; decision: Decision } | { ok: false; why: string };

/**
 * Set Configure's ΔPDF |Q| band to the band the page applied, on the user's
 * own click (`event`, the DOM's), and log it as theirs.
 */
export function setPipelineBand(band: QBand | null, spanMax: number, datasetId: string, event: ClickEvent): PipelineBandResult {
  if (!isTrustedClick(event)) return { ok: false, why: "Not set: only your own click sets the |Q| band." };
  const why = pipelineBandWhy(band, spanMax);
  if (why) return { ok: false, why };
  const before = current();
  const fields = bandFields(band, spanMax);
  const keys = (Object.keys(fields) as (keyof BandFields)[]).filter((k) => before[k] !== fields[k]);
  const b = Object.fromEntries(keys.map((k) => [k, before[k]])) as Partial<PipelineConfig>;
  const a = Object.fromEntries(keys.map((k) => [k, fields[k]])) as Partial<PipelineConfig>;
  usePipelineStore.getState().patch(fields);
  const shown = { from: bandText(before), to: bandText(fields) };
  const id = `P${nextProposalNumber()}`;
  addProposals([
    {
      id,
      turn: QR_TURN,
      kind: "fact",
      title: QR_BAND_TITLE,
      change: fields.pdfQMax ? { pdfQMin: Number(fields.pdfQMin || 0), pdfQMax: Number(fields.pdfQMax) } : { pdfQMin: 0, pdfQMax: "full" },
      fields,
      from: before,
      shown,
      source: { via: "qr" },
      evidence: [],
      dataset: datasetId,
      status: "applied",
      held: "user-only",
    },
  ]);
  const decision = logDecision({
    proposal: id,
    kind: "fact",
    title: QR_BAND_TITLE,
    shown,
    action: "apply",
    by: "you",
    at: Date.now(),
    before: b,
    after: a,
    byClick: true,
    page: "qr",
  });
  return { ok: true, decision };
}

/**
 * The page's band change standing on `datasetId`: the newest one not undone,
 * while Configure still holds the band it set (a later edit there, or another
 * change, ends it).
 */
export function standingBand(datasetId: string | undefined): Decision | null {
  if (!datasetId) return null;
  const { proposals, decisions } = useDecisionStore.getState();
  const mine = new Set(proposals.filter((p) => p.dataset === datasetId && p.source.via === "qr").map((p) => p.id));
  const d = [...decisions].reverse().find((x) => x.page === "qr" && mine.has(x.proposal) && x.action === "apply");
  if (!d || d.undoneBy) return null;
  const s = usePipelineStore.getState();
  return Object.entries(d.after).every(([k, v]) => s[k as keyof PipelineConfig] === v) ? d : null;
}

/** Why "Run from ΔPDF" cannot run now, or null when it can. */
export function runPdfWhy(): string | null {
  const s = usePipelineStore.getState();
  if (s.running) return "A run is going.";
  if (autoBusy()) return "Wait for the auto run to pause.";
  if (!s.pdfEnabled) return "The 3D-ΔPDF stage is off on Configure.";
  return null;
}

/**
 * Run the pipeline from the ΔPDF, as a Run card does (runFrom: the ΔPDF and
 * every stage after it made again, the stages before it reused while they
 * still follow), on the Execution page. Resolves with how the run ended.
 */
export async function runFromPdf(datasetId: string): Promise<string> {
  const why = runPdfWhy();
  if (why) throw new Error(why);
  const pipe = usePipelineStore.getState();
  const { stages, force, forceFrom } = runFrom(pipe, "pdf");
  useNavStore.getState().setTab("execution");
  return pipe.runStages(stages, { datasetId, force, ...(forceFrom ? { forceFrom } : {}) });
}
