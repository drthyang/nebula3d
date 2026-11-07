// The Auto panel (docs/pilot-auto-mode-design.md §2.6; THY-65 PR 7), above
// the chat while an auto run is open: its title, state and clock against the
// limit, with Stop, Resume and End; a thin progress bar; the plan, one row a
// phase in the NeXus Viewer's Processing style (a status dot, the name, the
// state right-aligned in mono), each row a link to its latest step in the chat
// and the highlights that step drew; the replies, tokens and spend, and the
// time paused apart from the working time; the fact the run waits for, pinned
// with its Apply and Skip; and once it ends, how it ended, a link to its
// report and Undo of its changes. In the sheet layout (a phone or a narrow
// window) the panel folds to one line that opens into the plan; the fact and
// the actions stay out of the fold. Result first, the details behind "?".
// The dock's chip (AutoChip) starts a run, and stops one under way.

import { useEffect, useState, type ReactNode } from "react";

import { useDatasets } from "../../api/hooks";
import { HelpTip } from "../../components/ui";
import { useDatasetStore } from "../../state/datasetStore";
import { useNavStore } from "../../state/navStore";
import type { AgentStep } from "../agent";
import { endAuto, resumeAuto, startAuto, stopAuto, undoAutoRun } from "../auto/controller";
import { usd } from "../auto/cost";
import { clockText, compact, currentRow, pausedText, progressOf, rowMeta, rowSub, rowTone, STATE_WORD, TITLES } from "../auto/panel";
import { AUTO_LIMITS, LIMIT_WORDS, type PlanRow } from "../auto/plan";
import { useAutoStore, type AutoRun } from "../auto/store";
import { elapsedMs, formatDuration, type RunClock } from "../clock";
import { drawsOverlays } from "../examine/overlays";
import { showStep } from "../examine/store";
import type { ToolContext } from "../tools";
import { openView } from "../tools/openView";
import { goToStep } from "./goToStep";
import { PinnedCard } from "./ProposalCards";

/** The time now, each second while the clock runs. */
function useNow(clock: RunClock | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  const ticking = !!clock && clock.endedAt === null && clock.pausedAt === null;
  useEffect(() => {
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
  const tone = run.at === row.id && run.state === "paused" && run.pause?.kind === "fact" ? "wait" : rowTone(row.status);
  const sub = run.at === row.id && run.pause?.kind === "fact" ? "needs you" : rowSub(row, run.limits.fixesPerStage);
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
        <span className="meta">{rowMeta(row)}</span>
      </button>
    </li>
  );
}

/** Stop while it runs or waits for you; Resume (Retry after a failure) and End once stopped or failed. */
function Actions({ run, ctx, className }: { run: AutoRun; ctx: ToolContext | null; className: string }) {
  if (run.state === "done") return null;
  const failure = run.pause?.kind === "failure";
  const fact = run.pause?.kind === "fact";
  return (
    <span className={`auto-actions ${className}`}>
      {run.state === "running" || fact ? (
        <button type="button" className="auto-btn auto-btn--stop" onClick={stopAuto} title="Stop the step under way; Resume restarts it">
          Stop
        </button>
      ) : (
        <>
          <button
            type="button"
            className="auto-btn auto-btn--go"
            disabled={!ctx}
            onClick={() => ctx && void resumeAuto({ ctx }).catch(() => {})}
            title={failure ? "Try the step again" : "Restart the step it stopped in"}
          >
            {failure ? "Retry" : "Resume"}
          </button>
          <button type="button" className="auto-btn" onClick={endAuto} title="End the run here, without its report">
            End
          </button>
        </>
      )}
    </span>
  );
}

/** The line under the plan: why it waits, how it stopped or ended. */
function message(run: AutoRun): ReactNode {
  const p = run.pause;
  if (run.state === "paused" && p?.kind === "fact") return "Paused for a sample fact. The clock is stopped; the run goes on when you apply or skip.";
  if (run.state === "paused" && p?.kind === "failure") return p.what === "model" ? `The model server failed: ${p.message}` : `The pipeline run failed: ${p.message}`;
  if (run.state === "stopped") {
    const at = run.plan.find((r) => r.id === run.at);
    return `${run.now.replace(/\.$/, "")}.${at ? ` Resume restarts ${TITLES[at.id]}.` : ""}`;
  }
  if (run.state === "done") return run.ended ?? "Done.";
  return null;
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
        Limits: {l.minutes} minutes of working time (time waiting for you is not counted), {l.replies} model replies
        {run.costUsd !== null ? `, ${usd(l.costUsd)} of spend` : ""}. A limit sends the run to its report.
      </span>
      <span className="ex-help-line">A sample fact pauses the run until you apply or skip it. Each row links to its latest step in the chat.</span>
    </HelpTip>
  );
}

