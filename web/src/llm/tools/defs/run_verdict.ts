// run_verdict: the verdict on the run as {{achieved}} would give it now (plan
// 4.6), so a model reads it before it writes. It reads the check-verdict
// module's achieved reader (verdicts/) over this reply's steps so far
// (ToolContext's replySteps), the reader and the steps {{achieved}} is filled
// from (references.ts), and never judges anything a second way: the words are
// the reader's, and the rest of the result is the reader's verdict laid out.

import { STAGE_NAMES, STAGES, WORDS, type Kind, type Stage } from "../../verdicts/rules";
import type { ChatTool } from "../types";

/** The run's verdict as the model reads it: what {{achieved}} gives now, and what it rests on. */
interface RunVerdict {
  verdict: string | null; // {{achieved}}'s words, word for word; null: no check in this reply yet, so {{achieved}} has none
  achieved: "met" | "not met" | "not judged";
  stages: Partial<Record<Stage, string>>; // each stage measured as it now is, in the checks' words
  needs_attention: string[];
  not_judged: string[];
  not_measured: string[];
  data_problems: string[];
}

export const run_verdict: ChatTool = {
  name: "run_verdict",
  facts: { label: "Read the run's verdict", acts: null, reachesBackend: false, readsReply: true, measures: false },
  description:
    "The verdict on the run that {{achieved}} gives now, computed from this reply's checks: its words (null before any check), each stage's verdict, what needs attention, is not judged or not measured, and the data's problems no setting fixes. Read it before you write whether the run met its goal.",
  parameters: { type: "object", properties: {} },
  run: async (_args, { replySteps = [] }) => {
    // The reader imports evidence.ts, which imports the registry back: loaded
    // when the tool runs, it puts no tool on an import cycle (imports.test.ts).
    const { verdicts } = await import("../../verdicts");
    const v = verdicts({ reply: replySteps }).achieved;
    const said = (k: Kind | undefined): string | undefined => (k === undefined ? undefined : WORDS.label[k]);
    const result: RunVerdict = v
      ? {
          verdict: v.text,
          achieved: v.achieved === true ? "met" : v.achieved === false ? "not met" : "not judged",
          stages: Object.fromEntries(STAGES.flatMap((s) => (v.stages[s] === undefined ? [] : [[s, said(v.stages[s])]]))),
          needs_attention: v.attention,
          not_judged: v.notJudged ?? [],
          not_measured: v.notMeasured,
          data_problems: v.dataProblems,
        }
      : {
          verdict: null,
          achieved: "not judged",
          stages: {},
          needs_attention: [],
          not_judged: [],
          not_measured: STAGES.map((s) => STAGE_NAMES[s]),
          data_problems: [],
        };
    return { result, summary: result.verdict ?? "not judged: no check in this reply yet" };
  },
};
