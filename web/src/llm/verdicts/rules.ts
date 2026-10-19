// The checks' rules, one table entry each: the rule that judges the check's
// measurements, the words its tool writes from the outcome, the criterion the
// rule is stated as, and a stage's goal. Implementation behind the interface,
// verdicts/index.ts; the readers (readers.ts) read the outcomes it gives.
//
// A rule is pure and total: it never throws, and with nothing to judge its
// outcome is "info" with the reason "nothing to judge" (the ΔPDF's rule is the
// named exception, D15). An "attention" outcome always carries a reason.

import { OPEN_WEIGHT_OK } from "../metrics/coverage";
import { pedestalLeft } from "../metrics/flatten";
import { SYMMETRY_HOLDS } from "../metrics/symmetry";
import type { TuneStage } from "../tune/catalog";

/** An outcome's kind: met, needs attention, or not judged ("info", as the records and the report's CSS spell it). */
export type Kind = "pass" | "attention" | "info";

export type Stage = TuneStage;

/** The checks: the five stages, and the checks on the result. */
export type CheckId = Stage;

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
  | "symmetry broken";

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

/** What each check's rule judges. */
export interface Measurements {
  rings: StageNumbers;
  punch: StageNumbers;
  backfill: StageNumbers;
  flatten: StageNumbers;
  pdf: StageNumbers;
}

/** How a verdict reads, in the report, the chat and the tools' results. */
const LABEL: Record<Kind, string> = { pass: "meets its goal", attention: "needs attention", info: "not judged" };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

interface Judged {
  kind: Kind;
  reasons: Reason[];
}

const NOTHING: Judged = { kind: "info", reasons: ["nothing to judge"] };
/** Attention for the reasons found, else a pass (with any reason that is no fault). */
const judged = (faults: Reason[], also: Reason[] = []): Judged =>
  faults.length ? { kind: "attention", reasons: [...faults, ...also] } : { kind: "pass", reasons: also };

interface StageRule {
  criterion: string; // the report's and the tools' statement of the rule (WORDS.criterion)
  goal: string; // the stage's goal (WORDS.goal): in assess_stage's single-stage result and the tuning prompts
  ownCriterion?: string; // the stage's own evaluation's, where it judges less than the report
  judge: (m: StageNumbers) => Judged;
}

// ---------------------------------------------------------------- the stages

const rings: StageRule = {
  criterion: "No powder ring left above, or dented below, three times its plane's noise. A bump is a powder ring only if it rises in nearly every direction over the sphere (at least 0.15 of its median height in 90 % of directions): the crystal's own scattering at that |Q| rises in some directions only.",
  goal: "Remove powder/Al rings: mean_ring_energy_ratio as low as the trials reach on every plane (its floor is set by the diffuse, not 0; near 0.4–0.5 can be ring-free), while over_subtraction_fraction and after_negative_fraction stay small (a few percent from noise), and each raw ring ends level with the diffuse beside it: max_ring_dent (how far the deepest ring sits below its flanks, a share of the diffuse there; the subtraction over-shot, even where no voxel goes negative) and max_ring_left (a ring left over) both 0: they count only residuals beyond 3 × their plane's noise_fraction, so any value above 0 is a real dent or leftover (worst_ring_dent and worst_ring_left say on which plane and at which |Q|). A bump counts only if it is a powder ring, rising in nearly every direction over the sphere (shells_judged); the others are the crystal's own scattering, which the removal must leave and subtracts nothing from (per_plane marks them ring: false, out of its worst_ring_dent and worst_ring_left). Lower ring energy bought by over-subtracting (negatives or ring dents rising) is worse, not better.",
  judge: (m) => {
    const left = num(m.max_ring_left);
    const dent = num(m.max_ring_dent);
    if (left == null || dent == null) return NOTHING;
    // A leftover or dent above 0 is beyond 3 × its plane's noise: real, by the tool's definition.
    return judged([...(left !== 0 ? (["ring left"] as const) : []), ...(dent !== 0 ? (["ring dent"] as const) : [])]);
  },
};

/**
 * D5: the punch's verdict counts the sharp off-lattice peaks on protected
 * planes (punch.ts counts them among the off-lattice leftovers, evaluate.ts
 * among leftover_off_lattice_sharp), while its goal, beside it, says they stay
 * by design. Unify (2.4.5): set this to false. The rule then leaves out
 * leftover_on_protected_planes_sharp, the count the punch's evaluation must
 * then show on its own line (no evaluation holds it yet: today's
 * leftover_on_protected_planes counts the broad ones too).
 */
