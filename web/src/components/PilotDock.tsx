// NEBULA Pilot's place beside the page (state/dockLayout.ts).  With room
// beside the page it is a docked column the page reflows beside: drag its
// left edge to resize it, or collapse it to a slim rail.  On a portrait tablet
// or a phone it is a bottom sheet under the page: drag its handle to resize
// it, or collapse it to a slim bar.  Both sizes are remembered.  With Follow
// on, the figure the Pilot is working on is scrolled fully into view beside it.
// Its mode and size reach the app's grid through useDockLayout.ts.

import { useEffect, type KeyboardEvent, type PointerEvent } from "react";

import { AssistantPanel } from "../llm";
import { useHighlightStore } from "../llm/highlight";
import { loadSettings } from "../llm/settings";
import { clampDockWidth, defaultDockWidth, type DockMode } from "../state/dockLayout";
import { useNavStore } from "../state/navStore";
import { BrandGlyph } from "./ui";

/** With Follow on, scrolls the card the Pilot lights up into view in the page. */
function useFollowGlow(): void {
  useEffect(() => {
    let last = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      const keys = useHighlightStore.getState().keys;
      const { tab, dockOpen } = useNavStore.getState();
      const sig = `${tab}|${keys.join(",")}`;
      if (sig === last) return;
      last = sig;
      if (!keys.length || !dockOpen || !loadSettings().followViews) return;
      clearTimeout(timer);
      // After the page (or the glow) has rendered.
      timer = setTimeout(() => {
        const el = document.querySelector<HTMLElement>(".main .ai-glow, .main .ai-glow-within");
        const main = document.querySelector<HTMLElement>(".main");
        if (!el || !main) return;
        // A bottom sheet lowers (not below its minimum, and only for now) until
        // the figure fits above it: on a phone a square slice is taller than
        // what a half-height sheet leaves of the page.
        const sheet = document.querySelector(".app.dock-sheet") ? document.querySelector<HTMLElement>(".ai-side") : null;
        const short = el.getBoundingClientRect().height - main.clientHeight + 12;
        if (sheet && short > 0) {
          const fraction = (sheet.getBoundingClientRect().height - short) / window.innerHeight;
          useNavStore.getState().setSheet(fraction);
        }
        const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        requestAnimationFrame(() =>
          el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: still ? "auto" : "smooth" }),
        );
      }, 260);
    };
    const unsubs = [useHighlightStore.subscribe(run), useNavStore.subscribe(run)];
    return () => {
      unsubs.forEach((u) => u());
      clearTimeout(timer);
    };
  }, []);
}

const zoom = (): number =>
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ui-zoom")) || 1;

export function PilotDock({ mode, open }: { mode: DockMode; open: boolean }) {
  const setOpen = useNavStore((s) => s.setDockOpen);
  useFollowGlow();

  if (!open) {
    return mode === "docked" ? (
      <aside className="ai-rail" aria-label="NEBULA Pilot">
        <button type="button" onClick={() => setOpen(true)} title="Open NEBULA Pilot beside this page">
          <BrandGlyph size={18} />
          <span className="ai-rail-label">NEBULA Pilot</span>
        </button>
      </aside>
    ) : (
      <aside className="ai-sheetbar" aria-label="NEBULA Pilot">
        <button type="button" onClick={() => setOpen(true)} title="Open NEBULA Pilot under this page">
          <BrandGlyph size={16} />
          <span>NEBULA Pilot</span>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 9l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </aside>
    );
  }

  return (
    <aside className="ai-side" data-mode={mode} aria-label="NEBULA Pilot">
      {mode === "docked" ? <WidthHandle /> : <SheetHandle />}
      <AssistantPanel mode={mode} onCollapse={() => setOpen(false)} />
    </aside>
  );
}

/** The docked panel's left edge: drag (or arrow keys) to resize it. */
function WidthHandle() {
  const setWidth = useNavStore((s) => s.setDockWidth);
  const current = () => {
    const { dockWidth } = useNavStore.getState();
    return clampDockWidth(dockWidth ?? defaultDockWidth(window.innerWidth), window.innerWidth);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const w0 = current();
    const z = zoom();
    const width = (ev: globalThis.PointerEvent) => clampDockWidth(w0 + (x0 - ev.clientX) / z, window.innerWidth);
    const move = (ev: globalThis.PointerEvent) => setWidth(width(ev));
    const up = (ev: globalThis.PointerEvent) => {
      setWidth(width(ev), true);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      document.body.classList.remove("ai-resizing");
    };
    document.body.classList.add("ai-resizing");
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === "ArrowLeft") setWidth(clampDockWidth(current() + step, window.innerWidth), true);
    else if (e.key === "ArrowRight") setWidth(clampDockWidth(current() - step, window.innerWidth), true);
    else return;
    e.preventDefault();
  };
  return (
    <div
      className="ai-resize-x"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize NEBULA Pilot"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => setWidth(defaultDockWidth(window.innerWidth), true)}
      title="Drag to resize; double-click for the default width"
    />
  );
}

/** The bottom sheet's handle: drag (or arrow keys) to resize it. */
function SheetHandle() {
  const setSheet = useNavStore((s) => s.setSheet);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const y0 = e.clientY;
    const f0 = useNavStore.getState().sheet;
    const z = zoom();
    const fraction = (ev: globalThis.PointerEvent) => f0 + (y0 - ev.clientY) / z / window.innerHeight;
    const move = (ev: globalThis.PointerEvent) => setSheet(fraction(ev));
    const up = (ev: globalThis.PointerEvent) => {
      setSheet(fraction(ev), true);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      document.body.classList.remove("ai-resizing");
    };
    document.body.classList.add("ai-resizing");
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.04;
    const f = useNavStore.getState().sheet;
    if (e.key === "ArrowUp") setSheet(f + step, true);
    else if (e.key === "ArrowDown") setSheet(f - step, true);
    else return;
    e.preventDefault();
  };
  return (
    <div
      className="ai-resize-y"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize NEBULA Pilot"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      title="Drag to resize"
    >
      <span aria-hidden="true" />
    </div>
  );
}
