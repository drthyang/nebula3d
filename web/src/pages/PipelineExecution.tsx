// Execution page — live progress for one pipeline run.  A header card (status
// pill, dataset/job id, timing, overall progress), an optional failed/cancelled
// banner, and a body of a vertical stage timeline + a streaming event log.
//
// Everything is driven from the pipeline store's job stream (the same JobEvent
// model the SSE/in-browser engine emits): per-stage node state, durations, the
// log, and overall progress.  Client-side timestamps (recorded as events arrive)
// supply the wall-clock log times and the elapsed/ETA/runtime figures.

import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import type { Tab } from "../state/navStore";
import { useDatasets } from "../api/hooks";
import type { JobEvent } from "../api/types";
import { useDatasetStore } from "../state/datasetStore";
import { STAGES, STAGE_LABELS, usePipelineStore } from "../state/pipelineStore";
import { PYODIDE_MODE } from "../api/pyodideEngine";
import { litStage, useHighlightKeys } from "../llm/highlight";
import { logClass, runPhase, stageInfo as infoOf, stageStates, warns, type Phase } from "./executionLog";

// The output a stage writes (the consistency check's is the ΔPDF's).
const STAGE_OUTPUT: Record<string, string> = {
  rings: "ringremoved",
  punch: "braggpunched",
  backfill: "backfilled",
  flatten: "flattened",
  pdf: "delta_pdf",
  pdf_check: "delta_pdf",
};

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-GB", { hour12: false });
}
function fmtDur(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(Math.round(s % 60)).padStart(2, "0")}s`;
}
function fmtMMSS(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
function fmtLeft(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

// ---------------------------------------------------------------------------
// Event log line text (its colour: executionLog.ts)
// ---------------------------------------------------------------------------
function logText(ev: JobEvent): string {
  if (ev.message) return ev.message;
  if (ev.status === "progress" && ev.fraction != null)
    return `running · ${Math.round(ev.fraction * 100)}%`;
  return ev.status ?? ev.type;
}

// Fold consecutive same-stage progress/start spam into the latest line, but keep
// stage starts and terminal (done/skip/error) lines distinct so the log reads as
// a short scannable history.
function condense(events: JobEvent[], times: number[]): { ev: JobEvent; t: number }[] {
  const out: { ev: JobEvent; t: number }[] = [];
  events.forEach((ev, i) => {
    const prev = out[out.length - 1];
    const foldable = ev.status === "progress" || ev.status === "start";
    if (
      prev &&
      foldable &&
      prev.ev.stage === ev.stage &&
      (prev.ev.status === "progress" || prev.ev.status === "start")
    ) {
      out[out.length - 1] = { ev, t: times[i] };
    } else {
      out.push({ ev, t: times[i] });
    }
  });
  return out;
}

export function PipelineExecution({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const lit = useHighlightKeys();
  const { events, times, terminal, running, flatten, jobId, lastRun } = usePipelineStore(
    useShallow((s) => ({
      events: s.events,
      times: s.times,
      terminal: s.terminal,
      running: s.running,
      flatten: s.flatten,
      jobId: s.jobId,
      lastRun: s.lastRun,
    })),
  );
  const run = usePipelineStore((s) => s.run);
  const cancel = usePipelineStore((s) => s.cancel);

  const datasetId = useDatasetStore((s) => s.datasetId);
  const datasetsQ = useDatasets();
  const dataset = useMemo(
    () => (datasetsQ.data ?? []).find((d) => d.id === datasetId),
    [datasetsQ.data, datasetId],
  );

  const logRef = useRef<HTMLDivElement | null>(null);

  // Tick while running so elapsed/ETA advance.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => tick((x) => x + 1), 500);
    return () => window.clearInterval(id);
  }, [running]);

  const condensed = useMemo(() => condense(events, times), [events, times]);
  useEffect(() => {
    if (running) logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [condensed, running]);

  // The flatten is shown as the run had it (the form may have changed since).
  const visibleStages = STAGES.filter((s) => (lastRun?.flattenEnabled ?? flatten) || s !== "flatten");

  // Latest status / fraction / message + first & last timestamp per stage.
  const stageInfo = infoOf(events, times);
  const phase: Phase = runPhase(running, terminal, events.length);

  // Each stage's state: the run's own stages, and those it was not asked for
  // (stale when it recomputed a stage before them and their output remains).
  const { states, inRun, doneCount, activeStage, activeFrac, staleAfter } = stageStates({
    visible: visibleStages,
    info: stageInfo,
    phase,
    runStages: lastRun?.stages ?? null,
    hasOutput: (stage) => Boolean(dataset?.stages.some((d) => d.name === STAGE_OUTPUT[stage] && d.exists)),
  });
  const total = inRun.length || 1;
  const overall =
    phase === "done"
      ? 1
      : (doneCount + (activeStage && activeFrac != null ? activeFrac : 0)) / total;
  const overallPct = Math.round(overall * 100);
  const overallColor =
    phase === "done"
      ? "#34c98e"
      : phase === "error"
        ? "#e8645a"
        : phase === "cancelled"
          ? "#8b94a3"
          : "#4f8ff7";

  // The stage that failed / was interrupted (for banner + node colouring).
  const interruptedStage =
    inRun.find((s) => states[s] === "failed" || states[s] === "cancelled") ?? activeStage;
  const interruptedNo = interruptedStage ? inRun.indexOf(interruptedStage) + 1 : 0;

  // Timing figures.
  const startT = times[0] ?? Date.now();
  const lastT = times[times.length - 1] ?? startT;
  const elapsed = (phase === "running" ? Date.now() : lastT) - startT;
  const eta =
    phase === "running" && overall > 0.02 && overall < 1
      ? (elapsed * (1 - overall)) / overall
      : null;

  // Per-phase header bits.
  const pill: Record<Phase, { text: string; icon: string }> = {
    running: { text: "Running", icon: "" },
    done: { text: "Completed", icon: "✓" },
    error: { text: "Failed", icon: "✕" },
    cancelled: { text: "Cancelled", icon: "–" },
    idle: { text: "No run", icon: "▷" },
  };
  const lastError = [...events].reverse().find((e) => e.status === "error")?.message;

  let timingV = "—";
  let timingL = "no active run";
  if (phase === "running") {
    timingV = fmtMMSS(elapsed);
    timingL = eta != null ? `elapsed · ~${fmtLeft(eta)} left` : "elapsed";
  } else if (phase === "done") {
    timingV = fmtMMSS(elapsed);
    timingL = "total runtime";
  } else if (phase === "error") {
    timingV = fmtMMSS(elapsed);
    timingL = "failed after";
  } else if (phase === "cancelled") {
    timingV = fmtMMSS(elapsed);
    timingL = "cancelled after";
  }

  let overallLabel = "";
  if (phase === "running")
    overallLabel = activeStage
      ? `Stage ${inRun.indexOf(activeStage) + 1} of ${total} · ${STAGE_LABELS[activeStage]}`
      : "Starting…";
  else if (phase === "done") overallLabel = `${total} of ${total} stages complete`;
  else if (phase === "error")
    overallLabel = `Failed at stage ${interruptedNo} · ${interruptedStage ? STAGE_LABELS[interruptedStage] : ""}`;
  else if (phase === "cancelled")
    overallLabel = `Cancelled at stage ${interruptedNo} · ${interruptedStage ? STAGE_LABELS[interruptedStage] : ""}`;

  const datasetLabel = dataset?.temperature ?? dataset?.stem ?? datasetId ?? "dataset";
  const stem = dataset?.stem ?? dataset?.raw_name;
  const runId = jobId
    ? `job ${jobId.slice(0, 4)}${stem ? ` · ${stem}` : ""}`
    : stem
      ? `${stem} · in-browser`
      : "in-browser run";

  // Per-stage display.
  function stageRow(stage: string, idx: number) {
    const ns = states[stage];
    const info = stageInfo[stage];
    const stepNo = idx + 1;
    let statusLabel: string;
    let meta: string;
    switch (ns) {
      case "done":
        statusLabel = fmtDur(info!.lastT - info!.firstT);
        meta = info?.message ?? "complete";
        break;
      case "active":
        statusLabel = "running";
        meta =
          info?.message ??
          (info?.fraction != null ? `running · ${Math.round(info.fraction * 100)}%` : "running…");
        break;
      case "failed":
        statusLabel = "error";
        meta = info?.message ?? lastError ?? "stage failed";
        break;
      case "cancelled":
        statusLabel = "stopped";
        meta = info?.message ?? "halted";
        break;
      case "stale":
        statusLabel = "stale";
        meta = `not in this run: its output was made before this run's ${STAGE_LABELS[staleAfter[stage]] ?? staleAfter[stage]}; run it again to update it`;
        break;
      case "notrun":
        statusLabel = "—";
        meta = "not in this run";
        break;
      default:
        if (phase === "error" || phase === "cancelled") {
          statusLabel = "—";
          meta = "not reached";
        } else {
          statusLabel = "queued";
          meta = "";
        }
    }
    const dim = ns === "pending" || ns === "notrun";
    const nodeContent =
      ns === "done" ? "✓" : ns === "failed" ? "✕" : ns === "cancelled" ? "–" : ns === "active" ? "" : String(stepNo);
    const connectorDone = ns === "done";
    return (
      <div className={`exec-stage${litStage(lit, stage) ? " ai-glow" : ""}`} key={stage}>
        <div className="exec-stage-rail">
          <div className={`exec-node ${ns}`}>{nodeContent}</div>
          {idx < visibleStages.length - 1 && (
            <div className={`exec-connector${connectorDone ? " done" : ""}`} />
          )}
        </div>
        <div className="exec-stage-main">
          <div className="exec-stage-top">
            <span className={`exec-stage-name${dim ? " dim" : ns === "cancelled" ? " cancelled" : ""}`}>
              <span className="exec-stage-no">
                {stepNo}/{visibleStages.length}
              </span>
              {STAGE_LABELS[stage]}
            </span>
            <span className={`exec-stage-status ${ns}`}>{statusLabel}</span>
          </div>
          {/* A summary that holds a warning reads as one: the ring removal's candidates left on a coarse grid. */}
          {meta && <div className={`exec-stage-meta${dim ? " dim" : warns(meta) || ns === "stale" ? " warn" : ""}`}>{meta}</div>}
          {ns === "active" && info?.fraction != null && (
            <div className="exec-stage-bar">
              <i style={{ width: `${Math.round(info.fraction * 100)}%` }} />
              <span className="exec-shimmer" style={{ width: `${Math.round(info.fraction * 100)}%` }} />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="exec-page">
      {/* header / overall card */}
      <div className="exec-head">
        <div className="exec-head-row">
          <span className={`exec-pill ${phase}`}>
            {phase === "running" ? (
              <span className="exec-spin" />
            ) : (
              <span className="exec-pill-ico">{pill[phase].icon}</span>
            )}
            {pill[phase].text}
          </span>

          <div className="exec-meta">
            <span className="exec-meta-ds">{datasetLabel}</span>
            <span className="exec-meta-id">{runId}</span>
          </div>

          <div className="exec-right">
            <div className="exec-timing">
              <span className={`exec-timing-v ${phase}`}>{timingV}</span>
              <span className="exec-timing-l">{timingL}</span>
            </div>
            <div className="exec-vrule" />
            <div className="exec-actions">
              {phase === "running" && (
                <button type="button" className="exec-btn exec-btn-cancel" onClick={cancel}>
                  <span className="exec-btn-cancel-sq" />
                  Cancel run
                </button>
              )}
              {phase === "done" && (
                <>
                  <button type="button" className="exec-btn exec-btn-ghost" onClick={() => void run()}>
                    Run again
                  </button>
                  <button type="button" className="exec-btn exec-btn-primary" onClick={() => onNavigate("dpdf")}>
                    View results →
                  </button>
                </>
              )}
              {phase === "error" && (
                <>
                  <button type="button" className="exec-btn exec-btn-ghost" onClick={() => onNavigate("config")}>
                    Back to Configure
                  </button>
                  <button type="button" className="exec-btn exec-btn-primary" onClick={() => void run()}>
                    Retry →
                  </button>
                </>
              )}
              {phase === "cancelled" && (
                <>
                  <button type="button" className="exec-btn exec-btn-ghost" onClick={() => onNavigate("config")}>
                    Back to Configure
                  </button>
                  <button type="button" className="exec-btn exec-btn-primary" onClick={() => void run()}>
                    Run again
                  </button>
                </>
              )}
              {phase === "idle" && (
                <button type="button" className="exec-btn exec-btn-primary" onClick={() => onNavigate("config")}>
                  Go to Configure →
                </button>
              )}
            </div>
          </div>
        </div>

        {phase === "idle" ? (
          <div className="exec-idle-track-row">
            <div className="exec-idle-track" />
            <span className="exec-idle-track-lbl">No pipeline running</span>
          </div>
        ) : (
          <div className="exec-overall">
            <div className="exec-overall-top">
              <span className={`exec-overall-lbl ${phase}`}>{overallLabel}</span>
              <span className="exec-overall-pct" style={{ color: overallColor }}>
                {overallPct}%
              </span>
            </div>
            <div className="exec-track">
              <div
                className="exec-fill"
                style={{ width: `${overallPct}%`, background: overallColor }}
              />
              {phase === "running" && (
                <div className="exec-shimmer" style={{ width: `${overallPct}%` }} />
              )}
            </div>
          </div>
        )}
      </div>

      {/* banner — failed / cancelled */}
      {phase === "error" && (
        <div className="exec-banner error">
          <span className="exec-banner-ico">✕</span>
          <div className="exec-banner-txt">
            <span className="exec-banner-title">
              {interruptedStage ? STAGE_LABELS[interruptedStage] : "Pipeline"} failed
            </span>
            <span className="exec-banner-body">
              {lastError ?? "The run stopped with an error — see the event log below for details."}
            </span>
          </div>
        </div>
      )}
      {phase === "cancelled" && (
        <div className="exec-banner cancelled">
          <span className="exec-banner-ico">–</span>
          <div className="exec-banner-txt">
            <span className="exec-banner-title">Run cancelled</span>
            <span className="exec-banner-body">
              {(interruptedStage ? `Stopped during ${STAGE_LABELS[interruptedStage]}. ` : "The run was stopped before finishing. ") +
                (PYODIDE_MODE
                  ? "Stopping the in-browser engine also discarded the outputs it held: the next run computes every stage again."
                  : "Completed stages were saved and can be reused on the next run.")}
            </span>
          </div>
        </div>
      )}

      {/* body — stages + log */}
      {phase === "idle" ? (
        <div className="exec-idle">
          <div className="exec-idle-glyph">▶</div>
          <div className="exec-idle-txt">
            <span className="exec-idle-title">No active run</span>
            <span className="exec-idle-sub">
              Configure a pipeline and press <b>Run pipeline</b> to start a reduction. Per-stage
              progress and the live event stream will appear here.
            </span>
          </div>
          <button
            type="button"
            className="exec-btn exec-btn-primary"
            style={{ marginTop: 2 }}
            onClick={() => onNavigate("config")}
          >
            Go to Configure →
          </button>
        </div>
      ) : (
        <div className="exec-body">
          {/* stages */}
          <div className="exec-panel">
            <div className="exec-panel-head">
              <span className="exec-panel-title">Pipeline stages</span>
              <div className="exec-panel-rule" />
              <span className="exec-panel-count">
                {doneCount} / {total} done
              </span>
            </div>
            <div>{visibleStages.map((s, i) => stageRow(s, i))}</div>
          </div>

          {/* log */}
          <div className={`exec-panel${lit.includes("log") ? " ai-glow" : ""}`}>
            <div className="exec-panel-head">
              <span className="exec-panel-title">Event log</span>
              {phase === "running" && (
                <span className="exec-stream">
                  <span className="exec-stream-dot" />
                  <span className="exec-stream-lbl">Streaming</span>
                </span>
              )}
              <div className="exec-panel-rule" />
              <span className="exec-panel-count">{condensed.length} events</span>
            </div>
            <div className="exec-log" ref={logRef}>
              {condensed.length === 0 && (
                <div className="exec-log-empty">
                  Waiting for the first stage… stages with existing outputs are skipped unless
                  “force” is enabled on the Configure page.
                </div>
              )}
              {condensed.map(({ ev, t }, i) => (
                <div className="exec-log-line" key={i}>
                  <span className="exec-log-t">{Number.isFinite(t) ? fmtClock(t) : ""}</span>
                  <span className={`exec-log-m ${logClass(ev)}`}>
                    {logText(ev)}
                    {phase === "running" && i === condensed.length - 1 && (
                      <span className="exec-log-cursor" />
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
