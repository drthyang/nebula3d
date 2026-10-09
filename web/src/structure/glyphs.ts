// How an element pair is drawn: the colour names one element of the pair and
// the shape the other, so the pair never rests on colour alone and a structure
// with n elements needs only n colours.  For the pair A–B (A no later than B in
// site order) the stroke takes A's colour and the outline B's shape.
//
// The four colours are steps of the console's categorical palette chosen for
// markers that sit side by side (every pair, not only neighbours, must differ):
// they clear the normal-vision floor on the dark surface, and the shapes carry
// identity where colour-vision deficiency brings two of them close.  A fifth or
// later element is gray.

export type Shape = "circle" | "square" | "diamond" | "triangle" | "invtriangle" | "hexagon" | "plus" | "cross";

export const PAIR_COLORS = ["#3987e5", "#c98500", "#d55181", "#008300"] as const;
export const OTHER_COLOR = "#8a919c";
export const SHAPES: readonly Shape[] = ["circle", "square", "diamond", "triangle", "invtriangle", "hexagon", "plus", "cross"];

export interface Glyph {
  color: string;
  shape: Shape;
}

/** The glyph of an element pair key "A–B", given the elements in site order. */
export function pairGlyph(key: string, elements: string[]): Glyph {
  const [a, b] = key.split("–");
  const ia = elements.indexOf(a), ib = elements.indexOf(b);
  return {
    color: ia >= 0 && ia < PAIR_COLORS.length ? PAIR_COLORS[ia] : OTHER_COLOR,
    shape: SHAPES[ib >= 0 ? ib % SHAPES.length : 0],
  };
}

/** SVG path of a shape of radius r centred on (x, y). */
export function shapePath(shape: Shape, x: number, y: number, r: number): string {
  const poly = (pts: [number, number][]) => `M${pts.map(([px, py]) => `${(x + px).toFixed(1)},${(y + py).toFixed(1)}`).join("L")}Z`;
  switch (shape) {
    case "circle":
      return `M${(x - r).toFixed(1)},${y.toFixed(1)}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0Z`;
    case "square": {
      const s = r * 0.85;
      return poly([[-s, -s], [s, -s], [s, s], [-s, s]]);
    }
    case "diamond":
      return poly([[0, -r * 1.15], [r * 1.15, 0], [0, r * 1.15], [-r * 1.15, 0]]);
    case "triangle":
      return poly([[0, -r * 1.15], [r, r * 0.6], [-r, r * 0.6]]);
    case "invtriangle":
      return poly([[0, r * 1.15], [r, -r * 0.6], [-r, -r * 0.6]]);
    case "hexagon":
      return poly(Array.from({ length: 6 }, (_, k) => [r * Math.cos((k * Math.PI) / 3), r * Math.sin((k * Math.PI) / 3)] as [number, number]));
    case "plus":
      return `M${(x - r).toFixed(1)},${y.toFixed(1)}H${(x + r).toFixed(1)}M${x.toFixed(1)},${(y - r).toFixed(1)}V${(y + r).toFixed(1)}`;
    case "cross": {
      const s = r * 0.8;
      return `M${(x - s).toFixed(1)},${(y - s).toFixed(1)}L${(x + s).toFixed(1)},${(y + s).toFixed(1)}M${(x - s).toFixed(1)},${(y + s).toFixed(1)}L${(x + s).toFixed(1)},${(y - s).toFixed(1)}`;
    }
  }
}
