// Slices the checks fetched, kept in the page under the version of the file
// they were read from (the in-browser build only).
//
// A check's slices come from the worker; the checks after it (each stage's,
// then the report's final ones) ask for the same slices of the same files. A
// slice is kept here as the worker sent it (its envelope's bytes, a private
// copy) with the version the worker read it under, and given back only when
// the worker, asked again at that check, names the same version for the file.
//
// The version is the worker's alone (nebula3d.webbridge._file_version): the
// worker itself, its count of the calls that may have changed a file of its
// workspace (every run, tuning trial, promote, set-aside, restore, regrid and
// load moves it, when the call starts and when it ends), and the file's path,
// size, modification time and inode. Two equal versions name the same bytes,
// and a version never comes back: a file put back with its old date is under
// a new one. Nothing here reads the page's dataset listing, a clock or a
// count kept in the page.
//
// A slice given back is decoded from the kept bytes by the decoder a fresh
// fetch uses, into arrays of its own. The store is bounded, the slices asked
// for longest ago out first; it is emptied when the volume closes and when
// the worker goes (its files go with it). A phone or a tablet keeps nothing:
// its tab's memory is budgeted (api/device.ts).

import { clearsWithVolume } from "../state/volumeReset";

/** Slices kept, and their bytes together. */
export const SLICES_KEPT = 64;
export const SLICE_BYTES_KEPT = 48 * 1024 * 1024;

interface Kept {
  version: string;
  envelope: Uint8Array;
}

let kept = new Map<string, Kept>(); // asked for longest ago first
let keptBytes = 0;
const counts = { reused: 0, kept: 0 };

/** A cut's value written exactly (−0 is not +0). */
const exact = (v: unknown): string => (typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : JSON.stringify(v) ?? "undefined");

/** What names one slice of one volume: the kind of volume, its id and the cut. */
export const sliceKey = (kind: string, volumeId: string, cut: readonly unknown[]): string => JSON.stringify([kind, volumeId, cut.map(exact)]);

function drop(key: string): void {
  const k = kept.get(key);
  if (!k) return;
  keptBytes -= k.envelope.byteLength;
  kept.delete(key);
}

/** The envelope kept for `key`, when it was read under exactly `version`; a slice kept under another version is dropped. */
export function keptSlice(key: string, version: string): Uint8Array | null {
  const k = kept.get(key);
  if (!k) return null;
  if (k.version !== version) {
    drop(key); // a version never comes back
    return null;
  }
  kept.delete(key);
  kept.set(key, k);
  counts.reused += 1;
  return k.envelope;
}

/** Keep a private copy of `envelope` for `key`, read under `version`. */
export function keepSlice(key: string, version: string, envelope: Uint8Array): void {
  drop(key);
  if (envelope.byteLength > SLICE_BYTES_KEPT / 4) return;
  kept.set(key, { version, envelope: envelope.slice() });
  keptBytes += envelope.byteLength;
  counts.kept += 1;
  while (kept.size > SLICES_KEPT || keptBytes > SLICE_BYTES_KEPT) drop(kept.keys().next().value as string);
}

/** Forget every slice kept. */
export function forgetSlices(): void {
  kept = new Map();
  keptBytes = 0;
}

// Closing the volume lets go of its slices.
clearsWithVolume(forgetSlices);

/** What is held, and how often a slice was kept and reused since the last reset (the tests' view). */
export const sliceStoreCounts = (): { slices: number; bytes: number; reused: number; kept: number } => ({ slices: kept.size, bytes: keptBytes, ...counts });

/** Zero the counts (the tests'). */
export function resetSliceStoreCounts(): void {
  counts.reused = 0;
  counts.kept = 0;
}
