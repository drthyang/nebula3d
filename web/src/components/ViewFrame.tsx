// The interactive frame around one slice view, after the NeXus Viewer:
//   navigate — hover reads values; a click (or drag) calls onNavigate
//   zoom     — a click zooms in 2× about the point (Alt-click zooms out); a
//              drag zooms into the box
//   move     — a drag pans
// In every mode it behaves like an embedded map ("cooperative" gestures):
//   wheel    — when the page around the view can scroll, a plain wheel (or a
//              two-finger scroll) scrolls the page and a hint says "Use Ctrl +
//              scroll to zoom" (⌘ on macOS); Ctrl/⌘ + wheel zooms about the
//              pointer, and so does a trackpad pinch (ctrl+wheel in Chromium and
//              Firefox, GestureEvents in Safari).  When the page cannot scroll
//              (the view fills it) a plain wheel zooms.  A sideways scroll is
//              the page's.
//   drag     — a middle-button or Shift drag pans (and a drag in Move mode);
//              the view's centre stays on the data (`bounds`), so it cannot be
//              dragged off screen
//   double-click — zooms in 2× at the pointer (Alt: out); Shift+double-click
//              returns to `fit`, as do the header's Reset zoom and the 0 key.
//              In Zoom mode its two clicks have zoomed already.
//   keys     — on the focused view, + / − zoom about the centre, the arrows
//              pan, 0 resets; the view's + / − buttons zoom too.
// The frame fills its view: the viewport's `half` spans the shorter side and a wide
// or tall view shows more of the slice.  The overlay draws axis ticks in the
// slice's units, the crosshair shared by linked views, the zoom box and a
// field-of-view chip.  The view's pixel size reaches the canvas through
// ViewSizeContext.

import { useEffect, useRef, useState, type ReactNode } from "react";

import type { ClickMode } from "../state/workspaceStore";
import { ViewSizeContext, type ViewSize } from "./viewSize";
import {
  boxViewport,
  clampToBounds,
  displayToPixel,
  niceStep,
  panBy,
  pixelToDisplay,
  viewExtent,
  viewportBounds,
  wheelZoomFactor,
  zoomAbout,
  type Bounds,
  type Viewport,
} from "./viewport";

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
/** The hint a plain wheel shows over a view on a page that scrolls. */
export const ZOOM_HINT = `Use ${MAC ? "⌘" : "Ctrl"} + scroll to zoom`;
const HINT_MS = 1500;

/**
 * Whether the page around `el` can scroll vertically: an ancestor that scrolls
 * (overflow auto or scroll, with more to show), or the document itself. Then a
 * plain wheel over a view is the page's, as over an embedded map.
 */
function pageCanScroll(el: Element): boolean {
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    if (p.scrollHeight <= p.clientHeight + 1) continue;
    const oy = getComputedStyle(p).overflowY;
    if (oy === "auto" || oy === "scroll" || oy === "overlay") return true;
  }
  const doc = document.scrollingElement ?? document.documentElement;
  const hidden = (e: Element) => getComputedStyle(e).overflowY === "hidden";
  return doc.scrollHeight > doc.clientHeight + 1 && !hidden(document.documentElement) && !hidden(document.body);
}

// Safari's pinch (GestureEvent is WebKit-only, so not in the DOM types).
type GestureLike = Event & { scale?: number; clientX?: number; clientY?: number };

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
  // The data's display extent: the view's centre stays inside it (default: `fit`'s square).
  bounds?: Bounds;
  limit: (half: number) => number;
  mode: ClickMode;
  axes: AxisSpec;
  cursor: [number, number] | null; // display point under the pointer in any linked view
  onCursor?: (p: [number, number] | null) => void;
  onNavigate?: (X: number, Y: number) => void;
  children: ReactNode;
}

type Drag = { x0: number; y0: number; v0: Viewport; moved: boolean; pan: boolean };
type Pinch = { d0: number; mid0: [number, number]; v0: Viewport };

