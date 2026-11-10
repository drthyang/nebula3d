// What the ΔPDF says at each pair vector of the structure overlay.
//
// A marker's value is the ΔPDF at its own vector, in units of the volume's
// robust σ (the server reads it there, between the voxels; api/pairSignal.ts).
// At or above the "Fill above" threshold the marker is filled: positive where
// the pair is more common than in the average structure, negative where it is
// rarer.  Below it the marker stays hollow.  Element pairs that share a vector
// share its value and are drawn as nested glyphs, the fill in the inner one.

import type { PairSignal } from "../api/pairSignal";
import { isOpenShape, NEST_RADIUS, nestRadii, OPEN_DISC, pairGlyph, shapePath, type Shape } from "./glyphs";
import type { Marker, PairDiff } from "./pairs";
import type { Vec3 } from "./symops";

/** The "Fill above" slider (σ). */
export const FILL_ABOVE = { min: 2, max: 6, step: 0.5, initial: 3 } as const;

/** Why a marker has no value. */
export type NoValue =
  | "origin" // inside the origin's disk, which σ leaves out
  | "outside" // outside the volume
  | "pending" // the values are still being read
  | "failed" // the read failed
  | "too_many" // more vectors than are read at once
  | "flat"; // the volume has no spread, so no σ

/** The values behind the markers: the table, or that it is being read ("pending") or was not ("failed"). */
export type SignalSource = PairSignal | "pending" | "failed";

/** A marker's ΔPDF, in σ, or why it has none. */
export interface Reading {
  value: number | null;
  why: NoValue | null;
}

/** What the markers say about the ΔPDF, and how (the structure panel's settings). */
export interface OverlaySignal {
  source: SignalSource; // the ΔPDF at the vectors, or that it is still being read
  threshold: number; // "Fill above" (σ)
  fade: boolean; // "Fade pairs without signal"
  colors: readonly [string, string]; // fills: more common, rarer
}

/** Why no marker has a value, or null when the table holds them. */
export function sourceProblem(source: SignalSource): NoValue | null {
  if (source === "pending" || source === "failed") return source;
  if (source.skipped) return "too_many";
  if (source.sigma === null) return "flat";
  return null;
}

/** The ΔPDF at lattice translation `n` of pair difference `vec`. */
export function readSignal(source: SignalSource, vec: number, n: Vec3): Reading {
  const problem = sourceProblem(source);
  if (problem) return { value: null, why: problem };
  const s = source as PairSignal;
  const t = 6 * vec;
  if (vec < 0 || t + 5 >= s.table.length) return { value: null, why: "outside" };
  const i0 = n[0] - s.table[t], i1 = n[1] - s.table[t + 1], i2 = n[2] - s.table[t + 2];
  const c0 = s.table[t + 3], c1 = s.table[t + 4], c2 = s.table[t + 5];
  if (i0 < 0 || i1 < 0 || i2 < 0 || i0 >= c0 || i1 >= c1 || i2 >= c2) return { value: null, why: "outside" };
  const value = s.values[s.offsets[vec] + (i0 * c1 + i1) * c2 + i2];
  return Number.isNaN(value) ? { value: null, why: "origin" } : { value, why: null };
}

/** How a marker is drawn. */
export type SignalState =
  | "pos" // filled: more common than in the average structure
  | "neg" // filled: rarer
  | "quiet" // a value below the threshold: hollow
  | "none"; // no value: hollow, as "no signal"

export function signalState(r: Reading, threshold: number): SignalState {
  if (r.value === null) return "none";
  if (r.value >= threshold) return "pos";
  if (r.value <= -threshold) return "neg";
  return "quiet";
}

const sigmas = (v: number) => String(Number(v.toFixed(2)));

/** "+6.2σ", "−7.4σ"; two decimals where one would round a value up to the threshold it is below. */
function signed(value: number, threshold: number): string {
  let text = Math.abs(value).toFixed(1);
  if (Math.abs(value) < threshold && Number(text) >= threshold) text = (Math.floor(Math.abs(value) * 100) / 100).toFixed(2);
  if (Number(text) === 0) return `${text}σ`;
  return `${value < 0 ? "−" : "+"}${text}σ`;
}

/** The readout's line for one vector: the value and what it says, or why there is none. */
export function signalText(r: Reading, threshold: number, originRadius?: number | null): string {
  if (r.value !== null) {
    const s = signalState(r, threshold);
    const says =
      s === "pos"
        ? "more common than in the average structure"
        : s === "neg"
          ? "rarer than in the average structure"
          : `nothing above ${sigmas(threshold)}σ`;
    return `ΔPDF ${signed(r.value, threshold)}: ${says}`;
  }
  switch (r.why) {
    case "origin":
      return `ΔPDF not read: inside the origin peak${originRadius ? ` (|u| < ${originRadius.toFixed(1)} Å)` : ""}`;
    case "outside":
      return "ΔPDF not read: outside the volume";
    case "pending":
      return "ΔPDF: reading…";
    case "too_many":
      return "ΔPDF not read: too many vectors in this volume";
    case "flat":
      return "ΔPDF not read: the volume has no spread";
    default:
      return "ΔPDF not read: the request failed";
  }
}

