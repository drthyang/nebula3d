// Significant figures: how the tools round the numbers they return. A null
// stays null, so a missing number reads as missing.

import { roundSig } from "../../metrics/sliceStats";

export const r4 = (v: number | null | undefined): number | null => (v == null ? null : roundSig(v, 4));
// Six figures, so that a check at 0.999 reads apart from 1.
export const r6 = (v: number | null | undefined): number | null => (v == null ? null : roundSig(v, 6));
/**
 * Below this, a share or a normalised figure (a quantity on the scale of 1:
 * the back-FFT's normalised RMS, the data's odd share) is float roundoff, not
 * a measurement: a sound round trip leaves 1e-15, a symmetrised volume's odd
 * part 1e-30. Shown as 0, never as 7.94e-15.
 */
export const ROUNDOFF = 1e-6;
/** A share or normalised figure with float roundoff read as 0 (ROUNDOFF); null stays null. */
export const unitFigure = (v: number | null | undefined, figures = 4): number | null =>
  v == null ? null : Math.abs(v) < ROUNDOFF ? 0 : roundSig(v, figures);
export const range4 = (r: [number, number]): [number, number] => [roundSig(r[0], 4), roundSig(r[1], 4)];
