// The settings the tuning run may change, per stage — a curated subset of the
// Configure page's fields.  Only method choices and thresholds are here, not
// physical facts about the sample (supercell, magnetic ion, |Q| band), which
// stay with the user.  Each entry says what the model may set it to; whatever
// the model proposes is checked against this before anything runs.

import type { PipelineConfig } from "../../state/pipelineStore";

export const TUNE_STAGES = ["rings", "punch", "backfill", "flatten", "pdf"] as const;
export type TuneStage = (typeof TUNE_STAGES)[number];

export const TUNE_STAGE_LABELS: Record<TuneStage, string> = {
  rings: "Ring removal",
  punch: "Bragg punch",
  backfill: "Backfill",
  flatten: "Flatten",
  pdf: "3D-ΔPDF",
};

// The pipeline stages one tuning trial recomputes.
export const TRIAL_STAGES: Record<TuneStage, string[]> = {
  rings: ["rings"],
  punch: ["punch"],
  backfill: ["backfill"],
  flatten: ["flatten"],
  pdf: ["pdf", "pdf_check"],
};

// Whether the Configure page has the stage switched on.
type StageSwitches = Pick<PipelineConfig, "ringsEnabled" | "punchEnabled" | "backfillEnabled" | "flatten" | "pdfEnabled">;
export const stageEnabled = (stage: TuneStage, s: StageSwitches): boolean =>
  ({ rings: s.ringsEnabled, punch: s.punchEnabled, backfill: s.backfillEnabled, flatten: s.flatten, pdf: s.pdfEnabled })[stage];

type Key = keyof PipelineConfig;
export type ParamValue = string | number | boolean;

export interface TuneParam {
  key: Key;
  stage: TuneStage;
  kind: "enum" | "number" | "integer" | "boolean";
  // enum: the form value ("" = the backend default) and the name the model uses
  options?: { value: string; name: string }[];
  min?: number;
  max?: number;
  defaultValue: ParamValue; // what a blank field means
  help: string;
  appliesWhen?: (s: PipelineConfig) => boolean;
}

export const TUNE_PARAMS: TuneParam[] = [
  // — rings —
  {
    key: "ringModel",
    stage: "rings",
    kind: "enum",
    options: [
      { value: "pooled", name: "pooled" },
      { value: "global_v2", name: "global_v2" },
      { value: "patched", name: "patched" },
      { value: "parametric", name: "parametric" },
    ],
    defaultValue: "pooled",
    help: "Ring model. pooled: stack-pooled azimuthal sectors (default; follows rings that shift in |Q| with direction). global_v2: one sample-only global 3D fit. patched: per-patch profiles. parametric: pseudo-Voigt rings × azimuthal Fourier texture.",
  },
  {
    key: "ringPooledSectors",
    stage: "rings",
    kind: "integer",
    min: 8,
    max: 144,
    defaultValue: 72,
    help: "pooled only: azimuthal sectors each plane's radial profiles are read in (72 = 5° each). More sectors follow sharper texture but are noisier.",
    appliesWhen: (s) => s.ringModel === "pooled",
  },
  {
    key: "ringPooledWindow",
    stage: "rings",
    kind: "number",
    min: 0.5,
    max: 30,
    defaultValue: 5,
    help: "pooled only: half-width (degrees on the ring sphere) of the neighbouring planes pooled with each plane. Wider = smoother, less noise, slower to follow changes.",
    appliesWhen: (s) => s.ringModel === "pooled",
  },
  {
    key: "ringNFourier",
    stage: "rings",
    kind: "integer",
    min: 0,
    max: 40,
    defaultValue: 8,
    help: "patched/parametric only: Fourier order of the azimuthal ring texture.",
    appliesWhen: (s) => s.ringModel === "patched" || s.ringModel === "parametric",
  },
  {
    key: "ringGlobalSubtraction",
    stage: "rings",
    kind: "enum",
    options: [
      { value: "conservative", name: "conservative" },
      { value: "mean", name: "mean" },
    ],
    defaultValue: "conservative",
    help: "global_v2 only: subtract the fit conservatively (lower confidence bound) or its fitted mean.",
    appliesWhen: (s) => s.ringModel === "global_v2",
  },
  // — punch —
  {
    key: "punchMinSig",
    stage: "punch",
    kind: "number",
    min: 3,
    max: 12,
    defaultValue: 5,
    help: "Significance (standard errors, corrected for picking the brightest voxel) an integer-node peak must reach to be punched. Lower punches weaker peaks and risks punching noise or diffuse; higher leaves weak peaks.",
  },
  {
    key: "punchMode",
    stage: "punch",
    kind: "enum",
    options: [
      { value: "", name: "both" },
      { value: "integer", name: "integer" },
      { value: "search", name: "search" },
    ],
    defaultValue: "both",
    help: "Which peaks to punch: integer (Bragg nodes of the lattice only), search (a |Q|-shell search for any sharp peak, e.g. satellites), or both (default).",
  },
  {
    key: "punchHGuard",
    stage: "punch",
    kind: "number",
    min: 0,
    max: 0.3,
    defaultValue: 0.12,
    help: "Integer-node punches only: each node's punch stops this far (r.l.u.) from the node's H plane, so the H planes between nodes (e.g. satellites at H = n ± 1/3) stay unpunched. 0 turns the guard off and lets every node's punch run along H, discarding the diffuse there. Not the off-lattice search's protected H planes, which are a fact about the sample set on the Configure page.",
  },
  {
    key: "punchSearchFloor",
    stage: "punch",
    kind: "number",
    min: 3,
    max: 60,
    defaultValue: 27,
    help: "Off-lattice search floor, in units of the diffuse scatter: a peak off the integer nodes must stand this far above its |Q| shell and its neighbourhood. Lower punches weaker spurious peaks; too low punches diffuse maxima.",
  },
  {
    key: "punchMargin",
    stage: "punch",
    kind: "number",
    min: 0,
    max: 0.5,
    defaultValue: 0.02,
    help: "Extra margin added around each punch footprint. Larger removes peak tails but discards more diffuse.",
  },
  {
    key: "punchFitUnconstrained",
    stage: "punch",
    kind: "boolean",
    defaultValue: false,
    help: "Do not floor/cap the Bragg covariance-fit radii at the resolution limits.",
  },
  // — backfill —
  {
    key: "backfillMethod",
    stage: "backfill",
    kind: "enum",
    options: [
      { value: "", name: "laplace" },
      { value: "local", name: "local" },
      { value: "q_shell", name: "q_shell" },
    ],
    defaultValue: "laplace",
    help: "How punched holes are filled. laplace (default): smooth harmonic fill from the hole rim. local: the local surrounding diffuse. q_shell: the |Q|-shell background.",
  },
  // — flatten —
  {
    key: "flattenEstimator",
    stage: "flatten",
    kind: "enum",
    options: [
      { value: "", name: "model" },
      { value: "floor", name: "floor" },
      { value: "snip", name: "snip" },
    ],
    defaultValue: "model",
    help: "Pedestal estimator. model (default): a fitted const (+ c·F(Q)² when a magnetic ion is set) on the per-shell low floors. floor: the floors themselves. snip: a SNIP background.",
  },
  // — ΔPDF —
  {
    key: "pdfApod",
    stage: "pdf",
    kind: "enum",
    options: [
      { value: "", name: "gaussian" },
      { value: "hann", name: "hann" },
      { value: "none", name: "none" },
    ],
    defaultValue: "gaussian",
    help: "Apodization window before the FFT. gaussian (default) and hann suppress truncation ripples at some cost in real-space resolution; none is sharpest but rings.",
  },
  {
    key: "pdfWindowShape",
    stage: "pdf",
    kind: "enum",
    options: [
      { value: "", name: "auto" },
      { value: "separable", name: "separable" },
      { value: "ellipsoid", name: "ellipsoid" },
    ],
    defaultValue: "auto",
    help: "Window geometry: separable (per axis), ellipsoid (lattice-invariant), auto (default; ellipsoid for non-orthogonal cells).",
  },
  {
    key: "pdfWindowSupport",
    stage: "pdf",
    kind: "boolean",
    defaultValue: true,
    help: "Taper the window to the measured coverage instead of the whole box.",
  },
];

