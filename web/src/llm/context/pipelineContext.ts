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
  FlattenSettings,
  ProtectedLabels,
  Slice,
  StageStatus,
  VolumeMeta,
} from "../../api/types";
import { metricFromUb, qNorm, reciprocalMetric } from "../../components/reciprocal";
import { withoutInference } from "../inference";
import { backfillMetrics } from "../metrics/backfill";
import { dpdfMetrics } from "../metrics/dpdf";
import { FLATTEN_UNRECORDED_NOTE, flattenJudging, flattenMetrics } from "../metrics/flatten";
import { ringMetrics } from "../metrics/rings";
import { scanLeftoverPeaks, summarizePeakProfile } from "../metrics/punch";
import { roundSig, type RadiusFn } from "../metrics/sliceStats";

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
  // What the run's search left alone, as labels on the punched cut's grid
  // (GET /api/modulation/{id}/labels: from the run's punch record, never from
  // the form), so leftovers there are told from leftovers the search should
  // have punched. Without it none is marked; a record from before the punch
  // kept it (`recorded` false) marks none, and a note says so.
  protectedLabels?: ProtectedLabels | null;
  // How many leftover peaks the scan lists, strongest first (default: the
  // scan's own, a few); the counts cover every one either way.
  leftoverTopK?: number;
  // The settings the flatten recorded in the flattened stage's file
  // (VolumeMeta.flatten_settings): its floors are judged over the run's own
  // fit range and at its floor percentile (flattenJudging). null: the file
  // records none (a note says so, and the defaults stand in); undefined: not
  // read, the defaults.
  flattenSettings?: FlattenSettings | null;
  // The dataset's stage outputs as its listing has them, for the summary a
  // model with tools starts from (summary, below). Without it, none is listed.
  stages?: readonly StageStatus[];
}

/**
 * What a model with tools starts from in place of the cut's metrics (THY-63
 * C1, docs/pilot-context-design.md): facts about the dataset as the request
 * found it, none measured on a slice. The context's other fields give the
 * dataset's name, cell and grid; these are the rest. Left out of the JSON a
 * model without tools reads (contextToJson), which stays as it was.
 */
export interface DatasetSummary {
  // The reciprocal grid's H, K and L ranges (r.l.u.), as describe_dataset rounds them.
  hkl_ranges?: [[number, number], [number, number], [number, number]];
  // The point group the raw volume declares its data were symmetrised with
  // (its name, else its number of operations); null when it declares none.
  symmetry?: string | null;
  // The Laue class a symmetrised export or a regrid's record declares for a
  // raw volume that declares none (VolumeMeta.declared_for).
  symmetry_declared_for?: string | null;
  // The stage outputs on disk, in the listing's order (describe_dataset's names).
  stages_on_disk?: string[];
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
  // With tools, the opening message is this and the fields above it, not the
  // cut's metrics (prompts/templates.ts); never in contextToJson.
  summary?: DatasetSummary;
}

/** Why no leftover is marked protected on a run whose punch record predates what its search left alone. */
export const UNRECORDED_PROTECTION_NOTE =
  "the punch's record does not say what its search left alone (a run from before it kept that), so no leftover is marked as in a protected position";

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

const range4 = (r: [number, number]): [number, number] => [roundSig(r[0], 4), roundSig(r[1], 4)];

/** The summary's facts, from the reciprocal volume's meta and the dataset's listing: each left out when not read. */
export function datasetSummary(meta: VolumeMeta | null | undefined, stages: readonly StageStatus[] | undefined): DatasetSummary {
  const summary: DatasetSummary = {};
  if (meta?.h_range && meta.k_range && meta.l_range) summary.hkl_ranges = [range4(meta.h_range), range4(meta.k_range), range4(meta.l_range)];
  if (meta) {
    summary.symmetry = meta.symmetry || (meta.symmetry_ops?.length ? `${meta.symmetry_ops.length} operations` : null);
    if (!summary.symmetry && meta.declared_for?.symmetry) summary.symmetry_declared_for = meta.declared_for.symmetry;
  }
  if (stages) summary.stages_on_disk = stages.filter((s) => s.exists).map((s) => s.name);
  return summary;
}

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
  ctx.summary = datasetSummary(hklMeta, input.stages);

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
    const labels = input.protectedLabels;
    const recorded = labels?.header.recorded !== false;
    ctx.bragg_punch = {
      leftover: punchSlice
        ? scanLeftoverPeaks(punchSlice, { toHkl, supercell: input.supercell, protectedLabels: recorded ? labels : null, topK: input.leftoverTopK })
        : { suspicious_peaks: [], n_suspicious: 0, n_skipped_noisy: 0, scan_sigma_threshold: 8 },
      peak_profile: summarizePeakProfile(braggProfile),
    };
    if (!punchSlice) notes.push("bragg punch: no punched slice at this cut; leftover-peak scan skipped");
    else if (labels && !recorded) notes.push(`bragg punch: ${UNRECORDED_PROTECTION_NOTE}`);
  }

  // 3. Backfill — punched (holes) vs backfilled at the same cut.
  if (slices.braggpunched && slices.backfilled) {
    ctx.backfill = backfillMetrics(slices.braggpunched, slices.backfilled);
  } else {
    notes.push("backfill: needs both punched and backfilled slices at this cut");
  }

  // 4. Flatten — the per-|Q|-shell floors, backfilled vs flattened, over the
  // run's own fit range and at its floor percentile (plan 4.11).
  if (slices.flattened) {
    const judging = flattenJudging(input.flattenSettings);
    ctx.flatten = flattenMetrics(slices.backfilled ?? null, slices.flattened, radius, radius ? (judging.fitQ ?? undefined) : undefined, judging.percentile);
    if (input.flattenSettings === null) notes.push(`flatten: ${FLATTEN_UNRECORDED_NOTE}`);
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
// list) if the JSON overruns the budget — recorded, never silent. With the
// skills off (the switch, skills.ts) its prose is its definitions only
// (inference.ts). The summary for a model with tools is not part of it.
export const contextToJson = (whole: PipelineContext, budget = CONTEXT_CHAR_BUDGET, { skills = true }: { skills?: boolean } = {}): string => {
  const { summary: _summary, ...context } = whole;
  void _summary;
  const shown = (c: PipelineContext): unknown => (skills ? c : withoutInference(c));
  let json = JSON.stringify(shown(context), null, 1);
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
    json = JSON.stringify(shown(trimmed), null, 1);
  }
  return json;
};
