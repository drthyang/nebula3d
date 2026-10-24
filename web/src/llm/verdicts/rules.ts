// The checks' rules, one table entry each: the rule that judges the check's
// measurements, the words its tool writes from the outcome, the criterion the
// rule is stated as, and a stage's goal. Implementation behind the interface,
// verdicts/index.ts; the readers (readers.ts) read the outcomes it gives.
//
// A rule is pure and total: it never throws, and with nothing to judge its
// outcome is "info" with the reason "nothing to judge" (the named exceptions:
// D15, the ΔPDF's rule, and D16, the UB's); on a grid too coarse for the
// check's measurement, "info" with the reason "grid too coarse", which the
// measurement states in its result; and for the fills' texture over fewer
// holes than its rule needs, "info" with the reason "too few holes". An
// "attention" outcome always carries a reason.

import { built, evidence, inference, inferred, joined, quotedInference, reading, remedy, written, type Span, type Tagged } from "../inference";
import { isTooCoarse } from "../metrics/coarse";
import { OPEN_WEIGHT_OK } from "../metrics/coverage";
import { PEDESTAL_LIMIT, pedestalLeft } from "../metrics/flatten";
import { r2, SECOND_GRAIN_DEG, type GrainFacts } from "../metrics/grains";
import { roundSig } from "../metrics/sliceStats";
import { SYMMETRY_HOLDS } from "../metrics/symmetry";
import type { TuneStage } from "../tune/catalog";

/** An outcome's kind: met, needs attention, or not judged ("info", as the records and the report's CSS spell it). */
export type Kind = "pass" | "attention" | "info";

export type Stage = TuneStage;
export const STAGES: readonly Stage[] = ["rings", "punch", "backfill", "flatten", "pdf"];

/** How {{achieved}} names a stage (readers.ts), and the system prompt's checks after it (prompts/system.ts). */
export const STAGE_NAMES: Record<Stage, string> = {
  rings: "the ring removal",
  punch: "the Bragg punch",
  backfill: "the backfill",
  flatten: "the flatten",
  pdf: "the 3D-ΔPDF",
};

/** The checks: the five stages, and the checks on the result. */
export type CheckId = Stage | "coverage" | "symmetry" | "texture" | "grain" | "ub";

/** Why an outcome is what it is. */
export type Reason =
  | "nothing to judge"
  | "ring left"
  | "ring dent"
  | "missed at nodes"
  | "sharp off-lattice"
  | "seam"
  | "pedestal"
  | "back-FFT"
  | "window past limit"
  | "window within limit"
  | "symmetry broken"
  | "not declared"
  | "fill bias"
  | "reach past coverage"
  | "reach inside coverage"
  // The window fitted to the coverage: its weight on unmeasured space, or the taper's reach, is the backend's own target (plan 4.5).
  | "window fitted"
  // A |Q| band set past the raw counts' edges (band_check), judged where the window is fitted to the coverage (plan 4.5).
  | "band past counts"
  | "second grain"
  | "no second grain"
  | "UB off"
  | "peaks beside nodes"
  | "UB turned"
  | "symmetrised"
  // The grid is too coarse for the check's measurement (metrics/coarse.ts): not judged.
  | "grid too coarse"
  // Fewer holes judged than the fill-bias rule needs, or none (metrics/texture.ts, volumeFillBias): not judged.
  | "too few holes"
  // What a recorded result says of itself (recorded.ts).
  | "no output"
  | "recorded verdict"
  | "words not a label"
  | "legacy coverage words";

export interface Outcome {
  check: CheckId;
  kind: Kind;
  reasons: readonly Reason[];
  dataProblems: readonly string[]; // what the data hold that no setting fixes, in {{achieved}}'s words
  words: string | null; // the verdict text the tool writes
  criterion?: string; // what the verdict is judged by, in words
}

/**
 * The numbers an evaluation shows rounded, unrounded, under this key: beside
 * the shown ones, where JSON (and so the model) never reads them. tune/evaluate.ts
 * puts the ΔPDF window's raw weight here; the rules read it (D6).
 */
export const UNROUNDED = Symbol("unrounded");
export interface Unrounded {
  window_weight_on_unmeasured?: number | null;
}

/** A stage's evaluation (tune/evaluate.ts), as assess_stage reports it. */
export type StageNumbers = Readonly<Record<string, unknown>> & { readonly [UNROUNDED]?: Unrounded };

/**
 * What qmax_coverage measured: the ΔPDF window's recorded weight on unmeasured
 * space; else the transform's reach against full coverage; and where the raw
 * counts end (its result's raw_counts, suggested_band and counts_end_inside_box).
 * The coverage is the raw volume's, measured once, in Python
 * (nebula3d.analysis.coverage).
 */
export interface CoverageMeasurements {
  window_weight: number | null; // the ΔPDF's record, raw
  window: string; // the window, as the verdict names it
  unit_cell: boolean; // |Q| is known
  full_coverage_q: number | null; // where the |Q| shells stop holding counts in 95 % of their voxels
  reach: number | null; // how far the transform's window reaches in |Q|
  reach_from: string; // why it reaches that far
  shell: number; // the coverage edge's resolution in |Q|: the shells' width
  band_set: boolean; // a |Q| band is set on the Configure page
  // Past its counts the volume holds zeros it marks measured: the window's
  // support takes them as data, so no taper to the coverage follows the counts.
  zeros_stored?: boolean;
  // The backend fits the window to the coverage: the support on, a window it
  // fits (auto or ellipsoid), and the support seeing where the counts end. It
  // keeps at most 1e-3 of the window's weight on unmeasured space by
  // construction, so that weight, or the taper's reach, is its own target, not
  // a check (plan 4.5).
  fitted?: boolean;
  // Where a band that is set leaves the raw counts (band_check's problems).
  band_problems?: readonly string[];
  counts: {
    counts_end_inside_box: boolean;
    raw_counts?: { q_max_edge: number | null; box_face_q: number };
    suggested_band?: readonly number[] | null;
    band_check?: string; // whether a band that is set stays inside the counts, in words
  };
}

