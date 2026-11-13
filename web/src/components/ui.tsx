// Shared UI primitives for the console: labelled fields, sliders with value
// readouts, switches, segmented controls, empty states, and the inline icon set.

import { useEffect, useRef, useState, type ReactNode } from "react";

/* ----------------------------------------------------------------- fields */

export function Field({
  label,
  children,
  grow = false,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  grow?: boolean;
  className?: string; // extra classes (e.g. the Configure page's flash of an agent's change)
}) {
  return (
    <div className={`field${grow ? " grow" : ""}${className ? ` ${className}` : ""}`}>
      <span className="field-label">{label}</span>
      {children}
    </div>
  );
}

// An editable readout: type a value and commit (Enter / blur) to snap to the
// nearest data point.  Renders in place of the plain `readout` text.
export interface ValueInputConfig {
  value: number; // the real-space value shown when not being edited
  onCommit: (v: number) => void; // caller snaps to the closest data point
  prefix?: string; // e.g. "H ="
  suffix?: string; // e.g. "r.l.u."
}

function fmtRlu(v: number): string {
  return Number(v.toFixed(4)).toString();
}

function ValueInput({
  value,
  onCommit,
  prefix,
  suffix,
  disabled,
}: ValueInputConfig & { disabled?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(v)) onCommit(v);
    setDraft(null);
  };
  return (
    <span className="readout-edit">
      {prefix && <span>{prefix}</span>}
      <input
        type="number"
        className="value-input"
        value={draft ?? fmtRlu(value)}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          else if (e.key === "Escape") setDraft(null);
        }}
        onBlur={commit}
      />
      {suffix && <span>{suffix}</span>}
    </span>
  );
}

