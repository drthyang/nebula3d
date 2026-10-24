// The eval suite's scripted replays: for each scenario a good script and a bad
// one, played by a scripted model against the tool results recorded on the
// eval datasets (fixtures/hex90k.json, from probe.test.ts), through the real
// agent loop, messages and graders. The CI replay (evals.test.ts) holds the
// good to every check and the bad to the checks named for it; the answer
// goldens (answerTextGoldens.test.ts) read what each wrote.

import type { Dataset } from "../../api/types";
import type { PipelineContext } from "../context/pipelineContext";
import { CHAT_TOOLS } from "../tools";
import fixture from "./fixtures/hex90k.json";
import { runScenario, type Scenario, type ScenarioResult } from "./harness";
import { replayTools, scriptedModel, SCRIPTED_URL, type ScriptedModel, type ScriptTurn } from "./scripted";

export interface Replay {
  good: ScriptTurn[];
  bad: ScriptTurn[];
  catches: string[]; // checks the bad run must fail
  // What the agent's own answer checks (answerChecks.ts) note under the bad
  // run, which they first sent back once: these failures are caught live too.
  flags?: RegExp;
}

export const REPLAYS: Record<string, Replay> = {
  "rings-left": {
    good: [
      { calls: [{ name: "assess_stage", args: { stage: "rings" } }] },
      {
        text: "Not quite. A ring is left at 10.3 Å⁻¹ on the h0l and 0kl planes, at 0.41 of the diffuse there. The bumps on hk0 at 5.5, 7.95 and 10.9 Å⁻¹ show on that plane only, so they are the crystal's own scattering.",
      },
    ],
    bad: [{ text: "Yes, the ring removal is clean: the rings were subtracted completely." }],
    catches: ["calls assess_stage for the rings", "quotes the leftover ring's |Q|", "says that a ring is left"],
    flags: /Not measured in this reply: the ring removal/,
  },
  "punch-missed": {
    good: [
      { calls: [{ name: "assess_stage", args: { stage: "punch" } }] },
      {
        text: "Not every one. The punch missed 16 lattice peaks at nodes, 8 each on the h0l and 0kl planes, and left 8 sharp off-lattice peaks. The 360 broad maxima it kept are diffuse scattering by their width.",
      },
    ],
    bad: [
      { calls: [{ name: "assess_stage", args: { stage: "punch" } }] },
      { text: "Yes, the punch removed every Bragg peak; nothing is left at the nodes." },
    ],
    catches: ["quotes the missed peaks at nodes", "says that lattice peaks were missed"],
    flags: /Contradicts the tools' verdict on the Bragg punch/,
  },
  "pdf-window-coverage": {
    good: [
      { calls: [{ name: "qmax_coverage", args: {} }] },
      {
        text: "Yes. The ellipsoid window puts 3.2e-6 of its weight on unmeasured reciprocal space, far under the 1e-3 limit, so the transform stays inside the measured coverage.",
      },
    ],
    bad: [{ calls: [{ name: "qmax_coverage", args: {} }] }, { text: "No: the window reaches past the measured coverage into the box corners." }],
    catches: ["quotes the window's weight on unmeasured space", "says that it stays inside the coverage"],
  },
  "pdf-separable-refused": {
    good: [
      {
        calls: [
          { name: "assess_stage", args: { stage: "pdf" } },
          { name: "qmax_coverage", args: {} },
        ],
      },
      {
        text: "I would not switch. On this hexagonal cell a separable window reaches past the measured coverage into the box's empty corners, and it breaks the six-fold symmetry the ellipsoid window keeps. Keep the ellipsoid window, which puts only 3.2e-6 of its weight on unmeasured space.",
      },
    ],
    bad: [
      { calls: [{ name: "update_settings", args: { pdfWindowShape: "separable" } }] },
      { text: "Done: I switched the ΔPDF to the separable window for a higher SNR." },
    ],
    catches: [
      "does not call update_settings",
      "says to keep the ellipsoid window",
      "says that a separable window would reach unmeasured space or break the symmetry",
    ],
  },
  "symmetry-kept": {
    good: [
      { calls: [{ name: "symmetry_check", args: {} }] },
      {
        text: "Yes. Every in-plane operation of the hexagonal cell holds on the ΔPDF's x–y section: the six-, three- and two-fold rotations and the a ↔ b mirror differ from it by at most 2.9e-6 RMS.",
      },
    ],
    bad: [{ text: "Probably, since the data were symmetrised." }],
    catches: ["calls symmetry_check", "says that the symmetry is kept"],
  },
  "q-band-from-raw": {
    good: [
      { calls: [{ name: "qmax_coverage", args: {} }] },
      {
        text: "The raw counts begin at 0.52 Å⁻¹ and end at 16.7 Å⁻¹; past either edge most voxels hold none. Set the band to 0.55–16.7 Å⁻¹, which is what you have now.",
      },
    ],
    bad: [{ calls: [{ name: "qmax_coverage", args: {} }] }, { text: "Use the full box: 0 to 25 Å⁻¹." }],
    catches: ["quotes the upper edge", "quotes the lower edge"],
  },
  "no-second-grain": {
    good: [
      { calls: [{ name: "grain_check", args: {} }] },
      {
        text: "No second grain. A rotated copy of the Bragg lattice indexes only 2 of the 40 strongest off-lattice orbits, against 3 at random directions. 35 of them sit next to Bragg nodes, offset by a median 0.85° of rotation: the crystal's own Bragg peaks, copied around the nodes by symmetrising data whose UB is about a degree off. Five lie farther from any node, and their origin is open.",
      },
    ],
    bad: [
      { calls: [{ name: "grain_check", args: {} }] },
      { text: "Yes, the off-lattice peaks show a second grain, turned about 20° from the main one." },
    ],
    catches: ["says that there is no second grain", "never claims a second grain", "quotes the offset angle"],
    flags: /Contradicts the tools' verdict on a second grain/,
  },
  "ub-symmetrised": {
    good: [
      { calls: [{ name: "ub_check", args: {} }] },
      {
        text: "Only partly measurable here. This volume is symmetrised under 6/mmm, which turns a misorientation into rings around the nodes, so ub_check could fit only the changes that keep the symmetry: the peaks sit about 0.4 % outside their nodes in-plane and 0.1 % along c. The orientation itself needs the unsymmetrised export.",
      },
    ],
    bad: [{ calls: [{ name: "ub_check", args: {} }] }, { text: "The UB is fine: the fit changed nothing." }],
    catches: ["says that the orientation needs the unsymmetrised data"],
    flags: /Contradicts the tools' verdict on the UB/,
  },
  "ub-misoriented": {
    good: [
      { calls: [{ name: "ub_check", args: {} }] },
      {
        text: "It is off. The fit turns the lattice by 0.874° about [1, −0.03, −0.43] and refines the hexagonal cell to a = 8.002 Å, c = 9.988 Å (the 2×2×2 cell), which brings the peaks from 0.135 to 0.035 Å⁻¹ RMS of their nodes.",
      },
    ],
    bad: [{ calls: [{ name: "ub_check", args: {} }] }, { text: "The UB is right; the peaks sit on their nodes." }],
    catches: ["quotes the rotation", "quotes the refined a"],
    flags: /Contradicts the tools' verdict on the UB/,
  },
  // The skills' firm rule: the bad scripts change a stage without reading its
  // skill, the executor refuses, and the change never lands.
  "skill-punch-change": {
    good: [
      { calls: [{ name: "read_skill", args: { name: "bragg-node-audit" } }] },
      { calls: [{ name: "update_settings", args: { changes: { punchMinSig: 6 } } }] },
      { text: "Done: the punch's minimum significance is now 6. Rerun from the punch stage to apply it." },
    ],
    bad: [
      { calls: [{ name: "update_settings", args: { changes: { punchMinSig: 6 } } }] },
      { text: "Done: the punch's minimum significance is now 6." },
    ],
    catches: ["reads the bragg-node-audit skill before update_settings", "calls update_settings with punchMinSig 6"],
  },
  "skill-pdf-change": {
    good: [
      { calls: [{ name: "read_skill", args: { name: "delta-pdf-interpretation" } }] },
      { calls: [{ name: "update_settings", args: { changes: { pdfApod: "hann" } } }] },
      { text: "Done: the 3D-ΔPDF now uses the Hann window. Rerun from the ΔPDF stage to apply it." },
    ],
    bad: [
      { calls: [{ name: "update_settings", args: { changes: { pdfApod: "hann" } } }] },
      { text: "Done: the 3D-ΔPDF now uses the Hann window." },
    ],
    catches: ["reads the delta-pdf-interpretation skill before update_settings", "calls update_settings with pdfApod hann"],
  },
  "skill-flatten-change": {
    good: [
      { calls: [{ name: "read_skill", args: { name: "reduction-qc" } }] },
      { calls: [{ name: "update_settings", args: { changes: { flattenQ2: true } } }] },
      { text: "Done: the flatten now also fits a b·Q² term. Rerun from the flatten stage to apply it." },
    ],
    bad: [
      { calls: [{ name: "update_settings", args: { changes: { flattenQ2: true } } }] },
      { text: "Done: the flatten now also fits a b·Q² term." },
    ],
    catches: ["reads the reduction-qc skill before update_settings", "calls update_settings with flattenQ2 on"],
  },
};

const datasets = fixture.datasets as unknown as Dataset[];
const contexts = fixture.contexts as unknown as Record<string, PipelineContext>;

/** One scenario played from a script, against the recorded results: the graded run, and the scripted model's counts. */
export async function replay(scenario: Scenario, turns: ScriptTurn[]): Promise<{ result: ScenarioResult; model: ScriptedModel }> {
  const model = scriptedModel(turns);
  const uninstall = model.install();
  try {
    const result = await runScenario(scenario, {
      datasets,
      settings: { baseUrl: SCRIPTED_URL, model: "scripted", apiKey: "", temperature: 0 },
      tools: replayTools(fixture.results as Record<string, string>, scenario.dataset, CHAT_TOOLS),
      context: contexts[scenario.dataset],
    });
    return { result, model };
  } finally {
    uninstall();
  }
}
