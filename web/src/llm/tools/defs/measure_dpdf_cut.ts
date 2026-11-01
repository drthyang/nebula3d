// measure_dpdf_cut: the 3D-ΔPDF's feature metrics on any real-space section,
// in that section's own robust σ (sigma_of says so).

import { evidence } from "../../inference";
import { SIGMA_OF } from "../../metrics/dpdf";
import { num, oneOf } from "../shared/args";
import { DPDF_PLANES, dpdfMeta, dpdfView, measureDpdf } from "../shared/cuts";
import { described, description } from "../shared/describe";
import type { ChatTool } from "../types";

export const measure_dpdf_cut: ChatTool = {
  name: "measure_dpdf_cut",
  facts: { label: "Measured a ΔPDF section", acts: null, offeredFor: ["pdf"], settles: ["features"], highlights: ["pdf"] },
  // What each field means, the system prompt's glossary for a model without
  // tools (prompts/system.ts, SYSTEM), tersely (THY-63 C1).
  ...described(
    description("measure_dpdf_cut")`The 3D-ΔPDF feature metrics on any real-space section, in its own robust σ outside the origin's disk: feature_snr, the strongest feature over background σ${evidence(" (≳ 5 is clear signal)")}; strong_feature_fraction, voxels beyond 5σ; positive_fraction (0.5: balanced ±); anisotropy_ratio (1 isotropic, above ~1.5 rods or sheets) and anisotropy_angle_deg in the plane; radial_trend, mean |ΔPDF| in inner, middle and outer shells.`,
  ),
  parameters: {
    type: "object",
    properties: {
      plane: { type: "string", enum: DPDF_PLANES, description: "xy (cut along z), xz (cut along y), yz (cut along x); x ∥ a, y ∥ b, z ∥ c" },
      value: { type: "number", description: "Cut position along the fixed axis, in Å" },
    },
    required: ["plane", "value"],
  },
  run: async (args, { dataset }) => {
    const plane = oneOf(args, "plane", DPDF_PLANES);
    const value = num(args, "value");
    const result = await measureDpdf(dataset, plane, value);
    const d = result.delta_pdf;
    return {
      result: { ...result, sigma_of: SIGMA_OF.section },
      summary: `${result.cut}: SNR ${d.feature_snr ?? "–"}, anisotropy ${d.anisotropy_ratio ?? "–"}`,
      view: dpdfView(await dpdfMeta(dataset), plane, value),
    };
  },
};
