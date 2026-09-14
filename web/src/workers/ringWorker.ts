// Ring worker: a slim Pyodide interpreter that ring-fits single planes.
//
// N of these run alongside the main pipeline worker (created and wired by
// web/src/api/ringPool.ts).  Each boots numpy/scipy/h5py + the nebula3d wheel —
// deliberately NOT matplotlib (nebula3d's `visualization` import is lazy) — and
// then serves plane requests arriving on a MessagePort wired directly to the
// pipeline worker (the main thread never relays plane data).
//
// Port protocol (pipeline worker ↔ ring worker; all buffers little-endian;
// every stage-scoped message carries the stage `epoch`, echoed back so the
// pool can drop results from an aborted stage):
//   in :  { type: "context", epoch, ctxJson, axisA, axisB, ub,
//           centers|null, halfwidths|null, ceilings|null }        (Uint8Arrays)
//   in :  { type: "plane", epoch, ip, stackValue, n0, n1, data, mask }
//   out:  { type: "ready" }
//   out:  { type: "context_error", message }   — this worker is unusable
//   out:  { type: "plane_result", epoch, ip, ok: true, skipped, err,
//           data: Float64Array, mask: Uint8Array|null }           (transferred)
//   out:  { type: "plane_result", epoch, ip, ok: false, message }
//
// Main-thread protocol (ringPool.ts ↔ this worker):
//   in :  { type: "boot", wheelUrl } | { type: "port" } (+ transferred port)
//   out:  { type: "ready" } | { type: "boot_error", message }
//
// The wheel URL is resolved ONCE by the pipeline worker's boot and passed
// through — never re-resolved here — so a deploy landing mid-boot can never
// mix nebula3d versions between the pipeline and ring workers.

import { loadPyodideRuntime } from "./pyodideShared";
import type { PyProxy } from "./pyodideShared";

type PostFn = (data: unknown, transfer?: Transferable[]) => void;
const postMain: PostFn = (
  self as unknown as { postMessage: PostFn }
).postMessage.bind(self);

let ringworker: PyProxy | null = null;
let port: MessagePort | null = null;
let booted = false;

function announceReadyIfWired(): void {
  if (booted && port) {
    port.postMessage({ type: "ready" });
    postMain({ type: "ready" });
  }
}

async function boot(wheelUrl: string): Promise<void> {
  try {
    const py = await loadPyodideRuntime();
    // No matplotlib: nebula3d's `visualization` subpackage imports lazily, so a
    // ring worker's dependency set is just the numeric stack (h5py is pulled in
    // by nebula3d.io at import time).
    await py.loadPackage(["numpy", "scipy", "h5py", "micropip"]);
    py.globals.set("_nebula3d_wheel_url", wheelUrl);
    await py.runPythonAsync(
      "import micropip\nawait micropip.install(_nebula3d_wheel_url, deps=False)\n",
    );
    py.globals.delete("_nebula3d_wheel_url");
    ringworker = py.pyimport("nebula3d.ringworker");
    booted = true;
    announceReadyIfWired();
  } catch (e) {
    postMain({ type: "boot_error", message: (e as Error).message ?? String(e) });
  }
}

// Copy a numpy array out of the WASM heap into a fresh, transferable JS array,
// destroying the proxy on every path (leak-proof under memory pressure).
function copyOutAndDestroy<T extends Float64Array | Uint8Array>(
  proxy: PyProxy, kind: "f64" | "u8",
): T {
  try {
    const buf = proxy.getBuffer(kind);
    try {
      const out = kind === "f64"
        ? new Float64Array(buf.data.length)
        : new Uint8Array(buf.data.length);
      out.set(buf.data as never);
      return out as T;
    } finally {
      buf.release();
    }
  } finally {
    proxy.destroy();
  }
}

interface PlaneMsg {
  type: "plane";
  epoch: number;
  ip: number;
  stackValue: number;
  n0: number;
  n1: number;
  data: Uint8Array;
  mask: Uint8Array;
}
interface ContextMsg {
  type: "context";
  epoch: number;
  ctxJson: string;
  axisA: Uint8Array;
  axisB: Uint8Array;
  ub: Uint8Array;
  centers: Uint8Array | null;
  halfwidths: Uint8Array | null;
  ceilings: Uint8Array | null;
}

function onPortMessage(ev: MessageEvent<ContextMsg | PlaneMsg>): void {
  const msg = ev.data;
  if (msg.type === "context") {
    try {
      (ringworker!.set_context as (...a: unknown[]) => void)(
        msg.ctxJson, msg.axisA, msg.axisB, msg.ub,
        msg.centers, msg.halfwidths, msg.ceilings,
      );
    } catch (e) {
      // A bad context poisons every subsequent plane on this worker; retire it
      // so the pool stops scheduling here (planes go to healthy workers or the
      // in-process fallback instead of a fail-fast loop).
      ringworker = null;
      const message = (e as Error).message ?? String(e);
      port!.postMessage({ type: "context_error", message });
      postMain({ type: "boot_error", message });
    }
    return;
  }
  if (msg.type !== "plane") return;

  try {
    if (!ringworker) throw new Error("ring worker not booted");
    const rp = (ringworker.process_plane as (...a: unknown[]) => PyProxy)(
      msg.ip, msg.stackValue, msg.n0, msg.n1, msg.data, msg.mask,
    );
    try {
      const skipped = rp.get("skipped") as boolean;
      const err = (rp.get("err") as string | undefined) ?? null;
      const data = copyOutAndDestroy<Float64Array>(rp.get("data") as PyProxy, "f64");
      const maskRaw = rp.get("mask") as PyProxy | null | undefined;
      const mask: Uint8Array | null =
        maskRaw === null || maskRaw === undefined
          ? null
          : copyOutAndDestroy<Uint8Array>(maskRaw, "u8");
      const transfer: Transferable[] = [data.buffer];
      if (mask) transfer.push(mask.buffer);
      port!.postMessage(
        {
          type: "plane_result", epoch: msg.epoch, ip: msg.ip,
          ok: true, skipped, err, data, mask,
        },
        transfer,
      );
    } finally {
      rp.destroy();
    }
  } catch (e) {
    port!.postMessage({
      type: "plane_result", epoch: msg.epoch, ip: msg.ip, ok: false,
      message: (e as Error).message ?? String(e),
    });
  }
}

self.addEventListener("message", ((ev: MessageEvent) => {
  const msg = ev.data as { type: string; wheelUrl?: string };
  if (msg.type === "boot") {
    void boot(msg.wheelUrl!);
  } else if (msg.type === "port") {
    port = ev.ports[0];
    port.addEventListener("message", onPortMessage as EventListener);
    port.start();
    announceReadyIfWired();
  }
}) as EventListener);
