// compare_datasets: the same cut measured on several datasets (e.g.
// temperatures), side by side.

import { fetchConsistencyCheck } from "../../../api/client";
import { datasetLabel, safe } from "../../context/loadContext";
import { SIGMA_OF } from "../../metrics/dpdf";
import { num, oneOf } from "../shared/args";
import { DPDF_PLANES, measureDpdf, measureRecip, planeLabel, RECIP_PLANES } from "../shared/cuts";
import { r4 } from "../shared/figures";
import { ToolArgError, type ChatTool } from "../types";

export const compare_datasets: ChatTool = {
  name: "compare_datasets",
  facts: { label: "Compared datasets", acts: null, offeredFor: ["compare"] },
  description:
    "The same cut measured on several datasets (e.g. temperatures), to see what changes between them. kind=reciprocal compares the stage metrics; kind=dpdf compares the ΔPDF feature metrics and back-FFT r. Up to 6 datasets; default all.",
  parameters: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["reciprocal", "dpdf"] },
      plane: { type: "string", description: "hk0/h0l/0kl for reciprocal; xy/xz/yz for dpdf" },
      value: { type: "number", description: "Cut position (r.l.u. or Å)" },
      dataset_ids: { type: "array", items: { type: "string" }, description: "From describe_dataset; default all" },
    },
    required: ["kind", "plane", "value"],
  },
  run: async (args, { datasets }) => {
    const kind = oneOf(args, "kind", ["reciprocal", "dpdf"] as const);
    const plane = kind === "reciprocal" ? oneOf(args, "plane", RECIP_PLANES) : oneOf(args, "plane", DPDF_PLANES);
    const value = num(args, "value");
    const ids = Array.isArray(args.dataset_ids) ? args.dataset_ids.map(String) : null;
    const picked = (ids ? datasets.filter((d) => ids.includes(d.id)) : datasets).slice(0, 6);
    if (!picked.length) throw new ToolArgError(`no matching datasets; choose from ${datasets.map((d) => d.id).join(", ")}`);
    const rows = await Promise.all(
      picked.map(async (d) => {
        try {
          if (kind === "reciprocal") {
            const m = await measureRecip(d, plane, value);
            return {
              dataset: datasetLabel(d, datasets),
              ring_energy_ratio: m.ring_removal?.ring_energy_ratio ?? null,
              over_subtraction_fraction: m.ring_removal?.over_subtraction_fraction ?? null,
              leftover_peaks: m.bragg_punch_leftover?.n_suspicious ?? null,
              backfill_median_seam_sigma: m.backfill?.median_seam_sigma ?? null,
              flatten_floor_after: m.flatten?.floor_after ?? null,
              flatten_floor_max_sigma: m.flatten?.after_floor_max_sigma ?? null,
            };
          }
          const [m, check] = await Promise.all([measureDpdf(d, plane, value), safe(fetchConsistencyCheck(d.id))]);
          const p = m.delta_pdf;
          return {
            dataset: datasetLabel(d, datasets),
            feature_snr: p.feature_snr,
            strong_feature_fraction: p.strong_feature_fraction,
            positive_fraction: p.positive_fraction,
            anisotropy_ratio: p.anisotropy_ratio,
            anisotropy_angle_deg: p.anisotropy_angle_deg,
            radial_trend: p.radial_trend,
            back_fft_r: check?.metrics ? r4(check.metrics.pearson_r) : null,
          };
        } catch (e) {
          return { dataset: datasetLabel(d, datasets), error: (e as Error).message };
        }
      }),
    );
    // Each dataset's feature_snr is in its own section's σ.
    const sigma = kind === "dpdf" ? { sigma_of: SIGMA_OF.datasets } : {};
    return { result: { cut: planeLabel(plane, value), ...sigma, rows }, summary: `${planeLabel(plane, value)} on ${rows.length} datasets` };
  },
};
