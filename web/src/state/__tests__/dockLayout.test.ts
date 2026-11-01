// NEBULA Pilot docks beside the page when there is room and sits under it as a
// bottom sheet when there is not; its width and the sheet's height stay within
// bounds that leave the page usable, and are remembered once the user lets go.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clampDockWidth,
  clampSheet,
  defaultDockWidth,
  DOCK_MIN_W,
  DOCK_WIDTH_KEY,
  dockModeFor,
  loadDockWidth,
  loadSheet,
  SHEET_HEIGHT_KEY,
  SHEET_MAX,
  SHEET_MIN,
} from "../dockLayout";
import { useNavStore } from "../navStore";

// localStorage for the node test environment.
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("dockModeFor", () => {
  it("docks beside the page on laptops, desktops and landscape tablets", () => {
    expect(dockModeFor(1440, 900)).toBe("docked");
    expect(dockModeFor(1920, 1080)).toBe("docked");
    expect(dockModeFor(1180, 820)).toBe("docked");
    expect(dockModeFor(1024, 1366)).toBe("docked"); // a large tablet, portrait: still room beside
    expect(dockModeFor(960, 600)).toBe("docked");
  });

  it("docks on a phone held landscape, whose sheet would be too short", () => {
    expect(dockModeFor(844, 390)).toBe("docked");
    expect(dockModeFor(932, 430)).toBe("docked");
    expect(dockModeFor(667, 375)).toBe("sheet"); // a small phone: a column would leave the page too little
  });

  it("is a bottom sheet on portrait tablets and phones", () => {
    expect(dockModeFor(820, 1180)).toBe("sheet");
    expect(dockModeFor(390, 844)).toBe("sheet");
    expect(dockModeFor(950, 1000)).toBe("sheet");
  });
});

describe("clampDockWidth", () => {
  it("keeps the dock between its minimum and 55 % of the window", () => {
    expect(clampDockWidth(100, 1440)).toBe(DOCK_MIN_W);
    expect(clampDockWidth(500, 1440)).toBe(500);
    expect(clampDockWidth(900, 1440)).toBe(720); // never wider than 720 px
    expect(clampDockWidth(700, 1100)).toBe(605); // the page keeps 45 % beside it
  });

  it("leaves the page 45 % of the room beside the sidebar, not of the window", () => {
    // 1100 px with its 208 px sidebar: the page keeps 45 % of the 892 px left.
    expect(clampDockWidth(700, 1100, 208)).toBe(491);
    expect(1100 - 208 - clampDockWidth(700, 1100, 208)).toBeGreaterThanOrEqual(Math.round(0.45 * 892));
    expect(defaultDockWidth(1100, 208)).toBe(360);
  });

  it("allows the minimum even on a window too narrow for 55 %", () => {
    expect(clampDockWidth(400, 500)).toBe(DOCK_MIN_W);
  });

  it("rounds to whole pixels", () => {
    expect(clampDockWidth(401.6, 1440)).toBe(402);
  });
});

describe("defaultDockWidth", () => {
  it("opens at about 28 % of the window, between 360 and 480 px", () => {
    expect(defaultDockWidth(1440)).toBe(403);
    expect(defaultDockWidth(1920)).toBe(480);
    expect(defaultDockWidth(1180)).toBe(360);
    expect(defaultDockWidth(2560)).toBe(480);
  });
});

describe("clampSheet", () => {
  it("keeps the sheet between 30 % and 85 % of the window", () => {
    expect(clampSheet(0.1)).toBe(SHEET_MIN);
    expect(clampSheet(0.5)).toBe(0.5);
    expect(clampSheet(0.99)).toBe(SHEET_MAX);
  });
});

describe("the remembered size", () => {
  it("saves the width and height when a drag ends, not while it moves", () => {
    const { setDockWidth, setSheet } = useNavStore.getState();
    setDockWidth(512);
    setSheet(0.6);
    expect(store.has(DOCK_WIDTH_KEY)).toBe(false);
    expect(store.has(SHEET_HEIGHT_KEY)).toBe(false);
    setDockWidth(520, true);
    setSheet(0.62, true);
    expect(loadDockWidth()).toBe(520);
    expect(loadSheet()).toBe(0.62);
    expect(useNavStore.getState()).toMatchObject({ dockWidth: 520, sheet: 0.62 });
  });

  it("clamps the sheet before storing it, and ignores unreadable values", () => {
    useNavStore.getState().setSheet(2, true);
    expect(useNavStore.getState().sheet).toBe(SHEET_MAX);
    expect(loadSheet()).toBe(SHEET_MAX);
    store.set(DOCK_WIDTH_KEY, "wide");
    store.set(SHEET_HEIGHT_KEY, "-1");
    expect(loadDockWidth()).toBeNull();
    expect(loadSheet()).toBeNull();
  });

  it("forgets nothing when storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(loadDockWidth()).toBeNull();
    expect(() => useNavStore.getState().setDockWidth(480, true)).not.toThrow();
    expect(useNavStore.getState().dockWidth).toBe(480);
  });
});
