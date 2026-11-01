// The run-it-locally card's state (components/LocalHandoff.tsx): which cards
// the user dismissed, remembered per dataset (or per refused file) in
// localStorage, and the card the memory bar's hint opened for a run.
//
// Storage can be missing or throw (a private window, blocked site data): every
// read and write is guarded, and the card then just isn't remembered across
// reloads.

import { create } from "zustand";

export const DISMISSED_KEY = "nebula3d.localHandoff.dismissed";
/** The most dismissals remembered; the oldest go first. */
export const MAX_REMEMBERED = 50;

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The dismissed cards' keys, oldest first; none when storage can't be read. */
export function loadDismissed(storage: KeyValueStore | null = defaultStorage()): string[] {
  try {
    const raw = storage?.getItem(DISMISSED_KEY);
    const keys: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string").slice(-MAX_REMEMBERED) : [];
  } catch {
    return [];
  }
}

export function saveDismissed(keys: readonly string[], storage: KeyValueStore | null = defaultStorage()): void {
  try {
    storage?.setItem(DISMISSED_KEY, JSON.stringify(keys.slice(-MAX_REMEMBERED)));
  } catch {
    /* storage unavailable: the dismissal holds until the page reloads */
  }
}

interface HandoffState {
  dismissed: string[];
  // The run whose red memory bar the user asked about (its RunRecord): the
  // Execution page shows the card while that run goes.
  nearLimitRun: unknown;
  dismiss: (key: string) => void;
  reopen: (key: string) => void;
  showNearLimit: (run: unknown) => void;
  hideNearLimit: () => void;
}

export const useHandoffStore = create<HandoffState>((set, get) => ({
  dismissed: loadDismissed(),
  nearLimitRun: null,
  dismiss: (key) => {
    const dismissed = [...get().dismissed.filter((k) => k !== key), key].slice(-MAX_REMEMBERED);
    saveDismissed(dismissed);
    set({ dismissed });
  },
  reopen: (key) => {
    if (!get().dismissed.includes(key)) return;
    const dismissed = get().dismissed.filter((k) => k !== key);
    saveDismissed(dismissed);
    set({ dismissed });
  },
  showNearLimit: (run) => set({ nearLimitRun: run ?? null }),
  hideNearLimit: () => set({ nearLimitRun: null }),
}));
