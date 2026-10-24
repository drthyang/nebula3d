// symmetry_check: whether the 3D-ΔPDF keeps the in-plane symmetry of the cell
// its data were declared symmetrised with.

import { fetchDpdfSlice, fetchMeta } from "../../../api/client";
import { dpdfVolumeId, hklVolumeId, safe, stageVolumeId } from "../../context/loadContext";
import { evidence } from "../../inference";
import { sectionSymmetry, SYMMETRY_HOLDS } from "../../metrics/symmetry";
import { skillsOn } from "../../skills";
import { judge } from "../../verdicts/rules";
import { num } from "../shared/args";
import { dpdfMeta, dpdfView } from "../shared/cuts";
import { described, description } from "../shared/describe";
import type { ChatTool } from "../types";

export const symmetry_check: ChatTool = {
  name: "symmetry_check",
  facts: {
    label: "Checked the ΔPDF's symmetry",
    acts: null,
    offeredFor: ["pdf", "symmetry", "general"],
    settles: ["symmetry"],
    reportable: true,
  },
  ...described(
    description("symmetry_check")`Check that the 3D-ΔPDF keeps the in-plane symmetry of the cell, when the file declares that its data were symmetrised${evidence(" (with none declared the asymmetry is the data's own and is not judged)")}: an x–y section (default z = 0) compared with its image under each in-plane operation (hexagonal: six-, three-, two-fold and the a ↔ b mirror; orthogonal: the mirrors ⊥ a and ⊥ b, the two-fold, and the four-fold when a = b), as the RMS of the difference over the section's RMS. A symmetry the data were symmetrised with holds to about 1e-3 or better when the pipeline kept it${evidence("; a larger share means a stage broke it, or the sample lacks that operation")}. Which operations the sample has is the user's to say.`,
  ),
  parameters: {
    type: "object",
    properties: { z: { type: "number", description: "Height of the x–y section along c, in Å (default 0)" } },
  },
  run: async (args, ctx) => {
    const { dataset } = ctx;
    const z = args.z === undefined ? 0 : num(args, "z");
    const meta = await dpdfMeta(dataset);
    const slice = await fetchDpdfSlice(dpdfVolumeId(dataset)!, "xy", z);
    // The point group the raw file declares its data were symmetrised with; none read: not known.
    const rawId = stageVolumeId(dataset, "raw") ?? hklVolumeId(dataset);
    const rawMeta = rawId ? await safe(fetchMeta(rawId)) : null;
    const declared = rawMeta ? rawMeta.symmetry ?? null : undefined;
    const { a, b } = meta.lattice ?? {};
    const sym = a && b ? sectionSymmetry(slice, { a, b }) : null;
    const outcome = judge("symmetry", { ops: sym?.ops ?? null, declared }, { skills: skillsOn(ctx) });
    if (!sym) {
      return {
        result: { note: "no in-plane symmetry to test: the cell is neither hexagonal nor orthogonal, or the section is not centred on the origin" },
        summary: "nothing to test",
        outcomes: [outcome],
      };
    }
    const holds = sym.ops.filter((o) => o.rms_difference <= SYMMETRY_HOLDS).map((o) => o.op);
    const broken = sym.ops.filter((o) => o.rms_difference > SYMMETRY_HOLDS).map((o) => `${o.op} (${o.rms_difference})`);
    return {
      result: {
        section: `ΔPDF x–y section at z = ${z} Å`,
        cell: sym.kind,
        ops: sym.ops,
        holds,
        symmetry_declared: declared === undefined ? null : Boolean(declared),
        // Judged by the symmetry's rule (verdicts/): not judged where the file declares none.
        verdict: outcome.words,
      },
      outcomes: [outcome],
      summary:
        declared === null || declared === ""
          ? "no symmetry declared: not judged"
          : broken.length
            ? `not kept: ${broken.join(", ")}`
            : "every in-plane operation holds",
      view: dpdfView(meta, "xy", z),
    };
  },
};
