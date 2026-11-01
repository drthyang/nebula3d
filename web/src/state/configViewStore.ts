// The Configure page's own view state (zustand). None of it is a setting:
// the run's settings live in the pipeline store, where the agent's tools read
// and write them (configure_settings, update_settings), and nothing here is
// read by them. It holds
//   - the plane the preview shows (its tab), remembered per browser;
//   - which stages show their advanced settings, remembered per browser,
//     and those the agent opened to show a setting it changed (for the visit:
//     the agent's reveal is not the user's choice to remember);
//   - each plane's zoom (a viewport in Å⁻¹, as on the viewer pages) and the
//     preview's colour limits, for the dataset they were set on, for the visit;
//   - a stage section to bring into view once, asked from another page (the
//     Execution page's "Symmetrize here").
// The preview's colormap and scale are the viewer pages' own (viewerStore),
// one setting across the console; its limits are its own, since the raw volume
// it shows spans other values than the cleaned stage the cleanup page scales from.

import { create } from "zustand";

import type { Viewport } from "../components/viewport";
import type { PunchPlane } from "./pipelineStore";
import type { ManualLevels } from "./viewerStore";

/** The preview's tabs, in their order: a*–b*, a*–c*, b*–c*. */
export const PREVIEW_PLANES: readonly PunchPlane[] = ["hk", "hl", "kl"];

/** Where this browser remembers the preview's tab. */
export const PREVIEW_TAB_KEY = "nebula3d.configPreviewTab";

/** Where this browser remembers which stages show their advanced settings (a JSON list). */
export const ADVANCED_OPEN_KEY = "nebula3d.configAdvancedOpen";

/** The stages with advanced settings to fold away. */
export const ADVANCED_STAGES = ["symmetry_average", "rings", "punch", "flatten", "pdf"] as const;
export type AdvancedStage = (typeof ADVANCED_STAGES)[number];

const isPlane = (v: unknown): v is PunchPlane => typeof v === "string" && (PREVIEW_PLANES as readonly string[]).includes(v);
const isStage = (v: unknown): v is AdvancedStage => typeof v === "string" && (ADVANCED_STAGES as readonly string[]).includes(v);

/** The tab the preview opens on: the one this browser left, else a*–b*. */
export function initialPreviewTab(): PunchPlane {
  try {
    const v = localStorage.getItem(PREVIEW_TAB_KEY);
    return isPlane(v) ? v : "hk";
  } catch {
    return "hk"; // storage unavailable
  }
}

/** The stages whose advanced settings open unfolded: those this browser left open, else none. */
export function initialAdvancedOpen(): AdvancedStage[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(ADVANCED_OPEN_KEY) ?? "[]");
    return Array.isArray(v) ? [...new Set(v.filter(isStage))] : [];
  } catch {
    return []; // storage unavailable, or not a list
  }
}

const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: remembered for this visit only */
  }
};

/** Whether a stage's advanced settings show: the user left the fold open, or the agent opened it. */
export function advancedShown(s: { advancedOpen: readonly AdvancedStage[]; advancedRevealed: readonly AdvancedStage[] }, stage: AdvancedStage): boolean {
  return s.advancedOpen.includes(stage) || s.advancedRevealed.includes(stage);
}

/** One plane's viewport for a dataset, from the views set on it (none: the whole slice). */
export function previewView(
  views: { dataset: string | null; byPlane: Partial<Record<PunchPlane, Viewport>> },
  dataset: string | null | undefined,
  plane: PunchPlane,
): Viewport | undefined {
  return dataset && views.dataset === dataset ? views.byPlane[plane] : undefined;
}

interface ConfigViewState {
  previewTab: PunchPlane;
  setPreviewTab: (plane: PunchPlane) => void;
  advancedOpen: AdvancedStage[]; // the user's, remembered
  setAdvancedOpen: (stage: AdvancedStage, open: boolean) => void;
  advancedRevealed: AdvancedStage[]; // opened by the agent, for the visit
  revealAdvanced: (stages: readonly AdvancedStage[]) => void;
  // Each plane's zoom, for the dataset it was set on (another dataset starts from the whole slice).
  views: { dataset: string | null; byPlane: Partial<Record<PunchPlane, Viewport>> };
  setView: (dataset: string, plane: PunchPlane, v: Viewport | null) => void;
  levels: ManualLevels | null; // the preview's colour limits; null → Auto
  setLevels: (l: ManualLevels | null) => void;
  // A stage section to bring into view the next time the page shows (once).
  focusStage: string | null;
  setFocusStage: (stage: string | null) => void;
}

export const useConfigViewStore = create<ConfigViewState>((set) => ({
  previewTab: initialPreviewTab(),
  setPreviewTab: (previewTab) => {
    if (!isPlane(previewTab)) return;
    remember(PREVIEW_TAB_KEY, previewTab);
    set({ previewTab });
  },
  advancedOpen: initialAdvancedOpen(),
  setAdvancedOpen: (stage, open) =>
    set((s) => {
      if (!isStage(stage)) return s;
      // Closing a fold closes it whoever opened it.
      const advancedRevealed = open ? s.advancedRevealed : s.advancedRevealed.filter((x) => x !== stage);
      if (s.advancedOpen.includes(stage) === open) return advancedRevealed === s.advancedRevealed ? s : { advancedRevealed };
      const advancedOpen = open ? [...s.advancedOpen, stage] : s.advancedOpen.filter((x) => x !== stage);
      remember(ADVANCED_OPEN_KEY, JSON.stringify(advancedOpen));
      return { advancedOpen, advancedRevealed };
    }),
  advancedRevealed: [],
  revealAdvanced: (stages) =>
    set((s) => {
      const add = stages.filter((x) => isStage(x) && !s.advancedOpen.includes(x) && !s.advancedRevealed.includes(x));
      return add.length ? { advancedRevealed: [...s.advancedRevealed, ...add] } : s;
    }),
  views: { dataset: null, byPlane: {} },
  setView: (dataset, plane, v) =>
    set((s) => {
      const byPlane = { ...(s.views.dataset === dataset ? s.views.byPlane : {}) };
      if (v) byPlane[plane] = v;
      else delete byPlane[plane];
      return { views: { dataset, byPlane } };
    }),
  levels: null,
  setLevels: (levels) => set({ levels }),
  focusStage: null,
  setFocusStage: (focusStage) => set({ focusStage }),
}));
