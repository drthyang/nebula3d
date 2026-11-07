// The overlay registry and each v1 mapper (examine/overlays.ts), on synthetic
// results: every measuring tool has a mapper, an explicit none, or the PR that
// adds it; each mapper's items from the fields it reads.

import { describe, expect, it } from "vitest";

import type { AgentStep } from "../../agent";
import { toolsWhere } from "../../tools";
import type { OverlayData } from "../data";
import { examining, fccLines, leftoverClass, OVERLAYS, overlaysOf, parseStageShells, ringShells, stepKey } from "../overlays";

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
  it("draws for v1's three tools alone", () => {
    expect(Object.entries(OVERLAYS).filter(([, e]) => typeof e === "function").map(([n]) => n).sort()).toEqual([
      "assess_stage",
      "measure_reciprocal_cut",
      "qmax_coverage",
    ]);
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
    expect(set.where).toBe("1 missed at nodes · 2 sharp off-lattice · 1 broad kept, over the three planes");
    expect(set.items.filter((i) => i.kind === "peak")).toHaveLength(5);
    expect([count(set.items, "node"), count(set.items, "sharp"), count(set.items, "broad"), count(set.items, "protected")]).toEqual([1, 2, 1, 1]);
    expect(count(set.items, "holes")).toBe(1);
    expect(set.items.find((i) => i.kind === "voxels")).toMatchObject({ cls: "r2", hkl: [0, 0.1, 2, 0, -0.1, 2] });
    expect(set.classes.map((c) => c.id)).toEqual(["node", "sharp", "broad", "protected", "holes", "r2"]);
    expect(set.views).toEqual({ braggpunched: "primary", raw: "reading" });
    expect(set.measured).toEqual(["braggpunched"]);
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

  it("lists an fcc lattice's lines (h, k, l unmixed)", () => {
    const lines = fccLines(4.0495, 6.3);
    expect(lines.map((l) => l.hkl)).toEqual(["111", "200", "220", "311", "222", "400"]);
    expect(lines[0].q).toBeCloseTo((2 * Math.PI * Math.sqrt(3)) / 4.0495, 6);
  });

  it("codes each shell: LEFT, GRID, NJ, AL, XTAL, one per |Q|", () => {
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
    const shells = ringShells(rings, { ringsAtGrid: [6.1] });
    const byQ = (q: number) => shells.find((s) => Math.abs(s.q - q) < 0.05)?.cls;
    expect(byQ(1.41)).toBe("XTAL");
    expect(byQ(q111)).toBe("GRID"); // left by the stage on its grid, an Al line though it is
    expect(shells.find((s) => Math.abs(s.q - q200) < 0.05)).toMatchObject({ cls: "LEFT", tick: "up" });
    expect(byQ(4.8)).toBe("NJ");
    expect(byQ(5.5)).toBe("NJ");
    expect(byQ(6.1)).toBe("GRID");
    expect(byQ((2 * Math.PI * Math.sqrt(8)) / a)).toBe("AL"); // 220: an Al line, not left
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

  it("leaves out a confirmed ring the removal took out cleanly", () => {
    const rings = { shells_judged: [{ at: 2.5, ring: true }], per_plane: { hk0: { ring_residuals: [{ at: 2.5, residual_fraction: 0.001, significant: false }] } } };
    expect(ringShells(rings)).toEqual([]);
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
