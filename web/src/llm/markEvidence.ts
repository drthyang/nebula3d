// What a marked region rests on (THY-44 under THY-18's rule: no mark without
// its evidence). A mark cites the tool calls whose results show the region,
// as the answers cite a number (references.ts): by the tool's name, or the
// tool and a field's path in its result (dpdf_peaks, or
// dpdf_peaks.features.0). Each cited call must have run without an error in
// this conversation (this reply's steps, or an earlier turn's, never one
// brought back from a session file), be a tool that measures the data (its
// facts' `measures`: not a skill, the settings, the log or the view), hold
// the field when one is named, and still stand: measured after the last run
// that recomputed the stage the mark is drawn on (evidence.ts), as a verdict's
// evidence must be. Otherwise the mark is refused, saying which call to make.

import type { MarkWhere } from "../state/markStore";
import type { AgentStep } from "./agent";
import { current, recomputedAt, type PipelineStage } from "./evidence";
import { found } from "./readings";
import { valueAt } from "./references";
import { factsOf, toolsWhere } from "./tools";

/** The most calls one mark cites. */
export const MAX_EVIDENCE = 6;

/** A call a mark rests on: as cited, its tool, and its step's number in this reply (null: an earlier turn's). */
export interface CitedStep {
  ref: string;
  tool: string;
  step: number | null;
}

export type EvidenceCheck = { ok: true; steps: CitedStep[] } | { ok: false; reason: string };

// The pipeline stage whose output each `where` is; the raw volume is no stage's.
const WHERE_STAGE: Record<MarkWhere, PipelineStage | null> = {
  raw: null,
  rings: "rings",
  punch: "punch",
  backfill: "backfill",
  flatten: "flatten",
  pdf: "pdf",
};

const HOW = "name the tool calls whose results show the region, by the tool's name or as tool.field (dpdf_peaks.features.0)";

/**
 * The calls an argument cites: a list of strings, or one string of them
 * separated by commas or semicolons, each trimmed, without {{ }}, each once.
 */
export function evidenceRefs(v: unknown): string[] {
  const items = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;]/) : [];
  const refs = items
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.replace(/^\s*\{\{\s*|\s*\}\}\s*$/g, "").trim())
    .filter(Boolean);
  return [...new Set(refs)];
}

/**
 * Whether `refs` are evidence for a mark on `where`: each a measuring tool's
 * call that ran in this conversation (`reply`, then the earlier turns'
 * `earlier`, newest first), holds the field it names and still stands.
 */
export function checkEvidence(refs: readonly string[], where: MarkWhere, reply: readonly AgentStep[], earlier: readonly AgentStep[] = []): EvidenceCheck {
  if (!refs.length) return { ok: false, reason: `a mark needs its evidence: ${HOW}` };
  if (refs.length > MAX_EVIDENCE) return { ok: false, reason: `cite at most ${MAX_EVIDENCE} calls; got ${refs.length}` };
  const known = new Set(toolsWhere(() => true));
  const steps = [...earlier, ...reply];
  const at = recomputedAt(steps);
  const stage = WHERE_STAGE[where];
  const cited: CitedStep[] = [];
  for (const ref of refs) {
    const [tool, ...path] = ref.split(".");
    if (!known.has(tool)) return { ok: false, reason: `${ref}: no tool is named ${tool}; ${HOW}` };
    if (!factsOf(tool).measures) return { ok: false, reason: `${ref}: ${tool} measures nothing in the data, so no mark rests on it; cite the measurement that shows the region` };
    let hit = -1;
    let stale = false;
    let withoutField = false;
    for (let i = steps.length - 1; i >= 0; i--) {
      const s = steps[i];
      if (s.name !== tool || s.restored) continue;
      const result = found(s); // null: an error, or a result that is not an object
      if (!result) continue;
      if (path.length && valueAt(result, path) === undefined) {
        withoutField = true;
        continue;
      }
      if (!current(at, stage, i)) {
        stale = true;
        continue;
      }
      hit = i;
      break;
    }
    if (hit < 0) {
      const reason = stale
        ? `${ref} was measured before the last run recomputed the ${where} stage: measure it again, then mark what the new result shows`
        : withoutField
          ? `${ref}: no ${tool} result in this conversation has ${path.join(".")}`
          : `${ref}: ${tool} has not run in this conversation; call it, and mark what its result shows`;
      return { ok: false, reason };
    }
    cited.push({ ref, tool, step: hit >= earlier.length ? hit - earlier.length + 1 : null });
  }
  return { ok: true, steps: cited };
}
