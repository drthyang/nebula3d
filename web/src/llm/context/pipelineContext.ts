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
import { metricFromUb, qNorm, reciprocalMetric } from "../../components/reciprocal";
import { backfillMetrics } from "../metrics/backfill";
import { dpdfMetrics } from "../metrics/dpdf";
import { FLATTEN_FIT_Q, flattenMetrics } from "../metrics/flatten";
import { ringMetrics } from "../metrics/rings";
import { scanLeftoverPeaks, summarizePeakProfile } from "../metrics/punch";
import type { RadiusFn } from "../metrics/sliceStats";

// The slices, keyed by pipeline stage, taken at one shared reciprocal cut (plus
// one real-space ΔPDF orthoslice).  Any of them may be absent.
export interface StageSlices {
  raw?: Slice | null;
  ringremoved?: Slice | null;
  braggpunched?: Slice | null;
  backfilled?: Slice | null;
  flattened?: Slice | null;
  dpdf?: Slice | null;
}

export interface BuildContextInput {
  datasetLabel: string;
  plane: string;
  cutValue: number;
  hklMeta?: VolumeMeta | null;
  dpdfMeta?: DeltaPdfMeta | null;
  braggProfile?: BraggProfile | null;
  consistency?: Pick<ConsistencyMetrics, "pearson_r" | "normalized_rms"> | null;
  slices: StageSlices;
  // The punch's indexing supercell, so leftover peaks are classed at a lattice
  // node or off-lattice against the right nodes (default 1×1×1).
  supercell?: [number, number, number];
  // The off-lattice search's protected H planes, so leftovers on them are told
  // from leftovers the search should have punched.
  protectedH?: { fractions: number[]; halfWidth: number };
}

export interface PipelineContext {
  dataset: string;
  reciprocal_plane: string;
  cut_value: number;
  lattice_A?: { a: number | null; b: number | null; c: number | null };
  cell_angles_deg?: { alpha: number; beta: number; gamma: number };
  grid?: number[];
  ring_removal?: ReturnType<typeof ringMetrics>;
  bragg_punch?: {
    leftover: ReturnType<typeof scanLeftoverPeaks>;
    peak_profile: ReturnType<typeof summarizePeakProfile>;
  };
  backfill?: ReturnType<typeof backfillMetrics>;
  flatten?: ReturnType<typeof flattenMetrics>;
  delta_pdf?: ReturnType<typeof dpdfMetrics>;
  notes?: string[];
}

// The in-plane (x, y) reciprocal axes of each plane alias, as H/K/L indices.
const PLANE_HKL_AXES: Record<string, [number, number]> = {
  hk0: [0, 1],
  h0l: [0, 2],
  "0kl": [1, 2],
};

// |Q| (Å⁻¹) of the point (x, y) r.l.u. on the reciprocal cut `plane` at `cut`,
// under the reciprocal metric G* (from the UB when present, else the cell), so
// a powder ring is one radius for any cell.  Undefined without a cell.
export const qRadius = (
  plane: string,
  cut: number,
  meta: Pick<VolumeMeta, "lattice" | "ub_matrix"> | null | undefined,
): RadiusFn | undefined => {
  const G = metricFromUb(meta?.ub_matrix) ?? reciprocalMetric(meta?.lattice);
  const axes = PLANE_HKL_AXES[plane];
  if (!G || !axes) return undefined;
  const [ix, iy] = axes;
  const hkl: [number, number, number] = [cut, cut, cut];
  return (x, y) => {
    hkl[ix] = x;
    hkl[iy] = y;
    return qNorm(G, hkl);
  };
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
  if (lat?.alpha != null && lat.beta != null && lat.gamma != null) {
    ctx.cell_angles_deg = { alpha: lat.alpha, beta: lat.beta, gamma: lat.gamma };
  }
  if (hklMeta?.shape) ctx.grid = hklMeta.shape;

  const radius = qRadius(plane, cutValue, hklMeta ?? (lat ? { lattice: lat } : null));

  // 1. Ring removal — raw vs ring-removed radial profiles.
  if (slices.raw || slices.ringremoved) {
    ctx.ring_removal = ringMetrics(slices.raw ?? null, slices.ringremoved ?? null, radius);
  } else {
    notes.push("ring removal: no raw/ring-removed slice available at this cut");
  }

  // 2. Bragg punch — leftover-peak scan on the punched slice + fitted profile.
  const punchSlice = slices.braggpunched;
  if (punchSlice || braggProfile) {
    const axes = PLANE_HKL_AXES[plane];
    const toHkl = axes
      ? (x: number, y: number): [number, number, number] => {
          const hkl: [number, number, number] = [cutValue, cutValue, cutValue];
          hkl[axes[0]] = x;
          hkl[axes[1]] = y;
          return hkl;
        }
      : undefined;
    ctx.bragg_punch = {
      leftover: punchSlice
        ? scanLeftoverPeaks(punchSlice, { toHkl, supercell: input.supercell, protectedH: input.protectedH })
        : { suspicious_peaks: [], n_suspicious: 0, n_skipped_noisy: 0, scan_sigma_threshold: 8 },
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

  // 4. Flatten — the per-|Q|-shell floors, backfilled vs flattened.
  if (slices.flattened) {
    ctx.flatten = flattenMetrics(slices.backfilled ?? null, slices.flattened, radius, radius ? FLATTEN_FIT_Q : undefined);
  }

  // 5. 3D-ΔPDF — feature/anisotropy/trend on the real-space orthoslice.
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
