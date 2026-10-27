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
  CELL_TOLERANCE,
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
import { symmetryGroup, type Vec3 } from "./symops";

export interface StructureModel {
  def: StructureDef;
  error: string | null; // the operations could not be read
  nOps: number;
  atoms: Atom[];
  diffs: PairDiff[]; // empty when nothing can be drawn (see `blocked`)
  elements: string[]; // in site order
  keys: string[]; // element pairs present, A–A, A–B, …
  fit: CellFit | null; // the CIF cell (axes permuted) against the ΔPDF's
  suggested: number | null; // the permutation that matches, when the current one does not
  // The CIF cell differs from the ΔPDF's (beyond CELL_TOLERANCE): the pairs are
  // still drawn, at the CIF's own lengths, with a warning (structureWarningText).
  mismatch: boolean;
  // Å along the ΔPDF's a, b, c that one lattice period spans where the vectors
  // are placed: the ΔPDF's cell when the CIF's fits it (a slightly different
  // cell, another temperature, does not shift the markers), else the CIF's own
  // (permuted) lengths, so each pair sits at its real distance.  Null before
  // the ΔPDF's cell is known.
  drawLat: Vec3 | null;
  tooMany: boolean; // more than MAX_PAIR_ATOMS atoms per cell: nothing is drawn
  density: number | null; // atoms per Å³ (on the CIF's cell, else the ΔPDF's)
  tooDense: boolean; // denser than MAX_ATOM_DENSITY, no crystal: nothing is drawn
}

/**
 * The most atoms per cell whose pair vectors are drawn.  The pairs are N²
 * (2.5·10⁵ at 500 atoms; a P1 cell keeps every one as its own vector), found
 * once and walked again for each slice of each view.  Measured on a P1 cell
 * of 15 Å³ per atom (±15 Å slices, a shared 4-core machine): 500 atoms take
 * ≲ 0.2 s to build and ≲ 0.1 s a slice; 1000 atoms 1.8 s and 0.2 s, 1500
 * 1.8–10 s and 0.5 s with ~1 GB of memory.  Ordinary structures stay well
 * below (rock salt 8, spinel 56, garnet 160 atoms); above it is a supercell,
 * whose pair vectors are a cloud the ΔPDF could not resolve anyway.
 */
export const MAX_PAIR_ATOMS = 500;

/**
 * Atoms per Å³ past which a structure is no crystal (the densest solids hold
 * ~0.18: diamond 0.176, Be 0.12; most are below 0.1).  Such a CIF has a cell
 * that does not belong to its sites (a supercell's sites on the sub-cell's
 * lattice, say), and the pair vectors per Å³ of the map, N²/V, grow past what
 * a slice can draw: 300 atoms in a 4.2 Å cell blocked the page for 7 s.
 */
export const MAX_ATOM_DENSITY = 0.3;

/** A cell's volume (Å³). */
export function cellVolume(c: Cell): number {
  const [ca, cb, cg] = [c.alpha, c.beta, c.gamma].map((x) => Math.cos((x * Math.PI) / 180));
  return c.a * c.b * c.c * Math.sqrt(Math.max(0, 1 - ca * ca - cb * cb - cg * cg + 2 * ca * cb * cg));
}

/** The ΔPDF's cell, or null when it does not record the lengths. */
export function latticeCell(lat: Lattice | undefined): Cell | null {
  if (!lat || !lat.a || !lat.b || !lat.c) return null;
  return { a: lat.a, b: lat.b, c: lat.c, alpha: lat.alpha ?? 90, beta: lat.beta ?? 90, gamma: lat.gamma ?? 90 };
}

/**
 * The structure against the ΔPDF's cell `data`.  The pair differences — the
 * costly part, N² in the atoms — are found only when they can be drawn: a
 * ΔPDF cell to place them on, no more than MAX_PAIR_ATOMS atoms and no more
 * than MAX_ATOM_DENSITY atoms per Å³.  A CIF cell that differs from the
 * ΔPDF's still draws, at its own lengths (drawLat), flagged as a mismatch.
 */