export function AutoPanel({ ctx }: { ctx: ToolContext | null }) {
  const run = useAutoStore((s) => s.run);
  const now = useNow(run?.clock);
  const link = useRowLink();
  const [open, setOpen] = useState(false); // the plan, unfolded in the sheet layout
  const [hidden, setHidden] = useState<string | null>(null); // a finished run's panel, put away
  const [undone, setUndone] = useState<{ run: string; n: number } | null>(null);
  if (!run || hidden === run.id) return null;
  const fact = run.state === "paused" && run.pause?.kind === "fact" ? run.pause.proposal : null;
  const tone = run.state === "running" ? "run" : run.state === "done" ? "done" : run.pause?.kind === "failure" ? "bad" : "wait";
  const row = currentRow(run);
  const fixes = run.plan.reduce((n, r) => n + r.tries, 0);
  const tokens = run.usage.input + run.usage.output;
  const paused = pausedText(run.clock, now);
  const msg = message(run);
  const lineState = run.state === "running" ? "Auto" : STATE_WORD[run.state];
  const lineWhat = row ? `${TITLES[row.id]}${fact ? " · needs you" : rowSub(row, run.limits.fixesPerStage) ? ` · ${rowSub(row, run.limits.fixesPerStage)}` : rowMeta(row) ? ` · ${rowMeta(row)}` : ""}` : "Starting";
  const canUndo = run.state !== "running" && run.decisions.length > 0;
  return (
    <section className={`auto-panel auto-panel--${tone}${open ? " is-open" : ""}`} aria-label="Auto analysis">
      <button type="button" className="auto-line" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={open ? "Fold the plan" : "Open the plan"}>
        <span className="auto-state">{lineState}</span>
        <span className="auto-line-what">{lineWhat}</span>
        <span className="auto-clock">{formatDuration(elapsedMs(run.clock, now))}</span>
        <span className="chev" aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>
      <div className="auto-body">
        <div className="auto-head">
          <span className="auto-title">Auto analysis</span>
          <span className="auto-state">{STATE_WORD[run.state]}</span>
          <span className="auto-clock" role="timer" aria-live="off" title="Working time against the limit; the time waiting for you is not counted">
            {clockText(run.clock, now)}
          </span>
          <Actions run={run} ctx={ctx} className="auto-actions--head" />
          {run.state === "done" && (
            <button type="button" className="auto-btn auto-btn--quiet" onClick={() => setHidden(run.id)} aria-label="Put the panel away" title="Put the panel away">
              ×
            </button>
          )}
        </div>
        <div className="auto-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressOf(run) * 100)}>
          <i style={{ width: `${Math.round(progressOf(run) * 100)}%` }} />
        </div>
        <ol className="auto-plan">
          {run.plan.map((r) => (
            <Row key={r.id} run={run} row={r} onLink={link} />
          ))}
        </ol>
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
      {(msg || run.state !== "running") && (
        <div className="auto-msg-row">
          {msg && <span className="auto-msg">{msg}</span>}
          <Actions run={run} ctx={ctx} className="auto-actions--line" />
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
      {fact && <PinnedCard id={fact} ctx={ctx} />}
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
 * open; while one runs, "Stop auto analysis". A run paused or stopped is the
 * panel's to resume or end.
 */
export function AutoChip({ ctx, canStart }: { ctx: ToolContext | null; canStart: boolean }) {
  const state = useAutoStore((s) => s.run?.state);
  if (state === "running") {
    return (
      <div className="ai-reviews">
        <button type="button" className="ai-chip ai-chip-stop" onClick={stopAuto} title="Stop the step under way; Resume restarts it">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor" />
          </svg>
          Stop auto analysis
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
        onClick={() => ctx && void startAuto({ ctx }).catch(() => {})}
        title={`Preflight, a run, check and fix each stage, then a report. It pauses for a sample fact; ${AUTO_LIMITS.minutes} minutes, ${AUTO_LIMITS.fixesPerStage} fixes a stage, ${AUTO_LIMITS.replies} model replies at most.`}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 1.8v8.4L10.2 6Z" fill="currentColor" />
        </svg>
        Run auto analysis
      </button>
    </div>
  );
}
