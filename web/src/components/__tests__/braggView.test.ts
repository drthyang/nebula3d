// The Bragg-profile tiles as one linked view (THY-38): the fit window, the zoom
// limits, how one tile's zoom or pan moves the other two, and — the
// scientific requirement — that the fit ellipses stay registered to the data
// they are drawn over at any zoom and pan.

import { describe, expect, it } from "vitest";

import type { BraggPeakWidth } from "../../api/types";
import {
  absoluteLevels,
  BRAGG_AUTO_PERCENTILE,
  cursorFromTile,
  ellipseInView,
  FIT_WINDOW_SAMPLES,
  fitWindowSamples,
  nearestIndex,
  relativeLevels,
  fittedEllipse,
  linkFromTile,
  PEAK_ZOOM_OUT,
  peakColourHalf,
  peakFitHalf,
  peakHalfLimit,
  tileBounds,
  tileCursor,
  tileViewport,
  type Hkl,
  type TileAxes,
} from "../braggView";
import { autoLevels } from "../colorScale";
import { pixelToDisplay, zoomAbout, panBy, type Viewport } from "../viewport";

const AB: TileAxes = { xa: 0, ya: 1 };
const AC: TileAxes = { xa: 0, ya: 2 };
const BC: TileAxes = { xa: 1, ya: 2 };

function peak(over: Partial<BraggPeakWidth> = {}): BraggPeakWidth {
  return {
    index: 0,
    source_node_hkl: null,
    center_hkl: [2, -1, 3],
    q_abs: 3,
    intensity: 100,
    local_background: 1,
    width_hkl: [0.03, 0.05, 0.04],
    width_q: [0.04, 0.05, 0.06],
    principal_directions_hkl: [],
    fit_kind: "moment",
    ...over,
  };
}

describe("the fit window", () => {
  it("opens at 8× the widest fitted width, clamped to 0.25–1.2 r.l.u.", () => {
    expect(peakFitHalf([0.03, 0.05, 0.04])).toBeCloseTo(0.4, 12);
    expect(peakFitHalf([0.001, 0.002, 0.003])).toBeCloseTo(0.25, 12); // 0.02 floor × 8 = 0.16 → 0.25
    expect(peakFitHalf([0.5, 0.1, 0.1])).toBe(1.2);
    expect(peakFitHalf([-0.05, 0.01, 0.01])).toBeCloseTo(0.4, 12);
    expect(peakFitHalf([NaN, 0.04, 0.01])).toBeCloseTo(0.32, 12);
  });

  it("samples the colour range in the tighter window about the peak: 3.5×, 0.08–0.6", () => {
    expect(peakColourHalf([0.03, 0.05, 0.04])).toBeCloseTo(0.175, 12);
    expect(peakColourHalf([0.001, 0.002, 0.003])).toBeCloseTo(0.08, 12);
    expect(peakColourHalf([0.5, 0.1, 0.1])).toBe(0.6);
    for (const w of [[0.03, 0.05, 0.04], [0.001, 0.002, 0.003], [0.5, 0.1, 0.1]]) expect(peakColourHalf(w)).toBeLessThan(peakFitHalf(w));
  });

  it("zooms out at least as far as the old slider's ×0.1, and in at least as far as its ×4", () => {
    const fit = 0.2;
    const lim = peakHalfLimit(fit, 0.01);
    expect(lim(1e9)).toBeCloseTo(fit * PEAK_ZOOM_OUT, 12);
    expect(PEAK_ZOOM_OUT).toBeGreaterThanOrEqual(1 / Math.pow(2, -3.3)); // the slider's last stop
    expect(lim(0)).toBeLessThanOrEqual(fit / 8);
    expect(lim(0)).toBeGreaterThanOrEqual(2 * 0.01); // not below two voxels when that is closer than ×4
    // a coarse grid still zooms in to an eighth of the fit window
    expect(peakHalfLimit(fit, 1)(0)).toBeCloseTo(fit / 8, 12);
    expect(lim(fit)).toBe(fit);
  });
});

