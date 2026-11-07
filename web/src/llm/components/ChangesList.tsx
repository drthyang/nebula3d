// The Changes list above the chat (docs/pilot-auto-mode-design.md §1.5),
// framed like MarksList: every change applied from an Apply card on the
// selected dataset, newest last, who made it, when, and Undo while the fields
// still hold what was applied; Undo all puts back every one still standing.
// A change only the user's own click makes ("you (click)") is undone on their
// own click too: the DOM's event goes with the Undo. Shown only while there
// is one; folded at first on a phone.

import { useMemo, useState } from "react";

import { byText, decisionText, undoable, undoAll, undoDecision } from "../apply/actions";
import { useDecisionStore } from "../apply/decisions";
import { useChatStore } from "../chatStore";

const clockTime = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// `folded`: start folded, its count in the head (on a phone's bottom sheet,
// where the list would take the room the chat has).
export function ChangesList({ datasetId, folded = false }: { datasetId: string | undefined; folded?: boolean }) {
  const proposals = useDecisionStore((s) => s.proposals);
  const decisions = useDecisionStore((s) => s.decisions);
  const notes = useDecisionStore((s) => s.notes);
  const busy = useChatStore((s) => s.busy);
  const [open, setOpen] = useState(!folded);
  const rows = useMemo(() => {
    const onDataset = new Set(proposals.filter((p) => p.dataset === datasetId).map((p) => p.id));
    return decisions.filter((d) => onDataset.has(d.proposal) && (d.action === "apply" || d.action === "edit-apply"));
  }, [proposals, decisions, datasetId]);
  if (!datasetId || !rows.length) return null;
  const standing = rows.filter(undoable).length;

  return (
    <section className="ai-marks ai-changes" aria-label="Changes">
      <div className="ai-marks-head">
        <button type="button" className="ai-marks-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "▾" : "▸"} Changes <span className="ai-marks-count">{rows.length}</span>
        </button>
        {standing > 1 && (
          <button type="button" className="ai-marks-act" disabled={busy} onClick={(e) => undoAll(e.nativeEvent)} title="Put back every change still standing, newest first">
            Undo all
          </button>
        )}
      </div>
      {open && (
        <ul className="ai-mark-list">
          {rows.map((d) => (
            <li key={d.id} className={`ch-row${d.undoneBy ? " is-undone" : ""}`}>
              <span className={`who${d.by === "auto" ? " auto" : ""}`} title={d.byClick ? "Applied by your own click" : undefined}>
                {byText(d)}
              </span>
              <span className="what" title={notes[d.id] ?? decisionText(d)}>
                {decisionText(d)}
                {notes[d.id] && <span className="ch-note"> · {notes[d.id]}</span>}
              </span>
              <span className="when">{clockTime(d.at)}</span>
              {undoable(d) ? (
                <button type="button" className="ai-marks-act" disabled={busy} onClick={(e) => undoDecision(d, e.nativeEvent)} title="Put back the values from before">
                  Undo
                </button>
              ) : d.undoneBy ? (
                <span className="ch-state">undone</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
