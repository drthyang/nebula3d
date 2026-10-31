// The one classifier for "the in-browser engine hit its limit" (browserLimit.ts):
// every message it must know, the ones it must leave alone, and the numbers it
// reads off them for the run-it-locally card.

import { describe, expect, it } from "vitest";

import {
  BrowserLimitError,
  classifyBrowserLimit,
  limitFromReport,
  LIMIT_TRAPS,
  parseGateReport,
  workerStoppedMessage,
  type GateReport,
  type LimitKind,
} from "../browserLimit";

const GiB = 1024 ** 3;

// The size gate's refusals, as nebula3d.webbridge words them.
const GATE_DESKTOP =
  "“huge.h5” is 501×501×501 (125.8 M voxels). Reducing it would need roughly 5.0 GB of browser memory — " +
  "more than the in-browser engine can hold (it targets volumes up to about 80 M voxels in its float32 " +
  "compute mode). For full-resolution data this large, run the native build, which has no memory limit and " +
  "opens the same interface (QUICKSTART.md, “Native — no size limit”):\n" +
  "    git clone https://github.com/drthyang/nebula3d && cd nebula3d\n" +
  '    pip install -e ".[web]"  &&  make web-install  &&  make ui\n' +
  "    nebula3d-web";
const GATE_PHONE =
  "“mid.h5” is 201×201×151 (6.1 M voxels). On a phone or tablet the in-browser engine takes volumes up to " +
  "about 5 M voxels: a run this size would need roughly 1.5 GB, and the browser reloads the page, losing the " +
  "run, once a tab uses more memory than the device allows. Open it in a desktop browser (up to about 80 M " +
  "voxels), or run the native build, which has no memory limit and opens the same interface.";

const REPORT: GateReport = {
  shape: [501, 501, 501],
  n_voxels: 501 ** 3,
  est_peak_mb: 5030.0,
  ok: false,
  message: GATE_DESKTOP,
  ceiling_voxels: 80_000_000,
  device: "desktop",
};

// What Pyodide makes of a Python exception: the traceback as the message.
const traceback = (...last: string[]) =>
  [
    "Traceback (most recent call last):",
    '  File "/lib/python312.zip/_pyodide/_base.py", line 597, in eval_code_async',
    "    await CodeRunner(",
    '  File "/lib/python3.12/site-packages/nebula3d/pipeline.py", line 1201, in run_pipeline',
    "    data = np.empty(shape, dtype)",
    "           ^^^^^^^^^^^^^^^^^^^^^^",
    ...last,
  ].join("\n");

// Every message the classifier must know, with its kind. Each trap in
// LIMIT_TRAPS needs one here (checked below): a new trap brings its message.
const MATCHES: [string, string, LimitKind][] = [
  ["a Python MemoryError", traceback("MemoryError"), "memory"],
  [
    "numpy's _ArrayMemoryError",
    traceback(
      "numpy._core._exceptions._ArrayMemoryError: Unable to allocate 1.18 GiB for an array with shape (401, 501, 151) and data type float64",
    ),
    "memory",
  ],
  ["numpy's message alone", "Unable to allocate 512 MiB for an array with shape (8, 8) and data type float64", "memory"],
  [
    "a MemoryError that caused another error",
    traceback(
      "MemoryError",
      "",
      "The above exception was the direct cause of the following exception:",
      "",
      "Traceback (most recent call last):",
      '  File "/lib/python3.12/site-packages/nebula3d/pipeline.py", line 90, in _stage',
      "    raise RuntimeError('ring removal failed') from exc",
      "RuntimeError: ring removal failed",
    ),
    "memory",
  ],
  ["numpy's iterator over 2³¹ elements", traceback("ValueError: iterator is too large"), "int32"],
  [
    "numpy refusing int64 indices",
    traceback("TypeError: Cannot cast array data from dtype('int64') to dtype('int32') according to the rule 'safe'"),
    "int32",
  ],
  [
    "numpy's array too big for intp",
    traceback("ValueError: array is too big; `arr.size * arr.dtype.itemsize` is larger than the maximum possible size."),
    "int32",
  ],
  ["numpy's size over intp", traceback("ValueError: Maximum allowed size exceeded"), "int32"],
  ["an int over C ssize_t", traceback("OverflowError: Python int too large to convert to C ssize_t"), "int32"],
  ["V8 / WebKit out of memory", "RangeError: Out of memory", "memory"],
  ["Firefox out of memory", "out of memory", "memory"],
  ["an ArrayBuffer V8 could not allocate", "RangeError: Array buffer allocation failed", "memory"],
  ["a WebAssembly trap past the heap", "RuntimeError: memory access out of bounds", "memory"],
  ["the heap's 4 GiB maximum", "RangeError: WebAssembly.Memory.grow(): Maximum memory size exceeded", "memory"],
  [
    "Emscripten's abort",
    "Aborted(Cannot enlarge memory arrays to size 4294987776 bytes (OOM). Either (1) compile with -sINITIAL_MEMORY=X)",
    "memory",
  ],
  ["Emscripten's short abort", "RuntimeError: Aborted(OOM)", "memory"],
  ["no room for a new WebAssembly heap", "RangeError: WebAssembly.instantiate(): Cannot allocate Wasm memory for new instance", "memory"],
  ["the worker dying mid-run", workerStoppedMessage("Uncaught InternalError: too much recursion"), "worker"],
  ["the worker dying mid-run with no reason", workerStoppedMessage(""), "worker"],
  ["the gate's refusal, desktop", GATE_DESKTOP, "gate"],
  ["the gate's refusal, phone", GATE_PHONE, "gate"],
  ["the engine's short refusal, logged", new BrowserLimitError("huge.h5", REPORT).message, "gate"],
];

