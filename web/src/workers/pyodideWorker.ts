// Web Worker: hosts the Pyodide runtime so the nebula3d pipeline runs off the
// main thread.  A module worker (Pyodide loads via its pyodide.mjs ESM entry),
// driven by message-passing from the main thread.
//
// Message protocol
// ─────────────────
//  Main → Worker   { id: number, type: string, ...payload }
//  Worker → Main   { id: number|null, type: string, ...payload }
//
//  id: null  — fire-and-forget events (boot_status, pipeline progress)
//  id: number — RPC responses (result / result_binary / error)
//
// Binary results (slice envelopes) are posted with an ArrayBuffer in the
// transfer list (zero-copy from Worker to main thread).
//
// See docs/web.md ("In-browser run" / "Architecture") for the rationale.

import { installGpuGlobal } from "../gpu";
import type { NebulaGpu } from "../gpu";
import { loadPyodideRuntime, resolveWheelUrl } from "./pyodideShared";
import type { PyodideAPI, PyProxy } from "./pyodideShared";
import { addRingPort, installRingPoolGlobal } from "./ringPoolClient";

const STAGES = ["rings", "punch", "backfill", "flatten", "pdf", "pdf_check"] as const;

// Typed postMessage bypassing the DOM Window vs DedicatedWorkerGlobalScope mismatch.
type PostFn = (data: unknown, transfer?: Transferable[]) => void;
const post: PostFn = (
  self as unknown as { postMessage: PostFn }
).postMessage.bind(self);

// Discriminated union for all messages the Worker receives from the main thread.
type WorkerRequest =
  | { id: number; type: "boot"; wheelBase: string }
  | { id: number; type: "load_file"; name: string; buffer: ArrayBuffer }
  | { id: number; type: "load_demo" }
  | {
      id: number;
      type: "run_pipeline";
      paramsJson: string;
      flattenEnabled: boolean;
      force: boolean;
      forceFrom: string | null;
      stages: string[] | null;
    }
  | { id: number; type: "json_call"; method: string; args: unknown[] }
  | { id: number; type: "slice_call"; method: string; args: unknown[] };

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------
let py: PyodideAPI | null = null;
let bridge: PyProxy | null = null;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function postBoot(phase: string, message: string, ready: boolean, error?: string): void {
  post({ id: null, type: "boot_status", phase, message, ready, error });
}

async function boot(wheelBase: string): Promise<string> {
  postBoot("runtime", "Downloading Python runtime (~10 MB)…", false);
  py = await loadPyodideRuntime();

  // No matplotlib: the browser never renders a figure (webbridge skips the
  // native pdf_check PNG) and nebula3d.visualization imports it lazily, so
  // the boot skips ~9 MB of matplotlib + pillow + fonttools downloads.
  postBoot("packages", "Loading numpy, scipy, h5py…", false);
  await py.loadPackage(["numpy", "scipy", "h5py", "micropip"]);

  postBoot("wheel", "Installing the nebula3d reduction package…", false);
  const wheelUrl = await resolveWheelUrl(wheelBase);
  py.globals.set("_nebula3d_wheel_url", wheelUrl);
  await py.runPythonAsync(
    "import micropip\nawait micropip.install(_nebula3d_wheel_url, deps=False)\n",
  );
  py.globals.delete("_nebula3d_wheel_url");

  bridge = py.pyimport("nebula3d.webbridge");
  (bridge.setup as () => unknown)();

  postBoot("ready", "Ready — compute runs locally in your browser.", true);
  // Probe WebGPU in the background so the ΔPDF-engine status (and the
  // admission decision Python makes) is known before the first run.
  void (self as unknown as { nebulaGpu: NebulaGpu }).nebulaGpu.init();
  return wheelUrl;
}