describe("one linked view for the three tiles", () => {
  const c: Hkl = [2, -1, 3];

  it("opens every tile on the peak at the fit window", () => {
    for (const t of [AB, AC, BC]) {
      const v = tileViewport(c, [0, 0, 0], 0.2, t);
      expect([v.cx, v.cy, v.half]).toEqual([c[t.xa], c[t.ya], 0.2]);
    }
  });

  it("zooms all three by the same factor when one zooms", () => {
    const off: Hkl = [0, 0, 0];
    const v = zoomAbout(tileViewport(c, off, 0.2, AB), 2.05, -0.97, 0.5, (h) => h);
    const next = linkFromTile(c, off, AB, v);
    for (const t of [AB, AC, BC]) expect(tileViewport(c, next.offset, next.half, t).half).toBeCloseTo(0.1, 12);
  });

  it("moves the other tiles through the same hkl point when one pans", () => {
    const off: Hkl = [0, 0, 0.02];
    const v = panBy(tileViewport(c, off, 0.2, AB), -40, 25, 200, 200); // pans in H and K
    const { offset, half } = linkFromTile(c, off, AB, v);
    const ab = tileViewport(c, offset, half, AB);
    const ac = tileViewport(c, offset, half, AC);
    const bc = tileViewport(c, offset, half, BC);
    expect(ac.cx).toBeCloseTo(ab.cx, 12); // H shared by a*·b* and a*·c*
    expect(bc.cx).toBeCloseTo(ab.cy, 12); // K shared by a*·b* and b*·c*
    expect(offset[2]).toBe(0.02); // L untouched by a pan on the a*·b* tile
    expect(ac.cy).toBeCloseTo(c[2] + 0.02, 12);
    expect(bc.cy).toBeCloseTo(ac.cy, 12);
  });

  it("round-trips a tile's viewport", () => {
    const off: Hkl = [0.01, -0.03, 0.05];
    for (const t of [AB, AC, BC]) {
      const v = tileViewport(c, off, 0.3, t);
      const r = linkFromTile(c, off, t, v);
      expect(r.offset[0]).toBeCloseTo(off[0], 12);
      expect(r.offset[1]).toBeCloseTo(off[1], 12);
      expect(r.offset[2]).toBeCloseTo(off[2], 12);
      expect(r.half).toBe(0.3);
    }
  });

  it("shares the crosshair as one hkl point, the hovered tile's plane through the peak", () => {
    const q = cursorFromTile(c, AC, [2.1, 3.05]);
    expect(q).toEqual([2.1, -1, 3.05]);
    expect(tileCursor(q, AB)).toEqual([2.1, -1]);
    expect(tileCursor(q, BC)).toEqual([-1, 3.05]);
  });

  it("keeps each tile's centre on the volume's ranges", () => {
    const ranges = [[-6, 6], [4, -4], [-8, 8]] as const;
    expect(tileBounds(ranges, BC)).toEqual({ x0: -4, x1: 4, y0: -8, y1: 8 });
  });
});

// The ellipse an SVG <ellipse rx ry transform=rotate(angle cx cy)> draws, as
// view pixels, for parameter t.
function svgEllipsePoint(p: { cx: number; cy: number; rx: number; ry: number; angle: number }, t: number): [number, number] {
  const a = (p.angle * Math.PI) / 180;
  const x = p.rx * Math.cos(t), y = p.ry * Math.sin(t);
  return [p.cx + x * Math.cos(a) - y * Math.sin(a), p.cy + x * Math.sin(a) + y * Math.cos(a)];
}

