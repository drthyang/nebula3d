// The regions the NEBULA Pilot has marked in the slice views (Linear THY-44):
// each a box, an ellipsoid or a few points in a volume's coordinates
// (components/regionMark.ts), on the stage output it was found in, with a
// short label, the tool steps it rests on, and where the console was moved to
// show it (state/marks.ts plans and shows a mark; the slice views draw them,
// components/RegionMarks.tsx; the Pilot panel lists them, MarksList.tsx).
//
// In a module-scoped store, so marks outlive the page and the panel; kept in
// sessionStorage like the conversation (chatStore.ts), so a reload keeps
// them, and saved in a session file (state/session.ts). What either brings
// back is read mark by mark and checked (readMarks): a file can hold anything.

import { create } from "zustand";

import { regionProblem, type MarkRegion, type Vec3 } from "../components/regionMark";
import type { Viewport } from "../components/viewport";
import type { FixedAxis } from "./viewerStore";

/** Where a mark is drawn: the raw volume or a cleanup stage's output (reciprocal space), or the 3D-ΔPDF. */
export const MARK_WHERE = ["raw", "rings", "punch", "backfill", "flatten", "pdf"] as const;
export type MarkWhere = (typeof MARK_WHERE)[number];

/** The stage output each `where` is drawn on, as the dataset lists it. */
export const WHERE_OUTPUT: Record<MarkWhere, string> = {
  raw: "raw",
  rings: "ringremoved",
  punch: "braggpunched",
  backfill: "backfilled",
  flatten: "flattened",
  pdf: "delta_pdf",
};

/** The reciprocal-space outputs in the cleanup page's order, by the `where` that names each. */
export const CLEANUP_WHERE: readonly MarkWhere[] = ["raw", "rings", "punch", "backfill", "flatten"];

export const isReciprocal = (where: MarkWhere): boolean => where !== "pdf";

export const DPDF_MARK_PLANES = ["xy", "xz", "yz"] as const;
export type DpdfMarkPlane = (typeof DPDF_MARK_PLANES)[number];

/** Where the console goes to show a mark: the page, its cuts and the views it zoomed. */
export type MarkView =
  | { page: "cleanup"; axis: FixedAxis; value: number; viewport: Viewport | null } // the plane cut along `axis` at `value` r.l.u.
  | { page: "dpdf"; index: Vec3; views: Partial<Record<DpdfMarkPlane, Viewport>> }; // the x, y, z cut indices

export interface Mark {
  id: string; // "M1", "M2", … in the order they were made
  datasetId: string;
  where: MarkWhere;
  region: MarkRegion; // as the volume holds it (clipped)
  label: string;
  evidence: string[]; // the tool steps it rests on, as cited
  created: string; // ISO time
  view: MarkView;
  hidden?: true; // hidden by the user
}

/** A label's longest length; a longer one is cut short with an ellipsis. */
export const MAX_LABEL = 48;

/** A label as a mark keeps it: one line, trimmed, at most MAX_LABEL characters. */
export function shortLabel(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= MAX_LABEL ? one : `${one.slice(0, MAX_LABEL - 1).trimEnd()}…`;
}

// ---------------------------------------------------------------- reading

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const vec3 = (v: unknown): Vec3 | null => (Array.isArray(v) && v.length === 3 && v.every(isNum) ? ([v[0], v[1], v[2]] as Vec3) : null);
const viewport = (v: unknown): Viewport | null =>
  isObj(v) && isNum(v.cx) && isNum(v.cy) && isNum(v.half) && v.half > 0 ? { cx: v.cx, cy: v.cy, half: v.half } : null;

function readRegion(v: unknown): MarkRegion | null {
  if (!isObj(v)) return null;
  let region: MarkRegion | null = null;
  if (v.shape === "points" && Array.isArray(v.points)) {
    const points = v.points.map(vec3);
    if (points.every((p): p is Vec3 => p !== null)) region = { shape: "points", points };
  } else if (v.shape === "box" || v.shape === "ellipsoid") {
    const center = vec3(v.center), half = vec3(v.half);
    if (center && half) region = { shape: v.shape, center, half };
  }
  return region && !regionProblem(region) ? region : null;
}

function readView(v: unknown): MarkView | null {
  if (!isObj(v)) return null;
  if (v.page === "cleanup") {
    if (!(v.axis === "H" || v.axis === "K" || v.axis === "L") || !isNum(v.value)) return null;
    return { page: "cleanup", axis: v.axis, value: v.value, viewport: viewport(v.viewport) };
  }
  if (v.page === "dpdf") {
    const index = vec3(v.index);
    if (!index || !index.every((i) => Number.isInteger(i) && i >= 0)) return null;
    const views: Partial<Record<DpdfMarkPlane, Viewport>> = {};
    if (isObj(v.views)) {
      for (const p of DPDF_MARK_PLANES) {
        const vp = viewport(v.views[p]);
        if (vp) views[p] = vp;
      }
    }
    return { page: "dpdf", index, views };
  }
  return null;
}

