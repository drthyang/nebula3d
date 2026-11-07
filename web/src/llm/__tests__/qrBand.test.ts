// "Use in pipeline" on the Q–R page (THY-68, llm/apply/qrBand.ts): the |Q|
// band applied there becomes Configure's ΔPDF |Q| band on the user's own
// click, through the form's settings (the ΔPDF's run settings change, so the
// stage track marks it stale), logged as theirs in the Changes list, undone
// on their click, and never told to the model. The row says the |R| band
// stays on the page. Synthetic only.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";

import { QBandPipeline } from "../../components/QBandPipeline";
import { formToParams, usePipelineStore } from "../../state/pipelineStore";
import { byText, decisionLine, reportDecisions, undoable, undoDecision } from "../apply/actions";
import { clearDecisions, readDecisions, untoldDecisions, useDecisionStore } from "../apply/decisions";
import { bandFields, pipelineBandWhy, QR_TURN, runPdfWhy, setPipelineBand, standingBand } from "../apply/qrBand";
import { sinceLine } from "../apply/since";

const TRUSTED = { isTrusted: true }; // the browser's own click, as a handler's nativeEvent has it
const SPAN = 9; // the page's |Q| span, Å⁻¹ (ceil of the data's |Q| max)
const store = () => usePipelineStore.getState();
const state = () => useDecisionStore.getState();

beforeEach(() => {
  usePipelineStore.setState({ ...usePipelineStore.getInitialState(), running: false, lastRun: null });
  clearDecisions();
});

describe("Use in pipeline", () => {
  it("sets Configure's |Q| band to the band applied, so the ΔPDF's run settings change (stale)", () => {
    const before = formToParams(store());
    expect(before.pdf_q_min).toBeUndefined();
    const r = setPipelineBand({ min: 1, max: 5 }, SPAN, "demo", TRUSTED);
    expect(r.ok).toBe(true);
    expect(store()).toMatchObject({ pdfQMin: "1.00", pdfQMax: "5.00" });
    // What the run, and the stage track's question, send for the ΔPDF.
    expect(formToParams(store())).toMatchObject({ pdf_q_min: 1, pdf_q_max: 5 });
    if (!r.ok) return;
    expect(r.decision).toMatchObject({
      kind: "fact",
      action: "apply",
      by: "you",
      byClick: true,
      page: "qr",
      before: { pdfQMin: "", pdfQMax: "" },
      after: { pdfQMin: "1.00", pdfQMax: "5.00" },
      shown: { from: "full", to: "1.00–5.00 Å⁻¹" },
    });
    const p = state().proposals.find((x) => x.id === r.decision.proposal)!;
    expect(p).toMatchObject({ turn: QR_TURN, status: "applied", dataset: "demo", source: { via: "qr" } });
    expect(standingBand("demo")?.id).toBe(r.decision.id);
    expect(standingBand("other")).toBeNull();
  });

  it("is listed as the user's in the Changes list and the report, with Undo", () => {
    const r = setPipelineBand({ min: 1, max: 5 }, SPAN, "demo", TRUSTED);
    if (!r.ok) throw new Error(r.why);
    expect(byText(r.decision)).toBe("you (click)");
    expect(undoable(r.decision)).toBe(true);
    expect(decisionLine(r.decision)).toBe("Applied ΔPDF |Q| band full → 1.00–5.00 Å⁻¹");
    expect(reportDecisions("demo").map((d) => d.decision)).toEqual(["Applied ΔPDF |Q| band full → 1.00–5.00 Å⁻¹"]);
  });

  it("only on the user's own click", () => {
    expect(setPipelineBand({ min: 1, max: 5 }, SPAN, "demo", { isTrusted: false })).toEqual({ ok: false, why: "Not set: only your own click sets the |Q| band." });
    expect(setPipelineBand({ min: 1, max: 5 }, SPAN, "demo", undefined).ok).toBe(false);
    expect(store().pdfQMax).toBe("");
    expect(state().decisions).toEqual([]);
  });

  it("refuses an empty band, a band already set, and while a run goes", () => {
    expect(pipelineBandWhy({ min: 3, max: 3 }, SPAN)).toBe("The band is empty: widen it first.");
    store().patch({ pdfQMin: "1.00", pdfQMax: "5.00" });
    expect(pipelineBandWhy({ min: 1, max: 5 }, SPAN)).toBe("Configure already uses this |Q| band.");
    usePipelineStore.setState({ running: true });
    expect(pipelineBandWhy({ min: 2, max: 5 }, SPAN)).toBe("Wait for the run to end.");
    expect(runPdfWhy()).toBe("A run is going.");
  });

  it("reads a band over the page's whole span as full, and a full band clears Configure's", () => {
    expect(bandFields({ min: 0, max: SPAN }, SPAN)).toEqual({ pdfQMin: "", pdfQMax: "" });
    expect(bandFields({ min: 0.5, max: SPAN }, SPAN)).toEqual({ pdfQMin: "0.50", pdfQMax: "9.00" });
    store().patch({ pdfQMin: "1.00", pdfQMax: "5.00" });
    const r = setPipelineBand(null, SPAN, "demo", TRUSTED);
    expect(r.ok).toBe(true);
    expect(store()).toMatchObject({ pdfQMin: "", pdfQMax: "" });
  });

  it("Undo puts the band before back, on the user's click", () => {
    store().patch({ pdfQMin: "0.50", pdfQMax: "7.00" });
    const r = setPipelineBand({ min: 1, max: 5 }, SPAN, "demo", TRUSTED);
    if (!r.ok) throw new Error(r.why);
    expect(undoDecision(r.decision, { isTrusted: false })).toBe(false);
    expect(store().pdfQMax).toBe("5.00");
    expect(undoDecision(state().decisions.find((d) => d.id === r.decision.id)!, TRUSTED)).toBe(true);
    expect(store()).toMatchObject({ pdfQMin: "0.50", pdfQMax: "7.00" });
    const undo = state().decisions.find((d) => d.undoes === r.decision.id)!;
    expect(undo).toMatchObject({ action: "undo", page: "qr", byClick: true });
    expect(standingBand("demo")).toBeNull();
  });

  it("ends when Configure's band is changed since", () => {
    const r = setPipelineBand({ min: 1, max: 5 }, SPAN, "demo", TRUSTED);
    if (!r.ok) throw new Error(r.why);
    store().patch({ pdfQMax: "6.00" });
    expect(standingBand("demo")).toBeNull();
    expect(undoDecision(r.decision, TRUSTED)).toBe(false);
    expect(state().notes[r.decision.id]).toBe("Changed since: undo on Configure.");
  });

  it("is never told to the model: the since line leaves it and its Undo out", () => {
    const r = setPipelineBand({ min: 1, max: 5 }, SPAN, "demo", TRUSTED);
    if (!r.ok) throw new Error(r.why);
    undoDecision(r.decision, TRUSTED);
    const untold = untoldDecisions();
    expect(untold.decisions).toHaveLength(2);
    expect(sinceLine(untold.decisions, state().proposals)).toBeNull();
    expect(sinceLine(state().decisions, state().proposals, "on the Apply cards")).toBeNull();
  });

  it("keeps its mark in a session file", () => {
    setPipelineBand({ min: 1, max: 5 }, SPAN, "demo", TRUSTED);
    const back = readDecisions(JSON.parse(JSON.stringify({ proposals: state().proposals, decisions: state().decisions })));
    expect(back.decisions[0].page).toBe("qr");
    expect(back.proposals[0].source.via).toBe("qr");
  });
});

