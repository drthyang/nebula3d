// The assistant's tools: functions the model may call mid-answer to measure,
// look up or show something, instead of reasoning only from the one default
// cut it was handed.  Each validates its arguments (a model can send anything),
// reads through the same API the viewers use, and returns compact JSON.  Two
// act instead of reading: update_settings edits the Configure page and
// run_pipeline runs it, as the Run button does; show_in_viewer only moves the
// console's view.

import {
  fetchBraggProfile,
  fetchConsistencyCheck,
  fetchDataset,
  fetchDpdfMeta,
  fetchDpdfSlice,
  fetchMeta,
  fetchSlice,
} from "../../api/client";
import type { Dataset, DeltaPdfMeta, JobEvent, Slice, VolumeMeta } from "../../api/types";
import { useDpdfStore } from "../../state/dpdfStore";
import { useNavStore } from "../../state/navStore";
import {
  enabledStages,
  STAGE_LABELS,
  STAGES,
  usePipelineStore,
  type PipelineConfig,
} from "../../state/pipelineStore";
import { loadSettings } from "../settings";
import {
  displayValue,
  SAMPLE_PARAMS,
  TUNE_PARAMS,
  TUNE_STAGE_LABELS,
  TUNE_STAGES,
  toFormValue,
  type TuneParam,
  type TuneStage,
} from "../tune/catalog";
import { evaluateStage, headline } from "../tune/evaluate";
import { STAGE_GOALS } from "../tune/prompts";
import { startTuning, stopTuning, useTuneStore, type StageRun } from "../tune/tuner";
import { AXIS_INDEX, AXIS_TO_PLANE, useViewerStore, type FixedAxis } from "../../state/viewerStore";
import {
  datasetLabel,
  dpdfVolumeId,
  hklVolumeId,
  loadPipelineContext,
  RECIP_STAGES,
  safe,
  stageVolumeId,
} from "../context/loadContext";
import { qRadius } from "../context/pipelineContext";
import type { ToolCall, ToolSpec } from "../provider/client";
import { openView, type ViewTarget } from "./openView";

export type { ViewTarget } from "./openView";
import { COVERAGE_SHELLS, coverageMetrics } from "../metrics/coverage";
import { median, radialProfile, roundSig } from "../metrics/sliceStats";
import { textureMetrics } from "../metrics/texture";

// The dataset the tools read.  run_pipeline replaces `dataset` with its fresh
// listing after a run, so the tools called after it see the new outputs.
export interface ToolContext {
  dataset: Dataset;
  datasets: Dataset[];
}


export interface ToolOutcome {
  result: unknown;
  summary: string; // one line for the transcript
  view?: ViewTarget;
}

// What a long tool gets besides its arguments: the reply's abort signal, and a
// live line for its transcript step while it runs.
export interface ToolIO {
  signal?: AbortSignal;
  progress?: (text: string) => void;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema of the arguments
  run: (args: Record<string, unknown>, ctx: ToolContext, io: ToolIO) => Promise<ToolOutcome>;
}

/** Bad arguments: the message goes back to the model so it can correct itself. */
export class ToolArgError extends Error {}

type Args = Record<string, unknown>;

const oneOf = <T extends string>(args: Args, key: string, allowed: readonly T[], fallback?: T): T => {
  const v = args[key];
  if (v === undefined && fallback !== undefined) return fallback;
  if (typeof v === "string" && (allowed as readonly string[]).includes(v)) return v as T;
  throw new ToolArgError(`${key} must be one of ${allowed.join(", ")}; got ${JSON.stringify(v)}`);
};

const num = (args: Args, key: string, fallback?: number): number => {
  const v = args[key] ?? fallback;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new ToolArgError(`${key} must be a number; got ${JSON.stringify(args[key])}`);
  }
  return n;
};

const r4 = (v: number | null | undefined): number | null => (v == null ? null : roundSig(v, 4));
const range4 = (r: [number, number]): [number, number] => [roundSig(r[0], 4), roundSig(r[1], 4)];

const RECIP_PLANES = ["hk0", "h0l", "0kl"] as const;
const DPDF_PLANES = ["xy", "xz", "yz"] as const;
// The fixed (cut) axis of each plane, as an H/K/L or x/y/z index.
const RECIP_FIXED: Record<string, 0 | 1 | 2> = { hk0: 2, h0l: 1, "0kl": 0 };
const DPDF_FIXED: Record<string, 0 | 1 | 2> = { xy: 2, xz: 1, yz: 0 };
const HKL = ["H", "K", "L"] as const;
const XYZ = ["x", "y", "z"] as const;

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

const recipRange = (meta: VolumeMeta, axis: number): [number, number] =>
  [meta.h_range, meta.k_range, meta.l_range][axis];
const dpdfRange = (meta: DeltaPdfMeta, axis: number): [number, number] =>
  [meta.x_range, meta.y_range, meta.z_range][axis];

const checkInRange = (name: string, value: number, range: [number, number]) => {
  const tol = 1e-6 * Math.max(1, Math.abs(range[1] - range[0]));
  if (value < range[0] - tol || value > range[1] + tol) {
    throw new ToolArgError(`${name} = ${value} is outside the data range [${roundSig(range[0], 4)}, ${roundSig(range[1], 4)}]`);
  }
};

async function recipMeta(dataset: Dataset): Promise<VolumeMeta> {
  const id = hklVolumeId(dataset);
  const meta = id ? await safe(fetchMeta(id)) : null;
  if (!meta) throw new Error("this dataset has no reciprocal-space volume");
  return meta;
}

async function dpdfMeta(dataset: Dataset): Promise<DeltaPdfMeta> {
  const id = dpdfVolumeId(dataset);
  const meta = id ? await safe(fetchDpdfMeta(id)) : null;
  if (!meta) throw new Error("this dataset has no 3D-ΔPDF yet");
  return meta;
}

// The figure a cut is drawn in: the cleanup page (every stage side by side)
// at a reciprocal plane, or the 3D-ΔPDF page at a real-space section, centred
// in the other two axes.
const cleanupView = (plane: string, value: number): ViewTarget => ({
  view: "cleanup",
  plane,
  value,
  label: planeLabel(plane, value),
  axis: HKL[RECIP_FIXED[plane]] as FixedAxis,
});