/** What symmetry_check measured: each operation's share (null: nothing to test), the symmetry the file declares, and how many operations the sections could not test. */
export interface SymmetryMeasurements {
  ops: readonly { op: string; rms_difference: number }[] | null;
  declared: string | null | undefined; // null or "": none declared; undefined: the file was not read
  untested?: number;
  why?: string; // with no operation tested, why none could be
}

/** What each check's rule judges. */
export interface Measurements {
  rings: StageNumbers;
  punch: StageNumbers;
  backfill: StageNumbers;
  flatten: StageNumbers;
  pdf: StageNumbers;
  coverage: CoverageMeasurements;
  symmetry: SymmetryMeasurements;
  texture: Readonly<Record<string, unknown>>; // texture_check's result
  grain: GrainFacts;
  ub: Readonly<Record<string, unknown>>; // ub_check's result
}

/** How a verdict reads, in the report, the chat and the tools' results. */
const LABEL: Record<Kind, string> = { pass: "meets its goal", attention: "needs attention", info: "not judged" };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

interface Judged {
  kind: Kind;
  reasons: Reason[];
}

/** Nothing to judge: a fresh outcome each time, so no two outcomes share their reasons. */
const nothing = (): Judged => ({ kind: "info", reasons: ["nothing to judge"] });
/**
 * The grid too coarse for the check's measurement to judge anything (metrics/coarse.ts):
 * not judged, as nothing to judge is, for its own reason. No evidence never
 * passes, applied to resolution.
 */
const tooCoarse = (): Judged => ({ kind: "info", reasons: ["grid too coarse"] });
/** Attention for the reasons found, else a pass (with any reason that is no fault). */
const judged = (faults: Reason[], also: Reason[] = []): Judged =>
  faults.length ? { kind: "attention", reasons: [...faults, ...also] } : { kind: "pass", reasons: also };

// The criteria, the goals and the verdicts' words are tagged by class
// (inference.ts): whole as written for the report, the console and arm B; their
// definitions only with the skills off (the validation's arm C), where judge
// is told so.
interface StageRule {
  criterion: Tagged; // the report's and the tools' statement of the rule (WORDS.criterion)
  goal: Tagged; // the stage's goal (WORDS.goal): in assess_stage's single-stage result and the tuning prompts
  ownCriterion?: Tagged; // the stage's own evaluation's, where it judges less than the report
  judge: (m: StageNumbers) => Judged;
}

/** A stage's criterion or goal, tagged: registered under the stage. */
const criterionOf = (stage: string) => written(`verdicts/rules.ts: the ${stage} criterion`);
const goalOf = (stage: string) => written(`verdicts/rules.ts: the ${stage} goal`);

// ---------------------------------------------------------------- the stages

/**
 * The ring removal's notice (nebula3d.pipeline.unconfirmed_rings_notice): on a
 * grid too coarse to confirm a ring, the removal subtracts no shell it could
 * not confirm, and says how many ring candidates it detected (which may be
 * powder rings or the crystal's own scattering), what the grid needs and the
 * two ways out, in its run log line and its diagnostics, whose notice the
 * rings' evaluation carries (notice, tune/evaluate.ts). Its first sentence is a
 * definition; its last, the remedy with what it would subtract, is tagged here
 * as the backend writes it, for more than one candidate and for one
 * (RING_GRID_REMEDY and RING_GRID_REMEDY_ONE there), so arm C reads the notice
 * without it, wherever it stands (the review's G1, accepted by the manager on
 * the user's delegation, 2026-10-19).
 */
const RING_NOTICE = "verdicts/rules.ts: the ring removal's notice";
export const RING_NOTICE_REMEDY = quotedInference(
  RING_NOTICE,
  "remedy",
  " Use a finer grid, or, from the Python API, set pooled_confirm_rings=False to subtract every candidate, the crystal's own shells included.",
);
export const RING_NOTICE_REMEDY_ONE = quotedInference(
  RING_NOTICE,
  "remedy",
  " Use a finer grid, or, from the Python API, set pooled_confirm_rings=False to subtract it, even if it is the crystal's own shell.",
);

const rings: StageRule = {
  criterion: criterionOf("rings")`No powder ring left above, or dented below, three times its plane's noise. A bump is a powder ring only if it rises in nearly every direction over the sphere (at least 0.15 of its median height in 90 % of directions)${evidence(
    ": the crystal's own scattering at that |Q| rises in some directions only",
  )}.`,
  goal: goalOf("rings")`Remove powder/Al rings: mean_ring_energy_ratio as low as the trials reach on every plane (its floor is set by the diffuse, not 0; near 0.4–0.5 can be ring-free), while over_subtraction_fraction and after_negative_fraction stay small (a few percent from noise), and each raw ring ends level with the diffuse beside it: max_ring_dent (how far the deepest ring sits below its flanks, a share of the diffuse there${evidence(
    "; the subtraction over-shot, even where no voxel goes negative",
  )}) and max_ring_left (a ring left over) both 0: they count only residuals beyond 3 × their plane's noise_fraction, so any value above 0 is a real dent or leftover (worst_ring_dent and worst_ring_left say on which plane and at which |Q|). A bump counts only if it is a powder ring, rising in nearly every direction over the sphere (shells_judged); the others are the crystal's own scattering, which the removal must leave and subtracts nothing from (per_plane marks them ring: false, out of its worst_ring_dent and worst_ring_left). Lower ring energy bought by over-subtracting (negatives or ring dents rising) is worse, not better.`,
  judge: (m) => {
    const left = num(m.max_ring_left);
    const dent = num(m.max_ring_dent);
    // Not judged where the 3D test could not run, or the grid is too coarse for it (ring_rule says so).
    if (left == null || dent == null) return isTooCoarse(m.ring_rule) ? tooCoarse() : nothing();
    // A leftover or dent above 0 is beyond 3 × its plane's noise: real, by the tool's definition.
    return judged([...(left !== 0 ? (["ring left"] as const) : []), ...(dent !== 0 ? (["ring dent"] as const) : [])]);
  },
};

