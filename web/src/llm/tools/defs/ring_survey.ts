// ring_survey: the raw volume's powder rings before a run, nothing removed
// (THY-43). The ring stage's own detection, 3D ring test, Al lattice fit and
// phase match as a dry run, in Python (nebula3d.preprocessing.ring_survey),
// read through either adapter (the server's GET /api/volumes/{id}/ring-survey,
// the webbridge's volume_ring_survey_json) with the Configure page's stack
// axis and edge trim, as the ring stage would read them.
//
// Offered only before a run (its facts' preRun): after one the ring stage's
// record says the same, and more (assess_stage's rings), so no reply after a
// run, the worst turn among them, carries its definition. Auto mode's
// preflight runs it as an app step (auto/controller.ts). Its shells, each with
// its code, are drawn on the raw view (examine/overlays.ts) from the data
// beside the result; the model reads the survey's few lines alone.

import { fetchRingSurvey } from "../../../api/client";
import type { RingSurvey } from "../../../api/types";
import { edgeTrimLayers, usePipelineStore } from "../../../state/pipelineStore";
import { hklVolumeId, stageVolumeId } from "../../context/loadContext";
import { cleanupView, RECIP_FIXED, RECIP_PLANES, recipMeta, recipRange } from "../shared/cuts";
import type { ChatTool } from "../types";

/** The survey's lines as the model reads them (nebula3d.preprocessing.ring_survey.survey_lines). */
function surveyResult(s: RingSurvey): Record<string, unknown> {
  const l = s.lines;
  return {
    al: l?.al ?? "no Al lattice fitted",
    phases: l?.phases ?? null,
    unrecognized: l?.unrecognized ?? "none",
    ...(l?.unconfirmed ? { unconfirmed: l.unconfirmed } : {}),
    removal: l?.removal ?? null,
    ...(l?.grid ? { grid: l.grid } : {}),
  };
}

/** The transcript's line: the Al lines, the phase, the rings no line explains. */
function surveySummary(s: RingSurvey): string {
  const al = s.rings.filter((r) => r.code === "AL").length;
  const ph = s.rings.find((r) => r.code === "PH")?.phase;
  const unk = s.rings.filter((r) => r.code === "UNK").map((r) => r.q.toFixed(2));
  return [
    s.al_lattice_a != null ? `Al a=${s.al_lattice_a.toFixed(3)} Å, ${al} line${al === 1 ? "" : "s"}` : "no Al lattice",
    ph && s.phase_summary ? `possibly ${ph}` : null,
    unk.length ? `unrecognized ${unk.join(", ")}` : "none unrecognized",
  ]
    .filter(Boolean)
    .join(" · ");
}

export const ring_survey: ChatTool = {
  name: "ring_survey",
  facts: {
    label: "Surveyed the powder rings",
    runningLabel: "Surveying the powder rings",
    acts: null,
    offeredFor: ["rings", "general"],
    preRun: true,
    highlights: ["raw"],
  },
  description:
    "The raw volume's powder rings before a run, nothing removed: the ring stage's detection and 3D test as a dry run. Returns al (the Al lattice, its lines as hkl |Q|), phases (a phase whose lines may explain other rings: a possibility), unrecognized (rings no line explains: |Q| Å⁻¹, snr), unconfirmed, removal (what the ring stage would remove).",
  parameters: { type: "object", properties: {} },
  run: async (_args, { dataset }) => {
    const rawId = stageVolumeId(dataset, "raw") ?? hklVolumeId(dataset);
    if (!rawId) throw new Error("no raw volume to survey");
    const s = usePipelineStore.getState();
    const survey = await fetchRingSurvey(rawId, s.ringSliceAxis || "H", edgeTrimLayers(s));
    // The rings show on any plane through the origin: the first the grid holds.
    const meta = await recipMeta(dataset);
    const plane = RECIP_PLANES.find((p) => {
      const r = recipRange(meta, RECIP_FIXED[p]);
      return r[0] <= 0 && r[1] >= 0;
    });
    return {
      result: surveyResult(survey),
      summary: surveySummary(survey),
      ...(plane ? { view: cleanupView(plane, 0) } : {}),
      overlay: {
        ringSurvey: survey.rings.map((r) => ({ q: r.q, code: r.code, line: r.line ?? null, phase: r.phase ?? null })),
      },
    };
  },
};
