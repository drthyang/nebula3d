// Pins where a marked region meets the slice views (regionMark.ts): the
// refusals of an empty region or one outside the volume, the clipping to the
// volume, the section by a one-voxel slab, its outline on r.l.u. and oblique
// sections, its registration with the view while it is zoomed and panned,
// and the cut and zoom that bring it into view.

import { describe, expect, it } from "vitest";

import {
  clipRegion,
  cutIndexFor,
  frameTarget,
  gridStep,
  gridValue,
  MARGIN,
  MIN_VIEW_SHARE,
  regionProblem,
  sectionBounds,
  sectionDisplay,
  sectionOf,
  snapIndex,
  toPixels,
  type MarkRegion,
  type Section,
  type VolumeGrid,
} from "../regionMark";
import { displayToPixel, displayToSlice, panBy, sliceToDisplay, zoomAbout } from "../viewport";

// A reciprocal grid: H, K from −4 to 4 in 0.02 steps, L from −2 to 2 in 0.05.
const HKL: VolumeGrid = { ranges: [[-4, 4], [-4, 4], [-2, 2]], shape: [401, 401, 81], names: ["H", "K", "L"], unit: "r.l.u." };
// A ΔPDF grid: ±20 Å in 0.5 Å steps.
const XYZ: VolumeGrid = { ranges: [[-20, 20], [-20, 20], [-20, 20]], shape: [81, 81, 81], names: ["x", "y", "z"], unit: "Å" };

const box = (center: [number, number, number], half: [number, number, number]): MarkRegion => ({ shape: "box", center, half });
const ellipsoid = (center: [number, number, number], half: [number, number, number]): MarkRegion => ({ shape: "ellipsoid", center, half });
const free = (h: number) => h;

describe("the grid", () => {
  it("snaps a value to the nearest sample, as the pages snap a cut", () => {
    expect(gridStep(HKL, 2)).toBeCloseTo(0.05);
    expect(snapIndex(HKL, 2, 0.5)).toBe(50);
    expect(gridValue(HKL, 2, 50)).toBeCloseTo(0.5);
    expect(snapIndex(HKL, 2, 0.51)).toBe(50);
    expect(snapIndex(HKL, 2, 0.53)).toBe(51);
    expect(snapIndex(HKL, 2, 99)).toBe(80);
    expect(snapIndex(HKL, 2, -99)).toBe(0);
  });
});

describe("regionProblem: an empty region is refused, with why", () => {
  it("refuses a box or an ellipsoid with a half-width of 0 or less", () => {
    expect(regionProblem(box([0, 0, 0], [0.1, 0, 0.1]))).toMatch(/box is empty.*above 0/);
    expect(regionProblem(ellipsoid([0, 0, 0], [0.1, 0.1, -1]))).toMatch(/ellipsoid is empty/);
    expect(regionProblem(box([0, 0, 0], [0.1, 0.1, 0.1]))).toBeNull();
  });

  it("refuses coordinates that are not three finite numbers", () => {
    expect(regionProblem(box([0, Number.NaN, 0], [1, 1, 1]))).toMatch(/centre/);
    expect(regionProblem({ shape: "box", center: [0, 0] as unknown as [number, number, number], half: [1, 1, 1] })).toMatch(/centre/);
    expect(regionProblem({ shape: "points", points: [[1, 2, Infinity]] })).toMatch(/three finite/);
  });

  it("refuses a points mark with no point or too many", () => {
    expect(regionProblem({ shape: "points", points: [] })).toMatch(/at least one point/);
    const many = Array.from({ length: 13 }, (_, i) => [i / 10, 0, 0] as [number, number, number]);
    expect(regionProblem({ shape: "points", points: many })).toMatch(/at most 12/);
  });
});

