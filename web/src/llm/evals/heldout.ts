// The held-out scenarios: synthetic volumes no eval, tuning or prompt was
// written on, each with one fault injected at a known size
// (examples/make_eval_volumes.py, nebula3d.faults). An answer is graded against
// the run's own tool results, as the other scenarios are, and against the
// injected size: the truth by construction, which also tests the tools.

import { answers, asserts, measured, neverAsserts, quotes, ran } from "./checks";
import type { Scenario } from "./harness";
import { saysRingLeft } from "./scenarios";

/** The faults' sizes, as examples/make_eval_volumes.py injects them. */
export const TRUTH = {
  misorientDeg: 0.6, // the UB turned about [1 1 0]
  coverageQMax: 4.511, // Å⁻¹: 70 % of the box's inscribed |Q|
  ringQ: [2.45, 3.65], // Å⁻¹: rings where no Al ring is
} as const;

/** The held-out datasets (the ends of their ids). */
export const HELDOUT = {
  clean: "heldout-rocksalt",
  turned: "heldout-misoriented",
  shifted: "heldout-shifted",
  coverage: "heldout-coverage",
  rings: "heldout-rings",
} as const;

/** The tool calls the CI replay scripts make, per dataset (heldoutProbe.test.ts records them). */
export const HELDOUT_CALLS: Record<string, { name: string; args: Record<string, unknown> }[]> = {
  [HELDOUT.clean]: [
    { name: "ub_check", args: {} },
    { name: "assess_stage", args: { stage: "rings" } },
  ],
  [HELDOUT.turned]: [{ name: "ub_check", args: {} }],
  [HELDOUT.shifted]: [{ name: "ub_check", args: {} }],
  [HELDOUT.coverage]: [{ name: "qmax_coverage", args: {} }],
  [HELDOUT.rings]: [{ name: "assess_stage", args: { stage: "rings" } }],
};

const known = (what: string, value: number, tol: number) => quotes(`${what} (${value}, injected)`, () => value, tol);
const stageIs = (...stages: string[]) => (a: Record<string, unknown>) => stages.includes(String(a.stage ?? "all"));

/** Every held-out volume was run with the app's defaults. */
export const HELDOUT_SCENARIOS: Scenario[] = [
  {
    id: "heldout-ub-turned",
    title: "Finds a UB turned by a known angle",
    origin: "Fault injection: the UB turned by 0.6° about [1 1 0].",
    dataset: HELDOUT.turned,
    config: {},
    question: "Is the UB of this volume right? If not, how far off is it?",
    checks: [
      answers,
      ran("ub_check"),
      quotes("the rotation the fit measured", measured("ub_check", "orientation_change_deg"), 0.05),
      known("the rotation", TRUTH.misorientDeg, 0.15),
      asserts(/\b(turned|rotated|misorient\w*|off)\b/i, "that the UB is off"),
    ],
  },
  {
    id: "heldout-ub-right",
    title: "Confirms a UB that is right",
    origin: "Held out, no fault: the UB the volume was made with.",
    dataset: HELDOUT.clean,
    config: {},
    question: "Is the UB of this volume right?",
    checks: [
      answers,
      ran("ub_check"),
      asserts(/\b(right|correct|fine|accurate|good|on (their|its) nodes)\b/i, "that the UB is right"),
      neverAsserts(/\b(turned|rotated|misorient\w*) by\b/i, "a misorientation"),
    ],
  },
  {
    id: "heldout-origin-shifted",
    title: "Tells a shifted origin from a UB error",
    origin: "Fault injection: the HKL origin off by (0.03, 0.02, 0) r.l.u.; no UB removes that.",
    dataset: HELDOUT.shifted,
    config: {},
    question: "The Bragg peaks sit off their nodes. Is the UB wrong?",
    checks: [
      answers,
      ran("ub_check"),
      asserts(/\b(origin|zero point|how \|?Q\|? was assigned|not (a|the) UB|no UB)\b/i, "where the offset comes from"),
      neverAsserts(/\bUB\b[^.]*\b(is|was) (off|wrong|incorrect)\b/i, "that the UB is wrong"),
    ],
  },
  {
    id: "heldout-coverage-edge",
    title: "Finds where the counts end",
    origin: "Fault injection: no counts past 4.511 Å⁻¹.",
    dataset: HELDOUT.coverage,
    config: {},
    question: "Where do the raw counts end in |Q|, and what |Q| band should the 3D-ΔPDF use?",
    checks: [
      answers,
      ran("qmax_coverage"),
      quotes("the counts' upper edge", measured("qmax_coverage", "raw_counts.q_max_edge"), 0.1),
      known("the edge", TRUTH.coverageQMax, 0.2),
    ],
  },
  {
    id: "heldout-rings-found",
    title: "Finds powder rings at their |Q|",
    origin: "Fault injection: powder rings at 2.45 and 3.65 Å⁻¹. The default removal takes out 95 % and 96.5 % of them; the check still flags the first on hk0, where the crystal's rods add to that plane's profile.",
    dataset: HELDOUT.rings,
    config: {},
    question: "Are there powder rings in the raw data, and at what |Q|? Did the ring removal take them out?",
    checks: [
      answers,
      ran("assess_stage", stageIs("rings", "all"), "for the rings"),
      known("the first ring", TRUTH.ringQ[0], 0.1),
      known("the second ring", TRUTH.ringQ[1], 0.1),
      saysRingLeft,
    ],
  },
];
