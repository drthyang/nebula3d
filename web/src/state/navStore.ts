// Which page the console shows, and whether the assistant panel is open.  In a
// store, not App state, so the assistant can open a viewer from the panel, and
// the panel (with its conversation) stays put while pages change under it.

import { create } from "zustand";

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
  dockOpen: boolean;
  setTab: (t: Tab) => void;
  setDockOpen: (open: boolean) => void;
}

export const useNavStore = create<NavState>((set) => ({
  tab: "config",
  dockOpen: loadDockOpen(),
  setTab: (tab) => set({ tab }),
  setDockOpen: (dockOpen) => {
    try {
      localStorage.setItem(DOCK_KEY, dockOpen ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
    set({ dockOpen });
  },
}));
