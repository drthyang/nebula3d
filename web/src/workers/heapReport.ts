// The WASM heap of a Pyodide worker, as the console's memory bar shows it.
//
// What is measured: the size of the worker's WebAssembly linear memory. Pyodide
// grows it as Python allocates and never shrinks it (wasm memory cannot be
// returned), so the number is the heap's high-water mark, not what Python is
// using now: memory freed inside it is reused, but stays counted here. A run
// fails once it needs more than the ceiling below.
//
// Push, not poll: each worker reports its own heap, and only when it changed,
// on a slow timer and at the moments it is known to move (a pipeline progress
// event, the end of a call, a ring plane). The main thread never asks, so no
// request queues behind a long synchronous stage (the worker's event loop is
// blocked then, and its timer with it: the progress events fill the gap).

// Pyodide ≥ 0.27 builds with MAXIMUM_MEMORY=4GB, the most a wasm32 heap can
// address (65536 pages of 64 KiB); there is no wasm64 Pyodide build (see
// PYODIDE_VERSION in pyodideShared.ts and nebula3d.webbridge's budget notes).
export const WASM_HEAP_CEILING_BYTES = 4 * 1024 ** 3;

// How often a worker looks at its heap between the moments it is known to move.
export const HEAP_REPORT_MS = 2000;

// The heap size of a Pyodide instance, read off its Emscripten module, or null
// when none of the places it can live is readable. A view whose buffer was
// detached by a heap growth reads 0: that is not a size, so the next place is
// tried. `_module` is Pyodide's private handle on the Emscripten module (stable
// across 0.2x); every access is guarded, so a release that moves it hides the
// bar instead of breaking the worker.
export function wasmHeapBytes(py: unknown): number | null {
  let mod: Record<string, unknown> | undefined;
  try {
    mod = (py as { _module?: Record<string, unknown> } | null)?._module;
  } catch {
    return null;
  }
  if (!mod || typeof mod !== "object") return null;
  for (const key of ["wasmMemory", "HEAP8", "HEAPU8"]) {
    try {
      const n = (mod[key] as { buffer?: ArrayBufferLike } | undefined)?.buffer?.byteLength;
      if (typeof n === "number" && Number.isFinite(n) && n > 0) return n;
    } catch {
      // an accessor that throws: try the next place
    }
  }
  return null;
}

export interface HeapReporter {
  // Look now, and send if the size changed since the last send.
  report(): void;
  stop(): void;
}

// Sends `read()` through `send` at once, then whenever it changes: on every
// report() and every `intervalMs`. A read of null sends nothing.
export function startHeapReporter(
  read: () => number | null,
  send: (bytes: number) => void,
  intervalMs: number = HEAP_REPORT_MS,
): HeapReporter {
  let last: number | null = null;
  const report = (): void => {
    const bytes = read();
    if (bytes === null || bytes === last) return;
    last = bytes;
    send(bytes);
  };
  report();
  const timer = setInterval(report, intervalMs);
  return { report, stop: () => clearInterval(timer) };
}
