// A UB turned in the reduction, as the punch's record keeps it (THY-60): the
// rotation ω the punch fitted to its strong peaks' centres
// (nebula3d.analysis.misorientation) and its tail sweep
// (nebula3d.analysis.tail_sweep), put to the model by the punch's assessment
// (tune/evaluate.ts), and only when the turn is significant: nothing is added
// on a volume without one. In R1's form (docs/pilot-context-design.md §5.5):
// a computed verdict that carries its rule, read off the record (its `rules`,
// the Python's limits), and for one turn the remedy; then the numbers, before
// → after as one string. How to read them is bragg-node-audit's, read on
// demand. Read by the answer (the turn and its error, the sweep's numbers)
// and by the headline (a turn acted on).

import type { Misorientation, TailSweepRecord } from "../../api/types";
import { roundSig } from "./sliceStats";

export interface UbTurnFacts {
  verdict: string; // the outcome, the deciding numbers and the rule
  deg: number | null; // |ω|
  sd: number | null; // its standard error
  r2: number | null; // share of the peaks' transverse offsets ω explains
  peaks: number; // the strong peaks it was fitted to
  shift_voxels: number | null; // the largest shift it predicts, in voxels
  stretched?: number; // round 1's punches stretched along ω × q (the option)
  // Round 2: the voxels it added and at how many nodes, the nodes left alone
  // as diffuse-like, and before → after the voxels at the gate beside the
  // holes along ±ω × q̂ and the bright fills at the swept nodes; or why it
  // did not run.
  sweep: { voxels: number; nodes: number; left_alone: number; tail: string; bright_fill: string } | string;
}

const n = (v: number | null | undefined, figures = 3): number | null => (v == null || !Number.isFinite(v) ? null : roundSig(v, figures));
const arrow = (a: number | null | undefined, b: number | null | undefined, figures = 2) => `${n(a, figures) ?? "–"} → ${n(b, figures) ?? "–"}`;

// The outcome by status, for a significant turn.
const OUTCOME: Record<string, string> = {
  active: "acted on",
  unresolved: "not acted on, under the shift",
  not_explained: "not acted on, not one turn",
};
// The remedy, where the turn is one turn (the user's decision: upstream, never
// a regrid here); none for offsets that are not one turn.
const REMEDY = "; refine the UB in the reduction, never regrid";

/** The punch record's turn and sweep for the model, or null when the turn is not significant (or not recorded). */
export function ubTurnFacts(m: Misorientation | null | undefined, sweep: TailSweepRecord | null | undefined): UbTurnFacts | null {
  if (!m?.significant) return null;
  const r = m.rules ?? {};
  const rule = `acts at p < ${r.p_significant ?? "?"}, R² ≥ ${r.r2_explains ?? "?"}, shift ≥ ${r.resolved_voxels ?? "?"} voxel`;
  const s = sweep;
  return {
    verdict: `${OUTCOME[m.status] ?? m.status}: ${n(m.angle_deg)}° ± ${n(m.sigma_deg, 2)}°, R² ${n(m.r2, 2)}, p ${m.p_value ?? "?"} (${rule})${m.explains ? REMEDY : ""}`,
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
            tail: `${s.tail_voxels.before ?? "–"} → ${s.tail_voxels.after ?? "–"}`,
            bright_fill: arrow(s.bright_fill.before, s.bright_fill.after),
          },
  };
}
