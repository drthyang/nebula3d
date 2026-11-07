// The Auto panel (docs/pilot-auto-mode-design.md §2.6; THY-65 PR 7), above
// the chat while an auto run is open. Its header holds the title, the state,
// the time worked (never against the limit: the user's own bound) and the
// controls, there the whole time: Pause or Resume (Retry after a failure),
// and Stop, which ends the run there with the app's report from what exists
// (no model reply, no cost), marked stopped by you. Under it:
//  - the Now line: what the run is doing at this moment, in plain words
//    ("Checking the Bragg punch (stage 2 of 5)…", "Fixing the ring removal,
//    try 1 of 2", "Waiting for your answer: Laue class");
//  - a thin progress bar;
//  - the plan, one row a phase in the NeXus Viewer's Processing style (a
//    status dot, the name, the state right-aligned in mono), each row a link
//    to its latest step in the chat and the highlights that step drew;
//  - the activity log, one row a step with its status and one line of what
//    was decided, its detail (the evidence, the settings changed, the reply)
//    behind a click;
//  - the replies, fixes, tokens and spend, and the time waiting for you apart;
//  - the fact the run waits for, pinned with Apply, Edit and Skip; once it
//    ends, its report (the reply in the chat, or the app's own, opened here)
//    and Undo auto changes.
// The Now line and the log are built from the run's own record, results and
// decisions (auto/activity.ts): nothing is asked of the model. In the sheet
// layout (a phone, a narrow window) the panel shows the header, the Now line
// and the last three steps, and opens to the plan and the whole log.
// The dock's chip (AutoChip) starts a run, and pauses one under way.

import { useEffect, useMemo, useRef, useState } from "react";

import { useDatasets } from "../../api/hooks";
import { HelpTip } from "../../components/ui";
import { useDatasetStore } from "../../state/datasetStore";
import { useNavStore } from "../../state/navStore";
import type { AgentStep } from "../agent";
import { endAuto, resumeAuto, startAuto, stopAuto, undoAutoRun } from "../auto/controller";
import { usd } from "../auto/cost";
import { appReportQuestion, appReportTurn } from "../auto/report";
import { activity, type Activity, type ActivityRow } from "../auto/activity";
import { clockText, compact, pausedText, progressOf, rowMeta, rowSub, rowTone, STATE_WORD, TITLES } from "../auto/panel";
import { AUTO_LIMITS, LIMIT_WORDS, type PlanRow } from "../auto/plan";
import { useAutoStore, type AutoRun } from "../auto/store";
import { useDecisionStore } from "../apply/decisions";
import { useChatStore } from "../chatStore";
import { type RunClock } from "../clock";
import { useTuneStore } from "../tune/tuner";
import { drawsOverlays } from "../examine/overlays";
import { showStep } from "../examine/store";
import type { ToolContext } from "../tools";
import { openView } from "../tools/openView";
import { loadSettings } from "../settings";
import { goToStep } from "./goToStep";
import { PinnedCard } from "./ProposalCards";
import { ReportView } from "./ReportView";

