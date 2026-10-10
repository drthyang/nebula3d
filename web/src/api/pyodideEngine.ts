// In-browser compute engine (Pyodide) — Web Worker edition.
//
// When VITE_DATA_MODE === "pyodide" there is no FastAPI server: the *real* nebula3d
// reduction pipeline runs locally in the user's browser via Pyodide hosted in a
// Web Worker.  Moving Pyodide off the main thread means the UI stays responsive
// during the ~3-minute pipeline run: progress events stream in as Worker messages
// while React can repaint freely.
//
// Architecture
// ────────────
//  pyodideWorker.ts  — classic Worker; boots Pyodide, dispatches RPC calls.
//  pyodideEngine.ts  — Worker lifecycle + RPC layer + typed public API.
//
//  Main thread ↔ Worker protocol:
//    request:  { id: number, type: string, ...payload }
//    response: { id: number|null, type: "result"|"result_binary"|"error"|..., ...payload }
//
//  Binary slice envelopes ([uint32 hdr_len][JSON hdr][float32 data]) are
//  transferred as Transferable ArrayBuffer (zero-copy Worker → main thread).
//
// See docs/web.md ("In-browser run" / "Architecture") for context.

import { isMobileDevice } from "./device";
import { disposeRingPool, ensureRingPool } from "./ringPool";
import type {
  BraggProfile,
  ConsistencyCheck,
  ConsistencyMeta,
  Dataset,
  DeltaPdfMeta,
  Slice,
  SliceHeader,
  TuningPromote,
  TuningRun,
  TuningTrial,
  UbCheck,
  VolumeCoverage,
  VolumeMeta,
} from "./types";

export { ringPoolStatus, subscribeRingPool } from "./ringPool";

export const PYODIDE_MODE = import.meta.env.VITE_DATA_MODE === "pyodide";

// Pipeline stages — exposed so callers can iterate them for display purposes.
export const ENGINE_STAGES = [
  "rings", "punch", "backfill", "flatten", "pdf", "pdf_check",
] as const;

// ---------------------------------------------------------------------------
// Boot status (observable — drives the boot progress panel in the Configure UI)
// ---------------------------------------------------------------------------
export interface BootStatus {
  phase: "idle" | "runtime" | "packages" | "wheel" | "ready" | "error";
  message: string;
  ready: boolean;
  error?: string;
}

let bootStatus: BootStatus = { phase: "idle", message: "not started", ready: false };
const bootListeners = new Set<(s: BootStatus) => void>();

export function getBootStatus(): BootStatus {
  return bootStatus;
}
export function subscribeBoot(fn: (s: BootStatus) => void): () => void {
  bootListeners.add(fn);
  return () => bootListeners.delete(fn);
}
/** Boot progress in percent: the share of the steps (runtime, packages, wheel) reached; 100 in other phases. */
export function bootPercent(status: BootStatus): number {
  const steps = ["runtime", "packages", "wheel"];
  const idx = steps.indexOf(status.phase);
  return idx >= 0 ? Math.round(((idx + 1) / steps.length) * 100) : 100;
}
function setBoot(s: BootStatus): void {
  bootStatus = s;
  for (const fn of bootListeners) fn(s);
}

// ---------------------------------------------------------------------------
// GPU status (fire-and-forget from the Worker after its WebGPU probe)
// ---------------------------------------------------------------------------
export interface GpuStatus {
  available: boolean;
  adapter: string;
  maxBufferMB: number;
}

let gpuStatus: GpuStatus | null = null;
const gpuListeners = new Set<(s: GpuStatus) => void>();

export function getGpuStatus(): GpuStatus | null {
  return gpuStatus;
}
export function subscribeGpu(fn: (s: GpuStatus) => void): () => void {
  gpuListeners.add(fn);
  return () => gpuListeners.delete(fn);
}

// ---------------------------------------------------------------------------
// Pipeline progress (fire-and-forget events from the Worker during a run)
// ---------------------------------------------------------------------------
export interface PipelineProgressEvent {
  stage: string;
  status: string;
  fraction: number | null;
  message: string;
}

const progressListeners = new Set<(ev: PipelineProgressEvent) => void>();

