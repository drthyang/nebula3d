import { describe, expect, it } from "vitest";

import type { PairSignal } from "../../api/pairSignal";
import { COLORMAPS, DIVERGING_NAMES } from "../../colormaps/luts";
import type { Site } from "../cif";
import { NEST_RADIUS, nestRadii, OPEN_DISC } from "../glyphs";
import { expandSites, pairDifferences, pairVectors, sliceMarkers, type Marker } from "../pairs";
import {
  countsText,
  FILL_ABOVE,
  fillColors,
  glyphRadius,
  markerSpots,
  nestGlyphs,
  readSignal,
  signalCounts,
  signalState,
  signalText,
  spotBatches,
  stateStyle,
  visibleVectors,
  type BatchOptions,
  type Reading,
  type SignalSource,
} from "../signal";
import { symmetryGroup } from "../symops";

/** A table of values: per difference the first translation, the counts and the values in order. */
function table(blocks: { first: [number, number, number]; count: [number, number, number]; values: number[] }[], extra: Partial<PairSignal> = {}): PairSignal {
  const t = new Int32Array(blocks.length * 6);
  const offsets = new Float64Array(blocks.length);
  const values: number[] = [];
  blocks.forEach((b, k) => {
    t.set([...b.first, ...b.count], 6 * k);
    offsets[k] = values.length;
    expect(b.values).toHaveLength(b.count[0] * b.count[1] * b.count[2]);
    values.push(...b.values);
  });
  return {
    sigma: 0.02,
    originRadius: 2,
    skipped: null,
    nValues: values.length,
    maxValues: 8_000_000,
    table: t,
    offsets,
    values: Float32Array.from(values),
    ...extra,
  };
}

const value = (v: number): Reading => ({ value: v, why: null });

describe("readSignal", () => {
  // Two differences: one with translations −1..0 along a, one with a single translation.
  const sig = table([
    { first: [-1, 0, 0], count: [2, 1, 3], values: [1, 2, 3, 4, Number.NaN, 6] },
    { first: [2, -1, 0], count: [1, 1, 1], values: [-7.5] },
  ]);

  it("reads the value kept for a difference's translation", () => {
    expect(readSignal(sig, 0, [-1, 0, 0])).toEqual(value(1));
    expect(readSignal(sig, 0, [-1, 0, 2])).toEqual(value(3));
    expect(readSignal(sig, 0, [0, 0, 0])).toEqual(value(4));
    expect(readSignal(sig, 0, [0, 0, 2])).toEqual(value(6));
    expect(readSignal(sig, 1, [2, -1, 0])).toEqual(value(-7.5));
  });

  it("has no value inside the origin's disk or outside the volume, and says which", () => {
    expect(readSignal(sig, 0, [0, 0, 1])).toEqual({ value: null, why: "origin" });
    expect(readSignal(sig, 0, [1, 0, 0])).toEqual({ value: null, why: "outside" });
    expect(readSignal(sig, 0, [-2, 0, 0])).toEqual({ value: null, why: "outside" });
    expect(readSignal(sig, 1, [2, 0, 0])).toEqual({ value: null, why: "outside" });
    expect(readSignal(sig, 2, [0, 0, 0])).toEqual({ value: null, why: "outside" });
  });

  it("has no value while the table is read, or when there is none", () => {
    expect(readSignal("pending", 0, [0, 0, 0])).toEqual({ value: null, why: "pending" });
    expect(readSignal("failed", 0, [0, 0, 0])).toEqual({ value: null, why: "failed" });
    expect(readSignal({ ...sig, skipped: "too_many" }, 0, [0, 0, 0])).toEqual({ value: null, why: "too_many" });
    expect(readSignal({ ...sig, sigma: null }, 0, [0, 0, 0])).toEqual({ value: null, why: "flat" });
  });
});

describe("signalState", () => {
  it("fills at or above the threshold, by sign", () => {
    expect(signalState(value(6.2), 3)).toBe("pos");
    expect(signalState(value(3), 3)).toBe("pos");
    expect(signalState(value(-7.4), 3)).toBe("neg");
    expect(signalState(value(-3), 3)).toBe("neg");
  });

  it("leaves a value below it hollow, and a marker without a value as no signal", () => {
    expect(signalState(value(2.99), 3)).toBe("quiet");
    expect(signalState(value(-1.1), 3)).toBe("quiet");
    expect(signalState(value(4), 4.5)).toBe("quiet");
    expect(signalState({ value: null, why: "origin" }, 3)).toBe("none");
    expect(signalState({ value: null, why: "outside" }, 3)).toBe("none");
  });
});