export const D5_PROTECTED_SHARP_PEAKS_COUNT = true;

const punch: StageRule = {
  criterion: "No Bragg peak missed at a lattice node, and no sharp peak left off the lattice. Broad maxima are diffuse scattering, and stay.",
  goal: "Remove every sharp peak that should go while punching as little as possible (punched_fraction small): every punched voxel is diffuse signal thrown away and later backfilled. Missed lattice peaks (leftover_at_nodes) must reach 0 on every plane; off-lattice sharp peaks (leftover_off_lattice) are satellites or spurious peaks the search punches unless their H planes are protected: leftover_on_protected_planes of them sit on protected planes and stay by design (whether they are real is the user's call), while the rest are peaks the search left, so fewer of those is better where they are spurious. leftover_off_lattice splits into leftover_off_lattice_sharp (punch candidates) and leftover_off_lattice_broad (FWHM ≥ 5 voxels along a slice axis: diffuse maxima such as short-range order, which are the signal, not peaks to punch). Fewer leftovers win only if the punched fraction does not grow substantially; lowering the significance or the search floor punches noise and diffuse maxima, raising them leaves weak peaks.",
  judge: (m) => {
    const atNodes = num(m.leftover_at_nodes);
    if (atNodes == null) return NOTHING;
    const sharp = num(m.leftover_off_lattice_sharp) ?? 0;
    const counted = D5_PROTECTED_SHARP_PEAKS_COUNT ? sharp : sharp - (num(m.leftover_on_protected_planes_sharp) ?? 0);
    return judged([...(atNodes !== 0 ? (["missed at nodes"] as const) : []), ...(counted !== 0 ? (["sharp off-lattice"] as const) : [])]);
  },
};

