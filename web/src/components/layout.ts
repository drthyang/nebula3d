// Workspace layouts, after the NeXus Viewer's quad / focus / single:
//   grid   — every view the same size
//   focus  — one large view (the primary) with the others beside it as thumbnails
//   single — the primary alone; Esc returns to the last multi-view layout
// The layout is remembered per page (localStorage), never as `single`.

export type LayoutMode = "grid" | "focus" | "single";

export interface LayoutState {
  mode: LayoutMode;
  primary: string;
  lastMulti: "grid" | "focus";
}

export type LayoutAction =
  | { type: "set"; mode: LayoutMode; id?: string }
  | { type: "focus"; id: string } // a view's focus button: toggles focus on it
  | { type: "max"; id: string } // a view's maximize button / header double-click
  | { type: "escape" };

export function layoutReducer(s: LayoutState, a: LayoutAction): LayoutState {
  switch (a.type) {
    case "set":
      return {
        mode: a.mode,
        primary: a.id ?? s.primary,
        lastMulti: a.mode === "single" ? s.lastMulti : a.mode,
      };
    case "focus":
      return s.mode === "focus" && s.primary === a.id
        ? { ...s, mode: "grid", lastMulti: "grid" }
        : { mode: "focus", primary: a.id, lastMulti: "focus" };
    case "max":
      return s.mode === "single" && s.primary === a.id
        ? { ...s, mode: s.lastMulti }
        : { ...s, mode: "single", primary: a.id };
    case "escape":
      return s.mode === "single" ? { ...s, mode: s.lastMulti } : s;
  }
}

const storageKey = (page: string) => `nebula3d.layout.${page}`;

/** The saved layout for a page, if it names one of `ids`; else the fallback. */
export function loadLayout(page: string, ids: string[], fallback: LayoutState): LayoutState {
  try {
    const raw = localStorage.getItem(storageKey(page));
    if (!raw) return fallback;
    const s = JSON.parse(raw) as Partial<LayoutState>;
    const mode = s.mode === "grid" || s.mode === "focus" ? s.mode : fallback.mode;
    const primary = typeof s.primary === "string" && ids.includes(s.primary) ? s.primary : fallback.primary;
    return { mode, primary, lastMulti: mode === "single" ? fallback.lastMulti : mode };
  } catch {
    return fallback; // storage unavailable or corrupt
  }
}

export function saveLayout(page: string, s: LayoutState): void {
  try {
    const mode = s.mode === "single" ? s.lastMulti : s.mode;
    localStorage.setItem(storageKey(page), JSON.stringify({ mode, primary: s.primary }));
  } catch {
    /* storage unavailable */
  }
}
