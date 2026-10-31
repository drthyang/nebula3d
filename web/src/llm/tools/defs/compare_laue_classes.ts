// compare_laue_classes: which Laue class — every class the cell's metric allows,
// compared by R_int on the raw volume as the symmetry average (stage 0) reads
// it, on every measured voxel and on the diffuse, with the rule's suggestion
// (nebula3d.analysis.laue_compare, docs/algorithms/laue_compare.md). The class
// stays the user's: update_settings refuses it (tune/catalog.ts,
// SYMMETRY_AVERAGE_SETTINGS), and the model cites this table when it suggests
// one. The run's settings are the page's: its edge trim, punch cell and
// footprint, and the form's custom class beside the presets.

import { compareLaueClasses } from "../../../api/client";
import type { LaueCandidate, LaueComparison, LaueReading, LaueVerdict } from "../../../api/types";
import { labelOf, laueCompareParams } from "../../../state/laueCompare";
import { formToParams, usePipelineStore } from "../../../state/pipelineStore";
import { hklVolumeId, stageVolumeId } from "../../context/loadContext";
import { evidence, remedy } from "../../inference";
import { described, description } from "../shared/describe";
import type { ChatTool } from "../types";

const r3 = (x: number | null | undefined): number | null => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(3)));
const r2 = (x: number | null | undefined): number | null => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(2)));

/** One reading's verdict, in words. */
function verdictWords(v: LaueVerdict | null): string {
  if (!v || !v.judged) return "not judged";
  if (v.rises) return `rose ${r2(v.rise)}× against ${v.against}`;
  return v.supported ? "supported" : "a subgroup rose";
}

/** A class's verdict across both readings, short: the same word once, else each reading's. */
function classVerdict(c: LaueCandidate): string {
  const all = verdictWords(c.verdict.all);
  const diffuse = verdictWords(c.verdict.diffuse);
  return all === diffuse ? all : `${all} (all); ${diffuse} (diffuse)`;
}

const pair = (c: LaueCandidate, f: (r: LaueReading | null) => number | null): [number | null, number | null] => [f(c.all), f(c.diffuse)];

/** The comparison as the model reads it: compact, the numbers that drove the suggestion kept. */
function laueResult(out: LaueComparison) {
  return {
    columns: "r_int and x_noise are [every measured voxel, diffuse]; x_noise is R_int over its noise floor (1.00: agreement to the counting noise)",
    classes: out.candidates.map((c) => ({
      class: c.laue,
      ops: c.order,
      ...(c.maximal_subgroups.length ? { contains: c.maximal_subgroups } : {}),
      r_int: pair(c, (r) => r3(r?.r_int)),
      x_noise: pair(c, (r) => r2(r?.ratio)),
      orbits: c.all?.orbits ?? 0,
      verdict: classVerdict(c),
    })),
    no_symmetry: { r_int: [r3(out.isotropic.all.r_int), r3(out.isotropic.diffuse.r_int)], x_noise: [r2(out.isotropic.all.ratio), r2(out.isotropic.diffuse.ratio)] },
    refused: out.refused.map((r) => `${r.laue}: ${r.reason === "metric" && r.metric_change != null ? `metric changes ${Math.round(100 * r.metric_change)}%` : r.detail}`),
    suggestion: out.suggestion,
    suggested_by: out.suggested_by,
    why: out.reason,
    flag: out.disagreement,
    rule: `A class rises against a subgroup when its x_noise exceeds the subgroup's by more than ${Math.round(100 * out.rule.delta)}% and ${out.rule.z} standard errors; it is supported when it rises against none of its subgroups and all of them are supported. suggestion: the supported class with the most operations in every reading that can tell the classes apart (no_symmetry must rise too).`,
    diffuse_mask: `Bragg nodes of the ${out.bragg.cell.join("×")} cell within ${out.bragg.radius_q.toFixed(2)} Å⁻¹${out.bragg.share == null ? "" : ` (${(100 * out.bragg.share).toFixed(1)}% of the measured voxels)`}`,
    edge_trim: out.edge_trim,
    ...(out.notes.length ? { notes: out.notes } : {}),
    limits: "Twinning, or domains related by an operation the sample lacks, make a lower symmetry look higher: R_int alone cannot tell. Only the presets' settings are compared.",
  };
}

export const compare_laue_classes: ChatTool = {
  name: "compare_laue_classes",
  facts: {
    label: "Compared the Laue classes by R_int",
    runningLabel: "Comparing the Laue classes by R_int",
    acts: null,
    // Offered for a question about symmetry (the Laue class, R_int): a local
    // model's budget leaves no room for it on every question (tokenBudget.test.ts).
    offeredFor: ["symmetry"],
  },
  ...described(
    description("compare_laue_classes")`Which Laue class does the sample have? Compares every Laue class the cell's metric allows (the UB under the symmetry average's 2% check) and whose operations map the grid, by R_int on the raw volume as the symmetry average reads it (the run's edge trim first): Σ|I − ⟨I⟩| / Σ|I| over the orbits measured twice or more, on every measured voxel and on the diffuse (the punch cell's Bragg nodes masked), each also over its noise floor, the R_int counting noise alone gives on the same orbits (x_noise). A class rises against a subgroup when its x_noise exceeds the subgroup's by more than 10% and two standard errors; suggestion is the supported class with the most operations in every reading that can tell the classes apart${evidence(", none when even whole |Q| shells (no_symmetry) stay at the noise")}. flag says when the diffuse supports less than every measured voxel${evidence(": averaging over the higher class would impose the Bragg peaks' symmetry on the diffuse")}. A volume symmetrized already is refused. Seconds on a small volume, a minute or more on a full one.${remedy(" Cite its classes, rule and flag when you suggest a Laue class; the class is the user's to set, and update_settings refuses it.")}`,
  ),
  parameters: { type: "object", properties: {} },
  run: async (_args, ctx, io) => {
    const { dataset } = ctx;
    const rawId = stageVolumeId(dataset, "raw") ?? hklVolumeId(dataset);
    if (!rawId) throw new Error("this dataset has no raw volume");
    const s = usePipelineStore.getState();
    // The form's custom class (generators no preset has) is compared too.
    const extra = labelOf(s.symmetryLaue) === "custom" ? [s.symmetryLaue.trim()] : [];
    const out = await compareLaueClasses(rawId, laueCompareParams(formToParams(s)), extra, (p) =>
      io.progress?.(`${Math.round(100 * (p.fraction ?? 0))}% · ${p.message}`),
    );
    const result = laueResult(out);
    const summary = out.suggestion
      ? `suggests ${out.suggestion}${out.disagreement ? `; flag: the diffuse supports only ${out.suggested_by.diffuse}` : ""}`
      : "no meaningful preference";
    return { result, summary };
  },
};
