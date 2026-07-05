// The seam where viewer state becomes LLM input.  Given the per-stage slices the
// app already fetches (plus the fitted Bragg profile, ΔPDF metadata, and
// consistency metrics), this builds the compact, budgeted JSON context the model
// reasons over.  Everything here is a pure function of already-fetched data — no
// React, no network — which keeps it the most testable part of the module and
// mirrors the metrics-compute-the-truth, LLM-narrates design.

import type {
  BraggProfile,
  ConsistencyMetrics,
  DeltaPdfMeta,
  Slice,
  VolumeMeta,
} from "../../api/types";
import { backfillMetrics } from "../metrics/backfill";
import { dpdfMetrics } from "../metrics/dpdf";
import { ringMetrics } from "../metrics/rings";
import { scanLeftoverPeaks, summarizePeakProfile } from "../metrics/punch";

// The slices, keyed by pipeline stage, taken at one shared reciprocal cut (plus
// one real-space ΔPDF orthoslice).  Any of them may be absent.
export interface StageSlices {
  raw?: Slice | null;
  ringremoved?: Slice | null;
  braggpunched?: Slice | null;
  backfilled?: Slice | null;
  dpdf?: Slice | null;
}

export interface BuildContextInput {
  datasetLabel: string;
  plane: string;
  cutValue: number;
  hklMeta?: VolumeMeta | null;
  dpdfMeta?: DeltaPdfMeta | null;
  braggProfile?: BraggProfile | null;
  consistency?: ConsistencyMetrics | null;
  slices: StageSlices;
}

export interface PipelineContext {
  dataset: string;
  reciprocal_plane: string;
  cut_value: number;
  lattice_A?: { a: number | null; b: number | null; c: number | null };
  grid?: number[];
  ring_removal?: ReturnType<typeof ringMetrics>;
  bragg_punch?: {
    leftover: ReturnType<typeof scanLeftoverPeaks>;
    peak_profile: ReturnType<typeof summarizePeakProfile>;
  };
  backfill?: ReturnType<typeof backfillMetrics>;
  delta_pdf?: ReturnType<typeof dpdfMetrics>;
  notes?: string[];
}

const TWO_PI = 2 * Math.PI;
const qScale = (latticeLen: number | null | undefined): number =>
  latticeLen && latticeLen > 0 ? TWO_PI / latticeLen : 1;

// Which lattice constants map to the in-plane x/y axes of a Mantid plane alias.
const planeAxisLattice = (
  plane: string,
  lat: { a: number | null; b: number | null; c: number | null },
): [number | null, number | null] => {
  switch (plane) {
    case "hk0":
      return [lat.a, lat.b];
    case "h0l":
      return [lat.a, lat.c];
    case "0kl":
      return [lat.b, lat.c];
    default:
      return [lat.a, lat.b];
  }
};

export const buildPipelineContext = (input: BuildContextInput): PipelineContext => {
  const { datasetLabel, plane, cutValue, hklMeta, dpdfMeta, braggProfile, consistency, slices } = input;
  const notes: string[] = [];
  const ctx: PipelineContext = {
    dataset: datasetLabel,
    reciprocal_plane: plane,
    cut_value: cutValue,
  };

  const lat = hklMeta?.lattice ?? dpdfMeta?.lattice;
  if (lat) ctx.lattice_A = { a: lat.a, b: lat.b, c: lat.c };
  if (hklMeta?.shape) ctx.grid = hklMeta.shape;

  const [latX, latY] = lat ? planeAxisLattice(plane, lat) : [null, null];
  const sx = qScale(latX);
  const sy = qScale(latY);

  // 1. Ring removal — raw vs ring-removed radial profiles.
  if (slices.raw || slices.ringremoved) {
    ctx.ring_removal = ringMetrics(slices.raw ?? null, slices.ringremoved ?? null, sx, sy);
  } else {
    notes.push("ring removal: no raw/ring-removed slice available at this cut");
  }

  // 2. Bragg punch — leftover-peak scan on the punched slice + fitted profile.
  const punchSlice = slices.braggpunched;
  if (punchSlice || braggProfile) {
    ctx.bragg_punch = {
      leftover: punchSlice
        ? scanLeftoverPeaks(punchSlice)
        : { suspicious_peaks: [], n_suspicious: 0, scan_sigma_threshold: 6, scan_contrast_threshold: 4 },
      peak_profile: summarizePeakProfile(braggProfile),
    };
    if (!punchSlice) notes.push("bragg punch: no punched slice at this cut; leftover-peak scan skipped");
  }

  // 3. Backfill — punched (holes) vs backfilled at the same cut.
  if (slices.braggpunched && slices.backfilled) {
    ctx.backfill = backfillMetrics(slices.braggpunched, slices.backfilled);
  } else {
    notes.push("backfill: needs both punched and backfilled slices at this cut");
  }

  // 4. 3D-ΔPDF — feature/anisotropy/trend on the real-space orthoslice.
  if (slices.dpdf) {
    ctx.delta_pdf = dpdfMetrics(slices.dpdf, { consistency: consistency ?? null });
  } else if (consistency) {
    ctx.delta_pdf = dpdfMetrics(null, { consistency });
    notes.push("delta pdf: no ΔPDF orthoslice; only back-FFT consistency reported");
  } else {
    notes.push("delta pdf: no ΔPDF slice available");
  }

  if (notes.length) ctx.notes = notes;
  return ctx;
};

export const CONTEXT_CHAR_BUDGET = 6000;

// Serialize the context, trimming the only unbounded field (the leftover-peak
// list) if the JSON overruns the budget — recorded, never silent.
export const contextToJson = (context: PipelineContext, budget = CONTEXT_CHAR_BUDGET): string => {
  let json = JSON.stringify(context, null, 1);
  if (json.length <= budget) return json;
  const peaks = context.bragg_punch?.leftover.suspicious_peaks;
  if (peaks && peaks.length > 3) {
    const trimmed: PipelineContext = {
      ...context,
      bragg_punch: context.bragg_punch
        ? {
            ...context.bragg_punch,
            leftover: {
              ...context.bragg_punch.leftover,
              suspicious_peaks: peaks.slice(0, 3),
            },
          }
        : undefined,
      notes: [...(context.notes ?? []), `leftover peaks truncated to 3 of ${peaks.length} for length`],
    };
    json = JSON.stringify(trimmed, null, 1);
  }
  return json;
};