describe("signalText", () => {
  it("gives the value and what its sign means", () => {
    expect(signalText(value(6.2), 3)).toBe("ΔPDF +6.2σ: more common than in the average structure");
    expect(signalText(value(-7.4), 3)).toBe("ΔPDF −7.4σ: rarer than in the average structure");
    expect(signalText(value(1.1), 3)).toBe("ΔPDF +1.1σ: nothing above 3σ");
    expect(signalText(value(-2.4), 3.5)).toBe("ΔPDF −2.4σ: nothing above 3.5σ");
    expect(signalText(value(4.2), 4.5)).toBe("ΔPDF +4.2σ: nothing above 4.5σ");
  });

  it("never prints a quiet value as the threshold it is below", () => {
    expect(signalText(value(2.96), 3)).toBe("ΔPDF +2.96σ: nothing above 3σ");
    expect(signalText(value(-2.999), 3)).toBe("ΔPDF −2.99σ: nothing above 3σ");
    expect(signalText(value(0.01), 3)).toBe("ΔPDF 0.0σ: nothing above 3σ");
    expect(signalText(value(-0.04), 3)).toBe("ΔPDF 0.0σ: nothing above 3σ");
  });

  it("says why a marker has no value", () => {
    expect(signalText({ value: null, why: "origin" }, 3, 2)).toBe("ΔPDF not read: inside the origin peak (|u| < 2.0 Å)");
    expect(signalText({ value: null, why: "origin" }, 3)).toBe("ΔPDF not read: inside the origin peak");
    expect(signalText({ value: null, why: "outside" }, 3)).toBe("ΔPDF not read: outside the volume");
    expect(signalText({ value: null, why: "pending" }, 3)).toBe("ΔPDF: reading…");
    expect(signalText({ value: null, why: "too_many" }, 3)).toBe("ΔPDF not read: too many vectors in this volume");
    expect(signalText({ value: null, why: "flat" }, 3)).toBe("ΔPDF not read: the volume has no spread");
    expect(signalText({ value: null, why: "failed" }, 3)).toBe("ΔPDF not read: the request failed");
  });
});

describe("nesting", () => {
  // Elements in site order; the eighth element's shape is the cross, the seventh's the plus.
  const elements = ["Mn", "O", "Na", "K", "Li", "Fe", "Co", "Ni"];

  it("draws glyphs around one point a step apart, wider where a shape needs the room", () => {
    expect(nestRadii(["circle"])).toEqual([NEST_RADIUS]);
    expect(nestRadii(["circle", "circle", "circle"])).toEqual([5.5, 10.5, 15.5]);
    expect(nestRadii(["circle", "square"])).toEqual([5.5, 10.5]);
    // A triangle's sides pass close to its centre: it must grow to clear the circle.
    const [inner, outer] = nestRadii(["circle", "triangle"]);
    expect(outer * 0.57 - inner).toBeGreaterThan(3);
    // An open shape reaches as far as the disc its fill is drawn on.
    const [plus, ring] = nestRadii(["plus", "circle"]);
    expect(ring - plus * OPEN_DISC).toBeGreaterThan(3);
  });

  it("keeps the legend's order, the open shapes innermost", () => {
    const g = nestGlyphs(["Mn–Mn", "Mn–O", "O–Ni"], elements);
    expect(g.map((x) => x.key)).toEqual(["O–Ni", "Mn–Mn", "Mn–O"]);
    expect(g.map((x) => x.shape)).toEqual(["cross", "circle", "square"]);
    expect(g[0].r).toBe(NEST_RADIUS);
    expect(g[1].r).toBeGreaterThan(g[0].r);
    expect(g[2].r).toBeGreaterThan(g[1].r);
    expect(nestGlyphs(["Mn–O"], elements)).toEqual([{ key: "Mn–O", shape: "square", color: "#3987e5", r: NEST_RADIUS }]);
  });
});

