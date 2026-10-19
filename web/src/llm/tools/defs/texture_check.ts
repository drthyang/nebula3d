// texture_check: whether the punch and the backfill printed a pattern of their
// own into reciprocal space. The fill bias over every punch hole of the volume,
// each hole with its 3-D rim (the backend's 3-D read of metrics/texture.ts's
// rule, plan 4.2), which the verdict reads; and the azimuthal texture on cuts,
// which only a cut measures.

import { fetchSlice, fetchVolumeTexture } from "../../../api/client";
import type { VolumeTexture } from "../../../api/types";
import { safe, stageVolumeId } from "../../context/loadContext";
import { qRadius } from "../../context/pipelineContext";
import { evidence } from "../../inference";
import { isTooCoarse } from "../../metrics/coarse";
import { roundSig } from "../../metrics/sliceStats";
import { azimuthalTexture, FILL_BIAS_LIMITS, volumeFillBias } from "../../metrics/texture";
import { judge } from "../../verdicts/rules";
import { num, oneOf } from "../shared/args";
import { checkInRange, cleanupView, HKL, planeLabel, RECIP_FIXED, RECIP_PLANES, recipMeta, recipRange } from "../shared/cuts";
import { described, description } from "../shared/describe";
import type { ChatTool } from "../types";

/** The limits the backend judged the fills by, where they are not the rule's (FILL_BIAS_LIMITS); else null. */
const otherLimits = (t: VolumeTexture): string | null => {
  const used = { minSigma: t.min_sigma, oneWay: t.one_way, minHoles: t.min_holes, floor: t.floor };
  const keys = Object.keys(FILL_BIAS_LIMITS) as (keyof typeof FILL_BIAS_LIMITS)[];
  return keys.some((k) => used[k] !== FILL_BIAS_LIMITS[k]) ? JSON.stringify(used) : null;
};

export const texture_check: ChatTool = {
  name: "texture_check",
  facts: {
    label: "Checked for texture",
    acts: null,
    // A generic question too: the system prompt's method checks the fill (the user's decision, Q10, 2026-10-19).
    offeredFor: ["rings", "backfill", "general"],
    settles: ["backfill"],
    reportable: true,
    highlights: ["punch", "backfill"],
  },
  ...described(
    description("texture_check")`Check whether the punch and backfill printed a pattern of their own into reciprocal space. Fill bias, over every punch hole in 3-D: each filled hole against the range its measured rim allows, from the diffuse at the hole's edge carried in to its rise toward the node continued linearly${evidence(" (the diffuse often peaks at the nodes, so a sound fill sits above its rim's median)")}; the part outside that range, signed, in the rim's σ and in units of the local diffuse level, and the shares of holes above and below it, and beyond it by a fifth of the level or more (above_floor_fraction, below_floor_fraction). Holes filled systematically outside it (systematic_fill_bias: 75 % of them one way, a median of 0.5σ and a fifth of the level or more) add a lattice-periodic texture${evidence(" that the ΔPDF turns into features at lattice vectors")}. Azimuthal texture, on a cut (default: the three principal planes through the origin): per |Q| shell, how much the sector means vary around the shell after the backfill against before the punch (unpunched voxels)${evidence("; a ratio near 1 adds none")}.`,
  ),
  parameters: {
    type: "object",
    properties: {
      plane: { type: "string", enum: RECIP_PLANES, description: "One plane instead of all three" },
      value: { type: "number", description: "Cut position for that plane, in r.l.u. (default 0)" },
    },
  },
  run: async (args, { dataset }) => {
    const ids = (["ringremoved", "braggpunched", "backfilled"] as const).map((s) => stageVolumeId(dataset, s));
    if (!ids[1] || !ids[2]) throw new Error("this needs the punched and backfilled outputs; run_pipeline computes them");
    const meta = await recipMeta(dataset);
    const asked = args.plane !== undefined;
    const cuts = asked
      ? [{ plane: oneOf(args, "plane", RECIP_PLANES), value: num(args, "value", 0) }]
      : RECIP_PLANES.filter((p) => {
          const r = recipRange(meta, RECIP_FIXED[p]);
          return r[0] <= 0 && r[1] >= 0;
        }).map((plane) => ({ plane, value: 0 }));
    for (const c of cuts) checkInRange(HKL[RECIP_FIXED[c.plane]], c.value, recipRange(meta, RECIP_FIXED[c.plane]));
    // Every hole of the volume (the one farthest outside its range listed,
    // for the figure), and each cut's azimuthal texture, which only a cut measures.
    const [volume, rows] = await Promise.all([
      fetchVolumeTexture(ids[2], 1, FILL_BIAS_LIMITS),
      Promise.all(
        cuts.map(async ({ plane, value }) => {
          const [before, punched, filled] = await Promise.all(
            ids.map((id) => (id ? safe(fetchSlice(id, plane, value)) : Promise.resolve(null))),
          );
          const { azimuthal_ratio } = azimuthalTexture(before, punched, filled, qRadius(plane, value, meta));
          return { cut: planeLabel(plane, value), azimuthal_ratio };
        }),
      ),
    ]);
    const other = otherLimits(volume);
    if (other) throw new Error(`the backend judged the fills by other limits (${other}) than the rule's (${JSON.stringify(FILL_BIAS_LIMITS)})`);
    const fills = volumeFillBias(volume);
    const result = { ...fills, per_cut: rows };
    const ratios = rows.map((r) => r.azimuthal_ratio).filter((x): x is number => x != null);
    const said =
      fills.systematic_fill_bias === true
        ? `systematic fill bias over ${fills.n_judged} holes in 3-D (median ${fills.median_fill_bias_level} of the level)`
        : fills.systematic_fill_bias === false
          ? `no systematic fill bias over ${fills.n_judged} holes in 3-D`
          : `fill bias not judged: ${isTooCoarse(fills.not_judged) ? "grid too coarse" : fills.not_judged}`;
    // The figure: the cut asked for; else the H–K plane through the hole
    // farthest outside its range, where the fills were judged and one is
    // outside it; else the first cut.
    const far = volume.judged ? volume.holes[0] : undefined;
    const view =
      !asked && far && far.not_judged === null && far.bias_level
        ? cleanupView("hk0", roundSig(far.centre_hkl[2], 4))
        : cuts.length
          ? cleanupView(cuts[0].plane, cuts[0].value)
          : undefined;
    return {
      result,
      outcomes: [judge("texture", result)],
      summary: said + (ratios.length ? ` · azimuthal ratio ${Math.min(...ratios)}–${Math.max(...ratios)}` : ""),
      view,
    };
  },
};