describe("the fit ellipses stay registered to the data", () => {
  // A tilted ellipsoid: principal directions in hkl and their widths (r.l.u.).
  const s = Math.SQRT1_2;
  const tilted = peak({
    principal_directions_hkl: [
      [s, s, 0],
      [-s, s, 0],
      [0, 0, 1],
    ],
    principal_width_hkl: [0.06, 0.02, 0.03],
  });
  // The cross-section the ellipse must trace on the a*·b* plane: the precision
  // matrix's in-plane block, x·M·x = 1 with x in r.l.u. (y up).
  function precisionBlock(p: BraggPeakWidth, ix: number, iy: number) {
    let a = 0, b = 0, c = 0;
    p.principal_directions_hkl.forEach((d, i) => {
      const inv = 1 / p.principal_width_hkl![i] ** 2;
      a += inv * d[ix] * d[ix];
      b += inv * d[ix] * d[iy];
      c += inv * d[iy] * d[iy];
    });
    return { a, b, c };
  }
  const views: [Viewport, number, number][] = [
    [{ cx: 2, cy: -1, half: 0.2 }, 180, 180], // fit, square
    [{ cx: 2.03, cy: -0.98, half: 0.05 }, 180, 180], // zoomed in and panned
    [{ cx: 1.7, cy: -1.4, half: 1.9 }, 180, 180], // zoomed out ×0.1, off centre
    [{ cx: 2.01, cy: -1.02, half: 0.11 }, 260, 150], // a wide view
  ];

  it("traces the tilted fitted cross-section at every zoom and pan", () => {
    const e = fittedEllipse(tilted, 0, 1);
    const { a, b, c } = precisionBlock(tilted, 0, 1);
    for (const [v, w, h] of views) {
      const p = ellipseInView(e, [2, -1], v, w, h);
      for (let k = 0; k < 16; k++) {
        const [px, py] = svgEllipsePoint(p, (k / 16) * 2 * Math.PI);
        // the r.l.u. point the raster draws under that pixel
        const [X, Y] = pixelToDisplay(v, px, py, w, h);
        const dx = X - 2, dy = Y + 1;
        expect(a * dx * dx + 2 * b * dx * dy + c * dy * dy).toBeCloseTo(1, 9);
      }
    }
  });

  it("puts an axis-aligned ellipse's ends at centre ± its widths in r.l.u.", () => {
    const e = { rx: 0.04, ry: 0.025 };
    for (const [v, w, h] of views) {
      const p = ellipseInView(e, [2, -1], v, w, h);
      const right = pixelToDisplay(v, p.cx + p.rx, p.cy, w, h);
      const top = pixelToDisplay(v, p.cx, p.cy - p.ry, w, h);
      expect(right[0]).toBeCloseTo(2.04, 12);
      expect(right[1]).toBeCloseTo(-1, 12);
      expect(top[0]).toBeCloseTo(2, 12);
      expect(top[1]).toBeCloseTo(-0.975, 12);
    }
  });

  it("centres the ellipses on the peak's own pixel, wherever the view is", () => {
    for (const [v, w, h] of views) {
      const p = ellipseInView({ rx: 0.01, ry: 0.01 }, [2, -1], v, w, h);
      const [X, Y] = pixelToDisplay(v, p.cx, p.cy, w, h);
      expect(X).toBeCloseTo(2, 12);
      expect(Y).toBeCloseTo(-1, 12);
    }
  });

  it("falls back to the fitted widths when the principal axes are missing", () => {
    expect(fittedEllipse(peak(), 0, 2)).toEqual({ rx: 0.03, ry: 0.04 });
  });
});

describe("the tiles' one colour scale", () => {
  // A synthetic slice: a Gaussian peak on a flat background over ±1 r.l.u.
  const n = 81, step = 0.025;
  const axis = Array.from({ length: n }, (_, i) => -1 + i * step);
  const data = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = axis[i] - 0.1, y = axis[j] + 0.05;
    data[j * n + i] = 0.5 + 100 * Math.exp(-(x * x + y * y) / (2 * 0.04 ** 2));
  }
  const slice = { header: { nx: n, x_axis: axis, y_axis: axis }, data };

  it("samples the fit window about the peak, and none of it outside the data", () => {
    const s = fitWindowSamples(slice, 0.1, -0.05, 0.2);
    expect(s.length).toBe(FIT_WINDOW_SAMPLES * FIT_WINDOW_SAMPLES);
    expect(Math.max(...s)).toBeCloseTo(100.5, 0);
    // a window half off the data keeps only the samples on it
    const edge = fitWindowSamples(slice, 1, 0, 0.2);
    expect(edge.length).toBeLessThan(FIT_WINDOW_SAMPLES * FIT_WINDOW_SAMPLES * 0.55);
    expect(edge.length).toBeGreaterThan(0);
  });

  it("puts Auto's vmax where each tile's own limit was: the 99th percentile of the window's positive values", () => {
    const s = fitWindowSamples(slice, 0.1, -0.05, 0.2);
    const pos = Array.from(s).filter((v) => v > 0).sort((a, b) => a - b);
    const oldRule = pos[Math.min(pos.length - 1, Math.floor(pos.length * 0.99))];
    expect(autoLevels([s], { percentile: BRAGG_AUTO_PERCENTILE }).hi).toBe(oldRule);
  });

  it("keeps the limits relative to Auto, so Brightness carries from peak to peak", () => {
    const autoA = 80, autoB = 8; // a strong and a weak peak
    const brighter = { lo: 0, hi: autoA / 2 }; // one stop brighter on peak A
    const rel = relativeLevels(brighter, autoA);
    const onB = absoluteLevels(rel, autoB);
    expect(onB.hi).toBeCloseTo(autoB / 2, 12); // still one stop brighter on B
    expect(onB.lo).toBe(0);
    expect(absoluteLevels(relativeLevels({ lo: 3, hi: 50 }, autoA), autoA)).toEqual({ lo: 3, hi: 50 });
  });

  it("finds the nearest sample on ascending and descending axes, and none outside", () => {
    expect(nearestIndex([0, 1, 2, 3], 1.4)).toBe(1);
    expect(nearestIndex([3, 2, 1, 0], 1.4)).toBe(2);
    expect(nearestIndex([0, 1, 2, 3], 3.01)).toBe(-1);
    expect(nearestIndex([0, 1, 2, 3], -0.01)).toBe(-1);
  });
});
