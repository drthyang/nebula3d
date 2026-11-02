// Shared dataset selection for every page in the console.

import { useEffect } from "react";
import { create } from "zustand";

import { resetsWithVolume } from "./volumeReset";
import type { Dataset } from "../api/types";

interface DatasetState {
  datasetId?: string;
  // The user closed the volume (state/closeVolume.ts): none is picked for
  // them until they load or pick one.
  closed: boolean;
  setDataset: (id: string) => void;
  resetDataset: () => void;
  closeDataset: () => void;
}

export const useDatasetStore = create<DatasetState>((set) => ({
  datasetId: undefined,
  closed: false,
  setDataset: (datasetId) => set({ datasetId, closed: false }),
  resetDataset: () => set({ datasetId: undefined, closed: false }),
  closeDataset: () => set({ datasetId: undefined, closed: true }),
}));

// Close clears the selection first itself (closeDataset), before the form
// resets, so the closed dataset's remembered settings are not overwritten.
resetsWithVolume(useDatasetStore, { keep: ["closed"] });

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
  const closed = useDatasetStore((s) => s.closed);
  const setDataset = useDatasetStore((s) => s.setDataset);

  useEffect(() => {
    if (datasetId || closed || !datasets.length) return;
    // The dataset last used here, while it still exists; else the first.
    const saved = savedDatasetId();
    setDataset(saved && datasets.some((d) => d.id === saved) ? saved : datasets[0].id);
  }, [datasetId, closed, datasets, setDataset]);
}
