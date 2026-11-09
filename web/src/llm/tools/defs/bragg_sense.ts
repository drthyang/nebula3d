// bragg_sense: the raw volume's Bragg peaks before a run, nothing punched
// (THY-43). Their shapes on six raw sections (tilt, elongation, lobes, whether
// the fit's cap binds) and the share of each peak every punch footprint would
// leave, modelled with the run's punch settings, in Python
// (nebula3d.analysis.bragg_sense), read through either adapter (the server's
// POST /api/volumes/{id}/bragg-sense, the webbridge's volume_bragg_sense_json).
//
// Its rule names the method settings the peaks ask for (the footprint, the
// fit's constraints), which the model sets with update_settings, citing the
// numbers; a reach growing with |Q| is said, not set; data symmetrised already
// that declare no symmetry get a card to declare it (apply/proposals.ts), the
// user's click alone.
//
// Offered only before a run (its facts' preRun), as ring_survey is: after one,
// assess_stage's punch says what the run left (its Bragg tails), so no reply
// after a run, the worst turn among them, carries its definition. Auto mode's
// preflight runs it as an app step (auto/controller.ts). The flagged peaks are
// drawn on the raw view (examine/overlays.ts) from the data beside the result;
// the model reads the lines alone.

import { fetchBraggSense } from "../../../api/client";
import type { BraggSense, StageParamsIn } from "../../../api/types";
import { formToParams, usePipelineStore } from "../../../state/pipelineStore";
import { hklVolumeId, stageVolumeId } from "../../context/loadContext";
import { cleanupView, RECIP_FIXED, RECIP_PLANES, recipMeta, recipRange } from "../shared/cuts";
import type { ChatTool } from "../types";

/** The run's settings the sensing reads: how the raw volume is loaded (its edge trim) and how each footprint is modelled (the punch's). */
const READS = (key: string): boolean => key === "edge_trim" || key.startsWith("punch_");

/** The run's settings as the sensing takes them, and only those: a setting it does not read leaves its record cached. */
const braggSenseParams = (params: StageParamsIn): StageParamsIn =>
  Object.fromEntries(Object.entries(params).filter(([k]) => READS(k))) as StageParamsIn;

/** What the rule recommends, as update_settings' changes: only what it changes from the default. */
function recommended(s: Pick<BraggSense, "prediction">): Record<string, string | boolean> {
  const p = s.prediction;
  if (!p) return {};
  return {
    ...(p.footprint !== "own" ? { punchFootprint: p.footprint } : {}),
    ...(p.drop_fit_constraints ? { punchFitUnconstrained: true } : {}),
  };
}

/** The sensing's lines as the model reads them (nebula3d.analysis.bragg_sense.sense_lines), and what to set. */
function senseResult(s: BraggSense): Record<string, unknown> {
  const l = s.lines;
  const set = recommended(s);
  return {
    shape: l.shape,
    ...(l.left ? { left: l.left } : {}),
    ...(l.footprint ? { footprint: l.footprint } : {}),
    ...(l.constraints ? { constraints: l.constraints } : {}),
    ...(l.q ? { q: l.q } : {}),
    ...(l.symmetry ? { symmetry: l.symmetry } : {}),
    recommend: Object.keys(set).length ? set : "keep the defaults",
  };
}

/** The transcript's line: what the peaks ask for. */
function senseSummary(s: BraggSense): string {
  if (s.not_judged) return `not judged: ${s.not_judged}`;
  const p = s.prediction;
  const set = recommended(s);
  return [
    `${s.n_nodes} strong nodes`,
    Object.keys(set).length ? Object.entries(set).map(([k, v]) => `${k} ${String(v)}`).join(", ") : "keep the default footprint",
    p?.q_dependent_reach ? "reach grows with |Q|" : null,
    s.mirrors.declare ? `symmetrised, declares none (${s.mirrors.declare})` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export const bragg_sense: ChatTool = {
  name: "bragg_sense",
  facts: {
    label: "Sensed the Bragg peaks",
    runningLabel: "Sensing the Bragg peaks",
    acts: null,
    offeredFor: ["punch", "general"],
    preRun: true,
    // Evidence for what an answer says of the punch's settings before a run;
    // a run that recomputes the punch makes it stale, and assess_stage
    // settles the punch after it (evidence.ts).
    settles: ["punch"],
    highlights: ["raw"],
  },
  description:
    "The raw volume's Bragg peaks before a run, nothing punched: their shapes on six raw sections and the share of each peak every punch footprint would leave. Returns shape, left, footprint and constraints (the rule's choice, with its numbers), q (a reach growing with |Q|), symmetry (symmetrised data that declare none), recommend (the settings to set with update_settings).",
  parameters: { type: "object", properties: {} },
  run: async (_args, { dataset }) => {
    const rawId = stageVolumeId(dataset, "raw") ?? hklVolumeId(dataset);
    if (!rawId) throw new Error("no raw volume to sense");
    const sense = await fetchBraggSense(rawId, braggSenseParams(formToParams(usePipelineStore.getState())));
    // The peaks show on the sections through the origin: the first the grid holds.
    const meta = await recipMeta(dataset);
    const plane = RECIP_PLANES.find((p) => {
      const r = recipRange(meta, RECIP_FIXED[p]);
      return r[0] <= 0 && r[1] >= 0;
    });
    return {
      result: senseResult(sense),
      summary: senseSummary(sense),
      ...(plane ? { view: cleanupView(plane, 0) } : {}),
      overlay: { braggSensed: sense.flagged, ...(sense.mirrors.declare ? { braggDeclare: sense.mirrors.declare } : {}) },
    };
  },
};