describe("clipRegion: what the volume holds of a region", () => {
  it("keeps a box inside the volume as it is", () => {
    const r = clipRegion(box([1, 0, 0.5], [0.1, 0.1, 0.1]), HKL);
    expect(r).toEqual({ ok: true, region: box([1, 0, 0.5], [0.1, 0.1, 0.1]), clipped: [] });
  });

  it("cuts a box to the voxels' extent (half a step past the last sample) and says so", () => {
    const r = clipRegion(box([3.9, 0, 0], [0.3, 0.1, 0.1]), HKL);
    expect(r.ok).toBe(true);
    if (!r.ok || r.region.shape === "points") return;
    // The voxels reach 4 + 0.01.
    expect(r.region.center[0] - r.region.half[0]).toBeCloseTo(3.6);
    expect(r.region.center[0] + r.region.half[0]).toBeCloseTo(4.01);
    expect(r.clipped).toEqual(["H 3.6 to 4.2 cut to 3.6 to 4.01 r.l.u."]);
  });

  it("refuses a box outside the volume, saying where the volume ends", () => {
    const r = clipRegion(box([0, 0, 3], [0.2, 0.2, 0.5]), HKL);
    expect(r).toEqual({
      ok: false,
      reason: "the box (L 2.5 to 3.5) is outside the volume: the volume spans H -4 to 4 r.l.u., K -4 to 4 r.l.u., L -2 to 2 r.l.u.",
    });
  });

  it("leaves out the points outside the volume, and refuses when none is inside", () => {
    const r = clipRegion({ shape: "points", points: [[1.25, 0, 0], [0.75, 0, 0], [5, 0, 0]] }, HKL);
    expect(r).toEqual({
      ok: true,
      region: { shape: "points", points: [[1.25, 0, 0], [0.75, 0, 0]] },
      clipped: ["1 of 3 points are outside the volume and were left out"],
    });
    const none = clipRegion({ shape: "points", points: [[5, 0, 0]] }, HKL);
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.reason).toMatch(/^no point is inside the volume: the volume spans H -4 to 4/);
  });

  it("keeps an ellipsoid that meets the volume whole, noting where it reaches past it", () => {
    const r = clipRegion(ellipsoid([3.9, 0, 0], [0.3, 0.1, 0.1]), HKL);
    expect(r).toEqual({ ok: true, region: ellipsoid([3.9, 0, 0], [0.3, 0.1, 0.1]), clipped: ["the ellipsoid reaches past the volume along H; it is drawn only inside it"] });
  });

  it("refuses an ellipsoid whose bounding box touches the volume's corner but which misses it", () => {
    // Its box overlaps the corner (4.01, 4.01), but the corner is outside the
    // ellipsoid: (0.29/0.3)² + (0.29/0.3)² > 1.
    const r = clipRegion(ellipsoid([4.3, 4.3, 0], [0.3, 0.3, 0.3]), HKL);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^the ellipsoid is outside the volume/);
  });

  it("words a ΔPDF region in Å along a, b, c", () => {
    const r = clipRegion(box([0, 0, 25], [1, 1, 2]), XYZ);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("the box (z 23 to 27) is outside the volume: the volume spans x -20 to 20 Å, y -20 to 20 Å, z -20 to 20 Å");
  });

  it("refuses an empty region before it looks at the volume", () => {
    const r = clipRegion(box([0, 0, 0], [0, 0, 0]), HKL);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/empty/);
  });
});

describe("sectionOf: where a region meets a slice's one-voxel slab", () => {
  const hk0 = { u: 0 as const, v: 1 as const, cut: 2 as const };

  it("gives a box's in-plane rectangle on every slab it reaches", () => {
    const b = box([1, 0.5, 0.5], [0.2, 0.1, 0.1]);
    expect(sectionOf(b, hk0, 0.5, 0.025)).toEqual({ kind: "rect", u: [0.8, 1.2], v: [0.4, 0.6] });
    // Its face at L = 0.6 lies in the slab of the cut at L = 0.62 (0.6 ≥ 0.62 − 0.025).
    expect(sectionOf(b, hk0, 0.62, 0.025)).not.toBeNull();
    expect(sectionOf(b, hk0, 0.65, 0.025)).toBeNull();
  });

  it("shows a box thinner than a voxel on the slab that holds it", () => {
    const thin = box([0, 0, 0.51], [0.5, 0.5, 0.001]);
    expect(sectionOf(thin, hk0, 0.5, 0.025)).not.toBeNull();
    expect(sectionOf(thin, hk0, 0.45, 0.025)).toBeNull();
  });

  it("gives an ellipsoid's ellipse at the slab's point nearest its centre", () => {
    const e = ellipsoid([0, 0, 0], [0.4, 0.2, 0.1]);
    expect(sectionOf(e, hk0, 0, 0.025)).toEqual({ kind: "ellipse", cu: 0, cv: 0, au: 0.4, av: 0.2 });
    // At L = 0.085 the slab's nearest point is 0.06 from the centre: s = √(1 − 0.6²) = 0.8.
    const s = sectionOf(e, hk0, 0.085, 0.025) as Extract<Section, { kind: "ellipse" }>;
    expect(s.au).toBeCloseTo(0.32, 12);
    expect(s.av).toBeCloseTo(0.16, 12);
    expect(sectionOf(e, hk0, 0.125, 0.025)).toBeNull();
  });

  it("keeps the points that lie in the slab", () => {
    const pts: MarkRegion = { shape: "points", points: [[1.25, 0, 0], [0.75, 0, 0], [1, 0, 0.5]] };
    expect(sectionOf(pts, hk0, 0, 0.025)).toEqual({ kind: "points", pts: [[1.25, 0], [0.75, 0]] });
    expect(sectionOf(pts, hk0, 0.5, 0.025)).toEqual({ kind: "points", pts: [[1, 0]] });
    expect(sectionOf(pts, hk0, 0.25, 0.025)).toBeNull();
  });

  it("reads the plane's own axes: a K–L plane cut along H", () => {
    const b = box([1, 0.5, -0.25], [0.1, 0.2, 0.3]);
    expect(sectionOf(b, { u: 1, v: 2, cut: 0 }, 1, 0.01)).toEqual({ kind: "rect", u: [0.3, 0.7], v: [-0.55, 0.04999999999999999] });
  });
});