/**
 * D5, unified (plan 2.4.5, the user's decision of 2026-10-19): the sharp
 * off-lattice peaks on protected planes stay by design, as the punch's goal
 * says, so its verdict leaves them out. The punch's evaluation shows them on
 * their own line, leftover_on_protected_planes_sharp (tune/evaluate.ts, from
 * each leftover's marks); an evaluation recorded without it counts every sharp
 * one, as before. true: the verdict counted them among
 * leftover_off_lattice_sharp, before 2.4.5.
 */
export const D5_PROTECTED_SHARP_PEAKS_COUNT = false;

const punch: StageRule = {
  criterion: criterionOf("punch")`No Bragg peak missed at a lattice node, and no sharp peak left off the lattice outside the protected planes. Broad maxima${evidence(" are diffuse scattering, and")} stay.`,
  goal: goalOf("punch")`Remove every sharp peak that should go while punching as little as possible (punched_fraction small): every punched voxel is diffuse signal thrown away and later backfilled. Missed lattice peaks (leftover_at_nodes) must reach 0 on every plane; off-lattice sharp peaks (leftover_off_lattice)${evidence(
    " are satellites or spurious peaks",
  )} the search punches unless their H planes are protected: leftover_on_protected_planes of them sit on protected planes and stay by design (whether they are real is the user's call), while the rest are peaks the search left, so fewer of those is better where they are spurious. leftover_off_lattice splits into leftover_off_lattice_sharp (punch candidates) and leftover_off_lattice_broad (FWHM ≥ 5 voxels along a slice axis${evidence(
    ": diffuse maxima such as short-range order, which are the signal, not peaks to punch",
  )}). Fewer leftovers win only if the punched fraction does not grow substantially; lowering the significance or the search floor punches noise and diffuse maxima, raising them leaves weak peaks.`,
  judge: (m) => {
    const atNodes = num(m.leftover_at_nodes);
    if (atNodes == null) return nothing();
    const sharp = num(m.leftover_off_lattice_sharp) ?? 0;
    const counted = D5_PROTECTED_SHARP_PEAKS_COUNT ? sharp : sharp - (num(m.leftover_on_protected_planes_sharp) ?? 0);
    return judged([...(atNodes !== 0 ? (["missed at nodes"] as const) : []), ...(counted !== 0 ? (["sharp off-lattice"] as const) : [])]);
  },
};

const backfill: StageRule = {
  criterion: criterionOf("backfill")`The fills meet their surroundings: a median seam of 1σ or less, and the fills not biased one way.`,
  goal: goalOf("backfill")`Fill punched holes seamlessly: median_seam_sigma ≲ 1, bright_fill_fraction small${evidence(" (no bright plugs where peaks were)")}, checkerboard_fraction near 0.5${evidence(
    " (near 1 is a periodic interpolation artefact)",
  )}.`,
  // A stage's evaluation measures no fill bias (texture_check does): its
  // criterion says only what it judges.
  ownCriterion: written("verdicts/rules.ts: the backfill's own criterion")`The fills meet their surroundings: a median seam of 1σ or less.${reading(
    " Whether the fills are biased one way is texture_check's to say.",
  )}`,
  judge: (m) => {
    const seam = num(m.mean_median_seam_sigma);
    if (seam == null) return nothing();
    return judged(seam <= 1 ? [] : ["seam"]);
  },
};

/**
 * Why the flatten's verdict no longer holds the floors to 1σ: the user chose to
 * drop that limit (2026-10-17), of keeping, widening or dropping it; provisional,
 * as the pedestal rule's 0.8 limits are. The σ is the flattened cut's
 * own robust spread, which the diffuse structure and the counting noise set, and
 * the floors after a flatten that fits a constant follow the diffuse level: on
 * all eight dev volumes of the validation they read 1.5 to 1.8σ, the clean
 * control (1.72σ) and the planted case after its Q² term (1.52σ) included, so
 * the limit could not be met whatever the flatten did, while the pedestal rule
 * alone separates the planted background from the rest (docs/pilot-review.md,
 * finding 6). The largest floor in σ is still measured and reported.
 */
export const FLATTEN_FLOOR_SIGMA_NOTE = "reported, not judged";

/** Why the largest floor in σ is FLATTEN_FLOOR_SIGMA_NOTE, in the flatten's criterion and the system prompt (prompts/system.ts). */
export const FLOOR_SIGMA_WHY = "σ is the cut's own spread, and the floors follow the diffuse level";

/** The shells the flatten's rule judges a pedestal on (judgedShells, metrics/flatten.ts), in its criterion and the system prompt. */
export const PEDESTAL_SHELLS = "the outer half of the |Q| shells the counts reach";

/**
 * Where the flatten's verdict reads the pedestal (plan 4.1): over the whole
 * volume's shells, not three planes', in its criterion and the system prompt.
 * "The volume", as the system prompt calls the data a cut is taken from: in
 * as few words as the criterion's own before it, so the results it is in grow
 * no longer.
 */
export const PEDESTAL_WHERE = "the volume's";

/**
 * Whether a flatten evaluation measured the pedestal over the whole volume
 * (plan 4.1: floor_trend and floor_span_fraction, of the volume's shell
 * floors) or, recorded before that, over three planes (max_floor_trend and
 * max_floor_span_fraction, the largest of the planes'). The rule reads the
 * one the evaluation holds; the report too.
 */
export const pedestalOfVolume = (m: Readonly<Record<string, unknown>>): boolean => "floor_trend" in m || "floor_span_fraction" in m;

