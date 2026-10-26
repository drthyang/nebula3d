// The click modes after THY-38: Navigate plus the one-shot box zoom. Nothing is
// remembered, and a mode an older version stored ("zoom", "move") opens as
// Navigate and is dropped from storage.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function memoryStorage(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init));
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

async function freshStore() {
  vi.resetModules();
  return import("../workspaceStore");
}

describe("click mode", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it.each(["move", "zoom", "navigate", "box", "nonsense"])("opens in Navigate when %s was stored, and drops it", async (stored) => {
    localStorage.setItem("nebula3d.clickMode", stored);
    const { useWorkspaceStore, LEGACY_CLICK_MODE_KEY } = await freshStore();
    expect(useWorkspaceStore.getState().clickMode).toBe("navigate");
    expect(localStorage.getItem(LEGACY_CLICK_MODE_KEY)).toBeNull();
  });

  it("opens in Navigate without storage", async () => {
    vi.stubGlobal("localStorage", undefined);
    const { useWorkspaceStore } = await freshStore();
    expect(useWorkspaceStore.getState().clickMode).toBe("navigate");
  });

  it("arms the box zoom without remembering it", async () => {
    const { useWorkspaceStore } = await freshStore();
    useWorkspaceStore.getState().setClickMode("box");
    expect(useWorkspaceStore.getState().clickMode).toBe("box");
    expect(localStorage.length).toBe(0);
    const again = await freshStore();
    expect(again.useWorkspaceStore.getState().clickMode).toBe("navigate");
  });
});
