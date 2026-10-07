// Unit-cell gridline overlay (SVG) for the ΔPDF square-window viewer.  Draws
// gray dashed lattice lines at integer multiples of the direct-lattice spacing
// along each displayed axis, over a square [-half, +half] Å window.  For a
// section whose axes meet at a non-right angle (e.g. a hexagonal ab-plane,
// 120°) the lines follow that angle, matching SliceCanvas's oblique drawing —
// see oblique.ts.  Renders into a normalized viewBox with a non-scaling stroke,
// so it fills its square parent responsively — used both at a fixed px size
// (single ΔPDF panel) and in the fluid multi-volume grid cells.

import { unitCellSegments } from "./oblique";
import { useViewSize } from "./viewSize";
import { viewExtent, type Viewport } from "./viewport";

interface Props {
  half: number; // half-window in Å (box spans [-half, +half] on both axes)
  viewport?: Viewport; // a panned / zoomed square view instead of [-half, half]²
  latX: number | null;
  latY: number | null;
  angle?: number; // angle between the displayed axes (deg); the slice header's axes_angle
}

const VB = 1000; // normalized viewBox side; stroke stays 1px (non-scaling)

export function UnitCellGrid({ half, viewport, latX, latY, angle = 90 }: Props) {
  const size = useViewSize();
  const v = viewport ?? { cx: 0, cy: 0, half };
  // A viewport in a wide or tall view spans more along its longer side.
  const { hx, hy } = viewport ? viewExtent(v, size.w, size.h) : { hx: v.half, hy: v.half };
  const toX = (x: number) => ((x - (v.cx - hx)) / (2 * hx)) * VB;
  // canvas y is flipped (smallest y at the bottom), so mirror here too.
  const toY = (y: number) => VB - ((y - (v.cy - hy)) / (2 * hy)) * VB;

  // Lines over an origin-centred square that covers the whole view; the svg clips.
  const reach = Math.max(Math.abs(v.cx) + hx, Math.abs(v.cy) + hy);
  const segments = unitCellSegments(reach, latX, latY, angle);

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
