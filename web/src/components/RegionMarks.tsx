// The NEBULA Pilot's region marks over one slice view (state/markStore.ts):
// each mark's section by this view's cut (components/regionMark.ts) as an
// outline — a box's rectangle, an ellipsoid's ellipse, a ring per point — in
// the colour the view's colormap lacks (markColor), over a dark halo so it
// reads on any part of the image, with a chip naming the mark. On the
// cleanup page a mark is outlined, with its label, on the stage it was found
// in, and drawn thin and dashed, with its id alone, on the other stages: the
// same place, for comparison.
//
// Drawn in view pixels through the view's viewport, as the canvas draws the
// slice (sliceToDisplay, then displayToPixel), so it stays on the data while
// the view is zoomed and panned, on an oblique section too; clipped to the
// slice's extent, so a region reaching past the volume is drawn only where
// the volume is.

import { useId } from "react";

import { markColor, readableOn } from "./markColor";
import { sectionDisplay, toPixels, type Section } from "./regionMark";
import { useViewSize } from "./viewSize";
import { sliceToDisplay, type AxisExtent, type SliceGeom, type Viewport } from "./viewport";

/** One mark as this view draws it. */
export interface MarkItem {
  id: string; // "M1"
  label: string;
  section: Section;
  primary: boolean; // outlined with its label; else thin and dashed, with its id alone
}

interface Props {
  items: MarkItem[];
  geom: SliceGeom; // the view's slice geometry, as its canvas has it
  viewport: Viewport;
  lut: Uint8ClampedArray; // the view's colormap: the marks take a colour it lacks
  extent: AxisExtent; // the slice's sample axes: the outlines are clipped to the voxels they span
}

const RING = 8; // a point's ring radius (px)
const CHIP_H = 16;
const CHIP_CH = 6.3; // px per character of the chip's 10.5 px monospace
const PAD = 4;

/** The slice's voxels' outline (its samples' range, half a step past each end) in display units. */
function dataOutline(ax: AxisExtent, g: SliceGeom): [number, number][] {
  const half = (a: number[]) => (a.length > 1 ? (a[a.length - 1] - a[0]) / (a.length - 1) / 2 : 0);
  const [x0, x1] = [ax.x_axis[0] - half(ax.x_axis), ax.x_axis[ax.x_axis.length - 1] + half(ax.x_axis)];
  const [y0, y1] = [ax.y_axis[0] - half(ax.y_axis), ax.y_axis[ax.y_axis.length - 1] + half(ax.y_axis)];
  return [sliceToDisplay(x0, y0, g), sliceToDisplay(x1, y0, g), sliceToDisplay(x1, y1, g), sliceToDisplay(x0, y1, g)];
}

const svgPoints = (pts: [number, number][]) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

export function RegionMarks({ items, geom, viewport, lut, extent }: Props) {
  const { w, h } = useViewSize();
  const clip = useId();
  if (w <= 1 || h <= 1 || !items.length || !extent.x_axis.length || !extent.y_axis.length) return null;
  const color = markColor(lut);
  const ink = readableOn(color);
  const small = Math.min(w, h) < 220;
  const fitChars = Math.max(2, Math.floor((w - 2 * PAD - 10) / CHIP_CH));

  const outlines = items.map((item) => {
    const pts = toPixels(sectionDisplay(item.section, geom), viewport, w, h);
    const X = pts.map((p) => p[0]), Y = pts.map((p) => p[1]);
    const r = item.section.kind === "points" ? RING : 0;
    const box = { x0: Math.min(...X) - r, x1: Math.max(...X) + r, y0: Math.min(...Y) - r, y1: Math.max(...Y) + r };
    return { item, pts, box };
  });

  return (
    <svg
      className="region-marks"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", overflow: "hidden" }}
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clip}>
          <polygon points={svgPoints(toPixels(dataOutline(extent, geom), viewport, w, h))} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`} fill="none" strokeLinejoin="round">
        {outlines.map(({ item, pts }) => {
          const dash = item.primary ? undefined : "6 4";
          const width = item.primary ? 2 : 1.5;
          const shape = (stroke: string, sw: number, d?: string) =>
            item.section.kind === "points" ? (
              pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={RING} stroke={stroke} strokeWidth={sw} strokeDasharray={d} />)
            ) : (
              <polygon points={svgPoints(pts)} stroke={stroke} strokeWidth={sw} strokeDasharray={d} />
            );
          return (
            <g key={item.id} data-mark={item.id}>
              {shape("rgba(8, 10, 14, 0.7)", width + 2.5, dash)}
              {shape(color, width, dash)}
            </g>
          );
        })}
      </g>
      {outlines.map(({ item, box }) => {
        // No chip for a mark that is out of view.
        if (box.x1 < 0 || box.x0 > w || box.y1 < 0 || box.y0 > h) return null;
        const full = item.primary && !small ? `${item.id} · ${item.label}` : item.id;
        const text = full.length > fitChars ? `${full.slice(0, fitChars - 1)}…` : full;
        const cw = text.length * CHIP_CH + 10;
        const x = Math.min(w - cw - PAD, Math.max(PAD, box.x0));
        // Above the outline, else below it, kept inside the view.
        const above = box.y0 - CHIP_H - 3;
        const y = Math.min(h - CHIP_H - PAD, Math.max(PAD, above >= PAD ? above : box.y1 + 3));
        return (
          <g key={`${item.id}-chip`} className="region-mark-chip" opacity={item.primary ? 1 : 0.85}>
            <rect x={x} y={y} width={cw} height={CHIP_H} rx={4} fill={color} stroke="rgba(8, 10, 14, 0.6)" strokeWidth={1} />
            <text x={x + 5} y={y + CHIP_H / 2} dominantBaseline="central" fill={ink} style={{ font: "600 10.5px var(--font-mono)" }}>
              {text}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
