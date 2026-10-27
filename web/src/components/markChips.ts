// Where each region mark's chip goes in a view (RegionMarks.tsx): above its
// outline, else below it; clear of the view's own controls in the top-right
// corner (the field-of-view chip, the zoom buttons) and of the chips placed
// before it; inside the view; its text cut short with an ellipsis where the
// row has no room for it whole. A mark out of view gets no chip.

/** A display rectangle in view pixels. */
export interface PixelBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** A chip to place: its mark, its whole text, and the box of what shows of the mark (null: nothing). */
export interface ChipInput {
  id: string;
  text: string;
  box: PixelBox | null;
}

export interface Chip {
  id: string;
  x: number;
  y: number;
  w: number;
  text: string;
}

export const CHIP = { h: 16, ch: 6.5, pad: 4, gap: 2 }; // height, px per character (10.5 px semibold monospace), margins
// The corner ViewFrame's controls take, from the top right (.vf-fov, .vf-zoom).
export const CONTROLS = { chipW: 88, chipH: 28, buttonsW: 34, buttonsH: 80 };

/** How far right a chip whose top is at `y` may reach in a `w`-px view: clear of the controls. */
export const rightEdge = (y: number, w: number): number =>
  y < CONTROLS.chipH ? w - CONTROLS.chipW : y < CONTROLS.buttonsH ? w - CONTROLS.buttonsW : w;

/** `text` cut to `room` px, with an ellipsis; never shorter than the mark's id. */
function fitText(text: string, id: string, room: number): string {
  const chars = Math.floor((room - 10) / CHIP.ch);
  if (text.length <= chars) return text;
  return chars > id.length + 1 ? `${text.slice(0, chars - 1)}…` : id;
}

const overlaps = (a: Chip, b: Chip): boolean =>
  a.x < b.x + b.w + CHIP.gap && b.x < a.x + a.w + CHIP.gap && a.y < b.y + CHIP.h + CHIP.gap && b.y < a.y + CHIP.h + CHIP.gap;

/** The chips of a `w`×`h`-px view, in the order given (the first placed has first pick). */
export function placeChips(inputs: readonly ChipInput[], w: number, h: number): Chip[] {
  const { h: H, pad } = CHIP;
  const fitY = (y: number) => Math.min(h - H - pad, Math.max(pad, y));
  const placed: Chip[] = [];
  for (const c of inputs) {
    const b = c.box;
    if (!b || b.x1 < 0 || b.x0 > w || b.y1 < 0 || b.y0 > h) continue;
    const above = b.y0 - H - 3;
    const below = b.y1 + 3;
    const first = above >= pad ? above : below;
    // Above (or below), the other side, then rows stepping away from the first.
    const rows = [first, first === above ? below : above];
    for (let k = 1; k <= 6; k++) rows.push(first + k * (H + CHIP.gap), first - k * (H + CHIP.gap));
    let chosen: Chip | null = null;
    let fallback: Chip | null = null;
    for (const row of rows) {
      const y = fitY(row);
      const edge = rightEdge(y, w);
      const text = fitText(c.text, c.id, edge - 2 * pad);
      const cw = text.length * CHIP.ch + 10;
      const x = Math.max(pad, Math.min(b.x0, edge - cw));
      const chip = { id: c.id, x, y, w: cw, text };
      fallback ??= chip;
      if (!placed.some((p) => overlaps(p, chip))) {
        chosen = chip;
        break;
      }
    }
    placed.push(chosen ?? fallback!);
  }
  return placed;
}
