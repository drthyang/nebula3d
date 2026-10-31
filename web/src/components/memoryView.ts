// What the console's memory bar shows (MemoryBar.tsx draws it): used against a
// ceiling, the share as a percentage and a level, and a tooltip saying what is
// measured. Pure, so the formatting and the thresholds are tested on their own.
//
// - In-browser build: the pipeline worker's WASM heap against Pyodide's 4 GiB
//   ceiling (the heap a run fails in). It only grows, so it is a high-water
//   mark. On a phone or tablet, every worker's heap against the tab-wide
//   budget the size gate plans with (the OS's own limit is not published);
//   the tab holds more than its heaps, so there the share is a lower bound.
// - Native server: nebula3d's processes (the server and its running pipeline
//   processes) against the machine's RAM, as GET /api/memory reports them.

import type { EngineMemory } from "../api/engineMemory";
import type { ServerMemory } from "../api/types";
import { WASM_HEAP_CEILING_BYTES } from "../workers/heapReport";

export type MemoryLevel = "ok" | "warn" | "high";

// Amber from 75% (on a desktop's 4 GiB heap that is 3.2 GB, where the size
// gate's budget for a run's peak ends), red from 90% (about 0.4 GiB left).
export const WARN_AT = 0.75;
export const HIGH_AT = 0.9;

export interface MemoryView {
  title: string;
  used: number; // bytes
  ceiling: number; // bytes
  fraction: number; // used / ceiling, clamped to [0, 1] (the bar's fill)
  percent: number; // used / ceiling in percent, rounded; past 100 natively when swapping
  percentText: string; // "31%", or "<1%" for a use that rounds to nothing
  level: MemoryLevel;
  amount: string; // "1.23 / 4 GiB", "312 MiB / 64 GiB"
  note: string; // what kind of number it is, in a word or two
  // What is measured, one sentence or two a line: the "?" card shows the
  // lines, the title tooltip the same lines joined (one explanation, two ways).
  lines: string[];
  tooltip: string;
}

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;

export function memoryLevel(fraction: number): MemoryLevel {
  if (fraction >= HIGH_AT) return "high";
  if (fraction >= WARN_AT) return "warn";
  return "ok";
}

// Decimals for a GiB figure: two below 10 GiB, one below 100, none above.
function gibDigits(gib: number): number {
  return gib < 10 ? 2 : gib < 100 ? 1 : 0;
}

const trim = (x: number, digits: number): string => String(Number(x.toFixed(digits)));

/** A byte count in binary units: "850 MiB", "2.87 GiB", "4 GiB", "15.6 GiB". */
export function formatBytes(bytes: number): string {
  if (!(bytes >= GiB)) return `${Math.round(Math.max(0, bytes) / MiB)} MiB`;
  const gib = bytes / GiB;
  return `${trim(gib, gibDigits(gib))} GiB`;
}

/**
 * Used over ceiling: in the ceiling's unit ("1.23 / 4 GiB", "512 / 900 MiB"),
 * but a use under 1 GiB against a GiB ceiling in MiB ("312 MiB / 64 GiB"),
 * where "0.3 / 64 GiB" would say little.
 */
