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

/** Shapes whose outline is open strokes: nothing to fill, and nothing they enclose. */
export function isOpenShape(shape: Shape): boolean {
  return shape === "plus" || shape === "cross";
}

/**
 * The disc behind a filled plus or cross, as a multiple of the glyph's radius:
 * the strokes hold no fill, so the fill is a disc they are drawn on, a little
 * wider than their reach so it shows between the arms.
 */
export const OPEN_DISC = 1.27;

// How far a shape of radius 1 reaches from its centre (out), and the largest
// circle that fits inside it (in): what one glyph needs to sit inside another.
// An open shape reaches as far as the disc it may be drawn on.
const REACH: Record<Shape, { in: number; out: number }> = {
  circle: { in: 1, out: 1 },
  square: { in: 0.85, out: 0.85 * Math.SQRT2 },
  diamond: { in: 1.15 / Math.SQRT2, out: 1.15 },
  triangle: { in: 0.57, out: Math.hypot(1, 0.6) },
  invtriangle: { in: 0.57, out: Math.hypot(1, 0.6) },
  hexagon: { in: Math.sqrt(3) / 2, out: 1 },
  plus: { in: 1, out: OPEN_DISC },
  cross: { in: 1, out: OPEN_DISC },
};

/** Radius (px) of a lone glyph that carries a fill, and the step from one nested glyph to the next. */
export const NEST_RADIUS = 5.5;
export const NEST_STEP = 5;
const NEST_CLEAR = 3.4; // least gap (px) between two outlines of different shapes

/**
 * Radii (px) of glyphs drawn around one point, innermost first: each a step
 * larger than the one inside it, or more where its shape needs it to clear the
 * inner one (a triangle around a circle).
 */
export function nestRadii(shapes: readonly Shape[]): number[] {
  const out: number[] = [];
  shapes.forEach((shape, i) => {
    if (i === 0) {
      out.push(NEST_RADIUS);
      return;
    }
    const inner = shapes[i - 1], r = out[i - 1];
    const fit = inner === shape ? 0 : (r * REACH[inner].out + NEST_CLEAR) / REACH[shape].in;
    out.push(Math.round(Math.max(r + NEST_STEP, fit) * 100) / 100);
  });
  return out;
}
