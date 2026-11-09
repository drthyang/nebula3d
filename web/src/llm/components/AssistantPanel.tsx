// The NEBULA Pilot panel, docked beside every page (or under it, as a bottom
// sheet, on a portrait screen; components/PilotDock.tsx): a title row, the compact
// model connection, an optional connection-settings drawer, and the chat, where
// the model answers from the dataset the pages show and acts on it: it
// measures and assesses, opens the viewer, runs the pipeline, and tunes it.
// The regions it marks on the slice views are listed above the chat
// (MarksList), while the dataset has any, and so are the changes applied from
// its Apply cards (ChangesList): in the room the chat gives them (ChatView's
// `above`), so they never cover the transcript or push the dock off-screen. While a reply runs, the title row shows how
// long it has worked (ReplyClock).

import { useMemo, useState } from "react";

import { useDatasets } from "../../api/hooks";
import type { DockMode } from "../../state/dockLayout";
import { BrandGlyph, EmptyState, IconAlert } from "../../components/ui";
import { useDatasetStore } from "../../state/datasetStore";
import { contextWarning } from "../provider/client";
import type { ToolContext } from "../tools";
import { useAssistant } from "../useAssistant";
import { ChangesList } from "./ChangesList";
import { ChatView } from "./ChatView";
import { ConnectionBar } from "./ConnectionBar";
import { ConnectionSettings } from "./ConnectionSettings";
import { MarksList } from "./MarksList";
import { ReplyClock } from "./ReplyClock";

export function AssistantPanel({ mode, onCollapse }: { mode: DockMode; onCollapse: () => void }) {
  const datasetsQ = useDatasets();
  const datasets = useMemo(() => datasetsQ.data ?? [], [datasetsQ.data]);
  const datasetId = useDatasetStore((s) => s.datasetId);
  const dataset = datasets.find((d) => d.id === datasetId);

  const { settings, connection, connected, runTest, contextQuery, modelContext } = useAssistant(dataset);
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
        <ReplyClock />
        <button
          type="button"
          className="ai-panel-close"
          onClick={onCollapse}
          title={mode === "docked" ? "Collapse NEBULA Pilot to its rail" : "Collapse NEBULA Pilot"}
          aria-label="Collapse NEBULA Pilot"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path
              d={mode === "docked" ? "M5 3l4 4-4 4" : "M3 5l4 4 4-4"}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
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
        contextNote={settings.useTools ? contextWarning(modelContext, settings.model) : null}
        modelContext={modelContext}
        above={
          <>
            <MarksList datasetId={datasetId} />
            <ChangesList datasetId={datasetId} folded={mode === "sheet"} />
          </>
        }
      />
    </div>
  );
}
