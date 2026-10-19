// The replay project's setup, run before each test file (vitest setupFiles):
// the CPython bridge installed as the Worker the engine creates, in a root
// folder of this file's own, and the few browser globals the engine and the
// stores read, which Node 20 lacks or which differ in Node:
//
// - Worker: the bridge (bridgeWorker.ts);
// - window.location and navigator: a desktop browser on the Pages site;
// - localStorage (sessionStorage too): in memory, with the ring-worker pool
//   off ("nebula3d.ringWorkers" = "0"), so the ring stage runs serially in the
//   pipeline worker, as on a phone; tests/test_ring_parallel.py pins the serial
//   and parallel paths bit-identical.
//
// After the file's tests every bridge is asked to end and the root is removed.

import { afterAll, inject } from "vitest";

import { BridgeWorker, closeBridges, configureBridge, nodeModules, RING_WORKERS_KEY } from "./bridgeWorker";

/** A Storage held in memory. */
class MemoryStorage {
  private readonly items = new Map<string, string>();
  get length(): number {
    return this.items.size;
  }
  key(i: number): string | null {
    return [...this.items.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.items.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.items.set(k, String(v));
  }
  removeItem(k: string): void {
    this.items.delete(k);
  }
  clear(): void {
    this.items.clear();
  }
}

const define = (name: string, value: unknown) =>
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });

const node = await nodeModules();
const root = node.mkdtempSync(node.join(node.tmpdir(), "nebula-devdata-"));
configureBridge(node, { ...inject("devBridge"), root });

const localStorage = new MemoryStorage();
localStorage.setItem(RING_WORKERS_KEY, "0");
const sessionStorage = new MemoryStorage();
define("Worker", BridgeWorker);
define("localStorage", localStorage);
define("sessionStorage", sessionStorage);
define("window", {
  location: { origin: "https://drthyang.github.io", href: "https://drthyang.github.io/nebula3d/" },
  localStorage,
  sessionStorage,
});
define("navigator", { userAgent: "Mozilla/5.0 (X11; Linux x86_64) NEBULA dev-data bridge", hardwareConcurrency: 4, maxTouchPoints: 0 });

afterAll(async () => {
  await closeBridges();
  node.rmSync(root, { recursive: true, force: true });
});
