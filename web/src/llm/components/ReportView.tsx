// The analysis report for one reply: measured afresh when opened (collect.ts),
// shown as the same self-contained page it exports, with downloads for the
// HTML page and the Markdown, and Print (the browser's own print to PDF).

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { Dataset } from "../../api/types";
import type { ChatTurn } from "../chatStore";
import { collectReport } from "../report/collect";
import { reportHtml, reportMarkdown } from "../report/render";
import type { Report } from "../report/report";
import type { LlmSettings } from "../settings";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "report";

function download(name: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ReportView({
  dataset,
  datasets,
  turn,
  question,
  settings,
  onClose,
}: {
  dataset: Dataset;
  datasets: Dataset[];
  turn: ChatTurn;
  question: string;
  settings: LlmSettings;
  onClose: () => void;
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let live = true;
    collectReport({ dataset, datasets, turn, question, llm: settings })
      .then((r) => live && setReport(r))
      .catch((e: unknown) => live && setError((e as Error).message || "the report could not be built"));
    return () => {
      live = false;
    };
    // One report per opening: the reply and the dataset it measured.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const html = useMemo(() => (report ? reportHtml(report) : null), [report]);
  const name = report ? `nebula-pilot-${slug(report.dataset.label)}-${report.created.slice(0, 10)}` : "report";

  return createPortal(
    <div className="report-overlay" role="dialog" aria-modal="true" aria-label="Analysis report">
      <div className="report-shell">
        <div className="report-bar">
          <span className="report-bar-title">Analysis report{report ? ` · ${report.kind}` : ""}</span>
          <span className="report-bar-actions">
            <button type="button" className="btn btn-ghost" disabled={!html} onClick={() => html && download(`${name}.html`, "text/html", html)}>
              Download HTML
            </button>
            <button type="button" className="btn btn-ghost" disabled={!report} onClick={() => report && download(`${name}.md`, "text/markdown", reportMarkdown(report))}>
              Download Markdown
            </button>
            <button type="button" className="btn btn-ghost" disabled={!html} onClick={() => frame.current?.contentWindow?.print()}>
              Print / PDF
            </button>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Close
            </button>
          </span>
        </div>
        {html ? (
          <iframe ref={frame} className="report-frame" srcDoc={html} title="Analysis report" />
        ) : (
          <div className="report-wait">
            {error ? (
              <span className="ai-conn-alert">{error}</span>
            ) : (
              <>
                <span className="spin" /> Measuring the reduction and drawing the figures…
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