describe("classifyBrowserLimit", () => {
  it.each(MATCHES)("knows %s", (_what, message, kind) => {
    expect(classifyBrowserLimit(message)?.kind).toBe(kind);
    expect(classifyBrowserLimit(new Error(message))?.kind).toBe(kind);
  });

  it("has a message in these tests for every trap", () => {
    const untested = LIMIT_TRAPS.filter((t) => !MATCHES.some(([, m]) => t.pattern.test(m)));
    expect(untested.map((t) => t.what)).toEqual([]);
  });

  it("keeps the original error as the detail", () => {
    const message = traceback("MemoryError");
    expect(classifyBrowserLimit(new Error(message))?.detail).toBe(message);
  });

  it("reads a worker that died of running out of memory as memory", () => {
    expect(classifyBrowserLimit(workerStoppedMessage("RangeError: Out of memory"))?.kind).toBe("memory");
  });

  it.each([
    ["a cancel", "Pipeline cancelled"],
    ["the worker failing at boot", "Worker error: Failed to fetch dynamically imported module"],
    ["an unknown dataset", traceback("KeyError: \"unknown dataset id 'nope'\"")],
    ["a bad setting", traceback("ValueError: force_from='x'; choose one of ('rings', 'punch')")],
    [
      "a traceback that only quotes MemoryError in its source",
      traceback("ValueError: bad cell").replace("    data = np.empty(shape, dtype)", "    except MemoryError:  # out of memory"),
    ],
    ["a stack overflow", "RangeError: Maximum call stack size exceeded"],
    ["a server restart", "The server no longer knows this run (it restarted), so the run stopped."],
    ["a file that moved", "Could not read big.nxs again (NotReadableError). Load the volume again, then run."],
    ["Pyodide after an earlier fatal error", "Pyodide already fatally failed and can no longer be used."],
  ])("leaves alone %s", (_what, message) => {
    expect(classifyBrowserLimit(message)).toBeNull();
    expect(classifyBrowserLimit(new Error(message))).toBeNull();
  });

  it("leaves alone what holds no message", () => {
    for (const nothing of [undefined, null, "", "   ", 42, {}, { message: 7 }]) {
      expect(classifyBrowserLimit(nothing)).toBeNull();
    }
  });

  it("reads the allocation that failed", () => {
    const limit = classifyBrowserLimit(traceback("numpy._core._exceptions._ArrayMemoryError: Unable to allocate 1.18 GiB for an array"));
    expect(limit?.requestBytes).toBeCloseTo(1.18 * GiB);
    expect(limit?.needBytes).toBeNull();
    expect(classifyBrowserLimit(traceback("MemoryError"))?.requestBytes).toBeNull();
  });

  it("reads the gate's numbers off its refusal", () => {
    expect(classifyBrowserLimit(GATE_DESKTOP)).toMatchObject({
      kind: "gate",
      needBytes: 5.0e9,
      shape: [501, 501, 501],
      device: "desktop",
      detail: GATE_DESKTOP,
    });
    expect(classifyBrowserLimit(GATE_PHONE)).toMatchObject({ needBytes: 1.5e9, shape: [201, 201, 151], device: "mobile" });
  });
});

describe("the gate's refusal at load", () => {
  it("is a short message with the gate's report and its words beside it", () => {
    const err = new BrowserLimitError("huge.h5", REPORT);
    expect(err.message).toBe("“huge.h5” was not loaded: it is too large for the in-browser engine.");
    expect(err.detail).toBe(GATE_DESKTOP);
    expect(classifyBrowserLimit(err)).toEqual({
      kind: "gate",
      detail: GATE_DESKTOP,
      needBytes: 5.03e9,
      requestBytes: null,
      shape: [501, 501, 501],
      device: "desktop",
    });
  });

  it("is known when it crossed a module boundary (by its name and report)", () => {
    const like = { name: "BrowserLimitError", message: "x", report: REPORT, detail: GATE_DESKTOP };
    expect(classifyBrowserLimit(like)?.needBytes).toBe(5.03e9);
  });

  it("takes only a report that refuses", () => {
    expect(limitFromReport({ ...REPORT, ok: true })).toBeNull();
    expect(limitFromReport(null)).toBeNull();
    expect(limitFromReport(REPORT)?.kind).toBe("gate");
  });
});

describe("parseGateReport", () => {
  it("takes the bridge's report", () => {
    expect(parseGateReport({ ...REPORT, precision: "float32" })).toEqual(REPORT);
  });

  it("refuses what is not one", () => {
    expect(parseGateReport(null)).toBeNull();
    expect(parseGateReport("ok")).toBeNull();
    expect(parseGateReport({ ok: false })).toBeNull();
    expect(parseGateReport({ ...REPORT, est_peak_mb: Number.NaN })).toBeNull();
  });
});
