// Renders a 2D slice to a canvas via a colormap LUT.  Colour/contrast/log are
// applied here client-side, so changing them re-renders instantly with no refetch.
//
// The canvas raster is the slice's native resolution (or the cropped window);
// CSS scales it for display.  Display modes:
//   • viewport — a square viewport {cx, cy, half} in display units (Å⁻¹ with
//     `reciprocalAxes`, else Å) that fills its parent.  Every display pixel is
//     mapped back to the slice grid (viewport.ts), so it pans and zooms anywhere
//     and draws an oblique section at its real angle.  Used by every viewer page.
//   • width  — fixed display width, height follows the data aspect ratio
//   • fit    — letterbox to fill the parent box (preserves aspect)
//   • windowA + size — a square real-space window [-windowA, +windowA]² in true
//     Å, drawn into a square `size` px box.  The section is drawn at its real
//     angle via the header's `axes_angle` (see oblique.ts); pixels outside the
//     data stay transparent
//   • windowX/windowY — crop each axis independently, still drawn into a square
//     box after row-resampling preserves equal physical units per pixel
//
// Colour mapping (colorScale.ts): sequential data maps [vmin, vmax] through the
// asinh / lin / log `scale`; `diverging` data maps symmetrically about 0 over ±vmax.

import { useEffect, useRef } from "react";

import type { Slice } from "../api/types";
import { makeScaler, type ScaleKind } from "./colorScale";
import { axesTrig } from "./oblique";
import { qContour, type Ellipse, type QSection } from "./reciprocal";
import { useViewSize } from "./viewSize";
import type { Viewport } from "./viewport";

interface Props {
  slice: Slice;
  lut: Uint8ClampedArray; // 256 * 4 RGBA
  vmax: number; // upper colour limit
  vmin?: number; // lower colour limit for sequential data (default 0)
  log: boolean; // legacy: the log scale when `scale` is not given
  scale?: ScaleKind;
  soft?: number; // asinh softening
  diverging?: boolean; // signed data centred at 0 (ΔPDF)
  viewport?: Viewport; // square viewport in display units; fills the parent
  width?: number; // fixed display width in CSS px
  fit?: boolean; // letterbox to fill the parent box (preserves aspect)
  contain?: boolean; // with `fit`: scale to fit *within* the box (both dims),
  //                    so a non-square slice is letterboxed instead of clipped
  //                    by the square parent — keeps mixed-aspect panels aligned
  windowA?: number; // half-extent in Å — crop to a square physical window
  windowX?: number; // half-extent along x in the slice's coordinate units
  windowY?: number; // half-extent along y in the slice's coordinate units
  zoom?: number; // ≥1 — crop symmetrically about the origin by this factor,
  //              keeping the slice's physical aspect (no square box).  Ignored
  //              when an explicit window* is given.
  size?: number; // square display size in px (used with windowA)
  bands?: [number, number]; // [min, max] band for circle overlays
  cutDistance?: number; // distance from origin for intersection
  reciprocalAxes?: boolean; // x/y/cut coordinates are r.l.u.; convert to Å^-1
  // With reciprocalAxes: the slice as a section of reciprocal space under the
  // cell's own metric, so |Q| bands are drawn as their true (elliptical, maybe
  // off-centre) contours rather than circles — see reciprocal.ts.
  qSection?: QSection | null;
  latX?: number;
  latY?: number;
  latCut?: number;
}

const MAX_RASTER = 900;

