// The room NEBULA Pilot's dock is sized against (state/dockLayout.ts): the
// app's width in its own CSS pixels (the window over the UI zoom) and the
// sidebar column's width, which the stylesheet sets per breakpoint
// (--sidebar-w; a top bar, no column, below 1100 px).

export const zoom = (): number =>
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-zoom")) || 1;

/** The app's width in its own CSS pixels. */
export const appWidth = (): number => window.innerWidth / zoom();

/** The sidebar column's width beside the page, 0 where the sidebar is a top bar. */
export const sidebarWidth = (): number =>
  window.innerWidth >= 1100 ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sidebar-w")) || 0 : 0;