export function buildModel(def: StructureDef, perm: number, data: Cell | null): StructureModel {
  let error: string | null = null;
  let ops = symmetryGroup("");
  try {
    ops = symmetryGroup(def.ops, def.centering);
  } catch (e) {
    error = (e as Error).message;
  }
  const p = PERMUTATIONS[perm] ?? PERMUTATIONS[0];
  const fit = def.cell && data ? cellFit(def.cell, data, p) : null;
  const best = def.cell && data ? bestPermutation(def.cell, data) : null;
  const mismatch = fit !== null && !cellMatches(fit);
  // Images of one site closer than DUPLICATE_TOLERANCE are one atom, on the
  // CIF's cell (its own axes) or else the ΔPDF's.
  const atoms = permuteAtoms(expandSites(def.sites, ops, def.cell ?? data), p);
  const tooMany = atoms.length > MAX_PAIR_ATOMS;
  const vol = def.cell ?? data ? cellVolume((def.cell ?? data)!) : 0;
  const density = vol > 0 ? atoms.length / vol : null;
  const tooDense = density !== null && density > MAX_ATOM_DENSITY;
  const diffs = data && !tooMany && !tooDense ? pairDifferences(atoms) : [];
  const cif = def.cell ? [def.cell.a, def.cell.b, def.cell.c] : null;
  const drawLat: Vec3 | null = !data
    ? null
    : mismatch && cif
      ? [cif[p[0]], cif[p[1]], cif[p[2]]]
      : [data.a, data.b, data.c];
  // Every element pair occurs (an atom with itself gives A–A), so the keys
  // follow from the elements without the pairs.
  const elements = elementOrder(atoms);
  const keys: string[] = [];
  elements.forEach((a, i) => elements.slice(i).forEach((b) => keys.push(`${a}–${b}`)));
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
    mismatch,
    drawLat,
    tooMany,
    density,
    tooDense,
  };
}

/** Why no vectors are drawn, or null when they are. */
export function structureBlockedText(model: StructureModel): string | null {
  if (model.tooMany) {
    return `${model.atoms.length} atoms per cell, more than the ${MAX_PAIR_ATOMS} whose pair vectors the overlay draws (N² pairs would stall the page), so no vectors are drawn.`;
  }
  if (model.tooDense) {
    return `${model.atoms.length} atoms per cell is ${model.density!.toFixed(2)} atoms/Å³, denser than any crystal (≤ ${MAX_ATOM_DENSITY}) — check the cell and the sites; no vectors are drawn.`;
  }
  return null;
}

/**
 * The caution for vectors that are drawn but rest on an assumption, or null:
 * a CIF cell that differs from the ΔPDF's.  `where` says where the axes are
 * set ("in Edit structure").
 */
export function structureWarningText(model: StructureModel, where = "in Edit structure"): string | null {
  if (!model.mismatch || !model.fit) return null;
  const angles = model.fit.angle > CELL_TOLERANCE.angle;
  return (
    `its cell differs from this ΔPDF's by ${(model.fit.length * 100).toFixed(1)} % in length` +
    (angles ? ` and ${model.fit.angle.toFixed(1)}° in angle` : "") +
    `, so its pair vectors are drawn at the CIF's own lengths (Å) along the ΔPDF's axes` +
    (angles ? "; with the angles differing, vectors off the axes are only approximate" : "") +
    ` — check it is the same phase and axis setting (axes ${where}).`
  );
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
  // The lengths the vectors are placed at: the ΔPDF's cell, or the CIF's own on a mismatch.
  const [a, b, c] = model?.drawLat ?? [lattice?.a, lattice?.b, lattice?.c];
  const [h0, h1] = p.hRange ?? [0, 0];
  const [v0, v1] = p.vRange ?? [0, 0];
  return useMemo(() => {
    if (!model || !show || !a || !b || !c || !p.hRange || !p.vRange) return [];
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
