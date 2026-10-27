// The Pilot's region marks as the console keeps and shows them (Linear
// THY-44): the plan for a mark on the cleanup page and on the 3D-ΔPDF page
// (the plane and cut that cross it, the views it is drawn on, the zoom), its
// refusals, what showing a mark does to the views, and the mark store: ids,
// hide and clear, a reload, and what it reads back from storage or a file.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MarkRegion } from "../../components/regionMark";
import { openView } from "../../llm/tools/openView";
import { useDatasetStore } from "../datasetStore";
import { useDpdfStore } from "../dpdfStore";
import { readMark, readMarks, regionText, shortLabel, useMarkStore, visibleMarks, type Mark } from "../markStore";
import { markPlaneLabel, placeMark, planMark, showMark, type MarkSpec, type MarkVolume, type ViewsNow } from "../marks";
import { useNavStore } from "../navStore";
import { useViewerStore } from "../viewerStore";

const ALL = ["raw", "ringremoved", "braggpunched", "backfilled", "flattened", "delta_pdf"];

// A tetragonal reciprocal grid (a = b = 4 Å, c = 8 Å): H, K ±4 in 0.02, L ±2 in 0.05.
const RECIP: MarkVolume = {
  grid: { ranges: [[-4, 4], [-4, 4], [-2, 2]], shape: [401, 401, 81], names: ["H", "K", "L"], unit: "r.l.u." },
  cell: { a: 4, b: 4, c: 8 },
  outputs: ALL,
};
// A hexagonal ΔPDF (γ = 120°): ±20 Å in 0.5 Å steps.
const DPDF: MarkVolume = {
  grid: { ranges: [[-20, 20], [-20, 20], [-20, 20]], shape: [81, 81, 81], names: ["x", "y", "z"], unit: "Å" },
  cell: { a: 5, b: 5, c: 8, alpha: 90, beta: 90, gamma: 120 },
  outputs: ALL,
};
const NOW: ViewsNow = { fixedAxis: "L", views: {}, dpdfViews: {} };
const spec = (where: MarkSpec["where"], region: MarkRegion, label = "satellites"): MarkSpec => ({ where, region, label, evidence: ["dpdf_peaks"] });
const SATELLITES: MarkRegion = { shape: "points", points: [[1.25, 0, 0], [0.75, 0, 0]] };

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

beforeEach(() => {
  useMarkStore.setState({ marks: [], next: 1, showAll: true, layoutRequest: null });
  useViewerStore.setState(useViewerStore.getInitialState(), true);
  useDpdfStore.setState(useDpdfStore.getInitialState(), true);
  useNavStore.setState({ tab: "config" });
});

