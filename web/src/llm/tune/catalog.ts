// The settings the tuning run may change, per stage — a curated subset of the
// Configure page's fields.  Only method choices and thresholds are here, not
// physical facts about the sample (supercell, magnetic ion, |Q| band), which
// stay with the user.  Each entry says what the model may set it to; whatever
// the model proposes is checked against this before anything runs.

import { parseFractions, type PipelineConfig } from "../../state/pipelineStore";

export const TUNE_STAGES = ["rings", "punch", "backfill", "flatten", "pdf"] as const;
export type TuneStage = (typeof TUNE_STAGES)[number];

// Facts about the sample that the user may ask the assistant to set, by name.
// Never tuned: whether the H = n ± 1/3 planes hold real satellites is physics,
// not a threshold to trade against a metric.
export const SAMPLE_PARAMS: TuneParam[] = [
  {
    key: "punchProtectH",
    stage: "punch",
    kind: "fractions",
    defaultValue: "1/3, 2/3",
    help: "H fractions the off-lattice search leaves alone (its protected planes, e.g. real satellites at H = n ± 1/3); none protects nothing.",
  },
  {
    key: "punchProtectHalfWidth",
    stage: "punch",
    kind: "number",
    min: 0,
    max: 0.25,
    defaultValue: 0.08,
    help: "Half width (r.l.u.) of each protected H plane.",
  },
  {
    key: "punchSupercellH",
    stage: "punch",
    kind: "integer",
    min: 1,
    max: 6,
    defaultValue: 1,
    help: "The punch's indexing cell along H: the Bragg nodes are the multiples of this H (2 when the volume is indexed on a doubled cell); the nodes between are superstructure or diffuse, not punched as Bragg peaks.",
  },
  {
    key: "punchSupercellK",
    stage: "punch",
    kind: "integer",
    min: 1,
    max: 6,
    defaultValue: 1,
    help: "The punch's indexing cell along K: the Bragg nodes are the multiples of this K (2 when the volume is indexed on a doubled cell); the nodes between are superstructure or diffuse, not punched as Bragg peaks.",
  },
  {
    key: "punchSupercellL",
    stage: "punch",
    kind: "integer",
    min: 1,
    max: 6,
    defaultValue: 1,
    help: "The punch's indexing cell along L: the Bragg nodes are the multiples of this L (2 when the volume is indexed on a doubled cell); the nodes between are superstructure or diffuse, not punched as Bragg peaks.",
  },
];

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
  // fractions: H fractions as the form's text, "1/3, 2/3" or "none" (blank = default)
  kind: "enum" | "number" | "integer" | "boolean" | "fractions";
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
    key: "punchFootprint",
    stage: "punch",
    kind: "enum",
    options: [
      { value: "", name: "profile" },
      { value: "ellipsoid", name: "ellipsoid" },
    ],
    defaultValue: "profile",
    help: "Punch footprint. profile (default): each peak punched along each axis as far as the dataset's learned Bragg profile stays above the noise, so strong peaks get wide punches. ellipsoid: the fixed resolution ellipsoid scaled with intensity.",
  },
  {
    key: "punchProfileNSigma",
    stage: "punch",
    kind: "number",
    min: 0.1,
    max: 3,
    defaultValue: 0.5,
    help: "profile footprint only: punch out to where the profile falls to this × the local noise. Lower reaches further down the wings of very strong peaks (fewer wing pieces left for the search), at the cost of more punched diffuse; higher punches tighter.",
    appliesWhen: (s) => s.punchFootprint !== "ellipsoid",
  },
  {
    key: "punchSearchMaxWidth",
    stage: "punch",
    kind: "number",
    min: 1,
    max: 6,
    defaultValue: 0,
    help: "Off-lattice search width test: a candidate broader than this × the dataset's Bragg width along any axis is left as diffuse (a short-range-order maximum) instead of punched. 0 (blank) is off and punches every candidate; spurious reflections are as sharp as Bragg peaks, so 2 keeps them punched while broad diffuse maxima stay.",
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
    help: "ellipsoid footprint only: do not floor/cap the Bragg covariance-fit radii at the resolution limits. The profile footprint replaces those radii with the profile's, so there it changes nothing.",
    appliesWhen: (s) => s.punchFootprint === "ellipsoid",
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
    key: "flattenQ2",
    stage: "flatten",
    kind: "boolean",
    defaultValue: false,
    help: "model only: also fit b·Q², the smooth rise of an inelastic background (thermal diffuse; with X-rays also Compton). Use it when the shell floors climb with |Q| after the flatten (floor_trend near 1); it varies too slowly to follow pair correlations.",
    appliesWhen: (s) => s.flattenEstimator === "" || s.flattenEstimator === "model",
  },
  {
    key: "flattenFitQMax",
    stage: "flatten",
    kind: "number",
    min: 3,
    max: 25,
    defaultValue: 10,
    help: "model only: end (Å⁻¹) of the |Q| range the model is fitted to (from 0.8). Raise it toward the data's coverage when the background keeps changing past 10 Å⁻¹.",
    appliesWhen: (s) => s.flattenEstimator === "" || s.flattenEstimator === "model",
  },
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
    help: "Window geometry: separable (per axis: it reaches into the box corners, and on an oblique cell it does not keep the cell's in-plane symmetry), ellipsoid (lattice-invariant), auto (default; ellipsoid for non-orthogonal cells, and wherever the separable one would put weight on unmeasured space).",
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

const findParam = (key: string, sample = false): TuneParam | undefined =>
  TUNE_PARAMS.find((p) => p.key === key) ?? (sample ? SAMPLE_PARAMS.find((p) => p.key === key) : undefined);

// A setting as the model sees it: enum names, numbers, booleans; a blank form
// field shows as its default value.
export function displayValue(p: TuneParam, formValue: unknown): ParamValue {
  if (p.kind === "enum") return p.options!.find((o) => o.value === formValue)?.name ?? String(p.defaultValue);
  if (p.kind === "boolean") return Boolean(formValue);
  if (formValue === "" || formValue == null) return p.defaultValue;
  if (p.kind === "fractions") return String(formValue);
  return Number(formValue);
}

/** The stage's current settings, as the model sees them. */
export function currentStageSettings(stage: TuneStage, s: PipelineConfig): Record<string, ParamValue> {
  return Object.fromEntries(stageParams(stage, s).map((p) => [p.key, displayValue(p, s[p.key])]));
}

/** Rejected proposal, with the reason the model reads back. */
export class ProposalError extends Error {}

// Turn a value the model proposed into the form value, or throw.  `sample`
// admits the sample facts too (a change the user asked for, never a tuning).
export function toFormValue(key: string, value: unknown, stage: TuneStage, { sample = false } = {}): string | boolean {
  const p = findParam(key, sample);
  if (!p || p.stage !== stage) throw new ProposalError(`${key} is not a ${stage} setting that can be tuned`);
  if (p.kind === "fractions") {
    const text = (Array.isArray(value) ? value.join(", ") : String(value ?? "")).trim();
    if (!text || text.toLowerCase() === "default" || text === p.defaultValue) return "";
    if (parseFractions(text) === undefined) throw new ProposalError(`${key} must be H fractions like "1/3, 2/3", or none`);
    return text;
  }
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
            : p.kind === "fractions"
              ? 'H fractions like "1/3, 2/3", or none'
              : `${p.kind} in [${p.min}, ${p.max}]`;
      return `- ${p.key} (${allowed}; default ${p.defaultValue}): ${p.help}`;
    })
    .join("\n");
}
