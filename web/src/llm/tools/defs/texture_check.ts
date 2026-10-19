// texture_check: whether the punch and the backfill printed a pattern of their
// own into reciprocal space (fill bias, azimuthal texture).

import { fetchSlice } from "../../../api/client";
import { safe, stageVolumeId } from "../../context/loadContext";
import { qRadius } from "../../context/pipelineContext";
import { evidence } from "../../inference";
import { textureMetrics } from "../../metrics/texture";
import { judge } from "../../verdicts/rules";
import { num, oneOf } from "../shared/args";
import { checkInRange, cleanupView, HKL, planeLabel, RECIP_FIXED, RECIP_PLANES, recipMeta, recipRange } from "../shared/cuts";
import { described, description } from "../shared/describe";
import type { ChatTool } from "../types";

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
    description("texture_check")`Check whether the punch and backfill printed a pattern of their own into reciprocal space, on a cut (default: the three principal planes through the origin). Fill bias: each filled hole against the range its measured rim allows, from the diffuse at the hole's edge carried in to its rise toward the node continued linearly${evidence(" (the diffuse often peaks at the nodes, so a sound fill sits above its rim's median)")}; the part outside that range, signed, in the rim's σ and in units of the local diffuse level. Holes filled systematically outside it (systematic_fill_bias: 75 % of them one way, a median of 0.5σ and a fifth of the level or more) add a lattice-periodic texture${evidence(" that the ΔPDF turns into features at lattice vectors")}. Azimuthal texture: per |Q| shell, how much the sector means vary around the shell before the punch (unpunched voxels) and after the backfill${evidence("; a ratio near 1 adds none")}.`,
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
    const cuts =
      args.plane === undefined
        ? RECIP_PLANES.filter((p) => {
            const r = recipRange(meta, RECIP_FIXED[p]);
            return r[0] <= 0 && r[1] >= 0;
          }).map((plane) => ({ plane, value: 0 }))
        : [{ plane: oneOf(args, "plane", RECIP_PLANES), value: num(args, "value", 0) }];
    for (const c of cuts) checkInRange(HKL[RECIP_FIXED[c.plane]], c.value, recipRange(meta, RECIP_FIXED[c.plane]));
    const rows = await Promise.all(
      cuts.map(async ({ plane, value }) => {
        const [before, punched, filled] = await Promise.all(
          ids.map((id) => (id ? safe(fetchSlice(id, plane, value)) : Promise.resolve(null))),
        );
        return { cut: planeLabel(plane, value), ...textureMetrics(before, punched, filled, qRadius(plane, value, meta)) };
      }),
    );
    const biased = rows.filter((r) => r.systematic_fill_bias).length;
    const bias = (i: number) => Math.abs(rows[i].median_fill_bias_sigma ?? 0);
    const strongest = rows.reduce((best, _r, i) => (bias(i) > bias(best) ? i : best), 0);
    const ratios = rows.map((r) => r.azimuthal_ratio).filter((x): x is number => x != null);
    const result = { per_cut: rows };
    return {
      result,
      outcomes: [judge("texture", result)],
      summary:
        `${biased ? `systematic fill bias on ${biased} of ${rows.length} cut(s)` : "no systematic fill bias"}` +
        (ratios.length ? ` · azimuthal ratio ${Math.min(...ratios)}–${Math.max(...ratios)}` : ""),
      view: cleanupView(cuts[strongest].plane, cuts[strongest].value),
    };
  },
};
