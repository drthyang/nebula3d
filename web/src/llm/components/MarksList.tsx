// The NEBULA Pilot's region marks on the selected dataset (state/markStore.ts),
// listed in its panel: each mark's colour, id, label and the stage it is on;
// a click on one moves the console to it (state/marks.ts showMark); each can
// be hidden or removed, and all of them hidden or cleared at once. Shown only
// while the dataset has marks.

import { useMemo, useState } from "react";

import { COLORMAPS, DIVERGING_NAME } from "../../colormaps/luts";
import { markColor } from "../../components/markColor";
import { useDpdfStore } from "../../state/dpdfStore";
import { isReciprocal, regionText, useMarkStore, WHERE_LABEL, type Mark } from "../../state/markStore";
import { showMark } from "../../state/marks";
import { useViewerStore } from "../../state/viewerStore";

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
      {open ? <circle cx="8" cy="8" r="2.1" fill="currentColor" /> : <path d="M2.5 13.5l11-11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />}
    </svg>
  );
}

export function MarksList({ datasetId }: { datasetId: string | undefined }) {
  const marks = useMarkStore((s) => s.marks);
  const showAll = useMarkStore((s) => s.showAll);
  const recipMap = useViewerStore((s) => s.colormap);
  const dpdfMap = useDpdfStore((s) => s.colormap);
  const [open, setOpen] = useState(true);
  const mine = useMemo(() => marks.filter((m) => m.datasetId === datasetId), [marks, datasetId]);
  if (!datasetId || !mine.length) return null;
  const store = useMarkStore.getState();
  // Each mark in the colour its page draws it in.
  const colorOf = (m: Mark) =>
    markColor(isReciprocal(m.where) ? (COLORMAPS[recipMap] ?? COLORMAPS.inferno) : (COLORMAPS[dpdfMap] ?? COLORMAPS[DIVERGING_NAME]));

  return (
    <section className="ai-marks" aria-label="Marked regions">
      <div className="ai-marks-head">
        <button type="button" className="ai-marks-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "▾" : "▸"} Marked regions <span className="ai-marks-count">{mine.length}</span>
        </button>
        <button
          type="button"
          className="ai-marks-act"
          aria-pressed={!showAll}
          onClick={() => store.setShowAll(!showAll)}
          title={showAll ? "Hide every mark on the slice views" : "Show the marks on the slice views again"}
        >
          {showAll ? "Hide all" : "Show all"}
        </button>
        <button type="button" className="ai-marks-act ai-clear" onClick={() => store.clear(datasetId)} title="Remove every mark on this dataset">
          Clear
        </button>
      </div>
      {open && (
        <ul className="ai-mark-list">
          {mine.map((m) => {
            const shown = showAll && !m.hidden;
            return (
              <li key={m.id} className={`ai-mark${shown ? "" : " is-hidden"}`}>
                <button
                  type="button"
                  className="ai-mark-go"
                  onClick={() => showMark(m, datasetId)}
                  title={`${regionText(m.region, m.where)}${m.evidence.length ? ` · rests on ${m.evidence.join(", ")}` : ""}. Click to show it.`}
                >
                  <span className="ai-mark-swatch" style={{ background: colorOf(m) }} aria-hidden="true" />
                  <span className="ai-mark-id">{m.id}</span>
                  <span className="ai-mark-label">{m.label}</span>
                  <span className="ai-mark-where">{WHERE_LABEL[m.where]}</span>
                </button>
                <button
                  type="button"
                  className="ai-mark-icon"
                  aria-pressed={!m.hidden}
                  aria-label={m.hidden ? `Show ${m.id}` : `Hide ${m.id}`}
                  title={m.hidden ? "Show this mark" : "Hide this mark"}
                  onClick={() => store.toggle(m.id)}
                >
                  <EyeIcon open={!m.hidden} />
                </button>
                <button type="button" className="ai-mark-icon ai-mark-remove" aria-label={`Remove ${m.id}`} title="Remove this mark" onClick={() => store.remove(m.id)}>
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
