// The Configure page's sections: pipeline order, every setting with one home
// (basic or advanced, for each ring model and punch frame), and the count a
// folded "Advanced" shows of the settings changed from their defaults.

import { describe, expect, it } from "vitest";

import { configOf } from "../../state/configMemory";
import { STAGES, usePipelineStore, type PipelineConfig } from "../../state/pipelineStore";
import { advancedFields, basicFields, changedFields, foldsHolding, SECTION_ORDER, SECTION_SWITCH, type SectionStage } from "../configSections";

const defaults = usePipelineStore.getInitialState() as PipelineConfig;
const MODELS = ["pooled", "global_v2", "patched", "parametric"];
const FRAMES = ["spherical", "q"];

// Not a stage's setting: the run's Force, and the preview's cuts (UI only).
const ELSEWHERE = new Set(["force", "punchCutH", "punchCutK", "punchCutL"]);

describe("the sections", () => {
  it("run in the pipeline's order", () => {
    expect(SECTION_ORDER).toEqual(STAGES.filter((s) => s !== "pdf_check"));
  });

  it("each have their stage's switch", () => {
    for (const stage of SECTION_ORDER) expect(typeof defaults[SECTION_SWITCH[stage]]).toBe("boolean");
  });

  it("name only settings the form has", () => {
    const known = new Set(Object.keys(configOf(defaults)));
    for (const ringModel of MODELS)
      for (const punchFrame of FRAMES)
        for (const stage of SECTION_ORDER)
          for (const k of [...basicFields(stage, { ringModel, punchFrame }), ...advancedFields(stage, { ringModel, punchFrame })])
            expect(known.has(k), `${stage}: ${k}`).toBe(true);
  });

  it("give every setting of the form one home", () => {
    const home = new Map<string, SectionStage[]>();
    for (const ringModel of MODELS)
      for (const punchFrame of FRAMES)
        for (const stage of SECTION_ORDER) {
          const s = { ringModel, punchFrame };
          const here = [SECTION_SWITCH[stage], ...basicFields(stage, s), ...advancedFields(stage, s)];
          for (const k of here) home.set(k, [...new Set([...(home.get(k) ?? []), stage])]);
        }
    const settings = Object.keys(configOf(defaults)).filter((k) => !ELSEWHERE.has(k));
    expect(settings.filter((k) => !home.has(k))).toEqual([]);
    expect([...home].filter(([, stages]) => stages.length > 1)).toEqual([]);
  });

  it("show a setting either up front or under Advanced, never both", () => {
    for (const ringModel of MODELS)
      for (const punchFrame of FRAMES)
        for (const stage of SECTION_ORDER) {
          const basic = new Set<string>(basicFields(stage, { ringModel, punchFrame }));
          expect(advancedFields(stage, { ringModel, punchFrame }).filter((k) => basic.has(k))).toEqual([]);
        }
  });
});

describe("the advanced settings", () => {
  it("follow the ring model", () => {
    const of = (ringModel: string) => advancedFields("rings", { ringModel, punchFrame: "spherical" });
    expect(of("pooled")).toEqual(["ringSliceAxis", "ringPooledSectors", "ringPooledWindow"]);
    expect(of("patched")).toEqual(["ringSliceAxis", "ringNPatches", "ringNFourier"]);
    expect(of("parametric")).toEqual(["ringSliceAxis", "ringWidth", "ringNFourier"]);
    expect(of("global_v2")).toEqual(["ringGlobalConfidence", "ringGlobalLmax", "ringGlobalMinSnr", "ringWidth"]);
  });

  it("are none for the backfill, which has one setting", () => {
    expect(advancedFields("backfill", defaults)).toEqual([]);
  });

  it("count those changed from their defaults, and only those", () => {
    const keys = advancedFields("punch", defaults);
    expect(changedFields(defaults, defaults, keys)).toEqual([]);
    const s = { ...defaults, punchHGuard: "0", punchFitUnconstrained: true, punchMinSig: "7" };
    expect(changedFields(s, defaults, keys)).toEqual(["punchHGuard", "punchFitUnconstrained"]);
    // a setting set back to its default no longer counts
    expect(changedFields({ ...s, punchHGuard: "" }, defaults, keys)).toEqual(["punchFitUnconstrained"]);
    expect(changedFields({ ...defaults, pdfWindowSupport: false }, defaults, advancedFields("pdf", defaults))).toEqual(["pdfWindowSupport"]);
  });
});

describe("the folds an agent's change opens", () => {
  it("are those holding a changed setting, for the current ring model", () => {
    expect(foldsHolding(["punchHGuard", "punchMinSig"], defaults)).toEqual(["punch"]);
    expect(foldsHolding(["pdfWindowSupport", "flattenFitQMax"], defaults)).toEqual(["flatten", "pdf"]);
    // ringNFourier is advanced for the patched model; the pooled one does not use it.
    expect(foldsHolding(["ringNFourier"], { ...defaults, ringModel: "patched" })).toEqual(["rings"]);
    expect(foldsHolding(["ringNFourier"], defaults)).toEqual([]);
  });

  it("are none for settings shown up front", () => {
    expect(foldsHolding(["punchMinSig", "backfillMethod", "pdfApod", "ringModel"], defaults)).toEqual([]);
  });
});