export function SliceCanvas({
  slice,
  lut,
  vmax,
  vmin = 0,
  log,
  scale,
  soft = 0,
  diverging = false,
  viewport,
  width = 340,
  fit = false,
  contain = false,
  windowA,
  windowX,
  windowY,
  zoom,
  size,
  bands,
  cutDistance,
  reciprocalAxes = false,
  qSection,
  latX,
  latY,
  latCut,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const view = useViewSize(); // the ViewFrame's pixel size (viewport mode)
  const { nx, ny, x_axis: xs, y_axis: ys } = slice.header;
  const scaleKind: ScaleKind = scale ?? (log ? "log" : "lin");

  let ix0 = 0;
  let ix1 = nx - 1;
  let iy0 = 0;
  let iy1 = ny - 1;
  // Explicit windows drive the square ΔPDF display path below; `zoom` only crops
  // (symmetrically about the origin) and leaves the physical aspect untouched, so
  // it derives a crop window but is excluded from `xWindow`/`yWindow`.
  const xWindow = viewport ? undefined : (windowX ?? windowA);
  const yWindow = viewport ? undefined : (windowY ?? windowA);
  const zoomFactor = !viewport && zoom != null && zoom > 1 ? zoom : 1;
  const xFull = Math.max(Math.abs(xs[0]), Math.abs(xs[nx - 1]));
  const yFull = Math.max(Math.abs(ys[0]), Math.abs(ys[ny - 1]));
  const xCrop = xWindow ?? (zoomFactor > 1 ? xFull / zoomFactor : null);
  const yCrop = yWindow ?? (zoomFactor > 1 ? yFull / zoomFactor : null);
  if (xCrop != null) {
    while (ix0 < ix1 && xs[ix0] < -xCrop) ix0++;
    while (ix1 > ix0 && xs[ix1] > xCrop) ix1--;
  }
  if (yCrop != null) {
    while (iy0 < iy1 && ys[iy0] < -yCrop) iy0++;
    while (iy1 > iy0 && ys[iy1] > yCrop) iy1--;
  }
  const cw = ix1 - ix0 + 1;
  const ch_raw = iy1 - iy0 + 1;

  const dx = nx > 1 ? (xs[nx - 1] - xs[0]) / (nx - 1) : 1;
  const dy = ny > 1 ? (ys[ny - 1] - ys[0]) / (ny - 1) : 1;
  const qScaleX = reciprocalAxes && latX ? 2 * Math.PI / latX : 1;
  const qScaleY = reciprocalAxes && latY ? 2 * Math.PI / latY : 1;
  const dx_Q = dx * qScaleX;
  const dy_Q = dy * qScaleY;
  const qScaleCut = reciprocalAxes && latCut ? 2 * Math.PI / latCut : 1;
  const ch = Math.max(1, Math.round(ch_raw * Math.abs(dy_Q / dx_Q)));

  // Square real-space window: an N×N raster over [-windowA, windowA]² (true Å),
  // one display pixel per native x step.
  const oblique = !viewport && windowA != null;
  const axesAngle = slice.header.axes_angle ?? 90;
  const obliqueN = oblique ? Math.max(2, Math.round((2 * windowA) / Math.abs(dx))) : 0;
  // Viewport: about one raster pixel per native sample across the shorter side;
  // the longer side of a wide or tall view shows more of the slice.
  const vpN = viewport
    ? Math.max(64, Math.min(MAX_RASTER, Math.round((2 * viewport.half) / Math.abs(dx_Q))))
    : 0;
  const aspect = viewport && view.w > 0 && view.h > 0 ? view.w / view.h : 1;
  const vpW = aspect >= 1 ? Math.min(2 * MAX_RASTER, Math.round(vpN * aspect)) : vpN;
  const vpH = aspect >= 1 ? vpN : Math.min(2 * MAX_RASTER, Math.round(vpN / aspect));
  const canvasW = viewport ? vpW : oblique ? obliqueN : cw;
  const canvasH = viewport ? vpH : oblique ? obliqueN : ch;
  const vpCx = viewport?.cx ?? 0;
  const vpCy = viewport?.cy ?? 0;
  const vpHalf = viewport?.half ?? 0;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = canvasW;
    canvas.height = canvasH;
    const img = ctx.createImageData(canvasW, canvasH);
    const out = img.data;
    const data = slice.data;
    const t = makeScaler({ lo: vmin, hi: vmax > 0 ? vmax : 1 }, scaleKind, soft, diverging);

    const paint = (v: number, o: number) => {
      if (!Number.isFinite(v)) {
        out[o] = 128;
        out[o + 1] = 128;
        out[o + 2] = 128;
        out[o + 3] = 255;
        return;
      }
      const li = (t(v) * 255) | 0;
      out[o] = lut[li * 4];
      out[o + 1] = lut[li * 4 + 1];
      out[o + 2] = lut[li * 4 + 2];
      out[o + 3] = 255;
    };

    if (vpN) {
      // Display pixel (X, Y) → slice (x, y) → nearest native sample; pixels
      // outside the data stay transparent so the view background shows.
      const px = (2 * vpHalf) / Math.min(vpW, vpH);
      const { cos, sin } = axesTrig(axesAngle);
      for (let rr = 0; rr < vpH; rr++) {
        const v = (vpCy + (vpH / 2 - (rr + 0.5)) * px) / sin; // along the vertical axis (display units)
        const iy = Math.round((v / qScaleY - ys[0]) / dy);
        if (iy < 0 || iy >= ny) continue;
        const hShift = v * cos;
        const row = iy * nx;
        for (let cc = 0; cc < vpW; cc++) {
          const h = vpCx + (cc + 0.5 - vpW / 2) * px - hShift;
          const ix = Math.round((h / qScaleX - xs[0]) / dx);
          if (ix < 0 || ix >= nx) continue;
          paint(data[row + ix], (rr * vpW + cc) * 4);
        }
      }
    } else if (oblique) {
      // Display pixel (X, Y) → oblique (h, v) → nearest native grid point.
      const half = windowA;
      const px = (2 * half) / obliqueN;
      const { cos, sin } = axesTrig(axesAngle);
      for (let rr = 0; rr < obliqueN; rr++) {
        const v = (half - (rr + 0.5) * px) / sin;
        const iy = Math.round((v - ys[0]) / dy);
        if (iy < 0 || iy >= ny) continue; // outside the data: transparent
        const hShift = v * cos;
        for (let cc = 0; cc < obliqueN; cc++) {
          const ix = Math.round((-half + (cc + 0.5) * px - hShift - xs[0]) / dx);
          if (ix < 0 || ix >= nx) continue;
          paint(data[iy * nx + ix], (rr * obliqueN + cc) * 4);
        }
      }
    } else {
      for (let rr = 0; rr < ch; rr++) {
        // nearest-neighbor scale rows to match physical aspect ratio
        const srcRow = (iy1 - Math.floor(rr * (ch_raw / ch))) * nx;
        const dstRow = rr * cw;
        for (let cc = 0; cc < cw; cc++) {
          paint(data[srcRow + ix0 + cc], (dstRow + cc) * 4);
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [slice, lut, vmax, vmin, scaleKind, soft, diverging, nx, ny, xCrop, yCrop, cw, ch, ch_raw, ix0, ix1, iy0, iy1, xs, ys,
      oblique, obliqueN, axesAngle, windowA, dx, dy, canvasW, canvasH, vpN, vpW, vpH, vpCx, vpCy, vpHalf, qScaleX, qScaleY]);

  // A windowed crop is always shown as a physical square: either at a fixed
  // `size` (single ΔPDF viewer) or filling its square parent cell (multi-temp
  // grid / Q-equal previews).
  let wrapperStyle: React.CSSProperties;
  if (viewport) {
    wrapperStyle = { position: "absolute", inset: 0 };
  } else if (xWindow != null || yWindow != null) {
    wrapperStyle =
      size != null
        ? { width: size, height: size, position: "relative" }
        : { width: "100%", aspectRatio: "1 / 1", display: "block", position: "relative" };
  } else if (fit && contain) {
    // Letterbox: scale to fit *within* the (square) parent box on both axes so a
    // non-square slice is never clipped — keeps mixed-aspect panels aligned.  A
    // tall slice (pixel aspect < 1) is given a <100% width and the aspect-ratio
    // derives its height; width percentages resolve against the box's definite
    // width (unlike max-height, which can't see the aspect-derived box height).
    // The wrapper tracks the rendered canvas, so the band-circle overlay aligns.
    const ar = cw / ch; // displayed pixel aspect: >1 wide, <1 tall
    wrapperStyle = {
      width: ar >= 1 ? "100%" : `${ar * 100}%`,
      aspectRatio: `${cw} / ${ch}`,
      maxWidth: "100%",
      maxHeight: "100%",
      margin: "0 auto",
      position: "relative",
      display: "block",
    };
  } else if (fit) {
    // Fill the parent's width and let the height follow the slice's physical
    // aspect (the parent box clips any vertical overflow).  Scales both up and
    // down, so a zoom-cropped slice still fills the panel instead of shrinking
    // to its (now small) intrinsic pixel size.
    wrapperStyle = { width: "100%", height: "auto", position: "relative", display: "block" };
  } else {
    wrapperStyle = { width, height: "auto", position: "relative", display: "inline-block" };
  }

  // Overlay frame: the viewport, the data crop, or the true-Å window.
  const vpHx = viewport ? (vpHalf * vpW) / Math.min(vpW, vpH) : 0;
  const vpHy = viewport ? (vpHalf * vpH) / Math.min(vpW, vpH) : 0;
  const vX = viewport ? vpCx - vpHx : oblique ? -windowA : (xs[ix0] - dx / 2) * qScaleX;
  const vW = viewport ? 2 * vpHx : oblique ? 2 * windowA : cw * dx_Q;
  const vH = viewport ? 2 * vpHy : oblique ? 2 * windowA : ch_raw * dy_Q;
  const vTop = viewport ? -(vpCy + vpHy) : oblique ? -windowA : -((ys[iy1] + Math.abs(dy) / 2) * qScaleY);
  const stroke = Math.min(vW, Math.abs(vH));
  const angled = viewport ? !reciprocalAxes : oblique;

  // Band circles: |r| = R cuts this section in a circle of radius √(R² − d²)
  // about the point nearest the origin (d = the plane's distance from it).  A
  // reciprocal slice drawn on r.l.u. axes is not metric-true for a
  // non-orthogonal cell, so with a `qSection` |Q| = R is drawn as its contour.
  const [circleX, circleY] = angled ? (slice.header.r_center ?? [0, 0]) : [0, 0];
  const circles: number[] = [];
  const contours: Ellipse[] = [];
  if (bands && reciprocalAxes && qSection) {
    for (const R of bands) {
      const e = R > 0 ? qContour(qSection, R) : null;
      if (e) contours.push(e);
    }
  } else if (bands && cutDistance != null) {
    const [bMin, bMax] = bands;
    const cutPhys = angled && slice.header.r_perp != null
      ? slice.header.r_perp
      : cutDistance * qScaleCut;
    const cutSq = cutPhys * cutPhys;

    if (bMin > 0) {
      const rSq1 = bMin * bMin - cutSq;
      if (rSq1 > 0) circles.push(Math.sqrt(rSq1));
    }
    if (bMax > 0) {
      const rSq2 = bMax * bMax - cutSq;
      if (rSq2 > 0) circles.push(Math.sqrt(rSq2));
    }
  }

  return (
    <div style={wrapperStyle}>
      <canvas
        ref={ref}
        className="slice-canvas"
        style={{ width: "100%", height: fit && !contain && !viewport ? "auto" : "100%", display: "block", imageRendering: "auto" }}
      />
      {(circles.length > 0 || contours.length > 0) && (
        <svg
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}
          viewBox={`${vX} ${vTop} ${vW} ${Math.abs(vH)}`}
          preserveAspectRatio="none"
        >
          <g transform="scale(1, -1)">
            {circles.map((r, i) => (
              <g key={i}>
                <circle
                  cx={circleX}
                  cy={circleY}
                  r={r}
                  fill="none"
                  stroke="rgba(0, 0, 0, 0.8)"
                  strokeWidth={stroke / 100}
                />
                <circle
                  cx={circleX}
                  cy={circleY}
                  r={r}
                  fill="none"
                  stroke="rgba(255, 255, 255, 0.9)"
                  strokeWidth={stroke / 150}
                />
              </g>
            ))}
            {contours.map((e, i) => {
              const rot = `rotate(${e.angle} ${e.cx} ${e.cy})`;
              return (
                <g key={`e${i}`} transform={rot}>
                  <ellipse cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} fill="none" stroke="rgba(0, 0, 0, 0.8)" strokeWidth={stroke / 100} />
                  <ellipse cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} fill="none" stroke="rgba(255, 255, 255, 0.9)" strokeWidth={stroke / 150} />
                </g>
              );
            })}
          </g>
        </svg>
      )}
    </div>
  );
}
