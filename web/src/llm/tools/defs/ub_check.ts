// ub_check: whether the volume's UB is right, from the Bragg peaks' offsets from
// their nodes, and an HKL origin shift no UB explains.

import { fetchUbCheck } from "../../../api/client";
import type { UbCheck } from "../../../api/types";
import { usePipelineStore } from "../../../state/pipelineStore";
import { hklVolumeId, stageVolumeId } from "../../context/loadContext";
import { built, evidence, inference, joined } from "../../inference";
import { skillsOn } from "../../skills";
import { judge } from "../../verdicts/rules";
import { num } from "../shared/args";
import { described, description } from "../shared/describe";
import { ToolArgError, type ChatTool } from "../types";

const sig2 = (x: number): number => Number(x.toPrecision(2));

// The peaks sit off their nodes by more than a quarter voxel, and the best UB
// takes away less than a fifth of it: something other than the UB moved them.
const unexplainedOffset = (u: { rms_start: number; rms: number; voxel_q?: number | null }): boolean =>
  u.voxel_q != null && u.voxel_q > 0 && u.rms_start > 0.25 * u.voxel_q && u.rms > 0.8 * u.rms_start;

/**
 * The HKL origin's shift (r.l.u.), or null: the centres' mean offset from their
 * nodes after the fit, when the offsets are unexplained by any UB and that one
 * vector makes 0.8 or more of the RMS the fit leaves. A UB error offsets node h
 * by (T − I)·h, which averages to zero over a centrosymmetric set of nodes and
 * which the fit removes; a shifted origin moves every peak by the same vector,
 * which no UB (a linear map) can remove, so it is the mean after the fit, and
 * |UB·mean| is then most of the RMS. The 0.8 is unexplainedOffset's.
 */
function originShift(u: Pick<UbCheck, "rms_start" | "rms" | "voxel_q" | "ub" | "mean_offset_rlu">): number[] | null {
  const after = u.mean_offset_rlu?.after;
  if (!unexplainedOffset(u) || !after || after.some((x) => x == null || !Number.isFinite(x))) return null;
  const v = after as number[];
  const q = Math.hypot(...[0, 1, 2].map((i) => u.ub[i][0] * v[0] + u.ub[i][1] * v[1] + u.ub[i][2] * v[2]));
  return q >= 0.8 * u.rms ? v : null;
}

const rlu = (v: (number | null)[]): string => `(${v.map((x) => (x == null ? "–" : x.toFixed(4))).join(", ")})`;

// What ub_check's reading infers from an offset no UB explains: the result
// built for each call takes them from here (inference.ts).
const UB_ORIGIN_SHIFTED = inference("tools/index.ts: ub_check's reading", "evidence", ", the HKL origin shifted by about that much, which no UB can make");
const UB_REPORT_ORIGIN = inference("tools/index.ts: ub_check's reading", "remedy", " Report the origin, not the UB.");
const UB_LOOK_ELSEWHERE = inference("tools/index.ts: ub_check's reading", "remedy", " Look at the origin of the HKL grid, or at how |Q| was assigned, not at the UB.");

