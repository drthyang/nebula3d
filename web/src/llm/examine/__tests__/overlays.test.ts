// The overlay registry and each v1 mapper (examine/overlays.ts), on synthetic
// results: every measuring tool has a mapper, an explicit none, or the PR that
// adds it; each mapper's items from the fields it reads.

import { describe, expect, it } from "vitest";

import type { AgentStep } from "../../agent";
import { toolsWhere } from "../../tools";
import type { OverlayData } from "../data";
import { examining, hklLabel, leftoverClass, OVERLAYS, overlaysOf, parseStageShells, ringShells, stepKey, ubOmega } from "../overlays";

const step = (name: string, args: Record<string, unknown>, result: unknown, overlay?: OverlayData): AgentStep => ({
  id: "0:c1",
  name,
  args,
  status: "done",
  result: JSON.stringify(result),
  ...(overlay ? { overlay } : {}),
});

const count = (items: { cls: string }[], cls: string) => items.filter((i) => i.cls === cls).length;

describe("the registry", () => {
  it("holds every measuring tool to a mapper, a none or a later PR", () => {
    const measuring = toolsWhere((f) => f.measures);
    expect(measuring.length).toBeGreaterThan(10);
    for (const name of measuring) expect(OVERLAYS[name], name).toBeDefined();
  });
  it("names only tools the registry holds", () => {
    const all = new Set(toolsWhere(() => true));
    for (const name of Object.keys(OVERLAYS)) expect(all.has(name), name).toBe(true);
  });
  it("draws for v1's three tools and v2's six", () => {
    expect(Object.entries(OVERLAYS).filter(([, e]) => typeof e === "function").map(([n]) => n).sort()).toEqual([
      "assess_stage",
      "bragg_peaks",
      "dpdf_peaks",
      "grain_check",
      "line_profile",
      "measure_reciprocal_cut",
      "qmax_coverage",
      "texture_check",
      "ub_check",
    ]);
  });
  it("defers the radial profile's sparkline alone", () => {
    expect(Object.entries(OVERLAYS).filter(([, e]) => typeof e === "object" && "later" in e).map(([n]) => n)).toEqual(["radial_profile"]);
  });
});

