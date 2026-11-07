// The viewer pages' shared control text, in one place so every page names and
// explains a control the same way: one plain line per tooltip, the details
// behind the "?" beside the Box zoom tool.  UI text only — nothing here is read by the
// in-app agent.

import { fmtLevel, type ScaleKind } from "./colorScale";

/** The "?" beside the Box zoom tool: it opens the gesture card (GestureHint.tsx, gestures.ts). */
export const GESTURE_HINT_TITLE = "Zoom, move and reset: the gestures";

/** The Box zoom tool's toggle: armed, one box dragged on a view zooms into it. */
export const BOX_ZOOM_TITLE = "Box zoom: drag a box on a view to zoom into it; Esc or a second press cancels";

/** What Auto sets, one line per kind of data (the Auto button's tooltip). */
export const AUTO_TITLES = {
  sequential: "Auto: vmin 0, vmax at the 97th percentile, softening at the median",
  dpdf: "Auto: ± the 99.9th percentile of |ΔPDF|, the origin left out",
  signed: "Auto: ± the 97th percentile of |values|",
  bragg: "Auto: vmin 0, vmax at the 99th percentile around the peak",
} as const;

export const SCALE_TITLES = {
  asinh: "Asinh: nearly linear below the softening, logarithmic above",
  lin: "Linear",
  log: "Logarithmic",
} as const;

export const BRIGHTNESS_TITLE = "Brightness: vmax in stops about Auto; right is brighter";

/** What the grid switch's lines are on each kind of view (its tooltip). */
export const UNIT_CELL_TITLES = {
  hkl: "Dashed lines at integer h, k, l",
  cell: "Dashed lines at the unit-cell edges",
  both: "Dashed lines at integer h, k, l on the Q views, at the cell edges on the ΔPDF view",
} as const;

/**
 * The switch's name on the r.l.u. views (the Configure preview, Reciprocal
 * cleanup, the Bragg tiles, the Q–R page's Q views): its dashed lines are at
 * integer h, k, l, which is not a unit cell.
 */
export const HKL_GRID_LABEL = "HKL grid";

/** The switch's name on the real-space views (3D-ΔPDF, multi-volume): the unit-cell edges. */
export const UNIT_CELL_LABEL = "Unit cell";

/** The switch's name on each kind of view: "HKL grid" wherever it draws integer h, k, l. */
export const GRID_SWITCH_LABELS = {
  hkl: HKL_GRID_LABEL,
  cell: UNIT_CELL_LABEL,
  both: HKL_GRID_LABEL,
} as const;

export const RESET_ZOOM_TITLE = "Reset zoom (double-click the view, or 0)";

export const STRUCTURE_TITLE = "Mark the structure's interatomic vectors on the ΔPDF";
export const EDIT_STRUCTURE_TITLE = "Load a CIF, or enter sites and symmetry by hand";

/** The phone header's display-row toggle (its name; aria-expanded says open or closed). */
export const DISPLAY_TOGGLE_TITLE = "Colour settings: colormap, range, scale, Auto, Brightness";

/** What a folded display bar says in the phone toggle: its scale, or the ± limit of signed data. */
export function displaySummaryText(d: { symmetric?: boolean; scale?: ScaleKind; lv: { levels: { hi: number } } }): string {
  return d.symmetric ? `±${fmtLevel(Math.abs(d.lv.levels.hi))}` : (d.scale ?? "lin");
}

/** The readout hints' verb: a touch screen has no hover, a tap reads (ViewFrame). */
export const readVerb = (touch: boolean): string => (touch ? "Tap" : "Hover");
