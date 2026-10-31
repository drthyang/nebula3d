// The console's memory bar, in the sidebar's foot beside the API status (and
// in the page's foot in the compact top-bar layout). What it measures, per
// build, is in memoryView.ts; it renders nothing until there is a measurement.
//
// Updates: the in-browser engine's workers push their heaps when they grow
// (workers/heapReport.ts), so nothing polls; the native server is asked every
// 15 s, every 3 s while a run goes, and after each stage a run finishes.

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { fetchServerMemory } from "../api/client";
import { getEngineMemory, subscribeEngineMemory, type EngineMemory } from "../api/engineMemory";
import { PYODIDE_MODE } from "../api/pyodideEngine";
import type { JobEvent } from "../api/types";
import { usePipelineStore } from "../state/pipelineStore";
import { engineMemoryView, placeCard, serverMemoryView, type MemoryView } from "./memoryView";

const IDLE_MS = 15_000;
const RUNNING_MS = 3_000;

const stageEnds = (events: JobEvent[]): number =>
  events.reduce((n, ev) => n + (ev.stage && (ev.status === "done" || ev.status === "skip") ? 1 : 0), 0);

function useEngineMemory(): EngineMemory {
  const [m, setM] = useState<EngineMemory>(getEngineMemory);
  useEffect(() => subscribeEngineMemory(setM), []);
  return m;
}

function useServerMemory() {
  const running = usePipelineStore((s) => s.running);
  const ended = usePipelineStore((s) => stageEnds(s.events));
  const q = useQuery({
    queryKey: ["memory"],
    queryFn: fetchServerMemory,
    refetchInterval: running ? RUNNING_MS : IDLE_MS,
    retry: false,
  });
  const { refetch } = q;
  useEffect(() => {
    if (ended > 0) void refetch({ cancelRefetch: false }); // both foots share one request
  }, [ended, refetch]);
  return q.isError ? undefined : q.data; // an unreachable server: no stale bar
}

// The "?" beside the bar: the explanation the title tooltip gives, as a card
// for touch screens (where a title never shows) and for the keyboard. It
// follows the gesture card's pattern (GestureHint.tsx) and wears its look: a
// click or tap on the "?" (Enter or Space when it has focus) opens it and moves
// focus into it; Esc, a press outside it, the ×, focus leaving it, or a scroll
// or resize closes it; Esc and × hand focus back to the "?". The card is fixed
// and portalled into the console's root, out of the sidebar's and the page's
// scrolling boxes that would clip it, above the "?" when it fits (placeCard).
function MemoryHelp({ view }: { view: MemoryView }) {
  const [host, setHost] = useState<Element | null>(null); // where the open card is portalled
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const open = host !== null;

  const close = useCallback((refocus: boolean) => {
    setHost(null);
    setPos(null);
    if (refocus) trigger.current?.focus();
  }, []);
  const show = () => setHost(trigger.current?.closest(".app") ?? document.body);

  // Placed once it has a size (hidden until then), and again when what it says
  // changes size (a heap report while it is open: a ring worker's line).
  useLayoutEffect(() => {
    if (!open || !trigger.current || !card.current) return;
    const app = trigger.current.closest(".app");
    const zoom = app ? Number.parseFloat(getComputedStyle(app).zoom) || 1 : 1;
    const size = card.current.getBoundingClientRect();
    const viewport = { width: document.documentElement.clientWidth, height: window.innerHeight };
    const at = placeCard(trigger.current.getBoundingClientRect(), size, viewport, zoom);
    setPos((p) => (p && p.left === at.left && p.top === at.top ? p : { left: at.left, top: at.top }));
  }, [open, view.tooltip]);

  // Placed the first time: focus moves into the card (not again on a re-place,
  // which would take it off the × under a keyboard).
  const placed = pos !== null;
  useEffect(() => {
    if (placed) card.current?.focus({ preventScroll: true });
  }, [placed]);

  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) =>
      t instanceof Node && (trigger.current?.contains(t) || card.current?.contains(t));
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close(true);
    };
    const onDown = (e: PointerEvent) => {
      if (!inside(e.target)) close(false);
    };
    // The card stays where it was placed: a scroll or a resize would leave it
    // beside nothing.
    const onMove = (e: Event) => {
      if (!inside(e.target)) close(false);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, close]);

  const body = view.lines.slice(0, -1);
  const last = view.lines[view.lines.length - 1];
  return (
    <span
      className="mem-help-wrap"
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        if (open && next && !trigger.current?.contains(next) && !card.current?.contains(next)) close(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="gh-trigger mem-help"
        aria-label="What this bar measures"
        title="What this bar measures"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close(true) : show())}
      >
        ?
      </button>
      {host &&
        createPortal(
          <div
            className="mem-pop"
            style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: "hidden" }}
          >
            <div ref={card} id={id} className="gh-card mem-card" role="dialog" aria-modal="false" aria-labelledby={titleId} tabIndex={-1}>
              <div className="gh-head">
                <span id={titleId} className="gh-title">
                  {view.title}
                </span>
                <span className="gh-sub">
                  {view.amount} · {view.percentText}
                </span>
                <button type="button" className="gh-close" aria-label="Close" onClick={() => close(true)}>
                  ×
                </button>
              </div>
              {body.map((line) => (
                <p key={line} className="mem-card-line">
                  {line}
                </p>
              ))}
              {last && <p className="gh-note">{last}</p>}
            </div>
          </div>,
          host,
        )}
    </span>
  );
}

function MemoryMeter({ view }: { view: MemoryView }) {
  return (
    <div className={`mem mem--${view.level}`} title={view.tooltip}>
      <div className="mem-head">
        <span className="mem-label">
          <span className="mem-title">{view.title}</span>
          <MemoryHelp view={view} />
        </span>
        <span className="mem-pct">{view.percentText}</span>
      </div>
      <div
        className="mem-track"
        role="meter"
        aria-label={view.title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, view.percent)}
        aria-valuetext={`${view.amount} (${view.percentText}), ${view.note}`}
      >
        <div className="mem-fill" style={{ width: `${view.fraction * 100}%` }} />
      </div>
      <div className="mem-foot">
        <span className="mem-amount">{view.amount}</span>
        <span className="mem-note">{view.note}</span>
      </div>
    </div>
  );
}

function EngineMemoryBar() {
  const view = engineMemoryView(useEngineMemory());
  return view ? <MemoryMeter view={view} /> : null;
}

function ServerMemoryBar() {
  const data = useServerMemory();
  const view = data ? serverMemoryView(data) : null;
  return view ? <MemoryMeter view={view} /> : null;
}

export function MemoryBar() {
  return PYODIDE_MODE ? <EngineMemoryBar /> : <ServerMemoryBar />;
}