describe("planMark on the cleanup page", () => {
  it("cuts points on the plane that holds them all and draws them on every stage's view", () => {
    const plan = planMark(spec("flatten", SATELLITES), RECIP, { ...NOW, fixedAxis: "H" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // Both satellites lie on K = 0 and on L = 0; the current axis (H) holds one only, and L comes first among the rest.
    expect(plan.view).toMatchObject({ page: "cleanup", axis: "L" });
    expect(plan.view.page === "cleanup" && plan.view.value).toBeCloseTo(0, 12);
    expect(plan.drawn).toEqual([
      { view: "H–K plane at L = 0", plane: "hk0", cut: plan.view.page === "cleanup" ? plan.view.value : NaN, stages: ["raw", "rings", "punch", "backfill", "flatten"], points: 2 },
    ]);
    expect(plan.missed).toEqual([]);
    expect(plan.clipped).toEqual([]);
  });

  it("keeps the current plane when it holds as many points as any", () => {
    const plan = planMark(spec("flatten", SATELLITES), RECIP, { ...NOW, fixedAxis: "K" });
    expect(plan.ok && plan.view.page === "cleanup" && plan.view.axis).toBe("K");
  });

  it("cuts a region across its thinnest axis in Å⁻¹, so the view shows its widest section", () => {
    // Half-widths (0.1, 0.1, 0.1) r.l.u. are 2π·0.1/4, 2π·0.1/4 and 2π·0.1/8 Å⁻¹: thinnest along L.
    const plan = planMark(spec("raw", { shape: "ellipsoid", center: [1, 0, 0.51], half: [0.1, 0.1, 0.1] }), RECIP, { ...NOW, fixedAxis: "H" });
    expect(plan.ok).toBe(true);
    if (!plan.ok || plan.view.page !== "cleanup") return;
    expect(plan.view.axis).toBe("L");
    // Snapped to the grid, as the page snaps its cut: 0.51 → 0.5.
    expect(plan.view.value).toBeCloseTo(0.5, 12);
    expect(plan.drawn[0].view).toBe("H–K plane at L = 0.5");
  });

  it("zooms to a small region, in the page's display units (Å⁻¹)", () => {
    const plan = planMark(spec("flatten", { shape: "box", center: [1, 1, 0], half: [0.05, 0.05, 0.05] }), RECIP, NOW);
    expect(plan.ok).toBe(true);
    if (!plan.ok || plan.view.page !== "cleanup") return;
    expect(plan.zoomed).toBe(true);
    const s = (2 * Math.PI) / 4;
    expect(plan.view.viewport!.cx).toBeCloseTo(1 * s, 12);
    expect(plan.view.viewport!.cy).toBeCloseTo(1 * s, 12);
    // A box 0.1 r.l.u. wide, 2.5 times over, or 6 % of the full view (±4 r.l.u.).
    expect(plan.view.viewport!.half).toBeCloseTo(Math.max(0.05 * s * 2.5, 4 * s * 0.06), 12);
  });

  it("leaves the zoom alone when the region already shows well", () => {
    const plan = planMark(spec("flatten", { shape: "box", center: [0, 0, 0], half: [2, 2, 0.5] }), RECIP, NOW);
    expect(plan.ok && plan.view.page === "cleanup" && plan.view.viewport).toBeNull();
    expect(plan.ok && plan.zoomed).toBe(false);
  });

  it("refuses a stage the dataset has no output for, naming those it has", () => {
    const plan = planMark(spec("flatten", SATELLITES), { ...RECIP, outputs: ["raw", "ringremoved"] }, NOW);
    expect(plan).toEqual({ ok: false, reason: "the flatten stage has no output for this dataset yet (the cleanup page shows raw, rings); run the pipeline first" });
  });

  it("refuses a region outside the volume, and an empty one", () => {
    const out = planMark(spec("raw", { shape: "box", center: [0, 0, 3], half: [0.1, 0.1, 0.2] }), RECIP, NOW);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/^the box \(L 2.8 to 3.2\) is outside the volume: the volume spans H -4 to 4 r.l.u./);
    const empty = planMark(spec("raw", { shape: "box", center: [0, 0, 0], half: [0.1, 0, 0.1] }), RECIP, NOW);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.reason).toMatch(/box is empty/);
  });

  it("reports what the volume cut off", () => {
    const plan = planMark(spec("raw", { shape: "box", center: [3.9, 0, 0], half: [0.3, 0.1, 0.1] }), RECIP, NOW);
    expect(plan.ok && plan.clipped).toEqual(["H 3.6 to 4.2 cut to 3.6 to 4.01 r.l.u."]);
  });
});

