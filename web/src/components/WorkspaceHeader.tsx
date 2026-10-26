// The header every viewer page shares, after the NeXus Viewer's workspace
// header, so the controls sit in one order with one name each on every page:
//
//   row 1 — Navigate · Box zoom (?) · overlays (Unit cells, Structure, …)
//           │ the page's own navigation (plane, cuts, filters)  ···  layout
//   row 2 — the display bar(s) (DisplayBar)  ···  the page's display extras
//
// `rows` go between the two (a structure legend), `notes` after them.

import type { ReactNode } from "react";

import { useDpdfStore } from "../state/dpdfStore";
import { ClickModeControl } from "./DisplayBar";
import { Switch } from "./ui";
import { UNIT_CELL_TITLES } from "./viewerText";

/** The "Unit cells" switch: one setting for every page. */
export function UnitCellsSwitch({ kind }: { kind: keyof typeof UNIT_CELL_TITLES }) {
  const gridlines = useDpdfStore((s) => s.gridlines);
  const setGridlines = useDpdfStore((s) => s.setGridlines);
  return <Switch label="Unit cells" title={UNIT_CELL_TITLES[kind]} checked={gridlines} onChange={setGridlines} />;
}

export function WorkspaceHeader({
  overlays,
  nav,
  end,
  rows,
  display,
  displayEnd,
  notes,
}: {
  overlays?: ReactNode; // after the click mode: Unit cells, Structure, …
  nav?: ReactNode; // the page's navigation, after a separator
  end?: ReactNode; // at the right of row 1: the layout switch
  rows?: ReactNode; // whole rows between the two
  display?: ReactNode; // the display bar(s)
  displayEnd?: ReactNode; // at the right of the display row
  notes?: ReactNode; // whole rows after the display row
}) {
  return (
    <div className="ws-head">
      <div className="ws-row">
        <ClickModeControl />
        {overlays}
        {nav && (
          <>
            <span className="ws-sep" />
            {nav}
          </>
        )}
        <span className="ws-spacer" />
        {end}
      </div>
      {rows}
      {display && (
        <div className="ws-row ws-display">
          {display}
          {displayEnd && (
            <>
              <span className="ws-spacer" />
              {displayEnd}
            </>
          )}
        </div>
      )}
      {notes}
    </div>
  );
}
