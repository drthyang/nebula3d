// An overlay set on one view (examine/draw.ts): the punch holes traced from
// the slice's NaN voxels, round 2 on the cut, peaks on their own cut only,
// shells on the slice, the cap, and the cache.

import { describe, expect, it } from "vitest";

import type { Slice } from "../../../api/types";
import type { AgentStep } from "../../agent";
import { legend, legendCounts, mapEllipse, MAX_PRIMITIVES, traceHoles, viewDraw, voxelsOnCut, type ViewContext } from "../draw";
import { inv3, mm } from "../linalg";
import { overlaysOf, type OverlaySet } from "../overlays";

// A slice on a grid of 0.1 r.l.u. from -n/20 … with NaN where `hole` says.
function slice(n: number, hole: (i: number, j: number) => boolean = () => false): Slice {
  const axis = Array.from({ length: n }, (_, i) => Number(((i - (n - 1) / 2) * 0.1).toFixed(4)));
  const data = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] = hole(i, j) ? NaN : 1;
  return { header: { nx: n, ny: n, x_axis: axis, y_axis: axis, x_label: "K", y_label: "L", cut_label: "H = 0", robust_max: 1 }, data };
}

const LATTICE = { a: 4, b: 4, c: 4, alpha: 90, beta: 90, gamma: 90 };
const S = (2 * Math.PI) / 4;
const ctx = (over: Partial<ViewContext> = {}): ViewContext => ({ stage: "braggpunched", plane: "0kl", cut: 0, cutStep: 0.1, sx: S, sy: S, lattice: LATTICE, ...over });

const setOf = (name: string, args: Record<string, unknown>, result: unknown, overlay?: AgentStep["overlay"]): OverlaySet =>
  overlaysOf({ id: "0:a", name, args, status: "done", result: JSON.stringify(result), ...(overlay ? { overlay } : {}) })!;

describe("the punch holes", () => {
  it("counts each hole and outlines it along the voxel edges", () => {
    const s = slice(11, (i, j) => (i >= 2 && i <= 3 && j >= 2 && j <= 3) || (i === 8 && j === 8));
    const t = traceHoles(s);
    expect(t.count).toBe(2);
    // A 2×2 hole has 4 merged edges, a 1×1 hole 4: 8 subpaths.
    expect(t.d.match(/M/g)).toHaveLength(8);
  });
  it("leaves out what was no data before the punch", () => {
    const before = slice(11, (i) => i === 0);
    const after = slice(11, (i, j) => i === 0 || (i === 5 && j === 5));
    expect(traceHoles(after, before).count).toBe(1);
    expect(traceHoles(after).count).toBe(2);
  });
  it("is cached per pair of slices", () => {
    const s = slice(11, (i, j) => i === 5 && j === 5);
    expect(traceHoles(s)).toBe(traceHoles(s));
  });
});

describe("round 2 on the cut", () => {
  it("keeps the voxels within half a step of the cut, on the plane's axes", () => {
    // 0kl: x = K, y = L, the cut along H.
    const hkl = [0, 1, 2, 0.04, 1.5, 2.5, 0.2, 1, 1];
    const r = voxelsOnCut(hkl, "0kl", 0, 0.1, 0.1, 0.1);
    expect(r.count).toBe(2);
    expect(r.d.startsWith("M0.9500 1.9500h0.1000")).toBe(true);
  });
});