describe("planMark on the 3D-ΔPDF page", () => {
  it("cuts the three sections through a region's centre and draws it on each", () => {
    const plan = planMark(spec("pdf", { shape: "ellipsoid", center: [2.5, 0, 4], half: [1, 1, 1] }), DPDF, NOW);
    expect(plan.ok).toBe(true);
    if (!plan.ok || plan.view.page !== "dpdf") return;
    expect(plan.view.index).toEqual([45, 40, 48]);
    expect(plan.drawn.map((d) => d.view)).toEqual(["ΔPDF x–y section at z = 4 Å", "ΔPDF x–z section at y = 0 Å", "ΔPDF y–z section at x = 2.5 Å"]);
    expect(plan.missed).toEqual([]);
  });

  it("counts the points each section holds: the x cut holds one of a pair along x", () => {
    const plan = planMark(spec("pdf", { shape: "points", points: [[2.5, 0, 0], [-2.5, 0, 0]] }), DPDF, NOW);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.drawn.map((d) => [d.plane, d.points])).toEqual([["xy", 2], ["xz", 2], ["yz", 1]]);
    expect(plan.missed).toEqual([]);
  });

  it("frames an oblique (120°) section by the region's true extent on screen", () => {
    // A box 1 Å along a and along b, centred at (10, 10): drawn as a parallelogram whose
    // centre is at X = 10 + 10·cos 120° = 5, Y = 10·sin 120°.
    const plan = planMark(spec("pdf", { shape: "box", center: [10, 10, 0], half: [0.5, 0.5, 0.5] }), DPDF, NOW);
    expect(plan.ok).toBe(true);
    if (!plan.ok || plan.view.page !== "dpdf") return;
    const xy = plan.view.views.xy!;
    expect(xy.cx).toBeCloseTo(5, 9);
    expect(xy.cy).toBeCloseTo(10 * Math.sin((2 * Math.PI) / 3), 9);
    expect(plan.zoomed).toBe(true);
  });

  it("refuses a dataset without a ΔPDF", () => {
    const plan = planMark(spec("pdf", { shape: "points", points: [[1, 0, 0]] }), { ...DPDF, outputs: ["raw"] }, NOW);
    expect(plan).toEqual({ ok: false, reason: "this dataset has no 3D-ΔPDF yet; run the pipeline through the ΔPDF stage first" });
  });
});

describe("showing a mark", () => {
  it("opens the cleanup page on its plane and cut, zoomed, with its stage forward", () => {
    const s = spec("flatten", { shape: "box", center: [1, 1, 0.5], half: [0.05, 0.05, 0.05] });
    const plan = planMark(s, RECIP, NOW);
    if (!plan.ok) throw new Error(plan.reason);
    const mark = placeMark(s, plan, "ds1", new Date("2026-10-26T12:00:00Z"));
    expect(mark).toMatchObject({ id: "M1", datasetId: "ds1", where: "flatten", label: "satellites", evidence: ["dpdf_peaks"], created: "2026-10-26T12:00:00.000Z" });
    const vs = useViewerStore.getState();
    expect(vs.fixedAxis).toBe("L");
    expect(vs.focus).toEqual({ axis: "L", value: plan.view.page === "cleanup" ? plan.view.value : NaN });
    expect(vs.views.hk0).toEqual(plan.view.page === "cleanup" ? plan.view.viewport : null);
    expect(useNavStore.getState().tab).toBe("reciprocal");
    expect(useMarkStore.getState().layoutRequest).toEqual({ page: "cleanup", primary: "flattened" });
  });

  it("opens the 3D-ΔPDF page with its three cuts and the zoom of each section", () => {
    const s = spec("pdf", { shape: "box", center: [10, 10, 0], half: [0.5, 0.5, 0.5] });
    const plan = planMark(s, DPDF, NOW);
    if (!plan.ok) throw new Error(plan.reason);
    placeMark(s, plan, "ds1");
    const ds = useDpdfStore.getState();
    expect([ds.cutX, ds.cutY, ds.cutZ]).toEqual([60, 60, 40]);
    expect(ds.centered).toBe(true);
    expect(ds.views.xy).toEqual(plan.view.page === "dpdf" ? plan.view.views.xy : null);
    expect(useNavStore.getState().tab).toBe("dpdf");
  });

  it("shows a hidden mark again, with the rest, and never a mark of another dataset", () => {
    const s = spec("flatten", SATELLITES);
    const plan = planMark(s, RECIP, NOW);
    if (!plan.ok) throw new Error(plan.reason);
    const mark = placeMark(s, plan, "ds1");
    useMarkStore.getState().toggle(mark.id);
    useMarkStore.getState().setShowAll(false);
    useNavStore.setState({ tab: "config" });
    expect(showMark(useMarkStore.getState().marks[0], "ds2")).toBe(false);
    expect(useNavStore.getState().tab).toBe("config");
    expect(showMark(useMarkStore.getState().marks[0], "ds1")).toBe(true);
    expect(useMarkStore.getState().marks[0].hidden).toBeUndefined();
    expect(useMarkStore.getState().showAll).toBe(true);
  });
});