// The flatten's goal: what to change about a pedestal left is reduction-qc's
// step 6 (a floor rising with |Q| wants the b·Q² term and a fit range reaching
// the coverage), and what a trend and a span near 1 are evidence of goes with it.
const flatten: StageRule = {
  criterion: criterionOf("flatten")`No pedestal: ${PEDESTAL_WHERE} floor trend and span both ${PEDESTAL_LIMIT} or more over ${PEDESTAL_SHELLS}. The largest floor in σ is ${FLATTEN_FLOOR_SIGMA_NOTE}: ${FLOOR_SIGMA_WHY}.`,
  goal: goalOf("flatten")`Bring the per-|Q|-shell floor to about 0 and level across |Q| (floor_after near 0 in all thirds) without over-subtracting (floors well below 0), and leave no pedestal: floor_trend (|rank correlation| of the floors with |Q|, over the outer half of the shells the counts reach) well below 1 and floor_span_fraction well below 1 (pedestal_left false). after_floor_max_sigma is the floors in the cut's own σ, which the diffuse sets: it reads above 1 on sound flattens and is no goal by itself.${evidence(
    " A trend near 1 with a span near 1 or more is a background the model missed, however small it reads in σ",
  )}${remedy(": a rising one wants flattenQ2 and a fit range reaching the coverage (flattenFitQMax), not a free-form estimator, which also removes isotropic pair correlations.")}`,
  judge: (m) => {
    // A trend near 1 with a span near 1 is a pedestal left: the whole volume's
    // (plan 4.1), or the planes' largest in an evaluation recorded before it.
    // The floor in σ is reported, not judged (FLATTEN_FLOOR_SIGMA_NOTE).
    const volume = pedestalOfVolume(m);
    const pedestal = pedestalLeft(num(volume ? m.floor_trend : m.max_floor_trend), num(volume ? m.floor_span_fraction : m.max_floor_span_fraction));
    if (pedestal == null) return nothing();
    return judged(pedestal ? ["pedestal"] : []);
  },
};

/** The back-FFT round trip's limit on r (the ΔPDF's criterion). */
export const BACK_FFT_R_OK = 0.999;

/** What the forward transform keeps, which the round trip is judged against (backFftOk): in the ΔPDF's criterion and the prompts (prompts/). */
export const EVEN_PART = "the data's even part under Q → −Q";

/**
 * Whether the back-FFT round trip passes, or null when it does not judge. The
 * transform keeps the real part of the Fourier transform, the data's even part
 * under Q → −Q, so a sound transform reproduces that part to r = 1, and r
 * against the data is limited by the odd part: on unsymmetrised data, counting
 * noise (r 0.979 to 0.996 on every dev case of the validation, which a sound
 * transform failed at 0.999; docs/pilot-review.md, finding 3). A check recorded
 * before the even part was compared judges r against the data only where the
 * file declares the data symmetrised (or the volume was not read), where the
 * two are the same.
 */
function backFftOk(m: StageNumbers): boolean | null {
  const even = num(m.back_fft_pearson_r_even);
  if (even != null) return even >= BACK_FFT_R_OK;
  const r = num(m.back_fft_pearson_r);
  if (r == null || m.symmetry_declared === false) return null;
  return r >= BACK_FFT_R_OK;
}

/**
 * D6, unified (plan 2.4.6, the user's decision of 2026-10-19): every check
 * compares the window's raw weight on unmeasured space against 1e-3. The ΔPDF's
 * rule, and the tuning's limit (outOfBounds, which reads this rule), read the
 * raw weight the evaluation keeps beside the one it shows (UNROUNDED), as
 * qmax_coverage does: at 1.04e-3 all three are past the limit. Since 2.4.6b the
 * weight is shown to WEIGHT_FIGURES figures (0.00104, where two showed 0.001).
 * An evaluation read back from its JSON has only the shown weight. true: the
 * ΔPDF's rule compared the shown weight, before 2.4.6.
 */
export const D6_PDF_READS_ROUNDED_WEIGHT = false;

/** The ΔPDF window's weight on unmeasured space, as the ΔPDF's rule compares it (D6), or null. */
function windowWeight(m: StageNumbers): number | null {
  const shown = num(m.window_weight_on_unmeasured);
  return D6_PDF_READS_ROUNDED_WEIGHT ? shown : (num(m[UNROUNDED]?.window_weight_on_unmeasured) ?? shown);
}

/**
 * D15, unified (plan 2.4b.5, batch 2, approved by the manager on the user's
 * delegation, 2026-10-19): a ΔPDF evaluation that measured nothing (no round
 * trip, no window weight, no symmetry) is not judged, "nothing to judge", as
 * every other rule says of no evidence. true: the ΔPDF's rule passed it,
 * before 2.4b.5.
 */
export const D15_PDF_PASSES_UNMEASURED = false;

const pdf: StageRule = {
  criterion: criterionOf("pdf")`The back-FFT reproduces what the transform keeps, ${EVEN_PART}, to an r of ${BACK_FFT_R_OK} or more (a check recorded without that comparison: r against the data, judged only on data the file declares symmetrised, where the two are the same); at most 1e-3 of the window's weight on unmeasured space; and the declared symmetry kept.`,
  goal: goalOf("pdf")`The ΔPDF must show features above noise (feature_snr) with the transform's reach inside the measured coverage: window_weight_on_unmeasured, the share of the window's weight on unmeasured reciprocal space, must stay at or below 1e-3, where the backend's own window keeps it (a trial past it is not a candidate).${evidence(
    " A window that reaches further raises feature_snr with the backfill's guesses and the box's empty corners, which is worse, not better.",
  )} max_symmetry_break is the x–y section's largest RMS difference from its image under the declared group's operations that map it onto itself (none declared: the cell's in-plane operations; worst_symmetry_op names it)${evidence(
    ": a trial that raises it far above your settings' value broke a symmetry your settings kept, as a separable window does on a hexagonal cell",
  )}. back_fft_pearson_r_even, the round trip against the data's even part under Q → −Q (what the real transform keeps), must stay near 1; back_fft_pearson_r against the data is lower by the odd part (back_fft_odd_share, counting noise on unsymmetrised data). Without a band or crop the round trip is the identity, so neither can rank trials${evidence(
    ": back_fft_pearson_r_even below ~0.999 only flags a transform problem",
  )}. Apodization trades real-space resolution against truncation ripples; prefer the default unless another is clearly better on feature_snr without the reach leaving the coverage.`,
  judge: (m) => {
    const back = backFftOk(m);
    const open = windowWeight(m);
    const worst = num(m.max_symmetry_break);
    if (!D15_PDF_PASSES_UNMEASURED && back == null && open == null && worst == null) return nothing();
    // The worst in-plane symmetry break, judged as symmetry_check judges each
    // operation; a file that declares no symmetry was not symmetrised, so its
    // section's asymmetry is the data's own and no stage broke anything.
    const broken = worst != null && m.symmetry_declared !== false && worst > SYMMETRY_HOLDS;
    return judged(
      [
        ...(back === false ? (["back-FFT"] as const) : []),
        ...(open != null && open > OPEN_WEIGHT_OK ? (["window past limit"] as const) : []),
        ...(broken ? (["symmetry broken"] as const) : []),
      ],
      open != null && open <= OPEN_WEIGHT_OK ? ["window within limit"] : [],
    );
  },
};

