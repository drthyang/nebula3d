// measure_reciprocal_cut: the stage-quality metrics of one reciprocal-space
// cut. Its result says what each field means, once in a reply (`fields`): the
// system prompt's glossary for a model without tools (prompts/system.ts,
// SYSTEM), tersely, for a model with tools, whose context holds no cut (THY-63
// R3). In the result rather than the contract, it costs nothing until called.

import { reading } from "../../inference";
import { RECIP } from "../facts";
import { num, oneOf } from "../shared/args";
import { cleanupView, fieldsSent, measureRecip, RECIP_PLANES } from "../shared/cuts";
import { described, description } from "../shared/describe";
import { RECIP_FIELDS } from "../shared/fields";
import type { ChatTool } from "../types";

const recipSummary = (m: Awaited<ReturnType<typeof measureRecip>>): string =>
  [
    m.ring_removal?.ring_energy_ratio != null && `ring ratio ${m.ring_removal.ring_energy_ratio}`,
    m.bragg_punch_leftover &&
      (m.bragg_punch_leftover.n_at_nodes != null
        ? `${m.bragg_punch_leftover.n_at_nodes} missed at nodes, ${(m.bragg_punch_leftover.n_off_nodes ?? 0) - (m.bragg_punch_leftover.n_broad_off_nodes ?? 0)} sharp off-lattice, ${m.bragg_punch_leftover.n_broad_off_nodes ?? 0} broad maxima`
        : `${m.bragg_punch_leftover.n_suspicious} leftover peak(s)`),
    m.backfill?.median_seam_sigma != null && `seam ${m.backfill.median_seam_sigma}σ`,
    m.flatten?.after_floor_max_sigma != null && `floor ≤ ${m.flatten.after_floor_max_sigma}σ`,
  ]
    .filter(Boolean)
    .join(" · ") || "no stage metrics at this cut";

export const measure_reciprocal_cut: ChatTool = {
  name: "measure_reciprocal_cut",
  facts: { label: "Measured a reciprocal cut", acts: null, highlights: RECIP },
  ...described(
    description("measure_reciprocal_cut")`Compute the stage-quality metrics (ring removal, leftover Bragg peaks, backfill seams, flatten floors) on any reciprocal-space cut: one cut, not the volume. A reply's first call also returns fields, what each one means.${reading(" Use it to check whether a finding holds on other planes or off-zero cuts (e.g. L=0.5, or K=1/3 for satellites).")}`,
  ),
  parameters: {
    type: "object",
    properties: {
      plane: { type: "string", enum: RECIP_PLANES, description: "hk0: H–K plane (fixed L), h0l: H–L (fixed K), 0kl: K–L (fixed H)" },
      value: { type: "number", description: "Cut position along the fixed axis, in r.l.u." },
    },
    required: ["plane", "value"],
  },
  run: async (args, ctx) => {
    const plane = oneOf(args, "plane", RECIP_PLANES);
    const value = num(args, "value");
    const measured = await measureRecip(ctx.dataset, plane, value);
    // What the fields mean, once in a reply (arm C reads its definitions: call.ts).
    const result = fieldsSent(ctx.replySteps, "measure_reciprocal_cut") ? measured : { ...measured, fields: RECIP_FIELDS.whole };
    return { result, summary: `${measured.cut}: ${recipSummary(measured)}`, view: cleanupView(plane, value) };
  },
};