describe("the transcript's Show on a mark", () => {
  it("opens the mark by its id on the selected dataset, and nothing for a mark since removed", () => {
    const s = spec("pdf", { shape: "points", points: [[2.5, 0, 0]] });
    const plan = planMark(s, DPDF, NOW);
    if (!plan.ok) throw new Error(plan.reason);
    const mark = placeMark(s, plan, "ds1");
    useDatasetStore.setState({ datasetId: "ds1" });
    useNavStore.setState({ tab: "config" });
    openView({ view: "mark", label: `${mark.id} · ${mark.label}`, mark: mark.id });
    expect(useNavStore.getState().tab).toBe("dpdf");
    useNavStore.setState({ tab: "config" });
    useMarkStore.getState().remove(mark.id);
    openView({ view: "mark", label: "gone", mark: mark.id });
    expect(useNavStore.getState().tab).toBe("config");
  });
});

describe("the mark store", () => {
  const add = (datasetId = "ds1", label = "a ring left over") => {
    const s = spec("rings", { shape: "box", center: [0, 0, 0], half: [1, 1, 0.1] }, label);
    const plan = planMark(s, RECIP, NOW);
    if (!plan.ok) throw new Error(plan.reason);
    return placeMark(s, plan, datasetId);
  };

  it("numbers marks in order and never reuses a number once cleared", () => {
    expect([add().id, add().id]).toEqual(["M1", "M2"]);
    useMarkStore.getState().clear("ds1");
    expect(useMarkStore.getState().marks).toEqual([]);
    expect(add().id).toBe("M3");
  });

  it("clears one dataset's marks, keeping the others'", () => {
    add("ds1");
    add("ds2");
    useMarkStore.getState().clear("ds1");
    expect(useMarkStore.getState().marks.map((m) => m.datasetId)).toEqual(["ds2"]);
  });

  it("draws a dataset's shown marks: none of another dataset, none hidden, none while Hide all is on", () => {
    const a = add("ds1");
    add("ds1");
    add("ds2");
    useMarkStore.getState().toggle(a.id);
    expect(visibleMarks(useMarkStore.getState(), "ds1").map((m) => m.id)).toEqual(["M2"]);
    useMarkStore.getState().setShowAll(false);
    expect(visibleMarks(useMarkStore.getState(), "ds1")).toEqual([]);
    expect(visibleMarks(useMarkStore.getState(), undefined)).toEqual([]);
  });

  it("removes one mark", () => {
    add();
    const b = add();
    useMarkStore.getState().remove("M1");
    expect(useMarkStore.getState().marks.map((m) => m.id)).toEqual([b.id]);
  });

  it("keeps a label to one short line", () => {
    expect(shortLabel("  a ring\n left  over ")).toBe("a ring left over");
    const long = shortLabel("x".repeat(80));
    expect(long).toHaveLength(48);
    expect(long.endsWith("…")).toBe(true);
    expect(add("ds1", "y".repeat(80)).label).toHaveLength(48);
  });
});

