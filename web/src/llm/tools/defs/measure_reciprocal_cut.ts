// measure_reciprocal_cut: the stage-quality metrics of one reciprocal-space
// cut. Its catalogue says what each field means: the system prompt's glossary
// for a model without tools (prompts/system.ts, SYSTEM), tersely, for a model
// with tools, whose context holds no cut (THY-63 C1).

import { evidence, reading } from "../../inference";
import { PEDESTAL_LIMIT } from "../../metrics/flatten";
import { FLATTEN_FLOOR_SIGMA_NOTE, PEDESTAL_SHELLS, PEDESTAL_WHERE } from "../../verdicts/rules";
import { RECIP } from "../facts";
import { num, oneOf } from "../shared/args";
import { cleanupView, measureRecip, RECIP_PLANES } from "../shared/cuts";
import { described, description } from "../shared/describe";
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
    description("measure_reciprocal_cut")`Compute the stage-quality metrics (ring removal, leftover Bragg peaks, backfill seams, flatten floors) on any reciprocal-space cut: one cut, not the volume.${reading(" Use it to check whether a finding holds on other planes or off-zero cuts (e.g. L=0.5, or K=1/3 for satellites).")}
Fields. ring_removal: ring_energy_ratio, after/before share of the radial profile in ring bumps (diffuse keeps it above 0: 0.4–0.5 can be ring-free); over_subtraction_fraction, after_negative_fraction: voxels driven negative (a few percent is noise); ring_residuals per raw ring: residual_fraction against the diffuse beside it (negative a dent, positive a ring left), significant beyond 3 × noise_fraction. bragg_punch_leftover: sharp peaks the punch missed on this cut, not what its search found: n_at_nodes, missed Bragg peaks; n_off_nodes, off the lattice (on_protected_plane: kept by design); n_broad_off_nodes, FWHM ≥ 5 voxels${evidence(": diffuse maxima, signal")}. backfill: median_seam_sigma, |fill − rim| in σ (≲ 1 seamless); checkerboard_fraction, 0.5 random${evidence(", near 1 an artefact")}. flatten: floor_before, floor_after: shell floors by third of |Q|; after_negative_fraction ≈ 0.25 by construction; floor_trend, floor_span_fraction over ${PEDESTAL_SHELLS} (floor_judged_q): both ${PEDESTAL_LIMIT} or more is a pedestal (the verdict reads ${PEDESTAL_WHERE} floors); after_floor_max_sigma is ${FLATTEN_FLOOR_SIGMA_NOTE}.`,
  ),
  parameters: {
    type: "object",
    properties: {
      plane: { type: "string", enum: RECIP_PLANES, description: "hk0: H–K plane (fixed L), h0l: H–L (fixed K), 0kl: K–L (fixed H)" },
      value: { type: "number", description: "Cut position along the fixed axis, in r.l.u." },
    },
    required: ["plane", "value"],
  },
  run: async (args, { dataset }) => {
    const plane = oneOf(args, "plane", RECIP_PLANES);
    const value = num(args, "value");
    const result = await measureRecip(dataset, plane, value);
    return { result, summary: `${result.cut}: ${recipSummary(result)}`, view: cleanupView(plane, value) };
  },
};
