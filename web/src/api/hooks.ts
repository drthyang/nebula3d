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

export function useBraggProfile(datasetId: string | undefined) {
  return useQuery({
    queryKey: ["braggProfile", datasetId],
    queryFn: () => fetchBraggProfile(datasetId as string),
    enabled: Boolean(datasetId),
  });
}
