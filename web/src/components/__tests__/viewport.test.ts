// Pins the viewport math behind zoom / pan / box zoom and the sample lookup,
// including oblique (non-90°) real-space sections and r.l.u. → Å⁻¹ scaling.

import { describe, expect, it } from "vitest";

import {
  boxViewport,
  clampHalf,
  clampToBounds,
  displayToPixel,
  displayToSlice,
  extentBounds,
  fitViewport,
  hklGridSegments,
  niceStep,
  panBy,
  pixelToDisplay,
  sampleIndex,
  sliceToDisplay,
  viewExtent,
  viewportBounds,
  visibleBounds,
  wheelZoomFactor,
  zoomAbout,
} from "../viewport";

const ortho = { sx: 1, sy: 1, angle: 90 };
const free = (h: number) => h;

describe("display ↔ slice", () => {
  it("scales r.l.u. axes by 2π/a and inverts", () => {
    const g = { sx: (2 * Math.PI) / 10, sy: (2 * Math.PI) / 25, angle: 90 };
    const [X, Y] = sliceToDisplay(2, -3, g);
    expect(X).toBeCloseTo((2 * 2 * Math.PI) / 10);
    expect(Y).toBeCloseTo((-3 * 2 * Math.PI) / 25);
    const [x, y] = displayToSlice(X, Y, g);
    expect(x).toBeCloseTo(2);
    expect(y).toBeCloseTo(-3);
  });

  it("draws a 120° section at its true angle and inverts", () => {
    const g = { sx: 1, sy: 1, angle: 120 };
    const [X, Y] = sliceToDisplay(0, 4, g);
    expect(X).toBeCloseTo(-2);
    expect(Y).toBeCloseTo(4 * Math.sin((2 * Math.PI) / 3));
    const [h, v] = displayToSlice(X, Y, g);
    expect(h).toBeCloseTo(0);
    expect(v).toBeCloseTo(4);
  });
});

describe("fitViewport", () => {
  it("covers the whole slice, centred on its extent", () => {
    const v = fitViewport({ x_axis: [-12, 0, 12], y_axis: [-5, 0, 5] }, ortho);
    expect(v).toEqual({ cx: 0, cy: 0, half: 12 });
    const off = fitViewport({ x_axis: [0, 4], y_axis: [0, 2] }, ortho);
    expect(off).toEqual({ cx: 2, cy: 1, half: 2 });
  });
});

