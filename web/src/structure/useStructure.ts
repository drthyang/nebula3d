// React glue for the structure overlay: the stored structure expanded to the
// cell's atoms and pair differences (once per edit), and each slice's markers
// (once per cut).

import { useMemo } from "react";

import type { Lattice } from "../api/types";
import { toDisplay } from "../components/oblique";
import { useStructureStore, type StructureDef } from "../state/structureStore";
import type { Cell } from "./cif";
import {
  bestPermutation,
  cellFit,
  cellMatches,
  elementOrder,
  expandSites,
  pairDifferences,
  permuteAtoms,
  PERMUTATIONS,
  sliceMarkers,
  type Atom,
  type CellFit,
  type Marker,
  type PairDiff,
} from "./pairs";
import { symmetryGroup } from "./symops";

export interface StructureModel {
  def: StructureDef;
  error: string | null; // the operations could not be read
  nOps: number;
  atoms: Atom[];
  diffs: PairDiff[];
  elements: string[]; // in site order
  keys: string[]; // element pairs present, A–A, A–B, …
  fit: CellFit | null; // the CIF cell (axes permuted) against the ΔPDF's
  suggested: number | null; // the permutation that matches, when the current one does not
  mismatch: boolean; // the CIF cell does not fit the ΔPDF's: nothing is drawn
}

/** The ΔPDF's cell, or null when it does not record the lengths. */
export function latticeCell(lat: Lattice | undefined): Cell | null {
  if (!lat || !lat.a || !lat.b || !lat.c) return null;
  return { a: lat.a, b: lat.b, c: lat.c, alpha: lat.alpha ?? 90, beta: lat.beta ?? 90, gamma: lat.gamma ?? 90 };
}

export function buildModel(def: StructureDef, perm: number, data: Cell | null): StructureModel {
  let error: string | null = null;
  let ops = symmetryGroup("");
  try {
    ops = symmetryGroup(def.ops, def.centering);
  } catch (e) {
    error = (e as Error).message;
  }
  const p = PERMUTATIONS[perm] ?? PERMUTATIONS[0];
  const atoms = permuteAtoms(expandSites(def.sites, ops), p);
  const diffs = pairDifferences(atoms);
  const elements = elementOrder(atoms);
  const keys: string[] = [];
  elements.forEach((a, i) => elements.slice(i).forEach((b) => {
    const k = `${a}–${b}`;
    if (diffs.some((d) => d.key === k)) keys.push(k);
  }));
  const fit = def.cell && data ? cellFit(def.cell, data, p) : null;
  const best = def.cell && data ? bestPermutation(def.cell, data) : null;
  return {
    def,
    error,
    nOps: ops.length,
    atoms,
    diffs,
    elements,
    keys,
    fit,
    suggested: best !== null && best !== perm ? best : null,
    mismatch: fit !== null && !cellMatches(fit),
  };
}

/** The stored structure against the ΔPDF's cell; null when none is loaded. */
export function useStructureModel(lattice: Lattice | undefined): StructureModel | null {
  const def = useStructureStore((s) => s.def);
  const perm = useStructureStore((s) => s.perm);
  const data = latticeCell(lattice);
  const key = data ? `${data.a},${data.b},${data.c},${data.alpha},${data.beta},${data.gamma}` : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `data`
  return useMemo(() => (def ? buildModel(def, perm, data) : null), [def, perm, key]);
}

/** The origin site to filter on, or null when none is set or the site no longer exists. */
export function activeOrigin(model: StructureModel | null, origin: string | null): string | null {
  return origin && model?.def.sites.some((s) => s.label === origin) ? origin : null;
}

export type PlaneAxis = "x" | "y" | "z";
const AX_INDEX: Record<PlaneAxis, number> = { x: 0, y: 1, z: 2 };

export interface PlaneSpec {
  h: PlaneAxis; // horizontal, vertical and cut axes of the slice
  v: PlaneAxis;
  cut: PlaneAxis;
  value: number; // the cut (Å)
  hRange: [number, number] | null; // the slice's extent (Å)
  vRange: [number, number] | null;
}

/** The markers of one slice, honouring the store's origin, hidden pairs and depth. */
export function usePlaneMarkers(
  model: StructureModel | null,
  lattice: Lattice | undefined,
  p: PlaneSpec,
  depth: number,
): Marker[] {
  const show = useStructureStore((s) => s.show);
  const origin = activeOrigin(model, useStructureStore((s) => s.origin));
  const hidden = useStructureStore((s) => s.hidden);
  const a = lattice?.a, b = lattice?.b, c = lattice?.c;
  const [h0, h1] = p.hRange ?? [0, 0];
  const [v0, v1] = p.vRange ?? [0, 0];
  return useMemo(() => {
    if (!model || model.mismatch || !show || !a || !b || !c || !p.hRange || !p.vRange) return [];
    return sliceMarkers(model.diffs, {
      lat: [a, b, c],
      axes: [AX_INDEX[p.h], AX_INDEX[p.v], AX_INDEX[p.cut]],
      cut: p.value,
      depth,
      hRange: [h0, h1],
      vRange: [v0, v1],
      origin,
      hidden: new Set(hidden),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ranges are compared by value
  }, [model, show, origin, hidden, a, b, c, p.h, p.v, p.cut, p.value, depth, h0, h1, v0, v1]);
}

/** The markers drawn nearest a display point (all those at that spot), within `radius` Å. */
export function markersNear(markers: Marker[], X: number, Y: number, angle: number, radius: number): Marker[] {
  let best = radius;
  let hits: Marker[] = [];
  for (const m of markers) {
    const [mx, my] = toDisplay(m.h, m.v, angle);
    const d = Math.hypot(mx - X, my - Y);
    if (d < best - 1e-9) {
      best = d;
      hits = [m];
    } else if (Math.abs(d - best) <= 1e-9) {
      hits.push(m);
    }
  }
  return hits;
}
