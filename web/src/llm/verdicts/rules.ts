// The checks' rules, one table entry each: the rule that judges the check's
// measurements, the words its tool writes from the outcome, the criterion the
// rule is stated as, and a stage's goal. Implementation behind the interface,
// verdicts/index.ts; the readers (readers.ts) read the outcomes it gives.
//
// A rule is pure and total: it never throws, and with nothing to judge its
// outcome is "info" with the reason "nothing to judge" (the named exceptions:
// D15, the ΔPDF's rule, and D16, the UB's). An "attention" outcome always
// carries a reason.

import { OPEN_WEIGHT_OK } from "../metrics/coverage";
import { pedestalLeft } from "../metrics/flatten";
import { r2, SECOND_GRAIN_DEG, type GrainFacts } from "../metrics/grains";
import { roundSig } from "../metrics/sliceStats";
import { SYMMETRY_HOLDS } from "../metrics/symmetry";
import type { TuneStage } from "../tune/catalog";

/** An outcome's kind: met, needs attention, or not judged ("info", as the records and the report's CSS spell it). */
export type Kind = "pass" | "attention" | "info";

export type Stage = TuneStage;
export const STAGES: readonly Stage[] = ["rings", "punch", "backfill", "flatten", "pdf"];

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
  | "second grain"
  | "no second grain"
  | "UB off"
  | "peaks beside nodes"
  | "UB turned"
  | "symmetrised"
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
 */
export interface CoverageMeasurements {
  window_weight: number | null; // the ΔPDF's record, raw
  window: string; // the window, as the verdict names it
  unit_cell: boolean; // |Q| is known
  full_coverage_q: number | null;
  reach: number | null; // how far the transform's window reaches in |Q|
  reach_from: string; // why it reaches that far
  shell: number; // the coverage edge's resolution in |Q|
  band_set: boolean; // a |Q| band is set on the Configure page
  counts: {
    counts_end_inside_box: boolean;
    raw_counts?: { q_max_edge: number | null; box_face_q: number };
    suggested_band?: readonly number[] | null;
  };
}

