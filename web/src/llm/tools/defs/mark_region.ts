// mark_region: marks a region in the console's slice views for the user to
// look at (THY-44) — a box, an ellipsoid or a few points, on the stage output
// it was found in — resting on the tool calls whose results show it: no mark
// without its evidence (markEvidence.ts). The console draws it on every view
// it crosses and moves there (state/marks.ts); the result says what was drawn,
// on which views and cuts, as far as the volume holds it, so an answer can
// cite only a mark that was made.

import { MAX_POINTS, type MarkRegion, type Vec3 } from "../../../components/regionMark";
import { isReciprocal, MARK_WHERE, MAX_LABEL, WHERE_LABEL, type MarkWhere } from "../../../state/markStore";
import { dpdfVolume, outputProblem, placeMark, planMark, recipVolume, viewsNow, type MarkSpec } from "../../../state/marks";
import { remedy } from "../../inference";
import { roundSig } from "../../metrics/sliceStats";
import { keysOf } from "../facts";
import { dpdfMeta, recipMeta } from "../shared/cuts";
import { described, description } from "../shared/describe";
import { ToolArgError, type Args, type ChatTool } from "../types";

const SHAPES = ["box", "ellipsoid", "points"] as const;

// A stage's output name for the stage itself: what a model may write for `where`.
const WHERE_ALIASES: Record<string, MarkWhere> = {
  ringremoved: "rings",
  braggpunched: "punch",
  backfilled: "backfill",
  flattened: "flatten",
  delta_pdf: "pdf",
  dpdf: "pdf",
};

const isNumberish = (x: unknown): boolean => (typeof x === "number" || (typeof x === "string" && x.trim() !== "")) && Number.isFinite(Number(x));

/** Three coordinates: a list of three numbers (or numbers written as text). */
function vec3(args: Args, key: string, value: unknown = args[key]): Vec3 {
  if (Array.isArray(value) && value.length === 3 && value.every(isNumberish)) return value.map(Number) as Vec3;
  throw new ToolArgError(`${key} must be three numbers; got ${JSON.stringify(value)}`);
}

/** Half-widths: three numbers, or one for all three axes. */
function halfSize(args: Args): Vec3 {
  const v = args.half_size;
  if (isNumberish(v)) return [Number(v), Number(v), Number(v)];
  return vec3(args, "half_size");
}

/** Points: a list of three-number lists, or one flat list of numbers in threes. */
function points(args: Args): Vec3[] {
  const v = args.points;
  if (!Array.isArray(v) || !v.length) throw new ToolArgError(`points must be a list of positions, three numbers each; got ${JSON.stringify(v)}`);
  if (v.every(isNumberish) && v.length % 3 === 0) return Array.from({ length: v.length / 3 }, (_, i) => v.slice(3 * i, 3 * i + 3).map(Number) as Vec3);
  return v.map((p, i) => vec3(args, `points[${i}]`, p));
}

/** The call's arguments, checked: where, the region, the label and the calls it cites. */
async function specOf(args: Args): Promise<MarkSpec> {
  const raw = typeof args.where === "string" ? args.where.trim() : args.where;
  const where = typeof raw === "string" ? (WHERE_ALIASES[raw] ?? raw) : raw;
  if (typeof where !== "string" || !(MARK_WHERE as readonly string[]).includes(where)) {
    throw new ToolArgError(`where must be one of ${MARK_WHERE.join(", ")}; got ${JSON.stringify(args.where)}`);
  }
  const shape = args.shape ?? (args.points !== undefined ? "points" : undefined);
  if (typeof shape !== "string" || !(SHAPES as readonly string[]).includes(shape)) {
    throw new ToolArgError(`shape must be one of ${SHAPES.join(", ")}; got ${JSON.stringify(args.shape)}`);
  }
  const region: MarkRegion =
    shape === "points" ? { shape: "points", points: points(args) } : { shape: shape as "box" | "ellipsoid", center: vec3(args, "center"), half: halfSize(args) };
  if (region.shape === "points" && region.points.length > MAX_POINTS) {
    throw new ToolArgError(`points holds at most ${MAX_POINTS} positions; got ${region.points.length}`);
  }
  const label = typeof args.label === "string" ? args.label.trim() : "";
  if (!label) throw new ToolArgError("label must name what is there, in a few words");
  const { evidenceRefs } = await import("../../markEvidence");
  return { where: where as MarkWhere, region, label, evidence: evidenceRefs(args.evidence) };
}

const r4 = (x: number): number => roundSig(x, 4) + 0;
const v4 = (v: readonly number[]): number[] => v.map(r4);

