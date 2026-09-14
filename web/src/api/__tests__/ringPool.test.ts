// Lifecycle tests for the main-thread ring-worker pool: sizing heuristics,
// wiring (one transferred port per worker to each side), idempotency, dispose.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: { data: { type: string; [k: string]: unknown }; transfer: unknown[] }[] = [];
  terminated = false;
  listeners = new Map<string, ((ev: unknown) => void)[]>();

  constructor(public url: URL, public opts: unknown) {
    FakeWorker.instances.push(this);
  }

  postMessage(data: unknown, transfer: unknown[] = []): void {
    this.posted.push({ data: data as never, transfer });
  }

  addEventListener(type: string, fn: (ev: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  emit(type: string, data: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn({ data });
  }

  terminate(): void {
    this.terminated = true;
  }
}

let ringPool: typeof import("../ringPool");
const storage = new Map<string, string>();

beforeEach(async () => {
  FakeWorker.instances = [];
  storage.clear();
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("navigator", { hardwareConcurrency: 8 });
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
  });
  vi.resetModules(); // fresh module-scoped pool state per test
  ringPool = await import("../ringPool");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function pipelineWorker(): FakeWorker {
  return new FakeWorker(new URL("https://x/pipeline"), {});
}

describe("pool sizing", () => {
  it("auto size is min(4, hardwareConcurrency - 2)", () => {
    expect(ringPool.autoPoolSize()).toBe(4);
    vi.stubGlobal("navigator", { hardwareConcurrency: 4 });
    expect(ringPool.autoPoolSize()).toBe(2);
    vi.stubGlobal("navigator", { hardwareConcurrency: 2 });
    expect(ringPool.autoPoolSize()).toBe(0);
  });

  it("localStorage overrides, clamped to [0, 8]", () => {
    storage.set("nebula3d.ringWorkers", "6");
    expect(ringPool.desiredPoolSize()).toBe(6);
    storage.set("nebula3d.ringWorkers", "0");
    expect(ringPool.desiredPoolSize()).toBe(0);
    storage.set("nebula3d.ringWorkers", "99");
    expect(ringPool.desiredPoolSize()).toBe(8);
    storage.set("nebula3d.ringWorkers", "junk");
    expect(ringPool.desiredPoolSize()).toBe(4);
  });
});

describe("ensureRingPool", () => {
  it("spawns N workers, wiring one port to each side", () => {
    const pw = pipelineWorker();
    FakeWorker.instances = []; // ignore the pipeline worker itself
    ringPool.ensureRingPool(pw as unknown as Worker, "https://x/");
    expect(FakeWorker.instances).toHaveLength(4);
    for (const w of FakeWorker.instances) {
      const types = w.posted.map((p) => p.data.type);
      expect(types).toEqual(["port", "boot"]);
      expect(w.posted[0].transfer).toHaveLength(1); // the MessagePort
      expect(w.posted[1].data.wheelUrl).toBe("https://x/");
    }
    const ringPorts = pw.posted.filter((p) => p.data.type === "ring_port");
    expect(ringPorts).toHaveLength(4);
    for (const p of ringPorts) expect(p.transfer).toHaveLength(1);
  });

  it("is idempotent for the same pipeline worker", () => {
    const pw = pipelineWorker();
    FakeWorker.instances = [];
    ringPool.ensureRingPool(pw as unknown as Worker, "https://x/");
    ringPool.ensureRingPool(pw as unknown as Worker, "https://x/");
    expect(FakeWorker.instances).toHaveLength(4);
  });

  it("rebuilds for a new pipeline worker (post-cancel)", () => {
    const pw1 = pipelineWorker();
    FakeWorker.instances = [];
    ringPool.ensureRingPool(pw1 as unknown as Worker, "https://x/");
    const firstGen = [...FakeWorker.instances];
    const pw2 = pipelineWorker();
    FakeWorker.instances = [];
    ringPool.ensureRingPool(pw2 as unknown as Worker, "https://x/");
    expect(FakeWorker.instances).toHaveLength(4);
    for (const w of firstGen) expect(w.terminated).toBe(true);
  });

  it("spawns nothing when disabled via setting", () => {
    storage.set("nebula3d.ringWorkers", "0");
    const pw = pipelineWorker();
    FakeWorker.instances = [];
    ringPool.ensureRingPool(pw as unknown as Worker, "https://x/");
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it("tracks ready/failed status and notifies subscribers", () => {
    const pw = pipelineWorker();
    FakeWorker.instances = [];
    const seen: { desired: number; ready: number; failed: number }[] = [];
    ringPool.subscribeRingPool((s) => seen.push(s));
    ringPool.ensureRingPool(pw as unknown as Worker, "https://x/");
    FakeWorker.instances[0].emit("message", { type: "ready" });
    FakeWorker.instances[1].emit("message", { type: "boot_error", message: "x" });
    const last = seen[seen.length - 1];
    expect(last.desired).toBe(4);
    expect(last.ready).toBe(1);
    expect(last.failed).toBe(1);
  });

  it("dispose terminates every worker", () => {
    const pw = pipelineWorker();
    FakeWorker.instances = [];
    ringPool.ensureRingPool(pw as unknown as Worker, "https://x/");
    const workers = [...FakeWorker.instances];
    ringPool.disposeRingPool();
    for (const w of workers) expect(w.terminated).toBe(true);
    expect(ringPool.ringPoolStatus().desired).toBe(0);
  });
});