function subscribeProgress(fn: (ev: PipelineProgressEvent) => void): () => void {
  progressListeners.add(fn);
  return () => progressListeners.delete(fn);
}

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------
let workerInstance: Worker | null = null;
let bootPromise: Promise<void> | null = null;
let idCounter = 0;
const pending = new Map<number, {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}>();

function getOrCreateWorker(): Worker {
  if (!workerInstance) {
    workerInstance = new Worker(
      new URL("../workers/pyodideWorker.ts", import.meta.url),
      // Module worker: shares ESM code (pyodideShared/ringPoolClient) and loads
      // Pyodide via pyodide.mjs — works identically under vite dev and build.
      { type: "module" },
    );
    workerInstance.addEventListener("message", handleWorkerMessage);
    workerInstance.addEventListener("error", (ev: ErrorEvent) => {
      const msg = `Worker error: ${ev.message}`;
      setBoot({ phase: "error", message: msg, ready: false, error: msg });
      rejectAllPending(msg);
      // An 'error' event does NOT kill the worker — terminate it explicitly,
      // and tear down the ring pool wired to it (otherwise up to ~1 GB of idle
      // Pyodide heaps stay resident until the next boot).
      workerInstance?.terminate();
      workerInstance = null;
      bootPromise = null;
      disposeRingPool();
    });
  }
  return workerInstance;
}

function rejectAllPending(msg: string): void {
  for (const p of pending.values()) p.reject(new Error(msg));
  pending.clear();
}

function handleWorkerMessage(ev: MessageEvent): void {
  const msg = ev.data as {
    id: number | null;
    type: string;
    [k: string]: unknown;
  };

  // Fire-and-forget events (id is null).
  if (msg.id === null) {
    if (msg.type === "boot_status") {
      setBoot({
        phase: msg.phase as BootStatus["phase"],
        message: msg.message as string,
        ready: msg.ready as boolean,
        error: msg.error as string | undefined,
      });
    } else if (msg.type === "progress") {
      const ev: PipelineProgressEvent = {
        stage: msg.stage as string,
        status: msg.status as string,
        fraction: msg.fraction as number | null,
        message: msg.message as string,
      };
      for (const fn of progressListeners) fn(ev);
    } else if (msg.type === "gpu_status") {
      gpuStatus = {
        available: msg.available as boolean,
        adapter: msg.adapter as string,
        maxBufferMB: msg.maxBufferMB as number,
      };
      for (const fn of gpuListeners) fn(gpuStatus);
    }
    return;
  }

  // RPC response.
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);

  if (msg.type === "error") {
    p.reject(new Error(msg.message as string));
  } else if (msg.type === "result_binary") {
    // Received transferred ArrayBuffer — wrap in Uint8Array for decoding.
    p.resolve(new Uint8Array(msg.payload as ArrayBuffer));
  } else {
    p.resolve(msg.payload);
  }
}

function rpc(
  type: string,
  data: Record<string, unknown> = {},
  transfer: Transferable[] = [],
): Promise<unknown> {
  const id = ++idCounter;
  const w = getOrCreateWorker();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, type, ...data }, transfer);
  });
}

// Trigger Pyodide boot (one-time ~15–25 MB WASM download + package install).
// Idempotent: returns the same promise on concurrent calls; retries on error.
export function ensureBooted(): Promise<void> {
  if (!bootPromise) {
    bootPromise = (async () => {
      getOrCreateWorker();
      const base = new URL(
        import.meta.env.BASE_URL ?? "/",
        window.location.origin,
      ).href;
      // The device class travels with the boot: only the main thread can tell
      // iPadOS from a Mac, and it picks the worker's size gate (device.ts).
      const wheelUrl = (await rpc("boot", {
        wheelBase: base,
        mobile: isMobileDevice(navigator),
      })) as string;
      // Prewarm the ring-worker pool strictly AFTER the main boot so its N
      // Pyodide/package downloads hit the HTTP cache instead of racing the
      // main worker's, and hand it the exact wheel URL the main worker
      // installed (no independent manifest fetch → no version skew).
      // Fire-and-forget: the pipeline engages however many workers are ready
      // at ring-stage start, serial if none.
      ensureRingPool(getOrCreateWorker(), wheelUrl);
    })().catch((e: unknown) => {
      bootPromise = null;
      throw e;
    });
  }
  return bootPromise;
}

