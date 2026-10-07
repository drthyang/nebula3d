// The interactive frame around one slice view, after the NeXus Viewer:
//   navigate — hover reads values; a click (or drag) calls onNavigate
//   zoom     — a click zooms in 2× about the point (Alt-click zooms out); a
//              drag zooms into the box
//   move     — a drag pans
// In every mode a double-click returns to `fit`, a trackpad pinch (ctrl+wheel)
// or a two-finger pinch zooms, and a plain wheel still scrolls the page.  The
// frame fills its view: the viewport's `half` spans the shorter side and a wide
// or tall view shows more of the slice.  The overlay draws axis ticks in the
// slice's units, the crosshair shared by linked views, the zoom box and a
// field-of-view chip.  The view's pixel size reaches the canvas through
// ViewSizeContext.

import { useEffect, useRef, useState, type ReactNode } from "react";

import type { ClickMode } from "../state/workspaceStore";
import { ViewSizeContext, type ViewSize } from "./viewSize";
import {
  boxViewport,
  displayToPixel,
  niceStep,
  panBy,
  pixelToDisplay,
  viewExtent,
  zoomAbout,
  type Viewport,
} from "./viewport";

export interface AxisSpec {
  sx: number; // tick unit → display unit along X (2π/a for r.l.u., 1 for Å)
  sy: number;
  xLabel: string;
  yLabel: string;
  unit: string; // tick unit, e.g. "r.l.u." or "Å"
  fovUnit: string; // display unit for the field-of-view chip, e.g. "Å⁻¹"
}

interface Props {
  viewport: Viewport;
  onViewport: (v: Viewport) => void;
  fit: Viewport;
  limit: (half: number) => number;
  mode: ClickMode;
  axes: AxisSpec;
  cursor: [number, number] | null; // display point under the pointer in any linked view
  onCursor?: (p: [number, number] | null) => void;
  onNavigate?: (X: number, Y: number) => void;
  children: ReactNode;
}

type Drag = { x0: number; y0: number; v0: Viewport; moved: boolean };
type Pinch = { d0: number; mid0: [number, number]; v0: Viewport };

