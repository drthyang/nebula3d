// Placing a mark (state/markStore.ts) and showing it: planMark works out,
// from the volume's grid and the views as they are, what a region looks like
// in the console — the plane and cut that cross it, the views it is drawn
// on, the zoom that shows it — or why it cannot be drawn (no such output, an
// empty region, one outside the volume). placeMark adds the mark and shows
// it; showMark moves the console to a mark again (the Pilot panel's list,
// the transcript's Show).
//
// - The cleanup page shows every reciprocal stage on one plane, so a mark on
//   a stage is drawn on that plane in every stage's view, outlined on its
//   own stage. The plane is cut across the region's thinnest axis (in Å⁻¹),
//   so it shows the region's widest section; points go on the plane that
//   holds the most of them. The current plane wins a tie: the console moves
//   as little as it can.
// - The 3D-ΔPDF page shows three orthogonal sections, each with its own cut:
//   each is cut through the region's centre, or on the plane holding the most
//   points, and the region is drawn on each section it crosses.
//
// A view zooms only where that helps (components/regionMark.ts frameTarget):
// a region too small to see, or out of view.

import type { DeltaPdfMeta, VolumeMeta } from "../api/types";
import { clipRegion, cutIndexFor, frameIn, gridStep, gridValue, sectionBounds, sectionOf, type Axis, type Frame, type MarkRegion, type PlaneAxes, type Vec3, type VolumeGrid } from "../components/regionMark";
import { clampHalf, extentBounds, fitViewport, type SliceGeom, type Viewport } from "../components/viewport";
import { defaultDpdfView, useDpdfStore } from "./dpdfStore";
import { CLEANUP_WHERE, DPDF_MARK_PLANES, isReciprocal, shortLabel, useMarkStore, WHERE_OUTPUT, type DpdfMarkPlane, type Mark, type MarkView, type MarkWhere } from "./markStore";
import { useNavStore } from "./navStore";
import { AXIS_TO_PLANE, useViewerStore, type FixedAxis } from "./viewerStore";

/** A mark as asked for: where, the region (in the volume's coordinates), a label, and the steps it rests on. */
export interface MarkSpec {
  where: MarkWhere;
  region: MarkRegion;
  label: string;
  evidence: string[];
}

/** The cell's lengths (Å) and angles (°; absent: 90). */
export interface Cell {
  a: number;
  b: number;
  c: number;
  alpha?: number | null;
  beta?: number | null;
  gamma?: number | null;
}

/** What a mark is placed on: the volume's grid (reciprocal or ΔPDF, as `where` says), the cell, and the dataset's outputs that exist. */
export interface MarkVolume {
  grid: VolumeGrid;
  cell: Cell;
  outputs: readonly string[];
}

/** The views as they stand: the cleanup page's cut axis, and the zoom of each reciprocal plane and ΔPDF section. */
export interface ViewsNow {
  fixedAxis: FixedAxis;
  views: Readonly<Record<string, Viewport>>;
  dpdfViews: Readonly<Record<string, Viewport>>;
}

/** The views as the stores hold them now. */
export const viewsNow = (): ViewsNow => ({
  fixedAxis: useViewerStore.getState().fixedAxis,
  views: useViewerStore.getState().views,
  dpdfViews: useDpdfStore.getState().views,
});

// A missing lattice length reads as 1, as the pages read it.
const cellOf = (lat: VolumeMeta["lattice"]): Cell => ({ a: lat.a ?? 1, b: lat.b ?? 1, c: lat.c ?? 1, alpha: lat.alpha, beta: lat.beta, gamma: lat.gamma });

/** A reciprocal volume's grid and cell, from its metadata (the cleanup page's), with the dataset's outputs. */
export const recipVolume = (meta: VolumeMeta, outputs: readonly string[]): MarkVolume => ({
  grid: { ranges: [meta.h_range, meta.k_range, meta.l_range], shape: meta.shape, names: ["H", "K", "L"], unit: "r.l.u." },
  cell: cellOf(meta.lattice),
  outputs,
});

/** The 3D-ΔPDF's grid and cell, from its metadata, with the dataset's outputs. */
export const dpdfVolume = (meta: DeltaPdfMeta, outputs: readonly string[]): MarkVolume => ({
  grid: { ranges: [meta.x_range, meta.y_range, meta.z_range], shape: meta.shape, names: ["x", "y", "z"], unit: "Å" },
  cell: cellOf(meta.lattice),
  outputs,
});

/** One view a mark is drawn on (or misses), as the result tells it. */
export interface DrawnView {
  view: string; // "H–K plane at L = 0.5" | "ΔPDF x–y section at z = 0 Å"
  plane: string; // "hk0" | "xy"
  cut: number; // where it is cut, on the grid (r.l.u. or Å)
  stages?: MarkWhere[]; // the cleanup page: the stage views it is drawn on
  points?: number; // a points mark: how many lie on this view
}

