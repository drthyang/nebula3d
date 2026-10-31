// The Configure page's stage sections: one per pipeline stage, in the order
// the stages run, each with the same head (number, title, one plain line, a
// "?" for the details, the Enable stage switch), its settings, and the
// settings it folds away under "Advanced". UI only: the settings themselves
// live in the pipeline store, where the agent's tools read and write them.
//
// Every setting of the form has one home here, basic or advanced (the test
// checks it), so a new setting has to be given one.

import type { AdvancedStage } from "../state/configViewStore";
import type { PipelineConfig } from "../state/pipelineStore";

export type SectionStage = "rings" | "punch" | "backfill" | "flatten" | "pdf";

/** The sections in pipeline order. */
export const SECTION_ORDER: readonly SectionStage[] = ["rings", "punch", "backfill", "flatten", "pdf"];

/** Each section's one plain line, under its title. */
export const SECTION_SUMMARY: Record<SectionStage, string> = {
  rings: "Removes powder rings, such as the sample can's",
  punch: "Cuts out the Bragg peaks and the direct beam",
  backfill: "Fills the punched holes from the diffuse around them",
  flatten: "Subtracts the isotropic background",
  pdf: "Transforms the cleaned volume into the 3D-ΔPDF",
};

/** Each section's Enable stage switch. */
export const SECTION_SWITCH: Record<SectionStage, keyof PipelineConfig> = {
  rings: "ringsEnabled",
  punch: "punchEnabled",
  backfill: "backfillEnabled",
  flatten: "flatten",
  pdf: "pdfEnabled",
};

type Key = keyof PipelineConfig;
type ModelOf = Pick<PipelineConfig, "ringModel" | "punchFrame">;

/** The settings a section shows up front, for the current ring model and punch frame. */
export function basicFields(stage: SectionStage, s: ModelOf): Key[] {
  switch (stage) {
    case "rings":
      return s.ringModel === "global_v2"
        ? ["ringModel", "ringGlobalMaterial", "ringGlobalSubtraction"]
        : s.ringModel === "parametric"
          ? ["ringModel", "ringRadialMode"]
          : ["ringModel"];
    case "punch":
      return [
        // detection
        "punchFootprint", "punchMinSig", "punchMode",
        // the sample: its cell and its modulation
        "punchSupercellH", "punchSupercellK", "punchSupercellL",
        "modulationK", "modulationForm", "modulationOrder", "modulationHalfWidth",
        // the Bragg footprint, in its frame, and the direct beam
        "punchFrame",
        ...(s.punchFrame === "q" ? (["punchQA", "punchQB", "punchQC"] as Key[]) : (["punchRho", "punchTheta", "punchPhi"] as Key[])),
        "punchMargin",
        "incidentBeamQA", "incidentBeamQB", "incidentBeamQC", "incidentBeamMargin",
      ];
    case "backfill":
      return ["backfillMethod"];
    case "flatten":
      return ["flattenEstimator", "flattenIon"];
    case "pdf":
      return ["pdfApod", "pdfQMin", "pdfQMax"];
  }
}

/** The settings a section folds away under "Advanced", for the current ring model. */
export function advancedFields(stage: SectionStage, s: ModelOf): Key[] {
  switch (stage) {
    case "rings":
      switch (s.ringModel) {
        case "global_v2":
          return ["ringGlobalConfidence", "ringGlobalLmax", "ringGlobalMinSnr", "ringWidth"];
        case "parametric":
          return ["ringSliceAxis", "ringWidth", "ringNFourier"];
        case "patched":
          return ["ringSliceAxis", "ringNPatches", "ringNFourier"];
        default:
          return ["ringSliceAxis", "ringPooledSectors", "ringPooledWindow"];
      }
    case "punch":
      return ["punchProfileNSigma", "punchHGuard", "punchSearchFloor", "punchSearchMaxWidth", "punchFitUnconstrained", "incidentBeamFitCovariance"];
    case "backfill":
      return [];
    case "flatten":
      return ["flattenFitQMax", "flattenQ2"];
    case "pdf":
      return ["pdfWindowShape", "pdfWindowSupport"];
  }
}

/** The stages whose Advanced fold holds any of `fields`, for the current ring model: the folds to open. */
export function foldsHolding(fields: readonly Key[], s: ModelOf): AdvancedStage[] {
  const changed = new Set<string>(fields);
  return SECTION_ORDER.filter(
    (stage): stage is AdvancedStage => stage !== "backfill" && advancedFields(stage, s).some((k) => changed.has(k)),
  );
}

/**
 * Which of `keys` differ from their defaults: what a folded section's summary
 * counts. `s` holds the page's settings (it must hold every key asked about).
 */
export function changedFields(s: Readonly<Partial<PipelineConfig>>, defaults: PipelineConfig, keys: readonly Key[]): Key[] {
  return keys.filter((k) => s[k] !== defaults[k]);
}
