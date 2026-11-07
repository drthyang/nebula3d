// The problems an auto run's checks found (the THY-65 follow-up): computed
// from the final checks' outcomes, never written by the model, so the
// report's list can raise no false alarm and grade nothing itself (THY-18).
// It is what {{achieved}} reads (verdicts/readers.ts): each check that needs
// attention, with its reasons, and each of the data's problems that no
// setting fixes, each with the tool that found it. A ring the ring check does
// not flag is not listed: the list names what a check found, and nothing more.
// The report reply's prompt (prompts.ts) leaves the problems to this list.
// Pure: the run's steps in, the lines out. UI and the report only.

import type { AgentStep } from "../agent";
import { attentionLabel, verdicts } from "../verdicts";
import { outcomesOf } from "../verdicts/recorded";
import type { Outcome } from "../verdicts/rules";

/** The section's title, in the chat, the panel and the report. */
export const PROBLEMS_TITLE = "Problems the checks found";
/** Its one line when the checks found none. */
export const NO_PROBLEMS = "none found by the checks";

/** The tool a step is, as the list names it: assess_stage with its stage. */
const toolRef = (step: AgentStep, o: Outcome): string => (step.name === "assess_stage" ? `assess_stage ${o.check}` : step.name);

/**
 * The problems `steps` (the run's, oldest first) found, as {{achieved}} reads
 * them, each with its tool: "the ring removal needs attention: ring left
 * (assess_stage rings)", "the UB is turned by 0.601° (ub_check)". Empty when
 * they found none; null when they judged nothing (a run stopped before its
 * first check).
 */
export function problemsFound(steps: readonly AgentStep[]): string[] | null {
  const v = verdicts({ reply: steps }).achieved;
  if (!v) return null;
  const newestFirst = steps.map((s) => ({ s, outcomes: outcomesOf(s) })).reverse();
  const find = (pred: (o: Outcome) => boolean): { s: AgentStep; o: Outcome } | null => {
    for (const { s, outcomes } of newestFirst) {
      const o = outcomes.find(pred);
      if (o) return { s, o };
    }
    return null;
  };
  const lines: string[] = [];
  for (const label of v.attention) {
    const hit = find((o) => o.kind === "attention" && attentionLabel(o.check) === label);
    const why = hit?.o.reasons.length ? `: ${hit.o.reasons.join(", ")}` : "";
    lines.push(`${label} needs attention${why}${hit ? ` (${toolRef(hit.s, hit.o)})` : ""}`);
  }
  for (const problem of v.dataProblems) {
    const hit = find((o) => o.dataProblems.includes(problem));
    lines.push(`${problem}${hit ? ` (${toolRef(hit.s, hit.o)})` : ""}`);
  }
  return [...new Set(lines)];
}

/** Its one line when the run checked nothing. */
export const NOTHING_CHECKED = "none: the run checked nothing";

/** The section's lines as shown: a line a problem, or the one line that says there are none. */
export const problemLines = (lines: readonly string[] | null): string[] => (lines === null ? [NOTHING_CHECKED] : lines.length ? [...lines] : [NO_PROBLEMS]);

/** The section as plain text: its title, then a line a problem, or the one line that says there are none. */
export const problemsText = (lines: readonly string[] | null): string => `${PROBLEMS_TITLE}:\n${problemLines(lines).map((l) => `- ${l}`).join("\n")}`;
