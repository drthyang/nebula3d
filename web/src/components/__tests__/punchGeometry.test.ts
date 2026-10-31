// The Configure preview's overlay geometry: footprints map to the view's
// pixels through the same viewport the canvas draws by (so they stay on the
// peaks at any zoom), the nodes drawn are those in view on the slice's extent,
// and Auto's reference cut is the origin, or the range end nearest it.

import { describe, expect, it } from "vitest";

import { ellipseForNode, ellipseToPixels, originCut, qEllipseForPlane, visibleNodes, type PunchGeom } from "../punchGeometry";
import { displayToPixel, type Viewport } from "../viewport";

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe("ellipseToPixels", () => {
  const v: Viewport = { cx: 0, cy: 0, half: 5 };

  it("maps the centre through the viewport and the half-axes at its one scale", () => {
    const p = ellipseToPixels({ cx: 1, cy: 2, rx: 0.5, ry: 0.25, angle: 0 }, v, 100, 100);
    expect(p).toEqual({ cx: 60, cy: 30, rx: 5, ry: 2.5, angle: 0 });
  });

  it("uses the shorter side for the scale in a wide view, as the canvas does", () => {
    const p = ellipseToPixels({ cx: 1, cy: 0, rx: 1, ry: 1, angle: 0 }, v, 200, 100);
    expect([p.cx, p.cy, p.rx]).toEqual([110, 50, 10]);
  });

  it("mirrors the tilt, so a point on the major axis lands where displayToPixel puts it", () => {
    const e = { cx: 1, cy: -1, rx: 2, ry: 0.5, angle: 30 };
    const p = ellipseToPixels(e, v, 160, 120);
    expect(p.angle).toBe(-30);
    const a = (e.angle * Math.PI) / 180;
    const [X, Y] = displayToPixel(v, e.cx + e.rx * Math.cos(a), e.cy + e.rx * Math.sin(a), 160, 120);
    // SVG rotate(θ) turns (1, 0) to (cos θ, sin θ) in pixels (y down).
    const t = (p.angle * Math.PI) / 180;
    close(p.cx + p.rx * Math.cos(t), X);
    close(p.cy + p.rx * Math.sin(t), Y);
  });

  it("follows a zoom: half the window, twice the size", () => {
    const e = { cx: 0.5, cy: 0.5, rx: 0.1, ry: 0.1, angle: 0 };
    const zoomed = ellipseToPixels(e, { cx: 0.5, cy: 0.5, half: 2.5 }, 100, 100);
    expect(zoomed).toMatchObject({ cx: 50, cy: 50, rx: 2 });
    expect(ellipseToPixels(e, v, 100, 100).rx).toBe(1);
  });
});

describe("visibleNodes", () => {
  const base = { w: 100, h: 100, qScaleX: 1, qScaleY: 1, extentX: [-4, 4] as [number, number], extentY: [-4, 4] as [number, number] };

  it("lists the integer nodes in view, a node past each edge included", () => {
    const nodes = visibleNodes({ ...base, viewport: { cx: 0, cy: 0, half: 2 } })!;
    expect(nodes.length).toBe(7 * 7);
    expect(Math.min(...nodes.map((n) => n.x))).toBe(-3);
    expect(Math.max(...nodes.map((n) => n.y))).toBe(3);
  });

  it("keeps to the slice's extent", () => {
    const nodes = visibleNodes({ ...base, viewport: { cx: 0, cy: 0, half: 10 }, extentX: [0, 1.5], extentY: [-1, 1] })!;
    expect(nodes.map((n) => `${n.x},${n.y}`).sort()).toEqual(["0,-1", "0,0", "0,1", "1,-1", "1,0", "1,1"]);
  });

  it("keeps the parent lattice's nodes for a supercell", () => {
    const nodes = visibleNodes({ ...base, viewport: { cx: 0, cy: 0, half: 4 }, cell: [2, 3] })!;
    expect([...new Set(nodes.map((n) => n.x))].sort((a, b) => a - b)).toEqual([-4, -2, 0, 2, 4]);
    expect([...new Set(nodes.map((n) => n.y))].sort((a, b) => a - b)).toEqual([-3, 0, 3]);
  });

  it("reads the view in Å⁻¹ and the nodes in r.l.u.", () => {
    // 2π/a = 2 Å⁻¹ per r.l.u.: a ±2 Å⁻¹ view spans ±1 r.l.u. (±2 with the margin).
    const nodes = visibleNodes({ ...base, viewport: { cx: 0, cy: 0, half: 2 }, qScaleX: 2, qScaleY: 2 })!;
    expect(nodes.length).toBe(5 * 5);
  });

  it("gives up when there would be too many to draw, and writes the origin as 0, never −0", () => {
    expect(visibleNodes({ ...base, viewport: { cx: 0, cy: 0, half: 4 }, max: 10 })).toBeNull();
    const nodes = visibleNodes({ ...base, viewport: { cx: 0, cy: 0, half: 0.4 }, pad: 0 })!;
    expect(nodes).toEqual([{ x: 0, y: 0 }]);
    expect(Object.is(nodes[0].x, -0)).toBe(false);
  });
});

