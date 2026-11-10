// TanStack Query hooks over the API client, and the in-browser engine's boot status.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import {
  fetchBraggProfile,
  fetchDataRoot,
  fetchDatasets,
  fetchDpdfMeta,
  fetchDpdfSlice,
  fetchHealth,
  fetchMeta,
  fetchPairSignal,
  fetchRingDiagnostics,
} from "./client";
import { getBootStatus, subscribeBoot, type BootStatus } from "./pyodideEngine";

/** The in-browser engine's boot status, updated as it boots (Pyodide build). */
export function useBootStatus(): BootStatus {
  const [status, setStatus] = useState<BootStatus>(getBootStatus);
  useEffect(() => subscribeBoot(setStatus), []);
  return status;
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    refetchInterval: 15_000,
    retry: false,
  });
}

export function useDatasets() {
  return useQuery({ queryKey: ["datasets"], queryFn: fetchDatasets });
}

export function useDataRoot() {
  return useQuery({ queryKey: ["dataRoot"], queryFn: fetchDataRoot });
}

export function useMeta(volumeId: string | undefined) {
  return useQuery({
    queryKey: ["meta", volumeId],
    queryFn: () => fetchMeta(volumeId as string),
    enabled: Boolean(volumeId),
  });
}

export function useDpdfMeta(volumeId: string | undefined) {
  return useQuery({
    queryKey: ["dpdfMeta", volumeId],
    queryFn: () => fetchDpdfMeta(volumeId as string),
    enabled: Boolean(volumeId),
  });
}

/**
 * The ΔPDF at a structure's pair vectors (fetchPairSignal): one read per
 * volume and structure, whatever the cuts, the pairs hidden or the fill
 * threshold. `vectors.key` names the differences and `lat` the lengths they
 * are drawn at. No placeholder from the structure before: its table would be
 * read with this one's indices.
 */
export function usePairSignal(
  volumeId: string | undefined,
  vectors: { diffs: Float64Array; key: string } | null,
  lat: readonly [number, number, number] | null,
) {
  const key = vectors && lat ? `${vectors.key}@${lat.join(",")}` : "";
  return useQuery({
    queryKey: ["dpdfPairSignal", volumeId, key],
    queryFn: () => fetchPairSignal(volumeId as string, vectors!.diffs, lat!, key),
    enabled: Boolean(volumeId && vectors && lat && vectors.diffs.length > 0),
    retry: false,
  });
}

export function useDpdfSlice(
  volumeId: string | undefined,
  plane: string,
  value: number,
) {
  return useQuery({
    queryKey: ["dpdfSlice", volumeId, plane, value],
    queryFn: () => fetchDpdfSlice(volumeId as string, plane, value),
    enabled: Boolean(volumeId),
    placeholderData: keepPreviousData,
  });
}

/** The ring removal's record of a dataset (its diagnostics), keyed by when the
 *  ring-removed output was written, so a new run reads it again. */
export function useRingDiagnostics(datasetId: string | null | undefined, written: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["ringDiagnostics", datasetId, written ?? null],
    queryFn: () => fetchRingDiagnostics(datasetId as string),
    enabled: Boolean(datasetId) && enabled,
    retry: false,
  });
}

export function useBraggProfile(datasetId: string | undefined) {
  return useQuery({
    queryKey: ["braggProfile", datasetId],
    queryFn: () => fetchBraggProfile(datasetId as string),
    enabled: Boolean(datasetId),
  });
}