// ---------------------------------------------------------------------------
// Message dispatch
// ---------------------------------------------------------------------------
async function dispatch(req: WorkerRequest): Promise<void> {
  const { id } = req;

  const reply = (payload: unknown): void => post({ id, type: "result", payload });
  const replyBinary = (buf: ArrayBuffer): void =>
    post({ id, type: "result_binary", payload: buf }, [buf]);
  const replyError = (e: unknown): void =>
    post({ id, type: "error", message: (e as Error).message ?? String(e) });

  try {
    switch (req.type) {
      case "boot": {
        const wheelUrl = await boot(req.wheelBase);
        // The resolved wheel URL travels back so the ring workers install the
        // EXACT same wheel (no independent manifest fetch → no version skew).
        reply(wheelUrl);
        break;
      }

      case "load_file": {
        const bytes = new Uint8Array(req.buffer);
        py!.FS.mkdirTree("/uploads");
        const tmp = `/uploads/${Date.now()}`;
        py!.FS.writeFile(tmp, bytes);
        // The upload temp must never outlive this dispatch: load_input copies
        // it into the workspace (/work/raw), and every failure path (a corrupt
        // file makes inspect_input/load_input raise) used to leak one full
        // input file per attempt in session-lifetime MEMFS.
        try {
          // Pre-flight: a metadata-only size check (reads the HDF5 shape, not
          // the arrays) so an oversized volume is rejected with a clear message
          // rather than crashing the reduction with a numpy MemoryError.
          const report = JSON.parse(
            (bridge!.inspect_input as (n: string, p: string) => string)(req.name, tmp),
          ) as { ok: boolean; message: string };
          if (!report.ok) {
            replyError(new Error(report.message));
            break;
          }
          const dsId = (bridge!.load_input as (n: string, p: string) => string)(req.name, tmp);
          reply(dsId);
        } finally {
          try {
            py!.FS.unlink(tmp);
          } catch {
            // best-effort: the temp may be gone already
          }
        }
        break;
      }

      case "load_demo": {
        // FCC demo grid: 33³ keeps integer nodes on-grid (step 0.25 over ±4) so
        // the Bragg peaks are crisp, while still running the full chain in seconds.
        const dsId = (bridge!.make_demo_input as (n: number) => string)(33);
        reply(dsId);
        break;
      }

      case "run_pipeline": {
        const { paramsJson, flattenEnabled, force, forceFrom, stages } = req;
        const progress = (
          stage: string,
          status: string,
          fraction: number | null,
          message: string,
        ): void => {
          post({ id: null, type: "progress", stage, status, fraction, message });
        };
        // Run the enabled stages in one call (canonical order) so the pipeline
        // can resolve pass-through inputs across the whole selection; a disabled
        // stage is skipped and its input flows to the next enabled stage.
        // run_async is a Python coroutine — Pyodide surfaces it as a thenable,
        // so awaiting it here lets the ring stage fan out over the worker pool
        // (self.nebulaRingPool) while this dispatch stays suspended.
        const selected = stages ?? STAGES;
        const stagesCsv = STAGES.filter((st) => selected.includes(st)).join(",");
        const json = await (bridge!.run_async as (...a: unknown[]) => Promise<string>)(
          stagesCsv,
          paramsJson,
          flattenEnabled,
          force,
          forceFrom ?? null,
          progress,
        );
        reply(json);
        break;
      }

      case "json_call": {
        const result = (bridge![req.method] as (...a: unknown[]) => string)(...req.args);
        reply(result);
        break;
      }

      case "slice_call": {
        // Generic binary RPC: any bridge method returning Python `bytes`
        // (slice envelopes, the ΔPDF download envelope, …).
        const proxy = (bridge![req.method] as (...a: unknown[]) => PyProxy)(...req.args);
        try {
          // toJs() on Python bytes materialises a fresh, exactly-sized JS-heap
          // ArrayBuffer (Pyodide copies out of the WASM heap), so it can be
          // transferred directly — a second .slice() copy would double the
          // peak JS heap on large envelopes (the ΔPDF .h5 download is 100+ MB).
          const u8 = proxy.toJs() as Uint8Array;
          const aligned =
            u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength;
          const buf = (aligned
            ? u8.buffer
            : u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
          ) as ArrayBuffer;
          replyBinary(buf);
        } finally {
          proxy.destroy();
        }
        break;
      }
    }
  } catch (e) {
    replyError(e);
  }
}

// The ring-plane fan-out primitive Python awaits (self.nebulaRingPool).
installRingPoolGlobal();
// The WebGPU ΔPDF backend Python awaits (self.nebulaGpu); absence of WebGPU
// simply leaves the scipy path in charge.
installGpuGlobal((status) => post({ id: null, type: "gpu_status", ...status }));

// Serialize top-level RPCs: now that run_pipeline suspends (async ring
// fan-out), an interleaved json_call/slice_call could otherwise read
// half-written pipeline state.  Ring-port messages bypass this chain — they
// are delivered on their own MessagePorts, which is exactly what lets the
// pool make progress while a dispatch is suspended.
let dispatchChain: Promise<void> = Promise.resolve();

self.addEventListener("message", ((ev: MessageEvent<WorkerRequest>) => {
  const data = ev.data as unknown as { type?: string };
  if (data?.type === "ring_port") {
    addRingPort(ev.ports[0]);
    return;
  }
  dispatchChain = dispatchChain.then(() => dispatch(ev.data));
}) as EventListener);