/** One glyph of a spot: its pair, shape, colour and radius (px, at full size). */
export interface NestGlyph {
  key: string;
  shape: Shape;
  color: string;
  r: number;
}

/**
 * One vector on a slice: the element pairs that share it (their markers,
 * innermost glyph first) and the value they share.
 */
export interface Spot {
  h: number;
  v: number;
  off: number;
  markers: Marker[];
  glyphs: NestGlyph[];
  reading: Reading;
}

/**
 * The glyphs of the pairs at one vector, innermost first: in the order of
 * `keys`, the open shapes (plus, cross) before the others, as they enclose
 * nothing and their fill is a disc behind the strokes.
 */
export function nestGlyphs(keys: readonly string[], elements: string[]): NestGlyph[] {
  const drawn = keys.map((key) => ({ key, ...pairGlyph(key, elements) }));
  const ordered = [...drawn.filter((g) => isOpenShape(g.shape)), ...drawn.filter((g) => !isOpenShape(g.shape))];
  const radii = nestRadii(ordered.map((g) => g.shape));
  return ordered.map((g, i) => ({ ...g, r: radii[i] }));
}

/**
 * The slice's markers gathered into spots, one per vector (a position to
 * 1e-3 Å, as the markers themselves are merged).  `order` is the pair keys in
 * legend order.
 */
export function markerSpots(markers: readonly Marker[], source: SignalSource, elements: string[], order: readonly string[]): Spot[] {
  const rank = new Map(order.map((k, i) => [k, i]));
  const at = new Map<string, Spot>();
  for (const m of markers) {
    const k = `${m.h.toFixed(3)}|${m.v.toFixed(3)}|${m.off.toFixed(3)}`;
    let s = at.get(k);
    if (!s) at.set(k, (s = { h: m.h, v: m.v, off: m.off, markers: [], glyphs: [], reading: readSignal(source, m.vec, m.n) }));
    s.markers.push(m);
  }
  const nests = new Map<string, NestGlyph[]>();
  const spots = [...at.values()];
  for (const s of spots) {
    if (s.markers.length > 1) s.markers.sort((a, b) => (rank.get(a.key) ?? 0) - (rank.get(b.key) ?? 0));
    const name = s.markers.map((m) => m.key).join("|");
    let g = nests.get(name);
    if (!g) nests.set(name, (g = nestGlyphs(s.markers.map((m) => m.key), elements)));
    s.glyphs = g;
    // The markers follow their glyphs, innermost first.
    if (s.markers.length > 1) s.markers = g.map((x) => s.markers.find((m) => m.key === x.key)!);
  }
  return spots;
}

/** Which of the structure's distinct differences have a pair that is drawn (not hidden, from the origin site). */
export function visibleVectors(diffs: readonly PairDiff[], origin: string | null, hidden: ReadonlySet<string>): Uint8Array {
  let n = 0;
  for (const p of diffs) n = Math.max(n, p.vec + 1);
  const out = new Uint8Array(n);
  for (const p of diffs) if (!(origin && p.from !== origin) && !hidden.has(p.key)) out[p.vec] = 1;
  return out;
}

export interface SignalCounts {
  total: number; // vectors in the volume that have a value
  pos: number; // at or above the threshold
  neg: number; // at or below minus the threshold
}

/** How many of the structure's vectors in the whole volume stand out, of those that are drawn. */
export function signalCounts(sig: PairSignal, visible: Uint8Array, threshold: number): SignalCounts {
  let total = 0, pos = 0, neg = 0;
  const n = Math.min(visible.length, sig.offsets.length);
  for (let k = 0; k < n; k++) {
    if (!visible[k]) continue;
    const start = sig.offsets[k];
    const end = start + sig.table[6 * k + 3] * sig.table[6 * k + 4] * sig.table[6 * k + 5];
    for (let i = start; i < end; i++) {
      const v = sig.values[i];
      if (v !== v) continue; // NaN: inside the origin's disk
      total++;
      if (v >= threshold) pos++;
      else if (v <= -threshold) neg++;
    }
  }
  return { total, pos, neg };
}

/** "Above 3σ: 17 of 138 vectors (10 more common, 7 rarer)". */
export function countsText(c: SignalCounts, threshold: number): string {
  return `Above ${sigmas(threshold)}σ: ${c.pos + c.neg} of ${c.total} vectors (${c.pos} more common, ${c.neg} rarer)`;
}