describe("the Bragg punch", () => {
  const leftovers = [
    { plane: "0kl", cut: 0, x: 2, y: 2, sigma: 12, at_node: true, broad: false },
    { plane: "0kl", cut: 0, x: 0, y: 1.5, sigma: 9, at_node: false, broad: false },
    { plane: "0kl", cut: 0, x: 1, y: 1, sigma: 8.5, at_node: false, broad: true },
    { plane: "0kl", cut: 0, x: 0, y: 0.5, sigma: 8.2, at_node: false, on_protected_plane: true, broad: false },
    { plane: "hk0", cut: 0, x: 1.5, y: 0, sigma: 10, at_node: false, broad: false },
  ];
  const result = {
    punch: {
      verdict: "attention",
      leftover_at_nodes: 1,
      leftover_off_lattice_sharp: 3,
      leftover_on_protected_planes_sharp: 1,
      leftover_off_lattice_broad: 1,
      per_plane: {},
    },
  };

  it("classes each leftover: at a node, protected, broad, else sharp", () => {
    expect(leftoverClass({ at_node: true, broad: true })).toBe("node");
    expect(leftoverClass({ at_node: false, on_protected_plane: true, broad: true })).toBe("protected");
    expect(leftoverClass({ at_node: false, broad: true })).toBe("broad");
    expect(leftoverClass({ at_node: false, broad: false })).toBe("sharp");
    expect(leftoverClass({ broad: false })).toBe("sharp");
  });

  it("draws every leftover the stage's data holds, the holes and round 2", () => {
    const set = overlaysOf(step("assess_stage", { stage: "punch" }, result, { leftovers, round2: [0, 0.1, 2, 0, -0.1, 2] }))!;
    expect(set.title).toBe("Bragg punch");
    expect(set.where).toBe("1 missed at nodes · 2 sharp off-lattice · 1 broad kept, on the three planes");
    expect(set.items.filter((i) => i.kind === "peak")).toHaveLength(5);
    expect([count(set.items, "node"), count(set.items, "sharp"), count(set.items, "broad"), count(set.items, "protected")]).toEqual([1, 2, 1, 1]);
    expect(count(set.items, "holes")).toBe(1);
    expect(set.items.find((i) => i.kind === "voxels")).toMatchObject({ cls: "r2", hkl: [0, 0.1, 2, 0, -0.1, 2] });
    expect(set.classes.map((c) => c.id)).toEqual(["node", "sharp", "broad", "protected", "holes", "r2"]);
    expect(set.views).toEqual({ braggpunched: "primary", raw: "reading" });
    expect(set.measured).toEqual(["braggpunched"]);
  });

  it("leaves the zeros out of its line", () => {
    const zero = { punch: { leftover_at_nodes: 3, leftover_off_lattice_sharp: 0, leftover_on_protected_planes_sharp: 0, leftover_off_lattice_broad: 0 } };
    expect(overlaysOf(step("assess_stage", { stage: "punch" }, zero))!.where).toBe("3 missed at nodes, on the three planes");
    const none = { punch: { leftover_at_nodes: 0, leftover_off_lattice_sharp: 0, leftover_off_lattice_broad: 0 } };
    expect(overlaysOf(step("assess_stage", { stage: "punch" }, none))!.where).toBe("no leftover peaks on the three planes");
  });

  it("without the stage's data, draws the holes alone", () => {
    const set = overlaysOf(step("assess_stage", { stage: "punch" }, result))!;
    expect(set.items).toEqual([{ kind: "holes", cls: "holes" }]);
  });

  it("draws nothing for a stage with no output yet", () => {
    expect(overlaysOf(step("assess_stage", { stage: "punch" }, { punch: { missing: "no braggpunched output yet" } }))).toBeNull();
  });

  it("measure_reciprocal_cut: the leftovers its result lists, on its cut", () => {
    const r = {
      cut: "H–L plane at K = 0.5",
      bragg_punch_leftover: {
        n_suspicious: 11,
        suspicious_peaks: [
          { xy: [1, 0.5], hkl: [1, 0.5, 0.5], at_node: false, broad: false, sigma: 20, fwhm_voxels: [2, 2], intensity: 1, local_background: 0, contrast: 1 },
          { xy: [2, 0], at_node: true, broad: false, sigma: 9 },
        ],
      },
    };
    const set = overlaysOf(step("measure_reciprocal_cut", { plane: "h0l", value: 0.5 }, r))!;
    const peaks = set.items.filter((i) => i.kind === "peak");
    expect(peaks).toEqual([
      { kind: "peak", cls: "sharp", plane: "h0l", cut: 0.5, x: 1, y: 0.5, sigma: 20 },
      { kind: "peak", cls: "node", plane: "h0l", cut: 0.5, x: 2, y: 0, sigma: 9 },
    ]);
    expect(set.where).toBe("h0l, K = 0.5: 11 leftover peaks, the strongest 2 drawn");
  });
});