export type MarkPlan =
  | { ok: true; region: MarkRegion; clipped: string[]; view: MarkView; drawn: DrawnView[]; missed: DrawnView[]; zoomed: boolean }
  | { ok: false; reason: string };

const HKL_AXES: FixedAxis[] = ["H", "K", "L"];
// The cleanup page's in-plane axes for each cut axis (ReciprocalViewer's PLANE_AXES).
const IN_PLANE: Record<FixedAxis, [Axis, Axis]> = { H: [1, 2], K: [0, 2], L: [0, 1] };
// The ΔPDF sections: in-plane axes, cut axis, and the cell angle between the in-plane axes.
const DPDF_PLANES: Record<DpdfMarkPlane, PlaneAxes & { angle: "alpha" | "beta" | "gamma" }> = {
  xy: { u: 0, v: 1, cut: 2, angle: "gamma" },
  xz: { u: 0, v: 2, cut: 1, angle: "beta" },
  yz: { u: 1, v: 2, cut: 0, angle: "alpha" },
};
// Tie order for the cut axis after the current one: the H–K plane is the one the context reads first.
const TIE_ORDER: FixedAxis[] = ["L", "K", "H"];

const sig = (x: number): string => String(Number(x.toPrecision(4)) + 0);
const AXIS_IDX: Record<FixedAxis, Axis> = { H: 0, K: 1, L: 2 };

/** A plane's words, as the tools' (tools/shared/cuts.ts planeLabel). */
export function markPlaneLabel(plane: string, value: number): string {
  if (plane in DPDF_PLANES) {
    const p = DPDF_PLANES[plane as DpdfMarkPlane];
    const n = ["x", "y", "z"];
    return `ΔPDF ${n[p.u]}–${n[p.v]} section at ${n[p.cut]} = ${sig(value)} Å`;
  }
  const axis = HKL_AXES.find((a) => AXIS_TO_PLANE[a] === plane) ?? "L";
  const [u, v] = IN_PLANE[axis];
  return `${HKL_AXES[u]}–${HKL_AXES[v]} plane at ${axis} = ${sig(value)}`;
}

/** The axis the cleanup page cuts a region along (see the module's note). */
function cleanupAxis(region: MarkRegion, grid: VolumeGrid, cell: Cell, current: FixedAxis): FixedAxis {
  const lat = [cell.a, cell.b, cell.c];
  const score = (a: FixedAxis): number => {
    const i = AXIS_IDX[a];
    // Points: more on the plane is better; a region: thinner along the cut axis is better.
    return region.shape === "points" ? -cutIndexFor(region, grid, i).count : (region.half[i] * 2 * Math.PI) / lat[i];
  };
  const best = Math.min(...HKL_AXES.map(score));
  const tied = (a: FixedAxis) => score(a) <= best + Math.abs(best) * 0.05 + 1e-12;
  return [current, ...TIE_ORDER].find(tied) ?? current;
}

const zoomedIn = (next: Viewport | null, now: Viewport): boolean => next !== null && next.half < now.half * 0.999;

/**
 * The plan for a mark on `volume` with the views as they are (`now`): the
 * region as the volume holds it, the views it is drawn on and where the
 * console moves to show it; or why it cannot be drawn.
 */
