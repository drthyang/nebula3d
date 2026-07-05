// The AI Assistant view: a slim header (dataset picker), the model connection
// cluster, and the chat.  The per-stage quality metrics are computed locally and
// handed to the model as context — deliberately *not* shown on the page, which
// keeps it clean; ask the assistant to surface any of them.  The heavy lifting
// (metrics + the model call) lives in useAssistant / ChatView.

import { useMemo } from "react";

import { useDatasets } from "../../api/hooks";
import { EmptyState, IconAlert } from "../../components/ui";
import { useDatasetStore, useInitializeDataset } from "../../state/datasetStore";
import { useAssistant } from "../useAssistant";
import { ChatView } from "./ChatView";
import { ConnectionBar } from "./ConnectionBar";

export function AssistantPanel() {
  const datasetsQ = useDatasets();
  const datasets = useMemo(() => datasetsQ.data ?? [], [datasetsQ.data]);
  useInitializeDataset(datasets);

  const datasetId = useDatasetStore((s) => s.datasetId);
  const setDataset = useDatasetStore((s) => s.setDataset);
  const dataset = datasets.find((d) => d.id === datasetId);

  const { settings, connection, connected, runTest, contextQuery } = useAssistant(dataset);
  const ready = Boolean(contextQuery.data);

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

        <span className="qr-desc">
          {contextQuery.isFetching
            ? "Reading the stage volumes and computing quality metrics…"
            : ready
              ? "Quality metrics for every stage are ready — ask the assistant about ring removal, the Bragg punch, backfill, or the ΔPDF."
              : "Select a processed dataset to prepare the assistant's context."}
        </span>
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
      {dataset && !ready && contextQuery.isError && (
        <EmptyState
          title="Could not build the diagnostic context"
          hint="Run the pipeline for this dataset first — the assistant reads its stage outputs."
        />
      )}

      <ChatView assistant={contextQuery.data} connected={connected} settings={settings} />
    </div>
  );
}
