// The context meter by the chat box (THY-74; the maths in contextMeter.ts):
// "Context 62%", neutral below 70 %, amber to 90 %, red above. Its "?" opens
// one plain line: the tokens of the window, the reply's room, and on Claude
// what the conversation has cost. From amber it offers Summarize and continue
// (summarize.ts) and Start fresh. On a phone it stays out of the toggles row
// until amber. UI only: nothing here is sent.

import { meterDetail, type ContextWindow, type MeterReading } from "../contextMeter";

const compact = (n: number): string => (n < 1000 ? String(n) : `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k`);

/** The meter in the toggles row: a bar, "Context 62%", and its "?". */
export function ContextMeterChip({
  reading,
  window: w,
  open,
  onToggle,
  title,
}: {
  reading: MeterReading;
  window: ContextWindow;
  open: boolean;
  onToggle: () => void;
  title?: string;
}) {
  const fill = reading.share === null ? 0 : Math.min(1, reading.share);
  return (
    <span className={`ai-meter is-${reading.level}${open ? " is-open" : ""}`} title={title}>
      {reading.percent !== null && (
        <span className="ai-meter-bar" aria-hidden="true">
          <span style={{ width: `${(fill * 100).toFixed(1)}%` }} />
        </span>
      )}
      <span className="ai-meter-text" role="status">
        {reading.percent !== null ? `Context ${reading.percent}%` : `Context ≈ ${compact(reading.prompt)} tokens`}
      </span>
      <button
        type="button"
        className="ai-meter-help"
        onClick={onToggle}
        aria-expanded={open}
        aria-label="What the context meter counts"
        title={w.size === null ? "The next request's tokens" : "How much of the model's context window the next request takes"}
      >
        ?
      </button>
    </span>
  );
}

/** Under the toggles row: the "?" line when open, and from amber the two actions. */
export function ContextMeterPanel({
  reading,
  window: w,
  cost,
  open,
  canAct,
  canSummarize,
  onSummarize,
  onStartFresh,
}: {
  reading: MeterReading;
  window: ContextWindow;
  cost: string | null;
  open: boolean;
  canAct: boolean; // a conversation to act on, and no reply under way
  canSummarize: boolean; // turns the summary does not cover yet
  onSummarize: () => void;
  onStartFresh: () => void;
}) {
  const warn = reading.level !== "ok" && canAct;
  if (!open && !warn) return null;
  return (
    <div className={`ai-meter-panel is-${reading.level}`}>
      {open && <div className="ai-meter-detail">{meterDetail(reading, w, cost)}</div>}
      {warn && (
        <div className="ai-meter-actions">
          <span>{reading.level === "red" ? "The model's context is nearly full." : "The model's context is filling up."}</span>
          {canSummarize && (
            <button
              type="button"
              className="ai-meter-act"
              onClick={onSummarize}
              title="The model reads the app's summary of the turns so far (the questions, the checks run and the app's verdicts), not their text. The transcript keeps them."
            >
              Summarize and continue
            </button>
          )}
          <button type="button" className="ai-meter-act" onClick={onStartFresh} title="Clear the conversation and the regions it marked">
            Start fresh
          </button>
        </div>
      )}
    </div>
  );
}
