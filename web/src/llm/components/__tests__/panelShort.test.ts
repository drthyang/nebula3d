// The Pilot panel's short-panel rules read its height from data-short
// (panelShort.ts), not from a size container: `container: pilot / size` on the
// panel sent Chromium into an idle layout loop after an auto run (hundreds of
// layouts a second, the renderer's memory growing by gigabytes).

import { describe, expect, it } from "vitest";

import { SHORT_LIMITS, shortTokens } from "../panelShort";

interface Fs {
  readFileSync(p: URL, e: "utf8"): string;
}
const SRC = new URL("../../../", import.meta.url); // web/src/

async function css(): Promise<string> {
  const spec = "node:fs";
  const fs = (await import(/* @vite-ignore */ spec)) as unknown as Fs;
  return fs.readFileSync(new URL("index.css", SRC), "utf8");
}

describe("the Pilot panel's height tokens", () => {
  it("name each limit the panel is at or under", () => {
    expect(shortTokens(870)).toBe("");
    expect(shortTokens(560)).toBe("");
    expect(shortTokens(559)).toBe("559");
    expect(shortTokens(401)).toBe("559");
    expect(shortTokens(400)).toBe("559 400");
    expect(shortTokens(251)).toBe("559 400");
    expect(shortTokens(250)).toBe("559 400 250");
    expect(shortTokens(0)).toBe("559 400 250");
  });

  it("cover every limit the stylesheet's short-panel rules use, and only those", async () => {
    const used = new Set([...(await css()).matchAll(/data-short~="(\d+)"/g)].map((m) => Number(m[1])));
    expect([...used].sort((a, b) => b - a)).toEqual([...SHORT_LIMITS]);
  });

  it("are not a size container on the panel (the layout loop)", async () => {
    const sheet = (await css()).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(sheet).not.toMatch(/container:\s*pilot\b/);
    expect(sheet).not.toMatch(/@container\s+pilot\b/);
    const panel = /\n\.ai-panel\s*\{([^}]*)\}/.exec(sheet)?.[1] ?? "";
    expect(panel).not.toMatch(/container(-type)?\s*:/);
  });
});
