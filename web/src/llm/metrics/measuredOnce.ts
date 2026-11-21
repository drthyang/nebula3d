// A check's slice metrics, computed once for the slices they were computed
// from.
//
// Every metric here is a pure function of the slices it is given and a few
// plain values (the cut, the cell, a setting the run recorded). A check reads
// the same slices again and again: assess_stage builds every stage's metrics
// for each stage it judges, "all" does so five times, and the report's final
// checks once more. `measuredOnce` keeps a metric's result with the slices and
// values it came from, and gives it back when it is asked for the same ones.
//
// "The same" is the content, never a date, a name or a count: a slice is the
// same when its header and every byte of its data are (the data compared
// whole, bit for bit, against a private copy made when the result was kept),
// and a value when it is exactly (−0 is not +0). So the result kept is the one
// a fresh computation gives, whatever happened to the files in between:
//
// - a run, a tuning trial or a promote that changes a stage's output changes
//   the slices read from it, and the metrics are computed again; the stages it
//   did not change still give their slices, and their metrics are reused;
// - a fix put back (restored outputs) gives the slices from before it again,
//   and the result kept for them, if still held, is theirs;
// - another dataset, another data root, a tuning view, another cut or another
//   setting gives other slices or values. Where they do give the same content,
//   the metrics are the same too;
// - nothing is read from the listing, so a listing read before a run cannot
//   make a result stale. The slices themselves are asked for on every check:
//   the native backend answers from its own cache of the file as it is now
//   (its path and modification time); in the browser a slice is read from the
//   worker, or is one the page kept under the worker's own version of its
//   file, asked of the worker at that check (api/sliceStore.ts).
//
// Both stores are bounded, oldest out first, and emptied when the volume
// closes. A page reload starts empty. A slice given as a plain array (tests),
// or a value that is not plain data, is computed as before and never kept.

import { clearsWithVolume } from "../../state/volumeReset";
import type { GridSlice } from "./sliceStats";

/** Slices kept to compare against: their number, and their bytes together. */
export const SLICES_KEPT = 64;
export const SLICE_BYTES_KEPT = 96 * 1024 * 1024;
/** Results kept. */
export const RESULTS_KEPT = 128;

class NotPlain extends Error {}

