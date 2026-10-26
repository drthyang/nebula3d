// One intensity-slice tile for the Bragg-profile selected-peak detail, on the
// shared ViewFrame: the three tiles are one linked view about the peak centre
// (braggView.ts), zoomed and panned like every other slice view.
//
// The tile resamples the fetched slice in r.l.u. under each display pixel
// (one scale on both axes, so a peak's shape is not stretched), then overlays
// the punch fit ellipses (fitted / measured / |Q|-floor), a crosshair at the
// peak centre and, with "Unit cells" on, dashed lines at integer h, k, l.  The
// raster and the overlay map r.l.u. to pixels with the same viewport
// (viewport.ts), so the ellipses stay registered to the data at any zoom.

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, type ReactNode } from "react";

import { fetchSlice } from "../api/client";
import type { Slice } from "../api/types";
import { ellipseInView, RLU_GEOM, type Ellipse } from "./braggView";
import { HklGrid } from "./UnitCellGrid";
import { ViewFrame } from "./ViewFrame";
import { useViewSize } from "./viewSize";
import { displayToPixel, pixelToDisplay, type Bounds, type Viewport } from "./viewport";

export type { Ellipse } from "./braggView";

interface Props {
  volumeId: string | undefined;
  plane: string; // "hk0" | "h0l" | "0kl"
  value: number; // fixed third-axis coordinate (r.l.u.)
  centre: [number, number]; // peak centre on the tile's x, y axes (r.l.u.)
  viewport: Viewport; // this tile's view of the linked view (r.l.u.)
  onViewport: (v: Viewport) => void;
  onReset: () => void;
  fit: Viewport; // the window the tile opens at, about the peak
  bounds?: Bounds;
  limit: (half: number) => number;
  cursor: [number, number] | null;
  onCursor: (p: [number, number] | null) => void;
  xLabel: string;
  yLabel: string;
  gridlines: boolean;
  lut: Uint8ClampedArray;
  brightness: number; // stops about the fit window's p99: +1 halves vmax (brighter)
  fitted: Ellipse;
  measured?: Ellipse | null;
  floor?: Ellipse | null;
  axisLabel: ReactNode;
  axisColor: string;
}

const MAX_RASTER = 480; // raster px along the longer side; CSS scales it to the tile
const VMAX_SAMPLES = 70; // per side of the fit window, for the colour limit

// Nearest sample index, or -1 when the requested coordinate is *outside* the axis
// range.  Returning -1 (rather than clamping to the edge index) keeps a zoomed-out
// window from smearing the boundary voxel across the out-of-data margin — those
// pixels render as "no data" instead.  Handles ascending or descending axes.
function nearest(axis: number[], v: number): number {
  const n = axis.length;
  if (n < 2) return 0;
  const lo = Math.min(axis[0], axis[n - 1]);
  const hi = Math.max(axis[0], axis[n - 1]);
  if (v < lo || v > hi) return -1;
  const t = ((v - axis[0]) / (axis[n - 1] - axis[0])) * (n - 1);
  return Math.max(0, Math.min(n - 1, Math.round(t)));
}

// Robust upper colour limit from the samples of the fit window about the peak
// (p99 keeps a single hot voxel from blowing out the scale).  Taken from the
// fit window, not the view, so the colours hold still while the tiles zoom and
// pan.  Brightness moves vmax in stops, as on the other viewer pages: +1
// halves vmax, so right on the knob is brighter.
function windowVmax(slice: Slice, cx: number, cy: number, half: number, brightness: number): number {
  const { nx, x_axis: xs, y_axis: ys } = slice.header;
  const data = slice.data;
  const vals: number[] = [];
  for (let j = 0; j < VMAX_SAMPLES; j++) {
    const iy = nearest(ys, cy - half + ((j + 0.5) / VMAX_SAMPLES) * 2 * half);
    if (iy < 0) continue;
    for (let i = 0; i < VMAX_SAMPLES; i++) {
      const ix = nearest(xs, cx - half + ((i + 0.5) / VMAX_SAMPLES) * 2 * half);
      if (ix < 0) continue;
      const v = data[iy * nx + ix];
      if (Number.isFinite(v) && v > 0) vals.push(v);
    }
  }
  if (vals.length === 0) return 1;
  vals.sort((a, b) => a - b);
  const p99 = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.99))];
  return Math.max(p99 * Math.pow(2, -brightness), 1e-9);
}

