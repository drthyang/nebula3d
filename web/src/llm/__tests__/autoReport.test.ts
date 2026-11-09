// An auto run's record outside the run: its section of the report (auto/report.ts,
// report/render.ts) and its place in a session file (state/session.ts): saved
// with the conversation, read back value by value, stopped, its steps never
// evidence for a later reply. Synthetic only.

import { describe, expect, it } from "vitest";

import { captureSession, parseSession } from "../../state/session";
import { APP_REPORT_TURN, appReportQuestion, appReportTurn, autoReportSection, isAutoReportTurn } from "../auto/report";
import { problemsText } from "../auto/problems";
import { newRun, readAutoRun, restoreAutoRun, useAutoStore, type AutoRun } from "../auto/store";
import { startClock, stopClock } from "../clock";
import { reportHtml, reportMarkdown } from "../report/render";
import { buildReport } from "../report/report";

const M = 60_000;

function sampleRun(): AutoRun {
  const r = newRun({ id: "A1", dataset: "synthetic_a", clock: startClock(0, 30 * M), limits: { minutes: 30, fixesPerStage: 2, replies: 12, costUsd: 2, fixRounds: 6, reportRounds: 4 }, snapshot: { punchMinSig: "" }, costUsd: 0.4213 });
  return {
    ...r,
    state: "done",
    limit: "time",
    ended: "Ended at the time limit, with its report.",
    replies: 4,
    usage: { input: 52_000, output: 2_100, cacheRead: 30_000, cacheWrite: 0, requests: 9, estimated: 0 },
    clock: stopClock({ ...r.clock, pausedMs: 5 * M }, 14 * M),
    plan: r.plan.map((row) =>
      row.id === "punch"
        ? { ...row, status: "fixed", tries: 1, detail: "passed after its first fix", evidence: [{ step: "auto:A1:7", label: "Assessed a stage", text: "Bragg punch: meets its goal" }] }
        : row.id === "backfill"
          ? { ...row, status: "skipped", detail: "not checked: the time limit" }
          : row,
    ),
    facts: [{ proposal: "P2", title: "Laue class", shown: "none → 4/mmm", status: "declined" }],
    held: [{ proposal: "P5", title: "Ring model" }],
    steps: [{ id: "auto:A1:1", name: "assess_stage", args: { stage: "punch" }, status: "done", summary: "Bragg punch: needs attention", result: '{"punch":{"verdict":"needs attention"}}' }],
  };
}

describe("the report of an auto run", () => {
  it("sets a fixed stage's checks from before its fixes beside the latest (the run record, not the reply's trimmed context)", () => {
    const r = sampleRun();
    const before = [{ step: "auto:A1:3", label: "Checked the flatten", text: "Flatten: needs attention · trend 0.91 · span 0.85 · pedestal left" }];
    const after = [{ step: "auto:A1:9", label: "Checked the flatten", text: "Flatten: needs attention · trend 0.85 · span 0.86 · pedestal left" }];
    const plan = r.plan.map((row) => (row.id === "flatten" ? { ...row, status: "attention" as const, tries: 2, before, evidence: after } : row.id === "pdf" ? { ...row, status: "passed" as const, before: after, evidence: after } : row));
    const a = autoReportSection({ ...r, plan }, 99 * M);
    expect(a.plan.find((p) => p.row === "Background correction")!.evidence).toBe(
      "Before its fixes: Checked the flatten: Flatten: needs attention · trend 0.91 · span 0.85 · pedestal left. After: Checked the flatten: Flatten: needs attention · trend 0.85 · span 0.86 · pedestal left",
    );
    // A stage the run did not fix reads its checks once.
    expect(a.plan.find((p) => p.row === "3D-ΔPDF")!.evidence).toBe("Checked the flatten: Flatten: needs attention · trend 0.85 · span 0.86 · pedestal left");
  });

  it("lists the plan with each outcome and its evidence, the facts and their answers, the held changes, the limit and the use", () => {
    const a = autoReportSection(sampleRun(), 99 * M);
    expect(a.plan.find((p) => p.row === "Bragg punch")).toEqual({ row: "Bragg punch", outcome: "passed after its first fix", evidence: "Assessed a stage: Bragg punch: meets its goal" });
    expect(a.plan.find((p) => p.row === "Backfill")!.outcome).toBe("not checked: the time limit");
    expect(a.facts).toEqual([{ fact: "Laue class: none → 4/mmm", answer: "declined by you: an open question" }]);
    expect(a.held).toEqual(["Ring model: held by the ring gate (no 3D verdict of a ring left), never asked"]);
    expect(a.limit).toBe("The fixes ended at the time limit.");
    expect([a.replies, a.cost, a.time]).toEqual(["4 of 12 model replies", "$0.42 of $2.00", "Took · 9:00 · paused 5:00 · total 14:00"]);
    expect(a.tokens).toMatch(/^52,000 tokens in \(30,000 read from the prompt cache\) · 2,100 out · 9 requests$/);

    const report = buildReport({
      created: new Date(0),
      question: "Auto · the report",
      answer: "The punch passed after its fix.",
      steps: [],
      model: { provider: "Ollama", model: "gemma4:26b", local: true },
      dataset: { label: "synthetic_a", rawName: "a.nxs", temperature: null },
      settings: [],
      sampleFacts: {},
      tuning: null,
      measured: {},
      figures: [],
      auto: a,
    });
    const md = reportMarkdown(report);
    expect(md).toContain("## Auto run");
    expect(md).toContain("| Bragg punch | passed after its first fix | Assessed a stage: Bragg punch: meets its goal |");
    expect(md).toContain("- Asked: Laue class: none → 4/mmm (declined by you: an open question).");
    expect(md).toContain("- The fixes ended at the time limit.");
    const html = reportHtml(report);
    expect(html).toContain("<h2>Auto run</h2>");
    expect(html).toContain("<td>passed after its first fix</td>");
  });
});

