// The Configure form remembered per dataset, in this browser.  Switching to a
// dataset brings back the settings last used with it, and a reload keeps both
// the dataset and its settings.  A dataset seen for the first time keeps the
// form as it stands when it is the same sample at another temperature, and
// starts from the defaults when it is another sample.  Facts about a sample —
// its modulation, the magnetic ion, the punch cell — then stay with their
// sample instead of leaking to the next.  A form remembered before
// modulations were declared has its protected H planes migrated, once
// (migrateSaved).

import { useEffect } from "react";

import { DATASET_KEY, useDatasetStore } from "./datasetStore";
import { LEGACY_PROTECTION_KEYS, migratedProtection } from "./modulation";
import { usePipelineStore, type PipelineConfig } from "./pipelineStore";

const CONFIG_KEY = "nebula3d.configByDataset.v1";

// The store's job state, not settings.
const NOT_CONFIG = new Set(["jobId", "running", "reconnecting", "events", "times", "terminal", "lastRun"]);

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

/**
 * The one-time migration of the protected H planes a remembered form held
 * before modulations were declared (punchProtectH, punchProtectHalfWidth) to
 * the sample's modulation (state/modulation.ts, migratedProtection): an
 * explicit value becomes k = (f, 0, 0) in plane form, "none" none, and a
 * blank one stays blank (the backend's default). The legacy keys go, so it
 * runs once; a form that already declares a modulation keeps its own. In
 * place; whether anything changed.
 */
export function migrateSaved(saved: Record<string, unknown>): boolean {
  let changed = false;
  for (const config of Object.values(saved)) {
    if (!config || typeof config !== "object") continue;
    const c = config as Record<string, unknown>;
    if (!LEGACY_PROTECTION_KEYS.some((k) => k in c)) continue;
    const declared = typeof c.modulationK === "string" && c.modulationK.trim() !== "";
    const fields = declared ? null : migratedProtection(c);
    if (fields) Object.assign(c, fields);
    for (const k of LEGACY_PROTECTION_KEYS) delete c[k];
    changed = true;
  }
  return changed;
}

/** The sample a dataset id names: the part before its temperature token
 * ("Ab2Cd3-<T>-…" → "Ab2Cd3"), else its first segment. */
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
  const remembered = readSaved();
  if (migrateSaved(remembered)) writeSaved(remembered);
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
      // Only the settings the form still has: a key a newer build retired
      // (e.g. punchMethod) is dropped, and the next save forgets it.
      usePipelineStore.getState().patch(
        Object.fromEntries(Object.entries(known).filter(([k]) => k in defaults)) as Partial<PipelineConfig>,
      );
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