// Rock salt: Na–Na and Cl–Cl share every fcc vector, Na–Cl has its own.
const A = 5.64;
const NACL: Site[] = [
  { label: "Na1", element: "Na", x: 0, y: 0, z: 0, occ: 1 },
  { label: "Cl1", element: "Cl", x: 0.5, y: 0.5, z: 0.5, occ: 1 },
];
const ELEMENTS = ["Na", "Cl"];
const KEYS = ["Na–Na", "Na–Cl", "Cl–Cl"];
const diffs = pairDifferences(expandSites(NACL, symmetryGroup("-x,-y,z; -x,y,-z; z,x,y; y,x,-z; -x,-y,-z", "F")));
const markers = sliceMarkers(diffs, { lat: [A, A, A], axes: [0, 1, 2], cut: 0, depth: 0.01, hRange: [-A, A], vRange: [-A, A], origin: null, hidden: new Set() });
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const spotAt = (source: SignalSource, h: number, v: number, ms: Marker[] = markers) =>
  markerSpots(ms, source, ELEMENTS, KEYS).find((s) => near(s.h, h) && near(s.v, v))!;

/** A table that gives every translation of every difference within ±2 cells the value `f(vec, n)`. */
function uniform(f: (vec: number, n: [number, number, number]) => number): PairSignal {
  const nVec = pairVectors(diffs).length / 3;
  return table(
    Array.from({ length: nVec }, (_, k) => {
      const values: number[] = [];
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let c = -2; c <= 2; c++) values.push(f(k, [a, b, c]));
      return { first: [-2, -2, -2] as [number, number, number], count: [5, 5, 5] as [number, number, number], values };
    }),
  );
}

describe("pair differences as vectors", () => {
  it("numbers the distinct differences, shared by the element pairs at one vector", () => {
    const vectors = pairVectors(diffs);
    // fcc differences (4, the zero one among them) and the four Na–Cl ones.
    expect(vectors.length / 3).toBe(8);
    for (const p of diffs) expect([vectors[3 * p.vec], vectors[3 * p.vec + 1], vectors[3 * p.vec + 2]]).toEqual(p.d.map((x) => expect.closeTo(x, 9)));
    const nana = diffs.find((p) => p.key === "Na–Na" && near(p.d[0], 0.5) && near(p.d[1], 0.5) && near(p.d[2], 0))!;
    const clcl = diffs.find((p) => p.key === "Cl–Cl" && near(p.d[0], 0.5) && near(p.d[1], 0.5) && near(p.d[2], 0))!;
    expect(nana.vec).toBe(clcl.vec);
  });

  it("gives each marker its difference and lattice translation: u = (d + n) · lat", () => {
    const vectors = pairVectors(diffs);
    expect(markers.length).toBeGreaterThan(10);
    for (const m of markers) {
      for (let k = 0; k < 3; k++) expect((vectors[3 * m.vec + k] + m.n[k]) * A).toBeCloseTo(m.u[k], 6);
    }
    // The same on a slice whose axes are permuted (h = c, v = a, cut = b).
    const other = sliceMarkers(diffs, { lat: [A, A, A], axes: [2, 0, 1], cut: A / 2, depth: 0.01, hRange: [-A, A], vRange: [-A, A], origin: null, hidden: new Set() });
    expect(other.length).toBeGreaterThan(10);
    for (const m of other) {
      for (let k = 0; k < 3; k++) expect((vectors[3 * m.vec + k] + m.n[k]) * A).toBeCloseTo(m.u[k], 6);
      expect(m.u[1]).toBeCloseTo(A / 2, 6);
    }
  });
});

