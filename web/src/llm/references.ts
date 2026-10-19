// Numbers by reference (THY-18). Where an answer quotes a number a tool
// computed, it may write a reference instead, {{ub_check.orientation_change_deg}}
// or {{assess_stage.flatten.max_floor_trend}}: the tool's name and the field's
// path in its result. The app fills it in from the result where the words are
// shown (the reply, and the report that quotes it), so no number is mistyped,
// invented or rounded otherwise than the tool rounded it. {{achieved}} is the
// computed verdict on the whole run (the check-verdict module, verdicts/). A reference the reply's
// results cannot fill stays as written; the answer checks send it back.

import type { AgentStep } from "./agent";
import { resultsNewestFirst } from "./evidence";
import { verdicts } from "./verdicts";

/** {{key}}: a letter, then letters, digits and _ . : − (assess_stage.flatten.verdict, dpdf_peaks.features.0.vectors_rlu.0). */
export const REFERENCE = /\{\{\s*([A-Za-z][\w.:-]*)\s*\}\}/g;

/** The references the app fills besides a tool's fields. */
export const NAMED_REFERENCES: Record<string, string> = {
  achieved: "the computed verdict on the whole run: met, not met (and what needs attention) or not judged, with the data's problems no setting fixes",
};

/** A value as the answer shows it: a number or a text as the tool gave it, a list of them in brackets; null for anything else. */
function shown(v: unknown): string | null {
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (typeof v === "string") return v.trim() ? v : null;
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v) && v.length && v.every((x) => typeof x === "number" || typeof x === "string")) return `(${v.join(", ")})`;
  if (Array.isArray(v) && v.length && v.every((x) => Array.isArray(x))) {
    const parts = v.map(shown);
    return parts.every((p) => p !== null) ? parts.join("; ") : null;
  }
  return null;
}

/** The value at `path` (dot-separated keys; whole numbers index lists) in `root`, or undefined. */
function at(root: unknown, path: string[]): unknown {
  let node: unknown = root;
  for (const key of path) {
    if (Array.isArray(node) && /^\d+$/.test(key)) node = node[Number(key)];
    else if (node && typeof node === "object" && !Array.isArray(node)) node = (node as Record<string, unknown>)[key];
    else return undefined;
    if (node === undefined) return undefined;
  }
  return node;
}

/** One reference's text, or null when this reply's results hold no such value. */
export function resolveReference(key: string, steps: readonly AgentStep[]): string | null {
  if (key === "achieved") return verdicts({ reply: steps }).achieved?.text ?? null;
  const [tool, ...path] = key.split(".");
  if (!path.length) return null;
  // The newest result of that tool that holds the field (an assess_stage for
  // the flatten, not the one for the rings after it).
  for (const { result } of resultsNewestFirst(steps, tool)) {
    const v = at(result, path);
    if (v !== undefined) return shown(v);
  }
  return null;
}

/** The text with each reference the results can fill filled in, and those they cannot (as written, without braces). */
export function fillReferences(text: string, steps: readonly AgentStep[]): { text: string; unknown: string[]; filled: number } {
  if (!text.includes("{{")) return { text, unknown: [], filled: 0 };
  const unknown: string[] = [];
  let filled = 0;
  const out = text.replace(REFERENCE, (whole, key: string) => {
    const value = resolveReference(key, steps);
    if (value === null) {
      if (!unknown.includes(key)) unknown.push(key);
      return whole;
    }
    filled += 1;
    return value;
  });
  return { text: out, unknown, filled };
}
