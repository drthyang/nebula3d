// The Configure form remembered per dataset, in this browser.  Switching to a
// dataset brings back the settings last used with it, and a reload keeps both
// the dataset and its settings.  A dataset seen for the first time keeps the
// form as it stands when it is the same sample at another temperature, and
// starts from the defaults when it is another sample.  Facts about a sample —
// the protected satellite planes, the magnetic ion, the punch cell — then stay
// with their sample instead of leaking to the next.

import { useEffect } from "react";

import { DATASET_KEY, useDatasetStore } from "./datasetStore";
import { usePipelineStore, type PipelineConfig } from "./pipelineStore";

const CONFIG_KEY = "nebula3d.configByDataset.v1";

// The store's job state, not settings.
const NOT_CONFIG = new Set(["jobId", "running", "events", "times", "terminal"]);

type Saved = Record<string, Partial<PipelineConfig>>;

const readSaved = (): Saved => {
  try {
    const v = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Saved) : {};
  } catch {
    return {};
  }
};

const writeSaved = (saved: Saved): void => {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(saved));
  } catch {
    // Private mode or quota: the settings just are not remembered.
  }
};

/** The sample a dataset id names: the part before its temperature token
 * ("Fe3Ge2-90K-…" → "Fe3Ge2"), else its first segment. */
export function sampleOf(id: string): string {
  const m = /^(.*?)-?\d+(?:\.\d+)?K(?:-|$)/i.exec(id);
  return m ? m[1] : id.split("-")[0];
}

/** The settings in the pipeline store's state (no job state, no actions). */
export function configOf(state: object): Partial<PipelineConfig> {
  return Object.fromEntries(
    Object.entries(state).filter(([k, v]) => typeof v !== "function" && !NOT_CONFIG.has(k)),
  ) as Partial<PipelineConfig>;
}

/** Starts remembering the form per dataset; returns the stop function. */
export function rememberConfig(): () => void {
  let current = useDatasetStore.getState().datasetId;
  let applying = false;
  const save = () => {
    if (!current || applying) return;
    const saved = readSaved();
    saved[current] = configOf(usePipelineStore.getState());
    writeSaved(saved);
  };
  const defaults = configOf(usePipelineStore.getInitialState());
  const switchTo = (id: string | undefined) => {
    const previous = current;
    current = id;
    if (!id) return;
    try {
      localStorage.setItem(DATASET_KEY, id);
    } catch {
      // not remembered
    }
    const known = readSaved()[id] ?? (previous && sampleOf(previous) !== sampleOf(id) ? defaults : null);
    if (known) {
      applying = true;
      usePipelineStore.getState().patch(known);
      applying = false;
    }
    if (!readSaved()[id]) save();
  };
  switchTo(current);
  const offDataset = useDatasetStore.subscribe((s) => {
    if (s.datasetId !== current) switchTo(s.datasetId);
  });
  let last = JSON.stringify(configOf(usePipelineStore.getState()));
  const offConfig = usePipelineStore.subscribe((s) => {
    const now = JSON.stringify(configOf(s));
    if (now === last) return; // a job event, not a setting
    last = now;
    save();
  });
  return () => {
    offDataset();
    offConfig();
  };
}

/** Keeps the form and the selected dataset remembered; mount once. */
export function useRememberedConfig(): void {
  useEffect(() => rememberConfig(), []);
}
