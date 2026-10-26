// The viewer pages' shared control text, in one place so every page names and
// explains a control the same way: one plain line per tooltip, the details
// behind the click modes' "?".  UI text only — nothing here is read by the
// in-app agent.

/** The zoom, pan and reset gestures every view takes in any mode (the click modes' "?"). */
export const VIEW_GESTURES: readonly string[] = [
  "Zoom: Ctrl/⌘ + wheel, pinch, or + / −",
  "Pan: Shift-, middle- or two-finger drag, or the arrow keys",
  "Reset: double-click a view, or 0",
  "Box zoom: Esc or a second press puts it away",
];

export const CLICK_MODE_TITLES = {
  navigate: "Navigate: hover reads values; on 3D-ΔPDF a click moves the other two cuts",
  box: "Box zoom: drag a box on a view to zoom into it, then back to Navigate",
} as const;

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

/** What the "Unit cells" lines are on each kind of view (its tooltip). */
export const UNIT_CELL_TITLES = {
  hkl: "Dashed lines at integer h, k, l",
  cell: "Dashed lines at the unit-cell edges",
  both: "Dashed lines at integer h, k, l on the Q views, at the cell edges on the ΔPDF view",
} as const;

export const RESET_ZOOM_TITLE = "Reset zoom (double-click the view, or 0)";

export const STRUCTURE_TITLE = "Mark the structure's interatomic vectors on the ΔPDF";
export const EDIT_STRUCTURE_TITLE = "Load a CIF, or enter sites and symmetry by hand";
