// The "Now examining" bar (THY-66): one line between the cleanup page's
// workspace header and its views, naming the NEBULA Pilot step being run or
// whose overlays are drawn, with a link to that step in the chat, and the
// legend: a chip per class drawn, with its count on this cut, each turning its
// class on and off. Result first; the codes behind "?". With Follow off it
// offers "Go there" (the step's figure). The Highlights switch hides the
// overlays, not the bar.

import { HelpTip } from "../../components/ui";
import { useNavStore } from "../../state/navStore";
import type { ClassDef, ClassId, Tone } from "../examine/overlays";
import { useExamineStore, type ShownSet } from "../examine/store";
import { useLlmSettings } from "../settings";
import { openView } from "../tools/openView";

const TONE: Record<Tone, string> = {
  red: "var(--red)",
  amber: "var(--amber)",
  green: "var(--green)",
  cyan: "var(--hl-cyan)",
  grey: "var(--hl-grey)",
  white: "#ffffff",
  r2: "var(--r2)",
  accent: "var(--accent-hi)",
};

// The classes counted on the cut; the bands, hatches and the coverage's lines are shown without a number.
const COUNTED = new Set<ClassId>(["node", "sharp", "broad", "protected", "holes", "r2", "AL", "LEFT", "GRID", "XTAL", "NJ"]);

/** A class's swatch, as the views draw it. */
function Swatch({ c }: { c: ClassDef }) {
  const col = TONE[c.tone];
  switch (c.id) {
    case "node":
    case "protected":
      return <svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.2" fill="none" stroke={col} strokeWidth="2" /></svg>;
    case "sharp":
      return <svg width="12" height="12" aria-hidden="true"><path d="M6 1.5L10.5 6L6 10.5L1.5 6Z" fill="none" stroke={col} strokeWidth="1.8" /></svg>;
    case "broad":
      return <svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4.5" fill="none" stroke={col} strokeWidth="1.3" strokeDasharray="3 2" /></svg>;
    case "holes":
      return <svg width="12" height="12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" fill="#808080" stroke="#fff" strokeWidth="1" /></svg>;
    case "r2":
      return <svg width="12" height="12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" fill="var(--r2-fill)" stroke="var(--r2)" /></svg>;
    case "unmeasured":
      return (
        <svg width="12" height="12" aria-hidden="true">
          <path d="M0 6L6 0M0 12L12 0M6 12L12 6" stroke="var(--hl-hatch)" strokeWidth="1" />
          <rect x="0.5" y="0.5" width="11" height="11" fill="none" stroke="var(--border-strong)" />
        </svg>
      );
    case "judged":
    case "pedestal":
      return <svg width="16" height="12" aria-hidden="true"><rect x="1" y="2" width="14" height="8" fill={col} fillOpacity="0.18" stroke={col} strokeDasharray="3 2" /></svg>;
    default: {
      const dash = { AL: "4 3", GRID: "1.5 2.5", XTAL: "5 3", NJ: "1 3", edges: "4 3", band: "4 3", reach: "6 2" }[c.id as string];
      return <svg width="16" height="12" aria-hidden="true"><line x1="1" y1="6" x2="15" y2="6" stroke={col} strokeWidth={c.id === "LEFT" ? 2 : 1.6} strokeDasharray={dash} /></svg>;
    }
  }
}

/** Scroll the chat to the step and pulse it: in its turn, or in the reply being written. */
function goToStep(shown: { turn: number | null; stepId: string }): void {
  useNavStore.getState().setDockOpen(true);
  requestAnimationFrame(() => {
    const el = document.getElementById(shown.turn === null ? `ai-step-live-${shown.stepId}` : `ai-step-${shown.turn}-${shown.stepId}`);
    if (!el) return;
    const list = el.closest("details");
    if (list && !list.open) list.open = true;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.remove("is-pulsed");
    void el.offsetWidth;
    el.classList.add("is-pulsed");
  });
}

interface Props {
  shown: ShownSet | null;
  counts: Partial<Record<ClassId, number>>; // on this cut, per class (draw.ts legendCounts)
}

export function ExamineBar({ shown, counts }: Props) {
  const running = useExamineStore((s) => s.running);
  const enabled = useExamineStore((s) => s.enabled);
  const off = useExamineStore((s) => s.off);
  const toggle = useExamineStore((s) => s.toggle);
  const clear = useExamineStore((s) => s.clear);
  const follow = useLlmSettings().followViews;
  if (!running && !shown) return null;
  // While a step runs the bar names it; the legend stays the last set's until its own arrives.
  const what = running?.title ?? shown!.set.title;
  const where = running && running.stepId !== shown?.set.stepId ? null : shown?.set.where;
  const step = running ? { turn: null, stepId: running.stepId, n: running.n } : { turn: shown!.turn, stepId: shown!.set.stepId, n: shown!.n };
  const view = !running ? shown?.set.view : undefined;
  return (
    <div className={`ex-bar${running ? " ex-bar--live" : ""}`} role="status" aria-live="polite">
      <span className="ex-pulse" aria-hidden="true" />
      <span className="ex-label">{running ? "Now examining" : "Examined"}</span>
      <span className="ex-what">{what}</span>
      {where && <span className="ex-where">· {where}</span>}
      <span className="ex-end">
        {!enabled && shown && <span className="ex-off">highlights off</span>}
        {view && !follow && (
          <button type="button" className="ex-step" onClick={() => openView(view)} title={`Open ${view.label}`}>
            Go there
          </button>
        )}
        <button type="button" className="ex-step" onClick={() => goToStep(step)} title="Show this step in the chat">
          step {step.n} ↗
        </button>
        {shown && (
          <HelpTip className="helptip--ex">
            {shown.set.help.map((line) => (
              <span key={line} className="ex-help-line">
                {line}
              </span>
            ))}
            <span className="ex-help-line">Counts are on this cut. Each chip turns its class on or off.</span>
          </HelpTip>
        )}
        {shown && !running && (
          <button type="button" className="ex-clear" onClick={clear} aria-label="Clear the highlights" title="Clear the highlights">
            ×
          </button>
        )}
      </span>
      {shown && (
        <div className="ex-legend" role="group" aria-label="Highlights legend">
          {shown.set.classes.map((c) => {
            const on = !off.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                className={`lg${on ? "" : " off"}`}
                aria-pressed={on}
                data-cls={c.id}
                onClick={() => toggle(c.id)}
                title={on ? `Hide ${c.label}` : `Show ${c.label}`}
              >
                <Swatch c={c} />
                {c.code && (
                  <span className="code" style={{ color: TONE[c.tone] }}>
                    {c.code}
                  </span>
                )}
                {c.label}
                {COUNTED.has(c.id) && <b>{counts[c.id] ?? 0}</b>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
