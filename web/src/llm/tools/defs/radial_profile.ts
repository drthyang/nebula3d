// radial_profile: the median intensity in |Q| shells of one reciprocal cut, for
// each cleanup stage side by side.

import { fetchSlice } from "../../../api/client";
import { RECIP_STAGES, stageVolumeId } from "../../context/loadContext";
import { qRadius } from "../../context/pipelineContext";
import { evidence, reading } from "../../inference";
import { radialProfile, roundSig } from "../../metrics/sliceStats";
import { keysOf, RECIP } from "../facts";
import { num, oneOf } from "../shared/args";
import { checkInRange, cleanupView, HKL, planeLabel, RECIP_FIXED, RECIP_PLANES, recipMeta, recipRange } from "../shared/cuts";
import { described, description } from "../shared/describe";
import { ToolArgError, type ChatTool } from "../types";

export const radial_profile: ChatTool = {
  name: "radial_profile",
  facts: {
    label: "Took a radial profile",
    acts: null,
    offeredFor: ["rings", "backfill", "flatten", "general"],
    // No verdict: a ring is judged in 3D (assess_stage); a radial profile
    // shows a bump on one plane only.
    highlights: (args) => (args.stages === undefined ? ["raw", ...RECIP] : keysOf(args.stages)),
  },
  ...described(
    description("radial_profile")`The median intensity in |Q| shells of one reciprocal cut, for each cleanup stage side by side (raw, ringremoved, braggpunched, backfilled, flattened). Shell medians ignore Bragg peaks but follow powder rings${evidence(", which are bumps in raw that ring removal should take out without denting the diffuse")}${reading("; after flatten the floor should sit near 0 at every |Q|")}.${reading(" Use it to see where in |Q| a stage left or removed signal.")}`,
  ),
  parameters: {
    type: "object",
    properties: {
      plane: { type: "string", enum: RECIP_PLANES, description: "hk0 (default), h0l or 0kl" },
      value: { type: "number", description: "Cut position along the fixed axis, in r.l.u. (default 0)" },
      stages: {
        type: "array",
        items: { type: "string", enum: RECIP_STAGES },
        description: "Stages to compare (default every one that exists)",
      },
      bins: { type: "integer", minimum: 8, maximum: 64, description: "Number of |Q| shells (default 32)" },
    },
  },
  run: async (args, { dataset }) => {
    const plane = oneOf(args, "plane", RECIP_PLANES, "hk0");
    const value = num(args, "value", 0);
    const bins = Math.round(num(args, "bins", 32));
    if (bins < 8 || bins > 64) throw new ToolArgError("bins must be within [8, 64]");
    let stages = RECIP_STAGES.filter((s) => stageVolumeId(dataset, s));
    if (args.stages !== undefined) {
      if (!Array.isArray(args.stages) || !args.stages.length) throw new ToolArgError("stages must be a non-empty list");
      const wanted = args.stages.map((s) => oneOf({ stage: s }, "stage", RECIP_STAGES));
      stages = stages.filter((s) => wanted.includes(s));
    }
    if (!stages.length) throw new Error("none of those stage outputs exist yet; run_pipeline computes them");
    const meta = await recipMeta(dataset);
    checkInRange(HKL[RECIP_FIXED[plane]], value, recipRange(meta, RECIP_FIXED[plane]));
    const radius = qRadius(plane, value, meta);
    const slices = await Promise.all(stages.map((s) => fetchSlice(stageVolumeId(dataset, s)!, plane, value)));
    // The stages share one grid, so their shells line up.
    const profiles = slices.map((s) => radialProfile(s, bins, radius, "median"));
    const rows = profiles[0].r
      .map((r, i) => ({
        q: roundSig(r, 3),
        ...Object.fromEntries(
          stages.map((s, j) => {
            const v = profiles[j].intensity[i];
            return [s, Number.isFinite(v) ? roundSig(v, 3) : null];
          }),
        ),
      }))
      .filter((row) => stages.some((s) => (row as Record<string, number | null>)[s] != null));
    return {
      result: {
        cut: planeLabel(plane, value),
        q_unit: radius ? "|Q| in Å⁻¹" : "in-plane radius in r.l.u. (no cell)",
        stat: "median per shell",
        rows,
      },
      summary: `${planeLabel(plane, value)}: ${rows.length} shells × ${stages.length} stages`,
      view: cleanupView(plane, value),
    };
  },
};
