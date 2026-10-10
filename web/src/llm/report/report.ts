// The analysis report: what NEBULA Pilot did, and how the reduction measures.
// Every number in it comes from the same deterministic measurements the agent's
// tools run (collect.ts runs them again for the report), never from the model's
// text; the model's own answer goes in as a clearly labelled narrative.  This
// module only assembles: it is pure, so the report can be tested end to end.

import type { ParamValue } from "../tune/catalog";

export type Verdict = "pass" | "attention" | "info";

export interface ReportCheck {
  title: string;
  verdict: Verdict;
  headline: string; // one line of numbers
  goal?: string; // the stated criterion the numbers are judged by
  details: [string, string][];
}

export interface ReportFigure {
  title: string;
  caption: string;
  dataUrl: string; // image/png
}

export interface ReportTrial {
  n: number;
  changes: string; // "your settings" or key=value pairs
  headline: string;
  chosen: boolean;
}

export interface ReportTuningStage {
  stage: string;
  why: string;
  trials: ReportTrial[];
}

export interface ReportStep {
  tool: string;
  summary: string;
  ok: boolean;
}

export interface ReportDataset {
  label: string;
  rawName: string;
  temperature: string | null;
  stages: string[];
  grid: string | null;
  ranges: string | null;
  cell: string | null;
  dpdfGrid: string | null;
}

export interface Report {
  title: string;
  created: string; // ISO time
  kind: string; // Assessment, Tuning, Pipeline run, Analysis
  question: string;
  model: { provider: string; model: string; local: boolean };
  dataset: ReportDataset;
  settings: { stage: string; values: [string, string][] }[];
  sampleFacts: [string, string][];
  steps: ReportStep[];
  tuning: ReportTuningStage[] | null;
  checks: ReportCheck[];
  figures: ReportFigure[];
  narrative: string;
  caveats: string[];
}

// ---------------------------------------------------------------- inputs

// The measured results the report is built from: each tool's own result
// object, as the agent would read it.  Any may be missing (the stage did not
// run, or the measurement failed); the report then says so.
export interface Measured {
  describe?: Record<string, unknown> | null;
  rings?: Record<string, unknown> | null;
  punch?: Record<string, unknown> | null;
  backfill?: Record<string, unknown> | null;
  flatten?: Record<string, unknown> | null;
  pdf?: Record<string, unknown> | null;
  texture?: Record<string, unknown> | null;
  coverage?: Record<string, unknown> | null;
  symmetry?: Record<string, unknown> | null;
}

export interface ReportInput {
  created: Date;
  question: string;
  answer: string;
  steps: ReportStep[];
  model: { provider: string; model: string; local: boolean };
  dataset: { label: string; rawName: string; temperature: string | null };
  settings: { stage: string; values: Record<string, ParamValue> }[];
  sampleFacts: Record<string, ParamValue>;
  tuning: ReportTuningStage[] | null;
  measured: Measured;
  figures: ReportFigure[];
  goals: Record<string, string>;
}

// ---------------------------------------------------------------- helpers

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A number as the tools print it: exponent form when tiny or huge. */
export const fmt = (v: unknown): string => {
  const x = num(v);
  if (x == null) return v == null ? "–" : String(v);
  if (Number.isInteger(x) && Math.abs(x) < 1e6) return String(x); // counts stay exact
  if (x !== 0 && (Math.abs(x) < 1e-3 || Math.abs(x) >= 1e6)) return x.toExponential(2).replace(/\.?0+e/, "e");
  return String(Number(x.toPrecision(4)));
};

const where = (v: unknown): string => {
  const w = obj(v);
  return w?.plane ? ` (${w.plane}, ${fmt(w.at)} Å⁻¹)` : "";
};

const cellText = (c: Obj | null): string | null => {
  if (!c) return null;
  const a = num(c.a), b = num(c.b), cc = num(c.c);
  if (a == null || b == null || cc == null) return null;
  const ang = [c.alpha, c.beta, c.gamma].map((x) => fmt(x)).join("°, ");
  return `a = ${fmt(a)} Å, b = ${fmt(b)} Å, c = ${fmt(cc)} Å; α, β, γ = ${ang}°`;
};

const rangeText = (v: unknown): string => (Array.isArray(v) && v.length === 2 ? `${fmt(v[0])} … ${fmt(v[1])}` : "–");

// ---------------------------------------------------------------- checks

