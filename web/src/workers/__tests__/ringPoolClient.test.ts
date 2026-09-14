// Protocol tests for the ring-pool client (pipeline-worker side).
//
// Node's global MessageChannel implements the same EventTarget/postMessage
// surface the browser provides, so the queueing/matching/failure logic runs
// against the real message plumbing here — only the ring worker itself is
// simulated at the other end of each port.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlaneOutcome } from "../ringPoolClient";

interface RingPoolGlobal {
  readyCount(): number;
  beginStage(
    ctxJson: string,
    axisA: Uint8Array, axisB: Uint8Array, ub: Uint8Array,
    centers: Uint8Array | null, halfwidths: Uint8Array | null,
    ceilings: Uint8Array | null,
  ): void;
  submitPlane(
    ip: number, stackValue: number, n0: number, n1: number,
    data: Uint8Array, mask: Uint8Array,
  ): Promise<PlaneOutcome>;
  endStage(): void;
}

let client: typeof import("../ringPoolClient");

function pool(): RingPoolGlobal {
  return (globalThis as unknown as { nebulaRingPool: RingPoolGlobal })
    .nebulaRingPool;
}

// Two chained macrotasks: Node's MessagePort delivery can need more than one
// turn under load (the lone CI flake observed), so give it two.
const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(() => setTimeout(resolve, 1), 1));

interface FakeRingWorker {
  port: MessagePort;
  received: { type: string; [k: string]: unknown }[];
}

/** Wire one simulated ring worker into the client; optionally auto-ready. */
function wireWorker(ready = true): FakeRingWorker {
  const channel = new MessageChannel();
  const fake: FakeRingWorker = { port: channel.port1, received: [] };
  channel.port1.addEventListener("message", ((ev: MessageEvent) => {
    fake.received.push(ev.data as { type: string });
  }) as EventListener);
  channel.port1.start();
  client.addRingPort(channel.port2);
  if (ready) fake.port.postMessage({ type: "ready" });
  return fake;
}

function plane(ip: number): [number, number, number, number, Uint8Array, Uint8Array] {
  return [ip, 0.5, 2, 3, new Uint8Array(2 * 3 * 8), new Uint8Array(2 * 3)];
}

beforeAll(() => {
  // The client installs onto the worker global `self`; provide it in Node.
  (globalThis as { self?: unknown }).self = globalThis;
});

beforeEach(async () => {
  // Fresh module state (ports/queue are module-scoped) per test.
  vi.resetModules();
  client = await import("../ringPoolClient");
  client.installRingPoolGlobal();
});

