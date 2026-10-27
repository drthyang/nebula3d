// current_view: what the user is looking at, the console's page and the cuts
// open in its viewers.

import { useDpdfStore } from "../../../state/dpdfStore";
import { useNavStore } from "../../../state/navStore";
import { AXIS_INDEX, AXIS_TO_PLANE, useViewerStore } from "../../../state/viewerStore";
import { datasetLabel, dpdfVolumeId, hklVolumeId, safe } from "../../context/loadContext";
import { roundSig } from "../../metrics/sliceStats";
import { dpdfMeta, planeLabel, recipMeta, recipRange } from "../shared/cuts";
import type { ChatTool } from "../types";

export const current_view: ChatTool = {
  name: "current_view",
  facts: { label: "Checked your view", acts: null, measures: false },
  description:
    "What the user is looking at: the console page and the cuts open in the reciprocal-space and ΔPDF viewers. Use it when the user says 'this', 'here' or 'what I'm looking at'.",
  parameters: { type: "object", properties: {} },
  run: async (_args, { dataset }) => {
    const { tab } = useNavStore.getState();
    const { fixedAxis, cutIndex } = useViewerStore.getState();
    const dp = useDpdfStore.getState();
    const [meta, dmeta] = await Promise.all([
      hklVolumeId(dataset) ? safe(recipMeta(dataset)) : null,
      dpdfVolumeId(dataset) ? safe(dpdfMeta(dataset)) : null,
    ]);
    const at = (r: [number, number], n: number, i: number) =>
      roundSig(n > 1 ? r[0] + Math.min(i, n - 1) * ((r[1] - r[0]) / (n - 1)) : r[0], 4);
    const ax = AXIS_INDEX[fixedAxis];
    const recipCut = meta ? at(recipRange(meta, ax), meta.shape[ax], cutIndex) : null;
    const dpdfCuts = dmeta
      ? { x: at(dmeta.x_range, dmeta.shape[0], dp.cutX), y: at(dmeta.y_range, dmeta.shape[1], dp.cutY), z: at(dmeta.z_range, dmeta.shape[2], dp.cutZ) }
      : null;
    const result = {
      page: tab,
      dataset: datasetLabel(dataset),
      reciprocal_cut: recipCut != null ? { plane: AXIS_TO_PLANE[fixedAxis], value: recipCut, label: planeLabel(AXIS_TO_PLANE[fixedAxis], recipCut) } : null,
      dpdf_cuts_A: dpdfCuts,
    };
    return { result, summary: `on ${tab}${result.reciprocal_cut ? `, ${result.reciprocal_cut.label}` : ""}` };
  },
};
