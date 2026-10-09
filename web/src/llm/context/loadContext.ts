// Fetches what a PipelineContext is built from — one reciprocal cut through
// every cleanup stage, one ΔPDF section, and the run's saved records — and folds
// it in.  Every fetch is independent and failure-tolerant: a missing stage just
// omits its metrics.  The opening context uses the default cuts; the assistant's
// tools ask for any other.

import {
  fetchBraggProfile,
  fetchConsistencyCheck,
  fetchDpdfMeta,
  fetchDpdfSlice,
  fetchMeta,
  fetchSlice,
} from "../../api/client";
import type { Dataset } from "../../api/types";
import { buildPipelineContext, type PipelineContext, type StageSlices } from "./pipelineContext";

export interface Cut {
  plane: string;
  value: number;
}

// The L=0 plane through the origin, where rings, punched peaks and diffuse are
// all most visible, and the z=0 real-space plane through the origin.
export const DEFAULT_RECIP_CUT: Cut = { plane: "hk0", value: 0 };
export const DEFAULT_DPDF_CUT: Cut = { plane: "xy", value: 0 };

// The reciprocal-space stage volumes, in pipeline order.
export const RECIP_STAGES = ["raw", "ringremoved", "braggpunched", "backfilled", "flattened"] as const;
export type RecipStage = (typeof RECIP_STAGES)[number];

export const safe = async <T>(p: Promise<T>): Promise<T | null> => {
  try {
    return await p;
  } catch {
    return null;
  }
};

export const stageVolumeId = (dataset: Dataset, name: string): string | undefined =>
  dataset.stages.find((s) => s.name === name && s.exists)?.volume_id;

export const hklVolumeId = (dataset: Dataset): string | undefined =>
  stageVolumeId(dataset, "raw") ?? dataset.stages.find((s) => s.kind === "hkl" && s.exists)?.volume_id;

export const dpdfVolumeId = (dataset: Dataset): string | undefined =>
  dataset.stages.find((s) => s.kind === "delta_pdf" && s.exists)?.volume_id;

export const datasetLabel = (dataset: Dataset): string => dataset.temperature ?? dataset.stem ?? dataset.id;

// The context plus the raw fetched slices/metadata, so the UI can also render a
// slice image for the vision path without re-fetching.
export interface AssistantContext {
  context: PipelineContext;
  slices: StageSlices;
  lattice: { a: number | null; b: number | null; c: number | null } | null;
}

export interface LoadOptions {
  recip?: Cut | null; // null skips the reciprocal stages
  dpdf?: Cut | null; // null skips the ΔPDF section
  records?: boolean; // the fitted Bragg profile and the back-FFT check (default true)
}

export async function loadPipelineContext(
  dataset: Dataset,
  { recip = DEFAULT_RECIP_CUT, dpdf = DEFAULT_DPDF_CUT, records = true }: LoadOptions = {},
): Promise<AssistantContext> {
  const hklVolId = hklVolumeId(dataset);
  const dpdfVolId = dpdfVolumeId(dataset);

  const hklMeta = hklVolId ? await safe(fetchMeta(hklVolId)) : null;
  const dpdfMeta = dpdfVolId ? await safe(fetchDpdfMeta(dpdfVolId)) : null;

  const getRecip = (name: RecipStage) => {
    const id = stageVolumeId(dataset, name);
    return id && recip ? safe(fetchSlice(id, recip.plane, recip.value)) : Promise.resolve(null);
  };

  const [raw, ringremoved, braggpunched, backfilled, flattened, dpdfSlice, braggProfile, consistencyCheck] =
    await Promise.all([
      getRecip("raw"),
      getRecip("ringremoved"),
      getRecip("braggpunched"),
      getRecip("backfilled"),
      getRecip("flattened"),
      dpdfVolId && dpdf ? safe(fetchDpdfSlice(dpdfVolId, dpdf.plane, dpdf.value)) : Promise.resolve(null),
      records ? safe(fetchBraggProfile(dataset.id)) : Promise.resolve(null),
      // The run's own back-FFT check, not the consistency viewer's recompute:
      // it is a file read, and it describes the ΔPDF the context reports on.
      records && dpdfVolId ? safe(fetchConsistencyCheck(dataset.id)) : Promise.resolve(null),
    ]);

  const slices: StageSlices = { raw, ringremoved, braggpunched, backfilled, flattened, dpdf: dpdfSlice };

  const context = buildPipelineContext({
    datasetLabel: datasetLabel(dataset),
    plane: recip?.plane ?? DEFAULT_RECIP_CUT.plane,
    cutValue: recip?.value ?? DEFAULT_RECIP_CUT.value,
    hklMeta,
    dpdfMeta,
    braggProfile,
    consistency: consistencyCheck?.metrics ?? null,
    slices,
  });

  return { context, slices, lattice: hklMeta?.lattice ?? dpdfMeta?.lattice ?? null };
}