describe("markerSpots", () => {
  it("gathers the element pairs at one vector into one spot with one value", () => {
    const sig = uniform((vec, n) => vec + n[0] / 10);
    const shared = spotAt(sig, A / 2, A / 2);
    expect(shared.markers.map((m) => m.key)).toEqual(["Na–Na", "Cl–Cl"]);
    expect(shared.glyphs.map((g) => [g.key, g.shape, g.r])).toEqual([["Na–Na", "circle", 5.5], ["Cl–Cl", "square", 10.5]]);
    const [m] = shared.markers;
    expect(shared.reading).toEqual({ value: expect.closeTo(m.vec + m.n[0] / 10, 5), why: null });
    expect(shared.markers[1].vec).toBe(m.vec);
    expect(shared.markers[1].n).toEqual(m.n);

    const alone = spotAt(sig, A / 2, 0);
    expect(alone.markers.map((m) => m.key)).toEqual(["Na–Cl"]);
    expect(alone.glyphs).toHaveLength(1);
  });

  it("reads each spot where its own vector lies, off the cut plane too", () => {
    // Markers within ±3 Å of the cut z = 1 Å: those on z = 0 and z = a/2.
    const sig = uniform((_vec, n) => (n[2] === 0 ? 5 : -5));
    const slab = sliceMarkers(diffs, { lat: [A, A, A], axes: [0, 1, 2], cut: 1, depth: 3, hRange: [-A, A], vRange: [-A, A], origin: null, hidden: new Set() });
    const spots = markerSpots(slab, sig, ELEMENTS, KEYS);
    const offs = new Set(spots.map((s) => s.off.toFixed(2)));
    expect(offs).toEqual(new Set(["-1.00", "1.82"]));
    for (const s of spots) {
      expect(s.markers[0].u[2]).toBeCloseTo(1 + s.off, 6);
      expect(s.reading.value).toBe(s.markers[0].n[2] === 0 ? 5 : -5);
    }
    // Two spots over one point of the slice, at different depths, stay apart.
    const stacked = spots.filter((s) => near(s.h, A / 2) && near(s.v, 0));
    expect(stacked).toHaveLength(2);
  });

  it("marks what lies inside the origin's disk or outside the volume as no value", () => {
    const sig = uniform((_vec, n) => (n[0] === 0 && n[1] === 0 && n[2] === 0 ? Number.NaN : 4));
    expect(spotAt(sig, A / 2, 0).reading).toEqual({ value: null, why: "origin" });
    expect(spotAt(sig, -A / 2, 0).reading.value).toBe(4);
    const far = sliceMarkers(diffs, { lat: [A, A, A], axes: [0, 1, 2], cut: 0, depth: 0.01, hRange: [-4 * A, 4 * A], vRange: [-A, A], origin: null, hidden: new Set() });
    expect(spotAt(sig, 3.5 * A, 0, far).reading).toEqual({ value: null, why: "outside" });
  });
});

