// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Tsung-han Yang
//
// The test suite in real 32-bit Pyodide (intp and numpy's default int are
// int32 there), where an int64 index or a 2³¹-element iterator fails as it
// does in the browser. From scripts/wasm32, after `npm ci`:
//
//   timeout 1800 node --experimental-wasm-jspi run_pytest.mjs ../.. -q -rfE --tb=short
//
// --skip-env-only (first, before the pytest arguments) leaves out the tests in
// env-only.txt, which cannot run in Pyodide for reasons of the environment;
// the CI job runs so.
//
// About 8 minutes for the whole suite. Failures that are the environment, not
// 32-bit numpy, are expected: no processes (subprocess, the native server's
// multiprocessing), no threads, file times in whole seconds, and the
// browser-only choices the package makes under Emscripten (gzip working files).
// Look for TypeError "Cannot cast ... int64 to int32", ValueError "iterator is
// too large" or "broadcast dimensions too large", and MemoryError.
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { loadNebula } from "./pyodide.mjs";

let [repo, ...args] = process.argv.slice(2);
if (args[0] === "--skip-env-only") {
  const here = dirname(fileURLToPath(import.meta.url));
  const listed = readFileSync(join(here, "env-only.txt"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  args = [...listed.map((id) => (id.includes("::") ? `--deselect=${id}` : `--ignore=${id}`)), ...args.slice(1)];
}
if (!repo) {
  console.error("usage: node --experimental-wasm-jspi run_pytest.mjs <repo root> [pytest args...]");
  process.exit(2);
}
const py = await loadNebula(repo, {
  packages: ["pytest", "matplotlib", "pydantic", "micropip"],
  env: { NEBULA_HOLDOUT_TESTS: "1", MPLBACKEND: "Agg" },
});
// The server tests import fastapi; these versions fit Pyodide 0.27.7's
// pydantic and typing-extensions (the native server itself still cannot run).
await py.runPythonAsync(`
import micropip
try:
    await micropip.install(["fastapi==0.115.6", "starlette==0.41.3", "httpx==0.27.2"])
except Exception as e:
    print("fastapi not installed; the server tests will not collect:", e)
`);
py.globals.set("ARGS", py.toPy(args));
const rc = await py.runPythonAsync(`
import pytest
int(pytest.main(["-p", "no:cacheprovider", "--continue-on-collection-errors", *ARGS]))
`);
process.exit(rc);