/** The time now, each second until the clock stops (while it waits for you too: the paused time grows). */
function useNow(clock: RunClock | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  const ticking = !!clock && clock.endedAt === null;
  useEffect(() => {
    // Read again as the clock changes (a pause, a resume): never a stale second.
    setNow(Date.now());
    if (!ticking) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [ticking, clock]);
  return Math.max(now, clock?.startedAt ?? 0);
}

/** Scroll to a row's latest step in the chat, and show what it drew on the views. */
function useRowLink() {
  const datasets = useDatasets().data;
  const datasetId = useDatasetStore((s) => s.datasetId);
  return (run: AutoRun, row: PlanRow) => {
    const ids = (row.evidence ?? []).map((e) => e.step);
    const steps = ids.map((id) => run.steps.find((s) => s.id === id)).filter((s): s is AgentStep => !!s);
    if (!steps.length) return;
    const drawn = [...steps].reverse().find((s) => drawsOverlays(s.name) && !s.restored);
    const target = drawn ?? steps[steps.length - 1];
    if (drawn) {
      if (drawn.view) openView(drawn.view);
      showStep(drawn, null, run.steps.indexOf(drawn) + 1, datasets?.find((d) => d.id === datasetId));
    }
    goToStep(null, target.id);
  };
}

function Row({ run, row, onLink }: { run: AutoRun; row: PlanRow; onLink: (run: AutoRun, row: PlanRow) => void }) {
  // The row a fact holds back: "needs you", and the fact on the right.
  const pause = run.state === "paused" && run.pause?.kind === "fact" && run.pause.before === row.id ? run.pause : null;
  const fact = pause ? run.facts.find((f) => f.proposal === pause.proposal) : undefined;
  const tone = pause ? "wait" : rowTone(row.status);
  const sub = pause ? "needs you" : rowSub(row, run.limits.fixesPerStage);
  const meta = pause ? (fact?.title ?? "") : rowMeta(row);
  const linked = (row.evidence ?? []).length > 0;
  return (
    <li id={`ai-auto-row-${row.id}`} className={`auto-step is-${tone}`}>
      <button
        type="button"
        className="auto-step-btn"
        disabled={!linked}
        onClick={() => onLink(run, row)}
        title={[row.detail, linked ? "Show its latest step in the chat, and what it drew on the views" : null].filter(Boolean).join(" · ") || undefined}
      >
        <span className="dot" aria-hidden="true" />
        <span className="auto-step-name">
          {TITLES[row.id]}
          {sub && <span className="sub"> · {sub}</span>}
        </span>
        <span className="meta">{meta}</span>
      </button>
    </li>
  );
}

/** The run's state, as the panel names it: a pause by you is "Paused" (Resume goes on); a run Stop ended, "Stopped". */
const stateWord = (run: AutoRun): string =>
  run.state === "paused"
    ? run.pause?.kind === "failure"
      ? "Failed"
      : "Needs you"
    : run.state === "stopped"
      ? "Paused"
      : run.state === "done" && run.appReport === "stopped"
        ? "Stopped"
        : STATE_WORD[run.state];

/**
 * The controls, there while the run is open: Pause (the step under way
 * stops; Resume restarts it), or Resume (Retry after a failure); and Stop,
 * which ends the run where it is, with the app's report from what exists.
 */
function Controls({ run, ctx }: { run: AutoRun; ctx: ToolContext | null }) {
  if (run.state === "done") return null;
  const failure = run.pause?.kind === "failure";
  const fact = run.pause?.kind === "fact";
  return (
    <span className="auto-actions">
      {run.state === "running" || fact ? (
        <button
          type="button"
          className="auto-btn"
          disabled={fact}
          onClick={stopAuto}
          title={fact ? "It is waiting for your answer: the clock is stopped already" : "Pause after stopping the step under way; Resume restarts it"}
        >
          Pause
        </button>
      ) : (
        <button
          type="button"
          className="auto-btn auto-btn--go"
          disabled={!ctx}
          onClick={() => ctx && void resumeAuto({ ctx }).catch(() => {})}
          title={failure ? "Try the step again" : "Restart the step it paused in"}
        >
          {failure ? "Retry" : "Resume"}
        </button>
      )}
      <button
        type="button"
        className="auto-btn auto-btn--stop"
        onClick={() => void endAuto()}
        title="End the run where it is: the app writes its report from what the run checked, with no model reply and no cost"
      >
        Stop
      </button>
    </span>
  );
}

function Help({ run }: { run: AutoRun }) {
  const l = run.limits;
  return (
    <HelpTip className="helptip--auto">
      <span className="ex-help-line">
        Auto analysis runs a preflight, the pipeline, then checks each stage. A stage that needs attention gets up to {l.fixesPerStage} fixes from the model; the
        app runs from each change and checks again. A model reply then writes the report.
      </span>
      <span className="ex-help-line">
        It uses at most {l.replies} model replies{run.costUsd !== null ? ` and ${usd(l.costUsd)}` : ""}, and has a time limit; the time waiting for you is not
        counted. A limit sends the run to its report.
      </span>
      <span className="ex-help-line">
        A sample fact pauses the run until you apply or skip it. The log builds on the checks' own results: nothing in it is asked of the model. Each row opens to
        its detail; each plan row links to its latest step in the chat.
      </span>
    </HelpTip>
  );
}

/** The run's activity as the stores hold it, again whenever one changes. */
function useActivity(): Activity | null {
  const run = useAutoStore((s) => s.run);
  const live = useAutoStore((s) => s.live);
  const turns = useChatStore((s) => s.turns);
  const replying = useChatStore((s) => s.busy);
  const reply = useChatStore((s) => s.live);
  const decisions = useDecisionStore((s) => s.decisions);
  const proposals = useDecisionStore((s) => s.proposals);
  const tuneActive = useTuneStore((s) => s.active);
  const tuneStages = useTuneStore((s) => s.stages);
  return useMemo(
    () => (run ? activity({ run, live, turns, replying, replySteps: reply?.steps ?? [], decisions, proposals, tune: { active: tuneActive, stages: tuneStages } }) : null),
    [run, live, turns, replying, reply, decisions, proposals, tuneActive, tuneStages],
  );
}

const MARK: Record<ActivityRow["status"], string> = { done: "✓", running: "", "needs you": "!", skipped: "–", stopped: "‖", failed: "×" };

function LogRow({ row, run }: { row: ActivityRow; run: AutoRun }) {
  const datasets = useDatasets().data;
  const datasetId = useDatasetStore((s) => s.datasetId);
  const show = () => {
    if (row.turn !== undefined) return goToTurn(row.turn);
    if (!row.step) return;
    const step = run.steps.find((s) => s.id === row.step);
    if (step && drawsOverlays(step.name) && !step.restored) {
      if (step.view) openView(step.view);
      showStep(step, null, run.steps.indexOf(step) + 1, datasets?.find((d) => d.id === datasetId));
    }
    goToStep(null, row.step);
  };
  const linked = row.turn !== undefined || (row.step !== undefined && row.status !== "running");
  return (
    <li className={`auto-log-row is-${row.status.replace(" ", "-")}`} data-key={row.key}>
      <details>
        <summary>
          <span className="auto-log-mark" aria-label={row.status}>
            {MARK[row.status]}
          </span>
          <span className="auto-log-title">{row.title}</span>
          {row.line && <span className="auto-log-line">{row.line}</span>}
        </summary>
        <div className="auto-log-detail">
          {row.detail.map((d, i) => (
            <span key={i} className="auto-log-detail-line">
              {d}
            </span>
          ))}
          {linked && (
            <button type="button" className="pc-link" onClick={show}>
              {row.turn !== undefined ? "Show the reply in the chat ↗" : "Show in the chat and on the views ↗"}
            </button>
          )}
        </div>
      </details>
    </li>
  );
}

/** The activity log, newest last; it keeps to its end as rows come, unless you scrolled up. */
function Log({ rows, run, className }: { rows: ActivityRow[]; run: AutoRun; className: string }) {
  const ref = useRef<HTMLOListElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [rows]);
  if (!rows.length) return null;
  return (
    <ol
      ref={ref}
      className={`auto-log ${className}`}
      aria-label="What the run did"
      onScroll={() => {
        const el = ref.current;
        if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
    >
      {rows.map((r) => (
        <LogRow key={r.key} row={r} run={run} />
      ))}
    </ol>
  );
}

export function AutoPanel({ ctx }: { ctx: ToolContext | null }) {
  const run = useAutoStore((s) => s.run);
  const act = useActivity();
  const now = useNow(run?.clock);
  const link = useRowLink();
  const [open, setOpen] = useState(false); // the plan and the whole log, unfolded in the sheet layout
  const [hidden, setHidden] = useState<string | null>(null); // a finished run's panel, put away
  const [undone, setUndone] = useState<{ run: string; n: number } | null>(null);
  const [report, setReport] = useState<string | null>(null); // the run whose app report is open
  if (!run || !act || hidden === run.id) return null;
  const fact = run.state === "paused" && run.pause?.kind === "fact" ? run.pause.proposal : null;
  const tone = run.state === "running" ? "run" : run.state === "done" ? "done" : run.pause?.kind === "failure" ? "bad" : "wait";
  const fixes = run.plan.reduce((n, r) => n + r.tries, 0);
  const tokens = run.usage.input + run.usage.output;
  const paused = pausedText(run.clock, now);
  // Undo once the run is done or paused by you; not while it runs or waits for your answer.
  const canUndo = (run.state === "done" || run.state === "stopped") && run.decisions.length > 0;
  return (
    <section className={`auto-panel auto-panel--${tone}${open ? " is-open" : ""}`} aria-label="Auto analysis" data-run={run.id}>
      <div className="auto-top">
        <div className="auto-head">
          <span className="auto-title">Auto analysis</span>
          <span className="auto-state">{stateWord(run)}</span>
          <span className="auto-clock" role="timer" aria-live="off" title="Time worked; the time waiting for you is not counted">
            {clockText(run.clock, now)}
          </span>
          <Controls run={run} ctx={ctx} />
          {run.state === "done" && (
            <button type="button" className="auto-btn auto-btn--quiet" onClick={() => setHidden(run.id)} aria-label="Put the panel away" title="Put the panel away">
              ×
            </button>
          )}
        </div>
        <div className={`auto-now${run.state === "running" ? " is-live" : ""}`} role="status" aria-live="polite">
          <span className="auto-now-dot" aria-hidden="true" />
          <span className="auto-now-text">{act.now}</span>
        </div>
        <div className="auto-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressOf(run) * 100)}>
          <i style={{ width: `${Math.round(progressOf(run) * 100)}%` }} />
        </div>
      </div>
      {/* The fact it waits for, first: on a phone it must not sit below the fold. */}
      {fact && <PinnedCard id={fact} ctx={ctx} />}
      <Log rows={act.rows.slice(-3)} run={run} className="auto-recent" />
      <button type="button" className="auto-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "Fewer steps ▴" : `The plan and all ${act.rows.length} steps ▾`}
      </button>
      <div className="auto-body">
        <ol className="auto-plan">
          {run.plan.map((r) => (
            <Row key={r.id} run={run} row={r} onLink={link} />
          ))}
        </ol>
        <Log rows={act.rows} run={run} className="auto-all" />
        <div className="auto-foot">
          <span>
            Model replies {run.replies} of {run.limits.replies} · {fixes} fix{fixes === 1 ? "" : "es"} · {run.usage.estimated ? "≈ " : ""}
            {compact(tokens)} tokens
            {run.costUsd !== null && ` · ${usd(run.costUsd)} of ${usd(run.limits.costUsd)}`}
            {paused && <span className="auto-paused"> · {paused}</span>}
            {run.limit && <span className="auto-limit"> · stopped at {LIMIT_WORDS[run.limit]}</span>}
          </span>
          <Help run={run} />
        </div>
      </div>
      {(run.state === "done" || canUndo || run.pause?.kind === "failure" || undone?.run === run.id) && (
        <div className="auto-msg-row">
          {run.pause?.kind === "failure" && <span className="auto-msg">{run.pause.message}</span>}
          {run.pause?.kind === "failure" && run.pause.what === "run" && (
            <button type="button" className="auto-btn" onClick={() => useNavStore.getState().setTab("execution")} title="Open the Execution page and its log">
              Log
            </button>
          )}
          {run.state === "done" && run.reportTurn !== null && (
            <button type="button" className="auto-btn" onClick={() => goToTurn(run.reportTurn!)} title="Show the report reply in the chat">
              Report ↗
            </button>
          )}
          {run.state === "done" && run.reportTurn === null && run.appReport !== null && (
            <button
              type="button"
              className="auto-btn"
              disabled={!ctx}
              onClick={() => setReport(run.id)}
              title="Open the run's report: the app's alone, measured afresh, with no model reply"
            >
              Report ↗
            </button>
          )}
          {canUndo && (
            <button
              type="button"
              className="auto-btn"
              onClick={(e) => setUndone({ run: run.id, n: undoAutoRun(e.nativeEvent) })}
              title="Put back the settings the run changed (one your click made needs your click); a Run card follows"
            >
              Undo auto changes
            </button>
          )}
          {undone?.run === run.id && <span className="auto-msg">{undone.n ? `Put back ${undone.n} change${undone.n === 1 ? "" : "s"}.` : "Nothing to put back."}</span>}
        </div>
      )}
      {report === run.id && ctx && (
        <ReportView
          dataset={ctx.dataset}
          datasets={ctx.datasets}
          turn={appReportTurn(run)}
          question={appReportQuestion(run)}
          settings={loadSettings()}
          onClose={() => setReport(null)}
        />
      )}
    </section>
  );
}

/** Scroll the chat to a reply. */
function goToTurn(turn: number): void {
  useNavStore.getState().setDockOpen(true);
  requestAnimationFrame(() => {
    const el = document.getElementById(`ai-turn-${turn}`);
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: "smooth" });
    el.classList.remove("is-pulsed");
    void el.offsetWidth;
    el.classList.add("is-pulsed");
  });
}

