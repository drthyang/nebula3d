// What the cut tools' fields mean (THY-63 R3): the system prompt's glossary
// for a model without tools (prompts/system.ts, SYSTEM), tersely, for a model
// with tools, whose context holds no cut. measure_reciprocal_cut and
// measure_dpdf_cut return it as `fields` in a reply's first result
// (fieldsSent, cuts.ts); with the skills off, its definitions only (call.ts).
// Where a sentence states what the flatten's verdict judges, its words are
// the verdict module's.

import { evidence, written } from "../../inference";
import { PEDESTAL_LIMIT } from "../../metrics/flatten";
import { FLATTEN_FLOOR_SIGMA_NOTE, PEDESTAL_SHELLS, PEDESTAL_WHERE } from "../../verdicts/rules";

/** What each field of measure_reciprocal_cut's result means. */
export const RECIP_FIELDS = written("tools/shared/fields.ts: measure_reciprocal_cut's fields")`ring_removal: ring_energy_ratio, after/before share of the radial profile in ring bumps (diffuse keeps it above 0: 0.4–0.5 can be ring-free); over_subtraction_fraction, after_negative_fraction: voxels driven negative (a few percent is noise); ring_residuals per raw ring: residual_fraction against the diffuse beside it (negative a dent, positive a ring left), significant beyond 3 × noise_fraction. bragg_punch_leftover: sharp peaks the punch missed on this cut, not what its search found: n_at_nodes, missed Bragg peaks; n_off_nodes, off the lattice (on_protected_plane: kept by design); n_broad_off_nodes, FWHM ≥ 5 voxels${evidence(": diffuse maxima, signal")}. backfill: median_seam_sigma, |fill − rim| in σ (≲ 1 seamless); checkerboard_fraction, 0.5 random${evidence(", near 1 an artefact")}. flatten: floor_before, floor_after: shell floors by third of |Q|; after_negative_fraction ≈ 0.25 by construction; floor_trend, floor_span_fraction over ${PEDESTAL_SHELLS} (floor_judged_q): both ${PEDESTAL_LIMIT} or more is a pedestal (the verdict reads ${PEDESTAL_WHERE} floors); after_floor_max_sigma is ${FLATTEN_FLOOR_SIGMA_NOTE}.`;

/** What each field of measure_dpdf_cut's result means. */
export const DPDF_FIELDS = written("tools/shared/fields.ts: measure_dpdf_cut's fields")`All in this section's robust σ outside the origin's disk. feature_snr: the strongest feature over background σ${evidence(" (≳ 5 is clear signal)")}; strong_feature_fraction: voxels beyond 5σ; positive_fraction: 0.5 is balanced ±; anisotropy_ratio: 1 isotropic, above ~1.5 rods or sheets, along anisotropy_angle_deg in the plane; radial_trend: mean |ΔPDF| in the inner, middle and outer shells.`;
