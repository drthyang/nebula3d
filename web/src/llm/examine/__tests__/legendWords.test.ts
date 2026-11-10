// The Highlights legend and its help on a ΔPDF view, as the page draws them, for
// both kinds of map (the structure panel's "ΔPDF type"): an atomic map says more
// pairs and fewer pairs, a magnetic map says moments parallel and antiparallel.
// Made-up features; the marks and their counts are the same for both.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { useStructureStore } from "../../../state/structureStore";
import type { AgentStep } from "../../agent";
import { ExamineBar, ViewLegend } from "../../components/ExamineBar";
import { overlaysOf } from "../overlays";
import { shownFor, type ShownSet } from "../store";

// The bar's settings hook has no server snapshot; a server render reads the settings as they load.
vi.mock("../../settings", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../settings")>();
  return { ...real, useLlmSettings: () => real.loadSettings() };
});

const result = {
  grouped_by: "point group",
  features: [
    { length_A: 2.76, size_sigma: 1520, n_vectors: 2, vectors_A: [[2.76, 0, 0], [0, 2.76, 0]] },
    { length_A: 3.9, size_sigma: -40, n_vectors: 1, vectors_A: [[3.9, 0, 0]] },
  ],
  threshold_sigma: 5,
  extrema_above_threshold: 31,
};
const step: AgentStep = { id: "0:c1", name: "dpdf_peaks", args: {}, status: "done", result: JSON.stringify(result) };
const stored: ShownSet = { set: overlaysOf(step)!, dataset: "demo", versions: {}, turn: 0, n: 1 };
const counts = { dpos: 4, dneg: 2 };

/** The bar and a large view's legend, tags dropped: the words a reader sees (and the chips' tooltips). */
const page = (shown: ShownSet) => {
  const html =
    renderToStaticMarkup(createElement(ExamineBar, { shown, counts, stages: ["delta_pdf"] })) +
    renderToStaticMarkup(createElement(ViewLegend, { shown, stage: "delta_pdf", counts }));
  return { html, text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") };
};

describe("the ΔPDF marks' legend, by the map's kind", () => {
  it("the ΔPDF type is atomic unless the user says otherwise", () => {
    expect(useStructureStore.getState().mapKind).toBe("atomic");
  });

  it("atomic: more pairs, fewer pairs, and the stored set itself", () => {
    const shown = shownFor(stored, "atomic");
    expect(shown).toBe(stored);
    const { html, text } = page(shown);
    expect(text).toContain("+ more pairs 4");
    expect(text).toContain("− fewer pairs 2");
    expect(html).toContain('title="Hide + more pairs"');
    expect(html).toContain('title="Hide − fewer pairs"');
    expect(text).toContain("(the ΔPDF is centrosymmetric): red + more pairs than the average structure, blue − fewer; the ring grows with |σ|.");
    expect(text).not.toMatch(/parallel|moments|mΔPDF/);
  });

  it("magnetic: parallel, antiparallel, with the same counts, title and summary", () => {
    const shown = shownFor(stored, "magnetic");
    expect(shown).not.toBe(stored);
    expect({ ...shown, set: stored.set }).toEqual(stored);
    const { html, text } = page(shown);
    expect(text).toContain("+ parallel 4");
    expect(text).toContain("− antiparallel 2");
    expect(html).toContain('title="Hide + parallel"');
    expect(html).toContain('title="Hide − antiparallel"');
    expect(text).toContain("(the mΔPDF is centrosymmetric): red + moments at that separation parallel, blue − antiparallel; the ring grows with |σ|.");
    expect(text).not.toMatch(/more pairs|fewer/);
    expect(text).toContain("ΔPDF features");
    expect(text).toContain(stored.set.where);
  });

  it("the two legends differ in those words only", () => {
    const words = (s: string) =>
      s
        .replace("the mΔPDF is", "the ΔPDF is")
        .replace("red + moments at that separation parallel, blue − antiparallel;", "red + more pairs than the average structure, blue − fewer;")
        .replace(/\+ parallel/g, "+ more pairs")
        .replace(/− antiparallel/g, "− fewer pairs");
    expect(words(page(shownFor(stored, "magnetic")).html)).toBe(page(stored).html);
  });
});
