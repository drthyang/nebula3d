// dpdf_contrast: sets the 3D-ΔPDF viewer's colour limit, so the features carry
// the colour and the FFT ripple stays dim. It acts: what it sets is what the
// console shows.

import { fetchDpdfSlice } from "../../../api/client";
import { DPDF_AUTO_PERCENTILE, withoutOrigin } from "../../../components/dpdfLevels";
import { useDpdfStore } from "../../../state/dpdfStore";
import { dpdfVolumeId } from "../../context/loadContext";
import { SIGMA_OF } from "../../metrics/dpdf";
import { median, roundSig } from "../../metrics/sliceStats";
import { num } from "../shared/args";
import { dpdfMeta, dpdfView } from "../shared/cuts";
import { ToolArgError, type ChatTool } from "../types";

// The q-quantile of ascending magnitudes.
const quantileOf = (sorted: number[], q: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];

export const dpdf_contrast: ChatTool = {
  name: "dpdf_contrast",
  facts: {
    label: "Set the ΔPDF's contrast",
    // It sets the ΔPDF viewer's colour limit: what the console shows.
    acts: "view",
    invalidates: ["view"],
    offeredFor: ["pdf"],
  },
  description:
    "Optimise the 3D-ΔPDF viewer's colour range, so the pair-correlation features carry the colour and the FFT ripple around them stays dim. Call it once, without arguments: it measures the three centre sections (xy, xz, yz through the origin; the origin's self-correlation disk left out), sets the limit at the 99.9th percentile of |ΔPDF|, the page's Auto, and lists what the 99.5th and 99.97th percentiles would give without applying them. Pass percentile (99–99.99) or limit_sigma only for a range the user asks for: a limit of a few σ colours the ripple, as the old Auto (the 97th percentile) did. reset returns the viewer to Auto. Quote the applied limit it returns.",
  parameters: {
    type: "object",
    properties: {
      percentile: { type: "number", description: "Only when the user asks: percentile of |ΔPDF| for the limit, 99–99.99" },
      limit_sigma: { type: "number", description: "Only when the user asks: the ± limit in units of the sections' robust σ" },
      reset: { type: "boolean", description: "Return the viewer to Auto" },
    },
  },
  run: async (args, { dataset }) => {
    const meta = await dpdfMeta(dataset);
    const view = dpdfView(meta, "xy", 0);
    if (args.reset === true) {
      useDpdfStore.getState().setLimit(null);
      return { result: { applied: "Auto: the 99.9th percentile of |ΔPDF|" }, summary: "back on Auto", view };
    }
    const id = dpdfVolumeId(dataset)!;
    const sections = await Promise.all(["xy", "xz", "yz"].map((plane) => fetchDpdfSlice(id, plane, 0)));
    const values: number[] = [];
    for (const s of sections) for (const v of withoutOrigin(s)) if (Number.isFinite(v)) values.push(v);
    if (values.length < 16) throw new Error("the ΔPDF sections hold too few values to measure");
    const centre = median(values);
    const sigma = 1.4826 * median(values.map((v) => Math.abs(v - centre)));
    const mags = values.map(Math.abs).sort((a, b) => a - b);
    const strongest = mags[mags.length - 1];
    const inSigma = (x: number) => (sigma > 0 ? roundSig(x / sigma, 3) : null);
    const coloured = (limit: number) => {
      let n = 0;
      for (const m of mags) if (m >= 0.1 * limit) n += 1;
      return roundSig(n / mags.length, 2);
    };
    const describe = (limit: number) => ({
      limit: roundSig(limit, 3),
      limit_sigma: inSigma(limit),
      share_of_strongest: roundSig(limit / strongest, 2),
      coloured_fraction: coloured(limit), // |ΔPDF| above a tenth of the limit
    });
    const optimum = quantileOf(mags, DPDF_AUTO_PERCENTILE);
    let limit = optimum;
    let from = "optimised: the 99.9th percentile of |ΔPDF|";
    if (args.limit_sigma !== undefined) {
      const k = num(args, "limit_sigma");
      if (!(k > 0)) throw new ToolArgError("limit_sigma must be positive");
      if (!(sigma > 0)) throw new Error("the sections' robust σ is 0; give a percentile instead");
      limit = k * sigma;
      from = `${k} × the robust σ, as asked`;
    } else if (args.percentile !== undefined) {
      const p = num(args, "percentile");
      if (!(p >= 99 && p <= 99.99)) throw new ToolArgError("percentile must be within [99, 99.99]");
      limit = quantileOf(mags, p / 100);
      from = `the ${p}th percentile of |ΔPDF|, as asked`;
    }
    if (!(limit > 0)) throw new Error("the limit came out 0: the sections are empty");
    useDpdfStore.getState().setLimit({ value: limit, dataset: dataset.id });
    const applied = { ...describe(limit), from };
    return {
      result: {
        applied,
        ...(limit < 0.9 * optimum
          ? { note: "brighter than the optimum (the 99.9th percentile): the FFT ripple around the features will show" }
          : {}),
        robust_sigma: roundSig(sigma, 3),
        sigma_of: SIGMA_OF.centre,
        strongest_feature_sigma: inSigma(strongest),
        not_applied: {
          "99.5th percentile": { ...describe(quantileOf(mags, 0.995)), effect: "a lower limit: brighter, weaker correlations and more of the ripple coloured" },
          "99.97th percentile": { ...describe(quantileOf(mags, 0.9997)), effect: "a higher limit: dimmer, only the strongest features coloured" },
        },
        sections: "xy, xz and yz through the origin, the origin's disk left out",
      },
      summary: `± ${applied.limit} (${applied.limit_sigma ?? "–"}σ, ${applied.share_of_strongest} of the strongest feature) · ${roundSig(applied.coloured_fraction * 100, 2)} % coloured`,
      view,
    };
  },
};