/** The region as the result gives it, as drawn: cut to the volume, in the space's unit. */
function regionResult(region: MarkRegion, where: MarkWhere) {
  const unit = isReciprocal(where) ? "r.l.u." : "Å";
  return region.shape === "points"
    ? { shape: region.shape, points: region.points.map(v4), unit }
    : { shape: region.shape, center: v4(region.center), half_size: v4(region.half), unit };
}

export const mark_region: ChatTool = {
  name: "mark_region",
  facts: {
    label: "Marked a region",
    acts: "view",
    invalidates: ["view"],
    highlights: (args) => keysOf([WHERE_ALIASES[String(args.where)] ?? args.where]),
  },
  ...described(
    description("mark_region")`Mark a region in the console's slice views and move them to it, so the user sees what you found${remedy(
      ": use it for a finding they should look at, such as satellites at h ± q, a ring left over, or a ΔPDF feature",
    )}. where: the stage whose output shows it: raw, rings, punch, backfill or flatten (reciprocal space; h, k, l in r.l.u.), or pdf (the 3D-ΔPDF; x, y, z in Å along a, b, c). shape: box or ellipsoid, with center and half_size (half-widths along the three axes), or points, with up to ${MAX_POINTS} positions. evidence: the calls in this conversation whose results show it, as tool or tool.field (dpdf_peaks.features.0). A region without evidence, empty, or outside the volume is not marked. The result says which views and cuts it was drawn on, cut to the volume. Cite the mark by its id (M1, …) in your answer.`,
  ),
  parameters: {
    type: "object",
    properties: {
      where: { type: "string", enum: MARK_WHERE },
      shape: { type: "string", enum: SHAPES },
      center: { type: "array", items: { type: "number" }, description: "box or ellipsoid: its centre (three coordinates)" },
      half_size: { type: "array", items: { type: "number" }, description: "box or ellipsoid: its half-widths along the three axes" },
      points: {
        type: "array",
        items: { type: "array", items: { type: "number" } },
        description: `points: up to ${MAX_POINTS} positions, three coordinates each`,
      },
      label: { type: "string", description: `What is there, in a few words (at most ${MAX_LABEL} characters)` },
      evidence: { type: "array", items: { type: "string" }, description: "The calls whose results show it: tool or tool.field" },
    },
    required: ["where", "shape", "label", "evidence"],
  },
  run: async (args, ctx) => {
    const spec = await specOf(args);
    // The evidence first: no mark, and no move of the console, without it.
    const { checkEvidence } = await import("../../markEvidence");
    const cited = checkEvidence(spec.evidence, spec.where, ctx.replySteps ?? [], ctx.earlierSteps ?? []);
    if (!cited.ok) throw new Error(`not marked: ${cited.reason}`);
    const { dataset } = ctx;
    const outputs = dataset.stages.filter((s) => s.exists).map((s) => s.name);
    const missing = outputProblem(spec.where, outputs);
    if (missing) throw new Error(`not marked: ${missing}`);
    const volume = isReciprocal(spec.where) ? recipVolume(await recipMeta(dataset), outputs) : dpdfVolume(await dpdfMeta(dataset), outputs);
    const plan = planMark(spec, volume, viewsNow());
    if (!plan.ok) throw new Error(`not marked: ${plan.reason}`);
    const { mark, added } = placeMark(spec, plan, dataset.id);
    const cleanup = plan.view.page === "cleanup";
    const result = {
      marked: mark.id,
      ...(added ? {} : { already_marked: true }),
      label: mark.label,
      where: mark.where,
      page: cleanup ? "Reciprocal cleanup" : "3D-ΔPDF",
      region: regionResult(mark.region, mark.where),
      ...(plan.clipped.length ? { clipped: plan.clipped } : {}),
      drawn_on: plan.drawn.map((d) => ({
        view: d.view,
        ...(d.stages ? { stages: d.stages } : {}),
        ...(d.points !== undefined ? { points: d.points } : {}),
      })),
      ...(plan.missed.length ? { not_on: plan.missed.map((d) => d.view) } : {}),
      zoomed: plan.zoomed,
      evidence: cited.steps.map((s) => `${s.ref} (${s.step === null ? "an earlier turn" : `step ${s.step}`})`),
    };
    const where = cleanup ? `${plan.drawn[0].view}, outlined on ${WHERE_LABEL[mark.where]}` : plan.drawn.map((d) => d.view.replace(/^ΔPDF /, "")).join("; ");
    return {
      result,
      summary: `${mark.id} · ${mark.label}: ${where}`,
      view: { view: "mark", label: `${mark.id} · ${mark.label}`, mark: mark.id },
    };
  },
};
