// Unit-cell gridline overlay (SVG) for the ΔPDF square-window viewer.  Draws
// gray dashed lattice lines at integer multiples of the direct-lattice spacing
// along each displayed axis, over a square [-half, +half] Å window.  For a
// section whose axes meet at a non-right angle (e.g. a hexagonal ab-plane,
// 120°) the lines follow that angle, matching SliceCanvas's oblique drawing —
// see oblique.ts.  Renders into a normalized viewBox with a non-scaling stroke,
// so it fills its square parent responsively — used both at a fixed px size
// (single ΔPDF panel) and in the fluid multi-volume grid cells.

import { unitCellSegments } from "./oblique";

interface Props {
  half: number; // half-window in Å (box spans [-half, +half] on both axes)
  latX: number | null;
  latY: number | null;
  angle?: number; // angle between the displayed axes (deg); the slice header's axes_angle
}

const VB = 1000; // normalized viewBox side; stroke stays 1px (non-scaling)

export function UnitCellGrid({ half, latX, latY, angle = 90 }: Props) {
  const toX = (v: number) => ((v + half) / (2 * half)) * VB;
  // canvas y is flipped (smallest y at the bottom), so mirror here too.
  const toY = (v: number) => VB - ((v + half) / (2 * half)) * VB;

  const segments = unitCellSegments(half, latX, latY, angle);

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
