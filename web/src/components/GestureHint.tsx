// The gesture card: the "?" beside the click modes opens a popover that shows
// how to zoom, move and reset a view (and use the Box zoom tool), one row per
// action, the ways drawn as key caps and pointer glyphs — the mouse, trackpad
// and keyboard ways with ⌘ or Ctrl, or the touch ones on a touch-only device
// (gestures.ts, which keeps the rows true to ViewFrame.tsx).
//
// A click or tap on the "?" (Enter or Space when it has focus) opens it and
// moves focus into it.  Esc, a click outside it, the ×, or focus leaving it
// closes it; Esc and × hand focus back to the "?".  It does not open on hover:
// in a header of controls a card that opens under a resting pointer covers
// the display bar.  Until it has been opened once in this browser the "?"
// carries a small dot (workspaceStore.ts); nothing opens by itself.

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { useWorkspaceStore } from "../state/workspaceStore";
import { gestureCard, type ActionId, type Glyph, type Token } from "./gestures";
import { Kbd } from "./Kbd";
import { IS_MAC, useTouchOnly } from "./usePlatform";
import { GESTURE_HINT_TITLE } from "./viewerText";

const svg = (body: ReactNode, size = 16) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {body}
  </svg>
);

const ACTION_ICONS: Record<ActionId, ReactNode> = {
  zoom: svg(
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.4 10.4 14 14M7 5v4M5 7h4" />
    </>,
  ),
  move: svg(<path d="M8 1.75v12.5M1.75 8h12.5M8 1.75 6.25 3.5M8 1.75 9.75 3.5M8 14.25 6.25 12.5M8 14.25l1.75-1.75M1.75 8 3.5 6.25M1.75 8 3.5 9.75M14.25 8 12.5 6.25M14.25 8 12.5 9.75" />),
  reset: svg(
    <>
      <path d="M2.75 8a5.25 5.25 0 1 0 1.6-3.8" />
      <path d="M2.5 2.5v3h3" />
    </>,
  ),
  box: svg(
    <>
      <rect x="2" y="2" width="12" height="12" rx="1.5" strokeDasharray="2.5 2" />
      <circle cx="8" cy="8" r="2.25" />
      <path d="m9.6 9.6 2 2" />
    </>,
  ),
};

const GLYPHS: Record<Glyph, ReactNode> = {
  // a mouse with its wheel
  scroll: svg(
    <>
      <rect x="4.5" y="1.75" width="7" height="12.5" rx="3.5" />
      <path d="M8 4.25v2.5" />
    </>,
    14,
  ),
  // two fingertips drawn together
  pinch: svg(
    <>
      <circle cx="4" cy="4" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <path d="m6.5 6.5 2 2M9.5 9.5l-1-1M8.5 6.5h-2v2M7.5 9.5h2v-2" />
    </>,
    14,
  ),
  // a pointer dragged
  drag: svg(
    <>
      <path d="M3 2.5v8l2.2-2 1.6 3.6 1.5-.7-1.6-3.5H9.7Z" />
      <path d="M11 11.5h3.5M12.8 9.8l1.7 1.7-1.7 1.7" />
    </>,
    14,
  ),
  // a mouse with its middle button pressed
  "middle-drag": svg(
    <>
      <rect x="4.5" y="1.75" width="7" height="12.5" rx="3.5" />
      <path d="M8 3.75v3.5" strokeWidth="2.6" />
    </>,
    14,
  ),
  // a pointer with two clicks
  "double-click": svg(
    <>
      <path d="M5 5.5v8l2.2-2 1.6 3.6 1.5-.7-1.6-3.5h2.4Z" />
      <path d="M3.2 3.2 2 2M6 2.4V.9M8.8 3.2 10 2" />
    </>,
    14,
  ),
  // two fingertips moved together
  "two-finger": svg(
    <>
      <circle cx="4" cy="5" r="1.6" />
      <circle cx="4" cy="11" r="1.6" />
      <path d="M7.5 8h6.5M12.3 6.3 14 8l-1.7 1.7" />
    </>,
    14,
  ),
  // a fingertip tapped twice
  "double-tap": svg(
    <>
      <circle cx="8" cy="8" r="1.8" />
      <circle cx="8" cy="8" r="4" opacity="0.7" />
      <circle cx="8" cy="8" r="6.3" opacity="0.4" />
    </>,
    14,
  ),
  reset: ACTION_ICONS.reset,
};

function TokenView({ token }: { token: Token }) {
  switch (token.t) {
    case "key":
      return <Kbd name={token.name}>{token.k}</Kbd>;
    case "button":
      return <span className="gh-btn">{token.label}</span>;
    case "glyph":
      return (
        <span className="gh-glyph">
          {GLYPHS[token.g]}
          <span>{token.text}</span>
        </span>
      );
    case "text":
      return <span className="gh-text">{token.text}</span>;
  }
}

export function GestureHint() {
  const seen = useWorkspaceStore((s) => s.gestureHintSeen);
  const markSeen = useWorkspaceStore((s) => s.markGestureHintSeen);
  const touch = useTouchOnly();
  const card = gestureCard({ mac: IS_MAC, touch });
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const wrap = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const isOpen = open;

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  // Opened once: the dot goes, for good.
  useEffect(() => {
    if (isOpen && !seen) markSeen();
  }, [isOpen, seen, markSeen]);

  // Keep the card inside the window: shift it left when the "?" sits near the right edge.
  useLayoutEffect(() => {
    if (!isOpen || !wrap.current || !panel.current) return;
    const left = wrap.current.getBoundingClientRect().left;
    const width = panel.current.offsetWidth;
    const vw = document.documentElement.clientWidth;
    setShift(Math.min(Math.max(8, left), vw - width - 8) - left);
  }, [isOpen]);

  // Esc closes it (before the views' and the layouts' own Esc); a press outside closes it.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close(true);
    };
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close(false);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [isOpen]);

  // Opened: focus moves into the card.
  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  return (
    <span
      ref={wrap}
      className="gh"
      onBlur={(e) => {
        if (open && !wrap.current?.contains(e.relatedTarget as Node | null)) close(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={`gh-trigger${seen ? "" : " gh-new"}`}
        aria-label={GESTURE_HINT_TITLE}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? id : undefined}
        onClick={() => (open ? close(true) : setOpen(true))}
      >
        ?
      </button>
      {isOpen && (
        <div className="gh-pop" style={{ left: shift }}>
          <div ref={panel} id={id} className="gh-card" role="dialog" aria-modal="false" aria-labelledby={titleId} tabIndex={-1}>
            <div className="gh-head">
              <span id={titleId} className="gh-title">
                Zoom, move, reset
              </span>
              <span className="gh-sub">{touch ? "on every view" : "in any mode, on every view"}</span>
              <button type="button" className="gh-close" aria-label="Close" onClick={() => close(true)}>
                ×
              </button>
            </div>
            <ul className="gh-rows">
              {card.rows.map((r) => (
                <li key={r.id} className="gh-row">
                  <span className="gh-icon">{ACTION_ICONS[r.id]}</span>
                  <span className="gh-name">{r.name}</span>
                  <span className="gh-ways">
                    {r.ways.map((w, i) => (
                      <span key={i} className="gh-way">
                        {w.map((t, j) => (
                          <TokenView key={j} token={t} />
                        ))}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
            {card.note && <p className="gh-note">{card.note}</p>}
          </div>
        </div>
      )}
    </span>
  );
}
