// The "since the last reply" line (docs/pilot-auto-mode-design.md §1.4): what
// the user's decisions on the Apply cards changed since the model last
// replied, as one terse line at the end of the next request's context (the
// first user message, which is rebuilt for every request; never the latest,
// so the sample-fact guard's userMessage is the user's own words alone). It is
// sent with that one reply's requests, then marked as told (decisions.ts,
// markTold), and the replies after it carry it only as their own text did.
//
// Facts alone (THY-18): what changed, its values before and after, and who
// changed it; no verdict, no advice. A declined change names the value kept
// first, by the setting's name, then the value declined ("kept
// ringPooledSectors 72, declined 32"): worded "declined ringPooledSectors
// 72 → 32 (kept 72)", gemma4:26b proposed the 32 again in one of two runs of
// a local smoke test, and in none of three as it is now.
// The setting's name is update_settings' (the model's own word for it), the
// values as update_settings reads them (the card's line); a run, the stage
// run_pipeline names. Nothing of a click grant (llm/consent.ts): a change the
// user's own click made reads as any other they made. A change made on a
// page, not a card (the Q–R page's "Use in pipeline": decisions.ts, `page`),
// is left out, as an edit on Configure is. A definition (a fact
// about the settings), so arm C reads it the same as arm B (inference.ts).

import type { PipelineConfig } from "../../state/pipelineStore";
import type { Decision } from "./decisions";
import { cardSetting, type Proposal } from "./proposals";

/** At most this many decisions are listed, the newest; the rest are counted. */
export const SINCE_MAX = 8;

const text = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));

// A setting's value as update_settings reads it, from the form's fields (a
// trial's are the stage's method settings, one field each).
const valueOf = (key: string, fields: Partial<PipelineConfig>): string => {
  const c = cardSetting(key);
  const raw = fields[key as keyof PipelineConfig];
  return c ? text(c.read({ ...fields } as PipelineConfig)) : text(raw ?? "");
};

// A trial's changes: each field it changed, before → after.
const fieldChanges = (d: Decision): string =>
  Object.keys(d.after)
    .map((k) => `${k} ${valueOf(k, d.before)} → ${valueOf(k, d.after)}`)
    .join(", ");

// What the card changes, by update_settings' name: one setting's key, else
// the card's own name (the |Q| band, which is two).
const nameOf = (d: Decision, p: Proposal | undefined): string => {
  const keys = p ? Object.keys(p.change) : [];
  return keys.length === 1 ? keys[0] : d.title;
};

/** One decision, as the line lists it (without who made it). */
export function sinceItem(d: Decision, p: Proposal | undefined): string {
  if (d.kind === "run") return d.action === "dismiss" ? `declined the run from ${d.runFrom ?? "the start"}` : `ran the pipeline from ${d.runFrom ?? "the start"}`;
  if (d.kind === "trial") {
    const trial = p?.trial ? `${p.trial.stage} trial #${p.trial.n}` : d.title;
    if (d.action === "dismiss") return `declined ${trial} (${d.shown.to})`;
    return `${d.action === "undo" ? "undid" : "applied"} ${trial}: ${fieldChanges(d)}`;
  }
  const name = nameOf(d, p);
  const change = `${name} ${d.shown.from} → ${d.shown.to}`;
  if (d.action === "dismiss") return `kept ${name} ${d.shown.from}, declined ${d.shown.to}`;
  if (d.action === "undo") return `undid ${change}`;
  if (d.action === "edit-apply") {
    // The value the reply proposed, where it is one value (not the modulation's declaration).
    const v = p && Object.keys(p.change).length === 1 ? Object.values(p.change)[0] : null;
    // (a session file keeps the declaration as its JSON text)
    const proposed = v !== null && typeof v !== "object" && !String(v).startsWith("{") ? text(v) : null;
    return `applied ${change} (edited${proposed && proposed !== d.shown.to ? ` from the proposed ${proposed}` : ""})`;
  }
  return `applied ${change}`;
}

const WHO: Record<Decision["by"], string> = { you: "you", auto: "auto mode" };

/**
 * The line for `decisions` (those since the last reply, oldest first), or null
 * when there are none. Who made each is named where it changes: "you applied
 * A; declined B; auto mode applied C". `lead`: the words before them, "since
 * the last reply" unless given (an auto run's digest: "in this auto run",
 * auto/prompts.ts).
 */
export function sinceLine(all: readonly Decision[], proposals: readonly Proposal[], lead = "since the last reply"): string | null {
  // A change made on a page (decisions.ts, `page`) is the user's own edit, as one on Configure: not listed.
  const decisions = all.filter((d) => !d.page);
  if (!decisions.length) return null;
  const listed = decisions.slice(-SINCE_MAX);
  const earlier = decisions.length - listed.length;
  let by: Decision["by"] | null = null;
  const items = listed.map((d) => {
    const item = sinceItem(d, proposals.find((p) => p.id === d.proposal));
    const who = d.by === by ? "" : `${WHO[d.by]} `;
    by = d.by;
    return who + item;
  });
  return `- ${lead}, ${items.join("; ")}${earlier ? ` (and ${earlier} earlier)` : ""}`;
}
