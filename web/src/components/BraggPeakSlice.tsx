// One intensity-slice view for the Bragg-profile selected peak: the body of a
// workspace view (Workspace.tsx), on the shared ViewFrame.  The three views
// are one linked view about the peak centre (braggView.ts) with one colour
// scale, set in the page's display bar.
//
// The view resamples its slice in r.l.u. under each display pixel (one scale on
// both axes, so a peak's shape is not stretched), then overlays the punch fit
// ellipses (fitted / measured / |Q|-floor), a crosshair at the peak centre,
// the voxels the punch's tail sweep added on this plane (THY-60) and, with
// "Unit cell" on, dashed lines at integer h, k, l.  The raster and the
// overlay map r.l.u. to pixels with the same viewport (viewport.ts), so the
// ellipses stay registered to the data at any zoom.

import { useEffect, useMemo, useRef } from "react";

import type { Slice } from "../api/types";
import { ellipseInView, nearestIndex, RLU_GEOM, type Ellipse } from "./braggView";
import { makeScaler, type Levels, type ScaleKind } from "./colorScale";
import { HklGrid } from "./UnitCellGrid";
import { ViewFrame } from "./ViewFrame";
import { useViewSize } from "./viewSize";
import { displayToPixel, pixelToDisplay, type Bounds, type Viewport } from "./viewport";

export type { Ellipse } from "./braggView";

interface Props {
  slice: Slice | undefined;
  failed?: boolean;
  centre: [number, number]; // peak centre on the view's x, y axes (r.l.u.)
  viewport: Viewport; // this view's part of the linked view (r.l.u.)
  onViewport: (v: Viewport) => void;
  onReset: () => void;
  fit: Viewport; // the window the views open at, about the peak
  bounds?: Bounds;
  limit: (half: number) => number;
  cursor: [number, number] | null;
  onCursor: (p: [number, number] | null) => void;
  xLabel: string;
  yLabel: string;
  gridlines: boolean;
  lut: Uint8ClampedArray;
  levels: Levels; // the page's one colour range
  scale: ScaleKind;
  soft: number;
  fitted: Ellipse;
  measured?: Ellipse | null;
  floor?: Ellipse | null;
  // The tail sweep's voxels on this plane (x, y in r.l.u.) and a voxel's size.
  swept?: [number, number][];
  sweptStep?: [number, number];
}

const MAX_RASTER = 480; // raster px along the longer side; CSS scales it to the view
const NO_DATA = 40; // grey outside the data