describe("sectionDisplay: the section drawn as the view draws its slice", () => {
  it("scales r.l.u. to Å⁻¹ on a reciprocal view", () => {
    const g = { sx: (2 * Math.PI) / 5, sy: (2 * Math.PI) / 8, angle: 90 };
    const pts = sectionDisplay({ kind: "rect", u: [1, 2], v: [0, 0.5] }, g);
    expect(pts[0]).toEqual([g.sx, 0]);
    expect(pts[2][0]).toBeCloseTo(2 * g.sx, 12);
    expect(pts[2][1]).toBeCloseTo(0.5 * g.sy, 12);
  });

  it("shears a rectangle into the parallelogram of an oblique (hexagonal, 120°) section", () => {
    const g = { sx: 1, sy: 1, angle: 120 };
    const [a, b, c, d] = sectionDisplay({ kind: "rect", u: [0, 4], v: [0, 4] }, g);
    expect(a).toEqual([0, 0]);
    expect(b).toEqual([4, 0]);
    // v = 4 along b at 120°: X = 4·cos 120° = −2, Y = 4·sin 120°.
    expect(d[0]).toBeCloseTo(-2, 12);
    expect(d[1]).toBeCloseTo(4 * Math.sin((120 * Math.PI) / 180), 12);
    expect(c[0]).toBeCloseTo(2, 12);
  });

  it("traces an ellipse whose every point is on the ellipse in the section's own oblique axes", () => {
    for (const angle of [90, 120, 75]) {
      const g = { sx: 1, sy: 1, angle };
      const s: Section = { kind: "ellipse", cu: 3, cv: -2, au: 1.5, av: 0.5 };
      for (const [X, Y] of sectionDisplay(s, g)) {
        const [u, v] = displayToSlice(X, Y, g);
        expect(((u - 3) / 1.5) ** 2 + ((v + 2) / 0.5) ** 2).toBeCloseTo(1, 9);
      }
    }
  });

  it("bounds an oblique ellipse exactly: its outline's extremes", () => {
    const g = { sx: 0.7, sy: 1.3, angle: 120 };
    const s: Section = { kind: "ellipse", cu: 1, cv: 2, au: 2, av: 1 };
    const b = sectionBounds(s, g);
    const pts = sectionDisplay(s, g, 20000);
    expect(b.x0).toBeCloseTo(Math.min(...pts.map((p) => p[0])), 6);
    expect(b.x1).toBeCloseTo(Math.max(...pts.map((p) => p[0])), 6);
    expect(b.y0).toBeCloseTo(Math.min(...pts.map((p) => p[1])), 6);
    expect(b.y1).toBeCloseTo(Math.max(...pts.map((p) => p[1])), 6);
  });
});