const dpdfView = (meta: DeltaPdfMeta, plane: string, value: number): ViewTarget => {
  const fixed = DPDF_FIXED[plane];
  const index = meta.shape.map((n, i) => {
    if (i !== fixed) return Math.floor(n / 2);
    const [lo, hi] = dpdfRange(meta, i);
    return n > 1 ? Math.round(((value - lo) / (hi - lo)) * (n - 1)) : 0;
  }) as [number, number, number];
  return { view: "dpdf", plane, value, label: planeLabel(plane, value), index };
};

// ---------------------------------------------------------------- measuring

async function measureRecip(dataset: Dataset, plane: string, value: number) {
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

const recipSummary = (m: Awaited<ReturnType<typeof measureRecip>>): string =>
  [
    m.ring_removal?.ring_energy_ratio != null && `ring ratio ${m.ring_removal.ring_energy_ratio}`,
    m.bragg_punch_leftover &&
      (m.bragg_punch_leftover.n_at_nodes != null
        ? `${m.bragg_punch_leftover.n_at_nodes} missed at nodes, ${m.bragg_punch_leftover.n_off_nodes} off-lattice`
        : `${m.bragg_punch_leftover.n_suspicious} leftover peak(s)`),
    m.backfill?.median_seam_sigma != null && `seam ${m.backfill.median_seam_sigma}σ`,
    m.flatten?.after_floor_max_sigma != null && `floor ≤ ${m.flatten.after_floor_max_sigma}σ`,
  ]
    .filter(Boolean)
    .join(" · ") || "no stage metrics at this cut";

async function measureDpdf(dataset: Dataset, plane: string, value: number) {
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

const measureReciprocalCut: AgentTool = {
  name: "measure_reciprocal_cut",
  description:
    "Compute the stage-quality metrics (ring removal, leftover Bragg peaks, backfill seams, flatten floors) on any reciprocal-space cut — the same metrics as the opening context, which used only the L=0 H–K plane. Use it to check whether a finding holds on other planes or off-zero cuts (e.g. L=0.5, or K=1/3 for satellites).",
  parameters: {
    type: "object",
    properties: {
      plane: { type: "string", enum: RECIP_PLANES, description: "hk0 = H–K plane (cut along L), h0l = H–L plane (cut along K), 0kl = K–L plane (cut along H)" },
      value: { type: "number", description: "Cut position along the fixed axis, in r.l.u." },
    },
    required: ["plane", "value"],
  },
  run: async (args, { dataset }) => {
    const plane = oneOf(args, "plane", RECIP_PLANES);
    const value = num(args, "value");
    const result = await measureRecip(dataset, plane, value);
    return { result, summary: `${result.cut}: ${recipSummary(result)}`, view: cleanupView(plane, value) };
  },
};

const measureDpdfCut: AgentTool = {
  name: "measure_dpdf_cut",
  description:
    "Compute the 3D-ΔPDF feature metrics (feature SNR, strong-feature fraction, sign balance, anisotropy and its direction, radial trend) on any real-space section. The opening context used only z=0.",
  parameters: {
    type: "object",
    properties: {
      plane: { type: "string", enum: DPDF_PLANES, description: "xy (cut along z), xz (cut along y), yz (cut along x); x ∥ a, y ∥ b, z ∥ c" },
      value: { type: "number", description: "Cut position along the fixed axis, in Å" },
    },
    required: ["plane", "value"],
  },
  run: async (args, { dataset }) => {
    const plane = oneOf(args, "plane", DPDF_PLANES);
    const value = num(args, "value");
    const result = await measureDpdf(dataset, plane, value);
    const d = result.delta_pdf;
    return {
      result,
      summary: `${result.cut}: SNR ${d.feature_snr ?? "–"}, anisotropy ${d.anisotropy_ratio ?? "–"}`,
      view: dpdfView(await dpdfMeta(dataset), plane, value),
    };
  },
};

// ---------------------------------------------------------------- lookups

const describeDataset: AgentTool = {
  name: "describe_dataset",
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

const LINE_STAGES = [...RECIP_STAGES, "delta_pdf"] as const;
const ALL_AXES = ["H", "K", "L", "x", "y", "z"] as const;

const lineProfile: AgentTool = {
  name: "line_profile",
  description:
    "Intensity along a straight line parallel to one axis through any stage volume — e.g. along H through (H, 1/3, 0) to see a satellite row, or across a residual ring. Reciprocal stages take H/K/L (r.l.u.); delta_pdf takes x/y/z (Å). Returns sampled points plus the exact maximum, minimum and median.",
  parameters: {
    type: "object",
    properties: {
      stage: { type: "string", enum: LINE_STAGES },
      along: { type: "string", enum: ALL_AXES, description: "The axis the line runs along" },
      at: {
        type: "object",
        description: "The other two coordinates the line passes through (missing ones are 0), e.g. {\"K\": 0.333, \"L\": 0} for a line along H",
        properties: Object.fromEntries(ALL_AXES.map((a) => [a, { type: "number" }])),
      },
      n_points: { type: "integer", minimum: 16, maximum: 128, description: "Points to return (block-averaged); default 64" },
    },
    required: ["stage", "along"],
  },
  run: async (args, { dataset }) => {
    const stage = oneOf(args, "stage", LINE_STAGES);
    const real = stage === "delta_pdf";
    const axes: readonly string[] = real ? XYZ : HKL;
    const along = oneOf(args, "along", axes);
    const a = axes.indexOf(along);
    const at = (args.at && typeof args.at === "object" ? args.at : {}) as Args;
    const others = [0, 1, 2].filter((i) => i !== a);
    const coord = (i: number) => num(at, axes[i], 0);
    const [o1, fixed] = others; // the plane is cut along `fixed`; the line sits at o1
    const nPoints = Math.round(Math.min(128, Math.max(16, num(args, "n_points", 64))));

    let slice: Slice | null;
    let plane: string;
    let view: ViewTarget;
    if (real) {
      const meta = await dpdfMeta(dataset);
      plane = DPDF_PLANES.find((p) => DPDF_FIXED[p] === fixed)!;
      checkInRange(axes[fixed], coord(fixed), dpdfRange(meta, fixed));
      slice = await safe(fetchDpdfSlice(dpdfVolumeId(dataset)!, plane, coord(fixed)));
      view = dpdfView(meta, plane, coord(fixed));
    } else {
      const meta = await recipMeta(dataset);
      const id = stageVolumeId(dataset, stage);
      if (!id) throw new ToolArgError(`stage ${stage} has no output for this dataset`);
      plane = RECIP_PLANES.find((p) => RECIP_FIXED[p] === fixed)!;
      checkInRange(axes[fixed], coord(fixed), recipRange(meta, fixed));
      slice = await safe(fetchSlice(id, plane, coord(fixed)));
      view = cleanupView(plane, coord(fixed));
    }
    if (!slice) throw new Error(`could not read the ${stage} slice`);

    // In each plane the lower-indexed in-plane axis is x, the other y.
    const { nx, ny, x_axis, y_axis } = slice.header;
    const alongIsX = a < o1;
    const lineAxis = alongIsX ? x_axis : y_axis;
    const crossAxis = alongIsX ? y_axis : x_axis;
    let cross = 0;
    for (let i = 1; i < crossAxis.length; i++) {
      if (Math.abs(crossAxis[i] - coord(o1)) < Math.abs(crossAxis[cross] - coord(o1))) cross = i;
    }
    const n = alongIsX ? nx : ny;
    const value = (i: number) => slice!.data[alongIsX ? cross * nx + i : i * nx + cross];

    const finite: number[] = [];
    let max = -Infinity, min = Infinity, argMax = 0, argMin = 0;
    for (let i = 0; i < n; i++) {
      const v = value(i);
      if (!Number.isFinite(v)) continue;
      finite.push(v);
      if (v > max) [max, argMax] = [v, i];
      if (v < min) [min, argMin] = [v, i];
    }
    const points: [number, number | null][] = [];
    const block = Math.max(1, Math.ceil(n / nPoints));
    for (let start = 0; start < n; start += block) {
      let sum = 0, cnt = 0, pos = 0;
      for (let i = start; i < Math.min(n, start + block); i++) {
        pos += lineAxis[i];
        const v = value(i);
        if (Number.isFinite(v)) [sum, cnt] = [sum + v, cnt + 1];
      }
      const m = Math.min(n, start + block) - start;
      points.push([roundSig(pos / m, 4), cnt ? roundSig(sum / cnt, 4) : null]);
    }
    const through = Object.fromEntries(
      [o1, fixed].map((i) => [axes[i], roundSig(i === o1 ? crossAxis[cross] : coord(fixed), 4)]),
    );
    const result = {
      stage,
      along,
      through,
      units: real ? "Å" : "r.l.u.",
      points, // [position, block mean]; null = masked
      max: finite.length ? { at: roundSig(lineAxis[argMax], 4), value: roundSig(max, 4) } : null,
      min: finite.length ? { at: roundSig(lineAxis[argMin], 4), value: roundSig(min, 4) } : null,
      median: finite.length ? roundSig(median(finite), 4) : null,
      masked_fraction: roundSig(1 - finite.length / Math.max(1, n), 3),
    };
    const where = Object.entries(through).map(([k, v]) => `${k}=${v}`).join(", ");
    return {
      result,
      summary: `${stage} along ${along} at ${where}: max ${result.max?.value ?? "–"} at ${result.max?.at ?? "–"}`,
      view,
    };
  },
};

const braggPeaks: AgentTool = {
  name: "bragg_peaks",
  description:
    "Peaks from the punch stage's fitted Bragg profile: position (HKL and |Q|), intensity, local background, significance, measured width per axis (Å⁻¹), whether each axis is resolution-limited, and anisotropy (largest/smallest principal width). Sort by a property or by distance to an HKL point.",
  parameters: {
    type: "object",
    properties: {
      sort_by: { type: "string", enum: ["significance", "intensity", "anisotropy", "width", "q"], description: "Default significance" },
      near_hkl: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3, description: "Sort by distance to this (H, K, L) instead" },
      limit: { type: "integer", minimum: 1, maximum: 25, description: "Default 10" },
    },
  },
  run: async (args, { dataset }) => {
    const sortBy = oneOf(args, "sort_by", ["significance", "intensity", "anisotropy", "width", "q"] as const, "significance");
    const limit = Math.round(Math.min(25, Math.max(1, num(args, "limit", 10))));
    const near = Array.isArray(args.near_hkl) && args.near_hkl.length === 3 ? args.near_hkl.map(Number) : null;
    if (near && near.some((v) => !Number.isFinite(v))) throw new ToolArgError("near_hkl must be three numbers");
    const profile = await safe(fetchBraggProfile(dataset.id));
    if (!profile?.has_profile) {
      return { result: { has_profile: false }, summary: "no fitted Bragg profile (run the punch stage)" };
    }
    const peaks = profile.peaks.map((p) => {
      const w = p.principal_width_q ?? p.measured_width_q ?? p.width_q;
      const ws = (w ?? []).filter((v): v is number => Number.isFinite(v) && v > 0);
      return {
        hkl: p.center_hkl.map((v) => roundSig(v, 4)),
        q: r4(p.q_abs),
        intensity: r4(p.intensity),
        local_background: r4(p.local_background),
        significance: r4(p.significance ?? null),
        measured_width_q: p.measured_width_q?.map((v) => roundSig(v, 3)) ?? null,
        resolution_limited: p.resolution_limited ?? null,
        anisotropy: ws.length >= 2 ? roundSig(Math.max(...ws) / Math.min(...ws), 3) : null,
        fit: p.fit_kind,
      };
    });
    // Larger key first; a missing value sorts last.
    const LAST = -Number.MAX_VALUE;
    const key = (p: (typeof peaks)[number]): number => {
      if (near) return -Math.hypot(...p.hkl.map((v, i) => v - near[i]));
      if (sortBy === "width") return p.measured_width_q?.length ? Math.max(...p.measured_width_q) : LAST;
      if (sortBy === "q") return p.q != null ? -p.q : LAST;
      return p[sortBy] ?? LAST;
    };
    peaks.sort((x, y) => key(y) - key(x));
    const result = {
      n_peaks: profile.n_peaks,
      punch_frame: profile.punch_frame,
      sorted_by: near ? `distance to ${near.join(", ")}` : sortBy,
      peaks: peaks.slice(0, limit),
    };
    const top = result.peaks[0];
    return {
      result,
      summary: `${profile.n_peaks} fitted peaks; top ${result.peaks.length} by ${result.sorted_by}`,
      view: top && {
        view: "bragg",
        hkl: top.hkl as [number, number, number],
        label: `the peak at (${top.hkl.join(", ")})`,
      },
    };
  },
};

const consistencyDetails: AgentTool = {
  name: "consistency_details",
  description:
    "The run's saved back-FFT check in full: Pearson r and normalised RMS of the inverse-FFT ΔPDF against the cleaned data, r per principal plane, the |Q| and r bands, crop and apodization. Says whether — and where — the ΔPDF reproduces the data.",
  parameters: { type: "object", properties: {} },
  run: async (_args, { dataset }) => {
    const check = await safe(fetchConsistencyCheck(dataset.id));
    if (!check?.has_check || !check.metrics) {
      return { result: { has_check: false }, summary: "no back-FFT check saved for this ΔPDF" };
    }
    const m = check.metrics;
    const result = {
      ...m,
      pearson_r: r4(m.pearson_r),
      normalized_rms: r4(m.normalized_rms),
      per_plane_r: Object.fromEntries(Object.entries(m.per_plane_r ?? {}).map(([k, v]) => [k, r4(v)])),
    };
    return {
      result,
      summary: `r = ${result.pearson_r}, normalised RMS = ${result.normalized_rms}`,
      view: { view: "consistency", label: "the back-FFT check" },
    };
  },
};

const compareDatasets: AgentTool = {
  name: "compare_datasets",
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
    return { result: { cut: planeLabel(plane, value), rows }, summary: `${planeLabel(plane, value)} on ${rows.length} datasets` };
  },
};

const currentView: AgentTool = {
  name: "current_view",
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

// Settings that only steer the Configure page's previews, not the run.
const UI_ONLY = /^punch(Slice|Cut)/;

const configureSettings: AgentTool = {
  name: "configure_settings",
  description:
    "The Configure page's current settings — what the next run would use (blank = the backend default). They may differ from the settings that produced the files on disk. Name settings exactly as returned here when you suggest a change.",
  parameters: { type: "object", properties: {} },
  run: async () => {
    const s = usePipelineStore.getState() as unknown as Record<string, unknown>;
    const settings: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s)) {
      if (typeof v === "function" || UI_ONLY.test(k)) continue;
      if (["jobId", "running", "events", "times", "terminal"].includes(k)) continue;
      settings[k] = v === "" ? "(default)" : v;
    }
    return { result: { settings }, summary: `${Object.keys(settings).length} settings` };
  },
};

