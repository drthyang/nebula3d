// What an auto run adds to its report (docs/pilot-auto-mode-design.md §2.2):
// the plan with each row's outcome and the checks' own lines it rests on,
// the facts asked and how you answered, the ring changes held, the limit
// that ended the fixes, and the replies, tokens, spend and time. The report
// itself (report/collect.ts) is the usual one: a fresh pass with the tools,
// the figures, the settings and the decision log, auto mode's decisions in
// it as auto mode's. Pure: the run's record in, the section out. The model
// reads none of it.

import { clockLine } from "../clock";
import type { ReportAuto } from "../report/report";
import { usageText } from "../usage";
import { usd } from "./cost";
import { LIMIT_WORDS } from "./plan";
import type { AutoRun } from "./store";

const ANSWER = { open: "not answered", applied: "applied by you", declined: "declined by you: an open question" } as const;

/** The run's section of its report. */
export function autoReportSection(r: AutoRun, now: number): ReportAuto {
  return {
    plan: r.plan.map((row) => ({
      row: row.title,
      outcome: row.detail ?? row.status,
      evidence: (row.evidence ?? []).map((e) => (e.text ? `${e.label}: ${e.text}` : e.label)).join(" · "),
    })),
    facts: r.facts.map((f) => ({ fact: `${f.title}: ${f.shown}`, answer: ANSWER[f.status] })),
    held: r.held.map((h) => `${h.title}: held by the ring gate (no 3D verdict of a ring left), never asked`),
    ended: r.ended ?? (r.state === "done" ? "Done." : `Not finished: ${r.state}.`),
    limit: r.limit ? `The fixes ended at ${LIMIT_WORDS[r.limit]}.` : null,
    replies: `${r.replies} of ${r.limits.replies} model replies`,
    tokens: usageText(r.usage),
    cost: r.costUsd === null ? null : `${usd(r.costUsd)} of ${usd(r.limits.costUsd)}`,
    time: clockLine(r.clock, now),
  };
}
