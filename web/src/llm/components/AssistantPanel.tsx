// The NEBULA Pilot panel, docked beside every page: a title row, the compact
// model connection, an optional connection-settings drawer, and the chat, where
// the model answers from the dataset the pages show and acts on it: it
// measures and assesses, opens the viewer, runs the pipeline, and tunes it.

import { useMemo, useState } from "react";

import { useDatasets } from "../../api/hooks";
import { BrandGlyph, EmptyState, IconAlert } from "../../components/ui";
import { useDatasetStore } from "../../state/datasetStore";
import type { ToolContext } from "../tools";
import { useAssistant } from "../useAssistant";
import { ChatView } from "./ChatView";
import { ConnectionBar } from "./ConnectionBar";
import { ConnectionSettings } from "./ConnectionSettings";

export function AssistantPanel({ onClose }: { onClose: () => void }) {
  const datasetsQ = useDatasets();
  const datasets = useMemo(() => datasetsQ.data ?? [], [datasetsQ.data]);
  const datasetId = useDatasetStore((s) => s.datasetId);
  const dataset = datasets.find((d) => d.id === datasetId);

  const { settings, connection, connected, runTest, contextQuery } = useAssistant(dataset);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const ready = Boolean(contextQuery.data);
  const toolContext = useMemo<ToolContext | null>(
    () => (dataset ? { dataset, datasets } : null),
    [dataset, datasets],
  );

  return (
    <div className="ai-panel">
      <div className="ai-panel-head">
        <span className="ai-panel-title">
          <BrandGlyph size={16} />
          NEBULA Pilot
          <span className="nav-beta">Beta</span>
        </span>
        <button type="button" className="ai-panel-close" onClick={onClose} title="Close NEBULA Pilot" aria-label="Close NEBULA Pilot">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="ai-topbar">
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
          hint="Run the pipeline for this dataset first — NEBULA Pilot reads its stage outputs."
        />
      )}

      <ChatView
        assistant={contextQuery.data}
        connected={connected}
        settings={settings}
        toolContext={toolContext}
        contextLoading={contextQuery.isFetching}
      />
    </div>
  );
}