function ringsCheck(m: Obj | null | undefined, goal?: string): ReportCheck | null {
  if (!m) return null;
  const left = num(m.max_ring_left);
  const dent = num(m.max_ring_dent);
  const bumps = Array.isArray(m.single_plane_bumps) ? m.single_plane_bumps.length : 0;
  // A leftover or dent above 0 is beyond 3 × its plane's noise: real, by the tool's definition.
  const clean = left === 0 && dent === 0;
  return {
    title: "Ring removal",
    verdict: left == null || dent == null ? "info" : clean ? "pass" : "attention",
    headline: `ring ratio ${fmt(m.mean_ring_energy_ratio)} · over-sub ≤ ${fmt(m.max_over_subtraction_fraction)} · dent ≤ ${fmt(dent)}${where(m.worst_ring_dent)} · left ≤ ${fmt(left)}${where(m.worst_ring_left)}`,
    goal,
    details: [
      ["Mean ring-energy ratio", fmt(m.mean_ring_energy_ratio)],
      ["Largest over-subtraction fraction", fmt(m.max_over_subtraction_fraction)],
      ["Deepest ring dent", `${fmt(dent)}${where(m.worst_ring_dent)}`],
      ["Largest ring left", `${fmt(left)}${where(m.worst_ring_left)}`],
      ["Bumps on one plane only (crystal scattering, kept)", String(bumps)],
    ],
  };
}

function punchCheck(m: Obj | null | undefined, goal?: string): ReportCheck | null {
  if (!m) return null;
  const atNodes = num(m.leftover_at_nodes);
  const sharp = num(m.leftover_off_lattice_sharp);
  return {
    title: "Bragg punch",
    verdict: atNodes == null ? "info" : atNodes === 0 && (sharp ?? 0) === 0 ? "pass" : "attention",
    headline: `${fmt(atNodes)} missed at nodes · ${fmt(sharp)} sharp off-lattice · ${fmt(m.leftover_off_lattice_broad)} broad maxima kept · punched ${fmt(m.mean_punched_fraction)}`,
    goal,
    details: [
      ["Missed lattice peaks (at nodes)", fmt(atNodes)],
      ["Sharp off-lattice leftovers", fmt(sharp)],
      ["Broad maxima kept (diffuse, by width)", fmt(m.leftover_off_lattice_broad)],
      ["On protected planes (kept by design)", fmt(m.leftover_on_protected_planes)],
      ["Mean punched fraction", fmt(m.mean_punched_fraction)],
      ["Fitted Bragg peaks", fmt(m.fitted_peaks)],
    ],
  };
}

function backfillCheck(m: Obj | null | undefined, texture: Obj | null | undefined, goal?: string): ReportCheck | null {
  if (!m) return null;
  const seam = num(m.mean_median_seam_sigma);
  const cuts = Array.isArray(texture?.per_cut) ? (texture!.per_cut as Obj[]) : [];
  const biased = cuts.filter((c) => c.systematic_fill_bias === true).length;
  const details: [string, string][] = [
    ["Mean median seam", `${fmt(seam)} σ`],
    ["Largest bright-fill fraction", fmt(m.max_bright_fill_fraction)],
  ];
  if (texture) details.push(["Cuts with a systematic fill bias", `${biased} of ${cuts.length}`]);
  return {
    title: "Backfill",
    verdict: seam == null ? "info" : seam <= 1 && biased === 0 ? "pass" : "attention",
    headline: `seam ${fmt(seam)}σ · bright ≤ ${fmt(m.max_bright_fill_fraction)}${texture ? ` · fill bias on ${biased} of ${cuts.length} cuts` : ""}`,
    goal,
    details,
  };
}

function flattenCheck(m: Obj | null | undefined, goal?: string): ReportCheck | null {
  if (!m) return null;
  const floor = num(m.max_after_floor_sigma);
  const trend = num(m.max_floor_trend);
  const span = num(m.max_floor_span_fraction);
  // The goal's own reading: a floor beyond 1σ, or a trend near 1 with a span near 1, is a pedestal left.
  const pedestal = trend != null && span != null && Math.abs(trend) >= 0.8 && span >= 0.8;
  return {
    title: "Flatten",
    verdict: floor == null ? "info" : floor <= 1 && !pedestal ? "pass" : "attention",
    headline: `floor ≤ ${fmt(floor)}σ · trend ≤ ${fmt(trend)} · span ≤ ${fmt(span)}`,
    goal,
    details: [
      ["Largest leftover floor", `${fmt(floor)} σ`],
      ["Largest floor trend with |Q|", fmt(trend)],
      ["Largest floor span (share of the diffuse)", fmt(span)],
    ],
  };
}