/**
 * The fill colours for a diverging colormap, [more common, rarer]: its own
 * colours nine tenths of the way to each end, so a filled marker agrees with
 * the lobe under it and still reads against the white ring around the fill
 * (the very ends are darker than most lobes are drawn).
 */
export function fillColors(lut: Uint8ClampedArray): [string, string] {
  const css = (i: number) => `rgb(${lut[i * 4]}, ${lut[i * 4 + 1]}, ${lut[i * 4 + 2]})`;
  return [css(230), css(25)];
}

/** How a marker in one signal state is sized and faded. */
export interface StateStyle {
  base: number; // radius (px) of the innermost glyph
  step: number; // of the distance from one nested glyph to the next
  stroke: number; // of the stroke widths
  opacity: number;
}

/**
 * A filled marker at full size; a hollow one at the size markers had before
 * they carried a value, or small and faint when pairs without signal fade.
 */
export function stateStyle(state: SignalState, fade: boolean): StateStyle {
  if (state === "pos" || state === "neg") return { base: NEST_RADIUS, step: 1, stroke: 1, opacity: 1 };
  return fade ? { base: 3.6, step: 0.72, stroke: 0.75, opacity: 0.5 } : { base: 5, step: 1, stroke: 1, opacity: 1 };
}

/** The radius (px) a glyph of a spot is drawn at in a state. */
export function glyphRadius(g: NestGlyph, style: StateStyle): number {
  return Math.round((style.base + style.step * (g.r - NEST_RADIUS)) * 100) / 100;
}

/** Depth-fade levels: a marker fades in steps with its distance from the cut. */
export const FADE_LEVELS = 4;

/** Glyphs drawn alike, as one path: one element pair in one state, fade level and size. */
export interface Batch {
  id: string;
  key: string; // the element pair
  color: string; // its stroke
  opacity: number; // depth fade × signal fade
  stroke: number; // of the stroke widths
  fill: "pos" | "neg" | null; // the innermost glyph of a filled marker
  d: string; // the glyphs' outlines
  disc: string; // the discs behind a filled plus or cross ("" for a shape that holds its fill)
}

export interface BatchOptions {
  threshold: number; // σ
  fade: boolean; // pairs without signal are drawn smaller and fainter
  depth: number; // slab half-thickness (Å)
  w: number; // the view (px)
  h: number;
  project: (h: number, v: number) => [number, number]; // slice Å → view px
}

const SOURCE_PROBLEMS: ReadonlySet<NoValue | null> = new Set<NoValue>(["pending", "failed", "too_many", "flat"]);

/**
 * The spots of one view as batched paths, in drawing order: hollow markers
 * first, so a filled one is never under them, and the glyphs farthest from
 * the cut under the nearer.  Without any values (still reading, or none to
 * read) the markers are hollow at full size, as before they carried a value.
 */
export function spotBatches(spots: readonly Spot[], o: BatchOptions): Batch[] {
  const batches = new Map<string, Batch>();
  const rank = new Map<Batch, number>(); // drawing order: hollow, then far from the cut, then large, first
  for (const s of spots) {
    const state = signalState(s.reading, o.threshold);
    const filled = state === "pos" || state === "neg";
    const style = stateStyle(state, o.fade && !SOURCE_PROBLEMS.has(s.reading.why));
    const radii = s.glyphs.map((g) => glyphRadius(g, style));
    const reach = radii[radii.length - 1] * OPEN_DISC + 3;
    const [px, py] = o.project(s.h, s.v);
    if (px < -reach || py < -reach || px > o.w + reach || py > o.h + reach) continue;
    const far = o.depth > 0 ? Math.min(1, Math.abs(s.off) / o.depth) : 0;
    const level = Math.min(FADE_LEVELS - 1, Math.floor(far * FADE_LEVELS));
    s.glyphs.forEach((g, i) => {
      const fill = filled && i === 0 ? (state as "pos" | "neg") : null;
      const id = `${filled ? 1 : 0}${fill ?? "-"}|${level}|${g.key}|${radii[i]}`;
      let b = batches.get(id);
      if (!b) {
        b = {
          id,
          key: g.key,
          color: g.color,
          opacity: Math.round((1 - (0.6 * level) / (FADE_LEVELS - 1)) * style.opacity * 1000) / 1000,
          stroke: style.stroke,
          fill,
          d: "",
          disc: "",
        };
        batches.set(id, b);
        rank.set(b, (filled ? 1e6 : 0) - level * 1e4 - radii[i]);
      }
      b.d += shapePath(g.shape, px, py, radii[i]);
      if (fill && isOpenShape(g.shape)) b.disc += shapePath("circle", px, py, Math.round(radii[i] * OPEN_DISC * 100) / 100);
    });
  }
  return [...batches.values()].sort((a, b) => rank.get(a)! - rank.get(b)!);
}
