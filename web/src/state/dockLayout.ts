// Where NEBULA Pilot sits.  With room beside the page (a laptop, a desktop, a
// tablet held landscape) it is a docked column the page reflows beside, as
// wide as the user dragged it, or a slim rail when collapsed.  On a portrait
// tablet or a phone it is a bottom sheet under the page, as tall as the user
// dragged it, or a slim bar when collapsed.  Either way it never covers the
// page, so a figure the Pilot points at stays in view beside it.

export type DockMode = "docked" | "sheet";

export const DOCK_WIDTH_KEY = "nebula3d.dockWidth";
export const SHEET_HEIGHT_KEY = "nebula3d.sheetHeight";

/** Width of the collapsed rail (px). */
export const RAIL_W = 44;
export const DOCK_MIN_W = 320;
const DOCK_MAX_W = 720;
export const SHEET_MIN = 0.3;
export const SHEET_MAX = 0.85;
export const SHEET_DEFAULT = 0.48;

/** Docked beside the page when it is wide enough, else a bottom sheet. */
export function dockModeFor(width: number, height: number): DockMode {
  return width >= 1000 || (width >= 900 && width > height) ? "docked" : "sheet";
}

/** A docked width the page keeps at least 45 % of the window beside. */
export function clampDockWidth(px: number, viewportWidth: number): number {
  const max = Math.max(DOCK_MIN_W, Math.min(DOCK_MAX_W, Math.round(viewportWidth * 0.55)));
  return Math.round(Math.min(max, Math.max(DOCK_MIN_W, px)));
}

/** The width a first-time dock opens at: about 28 % of the window, 360–480 px. */
export const defaultDockWidth = (viewportWidth: number): number =>
  clampDockWidth(Math.min(480, Math.max(360, viewportWidth * 0.28)), viewportWidth);

/** A sheet height, as a share of the window, between 30 % and 85 %. */
export const clampSheet = (fraction: number): number => Math.min(SHEET_MAX, Math.max(SHEET_MIN, fraction));

const read = (key: string): number | null => {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
};

const write = (key: string, value: number): void => {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* storage unavailable: the size is just not remembered */
  }
};

export const loadDockWidth = (): number | null => read(DOCK_WIDTH_KEY);
export const saveDockWidth = (px: number): void => write(DOCK_WIDTH_KEY, Math.round(px));
export const loadSheet = (): number | null => {
  const v = read(SHEET_HEIGHT_KEY);
  return v == null ? null : clampSheet(v);
};
export const saveSheet = (fraction: number): void => write(SHEET_HEIGHT_KEY, Math.round(clampSheet(fraction) * 1000) / 1000);