const isPlainObject = (v: object): boolean => {
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/** A plain value written exactly: two values write alike only when they are the same, to the bit. */
export function exactText(v: unknown): string {
  switch (typeof v) {
    case "number":
      return Object.is(v, -0) ? "-0" : String(v);
    case "string":
      return JSON.stringify(v);
    case "boolean":
      return v ? "true" : "false";
    case "undefined":
      return "undefined";
    case "object": {
      if (v === null) return "null";
      if (Array.isArray(v)) {
        const items: string[] = [];
        for (let i = 0; i < v.length; i++) items.push(i in v ? exactText(v[i]) : "hole");
        return `[${items.join(",")}]`;
      }
      if (!isPlainObject(v) || Object.getOwnPropertySymbols(v).length) throw new NotPlain();
      const o = v as Record<string, unknown>;
      return `{${Object.keys(o).map((k) => `${JSON.stringify(k)}:${exactText(o[k])}`).join(",")}}`;
    }
    default:
      throw new NotPlain();
  }
}

/** A copy of a plain value, exact and sharing nothing with it. */
function copyOf<T>(v: T): T {
  if (v === null || typeof v !== "object") {
    if (typeof v === "function" || typeof v === "symbol" || typeof v === "bigint") throw new NotPlain();
    return v;
  }
  if (Array.isArray(v)) {
    const out = new Array<unknown>(v.length);
    for (let i = 0; i < v.length; i++) {
      if (!(i in v)) throw new NotPlain();
      out[i] = copyOf(v[i] as unknown);
    }
    return out as T;
  }
  const keys = Object.keys(v);
  if (!isPlainObject(v) || Object.getOwnPropertySymbols(v).length || Object.getOwnPropertyNames(v).length !== keys.length) throw new NotPlain();
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = copyOf((v as Record<string, unknown>)[k]);
  return out as T;
}

// A slice kept to compare against: its header written exactly and a private
// copy of its data's bytes. Its id is never given to other content.
interface Kept {
  id: number;
  kind: string; // the data's array type
  header: string;
  bytes: Uint8Array;
  sum: number; // a quick look before the bytes are compared, never the answer
}

let kept: Kept[] = []; // oldest first
let keptBytes = 0;
let nextId = 1;
let results = new Map<string, unknown>(); // oldest first
const counts = new Map<string, { computed: number; reused: number }>();

const bytesOf = (data: ArrayBufferView): Uint8Array => new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

function quickSum(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  // Every byte of a small slice, and a spread of a large one's: a look, not the test.
  const step = Math.max(1, Math.floor(bytes.length / 65536));
  for (let i = 0; i < bytes.length; i += step) h = Math.imul(h ^ bytes[i], 0x01000193);
  return h >>> 0;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The id of the slice kept with this header and these bytes; kept now, under a new id, when none is. */
function idOf(slice: GridSlice): number {
  const data = slice.data;
  if (!ArrayBuffer.isView(data)) throw new NotPlain();
  const kind = Object.prototype.toString.call(data);
  const header = exactText(slice.header);
  const bytes = bytesOf(data);
  const sum = quickSum(bytes);
  for (let i = kept.length - 1; i >= 0; i--) {
    const k = kept[i];
    if (k.sum === sum && k.kind === kind && k.header === header && sameBytes(k.bytes, bytes)) {
      // Asked for last: kept longest.
      kept.splice(i, 1);
      kept.push(k);
      return k.id;
    }
  }
  const fresh: Kept = { id: nextId++, kind, header, bytes: bytes.slice(), sum };
  kept.push(fresh);
  keptBytes += fresh.bytes.length;
  while (kept.length > 1 && (kept.length > SLICES_KEPT || keptBytes > SLICE_BYTES_KEPT)) keptBytes -= kept.shift()!.bytes.length;
  return fresh.id;
}

const count = (name: string) => {
  let c = counts.get(name);
  if (!c) counts.set(name, (c = { computed: 0, reused: 0 }));
  return c;
};

/**
 * `compute()`, once for these slices and these values: the result kept for
 * the same `name`, the same slices (each present, null or undefined, in this
 * order) and the same `values` is given back, as a copy, in place of
 * computing it again. `compute` must read nothing else that can change.
 */
export function measuredOnce<T>(name: string, slices: readonly (GridSlice | null | undefined)[], values: unknown, compute: () => T): T {
  let key: string;
  try {
    // The slices are copied before the metric runs: the key is what it was given.
    const ids = slices.map((s) => (s === null ? "null" : s === undefined ? "undefined" : String(idOf(s))));
    key = `${name}|${ids.join(",")}|${exactText(values)}`;
  } catch (e) {
    if (!(e instanceof NotPlain)) throw e;
    count(name).computed += 1;
    return compute();
  }
  if (results.has(key)) {
    const hit = results.get(key) as T;
    results.delete(key);
    results.set(key, hit);
    count(name).reused += 1;
    return copyOf(hit);
  }
  count(name).computed += 1;
  const value = compute();
  try {
    results.set(key, copyOf(value));
  } catch (e) {
    if (!(e instanceof NotPlain)) throw e;
    return value;
  }
  while (results.size > RESULTS_KEPT) results.delete(results.keys().next().value as string);
  return value;
}

/** Forget every result and every slice kept. */
export function forgetMeasured(): void {
  kept = [];
  keptBytes = 0;
  results = new Map();
}

// Closing the volume lets go of what was measured on it.
clearsWithVolume(forgetMeasured);

/** How often each metric was computed and reused since the last reset, and what is held (the tests' view). */
export const measuredCounts = (): { by: Record<string, { computed: number; reused: number }>; slices: number; bytes: number; results: number } => ({
  by: Object.fromEntries([...counts].map(([k, v]) => [k, { ...v }])),
  slices: kept.length,
  bytes: keptBytes,
  results: results.size,
});

/** Zero the counts (the tests'). */
export function resetMeasuredCounts(): void {
  counts.clear();
}
