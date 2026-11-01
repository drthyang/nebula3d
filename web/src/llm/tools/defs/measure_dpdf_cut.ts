// measure_dpdf_cut: the 3D-ΔPDF's feature metrics on any real-space section,
// in that section's own robust σ (sigma_of says so), and what each means in a
// reply's first result (fields, shared/fields.ts: THY-63 R3).

import { SIGMA_OF } from "../../metrics/dpdf";
import { num, oneOf } from "../shared/args";
import { DPDF_PLANES, dpdfMeta, dpdfView, fieldsSent, measureDpdf } from "../shared/cuts";
import { DPDF_FIELDS } from "../shared/fields";
import type { ChatTool } from "../types";

export const measure_dpdf_cut: ChatTool = {
  name: "measure_dpdf_cut",
  facts: { label: "Measured a ΔPDF section", acts: null, offeredFor: ["pdf"], settles: ["features"], highlights: ["pdf"] },
  description:
    "Compute the 3D-ΔPDF feature metrics (feature SNR, strong-feature fraction, sign balance, anisotropy and its direction, radial trend) on any real-space section, in its own robust σ. A reply's first call also returns fields, what each one means.",
  parameters: {
    type: "object",
    properties: {
      plane: { type: "string", enum: DPDF_PLANES, description: "xy (cut along z), xz (cut along y), yz (cut along x); x ∥ a, y ∥ b, z ∥ c" },
      value: { type: "number", description: "Cut position along the fixed axis, in Å" },
    },
    required: ["plane", "value"],
  },
  run: async (args, ctx) => {
    const { dataset } = ctx;
    const plane = oneOf(args, "plane", DPDF_PLANES);
    const value = num(args, "value");
    const result = await measureDpdf(dataset, plane, value);
    const d = result.delta_pdf;
    // What the fields mean, once in a reply (arm C reads its definitions: call.ts).
    const fields = fieldsSent(ctx.replySteps, "measure_dpdf_cut") ? {} : { fields: DPDF_FIELDS.whole };
    return {
      result: { ...result, sigma_of: SIGMA_OF.section, ...fields },
      summary: `${result.cut}: SNR ${d.feature_snr ?? "–"}, anisotropy ${d.anisotropy_ratio ?? "–"}`,
      view: dpdfView(await dpdfMeta(dataset), plane, value),
    };
  },
};