describe("the ring shells", () => {
  it("reads the ring stage's one line", () => {
    expect(parseStageShells("Al a=4.049 Å; removed 5 (Al 4); left 3: 2.68 Al111 grid, 3.10 isotropy, 4.2 flank, +1 more")).toEqual({
      alA: 4.049,
      removed: 5,
      removedOnAl: 4,
      left: [
        { q: 2.68, al: "Al111", code: "grid" },
        { q: 3.1, al: null, code: "isotropy" },
        { q: 4.2, al: null, code: "flank" },
      ],
      leftCount: 3,
    });
    expect(parseStageShells("removed 2")).toEqual({ alA: null, removed: 2, removedOnAl: 0, left: [], leftCount: 0 });
    expect(parseStageShells(undefined)).toBeNull();
  });

  it("codes each shell: LEFT, GRID, NJ, AL, RM, XTAL, one per |Q|", () => {
    const a = 4.0495;
    const q111 = (2 * Math.PI * Math.sqrt(3)) / a; // 2.687
    const q200 = (2 * Math.PI * 2) / a; // 3.103
    const rings = {
      stage_shells: `Al a=${a} Å; removed 3 (Al 2); left 2: ${q111.toFixed(2)} Al111 grid, 5.5 nodata`,
      shells_judged: [
        { at: q200, ring: true, isotropy: 0.9 }, // left by the removal: LEFT, over the Al line
        { at: 1.41, ring: false, isotropy: 0.3 }, // the crystal's own
        { at: 4.8, ring: true, not_judged: "no clean flank" },
      ],
      per_plane: {
        hk0: { ring_residuals: [{ at: q200 + 0.02, residual_fraction: 0.04, significant: true, ring: true }] },
        h0l: { ring_residuals: [] },
      },
    };
    const q220 = (2 * Math.PI * Math.sqrt(8)) / a;
    const removed = [
      { q: q200, al: true, code: "Al200" },
      { q: q220, al: true, code: "Al220" },
      { q: 3.62, al: false, code: null },
    ];
    const shells = ringShells(rings, { ringsAtGrid: [6.1], ringsRemoved: removed });
    const byQ = (q: number) => shells.find((s) => Math.abs(s.q - q) < 0.05)?.cls;
    expect(byQ(1.41)).toBe("XTAL");
    expect(byQ(q111)).toBe("GRID"); // left by the stage on its grid, an Al line though it is
    expect(shells.find((s) => Math.abs(s.q - q200) < 0.05)).toMatchObject({ cls: "LEFT", tick: "up" });
    expect(byQ(4.8)).toBe("NJ");
    expect(byQ(5.5)).toBe("NJ");
    expect(byQ(6.1)).toBe("GRID");
    expect(byQ(q220)).toBe("AL"); // removed on an Al line, not left
    expect(byQ(3.62)).toBe("RM"); // removed on none
    // Exactly the record's Al shells: no other Al line of the fitted lattice (3.1 is left, so LEFT).
    expect(shells.filter((s) => s.cls === "AL").map((s) => s.q)).toEqual([q220]);
    // one shell per |Q|
    const qs = shells.map((s) => s.q);
    for (let i = 1; i < qs.length; i++) expect(qs[i] - qs[i - 1]).toBeGreaterThan(0.05);
  });

  it("marks a dent ▼", () => {
    const rings = {
      shells_judged: [{ at: 2.5, ring: true }],
      per_plane: { hk0: { ring_residuals: [{ at: 2.5, residual_fraction: -0.06, significant: true, ring: true }] } },
    };
    expect(ringShells(rings)).toEqual([{ cls: "LEFT", q: 2.5, tick: "down" }]);
  });

  it("draws a confirmed ring the removal took out cleanly as the record lists it", () => {
    const rings = { shells_judged: [{ at: 2.5, ring: true }], per_plane: { hk0: { ring_residuals: [{ at: 2.5, residual_fraction: 0.001, significant: false }] } } };
    // Without the record's list, nothing is drawn as removed.
    expect(ringShells(rings)).toEqual([]);
    expect(ringShells(rings, { ringsRemoved: [{ q: 2.52, al: true, code: "Al200" }] })).toEqual([{ cls: "AL", q: 2.52 }]);
    expect(ringShells(rings, { ringsRemoved: [{ q: 2.52, al: false, code: "Sn200" }] })).toEqual([{ cls: "RM", q: 2.52 }]);
    // Confirmed, not left, and not in the record's list: removed, on no Al line it names.
    expect(ringShells(rings, { ringsRemoved: [] })).toEqual([{ cls: "RM", q: 2.5 }]);
  });

  it("draws as many Al shells as the record says it removed (the 9-vs-8 bug)", () => {
    const removed = [2.69, 3.1, 4.39, 5.15, 5.38, 6.21, 6.77, 6.94].map((q) => ({ q, al: true, code: "Al" }));
    const set = overlaysOf(step("assess_stage", { stage: "rings" }, { rings: { shells_judged: [], stage_shells: "Al a=4.049 Å; removed 8 (Al 8)" } }, { ringsRemoved: removed }))!;
    expect(set.items.filter((i) => i.cls === "AL")).toHaveLength(8);
    expect(set.where).toBe("0 shells judged in 3D · removed 8 (Al 8)");
  });

  it("with the 3D test not run, every significant bump is not judged", () => {
    const rings = {
      ring_rule: "not judged: grid too coarse",
      per_plane: { hk0: { ring_residuals: [{ at: 2.1, residual_fraction: 0.05, significant: true }, { at: 3, residual_fraction: 0.01, significant: false }] } },
    };
    expect(ringShells(rings)).toEqual([{ cls: "NJ", q: 2.1 }]);
  });

  it("maps assess_stage rings to shells on the raw and ring-removed views", () => {
    const set = overlaysOf(step("assess_stage", { stage: "rings" }, { rings: { shells_judged: [{ at: 1.41, ring: false }], stage_shells: "removed 1", stage_phases: "Bi possible" } }))!;
    expect(set.title).toBe("Ring removal");
    expect(set.where).toBe("1 shell judged in 3D · removed 1");
    expect(set.items).toEqual([{ kind: "shell", cls: "XTAL", q: 1.41 }]);
    expect(set.views).toEqual({ raw: "primary", ringremoved: "reading" });
    expect(set.help.join(" ")).toContain("Bi possible");
  });

  it("stage=all draws the punch and the rings together", () => {
    const set = overlaysOf(
      step("assess_stage", {}, { punch: { leftover_at_nodes: 0 }, rings: { shells_judged: [{ at: 1.41, ring: false }] }, flatten: { verdict: "pass" } }, { leftovers: [] }),
    )!;
    expect(set.title).toBe("Every stage");
    expect(set.classes.map((c) => c.id)).toEqual(["holes", "XTAL"]);
    expect(set.measured).toEqual(["braggpunched", "ringremoved"]);
  });
});

