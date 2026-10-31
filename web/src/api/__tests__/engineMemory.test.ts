// The in-browser engine's memory as the workers report it (engineMemory.ts),
// and the engine's wiring of the pipeline worker's reports (pyodideEngine.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let em: typeof import("../engineMemory");

const MiB = 1024 ** 2;
const DESKTOP = { device: "desktop", heap_budget_bytes: 3_200_000_000, tab_budget_bytes: null };
const MOBILE = { device: "mobile", heap_budget_bytes: 3_200_000_000, tab_budget_bytes: 1_300_000_000 };

beforeEach(async () => {
  vi.resetModules(); // fresh module state per test
  em = await import("../engineMemory");
});

describe("parseBudget", () => {
  it("takes the bridge's budgets", () => {
    expect(em.parseBudget(DESKTOP)).toEqual(DESKTOP);
    expect(em.parseBudget(MOBILE)).toEqual(MOBILE);
  });

  it("refuses what is not one (an older wheel, a failed read)", () => {
    expect(em.parseBudget(null)).toBeNull();
    expect(em.parseBudget({})).toBeNull();
    expect(em.parseBudget({ ...DESKTOP, device: "tv" })).toBeNull();
    expect(em.parseBudget({ ...DESKTOP, heap_budget_bytes: -1 })).toBeNull();
    expect(em.parseBudget({ ...MOBILE, tab_budget_bytes: "1.3 GB" })?.tab_budget_bytes).toBeNull();
  });
});

describe("the store", () => {
  it("publishes the pipeline worker's heap with its budget, and drops it with the worker", () => {
    const seen: (number | null)[] = [];
    const off = em.subscribeEngineMemory((m) => seen.push(m.main));
    em.setMainHeap(400 * MiB, MOBILE);
    expect(em.getEngineMemory()).toEqual({ main: 400 * MiB, ring: [], budget: MOBILE });

    em.setMainHeap(600 * MiB, undefined); // a budget that doesn't parse keeps the last
    expect(em.getEngineMemory().budget).toEqual(MOBILE);

    em.setMainHeap(0, MOBILE); // not a size
    em.clearMainHeap();
    em.clearMainHeap(); // already gone: no news
    expect(seen).toEqual([400 * MiB, 600 * MiB, null]);
    off();
  });

  it("keeps each reporting ring worker's heap, and only tells of a change", () => {
    const fn = vi.fn();
    em.subscribeEngineMemory(fn);
    em.setRingHeaps([200 * MiB, 210 * MiB]);
    em.setRingHeaps([200 * MiB, 210 * MiB]);
    expect(fn).toHaveBeenCalledTimes(1);
    em.setRingHeaps([]);
    expect(em.getEngineMemory().ring).toEqual([]);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------- the engine's wiring

class FakeWorker {
  static last: FakeWorker | null = null;
  listeners = new Map<string, ((ev: unknown) => void)[]>();
  terminated = false;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(): void {}
  addEventListener(type: string, fn: (ev: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string, ev: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
  terminate(): void {
    this.terminated = true;
  }
}

describe("the engine", () => {
  beforeEach(() => {
    FakeWorker.last = null;
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("window", { location: { origin: "https://example.invalid" } });
    vi.stubGlobal("navigator", { userAgent: "test", hardwareConcurrency: 4 });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores the pipeline worker's heap reports and forgets them on cancel", async () => {
    const engine = await import("../pyodideEngine");
    engine.ensureBooted().catch(() => undefined); // never answered here; cancel rejects it
    const worker = FakeWorker.last!;
    worker.emit("message", { data: { id: null, type: "memory", heapBytes: 900 * MiB, budget: DESKTOP } });
    expect(em.getEngineMemory()).toMatchObject({ main: 900 * MiB, budget: DESKTOP });

    engine.cancelPipeline();
    expect(worker.terminated).toBe(true);
    expect(em.getEngineMemory().main).toBeNull();
  });

  it("forgets the heap when the worker crashes", async () => {
    const engine = await import("../pyodideEngine");
    engine.ensureBooted().catch(() => undefined);
    const worker = FakeWorker.last!;
    worker.emit("message", { data: { id: null, type: "memory", heapBytes: 3 * 1024 * MiB, budget: DESKTOP } });
    worker.emit("error", { message: "out of memory" });
    expect(em.getEngineMemory().main).toBeNull();
  });
});
