// grain_check: whether there is a second grain, and what the punch's sharp
// off-lattice peaks are.

import { fetchBraggProfile } from "../../../api/client";
import { usePipelineStore } from "../../../state/pipelineStore";
import { declaringMeta, safe } from "../../context/loadContext";
import { grainCheck, shownGrains, type GrainFacts } from "../../metrics/grains";
import type { OverlayData } from "../../examine/data";
import { inv3 } from "../../examine/linalg";
import { skillsOn } from "../../skills";
import { judge } from "../../verdicts/rules";
import { num } from "../shared/args";
import { described, description } from "../shared/describe";
import { ToolArgError, type ChatTool } from "../types";

type V3 = [number, number, number];
type M3 = number[][];
const mv = (m: M3, v: readonly number[]): V3 => [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]) as V3;

/**
 * What the Highlights draw of the check (examine/data.ts): every image of the
 * far orbits under the declared operations, and, where the verdict says the
 * rotated copy explains the orbits (a second grain, or the UB off), the map
 * from its nodes n to H K L: UB⁻¹ · R · UB · diag(cell).
 */
function grainOverlay(facts: GrainFacts, reasons: readonly string[], ops: readonly M3[], ub: M3, cell: V3): NonNullable<OverlayData["grains"]> {
  const far: V3[] = [];
  for (const f of facts.far) {
    for (const op of ops) {
      const im = mv(op, f.hkl);
      if (!far.some((x) => Math.hypot(x[0] - im[0], x[1] - im[1], x[2] - im[2]) < 1e-3)) far.push(im);
    }
  }
  const explains = reasons.includes("second grain") || reasons.includes("UB off");
  const inv = inv3(ub);
  const R = facts.rotation;
  const rotated = explains && R && inv
    ? [0, 1, 2].map((i) => [0, 1, 2].map((j) => {
        // (UB⁻¹ · R · UB)[i][j] · cell[j]
        let sum = 0;
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) sum += inv[i][a] * R[a][b] * ub[b][j];
        return sum * cell[j];
      }))
    : null;
  return { far, rotated };
}

export const grain_check: ChatTool = {
  name: "grain_check",
  facts: {
    label: "Checked for a second grain",
    acts: null,
    offeredFor: ["punch", "lattice"],
    // It measures the Bragg peaks' offset from their nodes too: evidence on the UB.
    settles: ["grain", "ub"],
    reportable: true,
  },
  ...described(
    description("grain_check")`Is there a second grain, and what are the punch's sharp off-lattice peaks? Groups them into orbits of the declared point group and tests the strongest. An orbit within a quarter of the node spacing of a Bragg node is that peak displaced, its offset over |Q| a rotation angle (a lower bound). A second grain is one rotation of the Bragg lattice that indexes most orbits, against random directions; under 2° it is the UB, not a grain. Returns verdict and its numbers. Run the punch first.`,
  ),
  parameters: {
    type: "object",
    properties: { top: { type: "number", description: "How many of the strongest orbits to test, 8–120 (default 40)" } },
  },
  run: async (args, ctx) => {
    const { dataset } = ctx;
    const top = Math.round(num(args, "top", 40));
    if (!(top >= 8 && top <= 120)) throw new ToolArgError("top must be within [8, 120]");
    // The punch's volume declares the symmetry its peaks were found under, else the raw file does.
    const [profile, meta] = await Promise.all([safe(fetchBraggProfile(dataset.id)), declaringMeta(dataset, "braggpunched")]);
    if (!profile?.has_profile) throw new Error("no punch record yet: run the punch first");
    if (!meta?.ub_matrix) throw new Error("the raw volume carries no UB matrix");
    const peaks = profile.peaks
      .filter((p) => p.source_node_hkl == null && p.intensity != null)
      .map((p) => ({ hkl: p.center_hkl, intensity: (p.intensity as number) - (p.local_background ?? 0) }));
    const identity = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const ops = (meta.symmetry_ops?.length ? meta.symmetry_ops : [identity]) as Parameters<typeof grainCheck>[0]["ops"];
    const s = usePipelineStore.getState();
    const cell = [s.punchSupercellH, s.punchSupercellK, s.punchSupercellL].map((v) => Number(v) || 1) as [number, number, number];
    const facts = grainCheck({ peaks, ub: meta.ub_matrix as Parameters<typeof grainCheck>[0]["ub"], ops, cell, top });
    // The grain's rule (verdicts/) judges the unrounded facts and writes the verdict.
    const outcome = judge("grain", facts, { skills: skillsOn(ctx) });
    const g = shownGrains(facts, outcome.words!);
    return {
      result: { ...g, off_lattice_peaks: peaks.length, declared_symmetry: meta.symmetry ?? null, punch_cell: cell },
      summary: g.verdict.length > 160 ? `${g.verdict.slice(0, 157)}…` : g.verdict,
      outcomes: [outcome],
      overlay: { grains: grainOverlay(facts, outcome.reasons, ops, meta.ub_matrix as M3, cell) },
    };
  },
};