const showInViewer: AgentTool = {
  name: "show_in_viewer",
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

// ---------------------------------------------------------------- assessing

// The output each stage writes, as the dataset lists it.
const STAGE_OUTPUT: Record<TuneStage, string> = {
  rings: "ringremoved",
  punch: "braggpunched",
  backfill: "backfilled",
  flatten: "flattened",
  pdf: "delta_pdf",
};

const ASSESS_CHOICES = [...TUNE_STAGES, "all"] as const;

// The per-plane number that is worse when larger, for each reciprocal stage.
const WORSE_WHEN_LARGER: Partial<Record<TuneStage, string>> = {
  rings: "ring_energy_ratio",
  punch: "at_nodes",
  backfill: "median_seam_sigma",
  flatten: "after_floor_max_sigma",
};

// The plane where a stage did worst, to show it there; the first plane when
// none stands out.
function worstPlane(stage: TuneStage, evaluation: Record<string, unknown>): string | null {
  const per = evaluation.per_plane as Record<string, Record<string, unknown> | null> | undefined;
  const key = WORSE_WHEN_LARGER[stage];
  if (!per || !key) return null;
  let worst: string | null = null;
  let worstValue = -Infinity;
  for (const [plane, m] of Object.entries(per)) {
    const v = m?.[key];
    if (typeof v === "number" && v > worstValue) [worst, worstValue] = [plane, v];
  }
  return worst ?? Object.keys(per)[0] ?? null;
}

const assessStage: AgentTool = {
  name: "assess_stage",
  description:
    "Judge a stage's output against its goal, on the three principal planes through the origin plus the records the stage writes — the evaluation the tuning run judges trials by. rings: ring-energy ratio and over-subtraction per plane; punch: leftover peaks, punched fraction, fitted peaks; backfill: seam σ and bright fills; flatten: shell floors in σ; pdf: back-FFT r and RMS, feature SNR per section. Returns the stage's goal with the numbers. stage=all gives each stage's headline numbers; one stage adds the per-plane detail. Use it for a verdict on a stage, after a run, and before and after a change.",
  parameters: {
    type: "object",
    properties: {
      stage: { type: "string", enum: ASSESS_CHOICES, description: "The stage to judge, or all (default)" },
    },
  },
  run: async (args, { dataset }) => {
    const pick = oneOf(args, "stage", ASSESS_CHOICES, "all");
    const stages: TuneStage[] = pick === "all" ? [...TUNE_STAGES] : [pick];
    const result: Record<string, unknown> = {};
    const lines: string[] = [];
    let view: ViewTarget | undefined;
    let measuredOn: string[] | undefined;
    for (const stage of stages) {
      if (!stageVolumeId(dataset, STAGE_OUTPUT[stage])) {
        result[stage] = { missing: `no ${STAGE_OUTPUT[stage]} output yet; run_pipeline computes it` };
        continue;
      }
      const evaluation = await evaluateStage(stage, dataset);
      const planes = Object.keys((evaluation.per_plane as object | undefined) ?? {});
      if (!measuredOn && planes.length) measuredOn = planes.map((p) => planeLabel(p, 0));
      if (!view) {
        const plane = stage === "pdf" ? null : worstPlane(stage, evaluation);
        if (plane) view = cleanupView(plane, 0);
        else if (stage === "pdf") view = { view: "consistency", label: "the back-FFT check" };
      }
      // All five stages' per-plane detail would overflow the result.
      if (pick === "all") delete evaluation.per_plane;
      result[stage] = { headline: headline(stage, evaluation), ...evaluation, goal: STAGE_GOALS[stage] };
      lines.push(`${TUNE_STAGE_LABELS[stage]}: ${headline(stage, evaluation)}`);
    }
    if (measuredOn) result.measured_on = measuredOn;
    return { result, summary: lines.join(" · ") || "no stage outputs yet", view };
  },
};

const radialProfileTool: AgentTool = {
  name: "radial_profile",
  description:
    "The median intensity in |Q| shells of one reciprocal cut, for each cleanup stage side by side (raw, ringremoved, braggpunched, backfilled, flattened). Shell medians ignore Bragg peaks but follow powder rings, which are bumps in raw that ring removal should take out without denting the diffuse; after flatten the floor should sit near 0 at every |Q|. Use it to see where in |Q| a stage left or removed signal.",
  parameters: {
    type: "object",
    properties: {
      plane: { type: "string", enum: RECIP_PLANES, description: "hk0 (default), h0l or 0kl" },
      value: { type: "number", description: "Cut position along the fixed axis, in r.l.u. (default 0)" },
      stages: {
        type: "array",
        items: { type: "string", enum: RECIP_STAGES },
        description: "Stages to compare (default every one that exists)",
      },
      bins: { type: "integer", minimum: 8, maximum: 64, description: "Number of |Q| shells (default 32)" },
    },
  },
  run: async (args, { dataset }) => {
    const plane = oneOf(args, "plane", RECIP_PLANES, "hk0");
    const value = num(args, "value", 0);
    const bins = Math.round(num(args, "bins", 32));
    if (bins < 8 || bins > 64) throw new ToolArgError("bins must be within [8, 64]");
    let stages = RECIP_STAGES.filter((s) => stageVolumeId(dataset, s));
    if (args.stages !== undefined) {
      if (!Array.isArray(args.stages) || !args.stages.length) throw new ToolArgError("stages must be a non-empty list");
      const wanted = args.stages.map((s) => oneOf({ stage: s }, "stage", RECIP_STAGES));
      stages = stages.filter((s) => wanted.includes(s));
    }
    if (!stages.length) throw new Error("none of those stage outputs exist yet; run_pipeline computes them");
    const meta = await recipMeta(dataset);
    checkInRange(HKL[RECIP_FIXED[plane]], value, recipRange(meta, RECIP_FIXED[plane]));
    const radius = qRadius(plane, value, meta);
    const slices = await Promise.all(stages.map((s) => fetchSlice(stageVolumeId(dataset, s)!, plane, value)));
    // The stages share one grid, so their shells line up.
    const profiles = slices.map((s) => radialProfile(s, bins, radius, "median"));
    const rows = profiles[0].r
      .map((r, i) => ({
        q: roundSig(r, 3),
        ...Object.fromEntries(
          stages.map((s, j) => {
            const v = profiles[j].intensity[i];
            return [s, Number.isFinite(v) ? roundSig(v, 3) : null];
          }),
        ),
      }))
      .filter((row) => stages.some((s) => (row as Record<string, number | null>)[s] != null));
    return {
      result: {
        cut: planeLabel(plane, value),
        q_unit: radius ? "|Q| in Å⁻¹" : "in-plane radius in r.l.u. (no cell)",
        stat: "median per shell",
        rows,
      },
      summary: `${planeLabel(plane, value)}: ${rows.length} shells × ${stages.length} stages`,
      view: cleanupView(plane, value),
    };
  },
};

const runLog: AgentTool = {
  name: "run_log",
  description:
    "The log of the last pipeline run in this session: each stage's start, skip, result and error lines (how many ring shells were fitted, peaks punched, voxels left unmeasured, the back-FFT r, …) and how the run ended. Use it to explain a result or a failure.",
  parameters: {
    type: "object",
    properties: {
      stage: { type: "string", enum: STAGES, description: "Only this stage's lines (default all)" },
      limit: { type: "integer", minimum: 1, maximum: 60, description: "The last N lines (default 30)" },
    },
  },
  run: async (args) => {
    const { events, terminal, running } = usePipelineStore.getState();
    if (!events.length) throw new Error("no pipeline run in this session yet");
    const stage = args.stage === undefined ? null : oneOf(args, "stage", STAGES);
    const limit = Math.round(num(args, "limit", 30));
    if (limit < 1 || limit > 60) throw new ToolArgError("limit must be within [1, 60]");
    const lines = events
      .filter((e) => e.message && (!stage || e.stage === stage))
      .slice(-limit)
      .map((e) => ({ stage: e.stage ?? null, status: e.status ?? null, message: e.message }));
    const ended = running ? "still running" : (terminal ?? "unknown");
    return {
      result: { ended, lines },
      summary: `${lines.length} line${lines.length === 1 ? "" : "s"} · ${ended}`,
      view: { view: "execution", label: "the run log" },
    };
  },
};

const textureCheck: AgentTool = {
  name: "texture_check",
  description:
    "Check whether the punch and backfill printed a pattern of their own into reciprocal space, on a cut (default: the three principal planes through the origin). Fill bias: each filled hole against the unpunched voxels on its rim, signed, in rim σ; a median near 0 with about half the holes brighter is clean, while holes filled systematically brighter or darker add a lattice-periodic texture that the ΔPDF turns into features at lattice vectors. Azimuthal texture: per |Q| shell, how much the sector means vary around the shell before the punch (unpunched voxels) and after the backfill; a ratio near 1 adds none.",
  parameters: {
    type: "object",
    properties: {
      plane: { type: "string", enum: RECIP_PLANES, description: "One plane instead of all three" },
      value: { type: "number", description: "Cut position for that plane, in r.l.u. (default 0)" },
    },
  },
  run: async (args, { dataset }) => {
    const ids = (["ringremoved", "braggpunched", "backfilled"] as const).map((s) => stageVolumeId(dataset, s));
    if (!ids[1] || !ids[2]) throw new Error("this needs the punched and backfilled outputs; run_pipeline computes them");
    const meta = await recipMeta(dataset);
    const cuts =
      args.plane === undefined
        ? RECIP_PLANES.filter((p) => {
            const r = recipRange(meta, RECIP_FIXED[p]);
            return r[0] <= 0 && r[1] >= 0;
          }).map((plane) => ({ plane, value: 0 }))
        : [{ plane: oneOf(args, "plane", RECIP_PLANES), value: num(args, "value", 0) }];
    for (const c of cuts) checkInRange(HKL[RECIP_FIXED[c.plane]], c.value, recipRange(meta, RECIP_FIXED[c.plane]));
    const rows = await Promise.all(
      cuts.map(async ({ plane, value }) => {
        const [before, punched, filled] = await Promise.all(
          ids.map((id) => (id ? safe(fetchSlice(id, plane, value)) : Promise.resolve(null))),
        );
        return { cut: planeLabel(plane, value), ...textureMetrics(before, punched, filled, qRadius(plane, value, meta)) };
      }),
    );
    const biased = rows.filter((r) => r.systematic_fill_bias).length;
    const bias = (i: number) => Math.abs(rows[i].median_fill_bias_sigma ?? 0);
    const strongest = rows.reduce((best, _r, i) => (bias(i) > bias(best) ? i : best), 0);
    const ratios = rows.map((r) => r.azimuthal_ratio).filter((x): x is number => x != null);
    return {
      result: { per_cut: rows },
      summary:
        `${biased ? `systematic fill bias on ${biased} of ${rows.length} cut(s)` : "no systematic fill bias"}` +
        (ratios.length ? ` · azimuthal ratio ${Math.min(...ratios)}–${Math.max(...ratios)}` : ""),
      view: cleanupView(cuts[strongest].plane, cuts[strongest].value),
    };
  },
};

// How far the forward transform reaches in |Q|, from the Configure page: an
// explicit |Q| band; else the box corners for a flat separable window (no
// apodization), where every voxel counts at full weight; else the box faces
// where the window tapers to zero, or the coverage edge when it is tapered to
// the measured coverage.
function windowReach(
  s: PipelineConfig,
  q: { corner: number | null; box: number | null; full: number | null },
): { reach: number | null; how: string } {
  if (s.pdfQMax) return { reach: Number(s.pdfQMax), how: "the |Q| band set on the Configure page" };
  if (s.pdfApod === "none" && s.pdfWindowShape !== "ellipsoid") {
    return { reach: q.corner, how: "apodization off: a flat separable window counts the data out to the box corners" };
  }
  if (s.pdfWindowSupport && q.full != null && q.box != null && q.full < q.box) {
    return { reach: q.full, how: "the window is tapered to the measured coverage" };
  }
  return { reach: q.box, how: "the window tapers to zero at the box faces" };
}

const qmaxCoverage: AgentTool = {
  name: "qmax_coverage",
  description:
    "Check that the forward transform (data → 3D-ΔPDF) does not reach past the measured reciprocal space. On the three principal planes through the origin it measures the share of each |Q| shell that was measured (finite in raw), the |Q| where shells stop being fully (95 %) measured, and where the data box ends, and compares them with how far the transform's window reaches: the |Q| band if one is set, else the box faces, the coverage edge when the window is tapered to the coverage, or the box corners when apodization is off with a separable window. The reach comes from the Configure page's settings, which may differ from the ones that made the ΔPDF on disk.",
  parameters: { type: "object", properties: {} },
  run: async (_args, { dataset }) => {
    const meta = await recipMeta(dataset);
    const rawId = stageVolumeId(dataset, "raw") ?? hklVolumeId(dataset)!;
    const planes = RECIP_PLANES.filter((p) => {
      const r = recipRange(meta, RECIP_FIXED[p]);
      return r[0] <= 0 && r[1] >= 0;
    });
    const per = await Promise.all(
      planes.map(async (plane) => {
        const slice = await safe(fetchSlice(rawId, plane, 0));
        return [plane, coverageMetrics(slice, qRadius(plane, 0, meta))] as const;
      }),
    );
    const pick = (k: "full_coverage_q" | "box_q" | "low_q_gap") =>
      per.map(([, m]) => m?.[k]).filter((x): x is number => typeof x === "number");
    const fullQ = pick("full_coverage_q").length ? Math.min(...pick("full_coverage_q")) : null;
    const boxQ = pick("box_q").length ? Math.min(...pick("box_q")) : null;
    // The plane where full coverage ends first, to show it there.
    let shortest = planes[0] as string | undefined;
    let shortestQ = Infinity;
    for (const [plane, m] of per) {
      if (m?.full_coverage_q != null && m.full_coverage_q < shortestQ) [shortest, shortestQ] = [plane, m.full_coverage_q];
    }
    const dId = dpdfVolumeId(dataset);
    const dmeta = dId ? await safe(fetchDpdfMeta(dId)) : null;
    // The ΔPDF records max |Q| over its grid: the box corner.
    const cornerQ = dmeta?.q_max ?? null;
    const s = usePipelineStore.getState();
    const { reach, how } = windowReach(s, { corner: cornerQ, box: boxQ, full: fullQ });
    const shell = boxQ != null ? boxQ / COVERAGE_SHELLS : 0; // the coverage edge is known to one shell
    const verdict = !qRadius("hk0", 0, meta)
      ? "no unit cell: |Q| is unknown, so the reach cannot be compared"
      : fullQ == null
        ? "no |Q| shell is fully measured on these planes"
        : reach == null
          ? "no ΔPDF yet to read the box corner from"
          : reach <= fullQ + shell
            ? `the transform reaches ${roundSig(reach, 4)} Å⁻¹ (${how}), inside full coverage at ${fullQ} Å⁻¹`
            : `too far: the transform reaches ${roundSig(reach, 4)} Å⁻¹ (${how}), past full coverage at ${fullQ} Å⁻¹; set a |Q| band at or below it, or taper the window to the coverage`;
    return {
      result: {
        verdict,
        transform_reach_q: reach == null ? null : roundSig(reach, 4),
        reach_from: how,
        full_coverage_q: fullQ,
        box_face_q: boxQ,
        box_corner_q: cornerQ == null ? null : roundSig(cornerQ, 4),
        low_q_gap: pick("low_q_gap").length ? Math.max(...pick("low_q_gap")) : null,
        q_unit: "Å⁻¹",
        settings: {
          pdfQMin: s.pdfQMin || "(default)",
          pdfQMax: s.pdfQMax || "(default)",
          pdfApod: s.pdfApod || "(default)",
          pdfWindowShape: s.pdfWindowShape || "(default)",
          pdfWindowSupport: s.pdfWindowSupport,
        },
        per_plane: Object.fromEntries(
          per.map(([plane, m]) => [
            plane,
            m && {
              full_coverage_q: m.full_coverage_q,
              half_coverage_q: m.half_coverage_q,
              box_q: m.box_q,
              shells: m.shells.filter((_x, i) => i % 4 === 3), // every fourth shell
            },
          ]),
        ),
      },
      summary: verdict,
      view: shortest ? cleanupView(shortest, 0) : undefined,
    };
  },
};

// ---------------------------------------------------------------- actions

// Neither acts while a run or a tuning run is going: both own the pipeline.
const checkIdle = () => {
  if (usePipelineStore.getState().running) throw new Error("a pipeline run is in progress; wait for it to end");
  if (useTuneStore.getState().active) throw new Error("a tuning run is in progress; wait for it to end");
};

const SETTABLE = [...TUNE_PARAMS, ...SAMPLE_PARAMS];
const findParam = (key: string): TuneParam | undefined => SETTABLE.find((p) => p.key === key);

const allowedValues = (p: TuneParam): string =>
  p.kind === "enum"
    ? p.options!.map((o) => o.name).join("|")
    : p.kind === "boolean"
      ? "true|false"
      : p.kind === "fractions"
        ? 'H fractions like "1/3, 2/3", or none'
        : `${p.kind} ${p.min}–${p.max}`;

const updateSettings: AgentTool = {
  name: "update_settings",
  description:
    "Change settings on the Configure page; the next run_pipeline uses them and the user sees the fields change. " +
    `These method choices and thresholds can be changed: ${TUNE_PARAMS.map((p) => `${p.key} (${allowedValues(p)})`).join(", ")}. ` +
    `These facts about the sample only when the user asks for that change, never to improve a result: ${SAMPLE_PARAMS.map((p) => `${p.key} (${allowedValues(p)}; ${p.help})`).join(" ")} ` +
    "The magnetic ion and |Q| band stay with the user. " +
    "Change them when the user asks for a change, or asks you to improve or tune the result, and only the settings " +
    "the user named or agreed to; when unsure which setting the user means, ask instead of guessing. Settings " +
    "already at the value are left as they are. Returns each change and the stage to rerun from.",
  parameters: {
    type: "object",
    properties: {
      changes: { type: "object", description: 'Setting → new value, e.g. {"punchMinSig": 6}' },
    },
    required: ["changes"],
  },
  run: async (args) => {
    checkIdle();
    const changes = args.changes;
    if (!changes || typeof changes !== "object" || Array.isArray(changes) || !Object.keys(changes).length) {
      throw new ToolArgError("changes must be an object of setting → value");
    }
    const patch: Record<string, string | boolean> = {};
    for (const [key, value] of Object.entries(changes)) {
      const p = findParam(key);
      if (!p) throw new ToolArgError(`${key} cannot be changed; these can: ${SETTABLE.map((q) => q.key).join(", ")}`);
      try {
        patch[key] = toFormValue(key, value, p.stage, { sample: true });
      } catch (e) {
        throw new ToolArgError((e as Error).message);
      }
    }
    const before = usePipelineStore.getState();
    // A setting already at the value is no change: leave it out of the patch.
    const unchanged = Object.keys(patch).filter((key) => before[key as keyof PipelineConfig] === patch[key]);
    for (const key of unchanged) delete patch[key];
    before.patch(patch as Partial<PipelineConfig>);
    const after = usePipelineStore.getState();
    const changed = Object.keys(patch).map((key) => {
      const p = findParam(key)!;
      return {
        setting: key,
        from: displayValue(p, before[p.key]),
        to: displayValue(p, after[p.key]),
        ...(p.appliesWhen && !p.appliesWhen(after) ? { note: "no effect with the current model" } : {}),
      };
    });
    const rerunFrom = TUNE_STAGES.find((st) => changed.some((c) => findParam(c.setting)!.stage === st));
    return {
      result: { changed, ...(unchanged.length ? { already_set: unchanged } : {}), rerun_from: rerunFrom ?? null },
      summary: changed.length
        ? changed.map((c) => `${c.setting} ${c.from} → ${c.to}`).join(", ")
        : `no change: ${unchanged.join(", ")} already set`,
    };
  },
};

const stageLabel = (stage?: string): string => (stage ? STAGE_LABELS[stage] ?? stage : "");

// One log line: "Bragg punch 45% · fitting 312 peaks".
const eventLine = (ev: JobEvent): string =>
  [
    stageLabel(ev.stage) + (ev.fraction != null && ev.status === "progress" ? ` ${Math.round(ev.fraction * 100)}%` : ""),
    ev.message,
  ]
    .filter(Boolean)
    .join(" · ");

const runPipeline: AgentTool = {
  name: "run_pipeline",
  description:
    "Run the reduction pipeline on the selected dataset with the Configure page's settings, as the Run button does: " +
    "it writes the dataset's stage outputs, and the console shows the run on its Execution page while it goes. " +
    "Without from_stage, outputs that already exist are reused (unless the user switched Force on), so it computes " +
    "what is missing. With from_stage, that stage and every enabled stage after it are recomputed: use it after " +
    "update_settings. A run takes seconds to minutes. Returns how it ended, which stages were computed or reused, " +
    "and the outputs that now exist; measure them afterwards.",
  parameters: {
    type: "object",
    properties: {
      from_stage: {
        type: "string",
        enum: TUNE_STAGES,
        description: "Recompute from this stage on; omit to compute only what is missing",
      },
    },
  },
  run: async (args, ctx, io) => {
    checkIdle();
    const from = args.from_stage === undefined ? null : oneOf(args, "from_stage", TUNE_STAGES);
    const pipe = usePipelineStore.getState();
    const stages = enabledStages(pipe).filter(
      (st) => !from || STAGES.indexOf(st as (typeof STAGES)[number]) >= STAGES.indexOf(from),
    );
    if (!stages.length) throw new Error(`every stage${from ? ` from ${stageLabel(from)} on` : ""} is switched off`);
    const force = from ? true : pipe.force;

    useNavStore.getState().setTab("execution");
    let seen = 0;
    const unsubscribe = usePipelineStore.subscribe(({ events }) => {
      if (events.length === seen) return;
      seen = events.length;
      const ev = events[events.length - 1];
      const at = ev.stage ? stages.indexOf(ev.stage) : -1;
      io.progress?.((at >= 0 ? `${at + 1}/${stages.length} ` : "") + eventLine(ev));
    });
    const cancel = () => void usePipelineStore.getState().cancel();
    io.signal?.addEventListener("abort", cancel);
    const t0 = performance.now();
    let ended: string;
    try {
      ended = await usePipelineStore.getState().runStages(stages, { datasetId: ctx.dataset.id, force });
    } finally {
      unsubscribe();
      io.signal?.removeEventListener("abort", cancel);
    }
    const seconds = Math.round((performance.now() - t0) / 100) / 10;
    const events = usePipelineStore.getState().events;

    if (ended !== "done") {
      const failed = [...events].reverse().find((e) => e.status === "error");
      throw new Error(`the run ${ended === "cancelled" ? "was cancelled" : "failed"}${failed ? `: ${eventLine(failed)}` : ""}`);
    }
    // The last word on each stage: done = computed, skip = its output was reused.
    const outcome: Record<string, string> = {};
    for (const e of events) {
      if (e.stage && (e.status === "done" || e.status === "skip")) outcome[e.stage] = e.status === "done" ? "computed" : "reused";
    }
    const fresh = await safe(fetchDataset(ctx.dataset.id));
    if (fresh) ctx.dataset = fresh;
    const computed = Object.values(outcome).filter((o) => o === "computed").length;
    const result = {
      ended,
      seconds,
      stages: outcome,
      outputs: ctx.dataset.stages.filter((s) => s.exists).map((s) => s.name),
      log_tail: events.filter((e) => e.message).slice(-5).map(eventLine),
    };
    return {
      result,
      summary: `done in ${seconds} s · ${computed} computed, ${Object.keys(outcome).length - computed} reused`,
    };
  },
};

// A tuning run's state as one live line: "2/5 Bragg punch · trial 3/4 running".
const tuneLine = (stages: StageRun[]): string => {
  const i = stages.findIndex((r) => !["waiting", "done", "skipped", "failed"].includes(r.status));
  if (i < 0) return "";
  const r = stages[i];
  const t = r.trials.find((x) => x.status === "running");
  const what = t ? `trial ${t.n}/${r.trials.length} running` : r.status;
  return `${i + 1}/${stages.length} ${TUNE_STAGE_LABELS[r.stage]} · ${what}`;
};

const tunePipeline: AgentTool = {
  name: "tune_pipeline",
  description:
    "Search for the best settings, one stage at a time: for each stage it runs the current settings, has you " +
    "propose alternatives, runs each, judges which best meets the stage's goal, keeps it and moves on, so later " +
    "stages build on the best earlier ones. Trials run in a tuning folder: the dataset's own outputs are not " +
    "changed, and the chosen settings end up on the Configure page. The user watches the trials in the chat, under " +
    "this reply, and each run on the Execution page. Takes minutes (one run per trial). Returns each stage's chosen " +
    "trial, its changes and why.",
  parameters: {
    type: "object",
    properties: {
      stages: {
        type: "array",
        items: { type: "string", enum: TUNE_STAGES },
        description: "Stages to tune (default all); the stages between them are re-run once with their settings",
      },
      trials_per_stage: {
        type: "integer",
        minimum: 2,
        maximum: 5,
        description: "Trials per tuned stage, the current settings included (default 3)",
      },
    },
  },
  run: async (args, ctx, io) => {
    checkIdle();
    let stages: TuneStage[] = [...TUNE_STAGES];
    if (args.stages !== undefined) {
      if (!Array.isArray(args.stages) || !args.stages.length) throw new ToolArgError("stages must be a non-empty list");
      stages = args.stages.map((st) => oneOf({ stage: st }, "stage", TUNE_STAGES));
    }
    const trials = Math.round(num(args, "trials_per_stage", 3));
    if (trials < 2 || trials > 5) throw new ToolArgError("trials_per_stage must be within [2, 5]");

    useNavStore.getState().setTab("execution");
    let last = "";
    const unsubscribe = useTuneStore.subscribe(({ stages: runs }) => {
      const line = tuneLine(runs);
      if (line && line !== last) io.progress?.((last = line));
    });
    io.signal?.addEventListener("abort", stopTuning);
    const t0 = performance.now();
    try {
      await startTuning({ dataset: ctx.dataset, stages, trialsPerStage: trials, llm: loadSettings() });
    } finally {
      unsubscribe();
      io.signal?.removeEventListener("abort", stopTuning);
    }
    const minutes = Math.round((performance.now() - t0) / 6000) / 10;
    const tune = useTuneStore.getState();
    if (tune.error) throw new Error(`tuning stopped: ${tune.error}`);
    const result = {
      minutes,
      stages: tune.stages.map((r) => {
        const best = r.trials.find((t) => t.n === r.best);
        return {
          stage: r.stage,
          status: r.status,
          tuned: r.tuned,
          ...(best && {
            chosen_trial: best.n,
            of: r.trials.length,
            changes: best.changes,
            result: headline(r.stage, best.evaluation),
          }),
          ...(r.why && { why: r.why }),
          ...(r.message && { message: r.message }),
        };
      }),
      note: tune.finishedNote,
      write_outputs_with: { tool: "run_pipeline", from_stage: TUNE_STAGES.find((st) => stages.includes(st)) },
    };
    const changed = result.stages.filter((r) => r.changes && Object.keys(r.changes).length).length;
    return { result, summary: `${minutes} min · settings changed on ${changed} of ${stages.length} stages` };
  },
};

export const CHAT_TOOLS: AgentTool[] = [
  describeDataset,
  currentView,
  measureReciprocalCut,
  measureDpdfCut,
  assessStage,
  textureCheck,
  qmaxCoverage,
  radialProfileTool,
  lineProfile,
  braggPeaks,
  consistencyDetails,
  runLog,
  compareDatasets,
  configureSettings,
  updateSettings,
  runPipeline,
  tunePipeline,
  showInViewer,
];

export const toolSpecs = (tools: AgentTool[]): ToolSpec[] =>
  tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

// Tool results go back into the model's context window; keep each bounded.
export const MAX_RESULT_CHARS = 5000;

export interface ToolRun {
  ok: boolean;
  args: Args;
  text: string; // what the model reads
  summary: string;
  view?: ViewTarget;
}

// Run one call the model made.  Never throws: a bad call becomes an error
// message the model reads and can correct.
export async function runToolCall(
  call: ToolCall,
  tools: AgentTool[],
  ctx: ToolContext,
  io: ToolIO = {},
): Promise<ToolRun> {
  let args: Args = {};
  try {
    const parsed = JSON.parse(call.function.arguments || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Args;
    else throw new Error("not an object");
  } catch {
    const text = `Error: the arguments were not a JSON object: ${call.function.arguments.slice(0, 200)}`;
    return { ok: false, args, text, summary: "invalid arguments" };
  }
  const tool = tools.find((t) => t.name === call.function.name);
  if (!tool) {
    const text = `Error: no tool named ${call.function.name}. Available: ${tools.map((t) => t.name).join(", ")}`;
    return { ok: false, args, text, summary: `unknown tool ${call.function.name}` };
  }
  try {
    const out = await tool.run(args, ctx, io);
    let text = JSON.stringify(out.result);
    if (text.length > MAX_RESULT_CHARS) text = `${text.slice(0, MAX_RESULT_CHARS)}… [truncated]`;
    return { ok: true, args, text, summary: out.summary, view: out.view };
  } catch (e) {
    const msg = (e as Error).message;
    const text = e instanceof ToolArgError ? `Error: invalid arguments — ${msg}` : `Error: ${msg}`;
    return { ok: false, args, text, summary: msg };
  }
}