describe("originCut", () => {
  it("is the origin when the range holds it, else the nearest end", () => {
    expect(originCut({ min: -2, max: 3 })).toBe(0);
    expect(originCut({ min: 1, max: 3 })).toBe(1);
    expect(originCut({ min: -3, max: -1 })).toBe(-1);
  });
});

describe("the footprint (moved unchanged from the page)", () => {
  const geom: PunchGeom = {
    r0: 0.1,
    r1: 0.2,
    r2: 0.3,
    frame: "q",
    sphRadii: [0.1, 0.2, 0.3],
    margin: 0,
    mode: "both",
    supercell: [1, 1, 1],
    isQ: true,
    unit: "Å⁻¹",
    ax: ["a*", "b*", "c*"],
    directBeamRadiiQ: [0.16, 0.3, 0.25],
    directBeamMargin: 0,
  };
  const cubic = { a: 4, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90 };
  // The backend's UB carries the 2π (Q = UB·hkl in Å⁻¹): 2π/a on the diagonal of a cubic cell.
  const q = (2 * Math.PI) / 4;
  const ub = [
    [q, 0, 0],
    [0, q, 0],
    [0, 0, q],
  ];

  it("cuts the reciprocal-frame ellipsoid along the plane's axes", () => {
    const hk = qEllipseForPlane("hk", geom, cubic, ub);
    expect([Math.max(hk.rx, hk.ry), Math.min(hk.rx, hk.ry)].map((r) => Number(r.toFixed(9)))).toEqual([0.2, 0.1]);
    const kl = qEllipseForPlane("kl", geom, cubic, ub);
    expect([Math.max(kl.rx, kl.ry), Math.min(kl.rx, kl.ry)].map((r) => Number(r.toFixed(9)))).toEqual([0.3, 0.2]);
  });

  it("is the same at every node in the reciprocal frame, and turns with Q̂ in the spherical one", () => {
    const g = qEllipseForPlane("hk", geom, cubic, ub);
    expect(ellipseForNode("hk", geom, g, cubic, ub, 2, 1, 0)).toBe(g);
    const sph = { ...geom, frame: "spherical", sphRadii: [0.1, 0.3, 0.3] as [number, number, number] };
    const along = ellipseForNode("hk", sph, g, cubic, ub, 2, 0, 0); // Q̂ along a*
    const diag = ellipseForNode("hk", sph, g, cubic, ub, 1, 1, 0); // Q̂ along a* + b*
    // The short (radial) axis lies along Q̂: across a* at (2,0,0), at 45° at (1,1,0).
    const shortAxisAngle = (e: { rx: number; ry: number; angle: number }) => (e.rx < e.ry ? e.angle : e.angle + 90);
    const mod180 = (x: number) => ((x % 180) + 180) % 180;
    close(mod180(shortAxisAngle(along)), 0, 1e-6);
    close(mod180(shortAxisAngle(diag)), 45, 1e-6);
  });
});
