// The crystal structure drawn over the 3D-ΔPDF as pair vectors (see
// structure/pairs.ts): sites, symmetry operations and how they are shown.  It
// lives in this browser only (localStorage), never on the server or in a
// dataset file, and is shared by the 3D-ΔPDF and Q–R pages.

import { create } from "zustand";

import type { Cell, Site } from "../structure/cif";
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
  setDef: (def: StructureDef | null) => void;
  editDef: (edit: (def: StructureDef) => Partial<StructureDef>) => void; // on the current def
  setShow: (b: boolean) => void;
  setPerm: (i: number) => void;
  setOrigin: (s: string | null) => void;
  toggleHidden: (key: string) => void;
  setDepth: (d: number | null) => void;
}

const KEY = "nebula3d.structure";
type Saved = Pick<StructureState, "def" | "show" | "perm" | "origin" | "hidden" | "depth">;

function load(): Partial<Saved> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<Saved>) : {};
  } catch {
    return {};
  }
}

const saved = load();

export const useStructureStore = create<StructureState>((set) => ({
  def: saved.def ?? null,
  show: saved.show ?? true,
  perm: saved.perm ?? 0,
  origin: saved.origin ?? null,
  hidden: saved.hidden ?? [],
  depth: saved.depth ?? null,
  // A new structure starts with every pair shown, from every site.
  setDef: (def) => set({ def, origin: null, hidden: [], show: true }),
  editDef: (edit) => set((s) => (s.def ? { def: { ...s.def, ...edit(s.def) } } : {})),
  setShow: (show) => set({ show }),
  setPerm: (perm) => set({ perm }),
  setOrigin: (origin) => set({ origin }),
  toggleHidden: (key) =>
    set((s) => ({ hidden: s.hidden.includes(key) ? s.hidden.filter((k) => k !== key) : [...s.hidden, key] })),
  setDepth: (depth) => set({ depth }),
}));

useStructureStore.subscribe((s) => {
  const snapshot: Saved = { def: s.def, show: s.show, perm: s.perm, origin: s.origin, hidden: s.hidden, depth: s.depth };
  try {
    localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    /* storage unavailable */
  }
});
