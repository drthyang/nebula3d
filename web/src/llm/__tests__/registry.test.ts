// The registry against the tools' files: each file under tools/defs/ is one
// tool, exported under the name the model calls it by, which is the file's
// name; and the registry holds each of them, once.

import { describe, expect, it } from "vitest";

import { CHAT_TOOLS } from "../tools";

/** Every module under tools/defs/, by its file's name. */
const DEFS: Record<string, Record<string, unknown>> = Object.fromEntries(
  Object.entries(import.meta.glob<Record<string, unknown>>("../tools/defs/*.ts", { eager: true })).map(([path, mod]) => [
    path.slice(path.lastIndexOf("/") + 1, -".ts".length),
    mod,
  ]),
);

describe("the tools' files", () => {
  it("export one tool each, under the file's name, which is the tool's name", () => {
    expect(Object.keys(DEFS).length).toBeGreaterThan(0);
    for (const [file, mod] of Object.entries(DEFS)) {
      expect(Object.keys(mod), file).toEqual([file]);
      expect((mod[file] as { name?: unknown }).name, file).toBe(file);
    }
  });

  it("are the registry's tools, one to one", () => {
    expect(Object.keys(DEFS).sort()).toEqual(CHAT_TOOLS.map((t) => t.name).sort());
    for (const tool of CHAT_TOOLS) expect(DEFS[tool.name][tool.name], tool.name).toBe(tool);
  });
});
