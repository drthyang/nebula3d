// Unit-cell gridline overlay (SVG) for the slice views.  Draws gray dashed
// lattice lines at integer multiples of a spacing along each displayed axis:
// the direct-lattice spacings on a ΔPDF section (Å), or one r.l.u. on a
// reciprocal-space slice (HklGrid: the lines of integer h, k, l).  For a
// section whose axes meet at a non-right angle (e.g. a hexagonal ab-plane,
// 120°) the lines follow that angle, matching SliceCanvas's oblique drawing —
// see oblique.ts.  Inside a ViewFrame the lines follow its viewport while it
// is zoomed and panned (only those that cross the view are drawn); without
// one they cover a square [-half, +half] window.  Renders into a normalized
// viewBox with a non-scaling stroke, so it fills its parent responsively.

import { gridSegments } from "./oblique";
import { useViewSize } from "./viewSize";
import { visibleBounds, type SliceGeom, type Viewport } from "./viewport";

interface Props {
  half: number; // half-window in Å (box spans [-half, +half] on both axes)
  viewport?: Viewport; // a panned / zoomed view instead of [-half, half]²
  latX: number | null;
  latY: number | null;
  angle?: number; // angle between the displayed axes (deg); the slice header's axes_angle
}

const VB = 1000; // normalized viewBox side; stroke stays 1px (non-scaling)

export function UnitCellGrid({ half, viewport, latX, latY, angle = 90 }: Props) {
  const size = useViewSize();
  // A viewport in a wide or tall view spans more along its longer side.
  const b = viewport ? visibleBounds(viewport, size.w, size.h) : { x0: -half, x1: half, y0: -half, y1: half };
  const toX = (x: number) => ((x - b.x0) / (b.x1 - b.x0)) * VB;
  // canvas y is flipped (smallest y at the bottom), so mirror here too.
  const toY = (y: number) => VB - ((y - b.y0) / (b.y1 - b.y0)) * VB;

  // The lines that cross the view, each spanning it; the svg clips the slanted ones.
  const segments = gridSegments(b, latX, latY, angle);

  return (
    <svg
      viewBox={`0 0 ${VB} ${VB}`}
      preserveAspectRatio="none"
      width="100%"
      height="100%"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        pointerEvents: "none",
        overflow: "hidden", // slanted lines run past the window corners
      }}
    >
      <g
        stroke="rgba(150, 158, 172, 0.6)"
        strokeWidth={1}
        strokeDasharray="4 3"
        shapeRendering={angle === 90 ? "crispEdges" : "geometricPrecision"}
      >
        {segments.map(([x1, y1, x2, y2], i) => (
          <line
            key={i}
            x1={toX(x1)}
            y1={toY(y1)}
            x2={toX(x2)}
            y2={toY(y2)}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
    </svg>
  );
}

/**
 * Dashed lines at integer h, k, l on an r.l.u. slice view (the "Unit cells"
 * switch on the reciprocal-space views): one r.l.u. apart along each displayed
 * axis, in the view's display units and at its axes angle — the geometry its
 * canvas and ticks use (viewport.ts hklGridSegments).
 */
export function HklGrid({ viewport, geom }: { viewport: Viewport; geom: SliceGeom }) {
  return <UnitCellGrid half={viewport.half} viewport={viewport} latX={geom.sx} latY={geom.sy} angle={geom.angle} />;
}
