// A UB turned in the reduction, as the punch's record keeps it (THY-60): the
// rotation ω the punch fitted to its strong peaks' centres
// (nebula3d.analysis.misorientation) and its tail sweep
// (nebula3d.analysis.tail_sweep), put to the model by the punch's assessment
// (tune/evaluate.ts) as numbers only, and only when the turn is significant:
// nothing is added on a volume without one. How to read them, and what to
// recommend (the UB refined in the reduction), is bragg-node-audit's, read on
// demand.

import type { Misorientation, TailSweepRecord } from "../../api/types";
import { roundSig } from "./sliceStats";

export interface UbTurnFacts {
  status: string; // "active" (acted on), "unresolved" (under half a voxel) or "not_explained"
  deg: number | null; // |ω|
  sd: number | null; // its standard error
  r2: number | null; // share of the peaks' transverse offsets ω explains
  peaks: number; // the strong peaks it was fitted to
  shift_voxels: number | null; // the largest shift it predicts, in voxels
  stretched?: number; // round 1's punches stretched along ω × q
  // Round 2: the voxels it added and at how many nodes, the nodes left alone
  // as diffuse-like, and the voxels ≥ the gate beside the holes along ±ω × q̂
  // and the bright fills at the swept nodes, before → after.
  sweep: { voxels: number; nodes: number; left_alone: number; tail: [number | null, number | null]; bright_fill: [number | null, number | null] } | string;
}

const n = (v: number | null | undefined, figures = 3): number | null => (v == null || !Number.isFinite(v) ? null : roundSig(v, figures));

/** The punch record's turn and sweep for the model, or null when the turn is not significant (or not recorded). */
export function ubTurnFacts(m: Misorientation | null | undefined, sweep: TailSweepRecord | null | undefined): UbTurnFacts | null {
  if (!m?.significant) return null;
  const s = sweep;
  return {
    status: m.status,
    deg: n(m.angle_deg),
    sd: n(m.sigma_deg, 2),
    r2: n(m.r2, 2),
    peaks: m.n_peaks,
    shift_voxels: m.max_shift != null && m.voxel_q ? n(m.max_shift / m.voxel_q, 2) : null,
    ...(m.round1?.stretched ? { stretched: m.round1.stretched } : {}),
    sweep: !s
      ? "not recorded"
      : !s.ran
        ? `${s.setting}: not run (${(s.reason ?? "").replace(/_/g, " ")})`
        : {
            voxels: s.n_voxels,
            nodes: s.counts.swept ?? 0,
            left_alone: (s.counts.extended ?? 0) + (s.counts.broad ?? 0),
            tail: [s.tail_voxels.before ?? null, s.tail_voxels.after ?? null],
            bright_fill: [n(s.bright_fill.before, 2), n(s.bright_fill.after, 2)],
          },
  };
}
