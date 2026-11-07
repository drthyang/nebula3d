// The Highlights over one slice view (THY-66): what a NEBULA Pilot check
// measured, drawn where it measured it (llm/examine/). One SVG layer, as
// RegionMarks draws the marks (which sit above it): the view's share of the
// set is computed once per cut (examine/draw.ts), and panning or zooming only
// re-projects it — the holes and round 2 through one transform, the peaks and
// shells through the viewport. Shape and dash carry the class as much as the
// colour does (the semantic tokens), each stroke over a dark halo.

import { useId } from "react";

import { ellipseToPixels, type DisplayEllipse } from "./punchGeometry";
import { useViewSize } from "./viewSize";
import { displayToPixel, sliceToDisplay, type Viewport } from "./viewport";
import type { DrawnShell, ViewDraw } from "../llm/examine/draw";
import type { ClassId, Tone } from "../llm/examine/overlays";
import { TONE } from "./highlightTones";

const HALO = "rgba(8, 10, 14, 0.72)";

interface Props {
  draw: ViewDraw;
  tones: Partial<Record<ClassId, Tone>>;
  codes: Partial<Record<ClassId, string>>; // a shell's code chip (AL, LEFT, …)
  off: readonly ClassId[];
  viewport: Viewport;
  sx: number; // display units per slice unit (the paths are in slice units)
  sy: number;
  angle?: number; // the angle between the slice's axes (deg, default 90)
  extent: { x_axis: number[]; y_axis: number[] }; // the slice's sample axes: clipped to them
  primary: boolean; // the view the check reads: shell codes and the strongest peak's σ
}

// An ellipse in pixels as a closed path (tilted as the view draws it).
function ellipsePath(p: DisplayEllipse, n = 72): string {
  const t = (p.angle * Math.PI) / 180;
  const [c, s] = [Math.cos(t), Math.sin(t)];
  let d = "";
  for (let k = 0; k < n; k++) {
    const a = (k / n) * 2 * Math.PI;
    const [u, v] = [p.rx * Math.cos(a), p.ry * Math.sin(a)];
    d += `${k ? "L" : "M"}${(p.cx + u * c - v * s).toFixed(1)} ${(p.cy + u * s + v * c).toFixed(1)}`;
  }
  return `${d}Z`;
}

// A point on a pixel ellipse at angle a (rad).
function onEllipse(p: DisplayEllipse, a: number): [number, number] {
  const t = (p.angle * Math.PI) / 180;
  const [u, v] = [p.rx * Math.cos(a), p.ry * Math.sin(a)];
  return [p.cx + u * Math.cos(t) - v * Math.sin(t), p.cy + u * Math.sin(t) + v * Math.cos(t)];
}

const DASH: Partial<Record<ClassId, string>> = {
  broad: "4 3",
  AL: "5 3",
  RM: "2 2",
  fpBroad: "3 2",
  GRID: "1.5 2.5",
  XTAL: "6 3",
  NJ: "1 3",
  edges: "5 3",
  band: "4 3",
  reach: "8 3",
};

function chip(x: number, y: number, text: string, color: string, key: string) {
  const w = 6.2 * text.length + 8;
  return (
    <g key={key} className="hl-chip">
      <rect x={x - w / 2} y={y - 7} width={w} height={14} rx={3} fill="rgba(11, 13, 16, 0.85)" stroke={color} strokeWidth={0.8} />
      <text x={x} y={y + 0.5} textAnchor="middle" dominantBaseline="central" fill={color} style={{ font: "700 9.5px var(--font-mono)" }}>
        {text}
      </text>
    </g>
  );
}

// A label beside a mark: its text over a dark plate, in the mark's colour.
function label(x: number, y: number, text: string, color: string, key: string) {
  const w = 6 * text.length + 6;
  return (
    <g key={key} className="hl-label">
      <rect x={x - w / 2} y={y - 6.5} width={w} height={13} rx={2} fill="rgba(11, 13, 16, 0.78)" />
      <text x={x} y={y + 0.5} textAnchor="middle" dominantBaseline="central" fill={color} style={{ font: "600 9.5px var(--font-mono)" }}>
        {text}
      </text>
    </g>
  );
}

// A spot's radius (px): fixed by its class, or growing with its size (a ΔPDF feature's |σ|).
function spotRadius(cls: ClassId, sigma: number): number {
  if (cls === "dpos" || cls === "dneg") return Math.min(14, Math.max(5, 5 + 3 * Math.log10(Math.max(1, sigma / 5))));
  if (cls === "rotated") return 4;
  return cls === "broad" ? 9 : 7;
}

