// Shared Pyodide boot constants + wheel resolution for BOTH workers (the main
// pipeline worker and the ring workers), so the runtime version and the wheel
// URL can never drift between them.

// 0.27+ raises the WASM heap ceiling from 2 GB to 4 GB (MAXIMUM_MEMORY=4GB),
// which is what lets full-resolution volumes reduce in-browser; 0.27.7 also
// fixes a WebWorker asyncio memory leak.
export const PYODIDE_VERSION = "0.27.7";
export const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

// Minimal typings for the Pyodide API both workers use (the CDN module ships
// no TypeScript types).
export interface PyBufferView {
  data: Float64Array | Uint8Array;
  release(): void;
}
export interface PyProxy {
  get(key: string): unknown;
  getBuffer(kind: "f64" | "u8"): PyBufferView;
  toJs(opts?: { create_proxies?: boolean }): unknown;
  destroy(): void;
  [k: string]: unknown;
}
export interface PyodideAPI {
  loadPackage(names: string[]): Promise<void>;
  runPythonAsync(code: string): Promise<unknown>;
  pyimport(name: string): PyProxy;
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    mkdirTree(path: string): void;
    unlink(path: string): void;
  };
  globals: { set(k: string, v: unknown): void; delete(k: string): void };
}

// Load the Pyodide runtime as an ES module (workers are `type: "module"`, so
// importScripts is unavailable; pyodide.mjs is the supported ESM entry).
export async function loadPyodideRuntime(): Promise<PyodideAPI> {
  const mod = (await import(
    /* @vite-ignore */ `${PYODIDE_INDEX}pyodide.mjs`
  )) as { loadPyodide(opts: { indexURL: string }): Promise<PyodideAPI> };
  return mod.loadPyodide({ indexURL: PYODIDE_INDEX });
}

// The wheel path is looked up from a manifest scripts/build_web_wheel.py writes
// next to it (web/public/wheels/manifest.json →
// { "wheel": "<sha256[:12]>/nebula3d-<ver>-py3-none-any.whl", ... }): the
// content-hash directory makes every distinct wheel a distinct URL, so a
// redeploy can never serve a Pages-cached stale wheel under a version-only
// name, and a version bump can never silently 404 a hardcoded URL.
export async function resolveWheelUrl(wheelBase: string): Promise<string> {
  const manifestUrl = `${wheelBase}wheels/manifest.json`;
  const res = await fetch(manifestUrl, { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(
      `wheel manifest missing (${manifestUrl}, HTTP ${res.status}) — ` +
        "build it with `make web-wheel` (CI does this automatically on deploy)",
    );
  }
  const manifest = (await res.json()) as { wheel?: string };
  if (!manifest.wheel) {
    throw new Error(`wheel manifest ${manifestUrl} has no "wheel" entry`);
  }
  return `${wheelBase}wheels/${manifest.wheel}`;
}
