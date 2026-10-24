// symmetry_check: whether the 3D-ΔPDF keeps the symmetry its data were
// declared symmetrised with: every operation of the declared point group,
// those that move c included, on the sections each maps onto sections
// (metrics/symmetry.ts, operationSymmetry).

import { fetchDpdfSlice, fetchMeta } from "../../../api/client";
import { dpdfVolumeId, hklVolumeId, safe, stageVolumeId } from "../../context/loadContext";
import { evidence } from "../../inference";
import {
  inPlaneOperations,
  operationSymmetry,
  pointGroup,
  SYMMETRY_HOLDS,
  transpose,
  type Mat3,
  type Section,
} from "../../metrics/symmetry";
import { roundSig } from "../../metrics/sliceStats";
import { skillsOn } from "../../skills";
import { judge } from "../../verdicts/rules";
import { num } from "../shared/args";
import { dpdfMeta, dpdfView } from "../shared/cuts";
import { described, description } from "../shared/describe";
import type { ChatTool } from "../types";

/** The index of the axis value nearest `value`, the first of two as near (as the backend picks a section). */
const nearest = (axis: readonly number[], value: number): number => {
  let best = 0;
  for (let i = 1; i < axis.length; i++) if (Math.abs(axis[i] - value) < Math.abs(axis[best] - value)) best = i;
  return best;
};

/** A height as a section's label gives it: three figures, no −0. */
const height = (v: number): string => String(roundSig(v, 3) + 0);

/** The grid's step along an axis. */
const stepOf = (axis: readonly number[]): number => (axis.length > 1 ? (axis[axis.length - 1] - axis[0]) / (axis.length - 1) : 1);

/**
 * The operations to test, on the ΔPDF's fractional coordinates, and where they
 * come from: the group the raw file's operations generate, each acting as its
 * transpose; with none declared, the cell's in-plane ones (hexagonal or
 * orthogonal, as before every operation was tested); null when there are none.
 */