describe("nebulaRingPool", () => {
  it("counts only ports that announced ready", async () => {
    expect(pool().readyCount()).toBe(0);
    wireWorker(true);
    wireWorker(false);
    await tick();
    expect(pool().readyCount()).toBe(1);
  });

  it("broadcasts context to ready ports on beginStage", async () => {
    const a = wireWorker(true);
    const b = wireWorker(false);
    await tick();
    pool().beginStage("{}", new Uint8Array(8), new Uint8Array(8),
      new Uint8Array(72), null, null, null);
    await tick();
    expect(a.received.map((m) => m.type)).toContain("context");
    expect(b.received.map((m) => m.type)).not.toContain("context");
  });

  it("resolves planes matched by ip, in any order", async () => {
    const w = wireWorker(true);
    await tick();
    pool().beginStage("{}", new Uint8Array(8), new Uint8Array(8),
      new Uint8Array(72), null, null, null);

    const p0 = pool().submitPlane(...plane(0));
    const p1 = pool().submitPlane(...plane(1));
    await tick();
    // Single port ⇒ single in-flight: only plane 0 dispatched so far.
    const planes = w.received.filter((m) => m.type === "plane");
    expect(planes.map((m) => m.ip)).toEqual([0]);

    w.port.postMessage({
      type: "plane_result", epoch: 1, ip: 0, ok: true, skipped: false, err: null,
      data: new Float64Array(6), mask: null,
    });
    await tick();
    await tick();
    const out0 = await p0;
    expect(out0.ok).toBe(true);
    expect(out0.ip).toBe(0);

    // Plane 1 dispatched after 0 completed; resolve it too.
    expect(
      w.received.filter((m) => m.type === "plane").map((m) => m.ip),
    ).toEqual([0, 1]);
    w.port.postMessage({
      type: "plane_result", epoch: 1, ip: 1, ok: true, skipped: true, err: null,
      data: new Float64Array(6), mask: null,
    });
    const out1 = await p1;
    expect(out1.skipped).toBe(true);
  });

  it("fails planes when no workers are available", async () => {
    pool().beginStage("{}", new Uint8Array(8), new Uint8Array(8),
      new Uint8Array(72), null, null, null);
    const out = await pool().submitPlane(...plane(4));
    expect(out.ok).toBe(false);
    expect(out.message).toMatch(/no ring workers/);
  });

  it("fails planes submitted outside a stage", async () => {
    wireWorker(true);
    await tick();
    const out = await pool().submitPlane(...plane(2));
    expect(out.ok).toBe(false);
  });

  it("endStage drains queued planes as failures", async () => {
    const w = wireWorker(true);
    await tick();
    pool().beginStage("{}", new Uint8Array(8), new Uint8Array(8),
      new Uint8Array(72), null, null, null);
    const p0 = pool().submitPlane(...plane(0)); // dispatched (in flight)
    const p1 = pool().submitPlane(...plane(1)); // queued behind it
    await tick();
    pool().endStage();
    const [o0, o1] = await Promise.all([p0, p1]);
    expect(o0.ok).toBe(false);
    expect(o1.ok).toBe(false);
    void w;
  });

  it("propagates worker-side failure outcomes", async () => {
    const w = wireWorker(true);
    await tick();
    pool().beginStage("{}", new Uint8Array(8), new Uint8Array(8),
      new Uint8Array(72), null, null, null);
    const p = pool().submitPlane(...plane(7));
    await tick();
    w.port.postMessage({
      type: "plane_result", epoch: 1, ip: 7, ok: false, message: "worker exploded",
    });
    const out = await p;
    expect(out.ok).toBe(false);
    expect(out.message).toBe("worker exploded");
  });

  it("drops stale results from an aborted previous stage (epoch guard)", async () => {
    const w = wireWorker(true);
    await tick();
    // Stage 1: plane 0 goes in flight, then the stage is aborted while the
    // (simulated) worker is still crunching it.
    pool().beginStage("{}", new Uint8Array(8), new Uint8Array(8),
      new Uint8Array(72), null, null, null);
    const p0old = pool().submitPlane(...plane(0));
    await tick();
    pool().endStage();
    expect((await p0old).ok).toBe(false);

    // Stage 2 reuses the pool; its own plane 0 goes in flight.
    pool().beginStage("{}", new Uint8Array(8), new Uint8Array(8),
      new Uint8Array(72), null, null, null);
    const p0new = pool().submitPlane(...plane(0));
    await tick();
    // The orphaned stage-1 result arrives late: same ip, old epoch → dropped.
    w.port.postMessage({
      type: "plane_result", epoch: 1, ip: 0, ok: true, skipped: false,
      err: null, data: new Float64Array(6).fill(666), mask: null,
    });
    await tick();
    // The genuine stage-2 result still resolves the plane.
    w.port.postMessage({
      type: "plane_result", epoch: 2, ip: 0, ok: true, skipped: false,
      err: null, data: new Float64Array(6).fill(1), mask: null,
    });
    const out = await p0new;
    expect(out.ok).toBe(true);
    expect((out.data as Float64Array)[0]).toBe(1);
  });

  it("catches up a worker that becomes ready mid-stage with the context", async () => {
    const w = wireWorker(false); // wired but not booted yet
    await tick();
    pool().beginStage("{}", new Uint8Array(8), new Uint8Array(8),
      new Uint8Array(72), null, null, null);
    await tick();
    expect(w.received.map((m) => m.type)).not.toContain("context");
    w.port.postMessage({ type: "ready" }); // boot finishes mid-stage
    await tick();
    await tick();
    expect(w.received.map((m) => m.type)).toContain("context");
  });

  it("retires a port that reports context_error", async () => {
    const w = wireWorker(true);
    await tick();
    pool().beginStage("{}", new Uint8Array(8), new Uint8Array(8),
      new Uint8Array(72), null, null, null);
    expect(pool().readyCount()).toBe(1);
    w.port.postMessage({ type: "context_error", message: "bad wheel" });
    await tick();
    expect(pool().readyCount()).toBe(0);
  });
});
