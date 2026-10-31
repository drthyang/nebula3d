// The WASM heap probe the memory bar reads (heapReport.ts): where the heap
// size is read off a Pyodide instance, and when a worker sends it.

import { afterEach, describe, expect, it, vi } from "vitest";

import { HEAP_REPORT_MS, startHeapReporter, WASM_HEAP_CEILING_BYTES, wasmHeapBytes } from "../heapReport";

const MiB = 1024 ** 2;
const buffer = (bytes: number) => ({ buffer: { byteLength: bytes } });

describe("wasmHeapBytes", () => {
  it("reads the module's wasm memory first", () => {
    const py = { _module: { wasmMemory: buffer(512 * MiB), HEAP8: buffer(256 * MiB) } };
    expect(wasmHeapBytes(py)).toBe(512 * MiB);
  });

  it("falls back to the heap views when the memory is not exported", () => {
    expect(wasmHeapBytes({ _module: { HEAP8: buffer(300 * MiB) } })).toBe(300 * MiB);
    expect(wasmHeapBytes({ _module: { HEAPU8: buffer(310 * MiB) } })).toBe(310 * MiB);
  });

  it("skips a view whose buffer a heap growth detached (it reads 0)", () => {
    const py = { _module: { HEAP8: buffer(0), HEAPU8: buffer(640 * MiB) } };
    expect(wasmHeapBytes(py)).toBe(640 * MiB);
  });

  it("skips an accessor that throws", () => {
    const mod = { HEAP8: buffer(700 * MiB) };
    Object.defineProperty(mod, "wasmMemory", {
      get() {
        throw new Error("'wasmMemory' was not exported");
      },
    });
    expect(wasmHeapBytes({ _module: mod })).toBe(700 * MiB);
  });

  it("is null when nothing readable is there", () => {
    expect(wasmHeapBytes(null)).toBeNull();
    expect(wasmHeapBytes({})).toBeNull();
    expect(wasmHeapBytes({ _module: {} })).toBeNull();
    expect(wasmHeapBytes({ _module: { HEAP8: buffer(0) } })).toBeNull();
    expect(wasmHeapBytes({ _module: { HEAP8: { buffer: { byteLength: Number.NaN } } } })).toBeNull();
  });

  it("knows Pyodide's ceiling: the 4 GiB a wasm32 heap addresses", () => {
    expect(WASM_HEAP_CEILING_BYTES).toBe(65536 * 65536);
  });
});

describe("startHeapReporter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends at once, then only when the size changed", () => {
    vi.useFakeTimers();
    let heap: number | null = 100 * MiB;
    const sent: number[] = [];
    const r = startHeapReporter(() => heap, (b) => sent.push(b));
    expect(sent).toEqual([100 * MiB]);

    r.report();
    vi.advanceTimersByTime(3 * HEAP_REPORT_MS);
    expect(sent).toEqual([100 * MiB]); // unchanged: nothing more

    heap = 180 * MiB;
    r.report(); // a progress event, the end of a call, a plane
    expect(sent).toEqual([100 * MiB, 180 * MiB]);

    heap = 260 * MiB;
    vi.advanceTimersByTime(HEAP_REPORT_MS); // the slow timer
    expect(sent).toEqual([100 * MiB, 180 * MiB, 260 * MiB]);
    r.stop();
  });

  it("sends nothing for an unreadable heap, and stops with stop()", () => {
    vi.useFakeTimers();
    let heap: number | null = null;
    const send = vi.fn();
    const r = startHeapReporter(() => heap, send, 1000);
    vi.advanceTimersByTime(5000);
    expect(send).not.toHaveBeenCalled();

    r.stop();
    heap = 50 * MiB;
    vi.advanceTimersByTime(5000);
    expect(send).not.toHaveBeenCalled();
  });
});