describe("reading marks back", () => {
  const good = (): Mark => ({
    id: "M4",
    datasetId: "ds1",
    where: "pdf",
    region: { shape: "ellipsoid", center: [1, 2, 3], half: [0.5, 0.5, 0.5] },
    label: "a strong + feature",
    evidence: ["dpdf_peaks.features.0"],
    created: "2026-10-26T12:00:00.000Z",
    view: { page: "dpdf", index: [10, 20, 30], views: { xy: { cx: 1, cy: 2, half: 3 } } },
  });

  it("reads a well-formed mark as it was", () => {
    expect(readMark(JSON.parse(JSON.stringify(good())))).toEqual(good());
    expect(readMark({ ...good(), hidden: true })).toEqual({ ...good(), hidden: true });
  });

  it("refuses a mark with any part not of its type", () => {
    expect(readMark({ ...good(), id: "X1" })).toBeNull();
    expect(readMark({ ...good(), where: "elsewhere" })).toBeNull();
    expect(readMark({ ...good(), region: { shape: "box", center: [0, 0, 0], half: [0, 1, 1] } })).toBeNull();
    expect(readMark({ ...good(), region: { shape: "points", points: [[0, 0]] } })).toBeNull();
    expect(readMark({ ...good(), view: { page: "dpdf", index: [1.5, 2, 3], views: {} } })).toBeNull();
    // A ΔPDF mark must open the ΔPDF page, and a stage's the cleanup page.
    expect(readMark({ ...good(), view: { page: "cleanup", axis: "L", value: 0, viewport: null } })).toBeNull();
    expect(readMark(null)).toBeNull();
  });

  it("drops what it does not know from a mark, and a malformed zoom", () => {
    const m = readMark({ ...good(), extra: "<script>", view: { page: "dpdf", index: [1, 2, 3], views: { xy: { cx: 1, cy: 2, half: -1 }, zz: { cx: 0, cy: 0, half: 1 } } } });
    expect(m).not.toHaveProperty("extra");
    expect(m?.view).toEqual({ page: "dpdf", index: [1, 2, 3], views: {} });
  });

  it("reads each id once, the first", () => {
    expect(readMarks([good(), { ...good(), label: "again" }, "junk"]).map((m) => m.label)).toEqual(["a strong + feature"]);
    expect(readMarks("junk")).toEqual([]);
  });

  it("restores a saved list, numbering on after it", () => {
    useMarkStore.setState({ next: 2 });
    useMarkStore.getState().restore([good(), { junk: true }]);
    expect(useMarkStore.getState().marks.map((m) => m.id)).toEqual(["M4"]);
    expect(useMarkStore.getState().next).toBe(5);
  });
});

describe("a reload keeps the marks", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("saves them to sessionStorage and reads them back, with the next number and Hide all", async () => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    vi.resetModules();
    const first = await import("../markStore");
    first.useMarkStore.getState().add({
      datasetId: "ds1",
      where: "raw",
      region: SATELLITES,
      label: "pair",
      evidence: ["line_profile"],
      created: "",
      view: { page: "cleanup", axis: "L", value: 0, viewport: null },
    });
    first.useMarkStore.getState().setShowAll(false);
    vi.resetModules();
    const again = await import("../markStore");
    const s = again.useMarkStore.getState();
    expect(s.marks.map((m) => [m.id, m.label])).toEqual([["M1", "pair"]]);
    expect(s.next).toBe(2);
    expect(s.showAll).toBe(false);
  });

  it("starts empty without storage", async () => {
    vi.stubGlobal("sessionStorage", undefined);
    vi.resetModules();
    const { useMarkStore: store } = await import("../markStore");
    expect(store.getState().marks).toEqual([]);
  });
});

describe("markPlaneLabel", () => {
  it("words a plane as the tools word a cut", () => {
    expect(markPlaneLabel("0kl", 1)).toBe("K–L plane at H = 1");
    expect(markPlaneLabel("h0l", -0.33333)).toBe("H–L plane at K = -0.3333");
    expect(markPlaneLabel("yz", 2.5)).toBe("ΔPDF y–z section at x = 2.5 Å");
  });
});

describe("regionText", () => {
  it("words a region for the panel's tooltip, in its space's unit", () => {
    expect(regionText({ shape: "ellipsoid", center: [1, 0, 0.5], half: [0.1, 0.1, 0.05] }, "flatten")).toBe("Ellipsoid at (1, 0, 0.5) r.l.u., half-widths (0.1, 0.1, 0.05)");
    expect(regionText({ shape: "points", points: [[2.5, 0, 0]] }, "pdf")).toBe("1 point: (2.5, 0, 0) Å");
  });
});
