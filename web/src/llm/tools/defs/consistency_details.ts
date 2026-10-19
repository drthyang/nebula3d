// consistency_details: the run's saved back-FFT check in full.

import { fetchConsistencyCheck } from "../../../api/client";
import { safe } from "../../context/loadContext";
import { evidence } from "../../inference";
import { described, description } from "../shared/describe";
import { r4, r6 } from "../shared/figures";
import type { ChatTool } from "../types";

export const consistency_details: ChatTool = {
  name: "consistency_details",
  facts: { label: "Read the back-FFT check", acts: null, offeredFor: ["pdf"], highlights: ["check"] },
  ...described(
    description("consistency_details")`The run's saved back-FFT check in full: Pearson r and normalised RMS of the inverse-FFT ΔPDF against the cleaned data, r per principal plane, the |Q| and r bands, crop and apodization. The transform keeps the real part, which is the data's even part under Q → −Q: pearson_r_even compares the round trip with that part and is 1 when the transform is sound, while r against the data is limited by the odd part (odd_share: counting noise on unsymmetrised data)${evidence(", so r below 1 on unsymmetrised data is no fault")}. Neither says a feature is real.`,
  ),
  parameters: { type: "object", properties: {} },
  run: async (_args, { dataset }) => {
    const check = await safe(fetchConsistencyCheck(dataset.id));
    if (!check?.has_check || !check.metrics) {
      return { result: { has_check: false }, summary: "no back-FFT check saved for this ΔPDF" };
    }
    const m = check.metrics;
    const result = {
      ...m,
      pearson_r: r4(m.pearson_r),
      normalized_rms: r4(m.normalized_rms),
      per_plane_r: Object.fromEntries(Object.entries(m.per_plane_r ?? {}).map(([k, v]) => [k, r4(v)])),
      ...(m.pearson_r_even !== undefined
        ? {
            pearson_r_even: r6(m.pearson_r_even),
            normalized_rms_even: r4(m.normalized_rms_even),
            odd_share: r4(m.odd_share),
          }
        : {}),
    };
    return {
      result,
      summary:
        `r = ${result.pearson_r}, normalised RMS = ${result.normalized_rms}` +
        (result.pearson_r_even != null ? `; against the even part r = ${result.pearson_r_even} (odd share ${result.odd_share})` : ""),
      view: { view: "consistency", label: "the back-FFT check" },
    };
  },
};