// How to read radial (a UB error gives the same relative offset at every |Q|
// along a direction) is reduction-qc's step 2, word for word; it and what a
// UB error and an origin shift do to mean_offset_rlu are inference.
export const ub_check: ChatTool = {
  name: "ub_check",
  // Offered for a generic question too: the system prompt's method checks the UB (the user's decision, Q10, 2026-10-19).
  // Reportable, as the other checks on the result are: the report runs it, and names what it finds (Q11).
  facts: { label: "Checked the UB", acts: null, offeredFor: ["punch", "lattice", "general"], settles: ["ub", "origin"], reportable: true },
  ...described(
    description("ub_check")`Is the volume's UB right? Fits the UB to the raw volume's Bragg-peak centres (the punch cell's nodes, low |Q| first). Returns verdict, rms_start → rms, cell_start and cell, orientation_change_deg, radial (offset along Q per |Q| band and direction), mean_offset_rlu, origin_shift_rlu. On a symmetrised volume only the changes that commute with its operations are fitted (fit 'symmetric'): the orientation needs the unsymmetrised file${evidence(". An offset that changes with |Q| is no UB error")}. About 10 s.`,
  ),
  parameters: {
    type: "object",
    properties: { q_max: { type: "number", description: "The nodes' |Q| limit in Å⁻¹ (default: everything the box holds)" } },
  },
  run: async (args, ctx) => {
    const { dataset } = ctx;
    const qMax = args.q_max == null ? null : num(args, "q_max", 0);
    if (qMax != null && !(qMax > 0)) throw new ToolArgError("q_max must be positive");
    const rawId = stageVolumeId(dataset, "raw") ?? hklVolumeId(dataset);
    if (!rawId) throw new Error("this dataset has no raw volume");
    const s = usePipelineStore.getState();
    const cell = [s.punchSupercellH, s.punchSupercellK, s.punchSupercellL].map((v) => Number(v) || 1) as [number, number, number];
    const u = await fetchUbCheck(rawId, cell, qMax);
    const cellText = (c: number[]) => `${c.slice(0, 3).map((x) => x.toFixed(4)).join(", ")} Å; ${c.slice(3).map((x) => x.toFixed(3)).join("°, ")}°`;
    const shift = originShift(u);
    const measured = {
      fit: u.fit,
      bragg_nodes_every: u.cell_nodes,
      symmetry_from: u.operations_from,
      symmetrised: u.symmetrised,
      symmetry_break: u.symmetry_break == null ? null : sig2(u.symmetry_break),
      peaks: { searched: u.n_searched, used: u.n_used, rejected: u.n_rejected },
      rms_start: Number(u.rms_start.toFixed(4)),
      rms: Number(u.rms.toFixed(4)),
      cell_start: cellText(u.cell_start),
      cell: cellText(u.cell),
      orientation_change_deg: Number(u.angle_deg.toFixed(3)),
      axis_uvw: u.axis_uvw.map((x) => Number(x.toFixed(3))),
      transform_diagonal: u.transform.map((row, i) => Number(row[i].toFixed(6))),
      passes: u.passes.map((p) => ({ q_max: Number(p.q_max.toFixed(2)), found: p.n_found, used: p.n_used, rms: `${p.rms_start.toFixed(4)} → ${p.rms.toFixed(4)}` })),
      radial: u.radial.map((o) => ({ q: o.q_hi == null ? `≥ ${o.q_lo}` : `${o.q_lo}–${o.q_hi}`, direction: o.direction, n: o.n, before: sig2(o.before), after: sig2(o.after) })),
      // Offsets well above the centring's own scatter that the fit cannot
      // remove are not a UB error: a shifted HKL origin, or |Q| assigned wrong.
      unexplained: unexplainedOffset(u),
      // The centres' mean offset from their nodes, r.l.u.: what an origin shift is.
      mean_offset_rlu: u.mean_offset_rlu
        ? {
            before: u.mean_offset_rlu.before.map((x) => (x == null ? null : Number(x.toFixed(4)))),
            after: u.mean_offset_rlu.after.map((x) => (x == null ? null : Number(x.toFixed(4)))),
            standard_error: u.mean_offset_rlu.standard_error.map((x) => (x == null ? null : sig2(x))),
          }
        : null,
      origin_shift_rlu: shift ? shift.map((x) => Number(x.toFixed(4))) : null,
      // What was fitted, and what the fit left, as the skills' switch has it (inference.ts).
      reading: joined(
        [
          u.fit === "symmetric"
            ? "The volume is symmetrised: only the UB changes that commute with its operations were fitted; a misorientation needs the unsymmetrised data."
            : u.operations_from
              ? `The rotation and the cell were fitted together, the cell constrained by the operations ${u.operations_from} declares.` +
                (u.symmetry_break == null ? " They do not map this volume's grid, so whether it is symmetrised was not judged." : "")
              : "The rotation and the cell were fitted together; no symmetry was declared, so the cell was left free (triclinic).",
          ...(unexplainedOffset(u)
            ? [
                built`The fit removed little of the peaks' offset (RMS ${u.rms_start.toFixed(4)} → ${u.rms.toFixed(4)} Å⁻¹, against a voxel of ${u.voxel_q!.toFixed(4)} Å⁻¹): no UB change explains it.${
                  shift
                    ? built` Every peak sits a mean ${rlu(shift)} r.l.u. off its node, after the fit as before it: one vector moves them all${UB_ORIGIN_SHIFTED}.${UB_REPORT_ORIGIN}`
                    : UB_LOOK_ELSEWHERE
                }`,
              ]
            : []),
        ],
        " ",
      ).text(skillsOn(ctx)),
    };
    // The verdict is computed from the numbers, by the UB's rule (verdicts/),
    // with the angle and the limit it was judged by.
    const outcome = judge("ub", measured, { skills: skillsOn(ctx) });
    const result = { verdict: outcome.words, ...measured };
    return {
      result,
      summary:
        `${u.fit}: RMS ${u.rms_start.toFixed(4)} → ${u.rms.toFixed(4)} Å⁻¹ over ${u.n_used} peaks; a ${u.cell_start[0].toFixed(3)} → ${u.cell[0].toFixed(3)} Å, c ${u.cell_start[2].toFixed(3)} → ${u.cell[2].toFixed(3)} Å; turned ${u.angle_deg.toFixed(3)}°` +
        (shift ? `; origin shifted ${rlu(shift)} r.l.u.` : ""),
      outcomes: [outcome],
    };
  },
};
