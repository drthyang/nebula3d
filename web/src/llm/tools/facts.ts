// What the modules around the model need to know about a tool, beside what the
// model reads: whether it reads or acts, and on what; which later readings it
// may change; the questions a local model is offered it for; the verdicts it
// settles; whether a reply that ran it gets a report; the cards it lights; the
// skill it waits for, and whether it works only with the skills on; whether
// its result reads the reply's own steps; its label in the transcript. One facts object per tool, declared on the tool in its
// own module (tools/defs/<tool_name>.ts), so a tool's facts live beside its
// implementation: adding or changing a tool is one edit, in one place. The
// executor's repeat guard (round.ts), the local offer, the answer checks, the
// report, the transcript, the highlights and the evals read them through the
// registry's interface, factsOf and toolsWhere, instead of each keeping its own
// list of tool names. The model never sees them: toolSpecs sends a tool's
// name, description and parameters only.
//
// A leaf module: it imports only types, so the registry and every module that
// reads the facts can import it without a cycle.

import type { TuneStage } from "../tune/catalog";

type Args = Record<string, unknown>;

/**
 * What a tool changes when it acts: the console's view, the Configure page's
 * settings, the settings by a tuning run, or the outputs by a pipeline run.
 */
export type Act = "view" | "settings" | "tune" | "run";

/** A later reading that may differ once the tool has run. */
export type Reading = "view" | "settings" | "outputs";

/**
 * What a question is about, as localTools.ts reads it from the words; a
 * question that names none of them is "general".
 */
export const ASKED_ABOUT = ["rings", "punch", "backfill", "flatten", "pdf", "lattice", "symmetry", "coverage", "compare", "general"] as const;
export type AskedAbout = (typeof ASKED_ABOUT)[number];

/** The topics an answer's verdicts are held to their evidence on (answerChecks.ts, TOPICS). */
export const VERDICT_TOPICS = ["rings", "punch", "backfill", "flatten", "coverage", "symmetry", "grain", "pdf", "ub", "origin", "features"] as const;
export type VerdictTopic = (typeof VERDICT_TOPICS)[number];

// ---------------------------------------------------------------- highlight keys

// The cards a tool step lights (highlight.ts reads them).
export type HighlightKey =
  | "raw" // the measured volume and its coverage
  | "rings"
  | "punch"
  | "backfill"
  | "flatten"
  | "pdf" // the 3D-ΔPDF transform
  | "check" // the back-FFT consistency check
  | "bragg" // the fitted Bragg peaks
  | "log"; // the run log

export const RECIP: readonly HighlightKey[] = ["rings", "punch", "backfill", "flatten"];
export const ALL_STAGES: readonly HighlightKey[] = [...RECIP, "pdf"];

// Pipeline stage names and stage-output names, as highlight keys.
const STAGE_KEY: Record<string, HighlightKey> = {
  raw: "raw",
  rings: "rings",
  ringremoved: "rings",
  punch: "punch",
  braggpunched: "punch",
  backfill: "backfill",
  backfilled: "backfill",
  flatten: "flatten",
  flattened: "flatten",
  pdf: "pdf",
  delta_pdf: "pdf",
  pdf_check: "check",
};
export const stageKey = (name: string): HighlightKey | undefined => STAGE_KEY[name];

export const keysOf = (names: unknown): HighlightKey[] =>
  Array.isArray(names) ? names.map((n) => stageKey(String(n))).filter((k): k is HighlightKey => Boolean(k)) : [];

// ---------------------------------------------------------------- the facts

/** A fact that is fixed, or that depends on the call's arguments. */
type ByArgs<T> = T | ((args: Args) => T);

/**
 * The skill gate (skills.ts): a call that changes or tunes a stage waits until
 * that stage's skill has been read in this reply.
 */
export interface Gate {
  doing: "change" | "tuning"; // what the refusal calls the call
  stages: (args: Args) => readonly TuneStage[]; // the stages the call changes or tunes
}

/** The facts a tool declares. Every one but its label and `acts` may be left out. */
export interface ToolFacts {
  label: string; // the transcript's line for a step
  runningLabel?: string; // the line while it runs, for a tool long enough to be watched; left out: the label
  // Required, so a tool that acts cannot pass as one that only reads by
  // leaving it out. null: it only reads.
  acts: Act | null;
  reachesBackend?: false; // left out: it needs the server
  invalidates?: readonly Reading[]; // left out: none
  // The questions a local model is offered it for; left out: every question.
  // A tool that acts on the pipeline is offered only when the message asks
  // for an action, whatever this says (localTools.ts).
  offeredFor?: readonly AskedAbout[];
  settles?: ByArgs<readonly VerdictTopic[]>; // the verdicts its result is evidence for; left out: none
  reportable?: true; // a reply that ran it gets a Report button (report/collect.ts)
  highlights?: ByArgs<readonly HighlightKey[]>; // the cards a step lights; left out: none
  gate?: Gate; // left out: no skill gate
  // It works only with the skills on (read_skill): with the switch off
  // (skills.ts, the validation's arm C) it is not offered. Left out: offered either way.
  needsSkills?: true;
  // Its result is computed from this reply's steps before it (ToolContext's
  // replySteps: run_verdict), which every call that runs changes: the repeat
  // guard (round.ts) points a call to it at an earlier one only while no
  // other call has run since. Left out: its result reads the console and the
  // outputs alone.
  readsReply?: true;
}

/** A tool's facts with every field resolved, as factsOf returns them. */
export interface Facts {
  name: string;
  label: string;
  runningLabel: string;
  acts: Act | null;
  actsOnPipeline: boolean; // it changes the settings, or starts a run
  startsRuns: boolean; // it starts pipeline runs on the backend
  reachesBackend: boolean;
  invalidates: readonly Reading[];
  offeredFor: readonly AskedAbout[] | "always";
  settles: (args: Args) => readonly VerdictTopic[];
  reportable: boolean;
  highlights: (args: Args) => readonly HighlightKey[];
  gate: Gate | null;
  needsSkills: boolean;
  readsReply: boolean;
}

const byArgs = <T>(fact: ByArgs<T> | undefined, fallback: T): ((args: Args) => T) =>
  typeof fact === "function" ? (fact as (args: Args) => T) : () => fact ?? fallback;

/**
 * The facts of the tool `name`, every field resolved. Without declared facts
 * (a name the registry does not hold), the fallbacks: labelled by its name,
 * reads only, needs the server, offered for every question, settles nothing.
 */
export function resolveFacts(name: string, declared?: ToolFacts): Facts {
  const acts = declared?.acts ?? null;
  return {
    name,
    label: declared?.label ?? name,
    runningLabel: declared?.runningLabel ?? declared?.label ?? name,
    acts,
    actsOnPipeline: acts === "settings" || acts === "tune" || acts === "run",
    startsRuns: acts === "tune" || acts === "run",
    reachesBackend: declared?.reachesBackend ?? true,
    invalidates: declared?.invalidates ?? [],
    offeredFor: declared?.offeredFor ?? "always",
    settles: byArgs(declared?.settles, []),
    reportable: declared?.reportable ?? false,
    highlights: byArgs(declared?.highlights, []),
    gate: declared?.gate ?? null,
    needsSkills: declared?.needsSkills ?? false,
    readsReply: declared?.readsReply ?? false,
  };
}
