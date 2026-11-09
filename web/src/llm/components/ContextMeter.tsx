// The context meter by the chat box (THY-74; the maths in contextMeter.ts):
// "Context 62%", neutral below 70 %, amber to 90 %, red above. Its "?" opens
// one plain line: the tokens of the window, the reply's room, and on Claude
// what the conversation has cost. From amber it offers one action beside it:
// Summarize and continue (summarize.ts) where that shortens the request, else
// Start fresh; the other one, where there is one, is in the "?" line. On a
// phone it stays out of the toggles row until amber, and the action takes the
// bar's place there, so the dock grows by no row. UI only: nothing here is sent.

import { meterDetail, meterText, type ContextWindow, type MeterAction, type MeterReading } from "../contextMeter";

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
        {reading.percent !== null ? meterText(reading) : `Context ≈ ${compact(reading.prompt)} tokens`}
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

const ACTION: Record<MeterAction, { label: string; short: string; title: string }> = {
  summarize: {
    label: "Summarize and continue",
    short: "Summarize",
    title:
      "Summarize and continue: the model reads the app's summary of the turns so far (the questions, the checks run and the app's verdicts), not their text. The transcript keeps them.",
  },
  fresh: { label: "Start fresh", short: "Start fresh", title: "Start fresh: clear the conversation and the regions it marked" },
};

/** The action, in the toggles row beside the meter (a phone shows its short label). */
export function ContextMeterAction({ action, level, onAct }: { action: MeterAction; level: MeterReading["level"]; onAct: () => void }) {
  const a = ACTION[action];
  return (
    <button type="button" className={`ai-meter-act is-${level}`} onClick={onAct} title={a.title} aria-label={a.label}>
      <span className="ai-meter-act-long">{a.label}</span>
      <span className="ai-meter-act-short" aria-hidden="true">
        {a.short}
      </span>
    </button>
  );
}

/** The "?" line under the toggles row: the meter's detail, and the other action where there is one. */
export function ContextMeterDetail({
  reading,
  window: w,
  cost,
  other,
  onOther,
}: {
  reading: MeterReading;
  window: ContextWindow;
  cost: string | null;
  other: MeterAction | null; // the action the row does not show
  onOther: () => void;
}) {
  return (
    <div className="ai-meter-detail">
      {meterDetail(reading, w, cost)}
      {other && (
        <>
          {" "}
          <button type="button" className="ai-meter-other" onClick={onOther} title={ACTION[other].title}>
            {ACTION[other].label} instead
          </button>
        </>
      )}
    </div>
  );
}
