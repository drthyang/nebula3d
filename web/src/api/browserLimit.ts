// Whether a failure is the in-browser engine's limit, the one the local
// version (`nebula3d-web`) does not have. Pyodide is wasm32: its heap stops at
// 4 GiB and never shrinks, numpy indexes in 32 bits there, and a phone's tab
// gets far less (the size gate plans a phone at about 1.3 GB, the whole tab).
// Native Python is limited only by the machine's RAM.
//
// One classifier for every place such a failure surfaces: the size gate's
// refusal at load (webbridge.inspect_input, passed on as a GateReport), a
// run's error (a Python MemoryError, a 32-bit trap, WebAssembly running out
// of memory), and the pipeline worker dying mid-run. The console turns a match
// into its run-it-locally card (components/LocalHandoff.tsx); the original
// error stays behind the card's "Details".
//
// Two of them the engine marks on the error rather than in its words
// (pyodideEngine.ts): the gate's report (`gateReport`) and a worker that died
// with a run in flight (`workerStopped`). A run's error text reaches NEBULA
// Pilot (the run_pipeline tool's failure), so it stays as it was.
//
// A new 32-bit trap is one more entry in LIMIT_TRAPS, with its message in the
// tests (api/__tests__/browserLimit.test.ts).
//
// A known data error (dataError.ts: WindowSupportError, FFTOriginError, …) is
// never the limit, whatever its words: the local version would stop the same
// way. classifyRunError sorts a run's failure into the three classes.

import { parseDataError, type DataError } from "./dataError";

export type LimitKind =
  | "gate" // the size gate refused the volume (at load, or its estimate before a run)
  | "memory" // the run ran out of memory
  | "int32" // a 32-bit limit: an array or an index too large for wasm32
  | "worker"; // the pipeline worker died mid-run

/** The size gate's report (nebula3d.webbridge.inspect_input / inspect_dataset_json). */
export interface GateReport {
  shape: number[];
  n_voxels: number;
  est_peak_mb: number; // decimal MB, what a full run is estimated to need
  ok: boolean;
  message: string; // the refusal, when not ok
  ceiling_voxels: number;
  device: "desktop" | "mobile";
}

export interface BrowserLimit {
  kind: LimitKind;
  detail: string; // the original error, for "Details"
  needBytes: number | null; // the gate's estimate of what a run needs
  requestBytes: number | null; // the allocation that failed (numpy's "Unable to allocate …")
  shape: number[] | null; // the volume's grid, when known
  device: "desktop" | "mobile" | null; // whose budget the gate applied, when known
}

export interface LimitTrap {
  kind: LimitKind;
  pattern: RegExp;
  what: string; // where the message comes from
}

/**
 * The messages that mean the in-browser engine hit its limit, by kind. Tried
 * in order, so a worker that died of an out-of-memory error reads as memory.
 * A Python traceback is matched on its exception lines only, not on the
 * source lines it quotes.
 */
