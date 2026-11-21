// A check's slices, asked for volume by volume.
//
// A Pilot check reads the same planes of every stage's volume. In the
// in-browser build the worker holds two volumes at a time (a tab's memory is
// tight), so asking plane by plane across five stages made it read a whole
// volume from its file for every slice. `readSlices` asks for all of one
// volume's planes in one call (webbridge.volume_slices), which reads the
// volume once whatever the worker held before; each slice is the very
// envelope the one-slice call gives, decoded by the same code.
//
// The native build has a server that keeps a dataset's volumes warm: there
// these are the one-slice requests they always were, one per cut.
//
// A cut the batch could not give (its own error, or the whole call's) is
// asked for alone, by the one-slice call: its slice, or its error exactly as
// before, is what the caller gets.

import { fetchDpdfSlice, fetchSlice } from "./client";
import { decodeSliceBytes, engine, PYODIDE_MODE, type SliceBatch } from "./pyodideEngine";
import type { Slice } from "./types";

/** A reciprocal cut: `interp` as fetchSlice takes it (left out: the nearest plane). */
export interface SliceCut {
  plane: string;
  value: number;
  interp?: boolean;
}

/** A ΔPDF section. */
export interface DpdfCut {
  plane: string;
  value: number;
}

/** What reads one volume's cuts: all of them in one call, and one alone. */
export interface SliceBackend<C> {
  batch: (volumeId: string, cuts: readonly C[]) => Promise<SliceBatch>;
  single: (volumeId: string, cut: C) => Promise<Slice>;
}

/** One promise per cut, in order: the batch's slice, else the one-slice call's answer. */
export function readTogether<C>(backend: SliceBackend<C>, volumeId: string, cuts: readonly C[]): Promise<Slice>[] {
  if (!cuts.length) return [];
  // A batch that fails as a whole leaves every cut to its own call.
  const batch = backend.batch(volumeId, cuts).catch(() => null);
  return cuts.map(async (cut, i) => {
    const item = (await batch)?.items[i];
    return item instanceof Uint8Array ? decodeSliceBytes(item) : backend.single(volumeId, cut);
  });
}

const one = (volumeId: string, cut: SliceCut): Promise<Slice> =>
  cut.interp === undefined ? fetchSlice(volumeId, cut.plane, cut.value) : fetchSlice(volumeId, cut.plane, cut.value, cut.interp);

const hklBackend: SliceBackend<SliceCut> = {
  batch: (volumeId, cuts) =>
    engine.volumeSlices(
      volumeId,
      cuts.map((c) => [c.plane, c.value, c.interp ?? false] as const),
    ),
  single: one,
};

const dpdfBackend: SliceBackend<DpdfCut> = {
  batch: (volumeId, cuts) =>
    engine.dpdfSlices(
      volumeId,
      cuts.map((c) => [c.plane, c.value] as const),
    ),
  single: (volumeId, cut) => fetchDpdfSlice(volumeId, cut.plane, cut.value),
};

/**
 * These cuts of one reciprocal volume: one promise per cut, in order, each
 * settling as `fetchSlice` for that cut would. The volume is read once for
 * all of them in the in-browser build.
 */
export function readSlices(volumeId: string, cuts: readonly SliceCut[]): Promise<Slice>[] {
  if (!PYODIDE_MODE) return cuts.map((cut) => one(volumeId, cut));
  return readTogether(hklBackend, volumeId, cuts);
}

/** These sections of one ΔPDF, as `readSlices`: each settles as `fetchDpdfSlice` would. */
export function readDpdfSlices(volumeId: string, cuts: readonly DpdfCut[]): Promise<Slice>[] {
  if (!PYODIDE_MODE) return cuts.map((cut) => fetchDpdfSlice(volumeId, cut.plane, cut.value));
  return readTogether(dpdfBackend, volumeId, cuts);
}
