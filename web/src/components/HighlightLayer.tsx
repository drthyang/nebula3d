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
import { displayToPixel, type Viewport } from "./viewport";
import type { DrawnShell, ViewDraw } from "../llm/examine/draw";
import type { ClassId, Tone } from "../llm/examine/overlays";

const TONE: Record<Tone, string> = {
  red: "var(--red)",
  amber: "var(--amber)",
  green: "var(--green)",
  cyan: "var(--hl-cyan)",
  grey: "var(--hl-grey)",
  white: "#ffffff",
  r2: "var(--r2)",
  accent: "var(--accent-hi)",
};
const HALO = "rgba(8, 10, 14, 0.72)";

interface Props {
  draw: ViewDraw;
  tones: Partial<Record<ClassId, Tone>>;
  codes: Partial<Record<ClassId, string>>; // a shell's code chip (AL, LEFT, …)
  off: readonly ClassId[];
  viewport: Viewport;
  sx: number; // display units per r.l.u. (the paths are in r.l.u.)
  sy: number;
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

export function HighlightLayer({ draw, tones, codes, off, viewport, sx, sy, extent, primary }: Props) {
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
  const [ax0, ay0] = displayToPixel(viewport, (Math.min(xs[0], xs[xs.length - 1]) - half(xs)) * sx, (Math.max(ys[0], ys[ys.length - 1]) + half(ys)) * sy, w, h);
  const [ax1, ay1] = displayToPixel(viewport, (Math.max(xs[0], xs[xs.length - 1]) + half(xs)) * sx, (Math.min(ys[0], ys[ys.length - 1]) - half(ys)) * sy, w, h);
  const small = Math.min(w, h) < 220;
  const big = Math.min(w, h) / 2;

  const hatches = draw.hatches.filter((x) => shown(x.cls));
  const bands = draw.bands.filter((x) => shown(x.cls));
  const shells = draw.shells.filter((x) => shown(x.cls));
  const paths = draw.paths.filter((x) => shown(x.cls));
  const peaks = draw.peaks.filter((x) => shown(x.cls));
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

  // A code chip on each full shell of the view the check reads, spread around it.
  const shellChips =
    primary && !small
      ? shells
          .filter((s) => s.style === "full" && codes[s.cls])
          .flatMap((s, i) => {
            const p = px(s.e);
            for (let k2 = 0; k2 < 8; k2++) {
              const [x, y] = onEllipse(p, ((-90 + (i * 47 + k2 * 45)) * Math.PI) / 180);
              if (x > 16 && x < w - 16 && y > 10 && y < h - 10) return [chip(x, y, codes[s.cls]!, color(s.cls), `c${i}`)];
            }
            return [];
          })
      : [];

  return (
    <svg className="hl-overlay" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" data-hl-layer="">
      <defs>
        <clipPath id={`${id}c`}>
          <rect x={Math.min(ax0, ax1)} y={Math.min(ay0, ay1)} width={Math.abs(ax1 - ax0)} height={Math.abs(ay1 - ay0)} />
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
          <g transform={`matrix(${k * sx} 0 0 ${-k * sy} ${tx} ${ty})`}>
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
        {shells.map(shellShape)}
        {peaks.map((p, i) => {
          const [x, y] = displayToPixel(viewport, p.X, p.Y, w, h);
          if (x < -12 || x > w + 12 || y < -12 || y > h + 12) return null;
          const c = color(p.cls);
          const faint = p.style === "faint";
          const dash = faint || p.cls === "broad" ? "3 2" : undefined;
          const sw = faint ? 1.2 : p.cls === "broad" ? 1.3 : 1.8;
          const r = p.cls === "broad" ? 9 : 7;
          const shape = (stroke: string, width: number) =>
            p.cls === "sharp" ? (
              <path d={`M${x} ${y - 6}L${x + 6} ${y}L${x} ${y + 6}L${x - 6} ${y}Z`} fill="none" stroke={stroke} strokeWidth={width} strokeDasharray={dash} />
            ) : (
              <circle cx={x} cy={y} r={r} fill="none" stroke={stroke} strokeWidth={width} strokeDasharray={dash} />
            );
          return (
            <g key={`p${i}`} data-hl={p.cls}>
              {shape(HALO, sw + 2.2)}
              {shape(c, sw)}
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
