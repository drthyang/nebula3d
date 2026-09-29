// Geometry for drawing a real-space section whose two axes meet at a non-right
// angle θ (a hexagonal ab-plane has θ = γ = 120°, a monoclinic ac-plane θ = β).
// The server keeps the ΔPDF on its native oblique grid and sends θ per slice
// (`axes_angle`); the display puts the horizontal axis to the right and the
// vertical one at θ counter-clockwise from it:
//
//   X = h + v·cos θ,   Y = v·sin θ          (true Å, Y up)
//
// Mirrors nebula3d.analysis.delta_pdf.section_geometry.

import type { Lattice } from "../api/types";

const DEG = Math.PI / 180;

/** cos/sin of the axes angle, snapping 90° to an exact right angle. */
export function axesTrig(angleDeg: number): { cos: number; sin: number } {
  if (Math.abs(angleDeg - 90) < 1e-9) return { cos: 0, sin: 1 };
  return { cos: Math.cos(angleDeg * DEG), sin: Math.sin(angleDeg * DEG) };
}

/** Oblique in-plane coordinates (h, v) → display (X, Y), both in Å. */
export function toDisplay(h: number, v: number, angleDeg: number): [number, number] {
  const { cos, sin } = axesTrig(angleDeg);
  return [h + v * cos, v * sin];
}

/** Display (X, Y) → oblique in-plane coordinates (h, v). */
export function fromDisplay(X: number, Y: number, angleDeg: number): [number, number] {
  const { cos, sin } = axesTrig(angleDeg);
  const v = Y / sin;
  return [X - v * cos, v];
}

/** True in-plane distance from the section origin of oblique (h, v). */
export function inPlaneRadius(h: number, v: number, angleDeg: number): number {
  const { cos } = axesTrig(angleDeg);
  return Math.sqrt(Math.max(0, h * h + v * v + 2 * h * v * cos));
}

export type Segment = [number, number, number, number]; // X1, Y1, X2, Y2 (Å)

/**
 * Unit-cell lines over the square display window [-half, half]²: lines of
 * constant h at multiples of `latX` (running along the vertical axis, so
 * slanted by θ) and of constant v at multiples of `latY` (horizontal).  Each
 * segment spans the window's full height/width; the caller clips to the box.
 */
export function unitCellSegments(
  half: number,
  latX: number | null,
  latY: number | null,
  angleDeg: number,
): Segment[] {
  const { cos, sin } = axesTrig(angleDeg);
  const cot = cos / sin;
  const out: Segment[] = [];
  if (latX && latX > 0) {
    // h = k·latX crosses the window's Y range at X = k·latX + Y·cot θ.
    const reach = half + half * Math.abs(cot);
    for (let k = Math.ceil(-reach / latX); k <= Math.floor(reach / latX); k++) {
      const x0 = k * latX;
      out.push([x0 - half * cot, -half, x0 + half * cot, half]);
    }
  }
  if (latY && latY > 0) {
    // v = m·latY is the horizontal line Y = m·latY·sin θ.
    const step = latY * sin;
    for (let m = Math.ceil(-half / step); m <= Math.floor(half / step); m++) {
      out.push([-half, m * step, half, m * step]);
    }
  }
  return out;
}

/** "a=… b=… c=… Å", plus "· α=… β=… γ=…°" when the cell angles are known. */
export function latticeLabel(lat: Lattice): string {
  const len = `a=${lat.a?.toFixed(2)}  b=${lat.b?.toFixed(2)}  c=${lat.c?.toFixed(2)} Å`;
  const { alpha, beta, gamma } = lat;
  if (alpha == null || beta == null || gamma == null) return len;
  return `${len} · α=${alpha.toFixed(2)}  β=${beta.toFixed(2)}  γ=${gamma.toFixed(2)}°`;
}