/** The slice under each pixel of the view (nearest sample), no-data grey outside it. */
function TileRaster({ slice, viewport, vmax, lut }: { slice: Slice; viewport: Viewport; vmax: number; lut: Uint8ClampedArray }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { w, h } = useViewSize();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !(w > 0 && h > 0)) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { nx, x_axis: xs, y_axis: ys } = slice.header;
    const data = slice.data;
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
    for (let py = 0; py < H; py++) iys[py] = nearest(ys, pixelToDisplay(viewport, w / 2, ((py + 0.5) * h) / H, w, h)[1]);
    const ixs = new Int32Array(W);
    for (let px = 0; px < W; px++) ixs[px] = nearest(xs, pixelToDisplay(viewport, ((px + 0.5) * w) / W, h / 2, w, h)[0]);
    for (let py = 0; py < H; py++) {
      const iy = iys[py];
      for (let px = 0; px < W; px++) {
        const ix = ixs[px];
        const o = (py * W + px) * 4;
        // Outside the data extent (zoomed out past the volume edge): render as
        // an explicit no-data margin rather than smearing the boundary voxel.
        const v = iy < 0 || ix < 0 ? NaN : data[iy * nx + ix];
        if (!Number.isFinite(v)) {
          out[o] = out[o + 1] = out[o + 2] = 40;
          out[o + 3] = 255;
          continue;
        }
        const t = Math.max(0, Math.min(1, v / vmax));
        const li = (t * 255) | 0;
        out[o] = lut[li * 4];
        out[o + 1] = lut[li * 4 + 1];
        out[o + 2] = lut[li * 4 + 2];
        out[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [slice, viewport, vmax, lut, w, h]);

  return <canvas ref={ref} />;
}

/** The fit ellipses and the peak-centre crosshair, in the view's pixels. */
function TileOverlay({
  centre,
  viewport,
  fitted,
  measured,
  floor,
}: Pick<Props, "centre" | "viewport" | "fitted" | "measured" | "floor">) {
  const { w, h } = useViewSize();
  const [X, Y] = displayToPixel(viewport, centre[0], centre[1], w, h);
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
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <line x1={X} y1={0} x2={X} y2={h} className="bragg-cross" />
      <line x1={0} y1={Y} x2={w} y2={Y} className="bragg-cross" />
      {floor && ell(floor, "bragg-ell-floor")}
      {measured && ell(measured, "bragg-ell-meas")}
      {ell(fitted, "bragg-ell-fit")}
    </svg>
  );
}

function TileShell({ label, color, children }: { label: ReactNode; color: string; children: ReactNode }) {
  return (
    <div className="bragg-tile">
      {children}
      <span className="bragg-tile-label" style={{ color }}>
        {label}
      </span>
    </div>
  );
}

export function BraggPeakSlice({ volumeId, plane, value, ...p }: Props) {
  const q = useQuery({
    queryKey: ["braggSlice", volumeId, plane, value],
    queryFn: () => fetchSlice(volumeId as string, plane, value, true),
    enabled: !!volumeId,
    staleTime: 5 * 60 * 1000,
  });
  const slice = q.data;
  const [cx, cy] = p.centre;
  const vmax = useMemo(
    () => (slice ? windowVmax(slice, cx, cy, p.fit.half, p.brightness) : 1),
    [slice, cx, cy, p.fit.half, p.brightness],
  );

  if (!volumeId || q.isError || !slice) {
    return (
      <TileShell label={p.axisLabel} color={p.axisColor}>
        {!volumeId || q.isError ? (
          <div className="bragg-tile-canvas bragg-tile-empty">
            <span>{!volumeId ? "no volume" : "slice failed"}</span>
          </div>
        ) : (
          <div className="bragg-tile-canvas">
            <div className="skeleton" style={{ width: "100%", height: "100%" }} />
          </div>
        )}
      </TileShell>
    );
  }
  return (
    <TileShell label={p.axisLabel} color={p.axisColor}>
      <div className={`bragg-tile-canvas${q.isFetching ? " slice-loading" : ""}`}>
        <ViewFrame
          viewport={p.viewport}
          onViewport={p.onViewport}
          onReset={p.onReset}
          fit={p.fit}
          bounds={p.bounds}
          limit={p.limit}
          axes={{ sx: 1, sy: 1, xLabel: p.xLabel, yLabel: p.yLabel, unit: "r.l.u.", fovUnit: "r.l.u." }}
          cursor={p.cursor}
          onCursor={p.onCursor}
        >
          <TileRaster slice={slice} viewport={p.viewport} vmax={vmax} lut={p.lut} />
          {p.gridlines && <HklGrid viewport={p.viewport} geom={RLU_GEOM} />}
          <TileOverlay centre={p.centre} viewport={p.viewport} fitted={p.fitted} measured={p.measured} floor={p.floor} />
        </ViewFrame>
      </div>
    </TileShell>
  );
}