export const stageParams = (stage: TuneStage, s?: PipelineConfig): TuneParam[] =>
  TUNE_PARAMS.filter((p) => p.stage === stage && (!s || !p.appliesWhen || p.appliesWhen(s)));

const findParam = (key: string): TuneParam | undefined => TUNE_PARAMS.find((p) => p.key === key);

// A setting as the model sees it: enum names, numbers, booleans; a blank form
// field shows as its default value.
export function displayValue(p: TuneParam, formValue: unknown): ParamValue {
  if (p.kind === "enum") return p.options!.find((o) => o.value === formValue)?.name ?? String(p.defaultValue);
  if (p.kind === "boolean") return Boolean(formValue);
  if (formValue === "" || formValue == null) return p.defaultValue;
  return Number(formValue);
}

/** The stage's current settings, as the model sees them. */
export function currentStageSettings(stage: TuneStage, s: PipelineConfig): Record<string, ParamValue> {
  return Object.fromEntries(stageParams(stage, s).map((p) => [p.key, displayValue(p, s[p.key])]));
}

/** Rejected proposal, with the reason the model reads back. */
export class ProposalError extends Error {}

// Turn a value the model proposed into the form value, or throw.
export function toFormValue(key: string, value: unknown, stage: TuneStage): string | boolean {
  const p = findParam(key);
  if (!p || p.stage !== stage) throw new ProposalError(`${key} is not a ${stage} setting that can be tuned`);
  if (p.kind === "enum") {
    const opt = p.options!.find((o) => o.name === value || (o.value !== "" && o.value === value));
    if (!opt) throw new ProposalError(`${key} must be one of ${p.options!.map((o) => o.name).join(", ")}`);
    return opt.value;
  }
  if (p.kind === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === "true" || value === "false") return value === "true";
    throw new ProposalError(`${key} must be true or false`);
  }
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new ProposalError(`${key} must be a number`);
  if (p.kind === "integer" && !Number.isInteger(n)) throw new ProposalError(`${key} must be an integer`);
  if ((p.min != null && n < p.min) || (p.max != null && n > p.max)) {
    throw new ProposalError(`${key} must be within [${p.min}, ${p.max}]`);
  }
  return String(n);
}

/** Validate a proposed set of changes for `stage` into a form patch. */
export function proposalToPatch(stage: TuneStage, changes: Record<string, unknown>): Partial<PipelineConfig> {
  const patch: Record<string, string | boolean> = {};
  for (const [k, v] of Object.entries(changes)) patch[k] = toFormValue(k, v, stage);
  return patch as Partial<PipelineConfig>;
}

/** A catalog description of the stage's settings for the model. */
export function describeStageParams(stage: TuneStage): string {
  return stageParams(stage)
    .map((p) => {
      const allowed =
        p.kind === "enum"
          ? `one of ${p.options!.map((o) => o.name).join(" | ")}`
          : p.kind === "boolean"
            ? "true | false"
            : `${p.kind} in [${p.min}, ${p.max}]`;
      return `- ${p.key} (${allowed}; default ${p.defaultValue}): ${p.help}`;
    })
    .join("\n");
}