const backfill: StageRule = {
  criterion: "The fills meet their surroundings: a median seam of 1σ or less, and no cut whose fill is biased one way.",
  goal: "Fill punched holes seamlessly: median_seam_sigma ≲ 1, bright_fill_fraction small (no bright plugs where peaks were), checkerboard_fraction near 0.5 (near 1 is a periodic interpolation artefact).",
  // A stage's evaluation measures no fill bias (texture_check does): its
  // criterion says only what it judges.
  ownCriterion: "The fills meet their surroundings: a median seam of 1σ or less. Whether a cut's fill is biased one way is texture_check's to say.",
  judge: (m) => {
    const seam = num(m.mean_median_seam_sigma);
    if (seam == null) return NOTHING;
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

const flatten: StageRule = {
  criterion: "No pedestal: a floor trend and a span both 0.8 or more over the outer half of the |Q| shells the counts reach. The largest floor in σ is reported, not judged: σ is the cut's own spread, and the floors follow the diffuse level (the 1σ limit dropped at the user's choice, 2026-10-17; provisional).",
  goal: "Bring the per-|Q|-shell floor to about 0 and level across |Q| (floor_after near 0 in all thirds) without over-subtracting (floors well below 0), and leave no pedestal: max_floor_trend (|rank correlation| of the floors with |Q|, over the outer half of the shells the counts reach) well below 1 and max_floor_span_fraction well below 1 (pedestal_left false). after_floor_max_sigma is the floors in the cut's own σ, which the diffuse sets: it reads above 1 on sound flattens and is no goal by itself. A trend near 1 with a span near 1 or more is a background the model missed, however small it reads in σ: a rising one wants flattenQ2 and a fit range reaching the coverage (flattenFitQMax), not a free-form estimator, which also removes isotropic pair correlations.",
  judge: (m) => {
    // A trend near 1 with a span near 1 is a pedestal left. The floor in σ is
    // reported, not judged (FLATTEN_FLOOR_SIGMA_NOTE).
    const pedestal = pedestalLeft(num(m.max_floor_trend), num(m.max_floor_span_fraction));
    if (pedestal == null) return NOTHING;
    return judged(pedestal ? ["pedestal"] : []);
  },
};

/** The back-FFT round trip's limit on r (the ΔPDF's criterion). */
export const BACK_FFT_R_OK = 0.999;

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
 * D6: the ΔPDF's rule compares the window's weight on unmeasured space as its
 * evaluation shows it, at two significant figures (tune/evaluate.ts), and so
 * does the tuning's limit (outOfBounds, which reads this rule), while
 * qmax_coverage compares the raw weight: at 1.04e-3 the coverage is "too far"
 * and the ΔPDF, shown 0.001, passes. Unify (2.4.6): set this to false; the
 * rule then compares the raw weight, which the evaluation keeps beside the
 * shown one (UNROUNDED).
 */
export const D6_PDF_READS_ROUNDED_WEIGHT = true;

/** The ΔPDF window's weight on unmeasured space, as the ΔPDF's rule compares it (D6), or null. */
function windowWeight(m: StageNumbers): number | null {
  const shown = num(m.window_weight_on_unmeasured);
  return D6_PDF_READS_ROUNDED_WEIGHT ? shown : (num(m[UNROUNDED]?.window_weight_on_unmeasured) ?? shown);
}

/**
 * D15: the ΔPDF's rule passes an evaluation that measured nothing (no
 * round trip, no window weight, no symmetry), where every other rule says
 * "nothing to judge". Unify: set this to false; such an evaluation is then
 * not judged.
 */
export const D15_PDF_PASSES_UNMEASURED = true;

const pdf: StageRule = {
  criterion: "The back-FFT reproduces what the transform keeps, the data's even part under Q → −Q, to an r of 0.999 or more (a check recorded without that comparison: r against the data, judged only on data the file declares symmetrised, where the two are the same); at most 1e-3 of the window's weight on unmeasured space; and the declared symmetry kept.",
  goal: "The ΔPDF must show features above noise (feature_snr) with the transform's reach inside the measured coverage: window_weight_on_unmeasured, the share of the window's weight on unmeasured reciprocal space, must stay at or below 1e-3, where the backend's own window keeps it (a trial past it is not a candidate). A window that reaches further raises feature_snr with the backfill's guesses and the box's empty corners, which is worse, not better. max_symmetry_break is the x–y section's largest RMS difference from its image under the cell's in-plane operations (worst_symmetry_op names it): a trial that raises it far above your settings' value broke a symmetry your settings kept, as a separable window does on a hexagonal cell. back_fft_pearson_r_even, the round trip against the data's even part under Q → −Q (what the real transform keeps), must stay near 1; back_fft_pearson_r against the data is lower by the odd part (back_fft_odd_share, counting noise on unsymmetrised data). Without a band or crop the round trip is the identity, so neither can rank trials: back_fft_pearson_r_even below ~0.999 only flags a transform problem. Apodization trades real-space resolution against truncation ripples; prefer the default unless another is clearly better on feature_snr without the reach leaving the coverage.",
  judge: (m) => {
    const back = backFftOk(m);
    const open = windowWeight(m);
    const worst = num(m.max_symmetry_break);
    if (!D15_PDF_PASSES_UNMEASURED && back == null && open == null && worst == null) return NOTHING;
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

/** The second-grain test's criterion (the report's "Second grain" card). */
const GRAIN_CRITERION = "One grain, its UB right: no rotation of the Bragg lattice indexes the off-lattice peaks better than random directions do, and fewer than half of the strongest sit beside Bragg nodes, where a UB that is off puts the crystal's own peaks.";

// ---------------------------------------------------------------- the interface's words

/** The text the checks' results carry: the verdicts' labels, the rules as criteria, and the stages' goals. */
export const WORDS: {
  label: Record<Kind, string>;
  criterion: Record<string, string>;
  goal: Record<TuneStage, string>;
} = {
  label: LABEL,
  criterion: {
    rings: rings.criterion,
    punch: punch.criterion,
    grains: GRAIN_CRITERION,
    backfill: backfill.criterion,
    flatten: flatten.criterion,
    pdf: pdf.criterion,
  },
  goal: { rings: rings.goal, punch: punch.goal, backfill: backfill.goal, flatten: flatten.goal, pdf: pdf.goal },
};

/** A check's outcome from its measurements, by its rule: what its tool writes, and what the readers read. */
export function judge<C extends CheckId>(check: C, m: Measurements[C]): Outcome {
  const rule = STAGE_RULES[check];
  const { kind, reasons } = rule.judge(m ?? {});
  return { check, kind, reasons, dataProblems: [], words: LABEL[kind], criterion: rule.ownCriterion ?? rule.criterion };
}
