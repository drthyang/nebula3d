// Main-thread ring-worker pool: spawns N slim Pyodide workers and wires each
// one to the pipeline worker with a dedicated MessageChannel, so ring planes
// flow worker↔worker without touching the main thread.
//
// Sizing: localStorage "nebula3d.ringWorkers" overrides ("0" disables, capped
// at 8); otherwise min(4, hardwareConcurrency − 2).  Each ring worker holds a
// Pyodide + numpy/scipy WASM heap (~150–250 MB that never shrinks), which is
// why the auto cap is conservative.
//
// Lifecycle: prewarmed once the MAIN worker finishes booting (so the Pyodide
// CDN fetches hit the HTTP cache instead of downloading N times), reused for
// every run in the tab session, torn down on cancel (cancel terminates the
// pipeline worker, which owns the other end of every port anyway).

const SETTING_KEY = "nebula3d.ringWorkers";
const MAX_WORKERS = 8;

export interface RingPoolStatus {
  desired: number;
  ready: number;
  failed: number;
}

interface PoolWorker {
  worker: Worker;
  ready: boolean;
  failed: boolean;
}

let poolWorkers: PoolWorker[] = [];
let wiredTo: Worker | null = null;
const listeners = new Set<(s: RingPoolStatus) => void>();

export function ringWorkerSetting(): number | null {
  try {
    const raw = localStorage.getItem(SETTING_KEY);
    if (raw === null || raw.trim() === "") return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(MAX_WORKERS, n)) : null;
  } catch {
    return null;
  }
}

export function autoPoolSize(): number {
  const hc = typeof navigator !== "undefined"
    ? navigator.hardwareConcurrency ?? 4
    : 4;
  return Math.min(4, Math.max(0, hc - 2));
}

export function desiredPoolSize(): number {
  return ringWorkerSetting() ?? autoPoolSize();
}

export function ringPoolStatus(): RingPoolStatus {
  return {
    desired: poolWorkers.length,
    ready: poolWorkers.filter((w) => w.ready).length,
    failed: poolWorkers.filter((w) => w.failed).length,
  };
}

export function subscribeRingPool(fn: (s: RingPoolStatus) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  const s = ringPoolStatus();
  for (const fn of listeners) fn(s);
}

// Idempotent per pipeline-worker instance: re-wiring after a cancel (new
// pipeline worker) rebuilds the pool; calling again for the same worker is a
// no-op.  `wheelUrl` is the exact URL the pipeline worker installed (resolved
// once at its boot), so a deploy landing mid-session can never skew versions
// between the pipeline and ring workers.
export function ensureRingPool(pipelineWorker: Worker, wheelUrl: string): void {
  if (wiredTo === pipelineWorker && poolWorkers.length > 0) return;
  disposeRingPool();
  wiredTo = pipelineWorker;

  const n = desiredPoolSize();
  for (let i = 0; i < n; i += 1) {
    const worker = new Worker(
      new URL("../workers/ringWorker.ts", import.meta.url),
      { type: "module" },
    );
    const pw: PoolWorker = { worker, ready: false, failed: false };
    poolWorkers.push(pw);

    worker.addEventListener("message", (ev: MessageEvent) => {
      const msg = ev.data as { type: string; message?: string };
      if (msg.type === "ready") {
        pw.ready = true;
        notify();
      } else if (msg.type === "boot_error") {
        pw.failed = true;
        notify();
      }
    });
    worker.addEventListener("error", () => {
      pw.failed = true;
      pw.ready = false;
      notify();
    });

    const channel = new MessageChannel();
    worker.postMessage({ type: "port" }, [channel.port1]);
    pipelineWorker.postMessage({ type: "ring_port" }, [channel.port2]);
    worker.postMessage({ type: "boot", wheelUrl });
  }
  notify();
}

export function disposeRingPool(): void {
  for (const pw of poolWorkers) pw.worker.terminate();
  poolWorkers = [];
  wiredTo = null;
  notify();
}