/** What symmetry_check measured: each in-plane operation's share (null: nothing to test), and the symmetry the file declares. */
export interface SymmetryMeasurements {
  ops: readonly { op: string; rms_difference: number }[] | null;
  declared: string | null | undefined; // null or "": none declared; undefined: the file was not read
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
    if (left == null || dent == null) return nothing();
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
  criterion: "No Bragg peak missed at a lattice node, and no sharp peak left off the lattice. Broad maxima are diffuse scattering, and stay.",
  goal: "Remove every sharp peak that should go while punching as little as possible (punched_fraction small): every punched voxel is diffuse signal thrown away and later backfilled. Missed lattice peaks (leftover_at_nodes) must reach 0 on every plane; off-lattice sharp peaks (leftover_off_lattice) are satellites or spurious peaks the search punches unless their H planes are protected: leftover_on_protected_planes of them sit on protected planes and stay by design (whether they are real is the user's call), while the rest are peaks the search left, so fewer of those is better where they are spurious. leftover_off_lattice splits into leftover_off_lattice_sharp (punch candidates) and leftover_off_lattice_broad (FWHM ≥ 5 voxels along a slice axis: diffuse maxima such as short-range order, which are the signal, not peaks to punch). Fewer leftovers win only if the punched fraction does not grow substantially; lowering the significance or the search floor punches noise and diffuse maxima, raising them leaves weak peaks.",
  judge: (m) => {
    const atNodes = num(m.leftover_at_nodes);
    if (atNodes == null) return nothing();
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

const flatten: StageRule = {
  criterion: "No pedestal: a floor trend and a span both 0.8 or more over the outer half of the |Q| shells the counts reach. The largest floor in σ is reported, not judged: σ is the cut's own spread, and the floors follow the diffuse level (the 1σ limit dropped at the user's choice, 2026-10-17; provisional).",
  goal: "Bring the per-|Q|-shell floor to about 0 and level across |Q| (floor_after near 0 in all thirds) without over-subtracting (floors well below 0), and leave no pedestal: max_floor_trend (|rank correlation| of the floors with |Q|, over the outer half of the shells the counts reach) well below 1 and max_floor_span_fraction well below 1 (pedestal_left false). after_floor_max_sigma is the floors in the cut's own σ, which the diffuse sets: it reads above 1 on sound flattens and is no goal by itself. A trend near 1 with a span near 1 or more is a background the model missed, however small it reads in σ: a rising one wants flattenQ2 and a fit range reaching the coverage (flattenFitQMax), not a free-form estimator, which also removes isotropic pair correlations.",
  judge: (m) => {
    // A trend near 1 with a span near 1 is a pedestal left. The floor in σ is
    // reported, not judged (FLATTEN_FLOOR_SIGMA_NOTE).
    const pedestal = pedestalLeft(num(m.max_floor_trend), num(m.max_floor_span_fraction));
    if (pedestal == null) return nothing();
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
  words: string | null;
  dataProblems?: string[];
}

interface CheckRule<M> {
  criterion?: string; // the report's statement of the rule (WORDS.criterion)
  judge: (m: M) => Words;
}

// A share, in exponent form when it is tiny (1.5e-6, not 0.0000015).
const share = (x: number): string => (x !== 0 && Math.abs(x) < 1e-3 ? x.toExponential(1) : String(roundSig(x, 2)));

const coverage: CheckRule<CoverageMeasurements> = {
  judge: (m) => {
    const w = m.window_weight ?? null;
    const full = m.full_coverage_q ?? null;
    // The ΔPDF on disk records the share of its window's weight on unmeasured
    // space: the direct measure of a reach past the coverage. Without it, the
    // reach from the Configure page's settings against full coverage.
    const [outcome, text]: [Judged, string] =
      w != null
        ? w <= OPEN_WEIGHT_OK
          ? [{ kind: "pass", reasons: ["window within limit"] }, `clean: ${m.window} puts ${share(w)} of its weight on unmeasured reciprocal space`]
          : [
              { kind: "attention", reasons: ["window past limit"] },
              `too far: ${m.window} puts ${share(w)} of its weight on unmeasured reciprocal space; taper it to the coverage (pdfWindowSupport) or set a |Q| band`,
            ]
        : !m.unit_cell
          ? [nothing(), "no unit cell: |Q| is unknown, so the reach cannot be compared"]
          : full == null
            ? [nothing(), "no |Q| shell is fully measured on these planes"]
            : m.reach == null
              ? [nothing(), "no ΔPDF yet to read the box corner from"]
              : m.reach <= full + m.shell
                ? [{ kind: "pass", reasons: ["reach inside coverage"] }, `the transform reaches ${roundSig(m.reach, 4)} Å⁻¹ (${m.reach_from}), inside full coverage at ${full} Å⁻¹`]
                : [
                    { kind: "attention", reasons: ["reach past coverage"] },
                    `too far: the transform reaches ${roundSig(m.reach, 4)} Å⁻¹ (${m.reach_from}), past full coverage at ${full} Å⁻¹; set a |Q| band at or below it, or taper the window to the coverage`,
                  ];
    // The counts end inside the box and no band is set: only the window's taper
    // keeps the transform on the counts. Said in the verdict, which a model
    // quotes, and not only in raw_counts and suggested_band, which it may not.
    const c = m.counts ?? { counts_end_inside_box: false };
    const cut =
      c.counts_end_inside_box && !m.band_set
        ? `; the raw counts end at ${c.raw_counts?.q_max_edge} Å⁻¹, inside the box (its nearest face at ${c.raw_counts?.box_face_q} Å⁻¹), and no |Q| band is set, so only the window's taper keeps the transform on the counts: the band they allow is ${c.suggested_band?.[0]}–${c.suggested_band?.[1]} Å⁻¹ (suggested_band), the user's to set`
        : "";
    return { ...outcome, words: text + cut, dataProblems: countsProblems(c) };
  },
};

/** The data's problem where the raw counts end inside the box, in {{achieved}}'s words (a band set or not). */
export function countsProblems(c: { counts_end_inside_box?: unknown; raw_counts?: unknown }): string[] {
  const edge = (c.raw_counts as { q_max_edge?: unknown } | null | undefined)?.q_max_edge;
  return c.counts_end_inside_box === true && num(edge) != null ? [`the counts end at ${edge} Å⁻¹, inside the box`] : [];
}

/** What the symmetry verdict says of a volume that declares no symmetry. */
const NOT_DECLARED = (asymmetry: unknown): string =>
  `not judged: the file declares no symmetry, so the section's asymmetry (${String(asymmetry)}) is the data's own, counting noise included, not a break by a stage`;

const symmetry: CheckRule<SymmetryMeasurements> = {
  judge: (m) => {
    if (!m.ops) return { ...nothing(), words: null };
    // A file that declares no symmetry was not symmetrised: the section's
    // asymmetry is the data's own, and no stage broke anything.
    if (m.declared === null || m.declared === "") return { kind: "info", reasons: ["not declared"], words: NOT_DECLARED(Math.max(...m.ops.map((o) => o.rms_difference))) };
    const broken = m.ops.filter((o) => o.rms_difference > SYMMETRY_HOLDS).map((o) => `${o.op} (${o.rms_difference})`);
    return broken.length
      ? { kind: "attention", reasons: ["symmetry broken"], words: `not kept: ${broken.join(", ")}; a symmetry the data were symmetrised with should hold to ~${SYMMETRY_HOLDS} or better` }
      : { kind: "pass", reasons: [], words: `kept: every in-plane operation holds to ${SYMMETRY_HOLDS} or better` };
  },
};

const texture: CheckRule<Readonly<Record<string, unknown>>> = {
  // texture_check writes no verdict: each cut says whether its fill is biased.
  judge: (m) => {
    const cuts = (Array.isArray(m.per_cut) ? (m.per_cut as unknown[]) : []).filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
    if (cuts.some((x) => x.systematic_fill_bias === true)) return { kind: "attention", reasons: ["fill bias"], words: null };
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
    // Half or more of the strongest orbits beside Bragg nodes: the crystal's own peaks, displaced by a UB that is off.
    const beside: Reason[] = n > 0 && near >= n / 2 ? ["peaks beside nodes"] : [];
    if (!n) return { kind: "pass", reasons: [], words: "no off-lattice peaks were recorded by the punch's search" };
    const fits = n >= 4 && indexed >= Math.max(n / 2, 3 * control + 3);
    // A rotated copy within a couple of degrees of the main lattice is the main
    // crystal with its UB off, not another grain.
    const second = fits && (turn == null || turn >= SECOND_GRAIN_DEG);
    if (fits && !second) {
      return {
        kind: "attention",
        reasons: ["UB off", ...beside],
        words: `the off-lattice peaks are the crystal's own Bragg peaks with the UB off: one rotation of ${r2(turn!)}° puts ${indexed} of the ${n} strongest orbits back on the Bragg lattice (random directions: ${control}); refine the UB`,
        dataProblems: [ubOffProblem(r2(turn!))],
      };
    }
    if (second) {
      return {
        kind: "attention",
        reasons: ["second grain", ...beside],
        words: `a second grain: one rotation of the Bragg lattice indexes ${indexed} of the ${n} strongest off-lattice orbits (random directions: ${control})${turn != null ? `, misoriented by ${r2(turn)}° from the main grain` : ""}`,
      };
    }
    let words = `no second grain of this phase: a rotated copy of the Bragg lattice indexes only ${indexed} of the ${n} strongest off-lattice orbits (random directions: ${control})`;
    if (near >= n / 2 && median != null) {
      words +=
        `. ${near} of them sit within a quarter of the node spacing of a Bragg node, offset by a median ${r2(median)}° of rotation (a lower bound: a node at an angle to the rotation axis moves less)` +
        (g.symmetrised
          ? ": copies of the crystal's own Bragg peaks, displaced by symmetrising data whose UB is off by about that angle; a UB refined on the unsymmetrised data would put them back on the nodes"
          : ": the Bragg peaks themselves, off their nodes by about that angle (refine the UB)");
    }
    if (g.far?.length) words += `. ${n - near} lie farther from any node; their origin is open (another phase, multiple scattering, or an artefact)`;
    return { kind: beside.length ? "attention" : "pass", reasons: ["no second grain", ...beside], words };
  },
};

/**
 * A UB turned by this much (degrees) or more is reported: the fit's own noise
 * lies below it. The validation's grader keeps its own 0.1° (evals/validation.ts)
 * until the shared answer reader (plan 3.2): a separate rule, docs/evals.md.
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

/**
 * D16: a ub_check result without an angle, on a volume not symmetrised, reads
 * as a right UB, as the answer checks read it (ub_check always writes its
 * angle; recordings may not), where the other rules say "nothing to judge".
 * Unify: set this to false; such a result is then not judged.
 */
export const D16_UB_UNMEASURED_READS_RIGHT = true;

const ub: CheckRule<Readonly<Record<string, unknown>>> = {
  // ub_check writes no verdict: what the fit found, and the data's problems it shows.
  judge: (u) => {
    const dataProblems: string[] = [];
    const turned = UB_TURNED(u);
    if (turned) dataProblems.push(`the UB is turned by ${ubTurn(u)}°`);
    const shift = Array.isArray(u.origin_shift_rlu) ? (u.origin_shift_rlu as unknown[]) : null;
    if (shift) dataProblems.push(`the HKL origin is shifted by (${shift.join(", ")}) r.l.u.`);
    // Not judged, or turned: either holds a claim that the UB is right to account.
    if (UB_NOT_JUDGED(u)) return { kind: "attention", reasons: ["symmetrised"], words: null, dataProblems };
    if (turned) return { kind: "attention", reasons: ["UB turned"], words: null, dataProblems };
    if (!D16_UB_UNMEASURED_READS_RIGHT && ubTurn(u) == null) return { ...nothing(), words: null, dataProblems };
    return { kind: "pass", reasons: [], words: null, dataProblems };
  },
};

const CHECK_RULES: { [C in Exclude<CheckId, Stage>]: CheckRule<Measurements[C]> } = { coverage, symmetry, texture, grain, ub };

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
    grains: grain.criterion!,
    backfill: backfill.criterion,
    flatten: flatten.criterion,
    pdf: pdf.criterion,
  },
  goal: { rings: rings.goal, punch: punch.goal, backfill: backfill.goal, flatten: flatten.goal, pdf: pdf.goal },
};

const isStage = (check: CheckId): check is Stage => check in STAGE_RULES;

/**
 * A check's outcome from its measurements, by its rule: what its tool writes,
 * and what the readers read. A stage whose evaluation says its output is
 * "missing" (assess_stage, before the run computed it) has no output to judge:
 * its tool writes no verdict for it.
 */
export function judge<C extends CheckId>(check: C, m: Measurements[C]): Outcome {
  if (isStage(check)) {
    if (m && typeof m === "object" && "missing" in m) return { check, kind: "info", reasons: ["no output"], dataProblems: [], words: null };
    const rule = STAGE_RULES[check];
    const { kind, reasons } = rule.judge((m ?? {}) as StageNumbers);
    return { check, kind, reasons, dataProblems: [], words: LABEL[kind], criterion: rule.ownCriterion ?? rule.criterion };
  }
  const rule = CHECK_RULES[check as Exclude<CheckId, Stage>] as CheckRule<unknown>;
  const { kind, reasons, words, dataProblems = [] } = rule.judge(m ?? {});
  return { check, kind, reasons, dataProblems, words, ...(rule.criterion ? { criterion: rule.criterion } : {}) };
}
