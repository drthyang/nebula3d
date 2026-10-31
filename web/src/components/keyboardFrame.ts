// The on-screen keyboard on a phone or tablet. iOS Safari (and Chrome on
// Android, by default) leaves the layout viewport alone when the keyboard
// opens: only the visual viewport shrinks, and the browser pans it to show the
// focused field. The app shell is one screen tall (100dvh), so its bottom, with
// NEBULA Pilot's composer, would sit under the keyboard. While a field is
// being edited and the keyboard covers part of the screen, useKeyboardFrame
// sizes the shell to the visual viewport instead: `html.kb-open`, with
// --kb-vh (its height) and --kb-top (how far it is panned), read by index.css.

/** What the browser reports about the viewports and the focused element. */
export interface ViewportReading {
  layoutHeight: number; // window.innerHeight
  height: number; // visualViewport.height
  offsetTop: number; // visualViewport.offsetTop
  scale: number; // visualViewport.scale (pinch zoom)
  editing: boolean; // a text field has focus
}

/** The part of the layout viewport left visible above the keyboard (CSS px). */
export interface KeyboardFrame {
  height: number;
  top: number;
}

/** Less than this shortfall is a browser toolbar, not a keyboard (px). */
export const KEYBOARD_MIN = 120;

/** The frame the shell should take, or null when no keyboard is up. */
export function keyboardFrame(r: ViewportReading): KeyboardFrame | null {
  if (!r.editing) return null;
  // a pinch zoom shrinks the visual viewport too; it is not a keyboard
  if (Math.abs(r.scale - 1) > 0.01) return null;
  if (r.layoutHeight - r.height < KEYBOARD_MIN) return null;
  return { height: Math.round(r.height), top: Math.max(0, Math.round(r.offsetTop)) };
}

const TEXT_INPUTS = new Set(["", "text", "search", "email", "url", "tel", "password", "number", "date", "time", "datetime-local", "month", "week"]);

/** Whether focusing this element brings up the on-screen keyboard. */
export function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return !(el as HTMLTextAreaElement).readOnly;
  if (tag === "INPUT") {
    const input = el as HTMLInputElement;
    return TEXT_INPUTS.has((input.getAttribute("type") ?? "").toLowerCase()) && !input.readOnly;
  }
  return (el as HTMLElement).isContentEditable === true;
}
