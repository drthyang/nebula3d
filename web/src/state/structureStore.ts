// The crystal structure drawn over the 3D-ΔPDF as pair vectors (see
// structure/pairs.ts): sites, symmetry operations and how they are shown.  It
// lives in this browser only (localStorage), never on the server or in a
// dataset file, and is shared by the 3D-ΔPDF and Q–R pages.

import { create } from "zustand";

import { resetsWithVolume } from "./volumeReset";
import type { Cell, Site } from "../structure/cif";
import { FILL_ABOVE, mapKindOr, type MapKind } from "../structure/signal";
import type { Centering } from "../structure/symops";

export interface StructureDef {
  name: string;
  cell: Cell | null; // the CIF's cell, for the check against the ΔPDF's
  sites: Site[];
  ops: string; // one operation per line
  centering: Centering;
  notes: string[]; // the CIF reader's warnings
}

interface StructureState {
  def: StructureDef | null;
  show: boolean;
  perm: number; // index into PERMUTATIONS: which CIF axes are the data's a, b, c
  origin: string | null; // only pairs starting on this site
  hidden: string[]; // element pairs not drawn
  depth: number | null; // slab half-thickness (Å); null = half a voxel
  fillAbove: number; // a marker is filled where |ΔPDF| at its vector reaches this many σ
  fadeQuiet: boolean; // markers below it are drawn smaller and fainter
  mapKind: MapKind; // "ΔPDF type": what the two signs are called (atomic, or magnetic: 3D-mΔPDF)
  setDef: (def: StructureDef | null) => void;
  editDef: (edit: (def: StructureDef) => Partial<StructureDef>) => void; // on the current def
  setShow: (b: boolean) => void;
  setPerm: (i: number) => void;
  setOrigin: (s: string | null) => void;
  toggleHidden: (key: string) => void;
  setDepth: (d: number | null) => void;
  setFillAbove: (sigma: number) => void;
  setFadeQuiet: (b: boolean) => void;
  setMapKind: (kind: MapKind) => void;
}

const KEY = "nebula3d.structure";
type Saved = Pick<StructureState, "def" | "show" | "perm" | "origin" | "hidden" | "depth" | "fillAbove" | "fadeQuiet" | "mapKind">;

/** A "Fill above" value on the slider's steps, or its default for anything else (an older or edited store). */
export function fillAboveOr(v: unknown): number {
  const { min, max, step, initial } = FILL_ABOVE;
  if (typeof v !== "number" || !Number.isFinite(v)) return initial;
  return Math.min(max, Math.max(min, Math.round(v / step) * step));
}

function load(): Partial<Saved> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<Saved>) : {};
  } catch {
    return {};
  }
}

const saved = load();

// No structure: the state without one saved, and after Close.
const EMPTY: Saved = {
  def: null,
  show: true,
  perm: 0,
  origin: null,
  hidden: [],
  depth: null,
  fillAbove: FILL_ABOVE.initial,
  fadeQuiet: true,
  mapKind: "atomic",
};

export const useStructureStore = create<StructureState>((set) => ({
  def: saved.def ?? EMPTY.def,
  show: saved.show ?? EMPTY.show,
  perm: saved.perm ?? EMPTY.perm,
  origin: saved.origin ?? EMPTY.origin,
  hidden: saved.hidden ?? EMPTY.hidden,
  depth: saved.depth ?? EMPTY.depth,
  fillAbove: fillAboveOr(saved.fillAbove),
  fadeQuiet: typeof saved.fadeQuiet === "boolean" ? saved.fadeQuiet : EMPTY.fadeQuiet,
  mapKind: mapKindOr(saved.mapKind),
  // A new structure starts with every pair shown, from every site.
  setDef: (def) => set({ def, origin: null, hidden: [], show: true }),
  editDef: (edit) => set((s) => (s.def ? { def: { ...s.def, ...edit(s.def) } } : {})),
  setShow: (show) => set({ show }),
  setPerm: (perm) => set({ perm }),
  setOrigin: (origin) => set({ origin }),
  toggleHidden: (key) =>
    set((s) => ({ hidden: s.hidden.includes(key) ? s.hidden.filter((k) => k !== key) : [...s.hidden, key] })),
  setDepth: (depth) => set({ depth }),
  setFillAbove: (sigma) => set({ fillAbove: fillAboveOr(sigma) }),
  setFadeQuiet: (fadeQuiet) => set({ fadeQuiet }),
  setMapKind: (kind) => set({ mapKind: mapKindOr(kind) }),
}));

useStructureStore.subscribe((s) => {
  const snapshot: Saved = {
    def: s.def,
    show: s.show,
    perm: s.perm,
    origin: s.origin,
    hidden: s.hidden,
    depth: s.depth,
    fillAbove: s.fillAbove,
    fadeQuiet: s.fadeQuiet,
    mapKind: s.mapKind,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    /* storage unavailable */
  }
});

// Closing the volume clears the structure drawn over its ΔPDF (an overlay),
// here and in storage.
resetsWithVolume(useStructureStore, { fresh: () => EMPTY });
