// What the gesture card (GestureHint.tsx) says: one row per action, each with
// the ways to do it, drawn as key caps and pointer glyphs.  Every way here is
// one ViewFrame.tsx handles — keep the two in step:
//   zoom   — Ctrl/⌘ + wheel or a pinch (onWheel, Safari's GestureEvents, two
//            touch pointers); + / − on a focused view (onKeyDown) and its buttons
//   move   — Shift + drag or a middle-button drag (onPointerDown's `pan`); the
//            arrow keys on a focused view; two touch pointers dragged together.
//            A Shift + click does nothing; a trackpad's two-finger scroll is a
//            wheel, which scrolls the page (or zooms, when it cannot scroll)
//   reset  — double-click (and double-tap on a touch screen), 0, Reset zoom
//   box    — the Box zoom button, then one drag; Esc or a second press puts it away
// Touch-only devices get the touch gestures; everything else the mouse,
// trackpad and keyboard ones, with ⌘ on Apple platforms and Ctrl elsewhere.

export type Glyph =
  | "scroll"
  | "pinch"
  | "drag"
  | "middle-drag"
  | "double-click"
  | "two-finger"
  | "double-tap"
  | "reset";

export type Token =
  | { t: "key"; k: string; name?: string } // a key cap; `name` is read out when `k` is a symbol
  | { t: "button"; label: string } // an on-screen button, drawn like one
  | { t: "glyph"; g: Glyph; text: string } // a pointer gesture: its glyph and words
  | { t: "text"; text: string };

/** One way to do an action, e.g. [⌘] + scroll. */
export type Way = Token[];

export type ActionId = "zoom" | "move" | "reset" | "box";

export interface GestureRow {
  id: ActionId;
  name: string;
  ways: Way[];
}

export interface GestureCard {
  rows: GestureRow[];
  note?: string; // one line under the rows
}

/** Apple platforms, whose modifier is ⌘ (iPadOS reports "MacIntel"). */
export function isMacLike(platform: string, userAgent = ""): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform || userAgent);
}

/** A touch screen with no hover: no mouse or trackpad to point with. */
export function isTouchOnly(matches: (query: string) => boolean): boolean {
  return matches("(pointer: coarse)") && matches("(hover: none)");
}

const key = (k: string, name?: string): Token => ({ t: "key", k, name });
const glyph = (g: Glyph, text: string): Token => ({ t: "glyph", g, text });
const text = (t: string): Token => ({ t: "text", text: t });
const button = (label: string): Token => ({ t: "button", label });

/** The modifier key cap: ⌘ on Apple platforms, Ctrl elsewhere. */
export const modKey = (mac: boolean): Token => (mac ? key("⌘", "Command") : key("Ctrl"));

/** The card for this device. */
export function gestureCard({ mac, touch }: { mac: boolean; touch: boolean }): GestureCard {
  if (touch) {
    return {
      rows: [
        { id: "zoom", name: "Zoom", ways: [[glyph("pinch", "pinch")], [button("+"), button("−")]] },
        { id: "move", name: "Move", ways: [[glyph("two-finger", "two-finger drag")]] },
        { id: "reset", name: "Reset", ways: [[glyph("double-tap", "double-tap")], [button("↺ Reset zoom")]] },
        { id: "box", name: "Box zoom", ways: [[button("Box zoom"), text("then"), glyph("drag", "drag a box")], [text("tap it again to cancel")]] },
      ],
    };
  }
  return {
    rows: [
      { id: "zoom", name: "Zoom", ways: [[modKey(mac), text("+"), glyph("scroll", "scroll")], [glyph("pinch", "pinch")], [key("+"), key("−", "minus")]] },
      {
        id: "move",
        name: "Move",
        ways: [
          [key("⇧ Shift", "Shift"), text("+"), glyph("drag", "drag")],
          [glyph("middle-drag", "middle-drag")],
          [key("←", "Left"), key("↑", "Up"), key("↓", "Down"), key("→", "Right")],
        ],
      },
      { id: "reset", name: "Reset", ways: [[glyph("double-click", "double-click")], [key("0")], [button("↺ Reset zoom")]] },
      { id: "box", name: "Box zoom", ways: [[button("Box zoom"), text("then"), glyph("drag", "drag a box")], [key("Esc"), text("cancels")]] },
    ],
    note: "Keys act on the view you clicked last.",
  };
}

/** A way in words, for a screen reader or a test ("⌘ + scroll" → "Command + scroll"). */
export function wayText(way: Way): string {
  return way.map((tk) => (tk.t === "key" ? tk.name ?? tk.k : tk.t === "button" ? tk.label : tk.text)).join(" ");
}