export function Slider({
  label,
  readout,
  valueInput,
  valueInputs,
  value,
  min,
  max,
  step = 1,
  disabled = false,
  grow = false,
  onChange,
}: {
  label: ReactNode;
  readout?: string;
  valueInput?: ValueInputConfig;
  valueInputs?: ValueInputConfig[]; // multiple editable boxes (e.g. Å and Å/lattice)
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  grow?: boolean;
  onChange: (v: number) => void;
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className={`field${grow ? " grow" : ""}`}>
      <div className="field-row">
        <span className="field-label">{label}</span>
        {valueInputs ? (
          <span className="readout-edits">
            {valueInputs.map((vi, i) => (
              <ValueInput key={i} {...vi} disabled={disabled} />
            ))}
          </span>
        ) : valueInput ? (
          <ValueInput {...valueInput} disabled={disabled} />
        ) : readout !== undefined ? (
          <span className="readout">{readout}</span>
        ) : null}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ "--p": `${pct}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

// Dual-thumb range slider: one track, two handles → a [lo, hi] band.
export function RangeSlider({
  label,
  readout,
  valueMin,
  valueMax,
  min,
  max,
  step = 1,
  disabled = false,
  grow = false,
  onChange,
}: {
  label: ReactNode;
  readout?: string;
  valueMin: number;
  valueMax: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  grow?: boolean;
  onChange: (lo: number, hi: number) => void;
}) {
  const span = max > min ? max - min : 1;
  const loPct = ((valueMin - min) / span) * 100;
  const hiPct = ((valueMax - min) / span) * 100;
  return (
    <div className={`field${grow ? " grow" : ""}`}>
      <div className="field-row">
        <span className="field-label">{label}</span>
        {readout !== undefined && <span className="readout">{readout}</span>}
      </div>
      <div
        className="range-dual"
        style={{ "--lo": `${loPct}%`, "--hi": `${hiPct}%` } as React.CSSProperties}
      >
        <div className="range-track" />
        <div className="range-fill" />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={valueMin}
          disabled={disabled}
          onChange={(e) => onChange(Math.min(Number(e.target.value), valueMax), valueMax)}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={valueMax}
          disabled={disabled}
          onChange={(e) => onChange(valueMin, Math.max(Number(e.target.value), valueMin))}
        />
      </div>
    </div>
  );
}

export function Switch({
  label,
  checked,
  disabled = false,
  title,
  onChange,
}: {
  label: ReactNode;
  checked: boolean;
  disabled?: boolean;
  title?: string;
  onChange: (b: boolean) => void;
}) {
  return (
    <label className={`switch${disabled ? " disabled" : ""}`} title={title}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch-track" />
      <span className="switch-label">{label}</span>
    </label>
  );
}

// A small "?" help icon that reveals a description bubble on hover / focus.
// The bubble is placed by CSS (above the icon, or as a page's own rule says).
// When it shows, it is kept inside the part of the window that is in view:
// moved down or up when a sticky bar, the window's edge or a panel would cut
// it, and given a height limit (it then scrolls inside itself) when it is
// taller than that part.
export function HelpTip({ children, className }: { children: ReactNode; className?: string }) {
  const bubble = useRef<HTMLSpanElement>(null);
  const reset = () => {
    const b = bubble.current;
    if (!b) return;
    b.style.translate = "";
    b.style.maxHeight = "";
    b.classList.remove("helptip-bubble--moved", "helptip-bubble--scroll");
  };
  const place = (e: { currentTarget: HTMLElement }) => {
    const b = bubble.current;
    if (!b) return;
    reset();
    const area = visibleSpan(e.currentTarget, b.getBoundingClientRect());
    if (!area) return;
    const room = area.bottom - area.top;
    if (b.getBoundingClientRect().height > room) {
      b.style.maxHeight = `${Math.floor(room)}px`;
      b.classList.add("helptip-bubble--scroll");
    }
    const r = b.getBoundingClientRect();
    const dy = Math.round(Math.min(Math.max(r.top, area.top), area.bottom - r.height) - r.top);
    if (dy !== 0) {
      b.style.translate = `0 ${dy}px`;
      b.classList.add("helptip-bubble--moved");
    }
  };
  return (
    <span
      className={`helptip${className ? ` ${className}` : ""}`}
      tabIndex={0}
      onFocus={place}
      onMouseEnter={place}
      onBlur={(e) => {
        if (!e.currentTarget.matches(":hover")) reset();
      }}
      onMouseLeave={(e) => {
        if (document.activeElement !== e.currentTarget) reset();
      }}
    >
      <span className="helptip-icon" aria-hidden="true">
        ?
      </span>
      <span ref={bubble} className="helptip-bubble" role="tooltip">
        {children}
      </span>
    </span>
  );
}

/** The vertical span of the window, around `anchor`, in which a bubble with the
 *  rectangle `r` is in view: not under a sticky or fixed bar, not outside the
 *  scroll box the anchor is in, not past the window.  Null when the bubble is
 *  in view already, or when no such span can be told (no layout, as in tests). */
function visibleSpan(anchor: HTMLElement, r: DOMRect): { top: number; bottom: number } | null {
  if (typeof document.elementFromPoint !== "function" || r.height === 0) return null;
  const MARGIN = 6;
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  let box: HTMLElement | null = anchor.parentElement;
  while (box && !/auto|scroll/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
  const xs = [r.left + 10, (r.left + r.right) / 2, r.right - 10].filter((x) => x > 0 && x < vw);
  if (xs.length === 0) return null;
  // a point is covered when what is drawn there is not the scroll box's own flowing content
  const covered = (y: number) =>
    y < 0 ||
    y >= vh ||
    xs.some((x) => {
      let el = document.elementFromPoint(x, y);
      if (!el || (box && !box.contains(el))) return true;
      for (; el && el !== box; el = el.parentElement) {
        const pos = getComputedStyle(el).position;
        if (pos === "sticky" || pos === "fixed") return true;
      }
      return false;
    });
  const a = anchor.getBoundingClientRect();
  const mid = Math.min(Math.max((a.top + a.bottom) / 2, 1), vh - 1);
  const STEP = 4;
  let top = mid;
  while (top - STEP >= Math.min(r.top, 0) - STEP && !covered(top - STEP)) top -= STEP;
  let bottom = mid;
  while (bottom + STEP <= Math.max(r.bottom, vh) + STEP && !covered(bottom + STEP)) bottom += STEP;
  top += MARGIN;
  bottom -= MARGIN;
  if (r.top >= top && r.bottom <= bottom) return null;
  if (bottom - top < 80) return null;
  return { top, bottom };
}

export function Segmented({
  options,
  value,
  label,
  onChange,
}: {
  options: readonly string[];
  value: string;
  label?: string; // the group's name, also its tooltip
  onChange: (v: string) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label} title={label}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          className={o === value ? "on" : ""}
          onClick={() => onChange(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

/* Renders a colormap LUT as a thin gradient strip. */
export function ColormapBar({ lut }: { lut: Uint8ClampedArray }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = 256;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(256, 1);
    img.data.set(lut);
    ctx.putImageData(img, 0, 0);
  }, [lut]);
  return <canvas ref={ref} className="cmap-bar" />;
}

/* ------------------------------------------------------------------ states */

export function EmptyState({
  title,
  hint,
  error = false,
  icon,
}: {
  title: string;
  hint?: string;
  error?: boolean;
  icon?: ReactNode;
}) {
  return (
    <div className={`empty${error ? " error" : ""}`}>
      <span className="empty-icon">{icon ?? <IconLattice size={20} />}</span>
      <span className="empty-title">{title}</span>
      {hint && <span className="empty-hint">{hint}</span>}
    </div>
  );
}

export function MetaStrip({
  items,
}: {
  items: { key: string; value: ReactNode }[];
}) {
  return (
    <div className="meta-strip">
      {items.map((it) => (
        <div key={it.key} className="meta-item">
          <span className="meta-key">{it.key}</span>
          <span className="meta-val">{it.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- icons */

interface IconProps {
  size?: number;
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/* 3×3 reciprocal-lattice dots */
export function IconLattice({ size = 17 }: IconProps) {
  const p = [3.5, 9, 14.5];
  return (
    <svg width={size} height={size} viewBox="0 0 18 18">
      {p.flatMap((y) =>
        p.map((x) => (
          <circle
            key={`${x}-${y}`}
            cx={x}
            cy={y}
            r={x === 9 && y === 9 ? 2 : 1.3}
            fill="currentColor"
          />
        )),
      )}
    </svg>
  );
}

/* profile curve — Bragg peak width distribution */
export function IconProfileWave({ size = 17 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" {...stroke}>
      <path d="M2.5 14.5h13" opacity={0.55} />
      <path d="M2.5 13.5c2.1 0 2.2-8.8 4.5-8.8 2 0 1.9 6.7 3.7 6.7 1.6 0 1.8-3.2 3-3.2.8 0 1.2 1.3 1.8 3.2" />
      <circle cx={7} cy={4.7} r={0.8} fill="currentColor" stroke="none" />
      <circle cx={10.7} cy={11.4} r={0.65} fill="currentColor" stroke="none" opacity={0.75} />
    </svg>
  );
}

/* concentric PDF shells */
export function IconOrbits({ size = 17 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" {...stroke}>
      <circle cx={9} cy={9} r={7} />
      <circle cx={9} cy={9} r={3.6} />
      <circle cx={9} cy={9} r={0.8} fill="currentColor" stroke="none" />
    </svg>
  );
}

/* stacked temperature layers */
export function IconLayers({ size = 17 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" {...stroke}>
      <path d="M9 2.5 16 6 9 9.5 2 6Z" />
      <path d="M3.5 9.25 2 10l7 3.5 7-3.5-1.5-.75" />
      <path d="M3.5 13.25 2 14l7 3.5 7-3.5-1.5-.75" opacity={0.55} />
    </svg>
  );
}

/* pipeline flow: nodes joined by edges */
export function IconFlow({ size = 17 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" {...stroke}>
      <circle cx={3.5} cy={9} r={2} />
      <circle cx={14.5} cy={3.5} r={2} />
      <circle cx={14.5} cy={14.5} r={2} />
      <path d="M5.4 8.1 12.6 4.4M5.4 9.9l7.2 3.7" />
    </svg>
  );
}

/* play triangle — pipeline execution */
export function IconRun({ size = 17 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" {...stroke}>
      <path d="M5 3.6 14 9l-9 5.4z" />
    </svg>
  );
}

export function IconCheck({ size = 17 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" {...stroke}>
      <path d="M2.5 9.5 7 14l8.5-10" />
    </svg>
  );
}

/* forward + backward arrows — Q↔R round-trip transform */
export function IconTransform({ size = 17 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" {...stroke}>
      <path d="M2.5 6.5h11" />
      <path d="M11 4 13.5 6.5 11 9" />
      <path d="M15.5 11.5h-11" />
      <path d="M7 9 4.5 11.5 7 14" />
    </svg>
  );
}

/* scattering brand glyph: centre beam + diffuse satellites */
export function BrandGlyph({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18">
      <circle cx={9} cy={9} r={2.4} fill="currentColor" />
      <g fill="currentColor" opacity={0.55}>
        <circle cx={9} cy={2.8} r={1.2} />
        <circle cx={9} cy={15.2} r={1.2} />
        <circle cx={2.8} cy={9} r={1.2} />
        <circle cx={15.2} cy={9} r={1.2} />
        <circle cx={4.6} cy={4.6} r={0.9} />
        <circle cx={13.4} cy={4.6} r={0.9} />
        <circle cx={4.6} cy={13.4} r={0.9} />
        <circle cx={13.4} cy={13.4} r={0.9} />
      </g>
    </svg>
  );
}

export function IconAlert({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" {...stroke}>
      <path d="M9 2.5 16.5 15.5H1.5Z" />
      <path d="M9 7.5v3.5" />
      <circle cx={9} cy={13.2} r={0.7} fill="currentColor" stroke="none" />
    </svg>
  );
}

/* cog — connection settings */
export function IconGear({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <circle cx={12} cy={12} r={3} />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/* four-point spark — NEBULA Pilot */
export function IconSpark({ size = 17 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" {...stroke}>
      <path d="M9 2.2c.4 2.9 1.9 4.4 4.8 4.8-2.9.4-4.4 1.9-4.8 4.8-.4-2.9-1.9-4.4-4.8-4.8C7.1 6.6 8.6 5.1 9 2.2Z" />
      <path d="M14 11.5c.2 1.3.9 2 2.2 2.2-1.3.2-2 .9-2.2 2.2-.2-1.3-.9-2-2.2-2.2 1.3-.2 2-.9 2.2-2.2Z" />
    </svg>
  );
}
