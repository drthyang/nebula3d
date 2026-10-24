// The settings the tuning run may change, per stage — a curated subset of the
// Configure page's fields.  Only method choices and thresholds are here, not
// physical facts about the sample (supercell, magnetic ion, |Q| band), which
// stay with the user: the few the user may ask the assistant to set are apart
// (SAMPLE_PARAMS), with the words that name them, and are never tuned.  Each
// entry says what the model may set it to; whatever the model proposes is
// checked against this before anything runs.

import { DeclarationError, MODULATION_FIELDS, modulationFieldsOf, modulationText } from "../../state/modulation";
import type { PipelineConfig } from "../../state/pipelineStore";
import { evidence, remedy, written, type Tagged, type Value } from "../inference";

/**
 * A setting's help from its text tagged by class (inference.ts): whole as
 * written, and, where it holds inference, its definitions for the skills off.
 */
const helped = (key: string) => (strings: TemplateStringsArray, ...values: Value[]): Pick<TuneParam, "help" | "helpWithoutSkills"> => {
  const text: Tagged = written(`tune/catalog.ts: ${key}'s help`)(strings, ...values);
  return text.hasInference ? { help: text.whole, helpWithoutSkills: text.definitions } : { help: text.whole };
};

export const TUNE_STAGES = ["rings", "punch", "backfill", "flatten", "pdf"] as const;
export type TuneStage = (typeof TUNE_STAGES)[number];

// The words that name a fact about the sample in the user's latest message
// (namesSampleFact), for update_settings' gate: it changes a fact only when
// that message names it. Each list is conservative: a false refusal costs the
// user one question, a false accept defeats the rule. The words name the
// setting, not the physics it is about. What every audit talks about names
// nothing: "satellites" and "superlattice" are what the data show (the punch
// review's own instruction says "satellites"), every cut is a "plane", every
// lattice has a "cell". A question that names a fact names it all the same:
// the gate reads names, not intent. Every fact is named by its key too
// (punchSupercellH), so "modulation", the key of the sample's modulation,
// names it wherever it stands.
//
// The modulation's words are provisional, the user's to confirm (plan 4.15,
// P2): its key and its forms (MODULATION), "wave vector" and "propagation
// vector", a written k ("k = (1/3, 0, 0)"), and the words that named the
// protected H planes it replaced (PROTECT with PLANE, H_FRACTIONS, SKIPS_H).

