// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-han Yang
//
// Shared loader for the 32-bit check: Pyodide 0.27.7, the version the browser
// build pins (web/src/workers/pyodideShared.ts), with the packages the
// pipeline worker loads, and the checkout mounted at /repo with src/ on
// sys.path. Run under `node --experimental-wasm-jspi` so the async bridge
// (run_async, the ring pool, the WebGPU seam) can run; packages come from the
// Pyodide CDN the first time and are cached in node_modules.
import { loadPyodide } from "pyodide";

export async function loadNebula(repo, { packages = [], env = {} } = {}) {
  const py = await loadPyodide({ env: { HOME: "/home/pyodide", ...env } });
  await py.loadPackage(["numpy", "scipy", "h5py", ...packages]);
  py.FS.mkdir("/repo");
  py.FS.mount(py.FS.filesystems.NODEFS, { root: repo }, "/repo");
  py.runPython("import os, sys; os.chdir('/repo'); sys.path.insert(0, '/repo/src')");
  return py;
}
