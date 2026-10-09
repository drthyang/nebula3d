// The AI Assistant panel, docked beside every page: a title row, the compact
// model connection, an optional connection-settings drawer, and two modes —
// Chat, where the model answers (and measures, looks up, opens the viewer)
// from the dataset the pages show, and Tune, where it runs the pipeline one
// stage at a time and keeps the best settings for each.

import { useMemo, useState } from "react";

import { useDatasets } from "../../api/hooks";
import { BrandGlyph, EmptyState, IconAlert } from "../../components/ui";
import { useDatasetStore } from "../../state/datasetStore";
import type { ToolContext } from "../tools";
import { useTuneStore } from "../tune/tuner";
import { useAssistant } from "../useAssistant";
import { ChatView } from "./ChatView";
import { ConnectionBar } from "./ConnectionBar";
import { ConnectionSettings } from "./ConnectionSettings";
import { TunePanel } from "./TunePanel";

export function AssistantPanel({ onClose }: { onClose: () => void }) {
  const datasetsQ = useDatasets();
  const datasets = useMemo(() => datasetsQ.data ?? [], [datasetsQ.data]);
  const datasetId = useDatasetStore((s) => s.datasetId);
  const dataset = datasets.find((d) => d.id === datasetId);

  const { settings, connection, connected, runTest, contextQuery } = useAssistant(dataset);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const tuning = useTuneStore((s) => s.active);
  const [mode, setMode] = useState<"chat" | "tune">(tuning ? "tune" : "chat");
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
          AI Assistant
          <span className="nav-beta">Beta</span>
        </span>
        <button type="button" className="ai-panel-close" onClick={onClose} title="Close the assistant" aria-label="Close the assistant">
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
      {mode === "chat" && dataset && !ready && contextQuery.isError && (
        <EmptyState
          title="Could not build the diagnostic context"
          hint="Run the pipeline for this dataset first — the assistant reads its stage outputs."
        />
      )}

      <div className="ai-modes" role="tablist">
        {(["chat", "tune"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={mode === m ? "on" : ""}
            onClick={() => setMode(m)}
          >
            {m === "chat" ? "Chat" : "Tune pipeline"}
            {m === "tune" && tuning && <span className="nav-dot" title="tuning is running" />}
          </button>
        ))}
      </div>

      {mode === "chat" ? (
        <ChatView
          assistant={contextQuery.data}
          connected={connected}
          settings={settings}
          toolContext={toolContext}
          contextLoading={contextQuery.isFetching}
        />
      ) : (
        <TunePanel dataset={dataset} connected={connected} settings={settings} />
      )}
    </div>
  );
}