/** One mark read from a file or storage, rebuilt from the keys it has; null when any part is not of its type. */
export function readMark(v: unknown): Mark | null {
  if (!isObj(v) || !isStr(v.id) || !/^M\d+$/.test(v.id) || !isStr(v.datasetId) || !isStr(v.label)) return null;
  if (!isStr(v.where) || !(MARK_WHERE as readonly string[]).includes(v.where)) return null;
  const region = readRegion(v.region);
  const view = readView(v.view);
  if (!region || !view || (view.page === "dpdf") !== (v.where === "pdf")) return null;
  return {
    id: v.id,
    datasetId: v.datasetId,
    where: v.where as MarkWhere,
    region,
    label: shortLabel(v.label),
    evidence: Array.isArray(v.evidence) ? v.evidence.filter(isStr) : [],
    created: isStr(v.created) ? v.created : "",
    view,
    ...(v.hidden === true ? { hidden: true as const } : {}),
  };
}

/** The well-formed marks of a list, each id once (the first). */
export function readMarks(v: unknown): Mark[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  return v.flatMap((x) => {
    const m = readMark(x);
    if (!m || seen.has(m.id)) return [];
    seen.add(m.id);
    return [m];
  });
}

const numberOf = (id: string): number => Number(id.slice(1));

// ---------------------------------------------------------------- the store

/** A layout change for a page to apply once it is mounted (and clear): the cleanup page's primary view, a mark's stage. */
export interface LayoutRequest {
  page: "cleanup";
  primary: string;
}

interface MarkState {
  marks: Mark[];
  showAll: boolean; // the panel's Hide all / Show all; a hidden mark stays hidden either way
  next: number; // the next mark's number: never reused in a session, so "M2" in the transcript names one mark
  layoutRequest: LayoutRequest | null;
  add: (mark: Omit<Mark, "id">) => Mark;
  toggle: (id: string) => void;
  reveal: (id: string) => void; // shown again, and the marks with it
  remove: (id: string) => void;
  clear: (datasetId: string) => void;
  setShowAll: (show: boolean) => void;
  setLayoutRequest: (r: LayoutRequest | null) => void;
  // Replace the marks with a saved session's (state/session.ts): only its
  // well-formed ones, numbered on after them.
  restore: (saved: unknown) => void;
}

const MARKS_KEY = "nebula3d.marks.v1";

function load(): { marks: Mark[]; next: number; showAll: boolean } {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(MARKS_KEY) ?? "null");
    if (!isObj(saved)) return { marks: [], next: 1, showAll: true };
    const marks = readMarks(saved.marks);
    const top = marks.reduce((n, m) => Math.max(n, numberOf(m.id)), 0);
    return {
      marks,
      next: Math.max(top + 1, Number.isInteger(saved.next) ? (saved.next as number) : 1),
      showAll: saved.showAll !== false,
    };
  } catch {
    return { marks: [], next: 1, showAll: true }; // no storage (private mode, tests)
  }
}

const loaded = load();

export const useMarkStore = create<MarkState>((set, get) => ({
  marks: loaded.marks,
  showAll: loaded.showAll,
  next: loaded.next,
  layoutRequest: null,
  add: (fields) => {
    const mark: Mark = { ...fields, id: `M${get().next}` };
    set((s) => ({ marks: [...s.marks, mark], next: s.next + 1 }));
    return mark;
  },
  toggle: (id) => set((s) => ({ marks: s.marks.map((m) => (m.id !== id ? m : m.hidden ? withoutHidden(m) : { ...m, hidden: true })) })),
  reveal: (id) => set((s) => ({ showAll: true, marks: s.marks.map((m) => (m.id === id && m.hidden ? withoutHidden(m) : m)) })),
  remove: (id) => set((s) => ({ marks: s.marks.filter((m) => m.id !== id) })),
  clear: (datasetId) => set((s) => ({ marks: s.marks.filter((m) => m.datasetId !== datasetId) })),
  setShowAll: (showAll) => set({ showAll }),
  setLayoutRequest: (layoutRequest) => set({ layoutRequest }),
  restore: (saved) => {
    const marks = readMarks(saved);
    const top = marks.reduce((n, m) => Math.max(n, numberOf(m.id)), 0);
    set((s) => ({ marks, next: Math.max(s.next, top + 1), showAll: true }));
  },
}));

function withoutHidden(m: Mark): Mark {
  const { hidden, ...rest } = m;
  void hidden;
  return rest;
}

/** The marks drawn for a dataset now: its marks, less the hidden ones, none while Hide all is on. */
export const visibleMarks = (s: Pick<MarkState, "marks" | "showAll">, datasetId: string | undefined): Mark[] =>
  s.showAll && datasetId ? s.marks.filter((m) => m.datasetId === datasetId && !m.hidden) : [];

useMarkStore.subscribe((s, prev) => {
  if (s.marks === prev.marks && s.next === prev.next && s.showAll === prev.showAll) return;
  try {
    sessionStorage.setItem(MARKS_KEY, JSON.stringify({ marks: s.marks, next: s.next, showAll: s.showAll }));
  } catch {
    // Full or blocked: the marks just do not survive a reload.
  }
});