export const LIMIT_TRAPS: readonly LimitTrap[] = [
  // The size gate's refusal as text (a reload mid-run, a stored log line).
  { kind: "gate", pattern: /too large for the in-browser engine/i, what: "the engine's refusal of a volume the gate refused" },
  { kind: "gate", pattern: /more than the in-browser engine can hold/i, what: "webbridge's size gate, desktop" },
  { kind: "gate", pattern: /On a phone or tablet the in-browser engine takes volumes up to/i, what: "webbridge's size gate, phone or tablet" },

  // 32-bit: numpy's intp is 32 bits in wasm32, so are C long and ssize_t.
  { kind: "int32", pattern: /iterator is too large/i, what: "numpy nditer over more than 2³¹ elements" },
  {
    kind: "int32",
    pattern: /Cannot cast array data from dtype\('u?int64'\) to dtype\('u?int32'\)/,
    what: "numpy refusing int64 indices where intp is int32 (np.bincount, take, …)",
  },
  { kind: "int32", pattern: /array is too big/i, what: "numpy: the array's byte size overflows intp" },
  { kind: "int32", pattern: /Maximum allowed (?:size|dimension) exceeded/i, what: "numpy: a size or dimension over intp" },
  { kind: "int32", pattern: /too large to convert to C (?:ssize_t|long)\b/, what: "CPython: an int over 32 bits where C wants ssize_t / long" },

  // Out of memory: Python's, and WebAssembly's or the JS engine's.
  { kind: "memory", pattern: /MemoryError\b/, what: "Python MemoryError, numpy's _ArrayMemoryError" },
  { kind: "memory", pattern: /Unable to allocate [\d.]+ ?(?:[KMGTP]i?B|bytes)/i, what: "numpy's out-of-memory message" },
  { kind: "memory", pattern: /\bout of memory\b/i, what: "RangeError: Out of memory (V8, WebKit, Firefox)" },
  { kind: "memory", pattern: /Array buffer allocation failed/i, what: "V8: an ArrayBuffer it could not allocate" },
  { kind: "memory", pattern: /memory access out of bounds/i, what: "WebAssembly trap past the heap" },
  { kind: "memory", pattern: /Maximum memory size exceeded/i, what: "WebAssembly.Memory.grow() past the 4 GiB maximum" },
  { kind: "memory", pattern: /Cannot enlarge memory|Aborted\(OOM\)/i, what: "Emscripten's abort when the heap cannot grow" },
  { kind: "memory", pattern: /Cannot allocate Wasm memory/i, what: "V8: no room for a new WebAssembly heap" },
];

/** Marks *err* as the pipeline worker dying with a run in flight (its words unchanged). */
export function markWorkerStopped<E extends Error>(err: E): E & { workerStopped: true } {
  return Object.assign(err, { workerStopped: true as const });
}

/** Marks *err* as the size gate's refusal, with its report (its words unchanged). */
export function markGateRefusal<E extends Error>(err: E, report: GateReport): E & { gateReport: GateReport } {
  return Object.assign(err, { gateReport: report });
}

/**
 * A load the size gate refused, as "Load volume…" shows it: a short message
 * (the card beside it says the rest), the gate's report, and its own words as
 * the detail.
 */
export class BrowserLimitError extends Error {
  readonly gateReport: GateReport;
  readonly detail: string;
  constructor(fileName: string, report: GateReport) {
    super(`“${fileName}” was not loaded: it is too large for the in-browser engine.`);
    this.name = "BrowserLimitError";
    this.gateReport = report;
    this.detail = report.message || this.message;
  }
}

/** The words a load's failure is reported in: the gate's own for its refusal. */
export function errorDetail(err: unknown): string {
  if (err instanceof BrowserLimitError) return err.detail;
  return errorText(err) ?? String(err);
}

/** The gate's report as the worker sent it, or null when it is not one. */
export function parseGateReport(raw: unknown): GateReport | null {
  const r = raw as Partial<GateReport> | null | undefined;
  if (!r || typeof r !== "object") return null;
  if (typeof r.ok !== "boolean" || typeof r.est_peak_mb !== "number" || !Number.isFinite(r.est_peak_mb)) return null;
  return {
    shape: Array.isArray(r.shape) ? r.shape.filter((n): n is number => typeof n === "number") : [],
    n_voxels: typeof r.n_voxels === "number" ? r.n_voxels : 0,
    est_peak_mb: r.est_peak_mb,
    ok: r.ok,
    message: typeof r.message === "string" ? r.message : "",
    ceiling_voxels: typeof r.ceiling_voxels === "number" ? r.ceiling_voxels : 0,
    device: r.device === "mobile" ? "mobile" : "desktop",
  };
}

/** The limit a refusing gate report describes, or null when the volume fits. */
export function limitFromReport(report: GateReport | null | undefined): BrowserLimit | null {
  if (!report || report.ok) return null;
  return {
    kind: "gate",
    detail: report.message,
    needBytes: report.est_peak_mb > 0 ? report.est_peak_mb * 1e6 : null,
    requestBytes: null,
    shape: report.shape.length ? report.shape : null,
    device: report.device,
  };
}

const UNITS: Record<string, number> = {
  B: 1,
  BYTES: 1,
  KB: 1e3,
  MB: 1e6,
  GB: 1e9,
  TB: 1e12,
  PB: 1e15,
  KIB: 1024,
  MIB: 1024 ** 2,
  GIB: 1024 ** 3,
  TIB: 1024 ** 4,
  PIB: 1024 ** 5,
};

