// The run-it-locally card's memory (handoffStore.ts): a dismissal is
// remembered per dataset across reloads, a reopen forgets it, and storage that
// is missing, full or broken never breaks the card.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DISMISSED_KEY, loadDismissed, MAX_REMEMBERED, saveDismissed } from "../handoffStore";

const store = new Map<string, string>();
const memoryStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", memoryStorage);
});
afterEach(() => vi.unstubAllGlobals());

// The store as a fresh page load builds it.
async function freshStore() {
  vi.resetModules();
  return (await import("../handoffStore")).useHandoffStore;
}

describe("dismissing the card", () => {
  it("is remembered per dataset across a reload", async () => {
    let handoff = await freshStore();
    expect(handoff.getState().dismissed).toEqual([]);
    handoff.getState().dismiss("ds:big");
    expect(handoff.getState().dismissed).toEqual(["ds:big"]);
    expect(JSON.parse(store.get(DISMISSED_KEY)!)).toEqual(["ds:big"]);

    handoff = await freshStore();
    expect(handoff.getState().dismissed).toContain("ds:big");
    expect(handoff.getState().dismissed).not.toContain("ds:other"); // another dataset still shows its card
  });

  it("is forgotten when the card is opened again", async () => {
    const handoff = await freshStore();
    handoff.getState().dismiss("ds:big");
    handoff.getState().dismiss("file:huge.h5");
    handoff.getState().reopen("ds:big");
    expect(handoff.getState().dismissed).toEqual(["file:huge.h5"]);
    expect((await freshStore()).getState().dismissed).toEqual(["file:huge.h5"]);
  });

  it("keeps one entry per key, the latest last, and the newest few", async () => {
    const handoff = await freshStore();
    handoff.getState().dismiss("ds:a");
    handoff.getState().dismiss("ds:b");
    handoff.getState().dismiss("ds:a");
    expect(handoff.getState().dismissed).toEqual(["ds:b", "ds:a"]);
    for (let i = 0; i < MAX_REMEMBERED + 5; i++) handoff.getState().dismiss(`ds:${i}`);
    const kept = handoff.getState().dismissed;
    expect(kept).toHaveLength(MAX_REMEMBERED);
    expect(kept[kept.length - 1]).toBe(`ds:${MAX_REMEMBERED + 4}`);
    expect(kept).not.toContain("ds:0");
  });

  it("still works for the page when storage throws, and is just not remembered", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    const handoff = await freshStore();
    expect(handoff.getState().dismissed).toEqual([]);
    expect(() => handoff.getState().dismiss("ds:big")).not.toThrow();
    expect(handoff.getState().dismissed).toEqual(["ds:big"]);
    expect(() => handoff.getState().reopen("ds:big")).not.toThrow();
  });

  it("still works when there is no storage at all", async () => {
    vi.stubGlobal("localStorage", undefined);
    const handoff = await freshStore();
    handoff.getState().dismiss("ds:big");
    expect(handoff.getState().dismissed).toEqual(["ds:big"]);
  });
});

describe("loadDismissed / saveDismissed", () => {
  it("read back what was written", () => {
    saveDismissed(["ds:a", "file:b.h5"], memoryStorage);
    expect(loadDismissed(memoryStorage)).toEqual(["ds:a", "file:b.h5"]);
  });

  it("read nothing from a value that is not a list of keys", () => {
    for (const bad of ["{", '"ds:a"', '{"ds:a":1}', "null"]) {
      store.set(DISMISSED_KEY, bad);
      expect(loadDismissed(memoryStorage)).toEqual([]);
    }
    store.set(DISMISSED_KEY, JSON.stringify(["ds:a", 7, null, "ds:b"]));
    expect(loadDismissed(memoryStorage)).toEqual(["ds:a", "ds:b"]);
    expect(loadDismissed(null)).toEqual([]);
  });
});

describe("the memory bar's hint", () => {
  it("opens the card for the run it was asked in, until closed", async () => {
    const handoff = await freshStore();
    const run = { datasetId: "big" };
    handoff.getState().showNearLimit(run);
    expect(handoff.getState().nearLimitRun).toBe(run);
    handoff.getState().hideNearLimit();
    expect(handoff.getState().nearLimitRun).toBeNull();
  });
});
