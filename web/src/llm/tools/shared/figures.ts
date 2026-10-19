// Significant figures: how the tools round the numbers they return. A null
// stays null, so a missing number reads as missing.

import { roundSig } from "../../metrics/sliceStats";

export const r4 = (v: number | null | undefined): number | null => (v == null ? null : roundSig(v, 4));
// Six figures, so that a check at 0.999 reads apart from 1.
export const r6 = (v: number | null | undefined): number | null => (v == null ? null : roundSig(v, 6));
export const range4 = (r: [number, number]): [number, number] => [roundSig(r[0], 4), roundSig(r[1], 4)];
