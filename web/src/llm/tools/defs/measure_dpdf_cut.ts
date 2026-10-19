// measure_dpdf_cut: the 3D-ΔPDF's feature metrics on any real-space section.

import { num, oneOf } from "../shared/args";
import { DPDF_PLANES, dpdfMeta, dpdfView, measureDpdf } from "../shared/cuts";
import type { ChatTool } from "../types";

export const measure_dpdf_cut: ChatTool = {
  name: "measure_dpdf_cut",
  facts: { label: "Measured a ΔPDF section", acts: null, offeredFor: ["pdf"], settles: ["features"], highlights: ["pdf"] },
  description:
    "Compute the 3D-ΔPDF feature metrics (feature SNR, strong-feature fraction, sign balance, anisotropy and its direction, radial trend) on any real-space section. The opening context used only z=0.",
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
      result,
      summary: `${result.cut}: SNR ${d.feature_snr ?? "–"}, anisotropy ${d.anisotropy_ratio ?? "–"}`,
      view: dpdfView(await dpdfMeta(dataset), plane, value),
    };
  },
};
