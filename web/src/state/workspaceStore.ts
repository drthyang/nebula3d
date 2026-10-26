// What a left click or drag on a slice does, shared by every viewer page:
//   navigate — read values; on the 3D-ΔPDF page a click moves the other two cuts
//   box      — the box-zoom tool, armed by its button: one drag zooms into the
//              box, then the views are back in Navigate
// Zoom and pan need no mode: in every mode the views behave like an embedded
// map — Ctrl/⌘ + wheel or a pinch zooms about the pointer (a plain wheel too
// when the page cannot scroll), a Shift, middle-button or two-finger drag pans,
// and a double-click returns to the full view (components/ViewFrame.tsx).
//
// The box zoom is a one-shot tool, so no mode is remembered: a page always
// opens in Navigate. Browsers that stored one of the old Navigate · Zoom · Move
// modes have it dropped.

import { create } from "zustand";

export type ClickMode = "navigate" | "box";

/** Where the old click modes were remembered; read once to drop them. */
export const LEGACY_CLICK_MODE_KEY = "nebula3d.clickMode";

/** The mode a page opens in: Navigate, whatever an older version stored ("zoom", "move"). */
export function initialClickMode(): ClickMode {
  try {
    if (localStorage.getItem(LEGACY_CLICK_MODE_KEY) !== null) localStorage.removeItem(LEGACY_CLICK_MODE_KEY);
  } catch {
    /* storage unavailable */
  }
  return "navigate";
}

interface WorkspaceState {
  clickMode: ClickMode;
  setClickMode: (m: ClickMode) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  clickMode: initialClickMode(),
  setClickMode: (clickMode) => set({ clickMode }),
}));
