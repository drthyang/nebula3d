import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useBootStatus } from "../api/hooks";
import { clearImportParams, parseImport, receiveImport, reportImport, type ImportProgress } from "../api/importHandoff";
import { PYODIDE_MODE, bootPercent, engine, ensureBooted } from "../api/pyodideEngine";
import { useDatasetStore } from "../state/datasetStore";

type ImportState =
  | { phase: "waiting"; progress?: ImportProgress }
  | { phase: "loading"; name: string }
  | { phase: "done"; name: string; detail: string }
  | { phase: "error"; message: string };

function describeMeta(meta: Record<string, string>): string {
  const sym = meta.symmetry && meta.symmetry !== "none" ? `${meta.symmetry} averaged` : "not symmetrized";
  return meta.source_file ? `${sym}, from ${meta.source_file}` : sym;
}

/** A thin progress bar under the banner text. */
function Bar({ percent, label }: { percent: number; label: string }) {
  return (
    <span
      className="import-banner-bar"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${percent}%` }} />
    </span>
  );
}

/**
 * Receives a volume sent by the NeXus Viewer's "Open in NEBULA3D" button (see
 * api/importHandoff.ts), loads it like "Load volume…", selects it as the
 * dataset, and shows the progress: the viewer's build while it waits, then the
 * in-browser engine's start-up. Renders nothing for a normal page load.
 */
export function ViewerImportBanner({ onLoaded }: { onLoaded: () => void }) {
  const queryClient = useQueryClient();
  const setDataset = useDatasetStore((s) => s.setDataset);
  const [state, setState] = useState<ImportState | null>(null);
  const boot = useBootStatus();

  useEffect(() => {
    const req = parseImport(window.location.search, window.location.origin, import.meta.env.DEV);
    if (!req) return;
    if (!PYODIDE_MODE) {
      const message = "importing from the NeXus Viewer needs the in-browser build (drthyang.github.io/nebula3d). "
        + "Download the file in the viewer and put it in the data folder instead.";
      setState({ phase: "error", message });
      reportImport(req, { error: message });
      return;
    }
    const controller = new AbortController();
    setState({ phase: "waiting" });
    // Start the engine while the viewer is still building the file.
    void ensureBooted().catch(() => undefined);
    // The viewer reports how far it has built the volume while this page waits.
    const onProgress = (progress: ImportProgress) => setState({ phase: "waiting", progress });
    receiveImport(req, { signal: controller.signal, onProgress })
      .then(async ({ file, meta }) => {
        setState({ phase: "loading", name: file.name });
        const id = await engine.loadFile(file);
        await queryClient.invalidateQueries({ queryKey: ["datasets"] });
        setDataset(id);
        clearImportParams();
        reportImport(req, { datasetId: id });
        setState({ phase: "done", name: file.name, detail: describeMeta(meta) });
        onLoaded();
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        const message = (e as Error).message;
        setState({ phase: "error", message });
        reportImport(req, { error: message });
      });
    return () => controller.abort();
  }, [queryClient, setDataset, onLoaded]);

  if (!state) return null;
  const busy = state.phase === "waiting" || state.phase === "loading";
  const engineNote = boot.ready ? "the in-browser engine is ready" : "starting the in-browser engine meanwhile";
  return (
    <div className={`import-banner import-banner--${state.phase}`} role="status">
      {busy && <span className="spin" />}
      <span className="import-banner-text">
        {state.phase === "waiting" && !state.progress
          && `Waiting for the NeXus Viewer to send its volume… (${engineNote})`}
        {state.phase === "waiting" && state.progress && (
          <>
            The NeXus Viewer is preparing the volume: {state.progress.label}… {Math.round(100 * state.progress.fraction)}%
            ({engineNote})
            <Bar percent={100 * state.progress.fraction} label="NeXus Viewer export" />
          </>
        )}
        {state.phase === "loading" && !boot.ready && (
          <>
            Received {state.name} from the NeXus Viewer. Starting the in-browser engine: {boot.message}
            <Bar percent={bootPercent(boot)} label="In-browser engine start-up" />
          </>
        )}
        {state.phase === "loading" && boot.ready && `Loading ${state.name} into the in-browser engine…`}
        {state.phase === "done" && (
          <>
            Loaded <b>{state.name}</b> from the NeXus Viewer ({state.detail}). It is selected as the dataset: set the
            parameters below and run.
          </>
        )}
        {state.phase === "error" && `Could not import from the NeXus Viewer: ${state.message}`}
      </span>
      {!busy && (
        <button type="button" className="import-banner-close" aria-label="Dismiss" onClick={() => setState(null)}>
          ×
        </button>
      )}
    </div>
  );
}
