// The AI Assistant view: dataset picker, model connection bar, a compact
// at-a-glance metric summary, and the chat.  The heavy lifting (metrics + the
// model call) lives in useAssistant / ChatView; this component only wires the
// shared dataset selection to them.

import { useMemo } from "react";

import { useDatasets } from "../../api/hooks";
import { EmptyState, IconAlert, MetaStrip } from "../../components/ui";
import { useDatasetStore, useInitializeDataset } from "../../state/datasetStore";
import { useAssistant } from "../useAssistant";
import { ChatView } from "./ChatView";
import { ConnectionBar } from "./ConnectionBar";

function verdict(value: number | null | undefined, good: (v: number) => boolean, na = "—"): string {
  if (value == null || !Number.isFinite(value)) return na;
  return `${value} ${good(value) ? "✓" : "⚠"}`;
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

  const summary = ctx
    ? [
        {
          key: "Ring energy after",
          value: verdict(ctx.ring_removal?.after_ring_energy, (v) => v < 0.15),
        },
        {
          key: "Peaks left unpunched",
          value: verdict(ctx.bragg_punch?.leftover.n_suspicious, (v) => v === 0),
        },
        {
          key: "Backfill seam σ",
          value: verdict(ctx.backfill?.median_seam_sigma, (v) => v < 1.5),
        },
        {
          key: "ΔPDF feature SNR",
          value: verdict(ctx.delta_pdf?.feature_snr, (v) => v >= 5),
        },
        {
          key: "ΔPDF anisotropy",
          value: ctx.delta_pdf?.anisotropy_ratio ?? "—",
        },
      ]
    : [];

  return (
    <div className="page-body ai-page">
      <div className="ai-toolbar">
        <label className="ai-conn-field">
          <span className="field-label">Dataset</span>
          <select value={datasetId ?? ""} onChange={(e) => setDataset(e.target.value)}>
            {datasets.map((d) => (
              <option key={d.id} value={d.id} title={d.raw_name}>
                {d.temperature ?? d.stem}
              </option>
            ))}
          </select>
        </label>
        {contextQuery.isFetching && <span className="ai-hint">computing metrics…</span>}
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

      {summary.length > 0 && <MetaStrip items={summary} />}

      <ChatView assistant={ac} connected={connected} settings={settings} />
    </div>
  );
}
