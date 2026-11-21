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
//
// The checks that follow one another ask for the same slices of the same
// files. In the in-browser build a slice fetched here is kept (api/sliceStore.ts)
// under the version the worker read it at, and used again only when the worker,
// asked first at every read, gives that same version for the file: then the
// volume is not read at all. A read whose batch names another version than
// the one just asked for (the file changed in between) uses nothing kept: every
// cut is read again, together.

import { fetchDpdfSlice, fetchSlice } from "./client";
import { isMobileDevice } from "./device";
import { decodeSliceBytes, engine, PYODIDE_MODE, type SliceBatch } from "./pyodideEngine";
import { keepSlice, keptSlice, sliceKey } from "./sliceStore";
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
  // With both, the slices read are kept and used again while the file's
  // version stands (api/sliceStore.ts): the version of the volume's file now,
  // from the worker (null: not there), and what names a cut among the volume's.
  version?: (volumeId: string) => Promise<string | null>;
  key?: (volumeId: string, cut: C) => string;
}

// A phone or a tablet keeps no slices: its tab's memory is budgeted (api/device.ts).
const keeps = (): boolean => typeof navigator !== "undefined" && !isMobileDevice(navigator);

/**
 * Each cut's envelope, or null for one to ask for alone: those kept under the
 * file's version as it is now, and the rest read together in one call.
 */
async function envelopes<C>(backend: SliceBackend<C>, volumeId: string, cuts: readonly C[], keep: boolean): Promise<(Uint8Array | null)[]> {
  const { version: versionOf, key } = backend;
  const keys = keep && versionOf && key ? cuts.map((c) => key(volumeId, c)) : null;
  // Asked of the worker at every read; a failure keeps nothing and reads all.
  const version = keys ? await versionOf!(volumeId).catch(() => null) : null;
  let out: (Uint8Array | null)[] = cuts.map((_c, i) => (keys && version ? keptSlice(keys[i], version) : null));
  let missing = cuts.map((_c, i) => i).filter((i) => !out[i]);
  if (!missing.length) return out;
  // A batch that fails as a whole leaves every cut to its own call.
  const read = (which: number[]) => backend.batch(volumeId, which.map((i) => cuts[i])).catch(() => null);
  let batch = await read(missing);
  if (batch && missing.length < cuts.length && batch.version !== version) {
    // The file changed between the version and the read: nothing kept is
    // used, and every cut is read again, together.
    out = cuts.map(() => null);
    missing = cuts.map((_c, i) => i);
    batch = await read(missing);
  }
  batch?.items.forEach((item, k) => {
    if (!(item instanceof Uint8Array)) return;
    out[missing[k]] = item;
    // Kept under the version the worker read it at, said in the same call.
    if (keys && batch.version) keepSlice(keys[missing[k]], batch.version, item);
  });
  return out;
}

/** One promise per cut, in order: the slice kept or the batch's, else the one-slice call's answer. */
export function readTogether<C>(backend: SliceBackend<C>, volumeId: string, cuts: readonly C[], keep = keeps()): Promise<Slice>[] {
  if (!cuts.length) return [];
  const all = envelopes(backend, volumeId, cuts, keep);
  return cuts.map(async (cut, i) => {
    const envelope = (await all)[i];
    return envelope ? decodeSliceBytes(envelope) : backend.single(volumeId, cut);
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
  version: (volumeId) => engine.sliceVersion(volumeId),
  key: (volumeId, c) => sliceKey("hkl", volumeId, [c.plane, c.value, c.interp ?? false]),
};

const dpdfBackend: SliceBackend<DpdfCut> = {
  batch: (volumeId, cuts) =>
    engine.dpdfSlices(
      volumeId,
      cuts.map((c) => [c.plane, c.value] as const),
    ),
  single: (volumeId, cut) => fetchDpdfSlice(volumeId, cut.plane, cut.value),
  version: (volumeId) => engine.sliceVersion(volumeId),
  key: (volumeId, c) => sliceKey("dpdf", volumeId, [c.plane, c.value]),
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