function pdfCheck(m: Obj | null | undefined, cov: Obj | null | undefined, sym: Obj | null | undefined, goal?: string): ReportCheck | null {
  if (!m && !cov && !sym) return null;
  const r = num(m?.back_fft_pearson_r);
  const open = num(m?.window_weight_on_unmeasured) ?? num(cov?.window_weight_on_unmeasured);
  const symVerdict = typeof sym?.verdict === "string" ? (sym.verdict as string) : null;
  const covVerdict = typeof cov?.verdict === "string" ? (cov.verdict as string) : null;
  const ok = (r == null || r >= 0.999) && (open == null || open <= 1e-3) && !(symVerdict && symVerdict.startsWith("not kept"));
  const details: [string, string][] = [
    ["Back-FFT Pearson r", fmt(r)],
    ["Back-FFT normalised RMS", fmt(m?.back_fft_normalized_rms)],
    ["Mean feature SNR", fmt(m?.mean_feature_snr)],
    ["Window weight on unmeasured space", fmt(open)],
    ["Window shape", fmt(m?.window_shape ?? cov?.window_shape)],
  ];
  if (covVerdict) details.push(["Coverage", covVerdict]);
  const raw = obj(cov?.raw_counts);
  if (raw) details.push(["Raw counts in |Q|", `${fmt(raw.q_min_edge)} … ${fmt(raw.q_max_edge)} Å⁻¹ (box face ${fmt(raw.box_face_q)} Å⁻¹)`]);
  if (typeof cov?.band_check === "string") details.push(["|Q| band", cov.band_check as string]);
  if (symVerdict) details.push(["Symmetry", symVerdict]);
  return {
    title: "3D-ΔPDF",
    verdict: m || cov || sym ? (ok ? "pass" : "attention") : "info",
    headline: `r ${fmt(r)} · SNR ${fmt(m?.mean_feature_snr)} · unmeasured ${fmt(open)}${symVerdict ? ` · symmetry ${symVerdict.startsWith("kept") ? "kept" : "broken"}` : ""}`,
    goal,
    details,
  };
}

// ---------------------------------------------------------------- assemble

const SETTING_STAGE_LABELS: Record<string, string> = {
  rings: "Ring removal",
  punch: "Bragg punch",
  backfill: "Backfill",
  flatten: "Flatten",
  pdf: "3D-ΔPDF",
};

const kindOf = (steps: ReportStep[]): string => {
  const names = new Set(steps.map((s) => s.tool));
  if (names.has("tune_pipeline")) return "Tuning";
  if (names.has("run_pipeline")) return "Pipeline run";
  if (names.has("assess_stage")) return "Assessment";
  return "Analysis";
};

export function buildReport(input: ReportInput): Report {
  const { measured: m, goals } = input;
  const d = m.describe ?? null;
  const recip = obj(d?.reciprocal);
  const dpdf = obj(d?.delta_pdf);
  const checks = [
    ringsCheck(m.rings, goals.rings),
    punchCheck(m.punch, goals.punch),
    backfillCheck(m.backfill, m.texture, goals.backfill),
    flattenCheck(m.flatten, goals.flatten),
    pdfCheck(m.pdf, m.coverage, m.symmetry, goals.pdf),
  ].filter((c): c is ReportCheck => c != null);

  const caveats: string[] = [];
  for (const c of checks) if (c.verdict === "attention") caveats.push(`${c.title}: ${c.headline}.`);
  const missing = ["rings", "punch", "backfill", "flatten", "pdf"].filter((k) => !m[k as keyof Measured]);
  if (missing.length) caveats.push(`Not measured (no output, or the measurement failed): ${missing.map((k) => SETTING_STAGE_LABELS[k]).join(", ")}.`);
  for (const t of input.tuning ?? []) {
    if (/not a candidate/.test(t.why)) caveats.push(`Tuning, ${SETTING_STAGE_LABELS[t.stage] ?? t.stage}: ${t.why}`);
    const chosen = t.trials.find((x) => x.chosen);
    if (chosen && chosen.n !== 1) caveats.push(`Tuning, ${SETTING_STAGE_LABELS[t.stage] ?? t.stage}: the model's proposal ${chosen.changes} replaced your settings; review it before relying on it.`);
  }
  caveats.push("Sample facts (the punch cell, protected planes, magnetic ion and |Q| band) are the user's: the agent changes them only when asked, and the tuning never does.");
  caveats.push("The tables and figures are measured by nebula3d's deterministic metrics; the summary is written by the model and may be wrong where it departs from them.");

  return {
    title: `NEBULA Pilot report — ${input.dataset.label}`,
    created: input.created.toISOString(),
    kind: kindOf(input.steps),
    question: input.question,
    model: input.model,
    dataset: {
      label: input.dataset.label,
      rawName: input.dataset.rawName,
      temperature: input.dataset.temperature,
      stages: Array.isArray(d?.stages) ? (d!.stages as string[]) : [],
      grid: Array.isArray(recip?.grid) ? (recip!.grid as number[]).join(" × ") : null,
      ranges: recip ? `H ${rangeText(recip.H)}, K ${rangeText(recip.K)}, L ${rangeText(recip.L)} r.l.u.` : null,
      cell: cellText(obj(d?.cell)),
      dpdfGrid: dpdf && Array.isArray(dpdf.grid) ? `${(dpdf.grid as number[]).join(" × ")}; x ${rangeText(dpdf.x)}, y ${rangeText(dpdf.y)}, z ${rangeText(dpdf.z)} Å` : null,
    },
    settings: input.settings.map((s) => ({
      stage: SETTING_STAGE_LABELS[s.stage] ?? s.stage,
      values: Object.entries(s.values).map(([k, v]) => [k, String(v)] as [string, string]),
    })),
    sampleFacts: Object.entries(input.sampleFacts).map(([k, v]) => [k, String(v)] as [string, string]),
    steps: input.steps,
    tuning: input.tuning,
    checks,
    figures: input.figures,
    narrative: input.answer.trim(),
    caveats,
  };
}
