// Which page the console shows, and where the assistant panel is: open or
// collapsed, and the size the user gave it (state/dockLayout.ts).  In a store,
// not App state, so the assistant can open a viewer from the panel, and the
// panel (with its conversation) stays put while pages change under it.

import { create } from "zustand";

import { clampSheet, loadDockWidth, loadSheet, saveDockWidth, saveSheet, SHEET_DEFAULT } from "./dockLayout";

export type Tab = "config" | "execution" | "reciprocal" | "bragg" | "dpdf" | "consistency";

const DOCK_KEY = "nebula3d.assistantOpen";

function loadDockOpen(): boolean {
  try {
    return localStorage.getItem(DOCK_KEY) === "1";
  } catch {
    return false;
  }
}

interface NavState {
  tab: Tab;
  dockOpen: boolean; // open, or collapsed to its rail (docked) or bar (sheet)
  dockWidth: number | null; // docked width the user dragged (px); null: the default for the window
  sheet: number; // bottom-sheet height, a share of the window
  setTab: (t: Tab) => void;
  setDockOpen: (open: boolean) => void;
  // While dragging the size changes without being saved; on release it is.
  setDockWidth: (px: number, save?: boolean) => void;
  setSheet: (fraction: number, save?: boolean) => void;
}

export const useNavStore = create<NavState>((set) => ({
  tab: "config",
  dockOpen: loadDockOpen(),
  dockWidth: loadDockWidth(),
  sheet: loadSheet() ?? SHEET_DEFAULT,
  setTab: (tab) => set({ tab }),
  setDockWidth: (px, save = false) => {
    if (save) saveDockWidth(px);
    set({ dockWidth: px });
  },
  setSheet: (fraction, save = false) => {
    const sheet = clampSheet(fraction);
    if (save) saveSheet(sheet);
    set({ sheet });
  },
  setDockOpen: (dockOpen) => {
    try {
      localStorage.setItem(DOCK_KEY, dockOpen ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
    set({ dockOpen });
  },
}));
