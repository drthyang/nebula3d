// Pair-vector markers over a 3D-ΔPDF slice (see structure/pairs.ts): a hollow
// glyph per interatomic vector, so the ΔPDF under it stays visible, inside a
// light-then-dark halo that holds it apart from the dark lobes of a diverging
// colormap and from its pale midpoint alike.  Glyphs
// fade with their distance from the cut plane.  Drawn in view pixels (not a
// stretched viewBox) so the shapes keep their proportions in any view; one path
// per element pair and fade level keeps the DOM small.

import { pairGlyph, shapePath } from "../structure/glyphs";
import { vectorLength, type Marker } from "../structure/pairs";
import type { Vec3 } from "../structure/symops";
import { toDisplay } from "./oblique";
import { useViewSize } from "./viewSize";
import { displayToPixel, type Viewport } from "./viewport";

const R = 5; // glyph radius (px)
const LEVELS = 4; // fade levels

interface Props {
  markers: Marker[];
  elements: string[];
  angle: number; // the slice's axes_angle
  viewport: Viewport;
  depth: number; // slab half-thickness (Å)
}

export function StructureOverlay({ markers, elements, angle, viewport, depth }: Props) {
  const { w, h } = useViewSize();
  if (w <= 1 || h <= 1 || markers.length === 0) return null;

  const paths = new Map<string, { key: string; level: number; d: string[] }>();
  for (const m of markers) {
    const [X, Y] = toDisplay(m.h, m.v, angle);
    const [px, py] = displayToPixel(viewport, X, Y, w, h);
    if (px < -2 * R || py < -2 * R || px > w + 2 * R || py > h + 2 * R) continue;
    const fade = depth > 0 ? Math.min(1, Math.abs(m.off) / depth) : 0;
    const level = Math.min(LEVELS - 1, Math.floor(fade * LEVELS));
    const id = `${m.key}|${level}`;
    let p = paths.get(id);
    if (!p) {
      p = { key: m.key, level, d: [] };
      paths.set(id, p);
    }
    p.d.push(shapePath(pairGlyph(m.key, elements).shape, px, py, R));
  }

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", overflow: "hidden" }}
    >
      {[...paths.values()].map(({ key, level, d }) => {
        const path = d.join("");
        return (
          <g key={`${key}|${level}`} opacity={1 - (0.6 * level) / (LEVELS - 1)} fill="none" strokeLinejoin="round">
            <path d={path} stroke="rgba(8, 10, 14, 0.85)" strokeWidth={5.5} />
            <path d={path} stroke="rgba(255, 255, 255, 0.92)" strokeWidth={3.5} />
            <path d={path} stroke={pairGlyph(key, elements).color} strokeWidth={2} />
          </g>
        );
      })}
    </svg>
  );
}

/**
 * The pair vectors under the pointer, for a page's readout: the pairs and how
 * many per cell, |u|, u in lattice units and its distance from the cut.
 */
export function StructureHits({
  hits,
  elements,
  lat,
  angles,
}: {
  hits: Marker[];
  elements: string[];
  lat: Vec3; // the ΔPDF's a, b, c (Å)
  angles: Vec3; // α, β, γ (deg)
}) {
  return (
    <>
      {hits.map((m) => (
        <span key={m.key} className="struct-hit">
          <GlyphIcon pair={m.key} elements={elements} size={12} />
          {m.pairs.map((q) => `${q.from}→${q.to} ×${q.count}`).join(", ")}
          <i> |u|</i> {vectorLength(m.u, angles).toFixed(3)} Å
          <i> u</i> [{m.u.map((x, k) => (x / lat[k]).toFixed(3)).join(", ")}]
          {Math.abs(m.off) >= 0.005 && (
            <i>
              {" "}
              {m.off > 0 ? "+" : "−"}
              {Math.abs(m.off).toFixed(2)} Å off the cut
            </i>
          )}
        </span>
      ))}
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
