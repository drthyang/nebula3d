// Shared dataset selection for every page in the console.

import { useEffect } from "react";
import { create } from "zustand";

import type { Dataset } from "../api/types";

interface DatasetState {
  datasetId?: string;
  setDataset: (id: string) => void;
  resetDataset: () => void;
}

export const useDatasetStore = create<DatasetState>((set) => ({
  datasetId: undefined,
  setDataset: (datasetId) => set({ datasetId }),
  resetDataset: () => set({ datasetId: undefined }),
}));

// The dataset last selected in this browser (state/configMemory.ts keeps it).
export const DATASET_KEY = "nebula3d.dataset.v1";

export function savedDatasetId(): string | null {
  try {
    return localStorage.getItem(DATASET_KEY);
  } catch {
    return null;
  }
}

export function useInitializeDataset(datasets: readonly Dataset[]) {
  const datasetId = useDatasetStore((s) => s.datasetId);
  const setDataset = useDatasetStore((s) => s.setDataset);

  useEffect(() => {
    if (datasetId || !datasets.length) return;
    // The dataset last used here, while it still exists; else the first.
    const saved = savedDatasetId();
    setDataset(saved && datasets.some((d) => d.id === saved) ? saved : datasets[0].id);
  }, [datasetId, datasets, setDataset]);
}