describe("the background correction", () => {
  it("shades the judged |Q| band, amber with a pedestal left", () => {
    const flat = (pedestal: boolean) => step("assess_stage", { stage: "flatten" }, { flatten: { floor_judged_q: [1.234, 5.678], pedestal_left: pedestal } });
    expect(overlaysOf(flat(false))!.items).toEqual([{ kind: "band", cls: "judged", q0: 1.234, q1: 5.678 }]);
    const set = overlaysOf(flat(true))!;
    expect(set.items).toEqual([{ kind: "band", cls: "pedestal", q0: 1.234, q1: 5.678 }]);
    expect(set.where).toBe("judged |Q| 1.23–5.68 Å⁻¹ · pedestal left");
    expect(set.views).toEqual({ flattened: "primary", backfilled: "reading" });
  });
  it("draws nothing without a judged band", () => {
    expect(overlaysOf(step("assess_stage", { stage: "flatten" }, { flatten: { floor_judged_q: null } }))).toBeNull();
  });
});

describe("the coverage", () => {
  it("hatches outside the counts, with their edges, the reach and the suggested band", () => {
    const r = { raw_counts: { q_min_edge: 0.3, q_max_edge: 7.2, fully_measured: [0.5, 6.4] }, transform_reach_q: 8.1, suggested_band: [0.3, 7.2] };
    const set = overlaysOf(step("qmax_coverage", {}, r))!;
    expect(set.items).toEqual([
      { kind: "hatch", cls: "unmeasured", inside: 0.3, outside: 7.2 },
      { kind: "shell", cls: "edges", q: 0.3 },
      { kind: "shell", cls: "edges", q: 7.2 },
      { kind: "shell", cls: "reach", q: 8.1 },
      { kind: "shell", cls: "band", q: 0.3 },
      { kind: "shell", cls: "band", q: 7.2 },
    ]);
    expect(set.where).toBe("counts 0.3–7.2 Å⁻¹ · reach 8.1 Å⁻¹");
    expect(set.views).toEqual({ raw: "primary" });
  });
  it("from the origin, no inner hatch", () => {
    const set = overlaysOf(step("qmax_coverage", {}, { raw_counts: { q_min_edge: 0, q_max_edge: 7.2 }, transform_reach_q: null, suggested_band: null }))!;
    expect(set.items).toEqual([
      { kind: "hatch", cls: "unmeasured", inside: null, outside: 7.2 },
      { kind: "shell", cls: "edges", q: 7.2 },
    ]);
  });
});

