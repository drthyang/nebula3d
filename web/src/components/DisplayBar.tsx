// Display-bar controls shared by the viewer pages, after the NeXus Viewer's
// workspace header: the click mode, the colour range around its bar (with the
// data's histogram behind it and a handle at each limit), the scale, Auto, and
// a Brightness knob that moves the same vmax in stops about Auto.

import { useEffect, useMemo, useRef, useState } from "react";

import { useWorkspaceStore, type ClickMode } from "../state/workspaceStore";
import {
  brightnessOf,
  fmtLevel,
  hiForBrightness,
  type Levels,
  type ScaleKind,
} from "./colorScale";

const CLICK_MODES: { mode: ClickMode; label: string; title: string }[] = [
  { mode: "navigate", label: "Navigate", title: "Hover to read values; on 3D-ΔPDF a click moves the other two cuts" },
  { mode: "zoom", label: "Zoom", title: "Click to zoom in 2× (Alt-click out); drag a box to zoom into it" },
  { mode: "move", label: "Move", title: "Drag to pan" },
];

/** Navigate · Zoom · Move — shared by every viewer page and remembered. */
export function ClickModeControl() {
  const mode = useWorkspaceStore((s) => s.clickMode);
  const setMode = useWorkspaceStore((s) => s.setClickMode);
  return (
    <div className="segmented" role="group" aria-label="Click mode">
      {CLICK_MODES.map((m) => (
        <button
          key={m.mode}
          type="button"
          className={mode === m.mode ? "on" : ""}
          title={m.title}
          aria-pressed={mode === m.mode}
          onClick={() => setMode(m.mode)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

const SCALES: ScaleKind[] = ["asinh", "lin", "log"];

export function ScaleControl({ value, onChange }: { value: ScaleKind; onChange: (s: ScaleKind) => void }) {
  return (
    <div className="segmented" role="group" aria-label="Scale">
      {SCALES.map((s) => (
        <button key={s} type="button" className={s === value ? "on" : ""} aria-pressed={s === value} onClick={() => onChange(s)}>
          {s}
        </button>
      ))}
    </div>
  );
}

/** A number field that commits on Enter or blur and reverts on Escape. */
function LimitInput({
  value,
  label,
  prefix,
  onCommit,
}: {
  value: number;
  label: string;
  prefix?: string;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = Number(draft.replace("±", "").trim());
    if (draft.trim() !== "" && Number.isFinite(v)) onCommit(v);
    setDraft(null);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      className="lv-num"
      aria-label={label}
      value={draft ?? `${prefix ?? ""}${fmtLevel(value)}`}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        else if (e.key === "Escape") setDraft(null);
      }}
      onBlur={commit}
    />
  );
}

function lutGradient(lut: Uint8ClampedArray, stops = 16): string {
  const parts: string[] = [];
  for (let i = 0; i <= stops; i++) {
    const k = Math.round((i / stops) * 255) * 4;
    parts.push(`rgb(${lut[k]}, ${lut[k + 1]}, ${lut[k + 2]}) ${((i / stops) * 100).toFixed(1)}%`);
  }
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}

/**
 * vmin · [histogram + colour bar + two handles] · vmax.  `symmetric` (signed
 * data) shows one ± limit and mirrors the handles about 0.
 */
export function LevelsBar({
  lut,
  levels,
  domain,
  hist,
  symmetric = false,
  scale = "lin",
  onChange,
}: {
  lut: Uint8ClampedArray;
  levels: Levels;
  domain: [number, number];
  hist: Float32Array;
  symmetric?: boolean;
  scale?: ScaleKind;
  onChange: (l: Levels) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [d0, d1] = domain;
  const span = d1 - d0 || 1;
  const pos = (v: number) => Math.max(0, Math.min(100, ((v - d0) / span) * 100));
  const ramp = useMemo(() => lutGradient(lut), [lut]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    c.width = hist.length;
    c.height = 24;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = getComputedStyle(c).color || "#4b5668";
    for (let i = 0; i < hist.length; i++) {
      const h = hist[i] * c.height;
      ctx.fillRect(i, c.height - h, 1, h);
    }
  }, [hist]);

  const set = (which: "lo" | "hi", v: number) => {
    const gap = span * 0.005;
    if (symmetric) {
      const m = Math.max(Math.abs(v), gap);
      onChange({ lo: -m, hi: m });
    } else if (which === "lo") {
      const lo = Math.min(v, levels.hi - gap);
      onChange({ lo: scale === "log" ? Math.max(lo, levels.hi * 1e-6) : lo, hi: levels.hi });
    } else {
      onChange({ lo: levels.lo, hi: Math.max(v, levels.lo + gap) });
    }
  };

  const dragHandle = (which: "lo" | "hi") => (e: React.PointerEvent<HTMLButtonElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const b = track.current!.getBoundingClientRect();
      set(which, d0 + ((ev.clientX - b.left) / b.width) * span);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };
  const keyHandle = (which: "lo" | "hi") => (e: React.KeyboardEvent) => {
    const step = (span / 100) * (e.shiftKey ? 10 : 1);
    const cur = which === "lo" ? levels.lo : levels.hi;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") set(which, cur + step);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") set(which, cur - step);
    else return;
    e.preventDefault();
  };

  const lo = symmetric ? -Math.abs(levels.hi) : levels.lo;
  const hi = Math.abs(symmetric ? levels.hi : levels.hi);
  return (
    <div className={`levels-bar${symmetric ? " levels-bar--sym" : ""}`}>
      {!symmetric && (
        <LimitInput value={levels.lo} label="Colour minimum" onCommit={(v) => v < levels.hi && set("lo", v)} />
      )}
      <div className="lv-track" ref={track}>
        <canvas ref={canvas} className="lv-hist" />
        <div className="lv-ramp" style={{ background: ramp }} />
        <div className="lv-span" style={{ left: `${pos(lo)}%`, width: `${pos(hi) - pos(lo)}%` }} />
        <button
          type="button"
          className="lv-handle"
          style={{ left: `${pos(lo)}%` }}
          aria-label={symmetric ? "Colour limit (negative side)" : "Colour minimum"}
          onPointerDown={dragHandle(symmetric ? "hi" : "lo")}
          onKeyDown={keyHandle(symmetric ? "hi" : "lo")}
        />
        <button
          type="button"
          className="lv-handle"
          style={{ left: `${pos(hi)}%` }}
          aria-label={symmetric ? "Colour limit" : "Colour maximum"}
          onPointerDown={dragHandle("hi")}
          onKeyDown={keyHandle("hi")}
        />
      </div>
      <LimitInput
        value={hi}
        prefix={symmetric ? "±" : undefined}
        label={symmetric ? "Colour limit ±" : "Colour maximum"}
        onCommit={(v) => (symmetric ? v !== 0 && set("hi", v) : v > levels.lo && set("hi", v))}
      />
    </div>
  );
}

/** Brightness in stops about Auto: right is brighter (vmax lower). */
export function BrightnessKnob({
  autoHi,
  hi,
  onChange,
}: {
  autoHi: number;
  hi: number;
  onChange: (hi: number) => void;
}) {
  const b = brightnessOf(autoHi, hi);
  return (
    <label className="brightness" title="Brightness: moves vmax in stops about Auto (right is brighter)">
      <span className="field-label">Brightness</span>
      <input
        type="range"
        min={-3}
        max={3}
        step={0.05}
        value={Math.max(-3, Math.min(3, b))}
        onChange={(e) => onChange(hiForBrightness(autoHi, Number(e.target.value)))}
      />
      <span className="readout">{b >= 0 ? "+" : "−"}{Math.abs(b).toFixed(1)}</span>
    </label>
  );
}

export function AutoButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`btn btn-ghost btn-auto${active ? " on" : ""}`}
      title="vmin 0, vmax at the 97th percentile and softening at the median of the positive values (as in the NeXus Viewer)"
      aria-pressed={active}
      onClick={onClick}
    >
      Auto
    </button>
  );
}