describe("spotBatches", () => {
  const opts = (extra: Partial<BatchOptions> = {}): BatchOptions => ({
    threshold: 3,
    fade: true,
    depth: 0.01,
    w: 400,
    h: 400,
    project: (h, v) => [200 + 30 * h, 200 - 30 * v],
    ...extra,
  });
  // +6 along +a, −6 along −a, quiet elsewhere; nothing at the origin.
  const sig = uniform((_vec, n) => (n[0] === 0 && n[1] === 0 ? Number.NaN : n[1] !== 0 ? 1 : n[0] > 0 ? 6 : -6));
  const spots = markerSpots(markers, sig, ELEMENTS, KEYS);

  it("fills the innermost glyph of a marker above the threshold, by sign", () => {
    const batches = spotBatches(spots, opts());
    const pos = batches.filter((b) => b.fill === "pos");
    const neg = batches.filter((b) => b.fill === "neg");
    // Na–Cl at (a/2 + a, 0) and the inner Na–Na of the shared vector at (a, 0).
    expect(pos.map((b) => b.key).sort()).toEqual(["Na–Cl", "Na–Na"]);
    expect(neg.map((b) => b.key).sort()).toEqual(["Na–Cl", "Na–Na"]);
    for (const b of [...pos, ...neg]) expect([b.opacity, b.stroke, b.disc]).toEqual([1, 1, ""]);
    // The outer Cl–Cl of a filled spot is at full size too, and holds no fill.
    const outer = batches.filter((b) => b.key === "Cl–Cl" && b.fill === null && b.opacity === 1);
    expect(outer).toHaveLength(1);
    expect(outer[0].d).toContain("M"); // a path
  });

  it("draws the hollow markers first, small and faint when they fade", () => {
    const batches = spotBatches(spots, opts());
    const firstFilled = batches.findIndex((b) => b.opacity === 1);
    expect(firstFilled).toBeGreaterThan(0);
    for (const b of batches.slice(0, firstFilled)) expect([b.fill, b.opacity, b.stroke]).toEqual([null, 0.5, 0.75]);
    for (const b of batches.slice(firstFilled)) expect(b.opacity).toBe(1);
    // A quiet lone circle is 3.6 px in radius: its path's arc says so.
    expect(batches.find((b) => b.key === "Na–Na" && b.opacity === 0.5)!.d).toContain("a3.6,3.6 ");
  });

  it("keeps them at the size they had when the fade is off", () => {
    const batches = spotBatches(spots, opts({ fade: false }));
    for (const b of batches) expect([b.opacity, b.stroke]).toEqual([1, 1]);
    expect(batches.find((b) => b.key === "Na–Na" && b.fill === null)!.d).toContain("a5,5 ");
    expect(batches.find((b) => b.key === "Na–Na" && b.fill === "pos")!.d).toContain("a5.5,5.5 ");
  });

  it("follows the threshold", () => {
    expect(spotBatches(spots, opts({ threshold: 6.5 })).some((b) => b.fill)).toBe(false);
    expect(spotBatches(spots, opts({ threshold: 6 })).some((b) => b.fill === "neg")).toBe(true);
  });

  it("draws every marker hollow at full size while there are no values", () => {
    for (const source of ["pending", "failed", { ...sig, skipped: "too_many" }, { ...sig, sigma: null }] as SignalSource[]) {
      const batches = spotBatches(markerSpots(markers, source, ELEMENTS, KEYS), opts());
      expect(batches.length).toBeGreaterThan(0);
      for (const b of batches) expect([b.fill, b.opacity, b.stroke]).toEqual([null, 1, 1]);
    }
  });

  it("combines the depth fade with the signal fade", () => {
    // Markers on z = 0 and z = a/2 seen from a cut at 1 Å, ± 3 Å deep.
    const slab = sliceMarkers(diffs, { lat: [A, A, A], axes: [0, 1, 2], cut: 1, depth: 3, hRange: [-A, A], vRange: [-A, A], origin: null, hidden: new Set() });
    const quiet = spotBatches(markerSpots(slab, uniform(() => 1), ELEMENTS, KEYS), opts({ depth: 3 }));
    // 1.00 Å off of 3 Å: fade level 1 (0.8); 1.82 Å off: level 2 (0.6); each halved by the signal fade.
    expect(new Set(quiet.map((b) => b.opacity))).toEqual(new Set([0.4, 0.3]));
    const loud = spotBatches(markerSpots(slab, uniform(() => 9), ELEMENTS, KEYS), opts({ depth: 3 }));
    expect(new Set(loud.map((b) => b.opacity))).toEqual(new Set([0.8, 0.6]));
  });

  it("puts a disc behind a filled plus or cross", () => {
    const elements = ["Mn", "O", "Na", "K", "Li", "Fe", "Co"];
    const m: Marker = { h: 1, v: 1, off: 0, u: [1, 1, 0], vec: 0, n: [0, 0, 0], key: "Mn–Co", mult: 1, pairs: [] };
    const one = table([{ first: [0, 0, 0], count: [1, 1, 1], values: [-8] }]);
    const [b] = spotBatches(markerSpots([m], one, elements, ["Mn–Co"]), opts());
    expect(b.fill).toBe("neg");
    expect(b.d).toContain("H"); // the plus's strokes
    expect(b.disc).toContain(`a${6.99},${6.99} `);
    const [hollow] = spotBatches(markerSpots([m], one, elements, ["Mn–Co"]), opts({ threshold: 9 }));
    expect(hollow.disc).toBe("");
  });

  it("leaves out what is outside the view", () => {
    const inView = spotBatches(spots, opts());
    const zoomed = spotBatches(spots, opts({ project: (h, v) => [200 + 3000 * (h - A / 2), 200 - 3000 * v] }));
    expect(zoomed.length).toBeLessThan(inView.length);
    expect(zoomed.map((b) => b.key)).toEqual(["Na–Cl"]);
  });
});