const STAGE_RULES: Record<Stage, StageRule> = { rings, punch, backfill, flatten, pdf };

// ---------------------------------------------------------------- the checks on the result

interface Words extends Judged {
  words: string | Tagged | null; // tagged where it holds inference (inference.ts): judge renders it by the switch
  dataProblems?: string[];
}

// The inference the checks' words hold, written once; the words, built for
// each call with their numbers, take it from here (inference.ts).
const COVERAGE_WORDS = "verdicts/rules.ts: qmax_coverage's verdict";
const TAPER_OR_BAND = inference(COVERAGE_WORDS, "remedy", "; taper it to the coverage (pdfWindowSupport) or set a |Q| band");
const BAND_OR_TAPER = inference(COVERAGE_WORDS, "remedy", "; set a |Q| band at or below it, or taper the window to the coverage");
// Where the volume stores zeros it marks measured, no taper follows the counts.
const BAND_AT_OR_BELOW = inference(COVERAGE_WORDS, "remedy", "; set a |Q| band at or below it");
// A band set past the counts, where the window is fitted to the coverage (plan 4.5).
const BAND_THEY_ALLOW = inference(COVERAGE_WORDS, "remedy", "; the band the counts allow is suggested_band, the user's to set");
const SYMMETRY_WORDS = "verdicts/rules.ts: symmetry_check's verdict";
const ASYMMETRY_IS = inference(SYMMETRY_WORDS, "evidence", ", so the sections' asymmetry (");
const THE_DATA_OWN = inference(SYMMETRY_WORDS, "evidence", ") is the data's own, counting noise included, not a break by a stage");
const GRAIN_WORDS = "verdicts/rules.ts: grain_check's verdict";
const REFINE_UB = inference(GRAIN_WORDS, "remedy", "; refine the UB");
const SYMMETRISED_COPIES = inference(GRAIN_WORDS, "evidence", ": copies of the crystal's own Bragg peaks, displaced by symmetrising data whose UB is off by about that angle");
const REFINED_ON_UNSYMMETRISED = inference(GRAIN_WORDS, "remedy", "; a UB refined on the unsymmetrised data would put them back on the nodes");
const PEAKS_OFF_NODES = inference(GRAIN_WORDS, "evidence", ": the Bragg peaks themselves, off their nodes by about that angle");
const REFINE_IT = inference(GRAIN_WORDS, "remedy", " (refine the UB)");
const ORIGIN_OPEN = inference(GRAIN_WORDS, "evidence", "; their origin is open (another phase, multiple scattering, or an artefact)");

interface CheckRule<M> {
  criterion?: string; // the report's statement of the rule (WORDS.criterion)
  judge: (m: M) => Words;
}

/**
 * The significant figures a window's weight on unmeasured space is shown to
 * (plan 2.4.6b, after D6): three, so a weight past the 1e-3 limit never reads
 * as 0.001 beside a verdict that it is past it (1.04e-3 shows as 0.00104).
 */
export const WEIGHT_FIGURES = 3;

/** A window's weight on unmeasured space as the checks show it: WEIGHT_FIGURES figures, in exponent form when tiny (2.4e-4, not 0.00024). */
export const shownWeight = (x: number): string => {
  const r = roundSig(x, WEIGHT_FIGURES);
  return r !== 0 && Math.abs(r) < 1e-3 ? r.toExponential() : String(r);
};

/** The raw counts' upper edge inside the box, no band set, in the verdict's words: the edge, the box's face and the band the counts allow. */
const countsEnd = (c: CoverageMeasurements["counts"], taper: string): string =>
  `the raw counts end at ${c.raw_counts?.q_max_edge} Å⁻¹, inside the box (its nearest face at ${c.raw_counts?.box_face_q} Å⁻¹), and no |Q| band is set${taper}: the band they allow is ${c.suggested_band?.[0]}–${c.suggested_band?.[1]} Å⁻¹ (suggested_band), the user's to set`;

/**
 * Plan 4.5 (approved by the manager on the user's delegation, 2026-10-19): with
 * the window fitted to the coverage the backend keeps at most 1e-3 of its
 * weight on unmeasured space by construction (compute_delta_pdf's
 * support_tol, the limit this rule judges against), so that weight, or the
 * taper's reach, holds by construction and judges nothing. The verdict says
 * so, and judges what it can: where the raw counts end (batch 1's sentence and
 * data problem) and a band that is set (band_check), which needs attention
 * past the counts' edges, the user's rule (reduction-qc, step 3).
 */
function fittedVerdict(m: CoverageMeasurements, w: number | null): Words {
  const c = m.counts ?? { counts_end_inside_box: false };
  const target =
    w != null
      ? `${m.window} puts ${shownWeight(w)} of its weight on unmeasured reciprocal space, which the backend keeps within 1e-3 when it fits the window to the coverage: its own target, not a check`
      : "the window is tapered to the measured coverage, where the backend fits it to keep at most 1e-3 of its weight on unmeasured reciprocal space: its own target, not a check";
  const weight: Reason[] = w != null ? ["window within limit"] : [];
  const past = m.band_set ? (m.band_problems ?? []) : [];
  if (past.length) {
    return { kind: "attention", reasons: ["band past counts", ...weight], words: built`too far: ${past.join("; ")}; ${target}${BAND_THEY_ALLOW}`, dataProblems: countsProblems(c) };
  }
  const judgedHere = m.band_set
    ? (c.band_check ?? "the band set stays inside the counts")
    : c.counts_end_inside_box
      ? countsEnd(c, ", so only the window's taper keeps the transform on the counts")
      : "the raw counts reach the box's nearest face";
  return { kind: "pass", reasons: ["window fitted", ...weight], words: `fitted to the coverage: ${target}; ${judgedHere}`, dataProblems: countsProblems(c) };
}

