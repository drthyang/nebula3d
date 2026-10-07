// Pins the workspace layout rules taken from the NeXus Viewer: focus / maximize
// toggles, Esc out of single, and per-page persistence that never restores
// `single`.

import { afterEach, describe, expect, it, vi } from "vitest";

import { layoutReducer, loadLayout, saveLayout, type LayoutState } from "../layout";

const grid: LayoutState = { mode: "grid", primary: "flattened", lastMulti: "grid" };

describe("layoutReducer", () => {
  it("focus on a view makes it primary; again returns to grid", () => {
    const f = layoutReducer(grid, { type: "focus", id: "raw" });
    expect(f).toEqual({ mode: "focus", primary: "raw", lastMulti: "focus" });
    expect(layoutReducer(f, { type: "focus", id: "raw" }).mode).toBe("grid");
    // a thumbnail click in focus swaps the primary
    expect(layoutReducer(f, { type: "focus", id: "backfilled" }).primary).toBe("backfilled");
  });

  it("maximize toggles single and restores the last multi-view layout", () => {
    const f = layoutReducer(grid, { type: "focus", id: "raw" });
    const s = layoutReducer(f, { type: "max", id: "raw" });
    expect(s).toMatchObject({ mode: "single", primary: "raw", lastMulti: "focus" });
    expect(layoutReducer(s, { type: "max", id: "raw" }).mode).toBe("focus");
    expect(layoutReducer(s, { type: "escape" }).mode).toBe("focus");
    expect(layoutReducer(grid, { type: "escape" })).toBe(grid);
  });

  it("set keeps the primary unless one is given and never records single as lastMulti", () => {
    const s = layoutReducer(grid, { type: "set", mode: "single" });
    expect(s).toEqual({ mode: "single", primary: "flattened", lastMulti: "grid" });
    expect(layoutReducer(s, { type: "set", mode: "focus", id: "raw" })).toEqual({
      mode: "focus", primary: "raw", lastMulti: "focus",
    });
  });
});

describe("loadLayout / saveLayout", () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubStorage = () => {
    const m = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
    });
    return m;
  };

  it("round-trips and stores single as its multi-view layout", () => {
    stubStorage();
    saveLayout("cleanup", { mode: "single", primary: "raw", lastMulti: "focus" });
    expect(loadLayout("cleanup", ["raw", "flattened"], grid)).toEqual({
      mode: "focus", primary: "raw", lastMulti: "focus",
    });
  });

  it("falls back for unknown views, bad JSON, or no storage", () => {
    const m = stubStorage();
    m.set("nebula3d.layout.cleanup", JSON.stringify({ mode: "focus", primary: "gone" }));
    expect(loadLayout("cleanup", ["raw", "flattened"], grid).primary).toBe("flattened");
    m.set("nebula3d.layout.cleanup", "{not json");
    expect(loadLayout("cleanup", ["raw"], grid)).toBe(grid);
    vi.unstubAllGlobals();
    vi.stubGlobal("localStorage", undefined);
    expect(loadLayout("cleanup", ["raw"], grid)).toBe(grid);
    expect(() => saveLayout("cleanup", grid)).not.toThrow();
  });
});
