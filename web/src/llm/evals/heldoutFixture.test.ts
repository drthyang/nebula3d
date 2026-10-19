// The scenario evals' held-out fixture has one reader, heldoutFixture.ts, and it
// reads it with NEBULA_HOLDOUT_TESTS=1 alone. No other module in web/src imports
// the file, names it or globs its way to it; this test reads every other file
// there, and never the fixture itself.

import { afterEach, describe, expect, it, vi } from "vitest";

import { HOLDOUT_ENV, holdoutOptedIn, loadHeldoutFixture } from "./heldoutFixture";

interface Entry {
  name: string;
  isDirectory(): boolean;
}
interface Fs {
  readdirSync(p: URL, o: { withFileTypes: true }): Entry[];
  readFileSync(p: URL, e: "utf8"): string;
}

const SRC = new URL("../../", import.meta.url); // web/src/
/** The loader and this test: the only files that may name the fixture. */
const ALLOWED = ["llm/evals/heldoutFixture.ts", "llm/evals/heldoutFixture.test.ts"];
/** The fixture's folder: never read. */
const HELD_OUT_DIR = "llm/evals/fixtures/holdout/";
const TEXT = /\.(c|m)?[jt]sx?$|\.(json|md|html|css|snap)$/;
/** What names the fixture: its file name, or a path into its folder. */
const NAMES = ["heldout.json", "fixtures/holdout"];

/** Each file under web/src, as a path from there, but node_modules and the held-out folder. */
async function sources(): Promise<string[]> {
  const spec = "node:fs";
  const fs = (await import(/* @vite-ignore */ spec)) as unknown as Fs;
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(new URL(rel, SRC), { withFileTypes: true })) {
      const path = `${rel}${e.name}`;
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && `${path}/` !== HELD_OUT_DIR) walk(`${path}/`);
      } else if (TEXT.test(e.name)) {
        out.push(path);
      }
    }
  };
  walk("");
  return out;
}

/** Whether *text* names the fixture, or holds a glob import that could reach it. */
function reachesTheFixture(text: string): boolean {
  if (NAMES.some((n) => text.includes(n))) return true;
  for (const call of text.matchAll(/import\.meta\.glob\(\s*(\[[^\]]*\]|["'`][^"'`]*["'`])/g)) {
    for (const [, pattern] of call[1].matchAll(/["'`]([^"'`]*)["'`]/g)) {
      const wide = pattern.includes("**") || pattern.includes("fixtures");
      if (wide && (pattern.endsWith("*") || pattern.includes("json"))) return true;
    }
  }
  return false;
}

describe("the held-out fixture", () => {
  it("is named, imported or globbed by no module in web/src but its loader", async () => {
    const spec = "node:fs";
    const fs = (await import(/* @vite-ignore */ spec)) as unknown as Fs;
    const files = await sources();
    expect(files).toContain("llm/evals/heldoutFixture.ts"); // the walk reads web/src
    const reaching = files.filter((f) => !ALLOWED.includes(f) && reachesTheFixture(fs.readFileSync(new URL(f, SRC), "utf8")));
    expect(reaching).toEqual([]);
  });

  it("is found wherever a module would reach it", () => {
    for (const text of [
      'import fixture from "./fixtures/holdout/heldout.json";',
      'const f = await import("./fixtures/holdout/" + name);',
      'new URL("./fixtures/heldout.json", import.meta.url)',
      'import.meta.glob("./fixtures/**/*.json", { eager: true })',
      "import.meta.glob(['../evals/**'])",
    ]) {
      expect(reachesTheFixture(text), text).toBe(true);
    }
    expect(reachesTheFixture('import.meta.glob("../../../docs/algorithms/*.md")')).toBe(false);
    expect(reachesTheFixture('import { HELDOUT } from "./heldout";')).toBe(false);
  });
});

describe("its loader", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads it with the opt-in alone, and says how to opt in otherwise", async () => {
    for (const off of ["", "0", "true"]) {
      vi.stubEnv(HOLDOUT_ENV, off);
      expect(holdoutOptedIn(), off).toBe(false);
      await expect(loadHeldoutFixture()).rejects.toThrow(`${HOLDOUT_ENV}=1`);
    }
  });

  it.runIf(holdoutOptedIn())("gives the recording under the opt-in", async () => {
    const fixture = await loadHeldoutFixture();
    expect(["contexts", "datasets", "recorded", "results"].every((k) => k in fixture)).toBe(true);
  });
});
