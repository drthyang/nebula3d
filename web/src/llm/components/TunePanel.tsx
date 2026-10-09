// The tuning run's surface in the assistant panel: a setup card (which stages,
// how many trials, and a plain warning that trials rewrite the processed
// files), then one card per stage with its trials — the settings each changed,
// the headline metrics, the model's reason — and the trial it chose.

import { useState } from "react";
import { useShallow } from "zustand/react/shallow";

import type { Dataset } from "../../api/types";
import { useNavStore } from "../../state/navStore";
import { usePipelineStore } from "../../state/pipelineStore";
import type { LlmSettings } from "../settings";
import { stageEnabled, TUNE_STAGE_LABELS, TUNE_STAGES, type TuneStage } from "../tune/catalog";
import { headline } from "../tune/evaluate";
import { startTuning, stopTuning, useTuneStore, type StageRun } from "../tune/tuner";

const STATUS_LABEL: Record<StageRun["status"], string> = {
  waiting: "waiting",
  running: "running",
  proposing: "asking for settings",
  judging: "choosing",
  applying: "re-running the choice",
  done: "done",
  skipped: "skipped",
  failed: "stopped",
};

function StageCard({ run }: { run: StageRun }) {
  const busy = !["waiting", "done", "skipped", "failed"].includes(run.status);
  return (
    <div className={`tune-stage tune-${run.status}`}>
      <div className="tune-stage-head">
        <span className="tune-stage-name">{TUNE_STAGE_LABELS[run.stage]}</span>
        <span className={`tune-status${busy ? " busy" : ""}`}>{STATUS_LABEL[run.status]}</span>
      </div>
      {run.message && <div className="tune-msg">{run.message}</div>}
      {run.trials.length > 0 && (
        <ol className="tune-trials">
          {run.trials.map((t) => (
            <li key={t.n} className={`tune-trial${run.best === t.n ? " chosen" : ""} tune-trial-${t.status}`}>
              <div className="tune-trial-row">
                <span className="tune-trial-n">#{t.n}</span>
                <span className="tune-trial-what">
                  {t.n === 1
                    ? "your settings"
                    : Object.entries(t.changes).map(([k, v]) => (
                        <code key={k}>
                          {k}={String(v)}
                        </code>
                      ))}
                </span>
                {run.best === t.n && <span className="tune-chosen">chosen</span>}
              </div>
              <div className="tune-trial-metrics">
                {t.status === "pending"
                  ? "queued"
                  : t.status === "running"
                    ? "running…"
                    : t.status === "error"
                      ? t.error
                      : headline(run.stage, t.evaluation)}
                {t.seconds != null && <span className="tune-secs"> · {t.seconds}s</span>}
              </div>
              {t.why && <div className="tune-why">{t.why}</div>}
              {t.evaluation && (
                <details className="tune-detail">
                  <summary>metrics</summary>
                  <pre>{JSON.stringify(t.evaluation, null, 1)}</pre>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
      {run.why && run.status === "done" && <div className="tune-verdict">{run.why}</div>}
    </div>
  );
}

export function TunePanel({
  dataset,
  connected,
  settings,
}: {
  dataset: Dataset | undefined;
  connected: boolean;
  settings: LlmSettings;
}) {
  const { active, stages, error, finishedNote, datasetLabel } = useTuneStore();
  // Only the stage switches and the running flag — not the streaming log.
  const cfg = usePipelineStore(
    useShallow((s) => ({
      ringsEnabled: s.ringsEnabled,
      punchEnabled: s.punchEnabled,
      backfillEnabled: s.backfillEnabled,
      flatten: s.flatten,
      pdfEnabled: s.pdfEnabled,
      running: s.running,
    })),
  );
  const setTab = useNavStore((s) => s.setTab);
  const [picked, setPicked] = useState<TuneStage[]>([...TUNE_STAGES]);
  const [trials, setTrials] = useState(3);

  const enabled = TUNE_STAGES.filter((s) => stageEnabled(s, cfg));
  const chosen = picked.filter((s) => enabled.includes(s));
  const canStart = connected && Boolean(dataset) && !cfg.running && !active && chosen.length > 0;
  const label = dataset ? (dataset.temperature ?? dataset.stem) : "—";
  const runs = chosen.length * trials;

  return (
    <div className="tune">
      {!active && (
        <div className="tune-setup">
          <p className="tune-lead">
            Run the pipeline one stage at a time. For each stage the assistant tries your settings and up to{" "}
            {trials - 1} alternative{trials - 1 === 1 ? "" : "s"}, measures each on three planes, keeps the best, and
            moves on with it.
          </p>
          <div className="tune-stage-picks">
            {TUNE_STAGES.map((s) => (
              <label key={s} className={`tune-pick${enabled.includes(s) ? "" : " off"}`}>
                <input
                  type="checkbox"
                  checked={chosen.includes(s)}
                  disabled={!enabled.includes(s)}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s] : p.filter((x) => x !== s)))}
                />
                {TUNE_STAGE_LABELS[s]}
              </label>
            ))}
          </div>
          <label className="tune-trials-input">
            Trials per stage
            <select value={trials} onChange={(e) => setTrials(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="ai-conn-warn">
            Each trial re-runs its stage on <b>{label}</b> and overwrites that dataset&apos;s processed files (about{" "}
            {runs} run{runs === 1 ? "" : "s"}, plus re-runs of untuned stages in between). The raw data is not touched.
            The chosen settings are written to the Configure page.
          </div>
          <button
            type="button"
            className="ai-btn tune-start"
            disabled={!canStart}
            onClick={() =>
              dataset && void startTuning({ dataset, stages: chosen, trialsPerStage: trials, llm: settings })
            }
            title={
              !connected
                ? "Connect a model first"
                : cfg.running
                  ? "A pipeline run is in progress"
                  : undefined
            }
          >
            Start tuning
          </button>
        </div>
      )}

      {stages.length > 0 && (
        <div className="tune-progress">
          <div className="tune-progress-head">
            <span>
              {active ? "Tuning" : "Last tuning run"} · {datasetLabel}
            </span>
            {active ? (
              <button type="button" className="ai-btn tune-stop" onClick={stopTuning}>
                Stop
              </button>
            ) : (
              <button type="button" className="ai-clear" onClick={() => useTuneStore.setState({ stages: [], finishedNote: null, error: null })}>
                Clear
              </button>
            )}
          </div>
          {active && (
            <button type="button" className="tune-link" onClick={() => setTab("execution")}>
              Watch the runs on the Execution page
            </button>
          )}
          {stages.map((r) => (
            <StageCard key={r.stage} run={r} />
          ))}
          {error && <div className="ai-conn-alert">{error}</div>}
          {finishedNote && <div className="tune-msg">{finishedNote}</div>}
          {!active && finishedNote && !error && (
            <button type="button" className="tune-link" onClick={() => setTab("config")}>
              Open the Configure page
            </button>
          )}
        </div>
      )}
    </div>
  );
}
