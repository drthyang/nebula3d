// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-han Yang
//
// The browser bridge (nebula3d.webbridge) in real 32-bit Pyodide on the
// synthetic demo volume at a size the tests never reach: every stage, then the
// analysis calls the console makes, with each call's time and the WASM heap's
// high-water mark (the heap grows and never shrinks, so it is the peak so far).
// From scripts/wasm32, after `npm ci`:
//
//   NEB_N=365 timeout 1800 node --experimental-wasm-jspi run_bridge.mjs ../.. 
//
// NEB_N: points per axis (365³ ≈ 48.6 M voxels, a measured volume's size; 401³
// = 64.5 M, what the size gate admits). NEB_PARAMS: the stage parameters as the
// console sends them (JSON). NEB_ENDPOINTS=min: the cheaper analysis calls only.
// About 8 minutes at 365³ with every call; synthetic data only.
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { loadNebula } from "./pyodide.mjs";

const [repo] = process.argv.slice(2);
if (!repo) {
  console.error("usage: node --experimental-wasm-jspi run_bridge.mjs <repo root>");
  process.exit(2);
}
const env = {};
for (const k of ["NEB_N", "NEB_PARAMS", "NEB_ENDPOINTS"]) if (process.env[k]) env[k] = process.env[k];
const py = await loadNebula(repo, { env });
const here = dirname(fileURLToPath(import.meta.url));
const t0 = Date.now();
const out = await py.runPythonAsync(readFileSync(join(here, "drive_bridge.py"), "utf8"));
console.log(out);
console.error(`elapsed ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exitCode = /^FAIL/m.test(out) ? 1 : 0;