/** The slice under each pixel of the view (nearest sample), no-data grey outside it. */
function TileRaster({
  slice,
  viewport,
  lut,
  levels,
  scale,
  soft,
}: {
  slice: Slice;
  viewport: Viewport;
  lut: Uint8ClampedArray;
  levels: Levels;
  scale: ScaleKind;
  soft: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { w, h } = useViewSize();
  const { lo, hi } = levels;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !(w > 0 && h > 0)) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { nx, x_axis: xs, y_axis: ys } = slice.header;
    const data = slice.data;
    const toUnit = makeScaler({ lo, hi }, scale, soft);
    const k = Math.min(1, MAX_RASTER / Math.max(w, h));
    const W = Math.max(1, Math.round(w * k));
    const H = Math.max(1, Math.round(h * k));
    canvas.width = W;
    canvas.height = H;
    const img = ctx.createImageData(W, H);
    const out = img.data;
    // Raster pixel (px, py) covers view pixels ((px, py) + ½)·(w/W, h/H): its
    // centre's display point is the r.l.u. sampled (pixelToDisplay, y up).
    const iys = new Int32Array(H);
    for (let py = 0; py < H; py++) iys[py] = nearestIndex(ys, pixelToDisplay(viewport, w / 2, ((py + 0.5) * h) / H, w, h)[1]);
    const ixs = new Int32Array(W);
    for (let px = 0; px < W; px++) ixs[px] = nearestIndex(xs, pixelToDisplay(viewport, ((px + 0.5) * w) / W, h / 2, w, h)[0]);
    for (let py = 0; py < H; py++) {
      const iy = iys[py];
      for (let px = 0; px < W; px++) {
        const ix = ixs[px];
        const o = (py * W + px) * 4;
        // Outside the data extent (zoomed out past the volume edge): an
        // explicit no-data margin rather than the boundary voxel smeared.
        const t = iy < 0 || ix < 0 ? NaN : toUnit(data[iy * nx + ix]);
        if (!Number.isFinite(t)) {
          out[o] = out[o + 1] = out[o + 2] = NO_DATA;
          out[o + 3] = 255;
          continue;
        }
        const li = (t * 255) | 0;
        out[o] = lut[li * 4];
        out[o + 1] = lut[li * 4 + 1];
        out[o + 2] = lut[li * 4 + 2];
        out[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [slice, viewport, lut, lo, hi, scale, soft, w, h]);

  return <canvas ref={ref} className="bragg-raster" />;
}

/** The fit ellipses and the peak-centre crosshair, in the view's pixels. */
function TileOverlay({
  centre,
  viewport,
  fitted,
  measured,
  floor,
  swept,
  sweptStep,
}: Pick<Props, "centre" | "viewport" | "fitted" | "measured" | "floor" | "swept" | "sweptStep">) {
  const { w, h } = useViewSize();
  const [X, Y] = displayToPixel(viewport, centre[0], centre[1], w, h);
  const voxel = (x: number, y: number, i: number) => {
    const [dx, dy] = sweptStep ?? [0, 0];
    const [x0, y0] = displayToPixel(viewport, x - dx / 2, y + dy / 2, w, h);
    const [x1, y1] = displayToPixel(viewport, x + dx / 2, y - dy / 2, w, h);
    return <rect key={i} x={x0} y={y0} width={Math.max(1, x1 - x0)} height={Math.max(1, y1 - y0)} className="bragg-r2" />;
  };
  const ell = (e: Ellipse, className: string) => {
    const p = ellipseInView(e, centre, viewport, w, h);
    return (
      <ellipse
        cx={p.cx}
        cy={p.cy}
        rx={Math.max(0.5, p.rx)}
        ry={Math.max(0.5, p.ry)}
        className={className}
        transform={p.angle ? `rotate(${p.angle} ${p.cx} ${p.cy})` : undefined}
      />
    );
  };
  return (
    <svg className="bragg-overlay" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <line x1={X} y1={0} x2={X} y2={h} className="bragg-cross" />
      <line x1={0} y1={Y} x2={w} y2={Y} className="bragg-cross" />
      {swept?.map(([x, y], i) => voxel(x, y, i))}
      {floor && ell(floor, "bragg-ell-floor")}
      {measured && ell(measured, "bragg-ell-meas")}
      {ell(fitted, "bragg-ell-fit")}
    </svg>
  );
}

export function BraggPeakSlice({ slice, failed = false, ...p }: Props) {
  const axes = useMemo(
    () => ({ sx: 1, sy: 1, xLabel: p.xLabel, yLabel: p.yLabel, unit: "r.l.u.", fovUnit: "r.l.u." }),
    [p.xLabel, p.yLabel],
  );
  if (failed) return <div className="panel-err">slice failed</div>;
  if (!slice) return <div className="skeleton" style={{ width: "100%", height: "100%" }} />;
  return (
    <ViewFrame
      viewport={p.viewport}
      onViewport={p.onViewport}
      onReset={p.onReset}
      fit={p.fit}
      bounds={p.bounds}
      limit={p.limit}
      axes={axes}
      cursor={p.cursor}
      onCursor={p.onCursor}
    >
      <TileRaster slice={slice} viewport={p.viewport} lut={p.lut} levels={p.levels} scale={p.scale} soft={p.soft} />
      {p.gridlines && <HklGrid viewport={p.viewport} geom={RLU_GEOM} lut={p.lut} />}
      <TileOverlay centre={p.centre} viewport={p.viewport} fitted={p.fitted} measured={p.measured} floor={p.floor} swept={p.swept} sweptStep={p.sweptStep} />
    </ViewFrame>
  );
}