const coverage: CheckRule<CoverageMeasurements> = {
  judge: (m) => {
    const w = m.window_weight ?? null;
    const full = m.full_coverage_q ?? null;
    if (m.fitted && m.unit_cell && (w == null || w <= OPEN_WEIGHT_OK)) return fittedVerdict(m, w);
    // The ΔPDF on disk records the share of its window's weight on unmeasured
    // space: the direct measure of a reach past the coverage. Without it, the
    // reach from the Configure page's settings against full coverage.
    const [outcome, text]: [Judged, string | Tagged] =
      w != null
        ? w <= OPEN_WEIGHT_OK
          ? [{ kind: "pass", reasons: ["window within limit"] }, `clean: ${m.window} puts ${shownWeight(w)} of its weight on unmeasured reciprocal space`]
          : [
              { kind: "attention", reasons: ["window past limit"] },
              built`too far: ${m.window} puts ${shownWeight(w)} of its weight on unmeasured reciprocal space${TAPER_OR_BAND}`,
            ]
        : !m.unit_cell
          ? [nothing(), "no unit cell: |Q| is unknown, so the reach cannot be compared"]
          : full == null
            ? [nothing(), "no |Q| shell is fully measured"]
            : m.reach == null
              ? [nothing(), "no ΔPDF yet to read the box corner from"]
              : m.reach <= full + m.shell
                ? [{ kind: "pass", reasons: ["reach inside coverage"] }, `the transform reaches ${roundSig(m.reach, 4)} Å⁻¹ (${m.reach_from}), inside full coverage at ${full} Å⁻¹`]
                : [
                    { kind: "attention", reasons: ["reach past coverage"] },
                    built`too far: the transform reaches ${roundSig(m.reach, 4)} Å⁻¹ (${m.reach_from}), past full coverage at ${full} Å⁻¹${m.zeros_stored ? BAND_AT_OR_BELOW : BAND_OR_TAPER}`,
                  ];
    // The counts end inside the box and no band is set. Said in the verdict,
    // which a model quotes, and not only in raw_counts and suggested_band,
    // which it may not. With the window not fitted to the coverage (the support
    // off, a window the backend does not fit, or zeros stored past the counts)
    // no taper keeps the transform on the counts.
    const c = m.counts ?? { counts_end_inside_box: false };
    const cut = c.counts_end_inside_box && !m.band_set ? `; ${countsEnd(c, "")}` : "";
    return { ...outcome, words: joined([text, cut]), dataProblems: countsProblems(c) };
  },
};

/** The data's problem where the raw counts end inside the box, in {{achieved}}'s words (a band set or not). */
export function countsProblems(c: { counts_end_inside_box?: unknown; raw_counts?: unknown }): string[] {
  const edge = (c.raw_counts as { q_max_edge?: unknown } | null | undefined)?.q_max_edge;
  return c.counts_end_inside_box === true && num(edge) != null ? [`the counts end at ${edge} Å⁻¹, inside the box`] : [];
}

/** What the symmetry verdict says of a volume that declares no symmetry. */
const NOT_DECLARED = (asymmetry: unknown): Tagged =>
  built`not judged: the file declares no symmetry${ASYMMETRY_IS}${inferred("evidence", String(asymmetry))}${THE_DATA_OWN}`;

const symmetry: CheckRule<SymmetryMeasurements> = {
  judge: (m) => {
    // No operation tested is no evidence: not judged, and why, never a pass.
    if (!m.ops?.length) return { ...nothing(), words: `not judged: ${m.why ?? "no operation could be tested on the sections"}` };
    // A file that declares no symmetry was not symmetrised: the sections'
    // asymmetry is the data's own, and no stage broke anything.
    if (m.declared === null || m.declared === "") return { kind: "info", reasons: ["not declared"], words: NOT_DECLARED(Math.max(...m.ops.map((o) => o.rms_difference))) };
    // Every operation tested is judged alike, whether it keeps c or moves it.
    const broken = m.ops.filter((o) => o.rms_difference > SYMMETRY_HOLDS).map((o) => `${o.op} (${o.rms_difference})`);
    const untested = m.untested ? `; ${m.untested} could not be tested (not_tested says why)` : "";
    return broken.length
      ? { kind: "attention", reasons: ["symmetry broken"], words: `not kept: ${broken.join(", ")}; a symmetry the data were symmetrised with should hold to ~${SYMMETRY_HOLDS} or better` }
      : { kind: "pass", reasons: [], words: `kept: every operation tested holds to ${SYMMETRY_HOLDS} or better${untested}` };
  },
};

