// The transcript survives a reload of the page: it is restored from
// sessionStorage when the module loads, a question whose reply the reload cut
// off is marked, and only the newest turns that fit the budget are kept.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();

// A fresh copy of the store, as a reload of the page would load it.
const load = async () => {
  vi.resetModules();
  return import("../chatStore");
};

beforeEach(() => {
  storage.clear();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("chat transcript across reloads", () => {
  it("brings back the turns and the draft, and keeps numbering after them", async () => {
    const first = await load();
    first.useChatStore.getState().addTurn({ role: "user", content: "Assess the run" });
    first.useChatStore.getState().addTurn({ role: "assistant", content: "Ring removal is clean." });
    first.useChatStore.getState().setDraft("and the punch?");

    const second = await load();
    const { turns, draft } = second.useChatStore.getState();
    expect(turns.map((t) => t.content)).toEqual(["Assess the run", "Ring removal is clean."]);
    expect(draft).toBe("and the punch?");
    second.useChatStore.getState().addTurn({ role: "user", content: "next" });
    const ids = second.useChatStore.getState().turns.map((t) => t.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("marks a question whose reply the reload cut off", async () => {
    const first = await load();
    first.useChatStore.getState().addTurn({ role: "user", content: "Run the pipeline" });
    const { turns } = (await load()).useChatStore.getState();
    expect(turns).toHaveLength(2);
    expect(turns[1]).toMatchObject({ role: "assistant", note: expect.stringMatching(/cut off by a reload/) });
  });

  it("forgets the transcript on Clear, and keeps only the newest turns that fit", async () => {
    const { useChatStore, fitTranscript } = await load();
    useChatStore.getState().addTurn({ role: "user", content: "x" });
    useChatStore.getState().clear();
    expect((await load()).useChatStore.getState().turns).toEqual([]);

    const turns = Array.from({ length: 10 }, (_v, i) => ({ id: i + 1, role: "user" as const, content: "y".repeat(100) }));
    const kept = JSON.parse(fitTranscript(turns, 600)) as { id: number }[];
    expect(kept.length).toBeLessThan(10);
    expect(kept[kept.length - 1].id).toBe(10); // the newest stay
  });

  it("starts empty when storage is unavailable", async () => {
    vi.stubGlobal("sessionStorage", undefined);
    const { useChatStore } = await load();
    expect(useChatStore.getState().turns).toEqual([]);
    useChatStore.getState().addTurn({ role: "user", content: "still works" });
    expect(useChatStore.getState().turns).toHaveLength(1);
  });
});