describe("registration: the outline stays on the data while the view is zoomed and panned", () => {
  // The data point a mark sits on, and its pixel, as the canvas places that point.
  const g = { sx: 1, sy: 1, angle: 120 };
  const s: Section = { kind: "points", pts: [[3, 2]] };
  const at = (vp: { cx: number; cy: number; half: number }) => toPixels(sectionDisplay(s, g), vp, 640, 400)[0];
  const canvas = (vp: { cx: number; cy: number; half: number }) => {
    const [X, Y] = sliceToDisplay(3, 2, g);
    return displayToPixel(vp, X, Y, 640, 400);
  };

  it("draws a point where the canvas draws that sample, in a wide view", () => {
    const vp = { cx: 0, cy: 0, half: 10 };
    expect(at(vp)).toEqual(canvas(vp));
  });

  it("keeps it under a zoom about it, and moves it with a pan", () => {
    const vp = { cx: 1, cy: -1, half: 10 };
    const [X, Y] = sliceToDisplay(3, 2, g);
    const zoomed = zoomAbout(vp, X, Y, 0.25, free);
    expect(at(zoomed)[0]).toBeCloseTo(at(vp)[0], 9);
    expect(at(zoomed)[1]).toBeCloseTo(at(vp)[1], 9);
    const panned = panBy(zoomed, 37, -12, 640, 400);
    expect(at(panned)[0]).toBeCloseTo(at(zoomed)[0] + 37, 9);
    expect(at(panned)[1]).toBeCloseTo(at(zoomed)[1] - 12, 9);
    expect(at(panned)).toEqual(canvas(panned));
  });
});

describe("cutIndexFor: the cut that brings a region into view", () => {
  it("cuts a box or an ellipsoid through its centre, snapped to the grid", () => {
    expect(cutIndexFor(box([0, 0, 0.51], [1, 1, 0.1]), HKL, 2)).toEqual({ index: 50, count: 1 });
  });

  it("cuts points on the grid plane that holds the most of them", () => {
    // A satellite pair at H = 1 ± 0.25 on L = 0, and one more at L = 0.5.
    const pts: MarkRegion = { shape: "points", points: [[1.25, 0, 0], [0.75, 0, 0], [1, 0, 0.5]] };
    expect(cutIndexFor(pts, HKL, 2)).toEqual({ index: snapIndex(HKL, 2, 0), count: 2 });
    expect(cutIndexFor(pts, HKL, 1)).toEqual({ index: snapIndex(HKL, 1, 0), count: 3 });
  });

  it("among equal planes, takes the one nearest the points' mean", () => {
    const pts: MarkRegion = { shape: "points", points: [[0, 0, -1], [0, 0, 0.2], [0, 0, 1.5]] };
    expect(cutIndexFor(pts, HKL, 2).index).toBe(snapIndex(HKL, 2, 0.2));
  });
});

describe("frameTarget: zoom to a region only where it helps", () => {
  const fit = { cx: 0, cy: 0, half: 20 };
  const data = { x0: -20, x1: 20, y0: -20, y1: 20 };
  const limit = (h: number) => Math.max(0.5, Math.min(25, h));

  it("leaves a view alone that shows the region at a readable size", () => {
    expect(frameTarget({ x0: -4, x1: 4, y0: -2, y1: 2 }, fit, { fit, data, limit })).toBeNull();
  });

  it("zooms to a region too small to see, about MARGIN times its size", () => {
    const v = frameTarget({ x0: 5, x1: 6, y0: 1, y1: 1.5 }, fit, { fit, data, limit })!;
    expect(v.cx).toBe(5.5);
    expect(v.cy).toBe(1.25);
    expect(v.half).toBe(Math.max(0.5 * MARGIN, 20 * MIN_VIEW_SHARE));
  });

  it("closes in no further than a share of the full view on a single point", () => {
    const v = frameTarget({ x0: 5, x1: 5, y0: 1, y1: 1 }, fit, { fit, data, limit })!;
    expect(v.half).toBeCloseTo(20 * MIN_VIEW_SHARE, 12);
  });

  it("pans to a region outside the view, and widens no further than the full view", () => {
    const zoomedIn = { cx: -15, cy: -15, half: 2 };
    const v = frameTarget({ x0: -30, x1: 30, y0: 10, y1: 14 }, zoomedIn, { fit, data, limit })!;
    expect(v.half).toBe(20);
    expect(v.cx).toBe(0);
    expect(v.cy).toBe(12);
  });

  it("keeps the view's centre on the data", () => {
    const v = frameTarget({ x0: 24, x1: 26, y0: 0, y1: 1 }, fit, { fit, data, limit })!;
    expect(v.cx).toBe(20);
  });
});