const texture: CheckRule<Readonly<Record<string, unknown>>> = {
  // texture_check writes no verdict: its result says whether the fills are
  // biased. Since plan 4.2 it reads every punch hole of the volume in 3-D
  // (metrics/texture.ts, volumeFillBias): systematic_fill_bias true needs
  // attention, false passes, and null is not judged, with why (not_judged):
  // the grid too coarse for the holes' rims ("grid too coarse: …"), else too
  // few holes judged, or none ("too few holes"). The run's verdict says either
  // (readers.ts). A result recorded before 4.2 has none of that: each of its
  // cuts says whether its fill is biased, and it reads as it did.
  // A cut whose grid is too coarse to judge its fills (not_judged, texture.ts's
  // roomForRims) is no evidence either way: the fills pass only when every cut
  // was judged, and a judged cut's bias still needs attention.
  judge: (m) => {
    if ("systematic_fill_bias" in m) {
      if (m.systematic_fill_bias === true) return { kind: "attention", reasons: ["fill bias"], words: null };
      if (isTooCoarse(m.not_judged)) return { ...tooCoarse(), words: null };
      if (m.systematic_fill_bias === false) return { kind: "pass", reasons: [], words: null };
      return m.systematic_fill_bias === null && typeof m.not_judged === "string"
        ? { kind: "info", reasons: ["too few holes"], words: null }
        : { ...nothing(), words: null };
    }
    const cuts = (Array.isArray(m.per_cut) ? (m.per_cut as unknown[]) : []).filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
    if (cuts.some((x) => x.systematic_fill_bias === true)) return { kind: "attention", reasons: ["fill bias"], words: null };
    if (cuts.some((x) => isTooCoarse(x.not_judged))) return { ...tooCoarse(), words: null };
    return cuts.length ? { kind: "pass", reasons: [], words: null } : { ...nothing(), words: null };
  },
};

/**
 * The data's problem in grain_check's "UB off", in {{achieved}}'s words (D3,
 * plan 2.4.3): the UB off by the rotation that puts the off-lattice peaks, the
 * crystal's own Bragg peaks, back on the Bragg lattice. The angle as the
 * verdict shows it; a recording without one names none.
 */
export const ubOffProblem = (turnDeg: number | null): string =>
  `the UB is off${turnDeg != null ? ` by ${turnDeg}°` : ""} (one rotation puts the off-lattice peaks back on the Bragg lattice)`;

/**
 * The data's problem in grain_check's peaks beside the Bragg nodes, worded as
 * ubOffProblem (D3a, approved by the manager on the user's delegation,
 * 2026-10-19): half or more of the strongest off-lattice orbits sit beside
 * Bragg nodes, the crystal's own Bragg peaks displaced by a UB that is off by
 * at least their median offset (a lower bound, as the verdict says). The
 * angle as the verdict shows it; without one, none.
 */
export const besideNodesProblem = (medianDeg: number | null): string =>
  `the UB is off${medianDeg != null ? ` by at least ${medianDeg}°` : ""} (the strongest off-lattice peaks sit beside Bragg nodes)`;

const grain: CheckRule<GrainFacts> = {
  criterion: "One grain, its UB right: no rotation of the Bragg lattice indexes the off-lattice peaks better than random directions do, and fewer than half of the strongest sit beside Bragg nodes, where a UB that is off puts the crystal's own peaks.",
  judge: (g) => {
    const n = g.judged;
    if (typeof n !== "number") return { ...nothing(), words: null };
    const indexed = g.rotated_copy?.indexed ?? 0;
    const turn = g.rotated_copy?.misorientation_deg ?? null;
    const control = g.random_control;
    const near = g.near_bragg_nodes ?? 0;
    const median = g.near_offset_angle_deg?.median ?? null;
    // Half or more of the strongest orbits beside Bragg nodes: the crystal's own peaks, displaced by a UB that is off (D3a).
    const beside: Reason[] = n > 0 && near >= n / 2 ? ["peaks beside nodes"] : [];
    const besideProblem = beside.length ? [besideNodesProblem(median != null ? r2(median) : null)] : [];
    if (!n) return { kind: "pass", reasons: [], words: "no off-lattice peaks were recorded by the punch's search" };
    const fits = n >= 4 && indexed >= Math.max(n / 2, 3 * control + 3);
    // A rotated copy within a couple of degrees of the main lattice is the main
    // crystal with its UB off, not another grain.
    const second = fits && (turn == null || turn >= SECOND_GRAIN_DEG);
    if (fits && !second) {
      return {
        kind: "attention",
        reasons: ["UB off", ...beside],
        words: built`the off-lattice peaks are the crystal's own Bragg peaks with the UB off: one rotation of ${r2(turn!)}° puts ${indexed} of the ${n} strongest orbits back on the Bragg lattice (random directions: ${control})${REFINE_UB}`,
        dataProblems: [ubOffProblem(r2(turn!))],
      };
    }
    if (second) {
      return {
        kind: "attention",
        reasons: ["second grain", ...beside],
        words: `a second grain: one rotation of the Bragg lattice indexes ${indexed} of the ${n} strongest off-lattice orbits (random directions: ${control})${turn != null ? `, misoriented by ${r2(turn)}° from the main grain` : ""}`,
        dataProblems: besideProblem,
      };
    }
    const words: (Span | Tagged)[] = [
      `no second grain of this phase: a rotated copy of the Bragg lattice indexes only ${indexed} of the ${n} strongest off-lattice orbits (random directions: ${control})`,
    ];
    if (near >= n / 2 && median != null) {
      words.push(
        `. ${near} of them sit within a quarter of the node spacing of a Bragg node, offset by a median ${r2(median)}° of rotation (a lower bound: a node at an angle to the rotation axis moves less)`,
        ...(g.symmetrised ? [SYMMETRISED_COPIES, REFINED_ON_UNSYMMETRISED] : [PEAKS_OFF_NODES, REFINE_IT]),
      );
    }
    if (g.far?.length) words.push(`. ${n - near} lie farther from any node`, ORIGIN_OPEN);
    return { kind: beside.length ? "attention" : "pass", reasons: ["no second grain", ...beside], words: joined(words), dataProblems: besideProblem };
  },
};

/**
 * A UB turned by this much (degrees) or more is reported: the fit's own noise
 * lies below it. The validation's grader holds an answer to the same limit
 * with a number of its own (UB_NOISE_DEG, evals/validation.ts, which imports
 * nothing of this module); a test holds the two to one boundary by behaviour
 * (evals/validation.test.ts), so changing this one fails it (plan 3.2).
 */
const UB_TURN = 0.05;

/** The turn a ub_check result reports, in degrees: orientation_change_deg, else the angle_deg of a recording made before that field. */
const ubTurn = (u: Readonly<Record<string, unknown>>): number | null => num(u.orientation_change_deg) ?? num(u.angle_deg);

