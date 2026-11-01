// A UB turned in the reduction (THY-60), as the console says it: the punch
// fits one rotation ω to its strong peaks' centres and records it with the
// tail sweep (nebula3d.analysis.misorientation, nebula3d.analysis.tail_sweep).
// One plain line, the result first, the details behind "?"; and the voxels the
// sweep added that lie on a view's plane, for the overlays (Configure's
// preview, the Bragg page's slices).

import type { Misorientation, TailSweepRecord } from "../api/types";

export interface UbTurnText {
  line: string; // the one plain line
  detail: string; // behind "?"
  tone: "warn" | "plain";
}

const deg = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? "–" : v.toFixed(d));
const axisText = (uvw: number[] | null | undefined) =>
  uvw ? `[${uvw.map((v) => (Math.abs(v) < 5e-3 ? "0" : Number(v.toFixed(2)).toString())).join(" ")}]` : "?";
const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "–" : `${Math.round(100 * v)}%`);

const REMEDY = "The volume may not be reliably fixable downstream: refine the UB in the data reduction.";

/** What the punch's record says of a turned UB, or null when it holds no diagnosis. */
export function ubTurnText(m: Misorientation | null | undefined, sweep?: TailSweepRecord | null): UbTurnText | null {
  if (!m) return null;
  // Enough decimals for the uncertainty to show (0.501° ± 0.002°).
  const digits = m.sigma_deg != null && m.sigma_deg > 0 ? Math.min(4, Math.max(2, -Math.floor(Math.log10(m.sigma_deg)))) : 2;
  const turn = `${deg(m.angle_deg, digits)}° ± ${deg(m.sigma_deg, digits)}°`;
  const fit =
    m.angle_deg == null
      ? ""
      : `A rotation of ${turn} about ${axisText(m.axis_uvw)} (real space), fitted to the offsets of ${m.n_peaks} strong peaks from their nodes, ` +
        `explains ${pct(m.r2)} of their offsets across Q (p = ${m.p_value ?? "–"}); the largest shift it predicts is ` +
        `${m.max_shift != null ? m.max_shift.toFixed(3) : "–"} Å⁻¹ (${m.max_shift != null && m.voxel_q ? (m.max_shift / m.voxel_q).toFixed(1) : "–"} voxels).`;
  switch (m.status) {
    case "active": {
      const r1 = m.round1?.stretched ? ` Round 1 stretched ${m.round1.stretched} node punches along ω × q.` : "";
      const tv = sweep?.tail_voxels;
      const r2 = sweep?.ran
        ? ` The tail sweep added ${sweep.n_voxels.toLocaleString()} voxels at ${sweep.counts.swept ?? 0} nodes; voxels ≥ ${sweep.z_gate ?? 5}σ beside the holes along ±ω × q̂: ${tv?.before ?? "–"} → ${tv?.after ?? "–"}` +
          ((sweep.counts.extended ?? 0) + (sweep.counts.broad ?? 0) ? `, ${(sweep.counts.extended ?? 0) + (sweep.counts.broad ?? 0)} nodes left alone as diffuse-like.` : ".")
        : sweep
          ? ` The tail sweep is ${sweep.setting}.`
          : "";
      const swept = sweep?.ran && sweep.n_voxels ? `; tails swept at ${sweep.counts.swept ?? 0} nodes` : "";
      return { line: `UB turned ${turn}${swept}. Refine the UB in the reduction.`, detail: `${fit}${r1}${r2} ${REMEDY}`, tone: "warn" };
    }
    case "unresolved":
      return { line: `UB turned ${turn}, under half a voxel: nothing to sweep.`, detail: `${fit} Below half a voxel it moves no voxel into or out of a hole. ${REMEDY}`, tone: "plain" };
    case "not_explained":
      return {
        line: `Peak offsets are not one UB turn (explains ${pct(m.r2)}).`,
        detail: `${fit} A rotation explains under half of the offsets, so its direction is not trusted: the punch stays as it was.`,
        tone: "plain",
      };
    case "not_significant":
      return { line: `No UB turn found (${turn}).`, detail: `${fit} No rotation beyond chance: the punch stays as it was.`, tone: "plain" };
    case "symmetrised":
      return {
        line: "UB turn not readable on symmetrised data.",
        detail: "Symmetrising turns a misorientation into rings around the nodes, not shifts: read it on the unsymmetrised volume (ub_check).",
        tone: "plain",
      };
    default:
      return { line: "Too few strong peaks to check the UB.", detail: `The rotation needs at least ${m.rules?.min_peaks ?? 8} strong peaks with fitted centres; ${m.n_peaks} were found.`, tone: "plain" };
  }
}

/**
 * The tail sweep's voxels on a plane: those whose `fixed` coordinate (0 = H,
 * 1 = K, 2 = L) is within half a `step` of `cut`, as the plane's (x, y) in
 * r.l.u. along axes `xa` and `ya`.
 */
export function sweptOnPlane(
  sweep: TailSweepRecord | null | undefined,
  fixed: 0 | 1 | 2,
  cut: number,
  step: number,
  xa: 0 | 1 | 2,
  ya: 0 | 1 | 2,
): [number, number][] {
  if (!sweep?.voxels_hkl?.length || !(step > 0)) return [];
  const tol = step / 2 + 1e-9;
  const out: [number, number][] = [];
  for (const v of sweep.voxels_hkl) if (Math.abs(v[fixed] - cut) <= tol) out.push([v[xa], v[ya]]);
  return out;
}
