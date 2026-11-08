// Where a highlight's chip or label may sit on a slice view (HighlightLayer):
// inside the view, off its axis labels and ticks, and clear of the view's own
// controls, the zoom buttons and the field-of-view readout (ViewFrame's
// .vf-zoom and .vf-fov), measured where they are drawn, so a chip never sits
// under them at any width (at 390 px the zoom buttons are larger and lower).

/** A rectangle in the layer's pixels. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A chip's half height (HighlightLayer draws chips 14 px tall, labels 13). */
const HALF_H = 7;
/** Room kept round a control. */
const PAD = 4;

/**
 * The view's controls as boxes in the layer's pixels (the layer is `w` pixels
 * wide in its own units), padded; null where the layer sits in no view frame,
 * and the fallback rule (the top-right corner) applies. Controls not shown
 * (no size) are left out.
 */
export function controlBoxes(layer: Element, w: number): Box[] | null {
  const frame = layer.closest(".vf");
  if (!frame) return null;
  const base = layer.getBoundingClientRect();
  const k = base.width > 0 ? w / base.width : 1;
  const out: Box[] = [];
  for (const el of Array.from(frame.querySelectorAll(":scope > .vf-zoom, :scope > .vf-fov"))) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    out.push({ x0: (r.left - base.left) * k - PAD, y0: (r.top - base.top) * k - PAD, x1: (r.right - base.left) * k + PAD, y1: (r.bottom - base.top) * k + PAD });
  }
  return out;
}

/** Whether two lists of boxes are the same (to keep a layout's state when nothing moved). */
export const sameBoxes = (a: readonly Box[] | null, b: readonly Box[] | null): boolean =>
  a === b ||
  (!!a && !!b && a.length === b.length && a.every((x, i) => Math.abs(x.x0 - b[i].x0) < 0.5 && Math.abs(x.y0 - b[i].y0) < 0.5 && Math.abs(x.x1 - b[i].x1) < 0.5 && Math.abs(x.y1 - b[i].y1) < 0.5));

/**
 * Whether a chip `cw` wide centred at (x, y) sits clear: inside the view, off
 * its edge labels and ticks (30 px in, 34 at the bottom), and off every
 * control box; with no boxes measured (null), off the top-right corner where
 * the readout and the zoom buttons sit on a desktop view.
 */
export function chipClear(x: number, y: number, cw: number, view: { w: number; h: number; avoid: readonly Box[] | null }): boolean {
  const { w, h, avoid } = view;
  if (!(x > 30 && x < w - 30 && y > 30 && y < h - 34)) return false;
  if (!avoid) return !(x > w - 110 && y < 100);
  const half = cw / 2;
  return avoid.every((b) => x + half <= b.x0 || x - half >= b.x1 || y + HALF_H <= b.y0 || y - HALF_H >= b.y1);
}