export function ViewFrame({
  viewport,
  onViewport,
  fit,
  limit,
  mode,
  axes,
  cursor,
  onCursor,
  onNavigate,
  children,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<ViewSize>({ w: 0, h: 0 });
  const [box, setBox] = useState<[number, number, number, number] | null>(null);
  const drag = useRef<Drag | null>(null);
  const pinch = useRef<Pinch | null>(null);
  const pointers = useRef(new Map<number, [number, number]>());
  const pending = useRef<Viewport | null>(null);
  const frame = useRef(0);
  // Latest props for the native wheel listener and the animation-frame flush.
  const live = useRef({ viewport, limit, onViewport });
  live.current = { viewport, limit, onViewport };

  // One viewport update per animation frame while dragging or pinching.
  const emit = (v: Viewport) => {
    pending.current = v;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (pending.current) live.current.onViewport(pending.current);
      pending.current = null;
    });
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setDims((d) => (d.w === r.width && d.h === r.height ? d : { w: r.width, h: r.height }));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    // A trackpad pinch arrives as ctrl+wheel; a plain wheel scrolls the page.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const b = el.getBoundingClientRect();
      const { viewport: v, limit: lim } = live.current;
      const [X, Y] = pixelToDisplay(v, e.clientX - b.left, e.clientY - b.top, b.width, b.height);
      live.current.onViewport(zoomAbout(v, X, Y, Math.exp(e.deltaY * 0.01), lim));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener("wheel", onWheel);
    };
  }, []);

  const rect = () => {
    const b = ref.current!.getBoundingClientRect();
    return { left: b.left, top: b.top, w: b.width || 1, h: b.height || 1 };
  };
  const local = (e: React.PointerEvent): [number, number] => {
    const r = rect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    ref.current!.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      pinch.current = { d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, mid0: mid, v0: viewport };
      drag.current = null;
      setBox(null);
    } else {
      drag.current = { x0: p[0], y0: p[1], v0: viewport, moved: false };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = local(e);
    const { w, h } = rect();
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
      const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const { v0, d0, mid0 } = pinch.current;
      const [X, Y] = pixelToDisplay(v0, mid0[0], mid0[1], w, h);
      const zoomed = zoomAbout(v0, X, Y, d0 / d, limit);
      emit(panBy(zoomed, mid[0] - mid0[0], mid[1] - mid0[1], w, h));
      return;
    }
    const pt = pixelToDisplay(viewport, p[0], p[1], w, h);
    onCursor?.(pt);
    const dr = drag.current;
    if (!dr) return;
    dr.moved ||= Math.hypot(p[0] - dr.x0, p[1] - dr.y0) > 4;
    if (!dr.moved) return;
    if (mode === "move") emit(panBy(dr.v0, p[0] - dr.x0, p[1] - dr.y0, w, h));
    else if (mode === "zoom") setBox([dr.x0, dr.y0, p[0], p[1]]);
    else if (mode === "navigate") onNavigate?.(pt[0], pt[1]);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pinch.current) {
      if (pointers.current.size < 2) pinch.current = null;
      drag.current = null;
      return;
    }
    const dr = drag.current;
    drag.current = null;
    if (!dr) return;
    const p = local(e);
    const { w, h } = rect();
    const pt = pixelToDisplay(viewport, p[0], p[1], w, h);
    if (mode === "zoom") {
      if (dr.moved && box) {
        const a = pixelToDisplay(dr.v0, dr.x0, dr.y0, w, h);
        onViewport(boxViewport(a, pt, limit, w, h));
      } else if (!dr.moved) {
        onViewport(zoomAbout(viewport, pt[0], pt[1], e.altKey ? 2 : 0.5, limit));
      }
    } else if (mode === "navigate" && !dr.moved) {
      onNavigate?.(pt[0], pt[1]);
    }
    setBox(null);
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    drag.current = null;
    pinch.current = null;
    setBox(null);
  };

  return (
    <div
      ref={ref}
      className={`vf vf--${mode}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={() => {
        if (!drag.current && !pinch.current) onCursor?.(null);
      }}
      onDoubleClick={() => onViewport(fit)}
    >
      {dims.w > 0 && (
        <ViewSizeContext.Provider value={dims}>
          {children}
          <Overlay viewport={viewport} w={dims.w} h={dims.h} axes={axes} cursor={cursor} box={box} />
        </ViewSizeContext.Provider>
      )}
      <span className="vf-fov">±{fmtHalf(viewport.half)} {axes.fovUnit}</span>
    </div>
  );
}

function fmtHalf(h: number): string {
  return h >= 100 ? h.toFixed(0) : h >= 1 ? h.toFixed(1) : h.toPrecision(2);
}

function Overlay({
  viewport: v,
  w,
  h,
  axes,
  cursor,
  box,
}: {
  viewport: Viewport;
  w: number;
  h: number;
  axes: AxisSpec;
  cursor: [number, number] | null;
  box: [number, number, number, number] | null;
}) {
  const small = Math.min(w, h) < 220;
  const { hx, hy } = viewExtent(v, w, h);
  const ticks: ReactNode[] = [];
  for (const axis of ["x", "y"] as const) {
    const s = axis === "x" ? axes.sx : axes.sy;
    const c = axis === "x" ? v.cx : v.cy;
    const half = axis === "x" ? hx : hy;
    const len = axis === "x" ? w : h;
    const lo = (c - half) / s;
    const hi = (c + half) / s;
    const step = niceStep(hi - lo, Math.max(3, Math.round(len / (small ? 70 : 90))));
    for (let t = Math.ceil(lo / step) * step; t <= hi + step * 1e-6; t += step) {
      const f = (t * s - (c - half)) / (2 * half);
      const label = Math.abs(t) < step * 1e-6 ? "0" : String(Number(t.toPrecision(4)));
      if (axis === "x") {
        const X = f * w;
        if (X < 14 || X > w - 14) continue;
        ticks.push(
          <g key={`x${t}`}>
            <line x1={X} x2={X} y1={h} y2={h - 5} />
            <text x={X} y={h - 8} textAnchor="middle">{label}</text>
          </g>,
        );
      } else {
        const Y = (1 - f) * h;
        if (Y < 20 || Y > h - 20) continue;
        ticks.push(
          <g key={`y${t}`}>
            <line x1={0} x2={5} y1={Y} y2={Y} />
            <text x={8} y={Y} dy="0.35em">{label}</text>
          </g>,
        );
      }
    }
  }
  let cross: ReactNode = null;
  if (cursor) {
    const [X, Y] = displayToPixel(v, cursor[0], cursor[1], w, h);
    if (X >= 0 && X <= w && Y >= 0 && Y <= h) {
      cross = (
        <g className="vf-cross">
          <line x1={X} x2={X} y1={0} y2={h} />
          <line x1={0} x2={w} y1={Y} y2={Y} />
        </g>
      );
    }
  }
  return (
    <svg className="vf-overlay" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <g className="vf-ticks">{ticks}</g>
      {!small && (
        <>
          <text className="vf-axis" x={w - 6} y={h - 21} textAnchor="end">
            {axes.xLabel} ({axes.unit})
          </text>
          <text className="vf-axis" x={8} y={14}>{axes.yLabel}</text>
        </>
      )}
      {cross}
      {box && (
        <rect
          className="vf-box"
          x={Math.min(box[0], box[2])}
          y={Math.min(box[1], box[3])}
          width={Math.abs(box[2] - box[0])}
          height={Math.abs(box[3] - box[1])}
        />
      )}
    </svg>
  );
}
