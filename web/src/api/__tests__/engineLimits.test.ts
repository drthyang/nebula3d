// The engine's side of the run-it-locally card (pyodideEngine.ts): what it
// marks on a failure and keeps in limitSignals.ts, with the words of every
// error left as they were (a run's reach NEBULA Pilot's run_pipeline tool).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ringPool", () => ({
  ensureRingPool: vi.fn(),
  disposeRingPool: vi.fn(),
  ringPoolStatus: vi.fn(),
  subscribeRingPool: vi.fn(() => () => undefined),
}));

type Msg = { id: number; type: string; method?: string; args?: unknown[] };

const REPORT = {
  shape: [501, 501, 501],
  n_voxels: 501 ** 3,
  est_peak_mb: 5030,
  ok: false,
  message: "“huge.h5” is 501×501×501 (125.8 M voxels). Reducing it would need roughly 5.0 GB …",
  precision: "float32",
  ceiling_voxels: 80_000_000,
  device: "desktop",
};
const MEMORY_ERROR = "Traceback (most recent call last):\n  File \"x.py\", line 1, in f\n    a = np.empty(n)\nMemoryError\n";

// A pipeline worker that answers boot and select_input, and leaves the rest to
// the test: `answer` replies to the last request of a type.
class FakeWorker {
  static last: FakeWorker | null = null;
  listeners = new Map<string, ((ev: unknown) => void)[]>();
  posted: Msg[] = [];
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(msg: Msg): void {
    this.posted.push(msg);
    if (msg.type === "boot") this.reply({ id: msg.id, type: "result", payload: "wheel" });
    if (msg.type === "json_call" && msg.method === "select_input") this.reply({ id: msg.id, type: "result", payload: "true" });
  }
  reply(data: Record<string, unknown>): void {
    queueMicrotask(() => this.emit("message", { data }));
  }
  answer(type: string, data: Record<string, unknown>): void {
    const msg = [...this.posted].reverse().find((m) => m.type === type);
    if (!msg) throw new Error(`no ${type} was posted`);
    this.reply({ id: msg.id, ...data });
  }
  addEventListener(type: string, fn: (ev: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string, ev: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
  terminate(): void {}
}

let mod: typeof import("../pyodideEngine");
let signals: typeof import("../limitSignals");

beforeEach(async () => {
  vi.resetModules();
  FakeWorker.last = null;
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("window", { location: { origin: "https://example.invalid" } });
  vi.stubGlobal("navigator", { userAgent: "test", hardwareConcurrency: 4 });
  mod = await import("../pyodideEngine");
  signals = await import("../limitSignals");
});
afterEach(() => vi.unstubAllGlobals());

const RUN = { datasetId: "big", paramsJson: "{}", flattenEnabled: true, force: false };

// Starts a run and waits until it reached the worker.
async function startRun() {
  const run = mod.engine.runPipeline(RUN);
  run.catch(() => undefined);
  await vi.waitFor(() => expect(FakeWorker.last?.posted.some((m) => m.type === "run_pipeline")).toBe(true));
  return { run, worker: FakeWorker.last! };
}

describe("a run that fails", () => {
  it("of a Python MemoryError is kept for the card, its words unchanged", async () => {
    const { run, worker } = await startRun();
    worker.answer("run_pipeline", { type: "error", message: MEMORY_ERROR });
    await expect(run).rejects.toThrow(MEMORY_ERROR);
    expect(signals.getLimitSignals().failedRun).toMatchObject({ datasetId: "big", limit: { kind: "memory", detail: MEMORY_ERROR } });
  });

  it("because the worker died mid-run is marked so, its words the engine's own", async () => {
    const { run, worker } = await startRun();
    worker.emit("error", { message: "Script error." });
    const err = await run.then(
      () => null,
      (e: unknown) => e as Error & { workerStopped?: boolean },
    );
    expect(err?.message).toBe("Worker error: Script error.");
    expect(err?.workerStopped).toBe(true);
    expect(signals.getLimitSignals().failedRun?.limit.kind).toBe("worker");
  });

  it("of anything else is not the card's", async () => {
    const { run, worker } = await startRun();
    worker.answer("run_pipeline", { type: "error", message: "Traceback (most recent call last):\nValueError: bad cell" });
    await expect(run).rejects.toThrow("bad cell");
    expect(signals.getLimitSignals().failedRun).toBeNull();
  });

  it("is forgotten when the next run starts", async () => {
    const first = await startRun();
    first.worker.answer("run_pipeline", { type: "error", message: MEMORY_ERROR });
    await expect(first.run).rejects.toThrow();
    expect(signals.getLimitSignals().failedRun).not.toBeNull();
    const second = mod.engine.runPipeline(RUN);
    second.catch(() => undefined);
    expect(signals.getLimitSignals().failedRun).toBeNull();
  });
});

describe("a load the size gate refuses", () => {
  const file = (name: string) => ({ name, arrayBuffer: async () => new ArrayBuffer(8) }) as unknown as File;

  it("rejects with the short message and keeps the refusal, with the gate's numbers, until a load succeeds", async () => {
    const load = mod.engine.loadFile(file("huge.h5"));
    load.catch(() => undefined);
    await vi.waitFor(() => expect(FakeWorker.last?.posted.some((m) => m.type === "load_file")).toBe(true));
    FakeWorker.last!.answer("load_file", { type: "error", message: REPORT.message, code: "size_gate", report: REPORT });
    await expect(load).rejects.toMatchObject({
      name: "BrowserLimitError",
      message: "“huge.h5” was not loaded: it is too large for the in-browser engine.",
      detail: REPORT.message,
    });
    expect(signals.getLimitSignals().refusedLoad).toMatchObject({
      fileName: "huge.h5",
      limit: { kind: "gate", needBytes: 5.03e9, shape: [501, 501, 501], detail: REPORT.message },
    });

    const demo = mod.engine.loadDemo();
    await vi.waitFor(() => expect(FakeWorker.last?.posted.some((m) => m.type === "load_demo")).toBe(true));
    FakeWorker.last!.answer("load_demo", { type: "result", payload: "synthetic-rocksalt" });
    await expect(demo).resolves.toBe("synthetic-rocksalt");
    expect(signals.getLimitSignals().refusedLoad).toBeNull();
  });

  it("is the engine's plain error when it is not the gate's", async () => {
    const load = mod.engine.loadFile(file("broken.h5"));
    load.catch(() => undefined);
    await vi.waitFor(() => expect(FakeWorker.last?.posted.some((m) => m.type === "load_file")).toBe(true));
    FakeWorker.last!.answer("load_file", { type: "error", message: "OSError: Unable to open file" });
    await expect(load).rejects.toThrow("OSError: Unable to open file");
    expect(signals.getLimitSignals().refusedLoad).toBeNull();
  });
});

describe("inspectDataset", () => {
  it("asks the bridge for the gate's report on a dataset already loaded", async () => {
    const asked = mod.engine.inspectDataset("regridded");
    await vi.waitFor(() =>
      expect(FakeWorker.last?.posted.some((m) => m.type === "json_call" && m.method === "inspect_dataset_json")).toBe(true),
    );
    const msg = FakeWorker.last!.posted.find((m) => m.method === "inspect_dataset_json")!;
    expect(msg.args).toEqual(["regridded"]);
    FakeWorker.last!.reply({ id: msg.id, type: "result", payload: JSON.stringify(REPORT) });
    await expect(asked).resolves.toMatchObject({ ok: false, est_peak_mb: 5030, device: "desktop" });
  });
});
