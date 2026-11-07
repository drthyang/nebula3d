// The ring gate: a change to the ring removal's settings, or a tuning of it,
// waits for the 3D ring verdict (assess_stage's rings, the ring rule of
// nebula3d.preprocessing.ring_isotropy) to find a ring left or dented on the
// outputs as they now are. A bump on one cut (measure_reciprocal_cut's
// ring_residuals, `significant` beyond its noise) is no such verdict: the
// crystal's own scattering makes them too, and a ring model sent after them
// takes the crystal's diffuse shell with it. A free local eval (THY-63, arm C,
// 2026-11-01) saw gemma4:26b change the ring model on cut residuals in 5 of 24
// runs and remove the dev-rings-shell case's own shell in 2 of 3.
//
// The user may still ask for a change by name (the setting, a ring model's
// name, "ring model", or a tuning of the rings). The app's own calls, which
// carry no reply's steps, are not held. The refusal is the tool's own, the
// same in both arms: it names no skill, tool or stage, and holds no inference.
//
// A verdict counts on the outputs as they now are: a run that recomputed the
// rings since makes it stale. A run of the conversation is one of its steps
// (run_pipeline); any other run (a Run card, the Configure or Execution page,
// one outside the console) is none, and the output the verdict judged says it
// (its mark, state/ringOutput.ts): recomputed since, it is another output.

import { ringOutputChanged, type RingOutputMark } from "../../../state/ringOutput";
import type { AgentStep } from "../../agent";
import { found } from "../../readings";
import { TUNE_PARAMS } from "../../tune/catalog";
import { outcomesOf } from "../../verdicts/recorded";
import type { Kind, Outcome } from "../../verdicts/rules";
import type { ToolContext } from "../types";

/** The settings of the ring removal. */
export const RING_SETTINGS: readonly string[] = TUNE_PARAMS.filter((p) => p.stage === "rings").map((p) => p.key);

/** What a refusal says, whatever the setting (findings.ts may read it). */
export const RING_EVIDENCE_REFUSED = "waits for a 3D verdict that a powder ring is left or dented on the current outputs";

/** The refusal of a change to `what` (a setting, or "a tuning of the powder-ring subtraction"). */
export const ringEvidenceRefusal = (what: string): string =>
  `${what} ${RING_EVIDENCE_REFUSED}: a bump on one cut is no such verdict, since the crystal's own scattering makes them too. ` +
  `Change it once that verdict finds one, or once the user names the setting.`;

// The words that name a change to the ring removal's settings in the user's message.
const NAMES_RING_SETTING = [
  ...RING_SETTINGS.map((k) => new RegExp(`\\b${k}\\b`, "i")),
  /\bring[- ](model|settings?|sectors|window|subtraction|fourier)\b/i,
  /\b(pooled|global_v2|patched|parametric)\b/i,
];
// ... and a tuning of it.
const NAMES_RING_TUNING = /\btun\w*\b[^.?!]*\brings?\b|\brings?\b[^.?!]*\btun\w*\b/i;

/** Whether the user's latest message names a change to the ring removal's settings. */
export const namesRingSetting = (message: string | undefined): boolean => !!message && NAMES_RING_SETTING.some((re) => re.test(message));

/** Whether the user's latest message asks for the rings to be tuned. */
export const namesRingTuning = (message: string | undefined): boolean => !!message && (NAMES_RING_TUNING.test(message) || namesRingSetting(message));

/**
 * Whether a change to the ring removal may go ahead on the evidence: the 3D
 * ring verdict on the outputs as they now are (this reply's steps after the
 * conversation's earlier ones, a run's recomputing making older ones stale,
 * the conversation's own or any other: its ring output's mark) finds a ring
 * left or dented. `dataset`: the dataset as it is listed now, whose ring
 * output's date the mark is held to. True for the app's own calls (no reply's
 * steps).
 */
export function ringVerdictAllowsChange(ctx: Pick<ToolContext, "replySteps" | "earlierSteps"> & { dataset?: ToolContext["dataset"] }): boolean {
  if (!ctx.replySteps) return true;
  const standing = standingVerdict([...(ctx.earlierSteps ?? []), ...ctx.replySteps]);
  if (standing?.outcome.kind !== "attention") return false;
  return !(standing.ringOutput && ringOutputChanged(standing.ringOutput, ctx.dataset));
}

/**
 * Whether a step recomputed the ring removal: run_pipeline (the one tool that
 * writes the outputs, its facts' `invalidates`), unless its result says it
 * reused the rings. Read here, not through evidence.ts, which reads the
 * registry this module's tools sit in.
 */
const recomputesRings = (s: AgentStep): boolean => {
  if (s.name !== "run_pipeline" || s.status !== "done") return false;
  const r = found(s);
  const stages = r && typeof r.stages === "object" ? (r.stages as Readonly<Record<string, unknown>> | null) : null;
  return !stages || stages.rings === "computed";
};

// The newest 3D ring verdict that no run among `steps` recomputed the rings
// after, and the mark of the ring output it judged: its outcome's, or, for a
// step the transcript keeps without its outcomes, the step's.
function standingVerdict(steps: readonly AgentStep[]): { outcome: Outcome; ringOutput?: RingOutputMark } | undefined {
  let standing: { outcome: Outcome; ringOutput?: RingOutputMark } | undefined;
  for (const s of steps) {
    if (recomputesRings(s)) standing = undefined;
    for (const o of outcomesOf(s)) {
      if (o.check !== "rings") continue;
      const ringOutput = o.ringOutput ?? s.ringOutput;
      standing = { outcome: o, ...(ringOutput ? { ringOutput } : {}) };
    }
  }
  return standing;
}

/** The newest 3D ring verdict on the outputs as `steps` leave them: its kind, or undefined where none stands. */
export function ringVerdict(steps: readonly AgentStep[]): Kind | undefined {
  return standingVerdict(steps)?.outcome.kind;
}