describe("a set on a view", () => {
  const leftovers = [
    { plane: "0kl", cut: 0, x: 0.2, y: 0.2, sigma: 12, at_node: true, broad: false },
    { plane: "0kl", cut: 0.5, x: 0.2, y: 0.2, sigma: 12, at_node: true, broad: false }, // another cut
    { plane: "hk0", cut: 0, x: 0.1, y: 0.1, sigma: 12, at_node: false, broad: false }, // another plane
    { plane: "0kl", cut: 0, x: 9, y: 9, sigma: 12, at_node: false, broad: false }, // off the slice
  ];
  const punch = setOf("assess_stage", { stage: "punch" }, { punch: { leftover_at_nodes: 1 } }, { leftovers, round2: [0, 0.3, 0.3] });

  it("draws a peak on its own plane and cut, on the slice, and the holes", () => {
    const s = slice(11, (i, j) => i === 5 && j === 5);
    const d = viewDraw(punch, ctx({ slice: s }));
    expect(d.peaks).toEqual([{ cls: "node", style: "full", X: 0.2 * S, Y: 0.2 * S, sigma: 12 }]);
    expect(d.counts).toEqual({ node: 1, holes: 1, r2: 1 });
    expect(d.paths.map((p) => p.cls)).toEqual(["holes", "r2"]);
  });

  it("on the raw view, the leftovers faint and no holes", () => {
    const d = viewDraw(punch, ctx({ stage: "raw", slice: slice(11) }));
    expect(d.peaks.map((p) => p.style)).toEqual(["faint"]);
    expect(d.paths).toEqual([]);
  });

  it("draws nothing on a view the set does not read", () => {
    expect(viewDraw(punch, ctx({ stage: "flattened", slice: slice(11) }))).toEqual({ peaks: [], shells: [], bands: [], hatches: [], paths: [], counts: {} });
  });

  it("caps the primitives, the strongest peaks kept", () => {
    const many = Array.from({ length: MAX_PRIMITIVES + 50 }, (_, k) => ({ plane: "0kl", cut: 0, x: 0, y: 0, sigma: k, broad: false, at_node: false }));
    const set = setOf("assess_stage", { stage: "punch" }, { punch: {} }, { leftovers: many });
    const d = viewDraw(set, ctx({ slice: slice(11) }));
    expect(d.peaks.length + d.paths.length).toBeLessThanOrEqual(MAX_PRIMITIVES);
    expect(d.peaks[0].sigma).toBe(MAX_PRIMITIVES + 49);
  });

  it("is cached while the view's slice holds", () => {
    const s = slice(11);
    expect(viewDraw(punch, ctx({ slice: s }))).toBe(viewDraw(punch, ctx({ slice: s })));
    expect(viewDraw(punch, ctx({ slice: s }))).not.toBe(viewDraw(punch, ctx({ slice: slice(11) })));
  });

  it("draws a shell where it crosses the slice, and counts it", () => {
    const rings = setOf("assess_stage", { stage: "rings" }, { rings: { shells_judged: [{ at: 0.5, ring: false }, { at: 30, ring: false }] } });
    const d = viewDraw(rings, ctx({ stage: "raw", slice: slice(11) }));
    // |Q| = 0.5 Å⁻¹ is a circle of radius 0.5 about the origin on a cubic cell; 30 Å⁻¹ is off the slice.
    expect(d.shells).toHaveLength(1);
    expect(d.shells[0].e.rx).toBeCloseTo(0.5, 6);
    expect(d.counts).toEqual({ XTAL: 1 });
    expect(legendCounts(rings, { raw: d })).toEqual({ XTAL: 1 });
  });

  it("hatches past the counts, the whole plane where it lies past them", () => {
    const cov = setOf("qmax_coverage", {}, { raw_counts: { q_min_edge: 0, q_max_edge: 0.6 } });
    const on = viewDraw(cov, ctx({ stage: "raw", slice: slice(11) }));
    expect(on.hatches[0].outside?.rx).toBeCloseTo(0.6, 6);
    // the plane H = 1 lies 1.57 Å⁻¹ from the origin: past the counts.
    const off = viewDraw(cov, ctx({ stage: "raw", cut: 1, slice: slice(11) }));
    expect(off.hatches[0].outside).toBeNull();
  });
});

