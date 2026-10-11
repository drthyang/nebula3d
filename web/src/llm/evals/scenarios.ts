// The eval scenarios: questions with known answers from the research rounds
// on a measured hexagonal X-ray volume (doubled 8 × 10 Å cell, symmetrised
// under 6/mmm by the NeXus Viewer), its unsymmetrised export, and the run
// the pipeline made of the symmetrised one with the settings below.

import type { PipelineConfig } from "../../state/pipelineStore";
import { answers, asserts, calls, didNotRun, measured, mentions, neverAsserts, quotes, ran, result } from "./checks";
import type { EvalRun, Scenario } from "./harness";

/** The symmetrised export, its pipeline run (the datasets the app lists). */
export const HEX = "401x401x401-sub-bkg-sym6mmm";
/** The unsymmetrised export the symmetrised one was made from. */
export const HEX_RAW = "401x401x401-sub-bkg";

/** The Configure settings the symmetrised volume was run with (the user's). */
export const HEX_CONFIG: Partial<PipelineConfig> = {
  ringsEnabled: true,
  ringModel: "pooled",
  ringNFourier: "8",
  ringSliceAxis: "H",
  punchEnabled: true,
  punchMinSig: "4",
  punchSupercellH: "2",
  punchSupercellK: "2",
  punchSupercellL: "2",
  punchProtectH: "none",
  punchSearchMaxWidth: "2",
  punchFrame: "spherical",
  backfillEnabled: true,
  flatten: true,
  flattenQ2: true,
  flattenFitQMax: "16",
  pdfEnabled: true,
  pdfQMin: "0.55",
  pdfQMax: "16.70",
  pdfWindowSupport: true,
};

/** The tool calls the CI replay scripts make, per dataset (probe.test.ts records them). */
export const FIXTURE_CALLS: Record<string, { name: string; args: Record<string, unknown> }[]> = {
  [HEX]: [
    { name: "assess_stage", args: { stage: "rings" } },
    { name: "assess_stage", args: { stage: "punch" } },
    { name: "assess_stage", args: { stage: "pdf" } },
    { name: "qmax_coverage", args: {} },
    { name: "symmetry_check", args: {} },
    { name: "grain_check", args: {} },
    { name: "ub_check", args: {} },
  ],
  [HEX_RAW]: [{ name: "ub_check", args: {} }],
};

const stageIs = (...stages: string[]) => (a: Record<string, unknown>) => stages.includes(String(a.stage));
const noActions = [didNotRun("run_pipeline"), didNotRun("tune_pipeline"), didNotRun("update_settings")];

/** The UB check's refined a (Å), read off its cell text ("8.0021, 8.0021, 9.9881 Å; …"). */
const refinedA = (run: EvalRun): number | null => {
  const done = calls(run, "ub_check");
  const step = done[done.length - 1];
  const cell = step ? result(step)?.cell : undefined;
  return typeof cell === "string" ? Number(cell.split(",")[0]) : null;
};