function bytesOf(value: string, unit: string): number | null {
  const n = Number(value);
  const scale = UNITS[unit.toUpperCase()];
  return Number.isFinite(n) && scale ? n * scale : null;
}

// A Python traceback's exception lines (each chained exception's, and a
// message's continuation lines): the unindented lines after the header. The
// indented ones are frames and the source they quote, which may name anything.
function exceptionText(text: string): string {
  if (!/^.*Traceback \(most recent call last\):/m.test(text)) return text;
  return text
    .split("\n")
    .filter((line) => line.trim() && !/^\s/.test(line) && !/Traceback \(most recent call last\):/.test(line))
    .join("\n");
}

function errorText(err: unknown): string | null {
  if (typeof err === "string") return err;
  const m = (err as { message?: unknown } | null | undefined)?.message;
  return typeof m === "string" ? m : null;
}

const mark = (err: unknown, key: "gateReport" | "workerStopped"): unknown =>
  err && typeof err === "object" ? (err as Record<string, unknown>)[key] : undefined;

/**
 * Whether *err* (an Error, a rejection, a logged message) is the in-browser
 * engine's limit, and what is known about it; null for any other failure.
 */
export function classifyBrowserLimit(err: unknown): BrowserLimit | null {
  const text = errorText(err);
  const gate = limitFromReport(parseGateReport(mark(err, "gateReport")));
  if (gate) return { ...gate, detail: gate.detail || text || "" };
  if (!text || !text.trim()) {
    return mark(err, "workerStopped") === true ? { ...NOTHING_KNOWN, kind: "worker", detail: "" } : null;
  }
  if (parseDataError(text)) return null; // the data's or the settings', not the engine's
  const searched = exceptionText(text);
  const trap = LIMIT_TRAPS.find((t) => t.pattern.test(searched));
  if (!trap) {
    // A worker that died mid-run, of nothing its words name.
    return mark(err, "workerStopped") === true ? { ...NOTHING_KNOWN, kind: "worker", detail: text } : null;
  }

  const request = /Unable to allocate ([\d.]+) ?([KMGTP]i?B|bytes)/i.exec(searched);
  const need = trap.kind === "gate" ? /roughly ([\d.]+) ?([KMGT]i?B)/i.exec(searched) : null;
  const shape = trap.kind === "gate" ? /\bis (\d+(?:×\d+)+)\b/.exec(searched) : null;
  return {
    kind: trap.kind,
    detail: text,
    needBytes: need ? bytesOf(need[1], need[2]) : null,
    requestBytes: request ? bytesOf(request[1], request[2]) : null,
    shape: shape ? shape[1].split("×").map(Number) : null,
    device: trap.kind === "gate" ? (/phone or tablet/i.test(searched) ? "mobile" : "desktop") : null,
  };
}

const NOTHING_KNOWN: Omit<BrowserLimit, "kind" | "detail"> = {
  needBytes: null,
  requestBytes: null,
  shape: null,
  device: null,
};

/**
 * Before a run: the size gate's estimate for the selected dataset (the engine
 * asks the bridge, engine.inspectDataset), as a limit when it is over the
 * budget. Advisory: no dataset, an answer that is not a report, or a failed
 * question (an older wheel without the call) says nothing.
 */
export async function checkBeforeRun(
  datasetId: string | null | undefined,
  inspect: (datasetId: string) => Promise<GateReport | null>,
): Promise<BrowserLimit | null> {
  if (!datasetId) return null;
  try {
    return limitFromReport(await inspect(datasetId));
  } catch {
    return null;
  }
}

/** A run's failure, sorted: the engine's limit, a known data error, or anything else. */
export type RunErrorClass =
  | { kind: "limit"; limit: BrowserLimit } // the run-it-locally card
  | { kind: "data"; error: DataError } // its own message, the traceback behind "Details"
  | { kind: "other" }; // shown as it always was

export function classifyRunError(err: unknown): RunErrorClass {
  const limit = classifyBrowserLimit(err);
  if (limit) return { kind: "limit", limit };
  const error = parseDataError(errorText(err));
  return error ? { kind: "data", error } : { kind: "other" };
}
