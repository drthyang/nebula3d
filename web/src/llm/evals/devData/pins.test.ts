// The replay tests' Python is the browser's: CI's frontend job installs the
// numeric stack the Pages build ships and checks it (bridge.py check --pins).
// This holds that job to the Pyodide the Pages build loads, so the two cannot
// drift apart: the constraints file it installs and checks with is the one
// named for PYODIDE_VERSION, and its Python is the CPython that file names.
// No Python needed: the unit project runs it.

import { describe, expect, it } from "vitest";

import { PYODIDE_VERSION } from "../../../workers/pyodideShared";
import { readText } from "../backend";

const ROOT = new URL("../../../../../", import.meta.url); // devData → evals → llm → src → web → the checkout

/** The frontend job's block of ci.yml: from its key to the next job's. */
async function frontendJob(): Promise<string> {
  const ci = await readText(new URL(".github/workflows/ci.yml", ROOT));
  const job = /^ {2}frontend:\n((?: {4,}.*\n|\s*\n)+)/m.exec(ci);
  if (!job) throw new Error("ci.yml has no frontend job");
  return job[1];
}

describe("the frontend job's Python is the browser's", () => {
  it("installs and checks with the constraints file of the Pyodide the Pages build loads", async () => {
    const job = await frontendJob();
    const file = `pyodide-${PYODIDE_VERSION}.txt`;
    expect(job).toContain(`pip install -e . -c .github/constraints/${file}`);
    expect(job).toContain(`src/llm/evals/devData/bridge.py check --pins ../.github/constraints/${file}`);
    expect(job).toMatch(/NEBULA_PYTHON: \$\{\{ steps\.python\.outputs\.python-path \}\}/);
  });

  it("sets up the CPython minor version that constraints file names", async () => {
    const job = await frontendJob();
    const constraints = await readText(new URL(`.github/constraints/pyodide-${PYODIDE_VERSION}.txt`, ROOT));
    // The header's words run across lines ("Pyodide 0.27.7 = CPython / 3.12.7").
    const comments = constraints
      .split("\n")
      .filter((l) => l.trimStart().startsWith("#"))
      .map((l) => l.trimStart().slice(1).trim())
      .join(" ");
    const minor = /CPython\s+(\d+\.\d+)/.exec(comments)?.[1];
    expect(minor, "the constraints file names the CPython its Pyodide ships").toBeDefined();
    const setup = /uses: actions\/setup-python@v\d+\n\s+with:\n\s+python-version: "([\d.]+)"/.exec(job);
    expect(setup?.[1]).toBe(minor);
  });
});
