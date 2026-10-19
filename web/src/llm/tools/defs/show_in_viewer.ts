// show_in_viewer: opens a cut in the console's viewer, for the user to see.

import { openView, type ViewTarget } from "../openView";
import { num, oneOf } from "../shared/args";
import {
  checkInRange,
  cleanupView,
  DPDF_FIXED,
  DPDF_PLANES,
  dpdfMeta,
  dpdfRange,
  dpdfView,
  HKL,
  RECIP_FIXED,
  RECIP_PLANES,
  recipMeta,
  recipRange,
  XYZ,
} from "../shared/cuts";
import type { ChatTool } from "../types";

export const show_in_viewer: ChatTool = {
  name: "show_in_viewer",
  facts: { label: "Opened the viewer", acts: "view", invalidates: ["view"] },
  description:
    "Open a cut in the console's viewer so the user can see what you are describing: view=cleanup opens the reciprocal-space cleanup page (all stages side by side) at a reciprocal plane; view=dpdf opens the 3D-ΔPDF page at a real-space section. Use it for the one cut that best shows your point.",
  parameters: {
    type: "object",
    properties: {
      view: { type: "string", enum: ["cleanup", "dpdf"] },
      plane: { type: "string", description: "hk0/h0l/0kl for cleanup; xy/xz/yz for dpdf" },
      value: { type: "number", description: "Cut position: r.l.u. for cleanup, Å for dpdf" },
    },
    required: ["view", "plane", "value"],
  },
  run: async (args, { dataset }) => {
    const view = oneOf(args, "view", ["cleanup", "dpdf"] as const);
    const value = num(args, "value");
    let target: ViewTarget;
    if (view === "cleanup") {
      const plane = oneOf(args, "plane", RECIP_PLANES);
      const meta = await recipMeta(dataset);
      checkInRange(HKL[RECIP_FIXED[plane]], value, recipRange(meta, RECIP_FIXED[plane]));
      target = cleanupView(plane, value);
    } else {
      const plane = oneOf(args, "plane", DPDF_PLANES);
      const meta = await dpdfMeta(dataset);
      checkInRange(XYZ[DPDF_FIXED[plane]], value, dpdfRange(meta, DPDF_FIXED[plane]));
      target = dpdfView(meta, plane, value);
    }
    openView(target);
    return { result: { opened: target.label }, summary: `Opened ${target.label}`, view: target };
  },
};
