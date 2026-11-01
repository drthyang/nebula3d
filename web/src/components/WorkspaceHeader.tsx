// The header every viewer page shares, after the NeXus Viewer's workspace
// header, so the controls sit in one order with one name each on every page:
//
//   row 1 — Box zoom (?) · overlays (Unit cell, Structure, …;
//           the Configure preview names Unit cell "HKL grid")
//           │ the page's own navigation (plane, cuts, filters)  ···  layout
//   row 2 — the display bar(s) (DisplayBar)  ···  the page's display extras
//
// `rows` go between the two (a structure legend), `notes` after them.
//
// On phones (the mobile pass's phone tiers, index.css) row 2 folds behind a
// toggle at the end of row 1, closed by default and remembered per browser
// (workspaceStore.ts); closed, the toggle sums row 2 up: each bar's colormap
// swatch and its scale (or ± limit).  Desktop and tablet show row 2 as ever,
// and the toggle not at all: CSS alone decides, so there is one header.

import { useId, type ReactNode } from "react";

import { useDpdfStore } from "../state/dpdfStore";
import { useWorkspaceStore } from "../state/workspaceStore";
import { BoxZoomTool, DisplayBar, type DisplayBarProps } from "./DisplayBar";
import { ColormapBar, Switch } from "./ui";
import { DISPLAY_TOGGLE_TITLE, displaySummaryText, UNIT_CELL_TITLES } from "./viewerText";

/**
 * The "Unit cell" switch: one setting for every page. `label` renames it
 * where another name says better what it draws (the Configure preview's
 * "HKL grid"); the setting stays the same one.
 */
export function UnitCellsSwitch({ kind, label = "Unit cell" }: { kind: keyof typeof UNIT_CELL_TITLES; label?: string }) {
  const gridlines = useDpdfStore((s) => s.gridlines);
  const setGridlines = useDpdfStore((s) => s.setGridlines);
  return <Switch label={label} title={UNIT_CELL_TITLES[kind]} checked={gridlines} onChange={setGridlines} />;
}

/** The phone toggle for the display row (hidden by CSS on wider screens). */
function DisplayToggle({ open, onToggle, controls, displays }: { open: boolean; onToggle: () => void; controls: string; displays: DisplayBarProps[] }) {
  return (
    <button
      type="button"
      className={`ws-display-toggle${open ? " open" : ""}`}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={DISPLAY_TOGGLE_TITLE}
      title={DISPLAY_TOGGLE_TITLE}
      onClick={onToggle}
    >
      {open ? (
        <span className="ws-display-toggle-text">Display</span>
      ) : (
        displays.map((d, i) => (
          <span key={i} className="ws-display-sum">
            {d.badge}
            <ColormapBar lut={d.lut} />
            <span className="ws-display-toggle-text">{displaySummaryText(d)}</span>
          </span>
        ))
      )}
      <svg className="ws-display-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M2.5 4.5 6 8l3.5-3.5" />
      </svg>
    </button>
  );
}

export function WorkspaceHeader({
  overlays,
  nav,
  end,
  rows,
  displays,
  displayEnd,
  notes,
}: {
  overlays?: ReactNode; // after the Box zoom tool: Unit cell, Structure, …
  nav?: ReactNode; // the page's navigation, after a separator
  end?: ReactNode; // at the right of row 1: the layout switch
  rows?: ReactNode; // whole rows between the two
  displays?: DisplayBarProps[]; // the display bar(s) of row 2 (Q–R has two)
  displayEnd?: ReactNode; // at the right of the display row
  notes?: ReactNode; // whole rows after the display row
}) {
  const open = useWorkspaceStore((s) => s.displayOpen);
  const setOpen = useWorkspaceStore((s) => s.setDisplayOpen);
  const rowId = useId();
  const hasDisplay = Boolean(displays && displays.length);
  return (
    <div className="ws-head">
      <div className="ws-row">
        <BoxZoomTool />
        {overlays}
        {nav && (
          <>
            <span className="ws-sep" />
            {nav}
          </>
        )}
        <span className="ws-spacer" />
        {end}
        {hasDisplay && <DisplayToggle open={open} onToggle={() => setOpen(!open)} controls={rowId} displays={displays!} />}
      </div>
      {rows}
      {hasDisplay && (
        <div id={rowId} className={`ws-row ws-display${open ? "" : " ws-display--folded"}`}>
          {displays!.map((d, i) => (
            <DisplayBar key={i} {...d} />
          ))}
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