// Terminate the Worker (stops an in-progress pipeline run) and reset state.
// A new Worker will be created on the next ensureBooted() call.
export function cancelPipeline(): void {
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
  disposeRingPool();
  bootPromise = null;
  rejectAllPending("Pipeline cancelled");
  setBoot({ phase: "idle", message: "not started", ready: false });
}

// ---------------------------------------------------------------------------
// Binary slice envelope decoder (same format the FastAPI backend produces)
// ---------------------------------------------------------------------------
function decodeSliceBytes(u8: Uint8Array): Slice {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const headerLen = dv.getUint32(0, true);
  const header = JSON.parse(
    new TextDecoder().decode(u8.subarray(4, 4 + headerLen)),
  ) as SliceHeader;
  // .slice() to a 0-offset buffer so the Float32Array view is correctly aligned.
  const data = new Float32Array(u8.slice(4 + headerLen).buffer);
  return { header, data };
}

async function jsonCall<T>(method: string, args: unknown[]): Promise<T> {
  await ensureBooted();
  return JSON.parse(
    (await rpc("json_call", { method, args })) as string,
  ) as T;
}

async function sliceCall(method: string, args: unknown[]): Promise<Slice> {
  await ensureBooted();
  const u8 = (await rpc("slice_call", { method, args })) as Uint8Array;
  return decodeSliceBytes(u8);
}

// ---------------------------------------------------------------------------
// Loaded inputs
// ---------------------------------------------------------------------------
// How each dataset's volume reached the worker, so a run can load it again.
// Cancel and a worker crash both terminate the worker, and its Pyodide
// workspace goes with it, while the page keeps the dataset selected: without
// this, the next run reaches a fresh worker with no input loaded.  A File
// picked from disk is only a handle; one built in memory (the NeXus Viewer
// hand-off) keeps its bytes alive for the session.
type InputSource = { kind: "file"; file: File } | { kind: "demo" };
const inputSources = new Map<string, InputSource>();

async function sendInput(src: InputSource): Promise<string> {
  if (src.kind === "demo") return (await rpc("load_demo")) as string;
  let buffer: ArrayBuffer;
  try {
    buffer = await src.file.arrayBuffer();
  } catch (e) {
    // The file moved or changed on disk since it was picked.
    throw new Error(
      `Could not read ${src.file.name} again (${(e as Error).message}). Load the volume again, then run.`,
    );
  }
  return (await rpc("load_file", { name: src.file.name, buffer }, [buffer])) as string;
}

async function loadInput(src: InputSource): Promise<string> {
  await ensureBooted();
  const id = await sendInput(src);
  inputSources.set(id, src);
  return id;
}

// Point the worker's next run at *datasetId*, loading its volume again when
// the worker no longer holds it (it was restarted since the load).
async function selectInput(
  datasetId: string,
  onProgress?: (ev: PipelineProgressEvent) => void,
): Promise<void> {
  if (await jsonCall<boolean>("select_input", [datasetId])) return;
  const src = inputSources.get(datasetId);
  if (!src) {
    throw new Error(
      `${datasetId} is not loaded in the in-browser engine. Load the volume again, then run.`,
    );
  }
  const name = src.kind === "file" ? src.file.name : "the demo volume";
  onProgress?.({
    stage: "",
    status: "info",
    fraction: null,
    message: `The in-browser engine was restarted: loading ${name} again`,
  });
  await sendInput(src);
}

