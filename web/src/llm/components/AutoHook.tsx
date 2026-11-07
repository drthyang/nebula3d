// Auto mode's minimal hook in the chat's dock (THY-65 PR 6; the full Auto
// panel, its plan and progress, is PR 7's): "Run auto analysis" to start; while
// a run is open, one line with what it is doing and its clock, and Stop,
// Resume (Retry after a failure) or End; the fact it waits for, pinned with
// its own Apply (your click) and Dismiss (Skip); and, once it is done, Undo of
// its changes (one your click made, on your click).

import { ClockLine } from "./ReplyClock";
import { PinnedCard } from "./ProposalCards";
import { endAuto, resumeAuto, startAuto, stopAuto, undoAutoRun } from "../auto/controller";
import { useAutoStore } from "../auto/store";
import type { ToolContext } from "../tools";

export function AutoHook({ ctx, canStart }: { ctx: ToolContext | null; canStart: boolean }) {
  const run = useAutoStore((s) => s.run);
  const open = run && run.state !== "done";
  if (!open) {
    return (
      <div className="ai-auto">
        <button
          type="button"
          className="ai-vision-chip"
          disabled={!canStart || !ctx}
          onClick={() => ctx && void startAuto({ ctx }).catch(() => {})}
          title="Preflight, a run, check and fix each stage, then a report. Pauses for a sample fact; 30 minutes, 2 fixes a stage, 12 model replies at most."
        >
          Run auto analysis
        </button>
        {run?.state === "done" && run.decisions.length > 0 && (
          <button type="button" className="ai-clear" onClick={(e) => undoAutoRun(e.nativeEvent)} title="Put back the settings the auto run changed (one your click made needs your click)">
            Undo auto changes
          </button>
        )}
      </div>
    );
  }
  const fact = run.pause?.kind === "fact" ? run.pause.proposal : null;
  return (
    <div className="ai-auto is-open" role="status">
      <div className="ai-auto-line">
        <span className="ai-auto-now">Auto · {run.now}</span>
        <ClockLine clock={run.clock} />
        {run.state === "running" ? (
          <button type="button" className="ai-clear" onClick={stopAuto}>
            Stop
          </button>
        ) : (
          <>
            {!fact && (
              <button type="button" className="ai-clear" disabled={!ctx} onClick={() => ctx && void resumeAuto({ ctx }).catch(() => {})}>
                {run.pause?.kind === "failure" ? "Retry" : "Resume"}
              </button>
            )}
            <button type="button" className="ai-clear" onClick={endAuto}>
              End
            </button>
          </>
        )}
      </div>
      {fact && <PinnedCard id={fact} ctx={ctx} />}
    </div>
  );
}