describe("a step", () => {
  it("keys by its content", () => {
    const s = step("qmax_coverage", {}, { a: 1 });
    expect(stepKey(s)).toBe(stepKey({ ...s, id: "3:other" } as AgentStep));
    expect(stepKey(s)).not.toBe(stepKey({ ...s, result: "{}" }));
  });
  it("draws nothing from an error, or a tool with none", () => {
    expect(overlaysOf({ ...step("qmax_coverage", {}, {}), status: "error" })).toBeNull();
    expect(overlaysOf(step("symmetry_check", {}, { verdict: "pass" }))).toBeNull();
  });
  it("names what a running step examines", () => {
    expect(examining({ name: "assess_stage", args: { stage: "punch" } })).toEqual({ title: "Bragg punch", views: { braggpunched: "primary", raw: "reading" } });
    expect(examining({ name: "symmetry_check", args: {} })).toEqual({ title: "Symmetry", views: {} });
    expect(examining({ name: "read_skill", args: {} })).toBeNull();
    expect(examining({ name: "run_pipeline", args: {} })).toBeNull();
  });
});

describe("v2: the Bragg peaks", () => {
  const result = {
    n_peaks: 120,
    sorted_by: "significance",
    peaks: {
      cols: ["hkl", "q", "significance", "resolution_limited"],
      rows: [
        [[2, 0, 0], 3.2, 40, [true, false, false]],
        [[1, 1, 1], 2.8, 30, [false, false, false]],
        [[0, 0, 2], 3.2, 20, null],
      ],
    },
  };
  const fp = (hkl: [number, number, number]) => ({ hkl, widths: [0.02, 0.03, 0.04] as [number, number, number], principal: null, dirs: null });

  it("draws each listed peak's footprint: resolution-limited on an axis, broadened, not measured; the first 8 named", () => {
    const set = overlaysOf(step("bragg_peaks", {}, result, { braggPeaks: [fp([2, 0, 0]), fp([1, 1, 1]), fp([0, 0, 2])] }))!;
    expect(set.title).toBe("Bragg peaks");
    expect(set.where).toBe("3 of 120 peaks by significance · 1 resolution-limited · 1 broadened · 1 not measured");
    expect(set.items.map((i) => [i.kind, i.cls, "label" in i ? i.label : null])).toEqual([
      ["footprint", "fpRes", "2 0 0"],
      ["footprint", "fpBroad", "1 1 1"],
      ["footprint", "fpNone", "0 0 2"],
    ]);
    expect(set.views).toEqual({ bragg: "primary", raw: "reading" });
    expect(set.measured).toEqual(["braggpunched"]);
  });

  it("without the fits beside the result, a spot at each peak", () => {
    const set = overlaysOf(step("bragg_peaks", {}, result))!;
    expect(set.items.every((i) => i.kind === "spot")).toBe(true);
  });

  it("draws nothing without a profile", () => {
    expect(overlaysOf(step("bragg_peaks", {}, { has_profile: false }))).toBeNull();
  });
});

