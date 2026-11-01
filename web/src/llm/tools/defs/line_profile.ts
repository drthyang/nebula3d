// line_profile: the intensity along a line parallel to one axis, through any
// stage's volume.

import { fetchDpdfSlice, fetchSlice } from "../../../api/client";
import type { Slice } from "../../../api/types";
import { dpdfVolumeId, RECIP_STAGES, safe, stageVolumeId } from "../../context/loadContext";
import { reading } from "../../inference";
import { median, roundSig } from "../../metrics/sliceStats";
import { keysOf } from "../facts";
import type { ViewTarget } from "../openView";
import { num, oneOf } from "../shared/args";
import {
  checkInRange,
  cleanupView,
  DPDF_FIXED,
  DPDF_PLANES,
  dpdfMeta,
  dpdfRange,
  dpdfView,
  HKL,
  RECIP_FIXED,
  RECIP_PLANES,
  recipMeta,
  recipRange,
  XYZ,
} from "../shared/cuts";
import { described, description } from "../shared/describe";
import { ToolArgError, type Args, type ChatTool } from "../types";

const LINE_STAGES = [...RECIP_STAGES, "delta_pdf"] as const;
const ALL_AXES = ["H", "K", "L", "x", "y", "z"] as const;

export const line_profile: ChatTool = {
  name: "line_profile",
  facts: {
    label: "Took a line profile",
    acts: null,
    // A line through the ΔPDF measures its correlations.
    settles: (args) => (args.stage === "delta_pdf" ? ["features"] : []),
    highlights: (args) => keysOf([args.stage]),
  },
  ...described(
    description("line_profile")`Intensity along a straight line parallel to one axis through any stage volume${reading(" — e.g. along H through (H, 1/3, 0) to see a satellite row, or across a residual ring")}. Reciprocal stages take H/K/L (r.l.u.); delta_pdf takes x/y/z (Å). Returns sampled points plus the exact maximum, minimum and median.`,
  ),
  parameters: {
    type: "object",
    properties: {
      stage: { type: "string", enum: LINE_STAGES },
      along: { type: "string", enum: ALL_AXES, description: "The axis the line runs along" },
      at: {
        type: "object",
        description: "The other two coordinates on the line (missing: 0), e.g. {\"K\": 0.333, \"L\": 0}",
        properties: Object.fromEntries(ALL_AXES.map((a) => [a, { type: "number" }])),
      },
      n_points: { type: "integer", minimum: 16, maximum: 128, description: "Points to return (block-averaged); default 64" },
    },
    required: ["stage", "along"],
  },
  run: async (args, { dataset }) => {
    const stage = oneOf(args, "stage", LINE_STAGES);
    const real = stage === "delta_pdf";
    const axes: readonly string[] = real ? XYZ : HKL;
    const along = oneOf(args, "along", axes);
    const a = axes.indexOf(along);
    const at = (args.at && typeof args.at === "object" ? args.at : {}) as Args;
    const others = [0, 1, 2].filter((i) => i !== a);
    const coord = (i: number) => num(at, axes[i], 0);
    const [o1, fixed] = others; // the plane is cut along `fixed`; the line sits at o1
    const nPoints = Math.round(Math.min(128, Math.max(16, num(args, "n_points", 64))));

    let slice: Slice | null;
    let plane: string;
    let view: ViewTarget;
    if (real) {
      const meta = await dpdfMeta(dataset);
      plane = DPDF_PLANES.find((p) => DPDF_FIXED[p] === fixed)!;
      checkInRange(axes[fixed], coord(fixed), dpdfRange(meta, fixed));
      slice = await safe(fetchDpdfSlice(dpdfVolumeId(dataset)!, plane, coord(fixed)));
      view = dpdfView(meta, plane, coord(fixed));
    } else {
      const meta = await recipMeta(dataset);
      const id = stageVolumeId(dataset, stage);
      if (!id) throw new ToolArgError(`stage ${stage} has no output for this dataset`);
      plane = RECIP_PLANES.find((p) => RECIP_FIXED[p] === fixed)!;
      checkInRange(axes[fixed], coord(fixed), recipRange(meta, fixed));
      slice = await safe(fetchSlice(id, plane, coord(fixed)));
      view = cleanupView(plane, coord(fixed));
    }
    if (!slice) throw new Error(`could not read the ${stage} slice`);

    // In each plane the lower-indexed in-plane axis is x, the other y.
    const { nx, ny, x_axis, y_axis } = slice.header;
    const alongIsX = a < o1;
    const lineAxis = alongIsX ? x_axis : y_axis;
    const crossAxis = alongIsX ? y_axis : x_axis;
    let cross = 0;
    for (let i = 1; i < crossAxis.length; i++) {
      if (Math.abs(crossAxis[i] - coord(o1)) < Math.abs(crossAxis[cross] - coord(o1))) cross = i;
    }
    const n = alongIsX ? nx : ny;
    const value = (i: number) => slice!.data[alongIsX ? cross * nx + i : i * nx + cross];

    const finite: number[] = [];
    let max = -Infinity, min = Infinity, argMax = 0, argMin = 0;
    for (let i = 0; i < n; i++) {
      const v = value(i);
      if (!Number.isFinite(v)) continue;
      finite.push(v);
      if (v > max) [max, argMax] = [v, i];
      if (v < min) [min, argMin] = [v, i];
    }
    const points: [number, number | null][] = [];
    const block = Math.max(1, Math.ceil(n / nPoints));
    for (let start = 0; start < n; start += block) {
      let sum = 0, cnt = 0, pos = 0;
      for (let i = start; i < Math.min(n, start + block); i++) {
        pos += lineAxis[i];
        const v = value(i);
        if (Number.isFinite(v)) [sum, cnt] = [sum + v, cnt + 1];
      }
      const m = Math.min(n, start + block) - start;
      points.push([roundSig(pos / m, 4), cnt ? roundSig(sum / cnt, 4) : null]);
    }
    const through = Object.fromEntries(
      [o1, fixed].map((i) => [axes[i], roundSig(i === o1 ? crossAxis[cross] : coord(fixed), 4)]),
    );
    const result = {
      stage,
      along,
      through,
      units: real ? "Å" : "r.l.u.",
      points, // [position, block mean]; null = masked
      max: finite.length ? { at: roundSig(lineAxis[argMax], 4), value: roundSig(max, 4) } : null,
      min: finite.length ? { at: roundSig(lineAxis[argMin], 4), value: roundSig(min, 4) } : null,
      median: finite.length ? roundSig(median(finite), 4) : null,
      masked_fraction: roundSig(1 - finite.length / Math.max(1, n), 3),
    };
    const where = Object.entries(through).map(([k, v]) => `${k}=${v}`).join(", ");
    return {
      result,
      summary: `${stage} along ${along} at ${where}: max ${result.max?.value ?? "–"} at ${result.max?.at ?? "–"}`,
      view,
    };
  },
};
