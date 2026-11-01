// What a left click or drag on a slice does, shared by every viewer page:
//   none — nothing: hover reads values and draws the crosshair, which follows
//          the pointer in every linked view
//   box  — the box-zoom tool, armed by its button: one drag zooms into the box,
//          then the tool is put away (back to none)
// Zoom and pan need no mode: the views behave like an embedded map —
// Ctrl/⌘ + wheel or a pinch zooms about the pointer (a plain wheel too when
// the page cannot scroll), a Shift, middle-button or two-finger drag pans, and
// a double-click returns to the full view (components/ViewFrame.tsx).
//
// The box zoom is a one-shot tool, so nothing is remembered: a page always
// opens with it put away. Browsers that stored one of the old Navigate · Zoom ·
// Move modes have it dropped.
//
// On phones the header's display row folds behind a toggle (WorkspaceHeader);
// whether it is open is one setting for every page, remembered per browser.
//
// The gesture card (GestureHint.tsx) marks its "?" with a dot until it has
// been opened once in this browser.

import { create } from "zustand";

export type ClickMode = "none" | "box";

/** Where the old click modes were remembered; read once to drop them. */
export const LEGACY_CLICK_MODE_KEY = "nebula3d.clickMode";

/** The mode a page opens in: none (the box zoom put away), whatever an older version stored ("navigate", "zoom", "move"). */
export function initialClickMode(): ClickMode {
  try {
    if (localStorage.getItem(LEGACY_CLICK_MODE_KEY) !== null) localStorage.removeItem(LEGACY_CLICK_MODE_KEY);
  } catch {
    /* storage unavailable */
  }
  return "none";
}

/** Where the phone header's display row remembers being open ("1") or closed. */
export const DISPLAY_OPEN_KEY = "nebula3d.displayRowOpen";

/** Whether the phone display row opens unfolded: closed unless this browser left it open. */
export function initialDisplayOpen(): boolean {
  try {
    return localStorage.getItem(DISPLAY_OPEN_KEY) === "1";
  } catch {
    return false; // storage unavailable
  }
}

/** Where this browser remembers that the gesture card has been opened ("1"). */
export const GESTURE_HINT_SEEN_KEY = "nebula3d.gestureHintSeen";

/** Whether the gesture card has been opened before in this browser (unknown → not yet). */
export function initialGestureHintSeen(): boolean {
  try {
    return localStorage.getItem(GESTURE_HINT_SEEN_KEY) === "1";
  } catch {
    return false; // storage unavailable: the dot shows until the card is opened this visit
  }
}

interface WorkspaceState {
  clickMode: ClickMode;
  setClickMode: (m: ClickMode) => void;
  displayOpen: boolean;
  setDisplayOpen: (open: boolean) => void;
  gestureHintSeen: boolean;
  markGestureHintSeen: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  clickMode: initialClickMode(),
  setClickMode: (clickMode) => set({ clickMode }),
  displayOpen: initialDisplayOpen(),
  setDisplayOpen: (displayOpen) => {
    try {
      localStorage.setItem(DISPLAY_OPEN_KEY, displayOpen ? "1" : "0");
    } catch {
      /* storage unavailable: open for this visit only */
    }
    set({ displayOpen });
  },
  gestureHintSeen: initialGestureHintSeen(),
  markGestureHintSeen: () => {
    try {
      localStorage.setItem(GESTURE_HINT_SEEN_KEY, "1");
    } catch {
      /* storage unavailable: seen for this visit only */
    }
    set({ gestureHintSeen: true });
  },
}));
