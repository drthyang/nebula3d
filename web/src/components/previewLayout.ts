// When the Configure preview shows its three planes side by side, and when in
// tabs: by the width the card gets (the window, less the sidebar and NEBULA
// Pilot's dock), not the window's.
//
// From 1100 px of card width each of the three views is about 350 px square
// or more (the card's 16 px padding and two 10 px gaps come off first): room
// for the footprints at the nodes of a ±10 r.l.u. plane to stay apart, some
// 17 px per node, before zooming. Measured with the dock folded to its rail, a
// 1440 px window gives a 1116 px card, so a 1440 or wider window (the 14″
// MacBook Pro's 1512: 1188 px) gets the three planes; a 1366 or 1280 px window
// (1066 and 980 px), or a 1440 one with the dock open, keeps the tabs, whose
// one view spans the card at 320–640 px tall and so shows the punch larger
// there than three thirds would.

import { useLayoutEffect, useState, type RefObject } from "react";

/** The card width (px) from which the three planes go side by side. */
export const SIDE_BY_SIDE_MIN_WIDTH = 1100;

/**
 * How far under the threshold a side-by-side card must shrink to fold back
 * into tabs, so a width that sways by a scrollbar's breadth about the
 * threshold does not flip the layout back and forth.
 */
export const SIDE_BY_SIDE_HYSTERESIS = 20;

/** Whether a card `width` px wide shows the planes side by side, given whether it does now. */
export function sideBySide(width: number, now: boolean): boolean {
  if (!(width > 0)) return now; // not laid out (hidden, or not measured yet)
  return width >= SIDE_BY_SIDE_MIN_WIDTH - (now ? SIDE_BY_SIDE_HYSTERESIS : 0);
}

/** Whether the element `ref` points at is wide enough for the side-by-side preview; follows its resizes. */
export function useSideBySide(ref: RefObject<HTMLElement | null>): boolean {
  const [wide, setWide] = useState(false);
  // Before paint, so a wide card never shows the tabs for a frame first.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWide((now) => sideBySide(el.getBoundingClientRect().width, now));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return wide;
}
