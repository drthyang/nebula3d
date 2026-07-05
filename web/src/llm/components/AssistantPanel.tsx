// The AI Assistant view: a shared-style header (dataset + at-a-glance verdicts),
// the model connection cluster, and the chat.  The heavy lifting (metrics + the
// model call) lives in useAssistant / ChatView; this component only wires the
// shared dataset selection to them and mirrors the layout of the other pages.

import { useMemo } from "react";

import { useDatasets } from "../../api/hooks";
import { EmptyState, IconAlert } from "../../components/ui";
import { useDatasetStore, useInitializeDataset } from "../../state/datasetStore";
import { useAssistant } from "../useAssistant";
import { ChatView } from "./ChatView";
import { ConnectionBar } from "./ConnectionBar";

interface Verdict {
  key: string;
  value: string;
  tone: "good" | "warn" | "none";
}

function verdict(
  key: string,
  value: number | null | undefined,
  good: (v: number) => boolean,
  fmt: (v: number) => string = String,
): Verdict {
  if (value == null || !Number.isFinite(value)) return { key, value: "—", tone: "none" };
  return { key, value: fmt(value), tone: good(value) ? "good" : "warn" };
}

export function AssistantPanel() {
  const datasetsQ = useDatasets();
  const datasets = useMemo(() => datasetsQ.data ?? [], [datasetsQ.data]);
  useInitializeDataset(datasets);

  const datasetId = useDatasetStore((s) => s.datasetId);
  const setDataset = useDatasetStore((s) => s.setDataset);
  const dataset = datasets.find((d) => d.id === datasetId);

  const { settings, connection, connected, runTest, contextQuery } = useAssistant(dataset);
  const ac = contextQuery.data;
  const ctx = ac?.context;

  const verdicts: Verdict[] = ctx
    ? [
        verdict("Ring energy", ctx.ring_removal?.after_ring_energy, (v) => v < 0.15),
        verdict("Peaks left", ctx.bragg_punch?.leftover.n_suspicious, (v) => v === 0),
        verdict("Backfill seam σ", ctx.backfill?.median_seam_sigma, (v) => v < 1.5),
        verdict("ΔPDF SNR", ctx.delta_pdf?.feature_snr, (v) => v >= 5),
        verdict("ΔPDF anisotropy", ctx.delta_pdf?.anisotropy_ratio, () => true, (v) => `${v}×`),
      ]
    : [];

  return (
    <div className="page-body ai-page">
      <div className="qr-header ai-header">
        <div className="qr-header-dataset">
          <span className="qr-eyebrow">Dataset</span>
          <select value={datasetId ?? ""} onChange={(e) => setDataset(e.target.value)}>
            {datasets.map((d) => (
              <option key={d.id} value={d.id} title={d.raw_name}>
                {d.temperature ?? d.stem}
              </option>
            ))}
          </select>
        </div>

        <div className="qr-divider" />

        {verdicts.length > 0 ? (
          <div className="ai-verdicts">
            {verdicts.map((v) => (
              <div key={v.key} className={`ai-verdict ai-verdict--${v.tone}`}>
                <span className="ai-verdict-key">{v.key}</span>
                <span className="ai-verdict-val">{v.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <span className="qr-desc">
            {contextQuery.isFetching
              ? "Computing metrics from the stage volumes…"
              : "Select a processed dataset to compute per-stage quality metrics."}
          </span>
        )}
      </div>

      <ConnectionBar settings={settings} connection={connection} onTest={runTest} />

      {datasetsQ.isError && (
        <EmptyState
          error
          icon={<IconAlert />}
          title="Backend unreachable"
          hint="Start the API server (or wait for the in-browser engine) and reload."
        />
      )}
      {dataset && !ctx && contextQuery.isError && (
        <EmptyState
          title="Could not build the diagnostic context"
          hint="Run the pipeline for this dataset first — the assistant reads its stage outputs."
        />
      )}

      <ChatView assistant={ac} connected={connected} settings={settings} />
    </div>
  );
}