describe("v2: the ΔPDF features", () => {
  const result = {
    grouped_by: "point group",
    features: [
      { length_A: 2.76, size_sigma: 1520, n_vectors: 2, vectors_A: [[2.76, 0, 0], [0, 2.76, 0]] },
      { length_A: 3.9, size_sigma: -40, n_vectors: 1, vectors_A: [[3.9, 0, 0]] },
    ],
    threshold_sigma: 5,
    extrema_above_threshold: 31,
  };

  it("a ring at every vector and its opposite, + red and − blue, named by length", () => {
    const set = overlaysOf(step("dpdf_peaks", {}, result))!;
    expect(set.where).toBe("2 features of 31 extrema above 5σ · strongest + at 2.76 Å, 1520σ");
    const spots = set.items.filter((i) => i.kind === "spot");
    expect(spots).toHaveLength(6);
    expect(spots.slice(0, 2)).toEqual([
      { kind: "spot", cls: "dpos", at: [2.76, 0, 0], size: 1520, label: "2.76 Å" },
      { kind: "spot", cls: "dpos", at: [-2.76, 0, 0], size: 1520, label: "2.76 Å" },
    ]);
    expect(spots.filter((i) => i.cls === "dneg")).toHaveLength(2);
    expect(set.views).toEqual({ delta_pdf: "primary" });
  });

  it("every vector the backend gave, where the data beside the result holds them", () => {
    const dpdfVectors = [{ v: [1, 2, 3] as [number, number, number], size: 9, length: 3.74, rank: 0 }];
    const set = overlaysOf(step("dpdf_peaks", {}, result, { dpdfVectors }))!;
    expect(set.items.map((i) => (i.kind === "spot" ? i.at : null))).toEqual([[1, 2, 3], [-1, -2, -3]]);
  });
});

describe("v2: the UB turn", () => {
  const ub = [[1.6, 0, 0], [0, 1.6, 0], [0, 0, 1.6]];
  // A turn of 0.01 rad about z: fitted = R · ub.
  const t = 0.01;
  const fitted = [[1.6 * Math.cos(t), -1.6 * Math.sin(t), 0], [1.6 * Math.sin(t), 1.6 * Math.cos(t), 0], [0, 0, 1.6]];

  it("ω from the two UBs: the turn alone", () => {
    const w = ubOmega(ub, fitted)!;
    expect(w[0]).toBeCloseTo(0, 9);
    expect(w[1]).toBeCloseTo(0, 9);
    expect(w[2]).toBeCloseTo(Math.sin(t), 9);
    // A cell's change alone (symmetric) turns nothing.
    expect(Math.hypot(...ubOmega(ub, [[1.7, 0, 0], [0, 1.6, 0], [0, 0, 1.6]])!)).toBe(0);
  });

  it("maps ub_check to arrows on the raw view and the Bragg page", () => {
    const r = { verdict: "x", orientation_change_deg: 0.573, axis_uvw: [0, 0, 1], rms_start: 0.012, rms: 0.004 };
    const set = overlaysOf(step("ub_check", {}, r, { ubTurn: { ub, fitted, cell: [1, 1, 1] } }))!;
    expect(set.where).toBe("turned 0.573° about [0 0 1] · RMS 0.012 → 0.004 Å⁻¹");
    expect(set.items).toHaveLength(1);
    expect(set.items[0]).toMatchObject({ kind: "turn", cls: "turn", cell: [1, 1, 1] });
    expect(set.views).toEqual({ raw: "primary", bragg: "reading" });
    // No turn (a symmetrised volume's fit), or no UBs beside the result: nothing.
    expect(overlaysOf(step("ub_check", {}, r, { ubTurn: { ub, fitted: ub, cell: [1, 1, 1] } }))).toBeNull();
    expect(overlaysOf(step("ub_check", {}, r))).toBeNull();
  });
});