export function ViewFrame({
  viewport,
  onViewport,
  fit,
  bounds,
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
  const gesture = useRef<{ v0: Viewport; at: [number, number] } | null>(null);
  const [hint, setHint] = useState(false);
  const hintTimer = useRef(0);
  // Latest props for the native listeners and the animation-frame flush.
  const live = useRef({ viewport, limit, onViewport, fit, bounds });
  live.current = { viewport, limit, onViewport, fit, bounds };
  // Every pan and zoom keeps the view's centre on the data.
  const settle = (v: Viewport) => clampToBounds(v, live.current.bounds ?? viewportBounds(live.current.fit));

  // One viewport update per animation frame while dragging or pinching.
  const emit = (v: Viewport) => {
    pending.current = settle(v);
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (pending.current) live.current.onViewport(pending.current);
      pending.current = null;
    });
  };
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      clearTimeout(hintTimer.current);
    },
    [],
  );

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
    // Cooperative wheel, as on an embedded map: Ctrl/⌘ + wheel (a pinch is
    // ctrl+wheel) zooms about the pointer; a plain wheel zooms only when the
    // page cannot scroll, else it scrolls the page and the hint says how to zoom.
    // A sideways scroll is left to the page.
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.deltaY === 0) return;
      const modifier = e.ctrlKey || e.metaKey;
      if (gesture.current) {
        if (modifier) e.preventDefault(); // Safari's pinch zooms through its GestureEvents
        return;
      }
      if (!modifier && pageCanScroll(el)) {
        setHint(true);
        clearTimeout(hintTimer.current);
        hintTimer.current = window.setTimeout(() => setHint(false), HINT_MS);
        return;
      }
      e.preventDefault();
      setHint(false);
      const b = el.getBoundingClientRect();
      const { viewport: v, limit: lim } = live.current;
      const [X, Y] = pixelToDisplay(v, e.clientX - b.left, e.clientY - b.top, b.width, b.height);
      live.current.onViewport(settle(zoomAbout(v, X, Y, wheelZoomFactor(e.deltaY, e.deltaMode, b.height), lim)));
    };
    // Safari's trackpad pinch: GestureEvents, scale relative to the gesture's start.
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      const g = e as GestureLike;
      const b = el.getBoundingClientRect();
      const v = live.current.viewport;
      const at = pixelToDisplay(v, (g.clientX ?? b.left + b.width / 2) - b.left, (g.clientY ?? b.top + b.height / 2) - b.top, b.width, b.height);
      gesture.current = { v0: v, at };
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = gesture.current;
      const scale = (e as GestureLike).scale;
      if (!g || !scale) return;
      emit(zoomAbout(g.v0, g.at[0], g.at[1], 1 / scale, live.current.limit));
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      gesture.current = null;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    el.addEventListener("gestureend", onGestureEnd);
    return () => {
      ro.disconnect();
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      el.removeEventListener("gestureend", onGestureEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the listeners read the latest props through `live`
  }, []);

  const rect = () => {
    const b = ref.current!.getBoundingClientRect();
    return { left: b.left, top: b.top, w: b.width || 1, h: b.height || 1 };
  };
  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = rect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const onPointerDown = (e: React.PointerEvent) => {
    // The left button acts by the mode; the middle one (or Shift) pans.
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
    if (e.button === 1) e.preventDefault(); // no autoscroll
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
      drag.current = { x0: p[0], y0: p[1], v0: viewport, moved: false, pan: mode === "move" || e.button === 1 || e.shiftKey };
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
    if (dr.pan) emit(panBy(dr.v0, p[0] - dr.x0, p[1] - dr.y0, w, h));
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
    if (dr.pan) {
      // panned (or a click with the pan button): nothing more
    } else if (mode === "zoom") {
      if (dr.moved && box) {
        const a = pixelToDisplay(dr.v0, dr.x0, dr.y0, w, h);
        onViewport(settle(boxViewport(a, pt, limit, w, h)));
      } else if (!dr.moved) {
        onViewport(settle(zoomAbout(viewport, pt[0], pt[1], e.altKey ? 2 : 0.5, limit)));
      }
    } else if (mode === "navigate" && !dr.moved) {
      onNavigate?.(pt[0], pt[1]);
    }
    setBox(null);
  };

  // Double-click: in 2× at the pointer (Alt: out), as on a map; Shift: the full view.
  const onDoubleClick = (e: React.MouseEvent) => {
    if (e.shiftKey) return onViewport(fit);
    if (mode === "zoom") return; // its two clicks have zoomed already
    const p = local(e);
    const { w, h } = rect();
    const pt = pixelToDisplay(viewport, p[0], p[1], w, h);
    onViewport(settle(zoomAbout(viewport, pt[0], pt[1], e.altKey ? 2 : 0.5, limit)));
  };

  const zoomCentre = (k: number) => onViewport(settle(zoomAbout(viewport, viewport.cx, viewport.cy, k, limit)));

  // Keys on the focused view: + / − zoom about the centre, the arrows pan a tenth of it, 0 resets.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // the browser's own shortcuts (Ctrl + is the page zoom)
    const { w, h } = rect();
    const step = Math.min(w, h) / 10;
    const pan: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (e.key === "+" || e.key === "=") zoomCentre(0.5);
    else if (e.key === "-" || e.key === "_") zoomCentre(2);
    else if (e.key === "0") onViewport(fit);
    else if (pan[e.key]) onViewport(settle(panBy(viewport, pan[e.key][0], pan[e.key][1], w, h)));
    else return;
    e.preventDefault();
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
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={() => {
        if (!drag.current && !pinch.current) onCursor?.(null);
      }}
      onDoubleClick={onDoubleClick}
    >
      {dims.w > 0 && (
        <ViewSizeContext.Provider value={dims}>
          {children}
          <Overlay viewport={viewport} w={dims.w} h={dims.h} axes={axes} cursor={cursor} box={box} />
        </ViewSizeContext.Provider>
      )}
      <span className="vf-fov">±{fmtHalf(viewport.half)} {axes.fovUnit}</span>
      {Math.min(dims.w, dims.h) >= 160 && (
        <div className="vf-zoom" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <button type="button" className="vf-zoom-in" title="Zoom in (+)" aria-label="Zoom in" onClick={() => zoomCentre(0.5)}>
            +
          </button>
          <button type="button" className="vf-zoom-out" title="Zoom out (−)" aria-label="Zoom out" onClick={() => zoomCentre(2)}>
            −
          </button>
        </div>
      )}
      {hint && (
        <div className="vf-hint" role="status">
          {ZOOM_HINT}
        </div>
      )}
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