/**
 * D4: a symmetrised volume's UB cannot be judged. It takes the symmetric fit
 * (ub_check writes symmetrised true exactly when it does), which sees only the
 * changes that commute with the volume's operations; a misorientation needs
 * the unsymmetrised data. Its turn is no data problem, and the UB is not right
 * either: a claim that it is right is still sent back. The answer checks send
 * a claim back only against an outcome that needs attention (one not judged
 * decides no claim: contradictions, answerChecks.ts), so its outcome needs
 * attention, for the reason "symmetrised".
 */
export const UB_NOT_JUDGED = (u: Readonly<Record<string, unknown>>): boolean => u.symmetrised === true || u.fit === "symmetric";

/**
 * D4, unified (plan 2.4.4, the user's decision of 2026-10-19): one "UB
 * turned", a turn of UB_TURN or more from an unsymmetrised fit (a UB that can
 * be judged), its angle as ub_check reports it. {{achieved}} names it a data
 * problem, and the answer checks hold a claim that the UB is right to it.
 * Before 2.4.4 they read two rules: {{achieved}} took orientation_change_deg
 * alone, and the answer checks a symmetric fit's turn too.
 */
export const UB_TURNED = (u: Readonly<Record<string, unknown>>): boolean => {
  const angle = ubTurn(u);
  return angle != null && angle >= UB_TURN && !UB_NOT_JUDGED(u);
};

/** How ub_check's data problem of a shifted HKL origin opens: it is no UB evidence, so {{achieved}} keeps it whichever check's UB evidence is newest (D7). */
const ORIGIN_PROBLEM = "the HKL origin is shifted by ";
export const isOriginProblem = (p: string): boolean => p.startsWith(ORIGIN_PROBLEM);

/**
 * D16, unified (plan 2.4b.5, batch 2, approved by the manager on the user's
 * delegation, 2026-10-19): a ub_check result without an angle, on a volume not
 * symmetrised, is not judged, "nothing to judge", as every other rule says of
 * no evidence (ub_check always writes its angle; recordings may not). true: it
 * read as a right UB, before 2.4b.5.
 */
export const D16_UB_UNMEASURED_READS_RIGHT = false;

const ub: CheckRule<Readonly<Record<string, unknown>>> = {
  // ub_check writes no verdict: what the fit found, and the data's problems it shows.
  judge: (u) => {
    const dataProblems: string[] = [];
    const turned = UB_TURNED(u);
    if (turned) dataProblems.push(`the UB is turned by ${ubTurn(u)}°`);
    const shift = Array.isArray(u.origin_shift_rlu) ? (u.origin_shift_rlu as unknown[]) : null;
    if (shift) dataProblems.push(`${ORIGIN_PROBLEM}(${shift.join(", ")}) r.l.u.`);
    // Not judged, or turned: either holds a claim that the UB is right to account.
    if (UB_NOT_JUDGED(u)) return { kind: "attention", reasons: ["symmetrised"], words: null, dataProblems };
    if (turned) return { kind: "attention", reasons: ["UB turned"], words: null, dataProblems };
    if (!D16_UB_UNMEASURED_READS_RIGHT && ubTurn(u) == null) return { ...nothing(), words: null, dataProblems };
    return { kind: "pass", reasons: [], words: null, dataProblems };
  },
};

const CHECK_RULES: { [C in Exclude<CheckId, Stage>]: CheckRule<Measurements[C]> } = { coverage, symmetry, texture, grain, ub };

// ---------------------------------------------------------------- the interface's words

const goals = (skills: boolean): Record<TuneStage, string> =>
  Object.fromEntries(Object.entries(STAGE_RULES).map(([stage, rule]) => [stage, rule.goal.text(skills)])) as Record<TuneStage, string>;

/** The text the checks' results carry: the verdicts' labels, the rules as criteria, and the stages' goals. */
export const WORDS: {
  label: Record<Kind, string>;
  criterion: Record<string, string>;
  goal: Record<TuneStage, string>;
  // The goals with the skills off (the switch, skills.ts: the validation's arm C): their definitions only (inference.ts).
  goalWithoutSkills: Record<TuneStage, string>;
} = {
  label: LABEL,
  criterion: {
    rings: rings.criterion.whole,
    punch: punch.criterion.whole,
    grains: grain.criterion!,
    backfill: backfill.criterion.whole,
    flatten: flatten.criterion.whole,
    pdf: pdf.criterion.whole,
  },
  goal: goals(true),
  goalWithoutSkills: goals(false),
};

const isStage = (check: CheckId): check is Stage => check in STAGE_RULES;

/** A check's words, as the skills' switch has them: tagged ones whole with the skills on, their definitions with them off. */
const said = (words: string | Tagged | null, skills: boolean): string | null =>
  words === null || typeof words === "string" ? words : words.text(skills);

/**
 * A check's outcome from its measurements, by its rule: what its tool writes,
 * and what the readers read. A stage whose evaluation says its output is
 * "missing" (assess_stage, before the run computed it) has no output to judge:
 * its tool writes no verdict for it. With the skills off (a tool of the
 * validation's arm C asks so) its words and its criterion are their
 * definitions only; its kind, reasons and data problems are the same either way.
 */
export function judge<C extends CheckId>(check: C, m: Measurements[C], { skills = true }: { skills?: boolean } = {}): Outcome {
  if (isStage(check)) {
    if (m && typeof m === "object" && "missing" in m) return { check, kind: "info", reasons: ["no output"], dataProblems: [], words: null };
    const rule = STAGE_RULES[check];
    const { kind, reasons } = rule.judge((m ?? {}) as StageNumbers);
    return { check, kind, reasons, dataProblems: [], words: LABEL[kind], criterion: (rule.ownCriterion ?? rule.criterion).text(skills) };
  }
  const rule = CHECK_RULES[check as Exclude<CheckId, Stage>] as CheckRule<unknown>;
  const { kind, reasons, words, dataProblems = [] } = rule.judge(m ?? {});
  return { check, kind, reasons, dataProblems, words: said(words, skills), ...(rule.criterion ? { criterion: rule.criterion } : {}) };
}