/**
 * The dock's chip: "Run auto analysis" leads the requests while no run is
 * open; while one runs, "Pause auto analysis". A run paused or waiting is
 * the panel's to resume or stop.
 */
export function AutoChip({ ctx, canStart }: { ctx: ToolContext | null; canStart: boolean }) {
  const state = useAutoStore((s) => s.run?.state);
  // Why a start was refused (a run or a reply under way): said, not swallowed.
  const [refused, setRefused] = useState<string | null>(null);
  if (state === "running") {
    return (
      <div className="ai-reviews">
        <button type="button" className="ai-chip ai-chip-stop" onClick={stopAuto} title="Pause after stopping the step under way; Resume restarts it">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <rect x="2.2" y="2" width="2.6" height="8" rx="0.8" fill="currentColor" />
            <rect x="7.2" y="2" width="2.6" height="8" rx="0.8" fill="currentColor" />
          </svg>
          Pause auto analysis
        </button>
      </div>
    );
  }
  if (state === "paused" || state === "stopped") return null;
  return (
    <div className="ai-reviews">
      <button
        type="button"
        className="ai-chip ai-chip-act"
        disabled={!canStart || !ctx}
        onClick={() => {
          if (!ctx) return;
          setRefused(null);
          void startAuto({ ctx }).catch((e: unknown) => setRefused(`Not started: ${(e as Error)?.message ?? String(e)}.`));
        }}
        title={`Preflight, a run, check and fix each stage, then a report. It pauses for a sample fact; ${AUTO_LIMITS.fixesPerStage} fixes a stage and ${AUTO_LIMITS.replies} model replies at most.`}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 1.8v8.4L10.2 6Z" fill="currentColor" />
        </svg>
        Run auto analysis
      </button>
      {refused && <span className="auto-refused">{refused}</span>}
    </div>
  );
}
