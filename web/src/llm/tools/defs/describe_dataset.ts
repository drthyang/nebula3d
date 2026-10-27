// describe_dataset: the selected dataset's stage outputs, grids, ranges and
// cell, and the other datasets compare_datasets can read.

import { fetchDpdfMeta, fetchMeta } from "../../../api/client";
import { datasetLabel, dpdfVolumeId, hklVolumeId, safe } from "../../context/loadContext";
import { DPDF_PLANES, RECIP_PLANES } from "../shared/cuts";
import { r4, range4 } from "../shared/figures";
import type { ChatTool } from "../types";

export const describe_dataset: ChatTool = {
  name: "describe_dataset",
  facts: { label: "Read the dataset", acts: null, measures: false },
  description:
    "The selected dataset: which stage outputs exist, the reciprocal grid and its H/K/L ranges, the unit cell, the ΔPDF grid and x/y/z ranges, and the other datasets (e.g. other temperatures) available for compare_datasets.",
  parameters: { type: "object", properties: {} },
  run: async (_args, { dataset, datasets }) => {
    const hklId = hklVolumeId(dataset);
    const dId = dpdfVolumeId(dataset);
    const [meta, dmeta] = await Promise.all([
      hklId ? safe(fetchMeta(hklId)) : null,
      dId ? safe(fetchDpdfMeta(dId)) : null,
    ]);
    const stages = dataset.stages.filter((s) => s.exists).map((s) => s.name);
    const result = {
      dataset: datasetLabel(dataset, datasets),
      id: dataset.id,
      stages,
      reciprocal: meta && {
        grid: meta.shape,
        H: range4(meta.h_range),
        K: range4(meta.k_range),
        L: range4(meta.l_range),
        planes: RECIP_PLANES,
      },
      cell: meta?.lattice ?? dmeta?.lattice ?? null,
      // Whether σ came with the data; the note says when √|I| makes the
      // punch's significance test count nothing fixed.
      sigma: meta?.sigma ?? null,
      ...(meta?.sigma_note ? { sigma_note: meta.sigma_note } : {}),
      delta_pdf: dmeta && {
        grid: dmeta.shape,
        x: range4(dmeta.x_range),
        y: range4(dmeta.y_range),
        z: range4(dmeta.z_range),
        q_max: r4(dmeta.q_max),
        planes: DPDF_PLANES,
      },
      other_datasets: datasets.filter((d) => d.id !== dataset.id).map((d) => ({ id: d.id, label: datasetLabel(d, datasets) })),
    };
    return { result, summary: `${result.dataset}: ${stages.join(", ")}` };
  },
};
