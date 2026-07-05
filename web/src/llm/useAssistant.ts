// Assistant orchestration: settings + the connection probe (with auto-connect
// and model auto-pick), and the diagnostic-context query that fetches one shared
// reciprocal cut across the pipeline stages plus a ΔPDF orthoslice, then folds
// them into the compact PipelineContext the model reasons over.  Nothing leaves
// the machine here except a GET to the user's own model server.

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  fetchBraggProfile,
  fetchDpdfMeta,
  fetchDpdfSlice,
  fetchMeta,
  fetchSlice,
} from "../api/client";
import type { Dataset } from "../api/types";
import { checkConnection, type ConnectionResult } from "./provider/client";
import {
  buildPipelineContext,
  type PipelineContext,
  type StageSlices,
} from "./context/pipelineContext";
import { saveSettings, useLlmSettings } from "./settings";

// The reciprocal cut every stage metric is computed on: the L=0 plane through
// the origin, where rings, punched peaks and diffuse are all most visible.
const RECIP_PLANE = "hk0";
const RECIP_VALUE = 0;
// The ΔPDF orthoslice: the z=0 real-space plane through the origin.
const DPDF_PLANE = "xy";
const DPDF_VALUE = 0;

const safe = async <T>(p: Promise<T>): Promise<T | null> => {
  try {
    return await p;
  } catch {
    return null;
  }
};

const stageVolumeId = (dataset: Dataset, name: string): string | undefined =>
  dataset.stages.find((s) => s.name === name && s.exists)?.volume_id;

// The context plus the raw fetched slices/metadata, so the UI can also render a
// slice image for the vision path without re-fetching.
export interface AssistantContext {
  context: PipelineContext;
  slices: StageSlices;
  lattice: { a: number | null; b: number | null; c: number | null } | null;
}

// Fetch the slices + metadata the context needs and assemble it.  Every fetch is
// independent and failure-tolerant: a missing stage just omits its metrics.
export async function loadPipelineContext(dataset: Dataset): Promise<AssistantContext> {
  const hklVolId =
    stageVolumeId(dataset, "raw") ??
    dataset.stages.find((s) => s.kind === "hkl" && s.exists)?.volume_id;
  const dpdfVolId = dataset.stages.find((s) => s.kind === "delta_pdf" && s.exists)?.volume_id;

  const hklMeta = hklVolId ? await safe(fetchMeta(hklVolId)) : null;
  const dpdfMeta = dpdfVolId ? await safe(fetchDpdfMeta(dpdfVolId)) : null;

  const getRecip = (name: string) => {
    const id = stageVolumeId(dataset, name);
    return id ? safe(fetchSlice(id, RECIP_PLANE, RECIP_VALUE)) : Promise.resolve(null);
  };

  const [raw, ringremoved, braggpunched, backfilled, dpdf, braggProfile] = await Promise.all([
    getRecip("raw"),
    getRecip("ringremoved"),
    getRecip("braggpunched"),
    getRecip("backfilled"),
    dpdfVolId ? safe(fetchDpdfSlice(dpdfVolId, DPDF_PLANE, DPDF_VALUE)) : Promise.resolve(null),
    safe(fetchBraggProfile(dataset.id)),
  ]);

  const slices: StageSlices = { raw, ringremoved, braggpunched, backfilled, dpdf };

  const context = buildPipelineContext({
    datasetLabel: dataset.temperature ?? dataset.stem ?? dataset.id,
    plane: RECIP_PLANE,
    cutValue: RECIP_VALUE,
    hklMeta,
    dpdfMeta,
    braggProfile,
    slices,
  });

  return { context, slices, lattice: hklMeta?.lattice ?? dpdfMeta?.lattice ?? null };
}

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

  const contextQuery = useQuery({
    queryKey: ["assistantContext", dataset?.id, dataset?.stages.map((s) => s.name).join(",")],
    queryFn: () => loadPipelineContext(dataset as Dataset),
    enabled: enabled && Boolean(dataset),
    staleTime: 60_000,
  });

  const connected = connection.status === "ok" && Boolean(settings.model);

  return { settings, saveSettings, connection, connected, runTest, contextQuery };
}