describe("v2: the fill's holes", () => {
  it("▲ above and ▼ below their range, drawn on the cuts through each", () => {
    const fillHoles = {
      nHoles: 300,
      holes: [
        { hkl: [1, 0, 0] as [number, number, number], bias: 2, biasSigma: 6.1, voxels: 27 },
        { hkl: [0, 2, 0] as [number, number, number], bias: -1, biasSigma: -4, voxels: 1 },
      ],
    };
    const set = overlaysOf(step("texture_check", {}, { systematic_fill_bias: false, n_judged: 280 }, { fillHoles }))!;
    expect(set.where).toBe("no systematic fill bias · 1 filled above their range, 1 below (of 280 judged)");
    expect(set.items).toEqual([
      { kind: "spot", cls: "fillUp", at: [1, 0, 0], size: 6.1, tolVoxels: 1.5, label: "+6.1σ" },
      { kind: "spot", cls: "fillDown", at: [0, 2, 0], size: 4, tolVoxels: 0.5, label: "−4σ" },
    ]);
    expect(set.views).toEqual({ backfilled: "primary", braggpunched: "reading" });
    expect(overlaysOf(step("texture_check", {}, { systematic_fill_bias: false }, { fillHoles: { nHoles: 3, holes: [] } }))).toBeNull();
  });
});

describe("v2: the grains", () => {
  const r = { judged: 40, near_bragg_nodes: 2, far: [{ hkl: [0.5, 0.5, 0], q: 1, offset_q: 0.4 }], rotated_copy: { indexed: 31, misorientation_deg: 12.5 }, random_control: 3 };
  it("✕ at every image of the far orbits; the rotated copy's nodes where it explains them", () => {
    const map = [[0.98, -0.2, 0], [0.2, 0.98, 0], [0, 0, 1]];
    const set = overlaysOf(step("grain_check", {}, r, { grains: { far: [[0.5, 0.5, 0], [-0.5, 0.5, 0]], rotated: map } }))!;
    expect(set.where).toBe("a rotated copy indexes 31 of 40 orbits (random 3), 12.5° off · 1 far from any node");
    expect(set.items).toEqual([
      { kind: "spot", cls: "far", at: [0.5, 0.5, 0], size: 1 },
      { kind: "spot", cls: "far", at: [-0.5, 0.5, 0], size: 1 },
      { kind: "lattice", cls: "rotated", map },
    ]);
  });
  it("from the result alone, the far orbits it lists", () => {
    const set = overlaysOf(step("grain_check", {}, r))!;
    expect(set.items).toEqual([{ kind: "spot", cls: "far", at: [0.5, 0.5, 0], size: 1 }]);
  });
});

describe("v2: a line profile", () => {
  it("the line on its stage's view", () => {
    const r = { stage: "flattened", along: "H", through: { K: 0.333, L: 0 }, units: "r.l.u.", max: { at: 1, value: 3.2 } };
    const set = overlaysOf(step("line_profile", { stage: "flattened", along: "H" }, r))!;
    expect(set.where).toBe("flattened along H at K = 0.333, L = 0 · max 3.2 at 1");
    expect(set.items).toEqual([{ kind: "line", cls: "line", along: 0, through: [0, 0.333, 0] }]);
    expect(set.classes[0].views).toEqual({ flattened: "full" });
    expect(set.views).toEqual({ flattened: "primary" });
  });
  it("on the ΔPDF, x y z", () => {
    const r = { stage: "delta_pdf", along: "z", through: { x: 1.5, y: 0 } };
    expect(overlaysOf(step("line_profile", {}, r))!.items).toEqual([{ kind: "line", cls: "line", along: 2, through: [1.5, 0, 0] }]);
  });
});

describe("v2: what runs", () => {
  it("names the v2 tools and the views they read", () => {
    expect(examining({ name: "bragg_peaks", args: {} })).toEqual({ title: "Bragg peaks", views: { bragg: "primary", raw: "reading" } });
    expect(examining({ name: "dpdf_peaks", args: {} })).toEqual({ title: "ΔPDF features", views: { delta_pdf: "primary" } });
    expect(examining({ name: "line_profile", args: { stage: "raw" } })).toEqual({ title: "A line profile", views: { raw: "primary" } });
  });
  it("names an hkl", () => {
    expect(hklLabel([2, 0, -1])).toBe("2 0 -1");
    expect(hklLabel([1.5, 0.3333, 0])).toBe("1.5 0.33 0");
  });
});
