// grain_check: whether there is a second grain, and what the punch's sharp
// off-lattice peaks are.

import { fetchBraggProfile } from "../../../api/client";
import { usePipelineStore } from "../../../state/pipelineStore";
import { declaringMeta, safe } from "../../context/loadContext";
import { evidence } from "../../inference";
import { grainCheck, shownGrains } from "../../metrics/grains";
import { skillsOn } from "../../skills";
import { judge } from "../../verdicts/rules";
import { num } from "../shared/args";
import { described, description } from "../shared/describe";
import { ToolArgError, type ChatTool } from "../types";

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
    description("grain_check")`Is there a second grain, and what are the sharp off-lattice peaks the punch's search found? It takes the punch's peak record, groups the off-lattice peaks into symmetry orbits (the declared point group), and tests the strongest two ways. Against the Bragg nodes: an orbit within a quarter of the node spacing of one is that peak displaced, and its offset over |Q| is a rotation angle (${evidence("symmetrising data whose UB is slightly off makes such copies; ")}the angle is a lower bound). As a rotated copy of the Bragg lattice: a second grain is one rotation that indexes most strong orbits, judged against the same search at random directions; a rotation under 2° is the UB, not a grain. Run the punch first. Quote its verdict and numbers.`,
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
    };
  },
};