export function planMark(spec: MarkSpec, volume: MarkVolume, now: ViewsNow): MarkPlan {
  const output = WHERE_OUTPUT[spec.where];
  if (!volume.outputs.includes(output)) {
    return {
      ok: false,
      reason: isReciprocal(spec.where)
        ? `the ${spec.where} stage has no output for this dataset yet (the cleanup page shows ${CLEANUP_WHERE.filter((w) => volume.outputs.includes(WHERE_OUTPUT[w])).join(", ") || "none"}); run the pipeline first`
        : "this dataset has no 3D-ΔPDF yet; run the pipeline through the ΔPDF stage first",
    };
  }
  const clip = clipRegion(spec.region, volume.grid);
  if (!clip.ok) return clip;
  const { region } = clip;
  const { grid, cell } = volume;
  const step = (a: Axis) => gridStep(grid, a);

  if (isReciprocal(spec.where)) {
    const axis = cleanupAxis(region, grid, cell, now.fixedAxis);
    const cutAxis = AXIS_IDX[axis];
    const [u, v] = IN_PLANE[axis];
    const plane = AXIS_TO_PLANE[axis];
    const value = gridValue(grid, cutAxis, cutIndexFor(region, grid, cutAxis).index);
    const section = sectionOf(region, { u, v, cut: cutAxis }, value, step(cutAxis) / 2);
    if (!section) return { ok: false, reason: `the region meets no ${plane} plane of the grid` };
    const lat = [cell.a, cell.b, cell.c];
    // The cleanup page's geometry and zoom limits (ReciprocalViewer).
    const geom: SliceGeom = { sx: (2 * Math.PI) / lat[u], sy: (2 * Math.PI) / lat[v], angle: 90 };
    const axes = { x_axis: grid.ranges[u], y_axis: grid.ranges[v] };
    const fit = fitViewport(axes, geom);
    const voxel = Math.min(step(u) * geom.sx, step(v) * geom.sy);
    const frame: Frame = {
      target: sectionBounds(section, geom),
      fit,
      data: extentBounds(axes, geom),
      minHalf: clampHalf(0, fit.half, voxel),
      maxHalf: clampHalf(Infinity, fit.half, voxel),
    };
    const current = now.views[plane] ?? fit;
    const stages = CLEANUP_WHERE.filter((w) => volume.outputs.includes(WHERE_OUTPUT[w]));
    return {
      ok: true,
      region,
      clipped: clip.clipped,
      view: { page: "cleanup", axis, value, frame },
      drawn: [{ view: markPlaneLabel(plane, value), plane, cut: value, stages, ...(section.kind === "points" ? { points: section.pts.length } : {}) }],
      missed: [],
      zoomed: zoomedIn(frameIn(frame, current), current),
    };
  }

  // The 3D-ΔPDF page: each section cut through the region.
  const index = ([0, 1, 2] as Axis[]).map((a) => cutIndexFor(region, grid, a).index) as Vec3;
  const fit = defaultDpdfView();
  const fullHalf = Math.max(...grid.ranges.map((r) => Math.max(Math.abs(r[0]), Math.abs(r[1]))));
  const frames: Partial<Record<DpdfMarkPlane, Frame>> = {};
  const drawn: DrawnView[] = [];
  const missed: DrawnView[] = [];
  let zoomed = false;
  for (const plane of DPDF_MARK_PLANES) {
    const p = DPDF_PLANES[plane];
    const value = gridValue(grid, p.cut, index[p.cut]);
    const section = sectionOf(region, p, value, step(p.cut) / 2);
    const entry: DrawnView = { view: markPlaneLabel(plane, value), plane, cut: value };
    if (!section) {
      missed.push(entry);
      continue;
    }
    drawn.push(section.kind === "points" ? { ...entry, points: section.pts.length } : entry);
    const geom: SliceGeom = { sx: 1, sy: 1, angle: cell[p.angle] ?? 90 };
    // The 3D-ΔPDF page's full view and zoom limits (DeltaPdfViewer).
    const reach = Math.max(fullHalf, fit.half);
    const frame: Frame = {
      target: sectionBounds(section, geom),
      fit,
      data: extentBounds({ x_axis: grid.ranges[p.u], y_axis: grid.ranges[p.v] }, geom),
      minHalf: clampHalf(0, reach, step(0)),
      maxHalf: clampHalf(Infinity, reach, step(0)),
    };
    frames[plane] = frame;
    const current = now.dpdfViews[plane] ?? fit;
    zoomed ||= zoomedIn(frameIn(frame, current), current);
  }
  if (!drawn.length) return { ok: false, reason: "the region meets none of the ΔPDF's three sections through it" };
  return { ok: true, region, clipped: clip.clipped, view: { page: "dpdf", index, frames }, drawn, missed, zoomed };
}

/**
 * Move the console to a mark: its page and cuts, each view it is drawn on
 * framed to it as that view is now (zoomed or panned only where it is too
 * small to see or out of view), the cleanup page's primary view on its stage
 * (in the focus and single layouts), and the mark shown again if it was
 * hidden. A mark on another dataset than the selected one is not shown
 * (false): its cuts would land on other data.
 */
export function showMark(mark: Mark, datasetId: string | undefined): boolean {
  if (mark.datasetId !== datasetId) return false;
  useMarkStore.getState().reveal(mark.id);
  const v = mark.view;
  if (v.page === "cleanup") {
    const vs = useViewerStore.getState();
    // The cleanup page snaps the focus to its grid once its metadata is in (openView does the same).
    vs.setFocus({ axis: v.axis, value: v.value });
    vs.setFixedAxis(v.axis);
    const plane = AXIS_TO_PLANE[v.axis];
    const vp = frameIn(v.frame, vs.views[plane]);
    if (vp) vs.setView(plane, vp);
    useMarkStore.getState().setLayoutRequest({ page: "cleanup", primary: WHERE_OUTPUT[mark.where] });
    useNavStore.getState().setTab("reciprocal");
  } else {
    const ds = useDpdfStore.getState();
    ds.center(...v.index);
    for (const plane of DPDF_MARK_PLANES) {
      const f = v.frames[plane];
      const vp = f && frameIn(f, ds.views[plane]);
      if (vp) ds.setView(plane, vp);
    }
    useNavStore.getState().setTab("dpdf");
  }
  return true;
}

/** Add a planned mark to the store and show it. */
export function placeMark(spec: MarkSpec, plan: Extract<MarkPlan, { ok: true }>, datasetId: string, now = new Date()): Mark {
  const mark = useMarkStore.getState().add({
    datasetId,
    where: spec.where,
    region: plan.region,
    label: shortLabel(spec.label),
    evidence: spec.evidence,
    created: now.toISOString(),
    view: plan.view,
  });
  showMark(mark, datasetId);
  return mark;
}
