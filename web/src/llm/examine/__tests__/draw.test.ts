// An overlay set on one view (examine/draw.ts): the punch holes traced from
// the slice's NaN voxels, round 2 on the cut, peaks on their own cut only,
// shells on the slice, the cap, and the cache.

import { describe, expect, it } from "vitest";

import type { Slice } from "../../../api/types";
import type { AgentStep } from "../../agent";
import { legendCounts, MAX_PRIMITIVES, traceHoles, viewDraw, voxelsOnCut, type ViewContext } from "../draw";
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
