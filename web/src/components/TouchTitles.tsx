// The tap path to every `title` tooltip on a touch-only screen (a phone or
// tablet), where a tooltip never shows: press and hold a control, or focus a
// field, and its title opens as a small card beside it, like the memory bar's
// "?" card (memoryView.ts placeCard). A held press shows the card instead of
// acting: the click that follows it is swallowed. A tap elsewhere, a scroll,
// Esc or the field losing focus closes it. Nothing on a device that hovers.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { zoom } from "./dockRoom";
import { placeCard } from "./memoryView";
import { showsTitleOnFocus, stillHolding, titledAncestor, titleText, LONG_PRESS_MS } from "./titleHint";
import { useTouchOnly } from "./usePlatform";

interface Shown {
  text: string;
  anchor: Element;
  host: Element;
  focus: boolean; // opened by a field's focus: it closes on blur
}

export function TouchTitles() {
  const touch = useTouchOnly();
  const [shown, setShown] = useState<Shown | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const swallowClick = useRef(false);

  const show = useCallback((anchor: Element, focus: boolean) => {
    const text = titleText(anchor);
    if (!text) return;
    setPos(null);
    setShown({ text, anchor, host: anchor.closest(".app") ?? document.body, focus });
  }, []);
  const close = useCallback(() => setShown(null), []);

  useEffect(() => {
    if (!touch) return;
    // for scripts/responsive_audit.mjs: titles have a tap path here
    document.documentElement.dataset.touchTitles = "";
    let timer: number | undefined;
    let start: { x: number; y: number } | null = null;
    const cancel = () => {
      clearTimeout(timer);
      start = null;
    };
    const onDown = (e: PointerEvent) => {
      if (card.current?.contains(e.target as Node)) return;
      setShown((s) => (s && !s.focus ? null : s));
      cancel();
      if (e.pointerType === "mouse" || !e.isPrimary) return;
      const target = titledAncestor(e.target as Element | null);
      if (!target) return;
      start = { x: e.clientX, y: e.clientY };
      timer = window.setTimeout(() => {
        start = null;
        swallowClick.current = true;
        show(target, false);
      }, LONG_PRESS_MS);
    };
    const onMove = (e: PointerEvent) => {
      if (start && !stillHolding(start, { x: e.clientX, y: e.clientY })) cancel();
    };
    // the click a held press ends with: the card was the answer, not an action
    const onClick = (e: MouseEvent) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    };
    const onContext = (e: Event) => {
      if (swallowClick.current) e.preventDefault();
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target as Element | null;
      if (showsTitleOnFocus(el) && el) show(el, true);
    };
    const onFocusOut = () => setShown((s) => (s?.focus ? null : s));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onScroll = (e: Event) => {
      if (!card.current?.contains(e.target as Node)) setShown((s) => (s && !s.focus ? null : s));
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", cancel, true);
    document.addEventListener("pointercancel", cancel, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("contextmenu", onContext, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      cancel();
      delete document.documentElement.dataset.touchTitles;
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", cancel, true);
      document.removeEventListener("pointercancel", cancel, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("contextmenu", onContext, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [touch, show, close]);

  // a held press whose finger lifted with no click (it moved onto the card,
  // say) must not swallow the next real tap
  useEffect(() => {
    if (!shown) return;
    const t = window.setTimeout(() => (swallowClick.current = false), 1200);
    return () => clearTimeout(t);
  }, [shown]);

  useLayoutEffect(() => {
    if (!shown || !card.current) return;
    const r = card.current.getBoundingClientRect();
    const z = zoom();
    setPos(placeCard(shown.anchor.getBoundingClientRect(), { width: r.width, height: r.height }, { width: window.innerWidth, height: window.innerHeight }, z));
  }, [shown]);

  if (!touch || !shown) return null;
  return createPortal(
    <div
      ref={card}
      className="gh-card touch-title"
      role="tooltip"
      style={{ position: "fixed", left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
    >
      {shown.text}
    </div>,
    shown.host,
  );
}