// ---------------------------------------------------------------------------
// Public engine API (mirrors the FastAPI endpoints; same return types)
// ---------------------------------------------------------------------------
export const engine = {
  loadFile(file: File): Promise<string> {
    return loadInput({ kind: "file", file });
  },

  loadDemo(): Promise<string> {
    return loadInput({ kind: "demo" });
  },

  async runPipeline(opts: {
    datasetId?: string;
    paramsJson: string;
    flattenEnabled: boolean;
    force: boolean;
    forceFrom?: string | null;
    stages?: string[];
    tuning?: TuningTrial;
    onProgress?: (ev: PipelineProgressEvent) => void;
  }): Promise<Dataset[]> {
    await ensureBooted();
    const { datasetId, paramsJson, flattenEnabled, force, forceFrom, stages, tuning, onProgress } = opts;
    if (datasetId) await selectInput(datasetId, onProgress);
    const unsub = onProgress ? subscribeProgress(onProgress) : (): void => {};
    try {
      const json = (await rpc("run_pipeline", {
        paramsJson,
        flattenEnabled,
        force,
        forceFrom: forceFrom ?? null,
        stages: stages ?? null,
        tuningRun: tuning?.run_id ?? null,
        tuningTrial: tuning?.trial ?? null,
      })) as string;
      return JSON.parse(json) as Dataset[];
    } finally {
      unsub();
    }
  },

  datasets(): Promise<Dataset[]> {
    return jsonCall<Dataset[]>("datasets_json", []);
  },
  dataset(datasetId: string): Promise<Dataset> {
    return jsonCall<Dataset>("dataset_json", [datasetId]);
  },
  tuningStart(datasetId: string, firstStage: string): Promise<TuningRun> {
    return jsonCall<TuningRun>("tuning_start_json", [datasetId, firstStage]);
  },
  tuningPromote(runId: string, trial: string): Promise<TuningPromote> {
    return jsonCall<TuningPromote>("tuning_promote_json", [runId, trial]);
  },
  volumeMeta(volumeId: string): Promise<VolumeMeta> {
    return jsonCall<VolumeMeta>("volume_meta_json", [volumeId]);
  },
  volumeCoverage(volumeId: string): Promise<VolumeCoverage> {
    return jsonCall<VolumeCoverage>("volume_coverage_json", [volumeId]);
  },
  ubCheck(volumeId: string, cell: string, qMax: number | null): Promise<UbCheck> {
    return jsonCall<UbCheck>("volume_ub_check_json", [volumeId, cell, qMax]);
  },
  volumeSlice(volumeId: string, plane: string, value: number, interp: boolean): Promise<Slice> {
    return sliceCall("volume_slice", [volumeId, plane, value, interp]);
  },
  dpdfMeta(volumeId: string): Promise<DeltaPdfMeta> {
    return jsonCall<DeltaPdfMeta>("dpdf_meta_json", [volumeId]);
  },
  dpdfSlice(volumeId: string, plane: string, value: number): Promise<Slice> {
    return sliceCall("dpdf_slice", [volumeId, plane, value]);
  },
  consistencyMeta(
    datasetId: string,
    qMin?: number,
    qMax?: number,
    rMin?: number,
    rMax?: number,
  ): Promise<ConsistencyMeta> {
    return jsonCall<ConsistencyMeta>("consistency_meta_json", [
      datasetId, qMin ?? null, qMax ?? null, rMin ?? null, rMax ?? null,
    ]);
  },
  consistencyCheck(datasetId: string): Promise<ConsistencyCheck> {
    return jsonCall<ConsistencyCheck>("consistency_check_json", [datasetId]);
  },
  consistencySlice(
    datasetId: string,
    panel: string,
    plane: string,
    value: number,
    qMin?: number,
    qMax?: number,
    rMin?: number,
    rMax?: number,
  ): Promise<Slice> {
    return sliceCall("consistency_slice", [
      datasetId, panel, plane, value,
      qMin ?? null, qMax ?? null, rMin ?? null, rMax ?? null,
    ]);
  },
  braggProfile(datasetId: string): Promise<BraggProfile> {
    return jsonCall<BraggProfile>("bragg_profile_json", [datasetId]);
  },
  // Compute the band-limited ΔPDF .h5 in the Worker and return its bytes +
  // filename, decoded from the same [uint32 hdr_len][JSON hdr][payload]
  // envelope the slices use (transport: the generic binary "slice_call" RPC).
  async saveDpdf(
    datasetId: string,
    qMin?: number,
    qMax?: number,
    rMin?: number,
    rMax?: number,
  ): Promise<{ filename: string; bytes: Uint8Array }> {
    await ensureBooted();
    const u8 = (await rpc("slice_call", {
      method: "save_dpdf",
      args: [datasetId, qMin ?? null, qMax ?? null, rMin ?? null, rMax ?? null],
    })) as Uint8Array;
    const headerLen = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
      .getUint32(0, true);
    const header = JSON.parse(
      new TextDecoder().decode(u8.subarray(4, 4 + headerLen)),
    ) as { filename: string };
    return { filename: header.filename, bytes: u8.subarray(4 + headerLen) };
  },
};
