// The assistant's tools: functions the model may call mid-answer to measure,
// look up or show something, instead of reasoning only from the one default
// cut it was handed.  Each validates its arguments (a model can send anything),
// reads through the same API the viewers use, and returns compact JSON.  Each
// also declares its facts (tools/facts.ts): whether it only reads or acts, and
// on what, the verdicts it settles, the questions a local model is offered it
// for, its label in the transcript.  The modules around the agent loop read
// them through factsOf and toolsWhere, at the end of this file; the model never
// sees them.

import {
  fetchBraggProfile,
  fetchConsistencyCheck,
  fetchDataset,
  fetchDpdfFeatures,
  fetchDpdfMeta,
  fetchDpdfSlice,
  fetchMeta,
  fetchSlice,
  fetchUbCheck,
  fetchVolumeCoverage,
} from "../../api/client";
import type { Dataset, DeltaPdfMeta, JobEvent, Slice, UbCheck, VolumeCoverage, VolumeMeta } from "../../api/types";
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
import { evaluateStage, headline, type StageEvaluation } from "../tune/evaluate";
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
import { ALL_STAGES, keysOf, RECIP, resolveFacts, stageKey, type Facts, type ToolFacts } from "./facts";
import { openView, type ViewTarget } from "./openView";
import { built, evidence, inference, joined, reading, withoutInference, written, type Tagged } from "../inference";
import { allSkills, readSkill, refusalFor, REFERENCE_MAX_CHARS, skillsOn } from "../skills";
import { judge, WORDS, type Outcome } from "../verdicts";

export type { ViewTarget } from "./openView";
import { DPDF_AUTO_PERCENTILE, withoutOrigin } from "../../components/dpdfLevels";
import { COVERAGE_SHELLS, coverageMetrics } from "../metrics/coverage";
import { grainCheck, shownGrains } from "../metrics/grains";
import { sectionSymmetry, SYMMETRY_HOLDS } from "../metrics/symmetry";
import { median, radialProfile, roundSig } from "../metrics/sliceStats";
import { textureMetrics } from "../metrics/texture";

// The dataset the tools read.  run_pipeline replaces `dataset` with its fresh
// listing after a run, so the tools called after it see the new outputs.
export interface ToolContext {
  dataset: Dataset;
  datasets: Dataset[];
  // The skills' switch (skills.ts): on unless false. Off (the validation's arm
  // C), the conversation has no skills: read_skill is not offered (toolsWithSkills)
  // and no stage waits for one to be read (runToolCall).
  skills?: boolean;
  // The skills read in this conversation (read_skill adds to it). Set on every
  // call the model makes, which gates a stage's changes on its skill; left
  // unset by the app's own calls (the report), which change nothing.
  skillsRead?: Set<string>;
  // The tool results of the conversation's earlier turns: what an answer's
  // numbers may come from besides this reply's own results (agent.ts).
  earlierResults?: readonly string[];
}


export interface ToolOutcome {
  result: unknown;
  summary: string; // one line for the transcript
  view?: ViewTarget;
  // The checks' outcomes the tool judged (verdicts/): beside the result, never
  // in it, so the model reads no more than the result.
  outcomes?: Outcome[];
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
  // The description with the skills off (the switch, skills.ts): without what
  // names a skill or restates a skill's step. Left out: the description names
  // none, and serves either way.
  descriptionWithoutSkills?: string;
  parameters: Record<string, unknown>; // JSON Schema of the arguments
  run: (args: Record<string, unknown>, ctx: ToolContext, io: ToolIO) => Promise<ToolOutcome>;
  maxResultChars?: number; // above MAX_RESULT_CHARS, for a result that must arrive whole (a skill)
}

/** A tool of the registry: what the model reads and runs, and the facts the modules around it read. */
export type ChatTool = AgentTool & { facts: ToolFacts };

/**
 * A tool's description from its text tagged by class (inference.ts): whole as
 * written, and, where it holds inference, its definitions for the skills off.
 * Both come from the one text, so each class is decided once.
 */
const described = (text: Tagged): Pick<AgentTool, "description" | "descriptionWithoutSkills"> =>
  text.hasInference ? { description: text.whole, descriptionWithoutSkills: text.definitions } : { description: text.whole };

/** A tool's description, tagged: registered under the tool's name. */
const description = (tool: string) => written(`tools/index.ts: ${tool}'s description`);

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
// Six figures, so that a check at 0.999 reads apart from 1.
const r6 = (v: number | null | undefined): number | null => (v == null ? null : roundSig(v, 6));
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
        ? `${m.bragg_punch_leftover.n_at_nodes} missed at nodes, ${(m.bragg_punch_leftover.n_off_nodes ?? 0) - (m.bragg_punch_leftover.n_broad_off_nodes ?? 0)} sharp off-lattice, ${m.bragg_punch_leftover.n_broad_off_nodes ?? 0} broad maxima`
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

