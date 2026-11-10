// Pair-vector markers over a 3D-ΔPDF slice (see structure/pairs.ts): a glyph
// per interatomic vector inside a light-then-dark halo that holds it apart
// from the dark lobes of a diverging colormap and from its pale midpoint
// alike.  The glyph says what the ΔPDF holds at its own vector
// (structure/signal.ts): filled in the colormap's positive or negative colour
// where it stands out, hollow, and optionally small and faint, where it does
// not.  Element pairs that share a vector are nested, the fill in the inner
// glyph.  Glyphs fade with their distance from the cut plane.  Drawn in view
// pixels (not a stretched viewBox) so the shapes keep their proportions in any
// view; one path per element pair, state and fade level keeps the DOM small,
// and the paths are rebuilt only when the markers, the view or a setting
// change (not as the pointer moves).

import { useMemo } from "react";

import { pairGlyph, shapePath } from "../structure/glyphs";
import { vectorLength, type Marker } from "../structure/pairs";
import { markerSpots, signalState, signalText, spotBatches, type OverlaySignal } from "../structure/signal";
import type { Vec3 } from "../structure/symops";
import { toDisplay } from "./oblique";
import { useViewSize } from "./viewSize";
import { displayToPixel, type Viewport } from "./viewport";

const DARK = "rgba(8, 10, 14, 0.85)";
const LIGHT = "rgba(255, 255, 255, 0.92)";

/** No values: every marker hollow at full size. */
const NO_SIGNAL: OverlaySignal = { source: "pending", threshold: 3, fade: false, colors: ["none", "none"], kind: "atomic" };

interface Props {
  markers: Marker[];
  elements: string[];
  order: readonly string[]; // the element pairs in legend order
  angle: number; // the slice's axes_angle
  viewport: Viewport;
  depth: number; // slab half-thickness (Å)
  signal?: OverlaySignal;
}

export function StructureOverlay({ markers, elements, order, angle, viewport, depth, signal = NO_SIGNAL }: Props) {
  const { w, h } = useViewSize();
  const { source, threshold, fade } = signal;
  const { cx, cy, half } = viewport;
  const spots = useMemo(() => markerSpots(markers, source, elements, order), [markers, source, elements, order]);
  const batches = useMemo(() => {
    if (w <= 1 || h <= 1) return [];
    const view = { cx, cy, half };
    return spotBatches(spots, {
      threshold,
      fade,
      depth,
      w,
      h,
      project: (sh, sv) => {
        const [X, Y] = toDisplay(sh, sv, angle);
        return displayToPixel(view, X, Y, w, h);
      },
    });
  }, [spots, threshold, fade, depth, angle, cx, cy, half, w, h]);
  if (batches.length === 0) return null;

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", overflow: "hidden" }}
    >
      {batches.map((b) => {
        const fill = b.fill ? signal.colors[b.fill === "pos" ? 0 : 1] : "none";
        return (
          <g key={b.id} opacity={b.opacity} fill="none" strokeLinejoin="round">
            {b.disc ? (
              <>
                <path d={b.disc} stroke={DARK} strokeWidth={3.5} />
                <path d={b.disc} stroke={LIGHT} strokeWidth={1.5} fill={fill} />
                <path d={b.d} stroke={LIGHT} strokeWidth={3.5} />
              </>
            ) : (
              <>
                <path d={b.d} stroke={DARK} strokeWidth={5.5 * b.stroke} />
                <path d={b.d} stroke={LIGHT} strokeWidth={3.5 * b.stroke} fill={fill} />
              </>
            )}
            <path d={b.d} stroke={b.color} strokeWidth={2 * b.stroke} />
          </g>
        );
      })}
    </svg>
  );
}

/**
 * The pair vectors under the pointer, for a page's readout: per vector, the
 * pairs that share it and how many per cell, |u|, u in lattice units, its
 * distance from the cut, and what the ΔPDF holds there.
 */
export function StructureHits({
  hits,
  elements,
  order,
  lat,
  angles,
  signal,
}: {
  hits: Marker[];
  elements: string[];
  order: readonly string[];
  lat: Vec3; // the ΔPDF's a, b, c (Å)
  angles: Vec3; // α, β, γ (deg)
  signal?: OverlaySignal;
}) {
  const spots = markerSpots(hits, signal?.source ?? "pending", elements, order);
  return (
    <>
      {spots.map((s) => {
        const m = s.markers[0];
        const state = signal ? signalState(s.reading, signal.threshold) : "none";
        const origin = signal && typeof signal.source === "object" ? signal.source.originRadius : null;
        return (
          <span key={`${m.key}|${m.off.toFixed(3)}`} className="struct-hit">
            {s.markers.map((q) => (
              <span key={q.key} className="struct-hit-pair">
                <GlyphIcon pair={q.key} elements={elements} size={12} />
                {q.pairs.map((x) => `${x.from}→${x.to} ×${x.count}`).join(", ")}
              </span>
            ))}
            <i> |u|</i> {vectorLength(m.u, angles).toFixed(3)} Å
            <i> u</i> [{m.u.map((x, k) => (x / lat[k]).toFixed(3)).join(", ")}]
            {Math.abs(m.off) >= 0.005 && (
              <i>
                {" "}
                {m.off > 0 ? "+" : "−"}
                {Math.abs(m.off).toFixed(2)} Å off the cut
              </i>
            )}
            {signal && (
              <span className={`struct-signal${state === "pos" || state === "neg" ? " on" : ""}`}>
                {state === "pos" || state === "neg" ? <FillIcon color={signal.colors[state === "pos" ? 0 : 1]} size={12} /> : null}
                {signalText(s.reading, signal.threshold, origin, signal.kind)}
              </span>
            )}
          </span>
        );
      })}
    </>
  );
}

/** One glyph as a small inline icon, for the legend and the readout. */
export function GlyphIcon({ pair, elements, size = 14 }: { pair: string; elements: string[]; size?: number }) {
  const g = pairGlyph(pair, elements);
  const d = shapePath(g.shape, size / 2, size / 2, size / 2 - 2.5);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ flex: "none" }}>
      <path d={d} fill="none" stroke={g.color} strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}

/** A marker's fill as an icon: a disc in a fill colour inside its white ring, or the small hollow ring of "no signal". */
export function FillIcon({ color, size = 14 }: { color: string | null; size?: number }) {
  const c = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ flex: "none" }}>
      {color ? (
        <circle cx={c} cy={c} r={c - 1.5} fill={color} stroke="#fff" strokeWidth={1.5} />
      ) : (
        <circle cx={c} cy={c} r={(c - 1.5) * 0.65} fill="none" stroke="var(--text-2, #a8b1bf)" strokeWidth={1.5} />
      )}
    </svg>
  );
}