describe("v2 on a view", () => {
  const unit = (over: Partial<ViewContext> = {}): ViewContext => ctx({ sx: 1, sy: 1, ...over });

  it("a spot on its cut within half a voxel (or its own reach), on the slice", () => {
    const set = setOf("dpdf_peaks", {}, { features: [{ length_A: 0.3, size_sigma: 50, vectors_A: [[0, 0.3, 0.04]] }, { length_A: 0.5, size_sigma: -9, vectors_A: [[0, 0.2, 0.2]] }] });
    // 0kl on the ΔPDF is not a section: yz is (x = cut).
    const d = viewDraw(set, unit({ stage: "delta_pdf", plane: "yz", cut: 0, slice: slice(11) }));
    expect(d.peaks.map((p) => [p.cls, p.X, p.Y, p.label])).toEqual([
      ["dpos", 0.3, 0.04, "0.3 Å"],
      ["dpos", -0.3, -0.04, "0.3 Å"],
      ["dneg", 0.2, 0.2, "0.5 Å"],
      ["dneg", -0.2, -0.2, "0.5 Å"],
    ]);
    // xy (z = cut): 0.04 lies within half a voxel (0.05) of z = 0, 0.2 does not.
    expect(viewDraw(set, unit({ stage: "delta_pdf", plane: "xy", cut: 0, slice: slice(11) })).peaks.map((p) => p.cls)).toEqual(["dpos", "dpos"]);
  });

  it("a hole's spot reaches the cuts through it", () => {
    const fillHoles = { nHoles: 1, holes: [{ hkl: [0.2, 0.2, 0.25] as [number, number, number], bias: 1, biasSigma: 5, voxels: 125 }] };
    const set = setOf("texture_check", {}, { systematic_fill_bias: false }, { fillHoles });
    // hk0 at L = 0: 0.25 r.l.u. off, within 2.5 voxels (∛125 / 2) of 0.1.
    expect(viewDraw(set, ctx({ stage: "backfilled", plane: "hk0", slice: slice(11) })).counts).toEqual({ fillUp: 1 });
    expect(viewDraw(set, ctx({ stage: "backfilled", plane: "hk0", cut: 0.6, slice: slice(11) })).counts).toEqual({});
  });

  it("an ellipse through the view's geometry: its half-axes and tilt", () => {
    // A circle stays a circle under one scale; one scale per axis stretches it.
    expect(mapEllipse(1, 2, 0.5, 0.5, 0, { sx: 2, sy: 2, angle: 90 })).toMatchObject({ cx: 2, cy: 4, rx: 1, ry: 1 });
    const e = mapEllipse(0, 0, 1, 0.5, 0, { sx: 3, sy: 1, angle: 90 });
    expect([e.rx, e.ry, e.angle]).toEqual([3, 0.5, 0].map((x) => expect.closeTo(x, 9)));
    // Tilted 90° (y down): the long axis along y.
    const t = mapEllipse(0, 0, 1, 0.5, 90, { sx: 1, sy: 1, angle: 90 });
    expect(t.rx).toBeCloseTo(1, 9);
    expect(Math.abs(t.angle)).toBeCloseTo(90, 6);
  });

  it("a footprint on the cuts within its width, its fit as the Bragg page draws it", () => {
    const braggPeaks = [{ hkl: [0.2, 0.3, 0.02] as [number, number, number], widths: [0.05, 0.03, 0.04] as [number, number, number], principal: null, dirs: null }];
    const set = setOf("bragg_peaks", {}, { n_peaks: 1, peaks: { cols: ["hkl", "resolution_limited"], rows: [[[0.2, 0.3, 0.02], [true, true, true]]] } }, { braggPeaks });
    const d = viewDraw(set, unit({ stage: "bragg", plane: "hk0", cut: 0, slice: slice(11) }));
    expect(d.ellipses).toHaveLength(1);
    expect(d.ellipses![0]).toMatchObject({ cls: "fpRes", label: "0.2 0.3 0.02" });
    expect(d.ellipses![0].e.rx).toBeCloseTo(0.05, 9);
    expect(d.ellipses![0].e.ry).toBeCloseTo(0.03, 9);
    // 0.05 off the cut is past its width along L (0.04): not on this cut.
    expect(viewDraw(set, unit({ stage: "bragg", plane: "hk0", cut: -0.05, slice: slice(11) })).ellipses).toBeUndefined();
  });

  it("the UB turn: an arrow at each node of a node plane, across Q, scaled by a round factor", () => {
    const ub = [[1.6, 0, 0], [0, 1.6, 0], [0, 0, 1.6]];
    const t = 0.002;
    const fitted = mm([[Math.cos(t), -Math.sin(t), 0], [Math.sin(t), Math.cos(t), 0], [0, 0, 1]], ub);
    const set = setOf("ub_check", {}, { orientation_change_deg: 0.11 }, { ubTurn: { ub, fitted, cell: [0.2, 0.2, 0.2] } });
    const d = viewDraw(set, unit({ stage: "raw", plane: "hk0", cut: 0, slice: slice(11) }));
    // A 11×11 grid of 0.1 r.l.u. from −0.5: nodes every 0.2 from −0.4 to 0.4, less the origin.
    expect(d.arrows).toHaveLength(24);
    for (const a of d.arrows!) expect(a.X * a.dX + a.Y * a.dY).toBeCloseTo(0, 9); // across Q
    // About z, counter-clockwise: at (0.4, 0) the shift is along +K.
    const east = d.arrows!.find((a) => Math.abs(a.X - 0.4) < 1e-9 && Math.abs(a.Y) < 1e-9)!;
    expect(east.dY).toBeGreaterThan(0);
    expect(Math.abs(east.dX)).toBeLessThan(1e-9);
    const { notes, counts } = legend(set, { raw: d });
    expect(notes.turn).toMatch(/^×\d+$/);
    expect(counts.turn).toBe(24);
    // The longest is at most 0.35 of the node spacing, more than a seventh of it.
    const longest = Math.max(...d.arrows!.map((a) => Math.hypot(a.dX, a.dY)));
    expect(longest).toBeLessThanOrEqual(0.35 * 0.2 + 1e-12);
    expect(longest).toBeGreaterThan(0.35 * 0.2 / 2.5);
    // Off a node plane: none.
    expect(viewDraw(set, unit({ stage: "raw", plane: "hk0", cut: 0.1, slice: slice(11) })).arrows).toBeUndefined();
  });

  it("the rotated copy's nodes within a voxel of the cut", () => {
    const map = [[0.2, 0, 0], [0, 0.2, 0], [0, 0, 0.2]]; // its nodes every 0.2 r.l.u. (no turn, for the count)
    const set = setOf("grain_check", {}, { far: [] }, { grains: { far: [], rotated: map } });
    const d = viewDraw(set, unit({ stage: "raw", plane: "hk0", cut: 0, slice: slice(11) }));
    expect(d.counts.rotated).toBe(24);
    expect(new Set(d.keys!.rotated).size).toBe(24);
  });

  it("a line along one of the view's axes, at its place, across the slice", () => {
    const set = setOf("line_profile", {}, { stage: "raw", along: "K", through: { H: 0, L: 0.2 } });
    // 0kl at H = 0: K along x, at L = 0.2.
    const d = viewDraw(set, unit({ stage: "raw", plane: "0kl", cut: 0, slice: slice(11) }));
    expect(d.lines).toEqual([{ cls: "line", style: "full", X0: -0.5, Y0: 0.2, X1: 0.5, Y1: 0.2 }]);
    // hk0 at L = 0 does not hold it.
    expect(viewDraw(set, unit({ stage: "raw", plane: "hk0", cut: 0, slice: slice(11) })).lines).toBeUndefined();
  });

  it("counts a thing once over a page's views of one stage", () => {
    const set = setOf("dpdf_peaks", {}, { features: [{ length_A: 0, size_sigma: 50, vectors_A: [[0, 0, 0]] }, { length_A: 0.3, size_sigma: 40, vectors_A: [[0.3, 0, 0]] }] });
    const views = (["xy", "xz", "yz"] as const).map((plane) => ({ stage: "delta_pdf", draw: viewDraw(set, unit({ stage: "delta_pdf", plane, cut: 0, slice: slice(11) })) }));
    // The origin's on all three sections, ±0.3 x on xy and xz: three things.
    expect(legend(set, views).counts.dpos).toBe(3);
  });

  it("an oblique view's points through its geometry", () => {
    const set = setOf("grain_check", {}, { far: [] }, { grains: { far: [[0, 0.3, 0]], rotated: null } });
    const d = viewDraw(set, unit({ stage: "raw", plane: "hk0", cut: 0, angle: 120, slice: slice(11) }));
    expect(d.peaks[0].X).toBeCloseTo(0.3 * Math.cos((120 * Math.PI) / 180), 9);
    expect(d.peaks[0].Y).toBeCloseTo(0.3 * Math.sin((120 * Math.PI) / 180), 9);
  });

  it("inverts a 3×3 matrix", () => {
    const m = [[2, 1, 0], [0, 1, 3], [1, 0, 1]];
    const p = mm(m, inv3(m)!);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(p[i][j]).toBeCloseTo(i === j ? 1 : 0, 12);
    expect(inv3([[1, 2, 3], [2, 4, 6], [0, 0, 1]])).toBeNull();
  });
});