export function HighlightLayer({ draw, tones, codes, off, viewport, sx, sy, angle = 90, extent, primary }: Props) {
  const { w, h } = useViewSize();
  const id = useId().replace(/:/g, "");
  if (w <= 1 || h <= 1) return null;
  const shown = (cls: ClassId) => !off.includes(cls);
  const color = (cls: ClassId) => TONE[tones[cls] ?? "white"];
  // display → pixel: one scale, y up.
  const k = (Math.min(w, h) || 1) / (2 * viewport.half);
  const tx = w / 2 - viewport.cx * k;
  const ty = h / 2 + viewport.cy * k;
  const px = (e: DisplayEllipse) => ellipseToPixels(e, viewport, w, h);
  // The slice's extent in pixels: the overlays are clipped to the voxels it spans.
  const half = (a: number[]) => (a.length > 1 ? Math.abs(a[a.length - 1] - a[0]) / (a.length - 1) / 2 : 0);
  const xs = extent.x_axis, ys = extent.y_axis;
  const [x0, x1] = [Math.min(xs[0], xs[xs.length - 1]) - half(xs), Math.max(xs[0], xs[xs.length - 1]) + half(xs)];
  const [y0, y1] = [Math.min(ys[0], ys[ys.length - 1]) - half(ys), Math.max(ys[0], ys[ys.length - 1]) + half(ys)];
  // Its four corners through the slice's geometry (a parallelogram on an oblique cell).
  const clipPath = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    .map(([x, y], i) => {
      const [X, Y] = sliceToDisplay(x, y, { sx, sy, angle });
      const [px0, py0] = displayToPixel(viewport, X, Y, w, h);
      return `${i ? "L" : "M"}${px0.toFixed(1)} ${py0.toFixed(1)}`;
    })
    .join("") + "Z";
  const small = Math.min(w, h) < 220;
  const big = Math.min(w, h) / 2;

  const hatches = draw.hatches.filter((x) => shown(x.cls));
  const bands = draw.bands.filter((x) => shown(x.cls));
  const shells = draw.shells.filter((x) => shown(x.cls));
  const paths = draw.paths.filter((x) => shown(x.cls));
  const peaks = draw.peaks.filter((x) => shown(x.cls));
  const ellipses = (draw.ellipses ?? []).filter((x) => shown(x.cls));
  const arrows = (draw.arrows ?? []).filter((x) => shown(x.cls));
  const lines = (draw.lines ?? []).filter((x) => shown(x.cls));
  // The slice's units to pixels: through its geometry (the angle between its axes), y up.
  const t = (angle * Math.PI) / 180;
  const pathMatrix = `matrix(${k * sx} 0 ${k * sy * Math.cos(t)} ${-k * sy * Math.sin(t)} ${tx} ${ty})`;
  const strongest = primary && !small ? peaks.find((p) => p.style === "full") : undefined;

  const shellShape = (s: DrawnShell, i: number) => {
    const p = px(s.e);
    const faint = s.style === "faint";
    const width = s.cls === "LEFT" ? 2 : faint ? 0.9 : 1.4;
    const dash = s.cls === "LEFT" ? undefined : DASH[s.cls];
    const transform = p.angle ? `rotate(${p.angle.toFixed(2)} ${p.cx.toFixed(1)} ${p.cy.toFixed(1)})` : undefined;
    const ring = (stroke: string, sw: number) => (
      <ellipse cx={p.cx} cy={p.cy} rx={Math.max(0.5, p.rx)} ry={Math.max(0.5, p.ry)} transform={transform} fill="none" stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />
    );
    // ▲ a ring left, ▼ a dent: at four places along the shell.
    const ticks = s.tick
      ? [20, 110, 200, 290].map((deg) => {
          const [x, y] = onEllipse(p, (deg * Math.PI) / 180);
          const d = s.tick === "up" ? `M${x} ${y - 5}l4.5 7.5h-9z` : `M${x} ${y + 5}l4.5 -7.5h-9z`;
          return <path key={deg} d={d} fill={color(s.cls)} stroke={HALO} strokeWidth={1} />;
        })
      : null;
    return (
      <g key={`s${i}`} data-hl={s.cls} opacity={faint ? 0.6 : 1}>
        {ring(HALO, width + 2.2)}
        {ring(color(s.cls), width)}
        {ticks}
      </g>
    );
  };

  // Where a chip may sit: inside the view, off its axis labels, field of view and zoom buttons.
  const clear = (x: number, y: number) => x > 30 && x < w - 30 && y > 30 && y < h - 34 && !(x > w - 110 && y < 100);
  // A code chip on each full shell of the view the check reads, spread around it, none over another.
  const placed: { x: number; y: number; w: number }[] = [];
  const free = (x: number, y: number, cw: number) => placed.every((b) => Math.abs(b.x - x) > (b.w + cw) / 2 + 2 || Math.abs(b.y - y) > 16);
  const shellChips =
    primary && !small
      ? shells
          .filter((s) => s.style === "full" && codes[s.cls])
          .flatMap((s, i) => {
            const p = px(s.e);
            const text = codes[s.cls]!;
            const cw = 6.2 * text.length + 8;
            for (let k2 = 0; k2 < 16; k2++) {
              const [x, y] = onEllipse(p, ((-90 + i * 47 + k2 * 22.5) * Math.PI) / 180);
              if (clear(x, y) && free(x, y, cw)) {
                placed.push({ x, y, w: cw });
                return [chip(x, y, text, color(s.cls), `c${i}`)];
              }
            }
            return [];
          })
      : [];

  return (
    <svg className="hl-overlay" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" data-hl-layer="">
      <defs>
        <clipPath id={`${id}c`}>
          <path d={clipPath} />
        </clipPath>
        {hatches.length > 0 && (
          // The NeXus Viewer's no-data hatch: thin diagonal lines, 6 px apart.
          <pattern id={`${id}h`} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={6} stroke="var(--hl-hatch)" strokeWidth={1} />
          </pattern>
        )}
        {hatches.map((x, i) => (
          <mask key={i} id={`${id}m${i}`} maskUnits="userSpaceOnUse" x={0} y={0} width={w} height={h}>
            <rect x={0} y={0} width={w} height={h} fill="#fff" />
            {x.outside && <path d={ellipsePath(px(x.outside))} fill="#000" />}
            {x.inside && <path d={ellipsePath(px(x.inside))} fill="#fff" />}
          </mask>
        ))}
      </defs>
      <g clipPath={`url(#${id}c)`}>
        {hatches.map((x, i) => (
          <rect key={`h${i}`} data-hl={x.cls} x={0} y={0} width={w} height={h} fill={`url(#${id}h)`} mask={`url(#${id}m${i})`} />
        ))}
        {bands.map((b, i) => {
          // The band between its two shells: shaded, its edges dashed.
          const outer = b.outer ? ellipsePath(px(b.outer)) : `M-${big} -${big}H${w + big}V${h + big}H-${big}Z`;
          const inner = b.inner ? ellipsePath(px(b.inner)) : "";
          const c = color(b.cls);
          return (
            <g key={`b${i}`} data-hl={b.cls} opacity={b.style === "faint" ? 0.6 : 1}>
              <path d={`${outer}${inner}`} fillRule="evenodd" fill={c} fillOpacity={0.14} stroke="none" />
              {b.outer && <path d={ellipsePath(px(b.outer))} fill="none" stroke={c} strokeWidth={1.2} strokeDasharray="4 3" />}
              {b.inner && <path d={ellipsePath(px(b.inner))} fill="none" stroke={c} strokeWidth={1.2} strokeDasharray="4 3" />}
            </g>
          );
        })}
        {paths.length > 0 && (
          <g transform={pathMatrix}>
            {paths.map((p) =>
              p.cls === "r2" ? (
                <path key="r2" data-hl="r2" d={p.d} fill="var(--r2-fill)" stroke="var(--r2)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
              ) : (
                <g key={p.cls} data-hl={p.cls}>
                  <path d={p.d} fill="none" stroke={HALO} strokeWidth={2.4} vectorEffect="non-scaling-stroke" />
                  <path d={p.d} fill="none" stroke="rgba(255, 255, 255, 0.9)" strokeWidth={0.9} vectorEffect="non-scaling-stroke" />
                </g>
              ),
            )}
          </g>
        )}
        {lines.map((l, i) => {
          const [x0, y0] = displayToPixel(viewport, l.X0, l.Y0, w, h);
          const [x1, y1] = displayToPixel(viewport, l.X1, l.Y1, w, h);
          const c = color(l.cls);
          // The NeXus Viewer's cut: the line in a faint band, dashed.
          return (
            <g key={`ln${i}`} data-hl={l.cls}>
              <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={c} strokeOpacity={0.16} strokeWidth={10} />
              <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={HALO} strokeWidth={3} />
              <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={c} strokeWidth={1.4} strokeDasharray="6 4" />
            </g>
          );
        })}
        {shells.map(shellShape)}
        {ellipses.map((f, i) => {
          const p = px(f.e);
          if (p.cx < -40 || p.cx > w + 40 || p.cy < -40 || p.cy > h + 40) return null;
          const c = color(f.cls);
          const dash = DASH[f.cls];
          // At least a few pixels across, so a footprint shows at any zoom (its shape kept).
          const grow = Math.max(1, 5 / Math.max(p.rx, p.ry, 1e-9));
          const [rx, ry] = [Math.max(2.5, p.rx * grow), Math.max(2.5, p.ry * grow)];
          const transform = p.angle ? `rotate(${p.angle.toFixed(2)} ${p.cx.toFixed(1)} ${p.cy.toFixed(1)})` : undefined;
          const ring = (stroke: string, sw: number) => (
            <ellipse cx={p.cx} cy={p.cy} rx={rx} ry={ry} transform={transform} fill="none" stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />
          );
          return (
            <g key={`f${i}`} data-hl={f.cls} opacity={f.style === "faint" ? 0.6 : 1}>
              {ring(HALO, 3.4)}
              {ring(c, 1.5)}
              {f.label && !small && label(p.cx, p.cy - Math.max(rx, ry) - 9, f.label, c, "l")}
            </g>
          );
        })}
        {arrows.length > 0 && (
          <g data-hl={arrows[0].cls}>
            {arrows.map((a, i) => {
              const [x0, y0] = displayToPixel(viewport, a.X, a.Y, w, h);
              const [x1, y1] = displayToPixel(viewport, a.X + a.dX, a.Y + a.dY, w, h);
              const len = Math.hypot(x1 - x0, y1 - y0);
              if (len < 2 || Math.max(x0, x1) < -10 || Math.min(x0, x1) > w + 10 || Math.max(y0, y1) < -10 || Math.min(y0, y1) > h + 10) return null;
              const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
              const head = Math.min(6, len / 2);
              const d = `M${x0.toFixed(1)} ${y0.toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}M${(x1 - head * ux - head * 0.6 * uy).toFixed(1)} ${(y1 - head * uy + head * 0.6 * ux).toFixed(1)}L${x1.toFixed(1)} ${y1.toFixed(1)}L${(x1 - head * ux + head * 0.6 * uy).toFixed(1)} ${(y1 - head * uy - head * 0.6 * ux).toFixed(1)}`;
              return (
                <g key={i}>
                  <path d={d} fill="none" stroke={HALO} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
                  <path d={d} fill="none" stroke={color(a.cls)} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx={x0} cy={y0} r={1.8} fill={color(a.cls)} />
                </g>
              );
            })}
          </g>
        )}
        {peaks.map((p, i) => {
          const [x, y] = displayToPixel(viewport, p.X, p.Y, w, h);
          if (x < -12 || x > w + 12 || y < -12 || y > h + 12) return null;
          const c = color(p.cls);
          const faint = p.style === "faint";
          const dash = faint || p.cls === "broad" || p.cls === "fpBroad" ? "3 2" : undefined;
          const sw = faint ? 1.2 : p.cls === "broad" ? 1.3 : 1.8;
          const r = spotRadius(p.cls, p.sigma);
          const shape = (stroke: string, width: number) => {
            switch (p.cls) {
              case "sharp":
                return <path d={`M${x} ${y - 6}L${x + 6} ${y}L${x} ${y + 6}L${x - 6} ${y}Z`} fill="none" stroke={stroke} strokeWidth={width} strokeDasharray={dash} />;
              case "fillUp":
                return <path d={`M${x} ${y - 7}L${x + 6.5} ${y + 5}H${x - 6.5}Z`} fill="none" stroke={stroke} strokeWidth={width} strokeDasharray={dash} strokeLinejoin="round" />;
              case "fillDown":
                return <path d={`M${x} ${y + 7}L${x + 6.5} ${y - 5}H${x - 6.5}Z`} fill="none" stroke={stroke} strokeWidth={width} strokeDasharray={dash} strokeLinejoin="round" />;
              case "far":
                return <path d={`M${x - 5} ${y - 5}L${x + 5} ${y + 5}M${x + 5} ${y - 5}L${x - 5} ${y + 5}`} stroke={stroke} strokeWidth={width} strokeLinecap="round" />;
              default:
                return <circle cx={x} cy={y} r={r} fill="none" stroke={stroke} strokeWidth={width} strokeDasharray={dash} />;
            }
          };
          return (
            <g key={`p${i}`} data-hl={p.cls}>
              {shape(HALO, sw + 2.2)}
              {shape(c, sw)}
              {/* + and − inside a ΔPDF feature's ring */}
              {(p.cls === "dpos" || p.cls === "dneg") && r >= 6 && (
                <path d={p.cls === "dpos" ? `M${x - 3} ${y}h6M${x} ${y - 3}v6` : `M${x - 3} ${y}h6`} stroke={c} strokeWidth={1.4} />
              )}
              {p.label && label(x, y - r - 9, p.label, c, "l")}
            </g>
          );
        })}
        {strongest &&
          (() => {
            const [x, y] = displayToPixel(viewport, strongest.X, strongest.Y, w, h);
            return chip(x, y - 15, `${Number(strongest.sigma.toFixed(1))}σ`, color(strongest.cls), "sig");
          })()}
        {shellChips}
      </g>
    </svg>
  );
}
