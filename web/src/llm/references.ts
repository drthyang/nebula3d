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
import { numberText } from "./numberText";
import { isTable } from "./tools/shared/table";
import { verdicts } from "./verdicts";

/** {{key}}: a letter, then letters, digits and _ . : − (assess_stage.flatten.verdict, dpdf_peaks.features.0.vectors_rlu.0). */
export const REFERENCE = /\{\{\s*([A-Za-z][\w.:-]*)\s*\}\}/g;

/** The references the app fills besides a tool's fields. */
export const NAMED_REFERENCES: Record<string, string> = {
  achieved: "the computed verdict on the whole run: met, not met (and what needs attention) or not judged, with the data's problems no setting fixes",
};

/**
 * A value as the answer shows it: a number or a text as the tool gave it, a
 * list of them in brackets; null for anything else. A number the tool handed
 * over whole is written as the app writes numbers (numberText): float noise
 * rounded, a tiny one in exponent form, never 0.000003141592653589793.
 */
function shown(v: unknown): string | null {
  if (typeof v === "number") return Number.isFinite(v) ? numberText(v) : null;
  if (typeof v === "string") return v.trim() ? v : null;
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v) && v.length && v.every((x) => typeof x === "number" || typeof x === "string")) return `(${v.join(", ")})`;
  if (Array.isArray(v) && v.length && v.every((x) => Array.isArray(x))) {
    const parts = v.map(shown);
    return parts.every((p) => p !== null) ? parts.join("; ") : null;
  }
  return null;
}

/**
 * The value at `path` (dot-separated keys; whole numbers index lists) in
 * `root`, or undefined. A column table (tools/shared/table.ts) is read as the
 * list of its rows, and a row's value by its column's name or index:
 * {{radial_profile.shells.3.flattened}}, {{radial_profile.shells.rows.3.0}}.
 */
export function valueAt(root: unknown, path: readonly string[]): unknown {
  const index = (key: string) => (/^\d+$/.test(key) ? Number(key) : null);
  let node: unknown = root;
  // The columns of the table whose rows (`rows`) or one row (`row`) `node` is.
  let cols: readonly string[] | null = null;
  let at: "rows" | "row" | null = null;
  for (const key of path) {
    if (isTable(node) && (key === "rows" || index(key) !== null)) {
      cols = node.cols;
      at = "rows";
      node = node.rows;
      if (key === "rows") continue;
    }
    if (at === "rows" && Array.isArray(node) && index(key) !== null) {
      node = node[index(key)!];
      at = "row";
    } else if (at === "row" && Array.isArray(node) && cols) {
      const i = index(key) ?? cols.indexOf(key);
      node = i >= 0 ? node[i] : undefined;
      [cols, at] = [null, null];
    } else if (Array.isArray(node) && index(key) !== null) {
      node = node[index(key)!];
      [cols, at] = [null, null];
    } else if (node && typeof node === "object" && !Array.isArray(node)) {
      node = (node as Record<string, unknown>)[key];
      [cols, at] = [null, null];
    } else return undefined;
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
    const v = valueAt(result, path);
    if (v !== undefined) return shown(v);
  }
  return null;
}

const WORD = /[\p{L}\p{N}]/u;

/**
 * `before` without the lead-in it ends on when the filled value starts with the
 * same words: a model that writes "likely Cu: {{assess_stage.rings.stage_phases}}"
 * would otherwise show "likely Cu: likely Cu: …". The lead-in is
 * whole words, at least 8 characters, matched without regard to case; the
 * quote or bracket between it and the reference stays.
 */
export function dropRepeatedLead(before: string, value: string): string {
  const gap = /[\s"“'‘(]*$/.exec(before)![0];
  const head = before.slice(0, before.length - gap.length);
  const lower = head.toLowerCase();
  for (let k = Math.min(value.length, 80); k >= 8; k--) {
    if (k < value.length && WORD.test(value[k]) && WORD.test(value[k - 1])) continue; // whole words only
    const lead = value.slice(0, k).trimEnd();
    if (lead.length < 8 || !lower.endsWith(lead.toLowerCase())) continue;
    const cut = head.length - lead.length;
    if (cut > 0 && WORD.test(head[cut - 1])) continue; // it must start a word
    const rest = head.slice(0, cut).replace(/\s+$/, "");
    if (!rest) return gap.trimStart();
    return rest + (/^\s/.test(gap) ? gap : ` ${gap}`);
  }
  return before;
}

/** The text with each reference the results can fill filled in, and those they cannot (as written, without braces). */
export function fillReferences(text: string, steps: readonly AgentStep[]): { text: string; unknown: string[]; filled: number } {
  if (!text.includes("{{")) return { text, unknown: [], filled: 0 };
  const unknown: string[] = [];
  let filled = 0;
  let out = "";
  let pos = 0;
  for (const m of text.matchAll(REFERENCE)) {
    const [whole, key] = m;
    const value = resolveReference(key, steps);
    out += text.slice(pos, m.index);
    pos = m.index + whole.length;
    if (value === null) {
      if (!unknown.includes(key)) unknown.push(key);
      out += whole;
      continue;
    }
    filled += 1;
    out = dropRepeatedLead(out, value) + value;
  }
  return { text: out + text.slice(pos), unknown, filled };
}