describe("zoom and pan", () => {
  const v = { cx: 0, cy: 0, half: 10 };

  it("keeps the point under the cursor fixed while zooming", () => {
    const z = zoomAbout(v, 4, -2, 0.5, free);
    expect(z.half).toBe(5);
    // (4, −2) sits at the same pixel before and after
    const before = displayToPixel(v, 4, -2, 200);
    const after = displayToPixel(z, 4, -2, 200);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
  });

  it("keeps the pixel under the pointer on its point in a wide view, at any limit", () => {
    const [w, h] = [640, 300];
    const px: [number, number] = [520, 70];
    const at = pixelToDisplay(v, px[0], px[1], w, h);
    for (const k of [0.5, 0.8, 1.6]) {
      const z = zoomAbout(v, at[0], at[1], k, (half) => Math.min(12, half)); // the out-zoom clamped
      const back = displayToPixel(z, at[0], at[1], w, h);
      expect(back[0]).toBeCloseTo(px[0], 9);
      expect(back[1]).toBeCloseTo(px[1], 9);
    }
  });

  it("zooms one wheel notch by 2×, whatever unit the device reports it in, and a pinch step smoothly", () => {
    expect(wheelZoomFactor(-100, 0, 400)).toBe(0.5); // a mouse notch in pixels (Chrome, Safari)
    expect(wheelZoomFactor(-3, 1, 400)).toBe(0.5); // the same notch in lines (Firefox)
    expect(wheelZoomFactor(100, 0, 400)).toBe(2);
    expect(wheelZoomFactor(1, 2, 400)).toBe(2); // a page
    // A trackpad's or a pinch's small steps zoom as they did: e^(Δ/100).
    expect(wheelZoomFactor(-4, 0, 400)).toBeCloseTo(Math.exp(-0.04), 12);
    expect(wheelZoomFactor(12, 0, 400)).toBeCloseTo(Math.exp(0.12), 12);
  });

  it("zooms a dragged box to a square around it", () => {
    const b = boxViewport([1, 1], [5, 3], free);
    expect(b).toEqual({ cx: 3, cy: 2, half: 2 });
  });

  it("pans opposite to the drag, Y up", () => {
    const p = panBy(v, 20, 20, 200); // drag right and down by 10 % of the view
    expect(p.cx).toBeCloseTo(-2);
    expect(p.cy).toBeCloseTo(2);
  });

  it("maps pixels to display points and back", () => {
    expect(pixelToDisplay(v, 0, 0, 200)).toEqual([-10, 10]);
    expect(pixelToDisplay(v, 100, 100, 200)).toEqual([0, 0]);
    const [px, py] = displayToPixel(v, -10, 10, 200);
    expect(px).toBeCloseTo(0);
    expect(py).toBeCloseTo(0);
  });

  it("spans the shorter side of a wide view and shows more along the longer one", () => {
    expect(viewExtent(v, 400, 200)).toEqual({ hx: 20, hy: 10 });
    expect(pixelToDisplay(v, 0, 0, 400, 200)).toEqual([-20, 10]);
    const [px, py] = displayToPixel(v, 20, -10, 400, 200);
    expect(px).toBeCloseTo(400);
    expect(py).toBeCloseTo(200);
    // a box twice as wide as tall fills a 2:1 view exactly
    expect(boxViewport([-4, -1], [4, 1], free, 400, 200).half).toBe(2);
    // a 20-px drag pans the same distance on either axis
    const p = panBy(v, 20, 20, 400, 200);
    expect(p.cx).toBeCloseTo(-2);
    expect(p.cy).toBeCloseTo(2);
  });

  it("keeps the view's centre on the data however far it is panned, and leaves a view on it as it is", () => {
    const b = extentBounds({ x_axis: [-4, 0, 4], y_axis: [-2, 2] }, ortho);
    expect(b).toEqual({ x0: -4, x1: 4, y0: -2, y1: 2 });
    const far = panBy({ cx: 0, cy: 0, half: 1 }, -100000, 100000, 200); // the data dragged far left and down
    expect(clampToBounds(far, b)).toEqual({ cx: 4, cy: 2, half: 1 }); // the centre stops at the data's right and top edges
    const on = { cx: 1, cy: -1, half: 0.5 };
    expect(clampToBounds(on, b)).toBe(on); // the same object: a zoom about a point on the data stays exact
    // An oblique section is held to its corners' box; the fit's square is the default.
    expect(extentBounds({ x_axis: [0, 4], y_axis: [0, 4] }, { sx: 1, sy: 1, angle: 120 }).x0).toBeCloseTo(-2);
    expect(viewportBounds({ cx: 1, cy: 2, half: 3 })).toEqual({ x0: -2, x1: 4, y0: -1, y1: 5 });
  });

  it("clamps the half-width between a few voxels and past the slice", () => {
    expect(clampHalf(1e-6, 10, 0.05)).toBeCloseTo(0.15);
    expect(clampHalf(100, 10, 0.05)).toBe(12.5);
    expect(clampHalf(4, 10, 0.05)).toBe(4);
  });
});

describe("sampleIndex", () => {
  const ax = { x_axis: [-2, -1, 0, 1, 2], y_axis: [0, 1, 2] };

  it("finds the nearest sample and returns null outside the slice", () => {
    expect(sampleIndex(ax, 0.4, 1.6, ortho)).toEqual([2, 2]);
    expect(sampleIndex(ax, -2.4, 0, ortho)).toEqual([0, 0]);
    expect(sampleIndex(ax, -2.6, 0, ortho)).toBeNull();
    expect(sampleIndex(ax, 0, 2.6, ortho)).toBeNull();
  });
});

describe("niceStep", () => {
  it("picks 1-2-5 steps", () => {
    expect(niceStep(10, 5)).toBe(2);
    expect(niceStep(24, 5)).toBe(5);
    expect(niceStep(0.6, 5)).toBeCloseTo(0.1);
  });
});

