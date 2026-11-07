// What an auto-mode reply reads (docs/pilot-auto-mode-design.md §2.3):
// model-visible, snapshotted in modelVisible.test.ts and held to the token
// budget (tokenBudget.test.ts, "auto: worst fix" and "auto: report"). A reply
// has no chat history: the system prompt with its own round limit, the
// dataset's summary with the run's digest after it (where the "since the
// last reply" line goes, apply/since.ts), and a fixed phase prompt, after
// which the phase's checks come as a round of calls the app made (seeded,
// agent.ts), or in the prompt's message on a transport that refuses that.
//
// The digest holds no measured number (THY-18: a number in the context is a
// number an answer may quote): the plan's outcomes in words, counts in words,
// and the run's decisions as the since line words them, whose values are the
// settings' own. The phase prompts start with a verb, so a local model's
// offer (localTools.ts) holds the tools a fix acts with, or, for the report,
// only the reading ones; they name no fact about the sample, and the reply's
// user words for the sample-fact guard are "" whatever they say
// (controller.ts).

import type { Decision } from "../apply/decisions";
import type { Proposal } from "../apply/proposals";
import { sinceLine } from "../apply/since";
import type { PipelineContext } from "../context/pipelineContext";
import { buildChatMessages } from "../prompts/templates";
import type { ChatMessage } from "../provider/client";
import { STAGE_NAMES } from "../verdicts/rules";
import { countWord, isStage, LIMIT_WORDS, ordinal, type LimitHit, type PlanRow, type Stage } from "./plan";

/**
 * A stage's fix (§2.3): one change, or a tuning of the stage, to make its
 * checks pass. It says the app runs from the change: on the local smoke
 * (gemma4:26b, 2026-11-07) a fix without it called run_pipeline, which a fix
 * does not hold, and spent its rounds.
 */
export function fixPrompt(stage: Stage): string {
  const checks = stage === "backfill" || stage === "pdf" ? "its checks above pass" : "its check above passes";
  return `Change or tune ${STAGE_NAMES[stage]} so ${checks}: one update_settings change, or tune_pipeline for this stage; the app then runs the pipeline from it and checks again. Say what you changed and why, or why no change would help.`;
}

/**
 * The run's report (§2.2): from the final checks above, the problems they
 * found in the data, with their numbers, or none (arm B's task: "the problems
 * you found (or that you found none)"; the core prompt's (6) names the data's
 * own problems: a UB that is off, a shifted origin, counts that end inside
 * the box), each stage's verdict, the run's changes and what is left. A
 * passing stage once hid its data's fault: the B-auto eval of 2026-11-07
 * reported 1 of 6 planted faults when this asked for verdicts alone. The
 * problems are the checks' (THY-18: their verdicts and numbers, by
 * reference, never the model's own grading), and its words name no tool's
 * topic, so a local model's offer (localTools.ts) stays the reading tools
 * every question gets. Held to its ceiling in tokenBudget.test.ts.
 */
export const REPORT_PROMPT =
  "Report from the final checks above: the problems they found in the data, with their numbers, or none; each stage's verdict; what changed and why; and what is left for the user to decide.";

/** The transcript's line for a fix reply (the user turn before it): the app's words, never the user's. */
export const fixLabel = (stage: Stage, n: number, of: number): string => `Auto · fix ${STAGE_NAMES[stage]}, ${ordinal(n)} of ${countWord(of)}`;
export const REPORT_LABEL = "Auto · the report";

/** One row of the plan as the digest words it, or null for a row not reached. */
function rowWords(r: PlanRow, fixesPerStage: number): string | null {
  if (r.id === "preflight") return r.status === "done" ? "preflight done" : null;
  if (r.id === "run") return r.status === "done" ? "the run done" : null;
  if (r.id === "report" || !isStage(r.id)) return null;
  const name = STAGE_NAMES[r.id];
  switch (r.status) {
    case "passed":
      return `${name} passed`;
    case "fixed":
      return `${name} passed after its ${ordinal(r.tries)} fix`;
    case "attention":
      return r.tries ? `${name} still needs attention after ${countWord(r.tries)} fix${r.tries === 1 ? "" : "es"}` : `${name} needs attention, not fixed`;
    case "not judged":
      return `${name} not judged`;
    case "skipped":
      return `${name} not checked`;
    case "fixing":
    case "running":
      return r.tries ? `${name} needs attention: this is its ${ordinal(r.tries)} fix of ${countWord(fixesPerStage)}` : null;
    default:
      return null;
  }
}

/**
 * The run so far, for the next reply's context: the plan's outcomes, the
 * limit that ended the fixes, and the run's decisions (yours and auto
 * mode's), each line as the since line writes one.
 */
export function digest({
  plan,
  fixesPerStage,
  limit,
  decisions,
  proposals,
}: {
  plan: readonly PlanRow[];
  fixesPerStage: number;
  limit: LimitHit | null;
  decisions: readonly Decision[];
  proposals: readonly Proposal[];
}): string {
  const words = plan.map((r) => rowWords(r, fixesPerStage)).filter((w): w is string => !!w);
  const lines = [`- auto run so far: ${words.length ? words.join("; ") : "starting"}`];
  if (limit) lines.push(`- the fixes ended at ${LIMIT_WORDS[limit]}`);
  const since = sinceLine(decisions, proposals, "in this auto run");
  if (since) lines.push(since);
  return lines.join("\n");
}

/** An auto reply's opening messages: no chat history, the digest at the end of the context, the phase prompt last. */
export const autoMessages = (context: PipelineContext, digestText: string, prompt: string, rounds: number): ChatMessage[] =>
  buildChatMessages(context, [], prompt, null, { tools: true, rounds, since: digestText });