function operationsOf(
  declaredOps: number[][][] | null | undefined,
  label: string | null | undefined,
  cell: { a?: number | null; b?: number | null },
  gamma: number,
): { ops: Mat3[]; from: string } | null {
  if (declaredOps?.length) {
    const group = pointGroup(declaredOps);
    if (group) return { ops: group.map(transpose), from: `declared${label ? ` (${label})` : ""}: ${group.length - 1} besides the identity` };
  }
  const { a, b } = cell;
  if (!a || !b) return null;
  const equal = Math.abs(a / b - 1) < 0.01;
  const kind = Math.abs(gamma - 120) < 1 && equal ? "hexagonal" : Math.abs(gamma - 90) < 1 ? "orthogonal" : null;
  if (!kind) return null;
  const why = declaredOps?.length ? "the declared operations generate no point group" : "no operations declared";
  return { ops: inPlaneOperations(kind, equal), from: `the cell's in-plane ones (${kind}): ${why}` };
}

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
    description("symmetry_check")`Check that the 3D-ΔPDF keeps the symmetry its data were declared symmetrised with${evidence(" (with none declared the asymmetry is the data's own and is not judged)")}: the ΔPDF against its image under each operation of the declared point group, an operation and its product with the inversion one entry (equal on the centrosymmetric ΔPDF), those that move c included (none declared: the cell's in-plane ones), on the sections the operation maps onto sections (the x–y sections at z and −z, default z = 0, and the x–z and y–z sections through the origin), else on the voxels it maps from one onto another (tested_on says which; not_tested, any it cannot test), as the RMS of the difference over the RMS, the worst section's. A symmetry the data were symmetrised with holds to about 1e-3 or better when the pipeline kept it${evidence("; a larger share means a stage broke it, or the sample lacks that operation")}. Which operations the sample has is the user's to say.`,
  ),
  parameters: {
    type: "object",
    properties: { z: { type: "number", description: "Height of the x–y section along c, in Å (default 0); the one at −z is read too" } },
  },
  run: async (args, ctx) => {
    const { dataset } = ctx;
    const z = args.z === undefined ? 0 : num(args, "z");
    const meta = await dpdfMeta(dataset);
    const id = dpdfVolumeId(dataset)!;
    // The point group the raw file declares its data were symmetrised with; none read: not known.
    const rawId = stageVolumeId(dataset, "raw") ?? hklVolumeId(dataset);
    const [xy, xz, yz, rawMeta] = await Promise.all([
      fetchDpdfSlice(id, "xy", z),
      fetchDpdfSlice(id, "xz", 0),
      fetchDpdfSlice(id, "yz", 0),
      rawId ? safe(fetchMeta(rawId)) : Promise.resolve(null),
    ]);
    const label = rawMeta?.symmetry ?? null;
    const declaredOps = rawMeta?.symmetry_ops ?? null;
    // Declared operations without a name are a declaration too.
    const declared = rawMeta ? label || (declaredOps?.length ? "the declared operations" : null) : undefined;

    // The x–y section's height on the grid (the one the backend cut), and the
    // section at the opposite height, which an operation sending z to −z maps it onto.
    const zAxis = xz.header.y_axis;
    const iz = nearest(zAxis, z);
    const iOrigin = nearest(zAxis, 0);
    const iMirror = 2 * iOrigin - iz;
    const mirror = iMirror !== iz && iMirror >= 0 && iMirror < zAxis.length ? await fetchDpdfSlice(id, "xy", zAxis[iMirror]) : null;
    // Named short in tested_on: a section through the origin by its plane, the x–y ones off it by their height too.
    const xyLabel = (i: number) => (i === iOrigin ? "xy" : `xy z=${height(zAxis[i])}`);
    const sections: Section[] = [
      { plane: "xy", at: iz - iOrigin, label: xyLabel(iz), slice: xy },
      ...(mirror ? [{ plane: "xy" as const, at: iMirror - iOrigin, label: xyLabel(iMirror), slice: mirror }] : []),
      { plane: "xz", at: 0, label: "xz", slice: xz },
      { plane: "yz", at: 0, label: "yz", slice: yz },
    ];
    const where = [
      `xy at z = ${height(zAxis[iz])}${mirror ? ` and ${height(zAxis[iMirror])}` : ""} Å`,
      "xz at y = 0",
      "yz at x = 0",
    ].join(", ");

    // The grid's steps in the cell's fractional units (in Å where the cell is not known).
    const { a, b, c } = meta.lattice ?? {};
    const lengths = a && b && c ? [a, b, c] : [1, 1, 1];
    const steps = [xy.header.x_axis, xy.header.y_axis, zAxis].map((axis, i) => Math.abs(stepOf(axis)) / lengths[i]) as [number, number, number];

    const tested = operationsOf(declaredOps, label, { a, b }, xy.header.axes_angle ?? 90);
    const sym = tested ? operationSymmetry(sections, tested.ops, steps) : null;
    const ops = sym?.ops.length ? sym.ops : null;
    // With no operation tested there is no evidence: the verdict says why, and judges nothing.
    const why = !tested
      ? "no operations are declared, and the cell is neither hexagonal nor orthogonal"
      : !sym
        ? "the sections are not centred on the origin"
        : `none of the ${sym.not_tested.length} entries could be tested on the sections (not_tested says why)`;
    const outcome = judge("symmetry", { ops, declared, untested: sym?.not_tested.length ?? 0, why }, { skills: skillsOn(ctx) });
    if (!sym || !ops) {
      return {
        result: {
          verdict: outcome.words,
          ...(sym?.not_tested.length ? { not_tested: sym.not_tested } : {}),
        },
        summary: "not judged: nothing to test",
        outcomes: [outcome],
      };
    }
    const holds = ops.filter((o) => o.rms_difference <= SYMMETRY_HOLDS).map((o) => o.op);
    const broken = ops.filter((o) => o.rms_difference > SYMMETRY_HOLDS).map((o) => `${o.op} (${o.rms_difference})`);
    const untested = sym.not_tested.length ? `; ${sym.not_tested.length} not tested` : "";
    return {
      result: {
        sections: where,
        operations: tested!.from,
        ops,
        ...(sym.not_tested.length ? { not_tested: sym.not_tested } : {}),
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
            : `every operation tested holds${untested}`,
      view: dpdfView(meta, "xy", z),
    };
  },
};