// The "Unit cells" switch on the r.l.u. views (Reciprocal cleanup, Q–R, the
// Bragg tiles): dashed lines at integer h, k, l that stay on the data.
describe("hklGridSegments", () => {
  const a = 4.2, b = 7.9;
  const recip = { sx: (2 * Math.PI) / a, sy: (2 * Math.PI) / b, angle: 90 };
  const isInt = (t: number) => Math.abs(t - Math.round(t)) < 1e-9;

  it("draws a line at every integer h and k the view shows, and none between", () => {
    const v = { cx: 2.7, cy: -1.1, half: 2.3 }; // Å⁻¹, off the origin
    const w = 300, h = 200;
    const box = visibleBounds(v, w, h);
    const segs = hklGridSegments(box, recip);
    const hs = segs.filter(([x1, , x2]) => x1 === x2).map(([X]) => displayToSlice(X, 0, recip)[0]);
    const ks = segs.filter(([, y1, , y2]) => y1 === y2).map(([, Y]) => displayToSlice(0, Y, recip)[1]);
    expect(hs.every(isInt)).toBe(true);
    expect(ks.every(isInt)).toBe(true);
    const [hLo, kLo] = displayToSlice(box.x0, box.y0, recip);
    const [hHi, kHi] = displayToSlice(box.x1, box.y1, recip);
    const ints = (lo: number, hi: number) => Array.from({ length: Math.floor(hi) - Math.ceil(lo) + 1 }, (_, i) => Math.ceil(lo) + i + 0);
    expect(hs.map((t) => Math.round(t) + 0)).toEqual(ints(hLo, hHi));
    expect(ks.map((t) => Math.round(t) + 0)).toEqual(ints(kLo, kHi));
  });

  it("keeps each line on its h while the view zooms and pans (pixel positions follow the viewport)", () => {
    const w = 240, h = 240;
    for (const v of [{ cx: 0, cy: 0, half: 4 }, { cx: 1.4, cy: 0.3, half: 0.9 }, { cx: -2.2, cy: 1.9, half: 0.35 }]) {
      for (const [X1, Y1, X2] of hklGridSegments(visibleBounds(v, w, h), recip).filter(([x1, , x2]) => x1 === x2)) {
        const hIdx = Math.round(displayToSlice(X1, Y1, recip)[0]);
        // the line's pixel column is where the canvas draws h = hIdx
        const [px] = displayToPixel(v, hIdx * recip.sx, 0, w, h);
        expect(displayToPixel(v, X2, 0, w, h)[0]).toBeCloseTo(px, 9);
        expect(px).toBeGreaterThanOrEqual(-1e-9);
        expect(px).toBeLessThanOrEqual(w + 1e-9);
      }
    }
  });

  it("draws one r.l.u. apart on an r.l.u. display about a peak far from the origin", () => {
    const g = { sx: 1, sy: 1, angle: 90 };
    const segs = hklGridSegments(visibleBounds({ cx: 7.02, cy: -3.01, half: 0.6 }, 100, 100), g);
    expect(segs.filter(([x1, , x2]) => x1 === x2).map(([X]) => X)).toEqual([7]);
    expect(segs.filter(([, y1, , y2]) => y1 === y2).map(([, Y]) => Y)).toEqual([-3]);
  });

  it("slants the lines of integer h at a non-right display angle, as the slice is drawn", () => {
    const g = { sx: 1.3, sy: 1.3, angle: 120 };
    const box = visibleBounds({ cx: 0.4, cy: 0.2, half: 3 }, 200, 200);
    const segs = hklGridSegments(box, g);
    expect(segs.length).toBeGreaterThan(4);
    for (const [X1, Y1, X2, Y2] of segs) {
      const [h1, k1] = displayToSlice(X1, Y1, g);
      const [h2, k2] = displayToSlice(X2, Y2, g);
      // each segment holds one integer index along its whole length
      if (Y1 === Y2) {
        expect(isInt(k1) && Math.abs(k1 - k2) < 1e-9).toBe(true);
      } else {
        expect(isInt(h1) && Math.abs(h1 - h2) < 1e-9).toBe(true);
      }
    }
  });

  it("draws nothing rather than a line per pixel when the view spans too many cells", () => {
    expect(hklGridSegments({ x0: -1e4, x1: 1e4, y0: -1, y1: 1 }, { sx: 1, sy: 1, angle: 90 }).every(([x1, , x2]) => x1 !== x2)).toBe(true);
  });
});
