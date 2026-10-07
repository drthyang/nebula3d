// What a click or drag on a slice does, shared by every viewer page and
// remembered per browser — the NeXus Viewer's click modes:
//   navigate — read values; on the 3D-ΔPDF page, move the other two cuts
//   zoom     — click zooms in 2× (Alt-click out), drag zooms into a box
//   move     — drag pans

import { create } from "zustand";

export type ClickMode = "navigate" | "zoom" | "move";

const KEY = "nebula3d.clickMode";

function loadMode(): ClickMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "zoom" || v === "move" ? v : "navigate";
  } catch {
    return "navigate";
  }
}

interface WorkspaceState {
  clickMode: ClickMode;
  setClickMode: (m: ClickMode) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  clickMode: loadMode(),
  setClickMode: (clickMode) => {
    try {
      localStorage.setItem(KEY, clickMode);
    } catch {
      /* storage unavailable */
    }
    set({ clickMode });
  },
}));
