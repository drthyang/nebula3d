// The Pilot panel's height as the short-panel rules read it (index.css,
// `.ai-panel[data-short~=…]`): the limits each rule applies at or under, as
// space-separated tokens on the panel ("559 400" for a 380 px panel).
//
// These were container queries on the panel (`container: pilot / size`), but
// a size container there sent Chromium into a layout loop while the page sat
// idle after an auto run (hundreds of layouts a second, the renderer's memory
// growing by gigabytes; scripts/pilot_memory_check.mjs checks the idle layout
// rate). The panel's height does not depend on what it holds (it fills its
// dock, its overflow hidden), so measuring it and setting an attribute
// cannot feed back on itself.

import { useLayoutEffect, type RefObject } from "react";

/** The limits (px) the short-panel rules apply at or under, largest first. */
export const SHORT_LIMITS = [559, 400, 250] as const;

/** The data-short tokens for a panel `height` px tall: each limit it is at or under. */
export function shortTokens(height: number): string {
  return SHORT_LIMITS.filter((limit) => height <= limit).join(" ");
}

/** Keeps the panel's data-short attribute in step with its height. */
export function usePanelShort(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = (height: number) => {
      const tokens = shortTokens(height);
      if (tokens) {
        if (el.dataset.short !== tokens) el.dataset.short = tokens;
      } else if (el.dataset.short !== undefined) delete el.dataset.short;
    };
    set(el.getBoundingClientRect().height);
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) set(e.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
}
