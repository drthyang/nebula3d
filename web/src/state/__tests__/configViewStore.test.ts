// The Configure page's view state: the preview's tab and the stages' advanced
// folds are remembered per browser (and survive storage that throws or holds
// junk); each plane's zoom belongs to the dataset it was set on. None of it
// is a setting the agent reads.

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

const throwing: Storage = {
  length: 0,
  clear: () => {
    throw new Error("denied");
  },
  getItem: () => {
    throw new Error("denied");
  },
  key: () => null,
  removeItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("denied");
  },
};

async function freshStore() {
  vi.resetModules();
  return import("../configViewStore");
}

describe("the preview's tab", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("opens on a*–b* the first time", async () => {
    const { useConfigViewStore } = await freshStore();
    expect(useConfigViewStore.getState().previewTab).toBe("hk");
  });

  it("is remembered: a reload opens on the tab last chosen", async () => {
    const first = await freshStore();
    first.useConfigViewStore.getState().setPreviewTab("kl");
    expect(first.useConfigViewStore.getState().previewTab).toBe("kl");
    expect(localStorage.getItem(first.PREVIEW_TAB_KEY)).toBe("kl");
    const again = await freshStore();
    expect(again.useConfigViewStore.getState().previewTab).toBe("kl");
  });

  it.each(["", "0kl", "HK", "null", "[]"])("opens on a*–b* when the browser holds %j", async (stored) => {
    localStorage.setItem("nebula3d.configPreviewTab", stored);
    const { useConfigViewStore } = await freshStore();
    expect(useConfigViewStore.getState().previewTab).toBe("hk");
  });

  it("refuses a plane that is not one of the three", async () => {
    const { useConfigViewStore } = await freshStore();
    useConfigViewStore.getState().setPreviewTab("xy" as never);
    expect(useConfigViewStore.getState().previewTab).toBe("hk");
    expect(localStorage.length).toBe(0);
  });

  it("works without storage, for the visit", async () => {
    vi.stubGlobal("localStorage", throwing);
    const { useConfigViewStore } = await freshStore();
    expect(useConfigViewStore.getState().previewTab).toBe("hk");
    useConfigViewStore.getState().setPreviewTab("hl");
    expect(useConfigViewStore.getState().previewTab).toBe("hl");
  });
});

describe("the advanced folds", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("are all folded the first time", async () => {
    const { useConfigViewStore } = await freshStore();
    expect(useConfigViewStore.getState().advancedOpen).toEqual([]);
  });

  it("remember which stages were left open", async () => {
    const first = await freshStore();
    first.useConfigViewStore.getState().setAdvancedOpen("punch", true);
    first.useConfigViewStore.getState().setAdvancedOpen("pdf", true);
    first.useConfigViewStore.getState().setAdvancedOpen("punch", false);
    expect(first.useConfigViewStore.getState().advancedOpen).toEqual(["pdf"]);
    const again = await freshStore();
    expect(again.useConfigViewStore.getState().advancedOpen).toEqual(["pdf"]);
  });

  it("do not list a stage twice", async () => {
    const { useConfigViewStore } = await freshStore();
    useConfigViewStore.getState().setAdvancedOpen("rings", true);
    useConfigViewStore.getState().setAdvancedOpen("rings", true);
    expect(useConfigViewStore.getState().advancedOpen).toEqual(["rings"]);
  });

  it.each(['{"punch":true}', "not json", '["punch","nonsense","punch",3]'])("read only known stages from %j", async (stored) => {
    localStorage.setItem("nebula3d.configAdvancedOpen", stored);
    const { useConfigViewStore } = await freshStore();
    expect(useConfigViewStore.getState().advancedOpen).toEqual(stored.startsWith("[") ? ["punch"] : []);
  });

  it("work without storage, for the visit", async () => {
    vi.stubGlobal("localStorage", throwing);
    const { useConfigViewStore } = await freshStore();
    expect(useConfigViewStore.getState().advancedOpen).toEqual([]);
    useConfigViewStore.getState().setAdvancedOpen("flatten", true);
    expect(useConfigViewStore.getState().advancedOpen).toEqual(["flatten"]);
  });
});

describe("the preview's zoom", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("is kept per plane, for the dataset it was set on", async () => {
    const { useConfigViewStore, previewView } = await freshStore();
    const v = { cx: 1, cy: 2, half: 3 };
    useConfigViewStore.getState().setView("a", "hk", v);
    const views = useConfigViewStore.getState().views;
    expect(previewView(views, "a", "hk")).toEqual(v);
    expect(previewView(views, "a", "hl")).toBeUndefined();
    expect(previewView(views, "b", "hk")).toBeUndefined();
    expect(previewView(views, null, "hk")).toBeUndefined();
  });

  it("starts over on another dataset, and a reset returns a plane to the whole slice", async () => {
    const { useConfigViewStore, previewView } = await freshStore();
    useConfigViewStore.getState().setView("a", "hk", { cx: 0, cy: 0, half: 1 });
    useConfigViewStore.getState().setView("a", "kl", { cx: 0, cy: 0, half: 2 });
    useConfigViewStore.getState().setView("a", "hk", null);
    expect(previewView(useConfigViewStore.getState().views, "a", "hk")).toBeUndefined();
    expect(previewView(useConfigViewStore.getState().views, "a", "kl")).toEqual({ cx: 0, cy: 0, half: 2 });
    useConfigViewStore.getState().setView("b", "hl", { cx: 0, cy: 0, half: 4 });
    expect(previewView(useConfigViewStore.getState().views, "a", "kl")).toBeUndefined();
    expect(previewView(useConfigViewStore.getState().views, "b", "hl")).toEqual({ cx: 0, cy: 0, half: 4 });
  });

  it("is not remembered by the browser", async () => {
    const { useConfigViewStore } = await freshStore();
    useConfigViewStore.getState().setView("a", "hk", { cx: 0, cy: 0, half: 1 });
    useConfigViewStore.getState().setLevels({ lo: 0, hi: 5, dataset: "a" });
    expect(localStorage.length).toBe(0);
  });
});
