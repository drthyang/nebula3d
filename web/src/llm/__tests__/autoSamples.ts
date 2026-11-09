// An auto run's digest at its longest (auto/prompts.ts), for the token budget
// (tokenBudget.test.ts: "auto: worst fix", "auto: report") and the
// model-visible snapshot: every row before the reply's own worded at its
// longest, and the since line's most decisions (SINCE_MAX), the longest a
// card makes among them (the modulation declined, in words). Synthetic only.

import type { Decision } from "../apply/decisions";
import { SINCE_MAX } from "../apply/since";
import { freshPlan, isStage, type PlanRow, type Stage } from "../auto/plan";
import { digest } from "../auto/prompts";
import { sampleCards } from "./sinceSamples";

const decision = (d: Partial<Decision> & Pick<Decision, "id" | "proposal" | "kind" | "title" | "shown" | "action">): Decision => ({
  by: "auto",
  at: 0,
  before: {},
  after: {},
  ...d,
});

/** The run's decisions, as many as the since line lists: yours and auto mode's, the modulation declined among them. */
export function runDecisions(): { decisions: Decision[]; proposals: ReturnType<typeof sampleCards>[keyof ReturnType<typeof sampleCards>][] } {
  const { modulation, punch, rings } = sampleCards();
  const ds: Decision[] = [
    decision({ id: "D1", proposal: "P8", kind: "run", title: "Run of what is missing or stale", shown: { from: "", to: "auto mode's run" }, action: "apply" }),
    decision({ id: "D2", proposal: modulation.id, kind: "fact", title: modulation.title, shown: modulation.shown, action: "dismiss", by: "you" }),
    decision({ id: "D3", proposal: rings.id, kind: "setting", title: rings.title, shown: rings.shown, action: "apply", runFrom: "rings" }),
    decision({ id: "D4", proposal: "P9", kind: "run", title: "Run from Ring removal", shown: { from: "", to: "auto mode's run" }, action: "apply", runFrom: "rings" }),
    decision({ id: "D5", proposal: rings.id, kind: "setting", title: rings.title, shown: { from: rings.shown.to, to: rings.shown.from }, action: "undo", undoes: "D3" }),
    decision({ id: "D6", proposal: "P10", kind: "run", title: "Run from Ring removal", shown: { from: "", to: "auto mode's run" }, action: "apply", runFrom: "rings" }),
    decision({ id: "D7", proposal: punch.id, kind: "setting", title: punch.title, shown: punch.shown, action: "apply", runFrom: "punch" }),
    decision({ id: "D8", proposal: "P11", kind: "run", title: "Run from Bragg punch", shown: { from: "", to: "auto mode's run" }, action: "apply", runFrom: "punch" }),
  ];
  if (ds.length !== SINCE_MAX) throw new Error("the sample lists as many decisions as the since line does");
  return { decisions: ds, proposals: [modulation, punch, rings] };
}

// Each row's longest words: still needing attention after two fixes.
const worded = (r: PlanRow): PlanRow =>
  r.id === "preflight" || r.id === "run" ? { ...r, status: "done" } : isStage(r.id) ? { ...r, status: "attention", tries: 2 } : r;

/** The digest a fix of `stage` reads at its longest (its second try), or (null) the report's. */
export function longestDigest(stage: Stage | null): string {
  const plan = freshPlan();
  const at = stage ? plan.findIndex((r) => r.id === stage) : plan.length - 1;
  const rows = plan.map((r, i) => (i < at ? worded(r) : i === at && stage ? { ...r, status: "fixing" as const, tries: 2 } : r));
  const { decisions, proposals } = runDecisions();
  // The report's, after a chat that ran a check the report does not run again.
  return digest({ plan: rows, fixesPerStage: 2, limit: stage ? null : "time", decisions, proposals, ...(stage ? {} : { chatChecks: CHAT_CHECKS }) });
}

/** A check the chat made before the run that the report's seeded checks do not run again, by its label (controller.ts, checksBeforeRun): the run 3 pre-run's. */
export const CHAT_CHECKS = ["Compared the Laue classes by R_int"];
