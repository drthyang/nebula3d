// Assistant orchestration: settings + the connection probe (with auto-connect
// and model auto-pick), and the diagnostic-context query that folds one shared
// reciprocal cut across the pipeline stages plus a ΔPDF orthoslice into the
// compact PipelineContext the model reasons over (context/loadContext.ts).
// Nothing leaves the machine here except a GET to the user's own model server.

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import type { Dataset } from "../api/types";
import { useChatStore } from "./chatStore";
import { loadPipelineContext } from "./context/loadContext";
import { checkConnection, loadedContext, type ConnectionResult, type ModelContext } from "./provider/client";
import { saveSettings, useLlmSettings } from "./settings";

export type { AssistantContext } from "./context/loadContext";

export interface ConnectionState extends ConnectionResult {
  status: "idle" | "testing" | "ok" | "error";
  manual?: boolean;
}

export function useAssistant(dataset: Dataset | undefined, enabled = true) {
  const settings = useLlmSettings();
  const [connection, setConnection] = useState<ConnectionState>({
    status: "idle",
    ok: false,
    models: [],
    error: null,
    hint: null,
  });
  const autoTestedRef = useRef<string | null>(null);

  const probe = useCallback(
    async (manual: boolean) => {
      setConnection({ status: "testing", ok: false, models: [], error: null, hint: null, manual });
      try {
        const result = await checkConnection(settings.baseUrl, { apiKey: settings.apiKey });
        setConnection({
          status: result.ok ? "ok" : "error",
          ok: result.ok,
          models: result.models,
          error: result.error,
          hint: result.hint,
          manual,
        });
        if (result.ok && result.models.length && !result.models.includes(settings.model)) {
          saveSettings({ model: result.models[0] });
        }
      } catch {
        // AbortError — ignore.
      }
    },
    [settings.baseUrl, settings.apiKey, settings.model],
  );

  const runTest = useCallback(() => probe(true), [probe]);

  useEffect(() => {
    if (!enabled) return;
    if (autoTestedRef.current === settings.baseUrl) return;
    autoTestedRef.current = settings.baseUrl;
    void probe(false);
  }, [enabled, settings.baseUrl, probe]);

  // The context length a local server loaded the model with, where it says
  // (LM Studio): read again on connecting, on a new model, when a reply starts
  // or ends (LM Studio may have loaded it again with its defaults), and when
  // the page regains focus (the user may have just reloaded it there).
  const [modelContext, setModelContext] = useState<ModelContext | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const busy = useChatStore((s) => s.busy);
  useEffect(() => {
    const onFocus = () => setFocusTick((t) => t + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  useEffect(() => {
    if (!enabled || connection.status !== "ok" || !settings.model) {
      setModelContext(null);
      return;
    }
    const abort = new AbortController();
    loadedContext(settings.baseUrl, settings.model, { signal: abort.signal })
      .then(setModelContext)
      .catch(() => {});
    return () => abort.abort();
  }, [enabled, connection, settings.baseUrl, settings.model, focusTick, busy]);

  const contextQuery = useQuery({
    queryKey: ["assistantContext", dataset?.id, dataset?.stages.map((s) => s.name).join(",")],
    queryFn: () => loadPipelineContext(dataset as Dataset),
    enabled: enabled && Boolean(dataset),
    staleTime: 60_000,
  });

  const connected = connection.status === "ok" && Boolean(settings.model);

  return { settings, saveSettings, connection, connected, runTest, contextQuery, modelContext };
}