export const SCENARIOS: Scenario[] = [
  {
    id: "rings-left",
    title: "Finds the powder ring the subtraction left",
    origin: "Research round 1: the pooled ring model leaves the Al ring at 10.3 Å⁻¹ on the h0l and 0kl planes; the hk0 bumps are the crystal's own.",
    dataset: HEX,
    config: HEX_CONFIG,
    question: "Is the powder-ring removal clean on this run?",
    checks: [
      answers,
      ran("assess_stage", stageIs("rings", "all"), "for the rings"),
      quotes("the leftover ring's |Q|", measured("assess_stage", "rings.worst_ring_left.at"), 0.3),
      asserts(
        /\bring\w*\b[^.]*\b(left|leftover|remain\w*|residu\w*|surviv\w*|incomplete|persist\w*)\b|\b(left|leftover|remain\w*|residu\w*|surviv\w*)\b[^.]*\bring/i,
        "that a ring is left",
      ),
    ],
  },
  {
    id: "punch-missed",
    title: "Reports the Bragg peaks the punch missed",
    origin: "Research round 2: 16 lattice peaks left at nodes (8 on each of h0l and 0kl) while 360 broad maxima are kept as diffuse.",
    dataset: HEX,
    config: HEX_CONFIG,
    question: "Did the Bragg punch remove every peak it should have?",
    checks: [
      answers,
      ran("assess_stage", stageIs("punch", "all"), "for the punch"),
      quotes("the missed peaks at nodes", measured("assess_stage", "punch.leftover_at_nodes"), 0),
      asserts(
        /\b(missed|left|leftover|remain\w*|unpunched|surviv\w*)\b[^.]*\b(peak|node|bragg|reflection)|\b(peak|node|bragg|reflection)\w*\b[^.]*\b(missed|left|leftover|remain\w*|unpunched|surviv\w*)\b/i,
        "that lattice peaks were missed",
      ),
    ],
  },
  {
    id: "pdf-window-coverage",
    title: "Checks the ΔPDF window against the measured coverage",
    origin: "Research round 3: the ellipsoid window puts 3.2e-6 of its weight on unmeasured space, under the 1e-3 limit.",
    dataset: HEX,
    config: HEX_CONFIG,
    question: "Does the 3D-ΔPDF's transform window stay inside the measured reciprocal space?",
    checks: [
      answers,
      ran("qmax_coverage"),
      quotes(
        "the window's weight on unmeasured space",
        (run) => measured("qmax_coverage", "window_weight_on_unmeasured")(run) ?? measured("assess_stage", "pdf.window_weight_on_unmeasured")(run),
        0.15,
        { relative: true },
      ),
      asserts(/\b(inside|within|clean|stays|confined|safe|well under|below)\b/i, "that it stays inside the coverage"),
    ],
  },
  {
    id: "pdf-separable-refused",
    title: "Advises against a separable window that reaches unmeasured space",
    origin: "Research round 4: the tuner refused the separable window, which put 0.057 of its weight on unmeasured space and broke the six-fold symmetry.",
    dataset: HEX,
    config: HEX_CONFIG,
    question:
      "The ΔPDF's feature SNR might go up with a separable window instead of the ellipsoid one. Should I switch to the separable window?",
    checks: [
      answers,
      ...noActions,
      mentions(
        /\b(keep|stay with|stick with|don't|do not|wouldn't|would not|shouldn't|should not|not recommend|recommend against|advise against|avoid|no need|not necessary|unnecessary|no reason)\b|^no\b/i,
        "to keep the ellipsoid window",
      ),
      asserts(
        /\b(unmeasured|outside|beyond|past)\b[^.]*\b(coverage|measured|data|box|space)|\bcorner\w*|\bsymmetr\w*|\bbackfill\w*|\bguess\w*/i,
        "that a separable window would reach unmeasured space or break the symmetry",
      ),
    ],
  },
  {
    id: "symmetry-kept",
    title: "Confirms the ΔPDF kept the hexagonal symmetry",
    origin: "Research round 5: with the declared 6/mmm operations every stage stays symmetric; the ΔPDF's in-plane operations hold to 3e-6.",
    dataset: HEX,
    config: HEX_CONFIG,
    question: "Did the 3D-ΔPDF keep the cell's hexagonal symmetry?",
    checks: [
      answers,
      ran("symmetry_check"),
      asserts(/\b(kept|keeps|holds?|preserved?|retain\w*|intact|respected|maintained)\b/i, "that the symmetry is kept"),
    ],
  },
  {
    id: "q-band-from-raw",
    title: "Reads the |Q| band off the raw counts",
    origin: "User rule (round 6): the ΔPDF's Qmin and Qmax are where the raw counts begin and end, 0.52 and 16.70 Å⁻¹ here.",
    dataset: HEX,
    config: HEX_CONFIG,
    question: "What |Q| band should the 3D-ΔPDF use so that it only uses the measured data?",
    checks: [
      answers,
      ran("qmax_coverage"),
      quotes("the upper edge", measured("qmax_coverage", "raw_counts.q_max_edge"), 0.15),
      quotes("the lower edge", () => 0.55, 0.07),
    ],
  },
  {
    id: "no-second-grain",
    title: "Tells displaced Bragg peaks from a second grain",
    origin: "Research round 7: no second grain; 35 of the 40 strongest off-lattice orbits sit beside Bragg nodes at a median 0.85°, copies symmetrised from a UB about a degree off.",
    dataset: HEX,
    config: HEX_CONFIG,
    question: "Is there a second grain in this crystal? What are the sharp off-lattice peaks the punch found?",
    checks: [
      answers,
      ran("grain_check"),
      mentions(/\b(no|not)\b[^.]*\b(second|twin|another|extra)\b[^.]*\bgrain|\bsingle grain|\bone grain|\bsingle crystal/i, "that there is no second grain"),
      neverAsserts(/\b(there is|there's|found|reveals?|shows?|indicates?|confirms?|evidence of)\s+(a\s+|another\s+)?(second|twin)\s+grain/i, "a second grain"),
      quotes("the offset angle", measured("grain_check", "near_offset_angle_deg.median"), 0.1),
    ],
  },
  {
    id: "ub-symmetrised",
    title: "Says what a symmetrised volume can and cannot show of the UB",
    origin: "UB rounds: symmetrising turns a misorientation into rings around the nodes, so the orientation needs the unsymmetrised export.",
    dataset: HEX,
    config: HEX_CONFIG,
    question: "Is the UB of this volume right?",
    checks: [answers, ran("ub_check"), mentions(/\bunsymmetri[sz]ed\b|\bbefore (it was )?symmetri[sz]/i, "that the orientation needs the unsymmetrised data")],
  },
  {
    id: "ub-misoriented",
    title: "Measures how far the UB is off on the unsymmetrised volume",
    origin: "UB rounds: on the unsymmetrised export the UB is turned 0.87°, the cell (hexagonal, 2×2×2) 8.002 × 9.988 Å.",
    dataset: HEX_RAW,
    config: HEX_CONFIG,
    question: "Is the UB of this volume right? If not, how far off is it?",
    checks: [
      answers,
      ran("ub_check"),
      quotes("the rotation", measured("ub_check", "orientation_change_deg"), 0.05),
      quotes("the refined a", refinedA, 0.005),
    ],
  },
];
