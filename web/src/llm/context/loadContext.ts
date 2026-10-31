// Fetches what a PipelineContext is built from — one reciprocal cut through
// every cleanup stage, one ΔPDF section, and the run's saved records — and folds
// it in.  Every fetch is independent and failure-tolerant: a missing stage just
// omits its metrics.  The opening context uses the default cuts; the assistant's
// tools ask for any other.  What the punch's search left alone comes from the
// run itself, its punch record read as labels on the cut, never from the form:
// the leftovers' marks are the run's.

import {
  fetchBraggProfile,
  fetchConsistencyCheck,
  fetchDpdfMeta,
  fetchDpdfSlice,
  fetchMeta,
  fetchProtectedLabels,
  fetchSlice,
} from "../../api/client";
import type { Dataset, FlattenSettings, VolumeMeta } from "../../api/types";
import { usePipelineStore } from "../../state/pipelineStore";
import { buildPipelineContext, type PipelineContext, type StageSlices } from "./pipelineContext";
import { datasetName } from "../../api/datasetName";

// The punch's indexing supercell as the Configure page has it (blank = 1).
const punchSupercell = (): [number, number, number] => {
  const s = usePipelineStore.getState();
  return [s.punchSupercellH, s.punchSupercellK, s.punchSupercellL].map((v) => Number(v) || 1) as [number, number, number];
};

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

/**
 * The meta that declares the point group the data at `stage`'s output were
 * symmetrised with: that output's own, or for "delta_pdf" the output it was
 * made from (its recorded source). A stage output declares the symmetry its
 * data carry when the run applied one (the symmetry average's, and every
 * stage after it). Else the raw volume's: a NeXus Viewer export declares its
 * own, and outputs written before stages declared it declare none. null when
 * none is read.
 */
export async function declaringMeta(dataset: Dataset, stage: string): Promise<VolumeMeta | null> {
  const name = stage === "delta_pdf" ? dataset.stages.find((s) => s.name === "delta_pdf")?.source : stage;
  const id = name && name !== "raw" ? stageVolumeId(dataset, name) : undefined;
  const own = id ? await safe(fetchMeta(id)) : null;
  if (own?.symmetry_ops?.length) return own;
  const rawId = stageVolumeId(dataset, "raw") ?? hklVolumeId(dataset);
  return (rawId ? await safe(fetchMeta(rawId)) : null) ?? own;
}

// The short name the assistant uses; with `all`, two datasets at one
// temperature are told apart (see api/datasetName).
export const datasetLabel = (dataset: Dataset, all: readonly Dataset[] = []): string => datasetName(dataset, all);

// The context plus the raw fetched slices/metadata, so the UI can also render a
// slice image for the vision path without re-fetching.
export interface AssistantContext {
  context: PipelineContext;
  slices: StageSlices;
  lattice: { a: number | null; b: number | null; c: number | null } | null;
}

/** What the flatten recorded in its output, as a caller read it: `settings` null when the file records none, undefined when unknown. */
export interface FlattenRecord {
  settings: FlattenSettings | null | undefined;
}

export interface LoadOptions {
  recip?: Cut | null; // null skips the reciprocal stages
  dpdf?: Cut | null; // null skips the ΔPDF section
  records?: boolean; // the fitted Bragg profile and the back-FFT check (default true)
  // Every leftover peak the punch's scan finds, not only the strongest few the
  // model reads: the punch's evaluation counts them by their marks (tune/evaluate.ts).
  allLeftovers?: boolean;
  // What the flatten recorded, when the caller read it once for several cuts
  // (tune/evaluate.ts); without it, read here from the flattened stage's meta.
  flattenRecord?: FlattenRecord;
}

/**
 * What the flatten recorded in the flattened stage's file (VolumeMeta.flatten_settings),
 * the run's own fit range and floor percentile among them: null when it records
 * none, undefined when there is no flattened stage or its meta does not say.
 */
export async function readFlattenRecord(dataset: Dataset): Promise<FlattenRecord> {
  const id = stageVolumeId(dataset, "flattened");
  const meta = id ? await safe(fetchMeta(id)) : null;
  return { settings: meta?.flatten_settings };
}

export async function loadPipelineContext(
  dataset: Dataset,
  { recip = DEFAULT_RECIP_CUT, dpdf = DEFAULT_DPDF_CUT, records = true, allLeftovers = false, flattenRecord }: LoadOptions = {},
): Promise<AssistantContext> {
  const hklVolId = hklVolumeId(dataset);
  const dpdfVolId = dpdfVolumeId(dataset);

  const hklMeta = hklVolId ? await safe(fetchMeta(hklVolId)) : null;
  // The flatten's record, for its floors over the run's own range (plan 4.11):
  // only where the cut reaches the flattened stage.
  const flatten = flattenRecord ?? (recip && stageVolumeId(dataset, "flattened") ? await readFlattenRecord(dataset) : { settings: undefined });
  const dpdfMeta = dpdfVolId ? await safe(fetchDpdfMeta(dpdfVolId)) : null;

  const getRecip = (name: RecipStage) => {
    const id = stageVolumeId(dataset, name);
    return id && recip ? safe(fetchSlice(id, recip.plane, recip.value)) : Promise.resolve(null);
  };

  const [raw, ringremoved, braggpunched, backfilled, flattened, dpdfSlice, braggProfile, consistencyCheck, protectedLabels] =
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
      // What the run's search left alone, on the punched cut's own grid.
      recip && stageVolumeId(dataset, "braggpunched") ? safe(fetchProtectedLabels(dataset.id, recip.plane, recip.value)) : Promise.resolve(null),
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
    supercell: punchSupercell(),
    protectedLabels,
    ...(allLeftovers ? { leftoverTopK: Infinity } : {}),
    flattenSettings: flatten.settings,
  });

  return { context, slices, lattice: hklMeta?.lattice ?? dpdfMeta?.lattice ?? null };
}