const measureReciprocalCut: ChatTool = {
  name: "measure_reciprocal_cut",
  facts: { label: "Measured a reciprocal cut", acts: null, highlights: RECIP },
  ...described(
    description("measure_reciprocal_cut")`Compute the stage-quality metrics (ring removal, leftover Bragg peaks, backfill seams, flatten floors) on any reciprocal-space cut — the same metrics as the opening context, which used only the L=0 H–K plane. Use it to check whether a finding holds on other planes or off-zero cuts (e.g. L=0.5${reading(", or K=1/3 for satellites")}).`,
  ),
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

const measureDpdfCut: ChatTool = {
  name: "measure_dpdf_cut",
  facts: { label: "Measured a ΔPDF section", acts: null, offeredFor: ["pdf"], settles: ["features"], highlights: ["pdf"] },
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

const describeDataset: ChatTool = {
  name: "describe_dataset",
  facts: { label: "Read the dataset", acts: null },
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

const LINE_STAGES = [...RECIP_STAGES, "delta_pdf"] as const;
const ALL_AXES = ["H", "K", "L", "x", "y", "z"] as const;

const lineProfile: ChatTool = {
  name: "line_profile",
  facts: {
    label: "Took a line profile",
    acts: null,
    // A line through the ΔPDF measures its correlations.
    settles: (args) => (args.stage === "delta_pdf" ? ["features"] : []),
    highlights: (args) => keysOf([args.stage]),
  },
  ...described(
    description("line_profile")`Intensity along a straight line parallel to one axis through any stage volume${reading(" — e.g. along H through (H, 1/3, 0) to see a satellite row, or across a residual ring")}. Reciprocal stages take H/K/L (r.l.u.); delta_pdf takes x/y/z (Å). Returns sampled points plus the exact maximum, minimum and median.`,
  ),
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

const braggPeaks: ChatTool = {
  name: "bragg_peaks",
  facts: { label: "Looked up Bragg peaks", acts: null, offeredFor: ["punch", "lattice", "general"], highlights: ["bragg"] },
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

const consistencyDetails: ChatTool = {
  name: "consistency_details",
  facts: { label: "Read the back-FFT check", acts: null, offeredFor: ["pdf"], highlights: ["check"] },
  ...described(
    description("consistency_details")`The run's saved back-FFT check in full: Pearson r and normalised RMS of the inverse-FFT ΔPDF against the cleaned data, r per principal plane, the |Q| and r bands, crop and apodization. The transform keeps the real part, which is the data's even part under Q → −Q: pearson_r_even compares the round trip with that part and is 1 when the transform is sound, while r against the data is limited by the odd part (odd_share: counting noise on unsymmetrised data)${evidence(", so r below 1 on unsymmetrised data is no fault")}. Neither says a feature is real.`,
  ),
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
      ...(m.pearson_r_even !== undefined
        ? {
            pearson_r_even: r6(m.pearson_r_even),
            normalized_rms_even: r4(m.normalized_rms_even),
            odd_share: r4(m.odd_share),
          }
        : {}),
    };
    return {
      result,
      summary:
        `r = ${result.pearson_r}, normalised RMS = ${result.normalized_rms}` +
        (result.pearson_r_even != null ? `; against the even part r = ${result.pearson_r_even} (odd share ${result.odd_share})` : ""),
      view: { view: "consistency", label: "the back-FFT check" },
    };
  },
};

const compareDatasets: ChatTool = {
  name: "compare_datasets",
  facts: { label: "Compared datasets", acts: null, offeredFor: ["compare"] },
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

const currentView: ChatTool = {
  name: "current_view",
  facts: { label: "Checked your view", acts: null },
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

const configureSettings: ChatTool = {
  name: "configure_settings",
  facts: { label: "Read the run settings", acts: null, reachesBackend: false },
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

const showInViewer: ChatTool = {
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

const assessStage: ChatTool = {
  name: "assess_stage",
  facts: {
    label: "Assessed a stage",
    acts: null,
    // A stage's verdict; with no stage, or "all", every stage's.
    settles: (args) => TUNE_STAGES.filter((st) => args.stage === undefined || ["all", st].includes(String(args.stage))),
    reportable: true,
    highlights: (args) => {
      const s = typeof args.stage === "string" ? args.stage : "all";
      if (s === "all") return ALL_STAGES;
      const k = stageKey(s);
      return k === "pdf" ? ["pdf", "check"] : k ? [k] : [];
    },
  },
  description:
    "Judge a stage's output against its goal, on the three principal planes through the origin plus the records the stage writes — the evaluation the tuning run judges trials by. rings: ring-energy ratio and over-subtraction per plane; punch: leftover peaks, punched fraction, fitted peaks; backfill: seam σ and bright fills; flatten: shell floors in σ; pdf: back-FFT r and RMS, feature SNR per section. Returns the stage's goal with the numbers. stage=all gives each stage's headline numbers; one stage adds the per-plane detail. Use it for a verdict on a stage, after a run, and before and after a change.",
  parameters: {
    type: "object",
    properties: {
      stage: { type: "string", enum: ASSESS_CHOICES, description: "The stage to judge, or all (default)" },
    },
  },
  run: async (args, ctx) => {
    const { dataset } = ctx;
    // A stage's goal as the skills' switch has it (skills.ts): off, without a skill's step.
    const goals = skillsOn(ctx) ? WORDS.goal : WORDS.goalWithoutSkills;
    const pick = oneOf(args, "stage", ASSESS_CHOICES, "all");
    const stages: TuneStage[] = pick === "all" ? [...TUNE_STAGES] : [pick];
    const result: Record<string, unknown> = {};
    const outcomes: Outcome[] = [];
    const lines: string[] = [];
    let view: ViewTarget | undefined;
    let measuredOn: string[] | undefined;
    for (const stage of stages) {
      if (!stageVolumeId(dataset, STAGE_OUTPUT[stage])) {
        result[stage] = { missing: `no ${STAGE_OUTPUT[stage]} output yet; run_pipeline computes it` };
        outcomes.push(judge(stage, result[stage] as Record<string, unknown>));
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
      // The verdict is computed from the numbers, by the stage's rule
      // (verdicts/), never left to the model (answerChecks.ts holds the model to it).
      const outcome = judge(stage, evaluation, { skills: skillsOn(ctx) });
      outcomes.push(outcome);
      const verdict = outcome.words;
      // All five stages' per-plane detail, or their goals, would overflow the
      // result (MAX_RESULT_CHARS): one stage at a time gives both.
      if (pick === "all") delete evaluation.per_plane;
      result[stage] = {
        verdict,
        criterion: outcome.criterion,
        headline: headline(stage, evaluation),
        ...evaluation,
        ...(pick === "all" ? {} : { goal: goals[stage] }),
      };
      lines.push(`${TUNE_STAGE_LABELS[stage]}: ${verdict} · ${headline(stage, evaluation)}`);
    }
    if (measuredOn) result.measured_on = measuredOn;
    return { result, summary: lines.join(" · ") || "no stage outputs yet", view, outcomes };
  },
};

const radialProfileTool: ChatTool = {
  name: "radial_profile",
  facts: {
    label: "Took a radial profile",
    acts: null,
    offeredFor: ["rings", "backfill", "flatten", "general"],
    // No verdict: a ring is judged in 3D (assess_stage); a radial profile
    // shows a bump on one plane only.
    highlights: (args) => (args.stages === undefined ? ["raw", ...RECIP] : keysOf(args.stages)),
  },
  ...described(
    description("radial_profile")`The median intensity in |Q| shells of one reciprocal cut, for each cleanup stage side by side (raw, ringremoved, braggpunched, backfilled, flattened). Shell medians ignore Bragg peaks but follow powder rings${evidence(", which are bumps in raw that ring removal should take out without denting the diffuse")}${reading("; after flatten the floor should sit near 0 at every |Q|")}. Use it to see where in |Q| a stage left or removed signal.`,
  ),
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

const runLog: ChatTool = {
  name: "run_log",
  facts: { label: "Read the run log", acts: null, reachesBackend: false, highlights: ["log"] },
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

const textureCheck: ChatTool = {
  name: "texture_check",
  facts: {
    label: "Checked for texture",
    acts: null,
    // A generic question too: the system prompt's method checks the fill (the user's decision, Q10, 2026-10-19).
    offeredFor: ["rings", "backfill", "general"],
    settles: ["backfill"],
    reportable: true,
    highlights: ["punch", "backfill"],
  },
  ...described(
    description("texture_check")`Check whether the punch and backfill printed a pattern of their own into reciprocal space, on a cut (default: the three principal planes through the origin). Fill bias: each filled hole against the range its measured rim allows, from the diffuse at the hole's edge carried in to its rise toward the node continued linearly${evidence(" (the diffuse often peaks at the nodes, so a sound fill sits above its rim's median)")}; the part outside that range, signed, in the rim's σ and in units of the local diffuse level. Holes filled systematically outside it (systematic_fill_bias: 75 % of them one way, a median of 0.5σ and a fifth of the level or more)${evidence(" add a lattice-periodic texture that the ΔPDF turns into features at lattice vectors")}. Azimuthal texture: per |Q| shell, how much the sector means vary around the shell before the punch (unpunched voxels) and after the backfill${evidence("; a ratio near 1 adds none")}.`,
  ),
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
    const result = { per_cut: rows };
    return {
      result,
      outcomes: [judge("texture", result)],
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

// Two evaluations with the same numbers: the change had no measurable effect.
const sameNumbers = (a: StageEvaluation | undefined, b: StageEvaluation | undefined): boolean =>
  !!a && !!b && JSON.stringify(a) === JSON.stringify(b);

const symmetryCheck: ChatTool = {
  name: "symmetry_check",
  facts: {
    label: "Checked the ΔPDF's symmetry",
    acts: null,
    offeredFor: ["pdf", "symmetry", "general"],
    settles: ["symmetry"],
    reportable: true,
  },
  ...described(
    description("symmetry_check")`Check that the 3D-ΔPDF keeps the in-plane symmetry of the cell, when the file declares that its data were symmetrised${evidence(" (with none declared the asymmetry is the data's own and is not judged)")}: an x–y section (default z = 0) compared with its image under each in-plane operation (hexagonal: six-, three-, two-fold and the a ↔ b mirror; orthogonal: the mirrors ⊥ a and ⊥ b, the two-fold, and the four-fold when a = b), as the RMS of the difference over the section's RMS. A symmetry the data were symmetrised with holds to about 1e-3 or better when the pipeline kept it${evidence("; a larger share means a stage broke it, or the sample lacks that operation")}. Which operations the sample has is the user's to say.`,
  ),
  parameters: {
    type: "object",
    properties: { z: { type: "number", description: "Height of the x–y section along c, in Å (default 0)" } },
  },
  run: async (args, ctx) => {
    const { dataset } = ctx;
    const z = args.z === undefined ? 0 : num(args, "z");
    const meta = await dpdfMeta(dataset);
    const slice = await fetchDpdfSlice(dpdfVolumeId(dataset)!, "xy", z);
    // The point group the raw file declares its data were symmetrised with; none read: not known.
    const rawId = stageVolumeId(dataset, "raw") ?? hklVolumeId(dataset);
    const rawMeta = rawId ? await safe(fetchMeta(rawId)) : null;
    const declared = rawMeta ? rawMeta.symmetry ?? null : undefined;
    const { a, b } = meta.lattice ?? {};
    const sym = a && b ? sectionSymmetry(slice, { a, b }) : null;
    const outcome = judge("symmetry", { ops: sym?.ops ?? null, declared }, { skills: skillsOn(ctx) });
    if (!sym) {
      return {
        result: { note: "no in-plane symmetry to test: the cell is neither hexagonal nor orthogonal, or the section is not centred on the origin" },
        summary: "nothing to test",
        outcomes: [outcome],
      };
    }
    const holds = sym.ops.filter((o) => o.rms_difference <= SYMMETRY_HOLDS).map((o) => o.op);
    const broken = sym.ops.filter((o) => o.rms_difference > SYMMETRY_HOLDS).map((o) => `${o.op} (${o.rms_difference})`);
    return {
      result: {
        section: `ΔPDF x–y section at z = ${z} Å`,
        cell: sym.kind,
        ops: sym.ops,
        holds,
        symmetry_declared: declared === undefined ? null : Boolean(declared),
        // Judged by the symmetry's rule (verdicts/): not judged where the file declares none.
        verdict: outcome.words,
      },
      outcomes: [outcome],
      summary:
        declared === null || declared === ""
          ? "no symmetry declared: not judged"
          : broken.length
            ? `not kept: ${broken.join(", ")}`
            : "every in-plane operation holds",
      view: dpdfView(meta, "xy", z),
    };
  },
};

// The q-quantile of ascending magnitudes.
const quantileOf = (sorted: number[], q: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];

const dpdfContrast: ChatTool = {
  name: "dpdf_contrast",
  facts: {
    label: "Set the ΔPDF's contrast",
    // It sets the ΔPDF viewer's colour limit: what the console shows.
    acts: "view",
    invalidates: ["view"],
    offeredFor: ["pdf"],
  },
  description:
    "Optimise the 3D-ΔPDF viewer's colour range, so the pair-correlation features carry the colour and the FFT ripple around them stays dim. Call it once, without arguments: it measures the three centre sections (xy, xz, yz through the origin; the origin's self-correlation disk left out), sets the limit at the 99.9th percentile of |ΔPDF|, the page's Auto, and lists what the 99.5th and 99.97th percentiles would give without applying them. Pass percentile (99–99.99) or limit_sigma only for a range the user asks for: a limit of a few σ colours the ripple, as the old Auto (the 97th percentile) did. reset returns the viewer to Auto. Quote the applied limit it returns.",
  parameters: {
    type: "object",
    properties: {
      percentile: { type: "number", description: "Only when the user asks: percentile of |ΔPDF| for the limit, 99–99.99" },
      limit_sigma: { type: "number", description: "Only when the user asks: the ± limit in units of the sections' robust σ" },
      reset: { type: "boolean", description: "Return the viewer to Auto" },
    },
  },
  run: async (args, { dataset }) => {
    const meta = await dpdfMeta(dataset);
    const view = dpdfView(meta, "xy", 0);
    if (args.reset === true) {
      useDpdfStore.getState().setLimit(null);
      return { result: { applied: "Auto: the 99.9th percentile of |ΔPDF|" }, summary: "back on Auto", view };
    }
    const id = dpdfVolumeId(dataset)!;
    const sections = await Promise.all(["xy", "xz", "yz"].map((plane) => fetchDpdfSlice(id, plane, 0)));
    const values: number[] = [];
    for (const s of sections) for (const v of withoutOrigin(s)) if (Number.isFinite(v)) values.push(v);
    if (values.length < 16) throw new Error("the ΔPDF sections hold too few values to measure");
    const centre = median(values);
    const sigma = 1.4826 * median(values.map((v) => Math.abs(v - centre)));
    const mags = values.map(Math.abs).sort((a, b) => a - b);
    const strongest = mags[mags.length - 1];
    const inSigma = (x: number) => (sigma > 0 ? roundSig(x / sigma, 3) : null);
    const coloured = (limit: number) => {
      let n = 0;
      for (const m of mags) if (m >= 0.1 * limit) n += 1;
      return roundSig(n / mags.length, 2);
    };
    const describe = (limit: number) => ({
      limit: roundSig(limit, 3),
      limit_sigma: inSigma(limit),
      share_of_strongest: roundSig(limit / strongest, 2),
      coloured_fraction: coloured(limit), // |ΔPDF| above a tenth of the limit
    });
    const optimum = quantileOf(mags, DPDF_AUTO_PERCENTILE);
    let limit = optimum;
    let from = "optimised: the 99.9th percentile of |ΔPDF|";
    if (args.limit_sigma !== undefined) {
      const k = num(args, "limit_sigma");
      if (!(k > 0)) throw new ToolArgError("limit_sigma must be positive");
      if (!(sigma > 0)) throw new Error("the sections' robust σ is 0; give a percentile instead");
      limit = k * sigma;
      from = `${k} × the robust σ, as asked`;
    } else if (args.percentile !== undefined) {
      const p = num(args, "percentile");
      if (!(p >= 99 && p <= 99.99)) throw new ToolArgError("percentile must be within [99, 99.99]");
      limit = quantileOf(mags, p / 100);
      from = `the ${p}th percentile of |ΔPDF|, as asked`;
    }
    if (!(limit > 0)) throw new Error("the limit came out 0: the sections are empty");
    useDpdfStore.getState().setLimit({ value: limit, dataset: dataset.id });
    const applied = { ...describe(limit), from };
    return {
      result: {
        applied,
        ...(limit < 0.9 * optimum
          ? { note: "brighter than the optimum (the 99.9th percentile): the FFT ripple around the features will show" }
          : {}),
        robust_sigma: roundSig(sigma, 3),
        strongest_feature_sigma: inSigma(strongest),
        not_applied: {
          "99.5th percentile": { ...describe(quantileOf(mags, 0.995)), effect: "a lower limit: brighter, weaker correlations and more of the ripple coloured" },
          "99.97th percentile": { ...describe(quantileOf(mags, 0.9997)), effect: "a higher limit: dimmer, only the strongest features coloured" },
        },
        sections: "xy, xz and yz through the origin, the origin's disk left out",
      },
      summary: `± ${applied.limit} (${applied.limit_sigma ?? "–"}σ, ${applied.share_of_strongest} of the strongest feature) · ${roundSig(applied.coloured_fraction * 100, 2)} % coloured`,
      view,
    };
  },
};

// How many of a group's vectors the model reads (the group's n says how many there are).
const PEAK_VECTORS = 4;

// How dpdf_peaks' entries read; which of them are no pair correlations is inference (inference.ts).
const PEAKS_READING = written("tools/index.ts: dpdf_peaks' reading")`Each entry: the sign, |r|, the largest size in σ, how many vectors (one per ± pair) share them, and up to ${PEAK_VECTORS} of those vectors in lattice units (x/a, y/b, z/c) and in Å along a, b, c. The size is against the volume's robust σ outside the origin's disk${evidence(
  "; features nearer the origin than the shortest interatomic distance are not pair correlations",
)}.`;

// The skill's order (the trust checks before the features) and its name are
// inference here: with the skills off the description has neither.
const dpdfPeaks: ChatTool = {
  name: "dpdf_peaks",
  facts: { label: "Listed the ΔPDF's strongest features", acts: null, offeredFor: ["pdf"], settles: ["features"] },
  ...described(
    description("dpdf_peaks")`The 3D-ΔPDF's strongest features, read from the whole volume rather than one section: its local extrema above min_sigma (default 5) robust σ of the volume outside the origin's disk, each with its vector in Å along a, b, c and in lattice units, its sign (+: more pairs at that vector than the average structure has, −: fewer) and its size in σ. The ΔPDF is centrosymmetric, so each ± pair is listed once. Extrema of one sign, length and size are one entry (n_vectors)${evidence(": copies of one correlation under the crystal's symmetry, most likely")}, though the grouping does not use the symmetry and two correlations can share a length. Use it for the strongest pair correlations with their vectors and signs${reading(", after the trust checks (qmax_coverage, symmetry_check on symmetrised data, assess_stage pdf)")}. What size is worth interpreting, and what a feature means, is the user's call${reading(" (delta-pdf-interpretation)")}. Quote the vectors, signs and sizes it returns.`,
  ),
  parameters: {
    type: "object",
    properties: {
      min_sigma: { type: "number", description: "Smallest |ΔPDF| listed, in robust σ (3–1000; default 5)" },
      limit: { type: "integer", minimum: 1, maximum: 30, description: "How many entries, strongest first (default 12)" },
    },
  },
  run: async (args, ctx) => {
    const { dataset } = ctx;
    const minSigma = num(args, "min_sigma", 5);
    if (!(minSigma >= 3 && minSigma <= 1000)) throw new ToolArgError("min_sigma must be within [3, 1000]");
    const limit = Math.round(num(args, "limit", 12));
    if (limit < 1 || limit > 30) throw new ToolArgError("limit must be within [1, 30]");
    const meta = await dpdfMeta(dataset);
    const f = await fetchDpdfFeatures(dpdfVolumeId(dataset)!, minSigma, limit);
    const sign = (s: number) => (s > 0 ? "+" : "−");
    const vec = (v: number[] | null, digits: number) => (v ? v.map((x) => roundSig(x, digits) + 0) : null);
    const features = f.groups.map((g) => ({
      sign: sign(g.sign),
      length_A: roundSig(g.length, 4),
      size_sigma: roundSig(g.size_sigma, 3),
      n_vectors: g.n,
      vectors_rlu: g.vectors_rlu.slice(0, PEAK_VECTORS).map((v) => vec(v, 3)),
      vectors_A: g.vectors.slice(0, PEAK_VECTORS).map((v) => vec(v, 4)),
    }));
    const result = {
      features,
      robust_sigma: f.sigma == null ? null : roundSig(f.sigma, 3),
      threshold_sigma: f.min_sigma,
      origin_disk_A: roundSig(f.origin_radius, 3),
      extrema_above_threshold: f.n_extrema,
      reading: PEAKS_READING.text(skillsOn(ctx)),
    };
    const top = f.groups[0];
    const where = top ? `(${vec(top.vectors_rlu[0] ?? top.vectors[0], 3)!.join(", ")})${top.vectors_rlu[0] ? " r.l.u." : " Å"}` : "";
    return {
      result,
      summary: top
        ? `${f.n_extrema} extrema above ${f.min_sigma}σ; strongest ${sign(top.sign)} at ${where}, ${roundSig(top.length, 3)} Å, ${roundSig(top.size_sigma, 3)}σ`
        : `no extremum above ${f.min_sigma}σ outside the origin's disk`,
      view: dpdfView(meta, "xy", top ? Math.min(Math.max(top.vectors[0][2], meta.z_range[0]), meta.z_range[1]) : 0),
    };
  },
};

const grainCheckTool: ChatTool = {
  name: "grain_check",
  facts: {
    label: "Checked for a second grain",
    acts: null,
    offeredFor: ["punch", "lattice"],
    // It measures the Bragg peaks' offset from their nodes too: evidence on the UB.
    settles: ["grain", "ub"],
    reportable: true,
  },
  ...described(
    description("grain_check")`Is there a second grain, and what are the sharp off-lattice peaks the punch's search found? It takes the punch's peak record, groups the off-lattice peaks into symmetry orbits (the declared point group), and tests the strongest two ways. Against the Bragg nodes: an orbit within a quarter of the node spacing of one is that peak displaced, and its offset over |Q| is a rotation angle (${evidence("symmetrising data whose UB is slightly off makes such copies; ")}the angle is a lower bound). As a rotated copy of the Bragg lattice: a second grain is one rotation that indexes most strong orbits, judged against the same search at random directions; a rotation under 2° is the UB, not a grain. Run the punch first. Quote its verdict and numbers.`,
  ),
  parameters: {
    type: "object",
    properties: { top: { type: "number", description: "How many of the strongest orbits to test, 8–120 (default 40)" } },
  },
  run: async (args, ctx) => {
    const { dataset } = ctx;
    const top = Math.round(num(args, "top", 40));
    if (!(top >= 8 && top <= 120)) throw new ToolArgError("top must be within [8, 120]");
    const rawId = stageVolumeId(dataset, "raw") ?? hklVolumeId(dataset);
    const [profile, meta] = await Promise.all([safe(fetchBraggProfile(dataset.id)), rawId ? safe(fetchMeta(rawId)) : null]);
    if (!profile?.has_profile) throw new Error("no punch record yet: run the punch first");
    if (!meta?.ub_matrix) throw new Error("the raw volume carries no UB matrix");
    const peaks = profile.peaks
      .filter((p) => p.source_node_hkl == null && p.intensity != null)
      .map((p) => ({ hkl: p.center_hkl, intensity: (p.intensity as number) - (p.local_background ?? 0) }));
    const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const ops = (meta.symmetry_ops?.length ? meta.symmetry_ops : [identity]) as Parameters<typeof grainCheck>[0]["ops"];
    const s = usePipelineStore.getState();
    const cell = [s.punchSupercellH, s.punchSupercellK, s.punchSupercellL].map((v) => Number(v) || 1) as [number, number, number];
    const facts = grainCheck({ peaks, ub: meta.ub_matrix as Parameters<typeof grainCheck>[0]["ub"], ops, cell, top });
    // The grain's rule (verdicts/) judges the unrounded facts and writes the verdict.
    const outcome = judge("grain", facts, { skills: skillsOn(ctx) });
    const g = shownGrains(facts, outcome.words!);
    return {
      result: { ...g, off_lattice_peaks: peaks.length, declared_symmetry: meta.symmetry ?? null, punch_cell: cell },
      summary: g.verdict.length > 160 ? `${g.verdict.slice(0, 157)}…` : g.verdict,
      outcomes: [outcome],
    };
  },
};

const sig2 = (x: number): number => Number(x.toPrecision(2));

// The peaks sit off their nodes by more than a quarter voxel, and the best UB
// takes away less than a fifth of it: something other than the UB moved them.
export const unexplainedOffset = (u: { rms_start: number; rms: number; voxel_q?: number | null }): boolean =>
  u.voxel_q != null && u.voxel_q > 0 && u.rms_start > 0.25 * u.voxel_q && u.rms > 0.8 * u.rms_start;

/**
 * The HKL origin's shift (r.l.u.), or null: the centres' mean offset from their
 * nodes after the fit, when the offsets are unexplained by any UB and that one
 * vector makes 0.8 or more of the RMS the fit leaves. A UB error offsets node h
 * by (T − I)·h, which averages to zero over a centrosymmetric set of nodes and
 * which the fit removes; a shifted origin moves every peak by the same vector,
 * which no UB (a linear map) can remove, so it is the mean after the fit, and
 * |UB·mean| is then most of the RMS. The 0.8 is unexplainedOffset's.
 */
export function originShift(u: Pick<UbCheck, "rms_start" | "rms" | "voxel_q" | "ub" | "mean_offset_rlu">): number[] | null {
  const after = u.mean_offset_rlu?.after;
  if (!unexplainedOffset(u) || !after || after.some((x) => x == null || !Number.isFinite(x))) return null;
  const v = after as number[];
  const q = Math.hypot(...[0, 1, 2].map((i) => u.ub[i][0] * v[0] + u.ub[i][1] * v[1] + u.ub[i][2] * v[2]));
  return q >= 0.8 * u.rms ? v : null;
}

const rlu = (v: (number | null)[]): string => `(${v.map((x) => (x == null ? "–" : x.toFixed(4))).join(", ")})`;

// What ub_check's reading infers from an offset no UB explains: the result
// built for each call takes them from here (inference.ts).
const UB_ORIGIN_SHIFTED = inference("tools/index.ts: ub_check's reading", "evidence", ", the HKL origin shifted by about that much, which no UB can make");
const UB_REPORT_ORIGIN = inference("tools/index.ts: ub_check's reading", "remedy", " Report the origin, not the UB.");
const UB_LOOK_ELSEWHERE = inference("tools/index.ts: ub_check's reading", "remedy", " Look at the origin of the HKL grid, or at how |Q| was assigned, not at the UB.");

// How to read radial (a UB error gives the same relative offset at every |Q|
// along a direction) is reduction-qc's step 2, word for word; it and what a
// UB error and an origin shift do to mean_offset_rlu are inference.
const ubCheckTool: ChatTool = {
  name: "ub_check",
  // Offered for a generic question too: the system prompt's method checks the UB (the user's decision, Q10, 2026-10-19).
  // Reportable, as the other checks on the result are: the report runs it, and names what it finds (Q11).
  facts: { label: "Checked the UB", acts: null, offeredFor: ["punch", "lattice", "general"], settles: ["ub", "origin"], reportable: true },
  ...described(
    description("ub_check")`Is the volume's UB right? On the raw volume it finds each Bragg node's peak (the punch cell gives the Bragg nodes: (2, 2, 2) on a doubled cell), measures its centre, and fits the UB that puts the centres back on their nodes, from low |Q| outward. A volume symmetrised under the operations it declares hides a misorientation as rings around the nodes, not shifts, so there it fits only the changes that commute with the operations (fit 'symmetric': for 6/mmm the scales of the hk plane and of l); otherwise the rotation and the cell together ('both'). radial is the peaks' median offset along Q from their nodes, relative to |Q|, per |Q| band and direction, before and after the fit${evidence(": a UB error gives the same relative offset at every |Q| along a direction, so one that changes with |Q| is not a UB error, and refining the UB only averages it")}. mean_offset_rlu is the peaks' mean offset from their nodes in r.l.u., before and after the fit${evidence(": a UB error averages out over the nodes and the fit removes it, while a shifted HKL origin moves every peak by one vector that stays after the fit")} (origin_shift_rlu, when that vector makes most of the offset the fit leaves). About ten seconds on a full volume. Quote rms_start → rms, the cell before and after, the angle, what radial shows, and an origin shift when it gives one.`,
  ),
  parameters: {
    type: "object",
    properties: { q_max: { type: "number", description: "The nodes' |Q| limit in Å⁻¹ (default: everything the box holds)" } },
  },
  run: async (args, ctx) => {
    const { dataset } = ctx;
    const qMax = args.q_max == null ? null : num(args, "q_max", 0);
    if (qMax != null && !(qMax > 0)) throw new ToolArgError("q_max must be positive");
    const rawId = stageVolumeId(dataset, "raw") ?? hklVolumeId(dataset);
    if (!rawId) throw new Error("this dataset has no raw volume");
    const s = usePipelineStore.getState();
    const cell = [s.punchSupercellH, s.punchSupercellK, s.punchSupercellL].map((v) => Number(v) || 1) as [number, number, number];
    const u = await fetchUbCheck(rawId, cell, qMax);
    const cellText = (c: number[]) => `${c.slice(0, 3).map((x) => x.toFixed(4)).join(", ")} Å; ${c.slice(3).map((x) => x.toFixed(3)).join("°, ")}°`;
    const shift = originShift(u);
    const result = {
      fit: u.fit,
      bragg_nodes_every: u.cell_nodes,
      symmetry_from: u.operations_from,
      symmetrised: u.symmetrised,
      symmetry_break: u.symmetry_break == null ? null : sig2(u.symmetry_break),
      peaks: { searched: u.n_searched, used: u.n_used, rejected: u.n_rejected },
      rms_start: Number(u.rms_start.toFixed(4)),
      rms: Number(u.rms.toFixed(4)),
      cell_start: cellText(u.cell_start),
      cell: cellText(u.cell),
      orientation_change_deg: Number(u.angle_deg.toFixed(3)),
      axis_uvw: u.axis_uvw.map((x) => Number(x.toFixed(3))),
      transform_diagonal: u.transform.map((row, i) => Number(row[i].toFixed(6))),
      passes: u.passes.map((p) => ({ q_max: Number(p.q_max.toFixed(2)), found: p.n_found, used: p.n_used, rms: `${p.rms_start.toFixed(4)} → ${p.rms.toFixed(4)}` })),
      radial: u.radial.map((o) => ({ q: o.q_hi == null ? `≥ ${o.q_lo}` : `${o.q_lo}–${o.q_hi}`, direction: o.direction, n: o.n, before: sig2(o.before), after: sig2(o.after) })),
      // Offsets well above the centring's own scatter that the fit cannot
      // remove are not a UB error: a shifted HKL origin, or |Q| assigned wrong.
      unexplained: unexplainedOffset(u),
      // The centres' mean offset from their nodes, r.l.u.: what an origin shift is.
      mean_offset_rlu: u.mean_offset_rlu
        ? {
            before: u.mean_offset_rlu.before.map((x) => (x == null ? null : Number(x.toFixed(4)))),
            after: u.mean_offset_rlu.after.map((x) => (x == null ? null : Number(x.toFixed(4)))),
            standard_error: u.mean_offset_rlu.standard_error.map((x) => (x == null ? null : sig2(x))),
          }
        : null,
      origin_shift_rlu: shift ? shift.map((x) => Number(x.toFixed(4))) : null,
      // What was fitted, and what the fit left, as the skills' switch has it (inference.ts).
      reading: joined(
        [
          u.fit === "symmetric"
            ? "The volume is symmetrised: only the UB changes that commute with its operations were fitted; a misorientation needs the unsymmetrised data."
            : u.operations_from
              ? `The rotation and the cell were fitted together, the cell constrained by the operations ${u.operations_from} declares.` +
                (u.symmetry_break == null ? " They do not map this volume's grid, so whether it is symmetrised was not judged." : "")
              : "The rotation and the cell were fitted together; no symmetry was declared, so the cell was left free (triclinic).",
          ...(unexplainedOffset(u)
            ? [
                built`The fit removed little of the peaks' offset (RMS ${u.rms_start.toFixed(4)} → ${u.rms.toFixed(4)} Å⁻¹, against a voxel of ${u.voxel_q!.toFixed(4)} Å⁻¹): no UB change explains it.${
                  shift
                    ? built` Every peak sits a mean ${rlu(shift)} r.l.u. off its node, after the fit as before it: one vector moves them all${UB_ORIGIN_SHIFTED}.${UB_REPORT_ORIGIN}`
                    : UB_LOOK_ELSEWHERE
                }`,
              ]
            : []),
        ],
        " ",
      ).text(skillsOn(ctx)),
    };
    return {
      result,
      summary:
        `${u.fit}: RMS ${u.rms_start.toFixed(4)} → ${u.rms.toFixed(4)} Å⁻¹ over ${u.n_used} peaks; a ${u.cell_start[0].toFixed(3)} → ${u.cell[0].toFixed(3)} Å, c ${u.cell_start[2].toFixed(3)} → ${u.cell[2].toFixed(3)} Å; turned ${u.angle_deg.toFixed(3)}°` +
        (shift ? `; origin shifted ${rlu(shift)} r.l.u.` : ""),
      // No verdict in the result: the UB's rule (verdicts/) judges what the fit found.
      outcomes: [judge("ub", result)],
    };
  },
};

const qmaxCoverage: ChatTool = {
  name: "qmax_coverage",
  facts: {
    label: "Checked Qmax against coverage",
    acts: null,
    offeredFor: ["pdf", "coverage", "general"],
    settles: ["coverage"],
    reportable: true,
    highlights: ["raw", "pdf"],
  },
  description:
    "Check that the forward transform (data → 3D-ΔPDF) does not reach past the measured reciprocal space. When the ΔPDF on disk records it, the verdict is the share of its window's weight on unmeasured space (≲ 1e-3 is clean), with the window's shape and scale. On the three principal planes through the origin it measures the share of each |Q| shell that was measured (finite in raw), the |Q| where shells stop being fully (95 %) measured, and where the data box ends, and compares them with how far the transform's window reaches: the |Q| band if one is set, else the box faces, the coverage edge when the window is tapered to the coverage, or the box corners when apodization is off with a separable window. The reach comes from the Configure page's settings, which may differ from the ones that made the ΔPDF on disk. From the raw volume, raw_counts gives where its counts begin and end in |Q| (beyond those edges most voxels hold no counts) and the box's nearest face; suggested_band is the |Q| band they allow, and band_check says whether a band that is set stays inside the counts. When the counts end inside the box and no band is set, the verdict says so, with the edge and the band they allow (counts_end_inside_box).",
  parameters: { type: "object", properties: {} },
  run: async (_args, ctx) => {
    const { dataset } = ctx;
    const meta = await recipMeta(dataset);
    const rawId = stageVolumeId(dataset, "raw") ?? hklVolumeId(dataset)!;
    const rawCounts = safe(fetchVolumeCoverage(rawId));
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
    const settled = windowReach(s, { corner: cornerQ, box: boxQ, full: fullQ });
    // An ellipsoid window (what a lattice whose symmetry mixes axes gets) is
    // inscribed in the box: its reach varies with direction, and only the
    // recorded weight on unmeasured space says whether it stays measured.
    const { reach, how } =
      dmeta?.window_shape === "ellipsoid" && !s.pdfQMax
        ? { reach: settled.reach, how: "an ellipsoid window inscribed in the box (its reach varies with direction; box_face_q is the nearest face)" }
        : settled;
    const shell = boxQ != null ? boxQ / COVERAGE_SHELLS : 0; // the coverage edge is known to one shell
    // The ΔPDF on disk records its window and the share of the window's weight
    // on unmeasured space: the direct measure of a reach past the coverage.
    const openWeight = dmeta?.window_open_weight ?? null;
    const windowNote = dmeta?.window_shape
      ? `the ΔPDF's ${dmeta.window_shape} window${dmeta.window_scale != null && dmeta.window_scale < 1 ? ` (shrunk to ${roundSig(dmeta.window_scale, 3)} × to fit the coverage)` : ""}`
      : "the ΔPDF's window";
    const counts = await rawCounts;
    const band = rawBand(counts, s.pdfQMin, s.pdfQMax);
    // The verdict, by the coverage's rule (verdicts/): the recorded weight
    // when there is one, else the reach against full coverage, and where the
    // raw counts end when no band is set.
    const outcome = judge("coverage", {
      window_weight: openWeight,
      window: windowNote,
      unit_cell: Boolean(qRadius("hk0", 0, meta)),
      full_coverage_q: fullQ,
      reach,
      reach_from: how,
      shell,
      band_set: Boolean(s.pdfQMax),
      counts: band,
    }, { skills: skillsOn(ctx) });
    const verdict = outcome.words!;
    return {
      result: {
        verdict,
        window_weight_on_unmeasured: openWeight,
        window_shape: dmeta?.window_shape ?? null,
        window_scale: dmeta?.window_scale ?? null,
        transform_reach_q: reach == null ? null : roundSig(reach, 4),
        reach_from: how,
        full_coverage_q: fullQ,
        box_face_q: boxQ,
        box_corner_q: cornerQ == null ? null : roundSig(cornerQ, 4),
        low_q_gap: pick("low_q_gap").length ? Math.max(...pick("low_q_gap")) : null,
        ...band,
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
      outcomes: [outcome],
    };
  },
};

// Where the raw counts begin and end in |Q| (most voxels past an edge hold no
// counts), the band that keeps inside them, and whether the band that is set
// does.  The box can end first along one axis: past box_face_q the window,
// not the band, limits the reach in that direction.
// The counts end inside the box when their upper edge sits at least one of
// q_coverage's shells (0.1 Å⁻¹, the edge's own resolution) inside its nearest
// face: then part of every direction's reach is empty, not only the corners.
const COUNTS_EDGE_SHELL = 0.1;

function rawBand(c: VolumeCoverage | null, qMinSet: string, qMaxSet: string) {
  if (!c) return { counts_end_inside_box: false as const };
  const lo = c.q_min_edge != null ? Math.ceil(c.q_min_edge * 20) / 20 : 0;
  const hi = c.q_max_edge != null ? Math.floor(c.q_max_edge * 20) / 20 : null;
  const qMin = qMinSet ? Number(qMinSet) : null;
  const qMax = qMaxSet ? Number(qMaxSet) : null;
  const inside = c.q_max_edge != null && c.q_max_edge <= c.box_q - COUNTS_EDGE_SHELL;
  const problems: string[] = [];
  if (qMax != null) {
    if (qMin == null || qMin < lo - 0.025) problems.push(`Qmin below the counts' lower edge (${roundSig(c.q_min_edge ?? 0, 3)} Å⁻¹): the beam stop's empty voxels enter the transform`);
    if (hi != null && qMax > hi + 0.025) problems.push(`Qmax past the counts' upper edge (${roundSig(c.q_max_edge!, 4)} Å⁻¹): empty voxels enter the transform`);
  }
  return {
    raw_counts: {
      q_min_edge: c.q_min_edge == null ? null : roundSig(c.q_min_edge, 3),
      q_max_edge: c.q_max_edge == null ? null : roundSig(c.q_max_edge, 4),
      fully_measured: c.full_q_min != null && c.full_q_max != null ? [roundSig(c.full_q_min, 3), roundSig(c.full_q_max, 4)] : null,
      box_face_q: roundSig(c.box_q, 4),
    },
    suggested_band: hi != null ? [lo, hi] : null,
    counts_end_inside_box: inside,
    band_check:
      qMax == null
        ? "no |Q| band is set: the transform takes every voxel, empty ones included, up to the window's reach" +
          (inside && hi != null
            ? `; the counts end at ${roundSig(c.q_max_edge!, 4)} Å⁻¹, inside the box (face ${roundSig(c.box_q, 4)} Å⁻¹): the band they allow is ${lo}–${hi} Å⁻¹`
            : "")
        : problems.length
          ? problems.join("; ")
          : `the band ${qMin ?? 0}–${qMax} Å⁻¹ stays inside the counts`,
  };
}

// ---------------------------------------------------------------- actions

// Neither acts while a run or a tuning run is going: both own the pipeline.
const checkIdle = () => {
  if (usePipelineStore.getState().running) throw new Error("a pipeline run is in progress; wait for it to end");
  if (useTuneStore.getState().active) throw new Error("a tuning run is in progress; wait for it to end");
};

const SETTABLE = [...TUNE_PARAMS, ...SAMPLE_PARAMS];
const findParam = (key: string): TuneParam | undefined => SETTABLE.find((p) => p.key === key);

// The stage of each setting, for the skill gate (skills.ts).
const SETTING_STAGE = new Map([...TUNE_PARAMS, ...SAMPLE_PARAMS].map((p) => [p.key as string, p.stage]));
const unique = <T>(xs: T[]): T[] => [...new Set(xs)];

const allowedValues = (p: TuneParam): string =>
  p.kind === "enum"
    ? p.options!.map((o) => o.name).join("|")
    : p.kind === "boolean"
      ? "true|false"
      : p.kind === "fractions"
        ? 'H fractions like "1/3, 2/3", or none'
        : `${p.kind} ${p.min}–${p.max}`;

const updateSettings: ChatTool = {
  name: "update_settings",
  facts: {
    label: "Changed settings",
    acts: "settings",
    reachesBackend: false,
    invalidates: ["settings"],
    // The stages of the method choices and thresholds it changes.
    highlights: (args) => {
      const changes = args.changes && typeof args.changes === "object" ? Object.keys(args.changes) : [];
      return keysOf(changes.map((key) => TUNE_PARAMS.find((p) => p.key === key)?.stage));
    },
    // The stages of the settings it changes, the sample's facts included.
    gate: {
      doing: "change",
      stages: (args) => {
        const changes = args.changes;
        if (!changes || typeof changes !== "object" || Array.isArray(changes)) return [];
        return unique(Object.keys(changes).flatMap((k) => (SETTING_STAGE.has(k) ? [SETTING_STAGE.get(k)!] : [])));
      },
    },
  },
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

const runPipeline: ChatTool = {
  name: "run_pipeline",
  facts: {
    label: "Ran the pipeline",
    runningLabel: "Running the pipeline",
    acts: "run",
    // It writes the stage outputs, and moves the console to the Execution page.
    invalidates: ["outputs", "view"],
    reportable: true,
    highlights: (args) => (args.from_stage === undefined ? ALL_STAGES : keysOf([args.from_stage])),
  },
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

const tunePipeline: ChatTool = {
  name: "tune_pipeline",
  facts: {
    label: "Tuned the pipeline",
    runningLabel: "Tuning the pipeline",
    acts: "tune",
    // Its trials run in a tuning folder: the chosen settings end up on the
    // Configure page, the dataset's outputs stay as they were. It moves the
    // console to the Execution page.
    invalidates: ["settings", "view"],
    reportable: true,
    highlights: (args) => (args.stages === undefined ? ALL_STAGES : keysOf(args.stages)),
    gate: {
      doing: "tuning",
      stages: (args) => {
        const stages = Array.isArray(args.stages) && args.stages.length ? args.stages : TUNE_STAGES;
        return unique(stages.filter((s): s is TuneStage => (TUNE_STAGES as readonly unknown[]).includes(s)));
      },
    },
  },
  description:
    "Search for the best settings, one stage at a time: for each stage it runs the current settings, has you " +
    "propose alternatives, runs each, judges which best meets the stage's goal, keeps it and moves on, so later " +
    "stages build on the best earlier ones. Trials run in a tuning folder: the dataset's own outputs are not " +
    "changed, and the chosen settings end up on the Configure page. The user watches the trials in the chat, under " +
    "this reply, and each run on the Execution page. Takes minutes (one run per trial). Returns every trial's changes " +
    "and numbers (a trial that matched the current settings' numbers exactly is marked no_effect), and each stage's " +
    "chosen trial and why: quote these, never numbers the result does not hold.",
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
      // The tuning prompts read the skills' switch too: off, a stage's goal and settings without a skill's step.
      await startTuning({ dataset: ctx.dataset, stages, trialsPerStage: trials, llm: loadSettings(), skills: skillsOn(ctx) });
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
          // Every trial, so the comparison can be quoted rather than recalled.
          ...(r.tuned && r.trials.length > 1 && {
            trials: r.trials.map((t) => ({
              n: t.n,
              changes: t.changes,
              ...(t.evaluation
                ? {
                    result: headline(r.stage, t.evaluation),
                    ...(t.n !== 1 && sameNumbers(t.evaluation, r.trials[0].evaluation) && { no_effect: true }),
                  }
                : { status: t.status, ...(t.error && { error: t.error }) }),
            })),
          }),
          ...(r.why && { why: r.why }),
          ...(r.message && { message: r.message }),
        };
      }),
      note: tune.finishedNote,
    };
    const changed = result.stages.filter((r) => r.changes && Object.keys(r.changes).length).length;
    // Writing the dataset's outputs is worth it only when a stage's settings changed.
    if (changed) {
      Object.assign(result, { write_outputs_with: { tool: "run_pipeline", from_stage: TUNE_STAGES.find((st) => stages.includes(st)) } });
    }
    return { result, summary: `${minutes} min · settings changed on ${changed} of ${stages.length} stages` };
  },
};

// The user's methods (skills.ts): the system prompt lists their names, and
// this reads one, or a document it cites, when the task calls for it.
const readSkillTool: ChatTool = {
  name: "read_skill",
  facts: { label: "Read a skill", acts: null, reachesBackend: false, needsSkills: true },
  description:
    "Read one of the user's skills: their method for a topic, with the steps, the checks and what to report. " +
    "Name it from the list in the system prompt. With reference, read one of the documents the skill cites (a long " +
    "one by section). Read a stage's skill before you change that stage's settings or tune it: those calls are " +
    "refused until it has been read in this conversation.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", enum: allSkills().map((s) => s.name), description: "The skill" },
      reference: { type: "string", description: "One of the skill's references, by the name the skill lists" },
      section: { type: "string", description: "With reference: one section of that document, by its heading" },
    },
    required: ["name"],
  },
  maxResultChars: REFERENCE_MAX_CHARS + 2000,
  run: async (args, ctx) => {
    const name = typeof args.name === "string" ? args.name.trim() : "";
    if (!name) throw new ToolArgError("name must be one of the skills listed in the system prompt");
    const reference = typeof args.reference === "string" && args.reference.trim() ? args.reference.trim() : undefined;
    const section = typeof args.section === "string" && args.section.trim() ? args.section.trim() : undefined;
    let text: string;
    try {
      text = readSkill(name, reference, section);
    } catch (e) {
      throw new ToolArgError((e as Error).message);
    }
    if (!reference) ctx.skillsRead?.add(name);
    return { result: text, summary: reference ? `${name}: ${reference}${section ? ` (${section})` : ""}` : `Read the ${name} skill` };
  },
};

export const CHAT_TOOLS: ChatTool[] = [
  readSkillTool,
  describeDataset,
  currentView,
  measureReciprocalCut,
  measureDpdfCut,
  assessStage,
  textureCheck,
  qmaxCoverage,
  symmetryCheck,
  dpdfContrast,
  dpdfPeaks,
  grainCheckTool,
  ubCheckTool,
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

// The facts by tool name, indexed on the first lookup.
let factsByName: Map<string, Facts> | null = null;

/**
 * A tool's facts, by its name. Never throws: a name the registry does not hold
 * (a tool a test made up, one the model invented) gets the fallbacks
 * (resolveFacts): it only reads, needs the server, is offered for every
 * question and settles nothing.
 */
export function factsOf(name: string): Facts {
  if (!factsByName) factsByName = new Map(CHAT_TOOLS.map((t) => [t.name, resolveFacts(t.name, t.facts)]));
  return factsByName.get(name) ?? resolveFacts(name);
}

/** The names of the registry's tools whose facts pass `pred`, in the registry's order. */
export const toolsWhere = (pred: (facts: Facts) => boolean): string[] =>
  CHAT_TOOLS.filter((t) => pred(factsOf(t.name))).map((t) => t.name);

/**
 * Why a call must wait, or null: a call to a tool with a skill gate (its
 * facts' `gate`) waits until the skills of the stages it changes or tunes
 * have been read in the conversation (skills.ts words it).
 */
export function unreadSkillRefusal(name: string, args: Args, read: ReadonlySet<string>): string | null {
  const gate = factsOf(name).gate;
  return gate ? refusalFor(gate.stages(args), gate.doing, read) : null;
}

/**
 * The tools as a conversation with the skills on or off offers them (the
 * switch, skills.ts): on, the tools as they are (the same list); off (the
 * validation's arm C), without the tools that work only with the skills (their
 * facts' `needsSkills`: read_skill), and each with its description without
 * what names a skill or restates a skill's step (descriptionWithoutSkills).
 * The agent loop offers, runs and checks answers against this list alone, so a
 * call to a tool it left out is refused as one the registry does not hold.
 */
export function toolsWithSkills(tools: AgentTool[], skills: boolean): AgentTool[] {
  if (skills) return tools;
  return tools
    .filter((t) => !factsOf(t.name).needsSkills)
    .map((t) => (t.descriptionWithoutSkills === undefined ? t : { ...t, description: t.descriptionWithoutSkills }));
}

// Only name, description and parameters: the facts never reach the model.
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
  full?: string; // the whole result, when the model reads it trimmed (answerChecks.ts reads this)
  summary: string;
  view?: ViewTarget;
  outcomes?: Outcome[]; // the tool's outcomes (ToolOutcome), carried to the step
}

/**
 * A result as JSON of at most *max* characters: the whole of it, or, when
 * longer, still valid JSON. The bulkiest parts go first: the last items of the
 * longest lists, then the longest texts, each named under `left_out`, so the
 * small fields a verdict lives in stay. Cutting the text mid-way left JSON
 * that nothing could parse: the answer checks then saw no verdict at all.
 */
export function fitResult(value: unknown, max: number): string {
  const whole = JSON.stringify(value) ?? "null";
  if (whole.length <= max) return whole;
  if (!value || typeof value !== "object") return `${whole.slice(0, max)}… [truncated]`;
  const copy = JSON.parse(whole) as Record<string, unknown> | unknown[];
  const leftOut: string[] = [];
  const size = (v: unknown): number => JSON.stringify(v)?.length ?? 0;
  const render = (): string =>
    Array.isArray(copy) ? JSON.stringify(copy) : JSON.stringify(leftOut.length ? { ...copy, left_out: leftOut } : copy);
  let text = render();
  for (let guard = 0; text.length > max && guard < 100_000; guard++) {
    // Follow the bulkiest member down: a list loses its last item, an object
    // its bulkiest leaf.
    let node: Record<string, unknown> | unknown[] = copy;
    let path = "";
    let trimmed = false;
    for (;;) {
      if (Array.isArray(node)) {
        if (!node.length) break;
        node.pop();
        const note = `${path || "the list"}: its last items`;
        if (!leftOut.includes(note)) leftOut.push(note);
        trimmed = true;
        break;
      }
      const entries = Object.entries(node);
      if (!entries.length) break;
      const [key, child] = entries.reduce((a, b) => (size(b[1]) > size(a[1]) ? b : a));
      if (child !== null && typeof child === "object" && Object.keys(child).length > 0) {
        path = path ? `${path}.${key}` : key;
        node = child as Record<string, unknown> | unknown[];
        continue;
      }
      delete node[key];
      leftOut.push(path ? `${path}.${key}` : key);
      trimmed = true;
      break;
    }
    if (!trimmed) break;
    text = render();
  }
  return text.length <= max ? text : `${text.slice(0, max)}… [truncated]`;
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
  // A firm rule: a stage's settings change, and the stage is tuned, only after
  // its skill has been read in the conversation (skills.ts). With the skills
  // off (the switch) there is no skill to read, so there is no gate.
  const refusal = skillsOn(ctx) && ctx.skillsRead ? unreadSkillRefusal(tool.name, args, ctx.skillsRead) : null;
  if (refusal) return { ok: false, args, text: `Error: ${refusal}`, summary: "refused until its skill is read" };
  try {
    const out = await tool.run(args, ctx, io);
    // With the skills off its prose written once is its definitions only
    // (inference.ts); a tool renders what it builds for each call by the switch itself.
    const result = skillsOn(ctx) ? out.result : withoutInference(out.result);
    // A text result (a skill) goes as written; anything else as JSON, trimmed
    // to valid JSON when it is long (fitResult).
    const max = tool.maxResultChars ?? MAX_RESULT_CHARS;
    const full = typeof result === "string" ? result : (JSON.stringify(result) ?? "null");
    const text =
      full.length <= max ? full : typeof result === "string" ? `${full.slice(0, max)}… [truncated]` : fitResult(result, max);
    return { ok: true, args, text, ...(text !== full ? { full } : {}), summary: out.summary, view: out.view, ...(out.outcomes ? { outcomes: out.outcomes } : {}) };
  } catch (e) {
    const msg = (e as Error).message;
    const text = e instanceof ToolArgError ? `Error: invalid arguments — ${msg}` : `Error: ${msg}`;
    return { ok: false, args, text, summary: msg };
  }
}
