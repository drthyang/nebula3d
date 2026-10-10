// The viewer workspace, after the NeXus Viewer: views laid out as a grid (all
// the same size), focus (one large view, the others as thumbnails beside it)
// or single (one view; Esc returns).  Each view's header has Reset zoom,
// focus and maximize; double-clicking a header maximizes it; clicking a
// thumbnail (or Enter on it) makes it the large view.  The layout is
// remembered per page.  On phones every view is shown, one per row (CSS).

import type { ReactNode } from "react";

import type { LayoutMode, LayoutState } from "./layout";
import type { LayoutDispatch } from "./useWorkspaceLayout";

export interface WorkspaceView {
  id: string;
  title: ReactNode;
  badge: ReactNode;
  badgeClass?: string;
  caption?: ReactNode;
  actions?: ReactNode; // extra header buttons, before the layout buttons
  footer?: ReactNode;
  onResetView?: () => void;
  glow?: boolean; // the assistant is on this view: a breathing edge
  children: ReactNode; // the view body
}

const icon = (body: ReactNode) => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    {body}
  </svg>
);

const ICONS = {
  grid: icon(
    <>
      <rect x="1.75" y="1.75" width="5.5" height="5.5" rx="1" />
      <rect x="8.75" y="1.75" width="5.5" height="5.5" rx="1" />
      <rect x="1.75" y="8.75" width="5.5" height="5.5" rx="1" />
      <rect x="8.75" y="8.75" width="5.5" height="5.5" rx="1" />
    </>,
  ),
  focus: icon(
    <>
      <rect x="1.75" y="1.75" width="8" height="12.5" rx="1" />
      <rect x="11.25" y="1.75" width="3" height="5.5" rx=".8" />
      <rect x="11.25" y="8.75" width="3" height="5.5" rx=".8" />
    </>,
  ),
  single: icon(<rect x="1.75" y="1.75" width="12.5" height="12.5" rx="1" />),
  max: icon(<path d="M9.5 2.25h4.25V6.5M6.5 13.75H2.25V9.5M13.75 2.25 9 7M2.25 13.75 7 9" />),
  restore: icon(<path d="M13.75 6.5H9.5V2.25M2.25 9.5H6.5v4.25M9.5 6.5l4.25-4.25M6.5 9.5l-4.25 4.25" />),
  reset: icon(
    <>
      <path d="M2.75 8a5.25 5.25 0 1 0 1.6-3.8" />
      <path d="M2.5 2.5v3h3" />
    </>,
  ),
};

const MODES: { mode: LayoutMode; title: string }[] = [
  { mode: "grid", title: "All views the same size" },
  { mode: "focus", title: "One large view with the others beside it" },
  { mode: "single", title: "One view (Esc to return)" },
];

/** The layout switch for the workspace header. */
export function LayoutControl({ state, dispatch }: { state: LayoutState; dispatch: LayoutDispatch }) {
  return (
    <div className="segmented icons layout-control" role="group" aria-label="Layout">
      {MODES.map(({ mode, title }) => (
        <button
          key={mode}
          type="button"
          className={state.mode === mode ? "on" : ""}
          title={title}
          aria-label={title}
          aria-pressed={state.mode === mode}
          onClick={() => dispatch({ type: "set", mode })}
        >
          {ICONS[mode]}
        </button>
      ))}
    </div>
  );
}

export function Workspace({
  state,
  dispatch,
  views,
}: {
  state: LayoutState;
  dispatch: LayoutDispatch;
  views: WorkspaceView[];
}) {
  const ids = views.map((v) => v.id);
  const primary = ids.includes(state.primary) ? state.primary : ids[0];
  const { mode } = state;
  return (
    <div className={`ws ws--${mode}`} data-n={views.length}>
      {views.map((v) => {
        const isPrimary = v.id === primary;
        const thumb = mode === "focus" && !isPrimary;
        const focusBack = mode === "focus" && isPrimary;
        const restore = mode === "single" && isPrimary;
        const enlarge = () => dispatch({ type: "focus", id: v.id });
        return (
          <section
            key={v.id}
            className={`view${isPrimary ? " primary" : ""}${thumb ? " thumb" : ""}${v.glow ? " ai-glow" : ""}`}
            tabIndex={thumb ? 0 : undefined}
            aria-label={thumb ? "Show this view large" : undefined}
            onClickCapture={(e) => {
              if (thumb && !(e.target as HTMLElement).closest("button, input, select, a")) {
                e.stopPropagation();
                enlarge();
              }
            }}
            onKeyDown={(e) => {
              if (thumb && e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                enlarge();
              }
            }}
          >
            <header
              className="view-head"
              onDoubleClick={(e) => {
                if (!(e.target as HTMLElement).closest("button, input, select")) dispatch({ type: "max", id: v.id });
              }}
            >
              <span className={`view-badge ${v.badgeClass ?? ""}`}>{v.badge}</span>
              <span className="view-title">{v.title}</span>
              <span className="view-caption">{v.caption}</span>
              <span className="view-actions">
                {v.actions}
                {v.onResetView && (
                  <button type="button" className="icon-btn view-reset" title="Reset zoom (double-click the slice)" aria-label="Reset zoom" onClick={v.onResetView}>
                    {ICONS.reset}
                  </button>
                )}
                <button
                  type="button"
                  className="icon-btn layout-btn"
                  title={focusBack ? "Back to all views" : "Show this view large"}
                  aria-label={focusBack ? "Back to all views" : "Show this view large"}
                  onClick={() => dispatch({ type: "focus", id: v.id })}
                >
                  {focusBack ? ICONS.grid : ICONS.focus}
                </button>
                <button
                  type="button"
                  className="icon-btn layout-btn"
                  title={restore ? "Restore the layout (Esc)" : "Maximize this view (double-click the header)"}
                  aria-label={restore ? "Restore the layout" : "Maximize this view"}
                  onClick={() => dispatch({ type: "max", id: v.id })}
                >
                  {restore ? ICONS.restore : ICONS.max}
                </button>
              </span>
            </header>
            <div className="view-body">
              <div className="view-fill">{v.children}</div>
            </div>
            {v.footer && <footer className="view-foot">{v.footer}</footer>}
          </section>
        );
      })}
    </div>
  );
}
