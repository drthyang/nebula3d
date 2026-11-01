// What TouchTitles.tsx shows on a touch screen, where a `title` tooltip never
// appears: the title of the control a finger presses and holds, or of the
// field that takes focus. Pure, so the rules are testable without a DOM.

/** A press held this long shows the title (ms), as a long press does on Android. */
export const LONG_PRESS_MS = 500;

/** A finger that moves farther than this is scrolling, not holding (px). */
export const MOVE_TOLERANCE = 10;

/** The few bits of an element the lookup reads. */
export interface TitledNode {
  getAttribute(name: string): string | null;
  parentElement: TitledNode | null;
  tagName: string;
}

/**
 * The element whose title a press on `start` shows: itself or its nearest
 * ancestor with a title, short of the page's root, or null. An empty title
 * (one cleared to hide the native tooltip) does not count.
 */
export function titledAncestor<T extends TitledNode>(start: T | null): T | null {
  for (let el: TitledNode | null = start; el && el.tagName !== "BODY" && el.tagName !== "HTML"; el = el.parentElement) {
    if ((el.getAttribute("title") ?? "").trim()) return el as T;
  }
  return null;
}

/** The title text, its whitespace tidied. */
export const titleText = (el: TitledNode): string => (el.getAttribute("title") ?? "").replace(/\s+/g, " ").trim();

/** Fields whose focus shows their title (the keyboard or a picker hides little else). */
export function showsTitleOnFocus(el: TitledNode | null): boolean {
  if (!el) return false;
  if (!/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return false;
  const type = (el.getAttribute("type") ?? "").toLowerCase();
  return !["checkbox", "radio", "range", "file", "hidden", "button", "submit"].includes(type);
}

/** Whether a finger that went down at `a` and is now at `b` still holds. */
export const stillHolding = (a: { x: number; y: number }, b: { x: number; y: number }): boolean =>
  Math.hypot(b.x - a.x, b.y - a.y) <= MOVE_TOLERANCE;