/** The sample's modulation by its own word: "modulation(s)", "modulated". */
const MODULATION = /\bmodulat(?:ion|ions|ed)\b/i;
/** Its wave vector by name: "wave vector", "wavevector", "propagation vector". */
const WAVE_VECTOR = /\b(?:wave[- ]?|propagation[- ])vectors?\b/i;
/** A k written out: "k = (1/3, 0, 0)", "k=[0.2, 0, 1/2]". */
const WRITTEN_K = /\bk\s*=\s*[([⟨]/i;
/** What the search leaves alone, in the words of the protected planes the modulation replaced: "protect…" or "unprotect…" with "plane(s)" in the same message. */
const PROTECT = /\b(?:un)?protect/i;
const PLANE = /\bplanes?\b/i;
/** The protected planes in their old help's words ("H fractions"), and the old Configure page's ("Search skips H", "skipped H plane"). */
const H_FRACTIONS = /\bH[- ]fractions?\b/i;
const SKIPS_H = /\bskip(?:s|ped|ping)?\s+(?:the\s+)?H\b|\bskipped\s+(?:H\s+)?planes?\b/i;
/** The punch cell, all three axes: a supercell, the punch's (indexing) cell, a doubled or tripled cell, an n×n×n cell. */
const PUNCH_CELL: readonly RegExp[] = [
  /\bsuper[- ]?cells?\b/i,
  /\bpunch(?:'s|’s)?\s+(?:indexing\s+)?cells?\b/i,
  /\bindexing\s+cells?\b/i,
  /\b(?:doubl|tripl)\w*\s+(?:the\s+)?(?:unit\s+)?cells?\b|\bcells?\s+(?:is\s+|was\s+)?(?:doubl|tripl)\w*/i,
  /\b\d\s*[×x]\s*\d\s*[×x]\s*\d\s+(?:unit\s+)?cells?\b/i,
];

/**
 * A fact about the sample: a setting only the user sets, by name. The model
 * reads it as one value (`read`) and asks for one (`write`, checked), whatever
 * Configure page fields hold it (`fields`): the sample's modulation is four.
 */
export interface SampleParam {
  key: string; // as the model names it
  stage: TuneStage;
  help: string;
  allowed: string; // what it takes, as update_settings' description says it
  fields: readonly Key[]; // the Configure page's fields it reads and writes
  // What names it besides its key: any one of these, where an array names it
  // only in a message that holds every one of its words.
  names: readonly (RegExp | readonly RegExp[])[];
  read: (s: PipelineConfig) => ParamValue; // as the model sees it
  write: (value: unknown) => Partial<PipelineConfig>; // the change asked for, checked (ProposalError)
}

/** A fact about the sample held in one field of the page, checked as a setting of the catalog is. */
function oneField(p: TuneParam, names: SampleParam["names"]): SampleParam {
  return {
    key: p.key,
    stage: p.stage,
    help: p.help,
    allowed: allowedValues(p),
    fields: [p.key],
    names,
    read: (s) => displayValue(p, s[p.key]),
    write: (value) => ({ [p.key]: formValue(p, value) }),
  };
}

const cellAxis = (axis: "H" | "K" | "L"): SampleParam =>
  oneField(
    {
      key: `punchSupercell${axis}`,
      stage: "punch",
      kind: "integer",
      min: 1,
      max: 6,
      defaultValue: 1,
      help: `The punch's indexing cell along ${axis}: the Bragg nodes are the multiples of this ${axis} (2 when the volume is indexed on a doubled cell); the nodes between are superstructure or diffuse, not punched as Bragg peaks.`,
    },
    PUNCH_CELL,
  );

/**
 * The sample's modulation (state/modulation.ts): one setting to the model, the
 * four fields of the Configure page. A run's marks of what its search left
 * alone come from its record, never from these (context/loadContext.ts).
 */
const MODULATION_PARAM: SampleParam = {
  key: "modulation",
  stage: "punch",
  help: 'The sample\'s modulation: the off-lattice search leaves its satellites G ± m·k alone (form points, the default) or the planes through them (form planes), the form the user\'s to declare; k in r.l.u., several separated by ";", order m 1–6 (default 1), half_width in r.l.u. (default 0.08); "none" declares none, and so does "default", the backend\'s own.',
  allowed: '{"k": "1/3, 0, 0", "order": 1, "form": "points|planes", "half_width": 0.08}, "none" or "default"',
  fields: MODULATION_FIELDS,
  names: [MODULATION, WAVE_VECTOR, WRITTEN_K, [PROTECT, PLANE], H_FRACTIONS, SKIPS_H],
  read: (s) => modulationText(s),
  write: (value) => {
    try {
      return modulationFieldsOf(value);
    } catch (e) {
      if (e instanceof DeclarationError) throw new ProposalError(e.message);
      throw e;
    }
  },
};

// Facts about the sample that the user may ask the assistant to set, by name.
// Never tuned: whether the sample has a modulation is physics, not a threshold
// to trade against a metric. update_settings changes one only when the
// user's latest message names it (names, namesSampleFact).
export const SAMPLE_PARAMS: SampleParam[] = [MODULATION_PARAM, cellAxis("H"), cellAxis("K"), cellAxis("L")];

/** A fact about the sample by the name the model uses, or undefined. */
export const sampleParam = (key: string): SampleParam | undefined => SAMPLE_PARAMS.find((p) => p.key === key);

/** Whether `key` is a fact about the sample (SAMPLE_PARAMS). */
export const isSampleFact = (key: string): boolean => SAMPLE_PARAMS.some((p) => p.key === key);

/**
 * Whether `message`, the user's latest, names the fact about the sample
 * `key`: by its key, or by one of its names (SampleParam.names). False for a
 * setting that is no such fact, and for no message.
 */
export function namesSampleFact(message: string, key: string): boolean {
  const p = SAMPLE_PARAMS.find((q) => q.key === key);
  if (!p) return false;
  return namedIn(message, [new RegExp(`\\b${p.key}\\b`, "i"), ...p.names]);
}

/** Whether `message` holds one of `names`: a word, or an array whose words it holds every one of. False for no message. */
const namedIn = (message: string, names: readonly (RegExp | readonly RegExp[])[]): boolean => {
  if (!message) return false;
  const holds = (re: RegExp): boolean => re.test(message);
  return names.some((n) => (n instanceof RegExp ? holds(n) : n.every(holds)));
};

// The words that name a regrid onto the refined UB (regrid_refined_ub, which
// writes a new dataset): the same gate as a fact about the sample's, for an
// action only the user asks for. The tool runs only when the user's latest
// message names it, and a local model is offered it only then (its facts'
// `askedFor`). Conservative as the facts' lists are: "refine the UB" names
// none, as the UB check refines it and writes nothing.
const REGRID_NAMES: readonly RegExp[] = [/\bre-?grid(?:s|ded|ding)?\b/i, /\bregrid_refined_ub\b/i, /\brefine_ub(?:\.py)?\b/i];

/** Whether `message`, the user's latest, asks for a regrid onto the refined UB, by name. */
export const namesRegrid = (message: string): boolean => namedIn(message, REGRID_NAMES);

/** What a refusal of a regrid the user's latest message does not name says (findings.ts reads it). */
export const REGRID_REFUSED = "A regrid writes a new dataset, which only the user asks for";

/**
 * The regrid's refusal when the user's latest message does not ask for one.
 * Like sampleFactRefusal it names no skill, stage or tool, so it reads the
 * same with the skills off (the validation's arm C).
 */
export const regridRefusal = (): string => `${REGRID_REFUSED}: nothing was written. Ask the user, and regrid once they ask for it.`;

/** What a refusal of a change to a fact about the sample says, whatever the fact (findings.ts reads it). */
export const SAMPLE_FACT_REFUSED = "is a fact about the sample, which only the user sets";

/**
 * update_settings' refusal of a change to the fact `key` that the user's
 * latest message does not name. It names no skill, stage or tool, so it reads
 * the same with the skills off (the validation's arm C).
 */
export const sampleFactRefusal = (key: string): string => `${key} ${SAMPLE_FACT_REFUSED}: ask the user, and change it once they name it.`;

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
  // The help with the skills off (the switch, skills.ts): without when to use
  // the setting, where that restates a skill's step. Left out: the help restates none.
  helpWithoutSkills?: string;
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
    help: "Integer-node punches only: each node's punch stops this far (r.l.u.) from the node's H plane, so the H planes between nodes (e.g. satellites at H = n ± 1/3) stay unpunched. 0 turns the guard off and lets every node's punch run along H, discarding the diffuse there. Not what the off-lattice search leaves alone, which the sample's modulation sets, a fact about the sample.",
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
      { value: "", name: "own" },
      { value: "profile", name: "profile" },
      { value: "ellipsoid", name: "ellipsoid" },
    ],
    defaultValue: "own",
    help: "Punch footprint. own (default): each peak punched to its own measured width, as far as it stays above the noise, so a sharp spike on a broad maximum takes a small punch. profile: every peak shares the dataset's learned Bragg profile (a consistent width), so strong peaks, spikes included, get wide punches. ellipsoid: the fixed resolution ellipsoid scaled with intensity.",
  },
  {
    key: "punchProfileNSigma",
    stage: "punch",
    kind: "number",
    min: 0.1,
    max: 3,
    defaultValue: 0.5,
    help: "own and profile footprints: punch out to where each peak's tail falls to this × the local noise. Lower reaches further down the wings of very strong peaks (fewer wing pieces left for the search), at the cost of more punched diffuse; higher punches tighter.",
    appliesWhen: (s) => s.punchFootprint !== "ellipsoid",
  },
  {
    key: "punchSearchMaxWidth",
    stage: "punch",
    kind: "number",
    min: 1,
    max: 6,
    defaultValue: 0,
    ...helped("punchSearchMaxWidth")`Off-lattice search width test: a candidate broader than this × the dataset's Bragg width along any axis is left as diffuse${evidence(
      " (a short-range-order maximum)",
    )} instead of punched. 0 (blank) is off and punches every candidate${remedy("; spurious reflections are as sharp as Bragg peaks, so 2 keeps them punched while broad diffuse maxima stay")}.`,
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
  // When to turn on the b·Q² term and widen the fit range is reduction-qc's
  // step 6 (a floor rising with |Q|): with the skills off, their help says
  // what each does and not when to use it.
  {
    key: "flattenQ2",
    stage: "flatten",
    kind: "boolean",
    defaultValue: false,
    ...helped("flattenQ2")`model only: also fit b·Q², the smooth rise of an inelastic background (thermal diffuse; with X-rays also Compton)${remedy(
      ". Use it when the shell floors climb with |Q| after the flatten (floor_trend near 1)",
    )}; it varies too slowly to follow pair correlations.`,
    appliesWhen: (s) => s.flattenEstimator === "" || s.flattenEstimator === "model",
  },
  {
    key: "flattenFitQMax",
    stage: "flatten",
    kind: "number",
    min: 3,
    max: 25,
    defaultValue: 10,
    ...helped("flattenFitQMax")`model only: end (Å⁻¹) of the |Q| range the model is fitted to (from 0.8).${remedy(
      " Raise it toward the data's coverage when the background keeps changing past 10 Å⁻¹.",
    )}`,
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

const findParam = (key: string): TuneParam | undefined => TUNE_PARAMS.find((p) => p.key === key);

// A setting as the model sees it: enum names, numbers, booleans; a blank form
// field shows as its default value.
export function displayValue(p: TuneParam, formValue: unknown): ParamValue {
  if (p.kind === "enum") return p.options!.find((o) => o.value === formValue)?.name ?? String(p.defaultValue);
  if (p.kind === "boolean") return Boolean(formValue);
  if (formValue === "" || formValue == null) return p.defaultValue;
  return Number(formValue);
}

/** What a setting takes, as update_settings' description says it. */
export function allowedValues(p: TuneParam): string {
  return p.kind === "enum" ? p.options!.map((o) => o.name).join("|") : p.kind === "boolean" ? "true|false" : `${p.kind} ${p.min}–${p.max}`;
}

/** The stage's current settings, as the model sees them. */
export function currentStageSettings(stage: TuneStage, s: PipelineConfig): Record<string, ParamValue> {
  return Object.fromEntries(stageParams(stage, s).map((p) => [p.key, displayValue(p, s[p.key])]));
}

/** Rejected proposal, with the reason the model reads back. */
export class ProposalError extends Error {}

// Turn a value the model proposed into the form value, or throw. The facts
// about the sample are none of these: never tuned, they are set through their
// own SampleParam (update_settings), a change the user asked for.
export function toFormValue(key: string, value: unknown, stage: TuneStage): string | boolean {
  const p = findParam(key);
  if (!p || p.stage !== stage) throw new ProposalError(`${key} is not a ${stage} setting that can be tuned`);
  return formValue(p, value);
}

/** A value proposed for the setting `p`, as its form field holds it, or throws ProposalError. */
function formValue(p: TuneParam, value: unknown): string | boolean {
  const { key } = p;
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

/** A catalog description of the stage's settings for the model; with the skills off (the switch, skills.ts), each setting's help without a skill's step. */
export function describeStageParams(stage: TuneStage, { skills = true }: { skills?: boolean } = {}): string {
  return stageParams(stage)
    .map((p) => {
      const help = skills ? p.help : (p.helpWithoutSkills ?? p.help);
      const allowed =
        p.kind === "enum"
          ? `one of ${p.options!.map((o) => o.name).join(" | ")}`
          : p.kind === "boolean"
            ? "true | false"
            : `${p.kind} in [${p.min}, ${p.max}]`;
      return `- ${p.key} (${allowed}; default ${p.defaultValue}): ${help}`;
    })
    .join("\n");
}
