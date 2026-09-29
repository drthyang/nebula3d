import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { clearImportParams, parseImport, receiveImport, reportImport } from "../api/importHandoff";
import { PYODIDE_MODE, engine, ensureBooted } from "../api/pyodideEngine";
import { useDatasetStore } from "../state/datasetStore";

type ImportState =
  | { phase: "waiting" }
  | { phase: "loading"; name: string }
  | { phase: "done"; name: string; detail: string }
  | { phase: "error"; message: string };

function describeMeta(meta: Record<string, string>): string {
  const sym = meta.symmetry && meta.symmetry !== "none" ? `${meta.symmetry} averaged` : "not symmetrized";
  return meta.source_file ? `${sym}, from ${meta.source_file}` : sym;
}

/**
 * Receives a volume sent by the NeXus Viewer's "Open in NEBULA3D" button (see
 * api/importHandoff.ts), loads it like "Load volume…", selects it as the
 * dataset, and shows the progress. Renders nothing for a normal page load.
 */
export function ViewerImportBanner({ onLoaded }: { onLoaded: () => void }) {
  const queryClient = useQueryClient();
  const setDataset = useDatasetStore((s) => s.setDataset);
  const [state, setState] = useState<ImportState | null>(null);

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
    receiveImport(req, { signal: controller.signal })
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
  return (
    <div className={`import-banner import-banner--${state.phase}`} role="status">
      {busy && <span className="spin" />}
      <span className="import-banner-text">
        {state.phase === "waiting" && "Waiting for the NeXus Viewer to send its volume… (starting the in-browser engine meanwhile)"}
        {state.phase === "loading" && `Loading ${state.name} from the NeXus Viewer…`}
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