describe("counts", () => {
  const sig = table([
    { first: [0, 0, 0], count: [1, 1, 4], values: [3, 2.9, -3, Number.NaN] },
    { first: [0, 0, 0], count: [1, 2, 1], values: [7, -0.5] },
    { first: [0, 0, 0], count: [1, 1, 1], values: [-9] },
  ]);

  it("counts the vectors with a value, and those at or beyond the threshold by sign", () => {
    expect(signalCounts(sig, Uint8Array.of(1, 1, 1), 3)).toEqual({ total: 6, pos: 2, neg: 2 });
    expect(signalCounts(sig, Uint8Array.of(1, 1, 1), 5)).toEqual({ total: 6, pos: 1, neg: 1 });
    expect(signalCounts(sig, Uint8Array.of(1, 0, 0), 3)).toEqual({ total: 3, pos: 1, neg: 1 });
    expect(signalCounts(sig, Uint8Array.of(0, 0, 0), 3)).toEqual({ total: 0, pos: 0, neg: 0 });
    expect(signalCounts({ ...sig, skipped: "too_many", table: new Int32Array(0), offsets: new Float64Array(0), values: new Float32Array(0) }, Uint8Array.of(1, 1, 1), 3)).toEqual({ total: 0, pos: 0, neg: 0 });
  });

  it("words the count line", () => {
    expect(countsText({ total: 138, pos: 10, neg: 7 }, 3)).toBe("Above 3σ: 17 of 138 vectors (10 more common, 7 rarer)");
    expect(countsText({ total: 6, pos: 0, neg: 0 }, 4.5)).toBe("Above 4.5σ: 0 of 6 vectors (0 more common, 0 rarer)");
  });

  it("counts only the pairs that are drawn", () => {
    const all = visibleVectors(diffs, null, new Set());
    expect([...all]).toEqual(Array(8).fill(1));
    // Hiding Na–Cl leaves the four fcc differences; hiding Na–Na leaves them too (Cl–Cl shares them).
    expect(visibleVectors(diffs, null, new Set(["Na–Cl"])).reduce((a, b) => a + b, 0)).toBe(4);
    expect(visibleVectors(diffs, null, new Set(["Na–Na"])).reduce((a, b) => a + b, 0)).toBe(8);
    expect(visibleVectors(diffs, null, new Set(["Na–Na", "Cl–Cl"])).reduce((a, b) => a + b, 0)).toBe(4);
    expect(visibleVectors(diffs, "Na1", new Set(["Na–Na"])).reduce((a, b) => a + b, 0)).toBe(4);
    expect(visibleVectors([], null, new Set())).toHaveLength(0);
  });
});

describe("sizes", () => {
  it("draws a filled marker a little larger than a hollow one, a faded one smaller", () => {
    const [inner, outer] = nestGlyphs(["Na–Na", "Cl–Cl"], ELEMENTS);
    expect([glyphRadius(inner, stateStyle("pos", true)), glyphRadius(outer, stateStyle("neg", false))]).toEqual([5.5, 10.5]);
    expect([glyphRadius(inner, stateStyle("quiet", false)), glyphRadius(outer, stateStyle("none", false))]).toEqual([5, 10]);
    expect([glyphRadius(inner, stateStyle("quiet", true)), glyphRadius(outer, stateStyle("none", true))]).toEqual([3.6, 7.2]);
    expect(stateStyle("quiet", true).opacity).toBe(0.5);
  });

  it("offers thresholds from 2σ to 6σ in half steps, 3σ to start", () => {
    expect(FILL_ABOVE).toEqual({ min: 2, max: 6, step: 0.5, initial: 3 });
  });
});

describe("fillColors", () => {
  // sRGB → relative luminance and OKLab, to check the fills as they are seen.
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const rgb = (css: string) => css.match(/\d+/g)!.map((x) => Number(x) / 255) as [number, number, number];
  const luminance = (css: string) => {
    const [r, g, b] = rgb(css).map(lin);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const oklab = (css: string) => {
    const [r, g, b] = rgb(css).map(lin);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  };
  const apart = (a: string, b: string) => Math.hypot(...oklab(a).map((x, i) => x - oklab(b)[i]));

  it("takes both fills from the active map, legible on every diverging map", () => {
    expect(DIVERGING_NAMES.length).toBeGreaterThan(0);
    for (const name of DIVERGING_NAMES) {
      const lut = COLORMAPS[name];
      const [pos, neg] = fillColors(lut);
      // The map's own colours, on its positive and its negative side.
      expect(pos, name).toBe(`rgb(${lut[230 * 4]}, ${lut[230 * 4 + 1]}, ${lut[230 * 4 + 2]})`);
      expect(neg, name).toBe(`rgb(${lut[25 * 4]}, ${lut[25 * 4 + 1]}, ${lut[25 * 4 + 2]})`);
      // Each stands off the white ring around it, and the two tell apart.
      expect(contrast(pos, "rgb(255, 255, 255)"), `${name} +`).toBeGreaterThan(4);
      expect(contrast(neg, "rgb(255, 255, 255)"), `${name} −`).toBeGreaterThan(4);
      expect(apart(pos, neg), name).toBeGreaterThan(0.2);
    }
  });
});
