// The AI Assistant view: a slim top toolbar (dataset picker + compact model
// connection), an optional connection-settings drawer, and the chat.  The
// per-stage quality metrics are computed locally and handed to the model as
// context — not shown on the page — so the surface stays clean; ask the
// assistant to surface any of them.

import { useMemo, useState } from "react";

import { useDatasets } from "../../api/hooks";
import { EmptyState, IconAlert } from "../../components/ui";
import { useDatasetStore, useInitializeDataset } from "../../state/datasetStore";
import { useAssistant } from "../useAssistant";
import { ChatView } from "./ChatView";
import { ConnectionBar } from "./ConnectionBar";
import { ConnectionSettings } from "./ConnectionSettings";

export function AssistantPanel() {
  const datasetsQ = useDatasets();
  const datasets = useMemo(() => datasetsQ.data ?? [], [datasetsQ.data]);
  useInitializeDataset(datasets);

  const datasetId = useDatasetStore((s) => s.datasetId);
  const setDataset = useDatasetStore((s) => s.setDataset);
  const dataset = datasets.find((d) => d.id === datasetId);

  const { settings, connection, connected, runTest, contextQuery } = useAssistant(dataset);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const ready = Boolean(contextQuery.data);

  return (
    <div className="page-body ai-page">
      <div className="ai-topbar">
        <label className="ai-topbar-dataset">
          <span className="qr-eyebrow">Dataset</span>
          <select value={datasetId ?? ""} onChange={(e) => setDataset(e.target.value)}>
            {datasets.map((d) => (
              <option key={d.id} value={d.id} title={d.raw_name}>
                {d.temperature ?? d.stem}
              </option>
            ))}
          </select>
        </label>

        <ConnectionBar
          settings={settings}
          connection={connection}
          settingsOpen={settingsOpen}
          onToggleSettings={() => setSettingsOpen((o) => !o)}
        />
      </div>

      {settingsOpen && (
        <ConnectionSettings settings={settings} connection={connection} onTest={runTest} />
      )}

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

      <ChatView
        assistant={contextQuery.data}
        connected={connected}
        settings={settings}
        contextLoading={contextQuery.isFetching}
      />
    </div>
  );
}