describe("the Q–R page's pipeline row", () => {
  const render = (props: Partial<Parameters<typeof QBandPipeline>[0]>) =>
    renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(QBandPipeline, { datasetId: "demo", band: null, rBand: null, spanMax: SPAN, computing: false, ...props }),
      ),
    );

  it("offers Use in pipeline for an applied |Q| band, and says nothing of the |R| band without one", () => {
    const html = render({ band: { min: 1, max: 5 } });
    expect(html).toContain("Pipeline ΔPDF: |Q| full");
    expect(html).toContain("Use 1.00–5.00 Å⁻¹ in pipeline");
    expect(html).not.toContain("|R| band stays");
  });

  it("says the |R| band stays on the page when one is applied", () => {
    const html = render({ band: { min: 1, max: 5 }, rBand: { min: 0, max: 20 } });
    expect(html).toContain("The |R| band stays on this page.");
    expect(html).toContain("a step the pipeline does not have");
    expect(render({ rBand: { min: 0, max: 20 } })).toContain("The |R| band stays on this page.");
  });

  it("after Use in pipeline: Undo in place of Use", () => {
    setPipelineBand({ min: 1, max: 5 }, SPAN, "demo", TRUSTED);
    // (A server render reads the stores' initial state, so the band's text is checked above, by standingBand.)
    const html = render({ band: { min: 1, max: 5 } });
    expect(html).not.toContain("in pipeline</button>");
    expect(html).toContain(">Undo</button>");
  });

  it("shows nothing with no band applied and none set from the page", () => {
    expect(render({})).toBe("");
  });
});
