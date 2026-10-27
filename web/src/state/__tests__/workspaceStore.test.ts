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

describe("the phone header's display row", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("opens folded by default", async () => {
    const { useWorkspaceStore } = await freshStore();
    expect(useWorkspaceStore.getState().displayOpen).toBe(false);
  });

  it("is remembered per browser, open or closed", async () => {
    const { useWorkspaceStore, DISPLAY_OPEN_KEY } = await freshStore();
    useWorkspaceStore.getState().setDisplayOpen(true);
    expect(localStorage.getItem(DISPLAY_OPEN_KEY)).toBe("1");
    expect((await freshStore()).useWorkspaceStore.getState().displayOpen).toBe(true);
    (await freshStore()).useWorkspaceStore.getState().setDisplayOpen(false);
    expect((await freshStore()).useWorkspaceStore.getState().displayOpen).toBe(false);
  });

  it("still toggles, folded at first, without storage", async () => {
    const throwing = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    vi.stubGlobal("localStorage", throwing);
    const { useWorkspaceStore } = await freshStore();
    expect(useWorkspaceStore.getState().displayOpen).toBe(false);
    useWorkspaceStore.getState().setDisplayOpen(true);
    expect(useWorkspaceStore.getState().displayOpen).toBe(true);
  });
});

describe("the gesture card's first-run dot", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("shows until the card has been opened once in this browser", async () => {
    const { useWorkspaceStore, GESTURE_HINT_SEEN_KEY } = await freshStore();
    expect(useWorkspaceStore.getState().gestureHintSeen).toBe(false);
    useWorkspaceStore.getState().markGestureHintSeen();
    expect(useWorkspaceStore.getState().gestureHintSeen).toBe(true);
    expect(localStorage.getItem(GESTURE_HINT_SEEN_KEY)).toBe("1");
    expect((await freshStore()).useWorkspaceStore.getState().gestureHintSeen).toBe(true);
  });

  it("works without storage: shown at first, gone once opened this visit", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    });
    const { useWorkspaceStore } = await freshStore();
    expect(useWorkspaceStore.getState().gestureHintSeen).toBe(false);
    useWorkspaceStore.getState().markGestureHintSeen();
    expect(useWorkspaceStore.getState().gestureHintSeen).toBe(true);
  });
});
