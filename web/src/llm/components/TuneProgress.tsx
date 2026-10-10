// A tuning run in the chat, under the reply whose tune_pipeline call started
// it: one card per stage with its trials — the settings each changed, the
// headline metrics, the model's reason — and the trial it chose; at the end, a
// link to the tuned result, which opens as a dataset of its own.

import { queryClient } from "../../api/queryClient";
import { useDatasetStore } from "../../state/datasetStore";
import { useNavStore } from "../../state/navStore";
import { TUNE_STAGE_LABELS } from "../tune/catalog";
import { headline } from "../tune/evaluate";
import { useTuneStore, type StageRun } from "../tune/tuner";

const STATUS_LABEL: Record<StageRun["status"], string> = {
  waiting: "waiting",
  running: "running",
  proposing: "asking for settings",
  judging: "choosing",
  applying: "keeping the choice",
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

export function TuneProgress() {
  const { active, stages, error, finishedNote, datasetLabel, run } = useTuneStore();
  const setTab = useNavStore((s) => s.setTab);
  if (!stages.length) return null;
  const openResult = async () => {
    if (!run) return;
    await queryClient.invalidateQueries({ queryKey: ["datasets"] });
    useDatasetStore.getState().setDataset(run.dataset_id);
    setTab("reciprocal");
  };

  return (
    <div className="tune-progress">
      <div className="tune-progress-head">
        <span>
          {active ? "Tuning" : "Tuning run"} · {datasetLabel}
        </span>
      </div>
      {stages.map((r) => (
        <StageCard key={r.stage} run={r} />
      ))}
      {error && <div className="ai-conn-alert">{error}</div>}
      {finishedNote && <div className="tune-msg">{finishedNote}</div>}
      {!active && run && stages.some((r) => r.status === "done") && (
        <button type="button" className="tune-link" onClick={() => void openResult()}>
          Open the tuned result
        </button>
      )}
      {!active && finishedNote && !error && (
        <button type="button" className="tune-link" onClick={() => setTab("config")}>
          Open the Configure page
        </button>
      )}
    </div>
  );
}
