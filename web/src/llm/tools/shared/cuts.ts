// The cuts the tools measure and show: the reciprocal planes and the ΔPDF's
// real-space sections, the axis each is cut along and its label, the data's
// ranges a cut must sit in, and the figure a cut is drawn in (a ViewTarget,
// openView.ts). measureRecip and measureDpdf take the metrics at one cut, for
// measure_reciprocal_cut, measure_dpdf_cut and compare_datasets.

import { fetchDpdfMeta, fetchMeta } from "../../../api/client";
import type { Dataset, DeltaPdfMeta, VolumeMeta } from "../../../api/types";
import type { FixedAxis } from "../../../state/viewerStore";
import { dpdfVolumeId, hklVolumeId, loadPipelineContext, safe } from "../../context/loadContext";
import { roundSig } from "../../metrics/sliceStats";
import type { ViewTarget } from "../openView";
import { ToolArgError } from "../types";

export const RECIP_PLANES = ["hk0", "h0l", "0kl"] as const;
export const DPDF_PLANES = ["xy", "xz", "yz"] as const;
// The fixed (cut) axis of each plane, as an H/K/L or x/y/z index.
export const RECIP_FIXED: Record<string, 0 | 1 | 2> = { hk0: 2, h0l: 1, "0kl": 0 };
export const DPDF_FIXED: Record<string, 0 | 1 | 2> = { xy: 2, xz: 1, yz: 0 };
export const HKL = ["H", "K", "L"] as const;
export const XYZ = ["x", "y", "z"] as const;

export const planeLabel = (plane: string, value: number): string => {
  const v = roundSig(value, 4);
  if (plane in RECIP_FIXED) {
    const fixed = RECIP_FIXED[plane];
    const inPlane = HKL.filter((_a, i) => i !== fixed).join("–");
    return `${inPlane} plane at ${HKL[fixed]} = ${v}`;
  }
  const fixed = DPDF_FIXED[plane] ?? 2;
  const inPlane = XYZ.filter((_a, i) => i !== fixed).join("–");
  return `ΔPDF ${inPlane} section at ${XYZ[fixed]} = ${v} Å`;
};

export const recipRange = (meta: VolumeMeta, axis: number): [number, number] =>
  [meta.h_range, meta.k_range, meta.l_range][axis];
export const dpdfRange = (meta: DeltaPdfMeta, axis: number): [number, number] =>
  [meta.x_range, meta.y_range, meta.z_range][axis];

export const checkInRange = (name: string, value: number, range: [number, number]) => {
  const tol = 1e-6 * Math.max(1, Math.abs(range[1] - range[0]));
  if (value < range[0] - tol || value > range[1] + tol) {
    throw new ToolArgError(`${name} = ${value} is outside the data range [${roundSig(range[0], 4)}, ${roundSig(range[1], 4)}]`);
  }
};

export async function recipMeta(dataset: Dataset): Promise<VolumeMeta> {
  const id = hklVolumeId(dataset);
  const meta = id ? await safe(fetchMeta(id)) : null;
  if (!meta) throw new Error("this dataset has no reciprocal-space volume");
  return meta;
}

export async function dpdfMeta(dataset: Dataset): Promise<DeltaPdfMeta> {
  const id = dpdfVolumeId(dataset);
  const meta = id ? await safe(fetchDpdfMeta(id)) : null;
  if (!meta) throw new Error("this dataset has no 3D-ΔPDF yet");
  return meta;
}

// The figure a cut is drawn in: the cleanup page (every stage side by side)
// at a reciprocal plane, or the 3D-ΔPDF page at a real-space section, centred
// in the other two axes.
export const cleanupView = (plane: string, value: number): ViewTarget => ({
  view: "cleanup",
  plane,
  value,
  label: planeLabel(plane, value),
  axis: HKL[RECIP_FIXED[plane]] as FixedAxis,
});

export const dpdfView = (meta: DeltaPdfMeta, plane: string, value: number): ViewTarget => {
  const fixed = DPDF_FIXED[plane];
  const index = meta.shape.map((n, i) => {
    if (i !== fixed) return Math.floor(n / 2);
    const [lo, hi] = dpdfRange(meta, i);
    return n > 1 ? Math.round(((value - lo) / (hi - lo)) * (n - 1)) : 0;
  }) as [number, number, number];
  return { view: "dpdf", plane, value, label: planeLabel(plane, value), index };
};

// ---------------------------------------------------------------- measuring

export async function measureRecip(dataset: Dataset, plane: string, value: number) {
  const meta = await recipMeta(dataset);
  checkInRange(HKL[RECIP_FIXED[plane]], value, recipRange(meta, RECIP_FIXED[plane]));
  const { context } = await loadPipelineContext(dataset, { recip: { plane, value }, dpdf: null, records: false });
  return {
    cut: planeLabel(plane, value),
    ring_removal: context.ring_removal ?? null,
    bragg_punch_leftover: context.bragg_punch?.leftover ?? null,
    backfill: context.backfill ?? null,
    flatten: context.flatten ?? null,
    notes: (context.notes ?? []).filter((n) => !n.startsWith("delta pdf")),
  };
}

export async function measureDpdf(dataset: Dataset, plane: string, value: number) {
  const meta = await dpdfMeta(dataset);
  checkInRange(XYZ[DPDF_FIXED[plane]], value, dpdfRange(meta, DPDF_FIXED[plane]));
  const { context } = await loadPipelineContext(dataset, { recip: null, dpdf: { plane, value }, records: false });
  if (!context.delta_pdf) throw new Error("could not read that ΔPDF section");
  // The back-FFT check is volume-wide (consistency_details), not per section.
  const dpdf = { ...context.delta_pdf };
  delete dpdf.consistency_pearson_r;
  delete dpdf.consistency_normalized_rms;
  return { cut: planeLabel(plane, value), delta_pdf: dpdf };
}