export function formatAmount(used: number, ceiling: number): string {
  const mib = (b: number): number => Math.round(Math.max(0, b) / MiB);
  if (!(ceiling >= GiB)) return `${mib(used)} / ${mib(ceiling)} MiB`;
  const digits = gibDigits(ceiling / GiB);
  const ceil = `${trim(ceiling / GiB, digits)} GiB`;
  if (!(used >= GiB)) return `${mib(used)} MiB / ${ceil}`;
  return `${(used / GiB).toFixed(digits)} / ${ceil}`;
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;

// `lowerBound`: what is measured is only part of what counts against the
// ceiling (a phone's tab holds more than its heaps), so the share reads "≥".
function view(
  title: string,
  used: number,
  ceiling: number,
  note: string,
  tooltip: string[],
  lowerBound = false,
): MemoryView {
  const share = used / ceiling;
  const percent = Math.round(share * 100);
  const text = percent === 0 && used > 0 ? "<1%" : `${percent}%`;
  return {
    title,
    used,
    ceiling,
    fraction: Math.min(1, Math.max(0, share)),
    percent,
    percentText: lowerBound ? `≥${text === "<1%" ? "0%" : text}` : text,
    level: memoryLevel(share),
    amount: formatAmount(used, ceiling),
    note,
    lines: tooltip,
    tooltip: tooltip.join("\n"),
  };
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where the "?" card goes, as CSS `left` / `top` of a fixed box: above the "?"
 * when it fits (the bar sits at the foot of the sidebar or the page), else
 * below, else on the roomier side; its left edge near the "?", kept `margin`
 * inside the window. `anchor` and `viewport` are in screen pixels; under the
 * console's CSS `zoom` (the 4K tier) a fixed box's offsets are zoomed too, so
 * the result is divided back by `zoom`.
 */
export function placeCard(
  anchor: Rect,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  zoom = 1,
  gap = 8,
  margin = 8,
): { left: number; top: number; above: boolean } {
  const roomAbove = anchor.top - gap - margin;
  const roomBelow = viewport.height - anchor.bottom - gap - margin;
  const above = card.height <= roomAbove || (card.height > roomBelow && roomAbove >= roomBelow);
  const rawTop = above ? anchor.top - gap - card.height : anchor.bottom + gap;
  const top = Math.min(Math.max(margin, rawTop), Math.max(margin, viewport.height - card.height - margin));
  const rawLeft = anchor.left - 12;
  const left = Math.min(Math.max(margin, rawLeft), Math.max(margin, viewport.width - card.width - margin));
  const z = zoom > 0 ? zoom : 1;
  return { left: left / z, top: top / z, above };
}

const THRESHOLDS = `Amber from ${pct(WARN_AT)}, red from ${pct(HIGH_AT)}.`;

/** The in-browser engine's bar, or null before its pipeline worker reports a heap. */
export function engineMemoryView(m: EngineMemory, heapCeiling: number = WASM_HEAP_CEILING_BYTES): MemoryView | null {
  if (m.main === null || !(m.main > 0)) return null;
  const ringTotal = m.ring.reduce((a, b) => a + b, 0);
  const ringLine =
    m.ring.length > 0
      ? `Ring workers: ${m.ring.length}, ${formatBytes(ringTotal)} in all, each in a heap of its own.`
      : null;
  const highWater =
    "High-water mark: a heap grows as Python allocates and never shrinks, so memory freed during a run stays counted.";

  // A phone or tablet: the OS stops the whole tab, so the ceiling is the size
  // gate's tab-wide budget. The tab holds more than the heaps (the runtime's
  // compiled code, the loaded and written files, the page itself), which
  // can't be measured from here: the share shown is a lower bound.
  const tab = m.budget?.device === "mobile" ? m.budget.tab_budget_bytes : null;
  if (tab !== null && tab > 0) {
    const used = m.main + ringTotal;
    return view(
      "Engine memory",
      used,
      tab,
      "heaps only",
      [
        `In-browser engine on a phone or tablet: its workers' WASM heaps, ${formatBytes(used)}, against the ${formatBytes(tab)} this page budgets for the whole tab.`,
        "The tab uses more than its heaps (the runtime's compiled code, loaded files, the page), so its real share is higher than shown.",
        "The OS reloads the page past a limit it doesn't publish: the budget is a target with margin, not that limit.",
        ...(ringLine ? [ringLine] : []),
        highWater,
        THRESHOLDS,
      ],
      true,
    );
  }

  const budget = m.budget?.heap_budget_bytes;
  return view("Engine memory", m.main, heapCeiling, "high-water", [
    `In-browser engine: the pipeline worker's WASM heap, ${formatBytes(m.main)} of Pyodide's ${formatBytes(heapCeiling)} ceiling. A run fails when it needs more.`,
    highWater,
    ...(ringLine ? [ringLine] : []),
    budget ? `${THRESHOLDS} The load check plans a run's peak at up to ${formatBytes(budget)}.` : THRESHOLDS,
  ]);
}

/** The native server's bar, or null when the server measures nothing (or can't be read). */
export function serverMemoryView(m: ServerMemory): MemoryView | null {
  if (!m.measured || m.used_bytes === null || m.ceiling_bytes === null || !(m.ceiling_bytes > 0)) return null;
  const ceilingName = m.ceiling_source === "container" ? "the container's memory limit" : "this machine's RAM";
  const what =
    m.kind === "footprint"
      ? "Physical footprint, as macOS counts it (Activity Monitor's Memory)."
      : "Resident memory (RSS), as Linux counts it.";
  const procs = m.processes.map((p) => {
    const name = p.role === "server" ? "Server" : "Run";
    const now = formatBytes(p.bytes);
    const peak = p.peak_bytes !== null && p.peak_bytes > p.bytes ? formatBytes(p.peak_bytes) : now;
    return `${name}: ${now}${peak !== now ? ` (peak ${peak})` : ""}`;
  });
  return view("Server memory", m.used_bytes, m.ceiling_bytes, m.kind === "footprint" ? "footprint" : "RSS", [
    `nebula3d's processes: ${formatBytes(m.used_bytes)} of ${ceilingName}, ${formatBytes(m.ceiling_bytes)}.`,
    procs.join(" · "),
    what,
    "The ring stage's helper processes are not counted. Past the RAM the system swaps, and may stop a run.",
    THRESHOLDS,
  ]);
}