describe("the app's own report of a run Stop ended", () => {
  const stopped = (): AutoRun => ({
    ...sampleRun(),
    limit: null,
    appReport: "stopped",
    ended: "Stopped by you: the app's report, from what the run checked, with no model reply.",
    problems: ["the UB is turned by 0.601° (ub_check)"],
  });

  it("stands on no chat turn, with the run's steps and no words, says why in its question, and is marked stopped by you", () => {
    const r = stopped();
    const turn = appReportTurn(r);
    expect(turn).toEqual({ id: APP_REPORT_TURN, role: "assistant", content: "", steps: r.steps });
    expect(isAutoReportTurn(r, turn)).toBe(true);
    expect(isAutoReportTurn({ ...r, appReport: null }, turn)).toBe(false);
    expect(appReportQuestion(r)).toBe("Auto analysis, stopped by you: the app's report from what the run checked, with no model reply.");
    expect(appReportQuestion({ ...r, appReport: "limit", limit: "replies" })).toBe("Auto analysis: the app's report, with no model reply (the limit on model replies).");
    const report = buildReport({
      created: new Date(0),
      question: appReportQuestion(r),
      answer: turn.content,
      steps: [],
      model: { provider: "Ollama", model: "gemma4:26b", local: true },
      dataset: { label: "synthetic_a", rawName: "a.nxs", temperature: null },
      settings: [],
      sampleFacts: {},
      tuning: null,
      measured: {},
      figures: [],
      auto: autoReportSection(r, 99 * M),
    });
    const md = reportMarkdown(report);
    expect(md).toContain("> Auto analysis, stopped by you: the app's report from what the run checked, with no model reply.");
    expect(md).toContain("- Stopped by you: the app's report, from what the run checked, with no model reply.");
    // The problems the checks found: the app's list, computed, never the model's.
    expect(md).toContain("## Problems the checks found\n\n*Computed from the checks' verdicts, not from the model's words.*\n\n- the UB is turned by 0.601° (ub_check)\n");
    expect(reportHtml(report)).toContain("<h2>Problems the checks found</h2>");
    // No model wrote it: no summary of the model's.
    expect(md).not.toContain("## The model's summary");
    expect(report.narrative).toBe("");
  });

  it("says so when the checks found no problem, or checked nothing", () => {
    expect(autoReportSection({ ...stopped(), problems: [] }, 0).problems).toEqual(["none found by the checks"]);
    expect(autoReportSection({ ...stopped(), problems: null }, 0).problems).toEqual(["none: the run checked nothing"]);
    expect(autoReportSection({ ...stopped(), problems: undefined }, 0).problems).toBeUndefined();
    expect(problemsText([])).toBe("Problems the checks found:\n- none found by the checks");
  });

  it("is kept over a reload and in a session file", () => {
    const back = readAutoRun(JSON.parse(JSON.stringify(stopped())), { fromFile: false })!;
    expect(back.appReport).toBe("stopped");
    expect(back.problems).toEqual(["the UB is turned by 0.601° (ub_check)"]);
    expect(readAutoRun({ ...JSON.parse(JSON.stringify(stopped())), appReport: "bogus" }, { fromFile: true })!.appReport).toBeNull();
  });
});

describe("an auto run in a session file", () => {
  it("is saved with the conversation and read back stopped where it was under way, its steps marked restored", () => {
    useAutoStore.setState({ run: { ...sampleRun(), state: "running", at: "punch", clock: { ...sampleRun().clock, endedAt: null } } });
    const file = JSON.stringify(captureSession(undefined));
    const session = parseSession(file);
    expect(session.auto?.id).toBe("A1");
    expect(session.auto?.steps.every((s) => s.restored)).toBe(true);
    restoreAutoRun(session.auto ?? null);
    expect(useAutoStore.getState().run).toMatchObject({ state: "stopped", now: "Stopped: the page reloaded." });
    expect(useAutoStore.getState().run!.plan.find((r) => r.id === "punch")!.status).toBe("fixed");
    // A file from before auto mode has none, and a malformed record is none.
    const old = JSON.parse(file) as Record<string, unknown>;
    delete old.auto;
    expect(parseSession(JSON.stringify(old)).auto).toBeUndefined();
    expect(readAutoRun({ ...JSON.parse(file).auto, plan: "no" }, { fromFile: true })!.plan.every((r) => r.status === "pending")).toBe(true);
    expect(readAutoRun({ id: 1 }, { fromFile: true })).toBeNull();
    useAutoStore.setState({ run: null });
  });
});
