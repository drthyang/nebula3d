// The Highlights' state (THY-66): the step being examined, the overlay sets
// the finished steps made (the newest shown), the legend's classes turned off,
// and the Highlights switch. A set stays until a run rewrites an output it
// measured, the dataset changes, the user clears it, or the volume closes
// (state/volumeReset.ts); the next step that draws replaces it on the views.
// useExamine keeps it in step with the chat; mount once (App).

import { useEffect } from "react";
import { create } from "zustand";

import type { Dataset } from "../../api/types";
import { resetsWithVolume } from "../../state/volumeReset";
import type { AgentStep } from "../agent";
import { useAutoStore } from "../auto/store";
import { useChatStore } from "../chatStore";
import { examining, overlaysOf, stepKey, type ClassId, type OverlaySet, type Tone } from "./overlays";

const SWITCH_KEY = "nebula3d.highlights.v1";
// The sets kept for the steps' Show buttons, newest last.
export const KEEP_SETS = 16;

/** A set as the views draw it: what it measured, at which version of each output. */
export interface ShownSet {
  set: OverlaySet;
  dataset: string;
  versions: Record<string, string>;
  turn: number | null; // the assistant turn its step is in; null while the reply runs
  n: number; // the step's number in its reply (1-based), as the bar says it
}

export interface Examining {
  title: string;
  views: OverlaySet["views"];
  stepId: string;
  n: number;
}

interface ExamineState {
  enabled: boolean; // the Highlights switch: off hides the overlays, keeps the bar
  running: Examining | null; // the step running now
  sets: ShownSet[];
  current: string | null; // the shown set's key
  off: ClassId[]; // the legend's classes turned off
  setEnabled: (on: boolean) => void;
  toggle: (cls: ClassId) => void;
  clear: () => void;
}

const readSwitch = (): boolean => {
  try {
    return localStorage.getItem(SWITCH_KEY) !== "0";
  } catch {
    return true;
  }
};

export const useExamineStore = create<ExamineState>((set) => ({
  enabled: readSwitch(),
  running: null,
  sets: [],
  current: null,
  off: [],
  setEnabled: (enabled) => {
    try {
      localStorage.setItem(SWITCH_KEY, enabled ? "1" : "0");
    } catch {
      // Private mode: the switch holds for this page only.
    }
    set({ enabled });
  },
  toggle: (cls) => set((s) => ({ off: s.off.includes(cls) ? s.off.filter((c) => c !== cls) : [...s.off, cls] })),
  clear: () => set({ current: null, off: [] }),
}));

// Closing the volume clears every overlay; the switch is the user's, kept.
resetsWithVolume(useExamineStore, { keep: ["enabled"] });

/** The set shown now, if any. */
export const useShownSet = (): ShownSet | null =>
  useExamineStore((s) => (s.current ? (s.sets.find((x) => x.set.key === s.current) ?? null) : null));

/**
 * What a page with overlays reads of the Highlights: the set shown while it
 * stands for the outputs as listed, the switch, the classes turned off, the
 * views the running (else the shown) check reads, and each class's tone and code.
 */
export function usePageHighlights(dataset: Dataset | undefined) {
  const shownSet = useShownSet();
  const enabled = useExamineStore((s) => s.enabled);
  const off = useExamineStore((s) => s.off);
  const running = useExamineStore((s) => s.running?.views);
  const shown = shownSet && stands(shownSet, dataset) ? shownSet : null;
  const classes = shown?.set.classes ?? [];
  return {
    shown,
    enabled,
    off,
    outlined: running ?? shown?.set.views ?? {},
    tones: Object.fromEntries(classes.map((c) => [c.id, c.tone])) as Partial<Record<ClassId, Tone>>,
    codes: Object.fromEntries(classes.flatMap((c) => (c.code ? [[c.id, c.code]] : []))) as Partial<Record<ClassId, string>>,
  };
}

/** Each output's version in the listing (its volume and when it was written): a run that rewrites it changes it. */
export const outputVersion = (dataset: Dataset | undefined, stage: string): string => {
  const st = dataset?.stages.find((s) => s.name === stage);
  return st?.exists ? `${st.volume_id}@${st.mtime ?? ""}` : "";
};

/** Whether a set still stands for the dataset as listed now. */
export const stands = (x: ShownSet, dataset: Dataset | undefined): boolean =>
  !!dataset && x.dataset === dataset.id && Object.entries(x.versions).every(([stage, v]) => outputVersion(dataset, stage) === v);

/** Add a finished step's set and show it (it replaces the one shown). */
export function addSet(set: OverlaySet, dataset: Dataset | undefined, n: number, turn: number | null = null): void {
  if (!dataset) return;
  const versions = Object.fromEntries(set.measured.map((st) => [st, outputVersion(dataset, st)]));
  const entry: ShownSet = { set, dataset: dataset.id, versions, turn, n };
  useExamineStore.setState((s) => ({
    sets: [...s.sets.filter((x) => x.set.key !== set.key), entry].slice(-KEEP_SETS),
    current: set.key,
    off: [],
  }));
}

/**
 * A step's Show button: its set again, drawn from what the step found. A
 * finished reply's step keeps the set it made; an older one's is drawn again
 * from its result (without the data its result leaves out). A step brought
 * back from a session file draws nothing: the file could say anything.
 */
export function showStep(step: AgentStep, turn: number | null, n: number, dataset: Dataset | undefined): boolean {
  if (step.restored) return false;
  const key = stepKey(step);
  const kept = useExamineStore.getState().sets.find((x) => x.set.key === key && x.dataset === dataset?.id);
  if (kept && stands(kept, dataset)) {
    useExamineStore.setState({ current: key, off: [] });
    return true;
  }
  const set = overlaysOf(step);
  if (!set) return false;
  addSet(set, dataset, n, turn);
  return true;
}

/** Whether a step has a set kept (its row's swatch). */
export const useHasSet = (step: Pick<AgentStep, "name" | "args" | "result">): boolean => {
  const key = stepKey(step);
  return useExamineStore((s) => s.sets.some((x) => x.set.key === key));
};

/**
 * Keeps the Highlights in step with the chat and with an auto run: the
 * running step named, each finished step's set added (and shown), the reply's
 * sets given their turn once it ends, and the sets a run made stale dropped.
 * An auto run's own checks (auto/store.ts, `live`) are followed as a reply's
 * are, so the views show the row it is on. Mount once.
 */
export function useExamine(dataset: Dataset | undefined): void {
  // The subscription reads the dataset as listed now.
  useEffect(() => {
    listed = dataset;
  }, [dataset]);
  // Drop what the listing no longer stands for: a run rewrote an output a set measured.
  useEffect(() => {
    const { sets, current } = useExamineStore.getState();
    const kept = sets.filter((x) => x.dataset !== dataset?.id || stands(x, dataset));
    if (kept.length !== sets.length) {
      useExamineStore.setState({ sets: kept, current: current && kept.some((x) => x.set.key === current) ? current : null });
    }
  }, [dataset]);

  useEffect(() => {
    const seen = new Set<string>(); // the live reply's steps already added
    let liveSteps: AgentStep[] = [];
    const update = () => {
      const chat = useChatStore.getState();
      const steps = chat.live?.steps ?? [];
      if (!chat.live) {
        // The reply ended: its sets belong to its turn.
        if (liveSteps.length) {
          const last = [...chat.turns].reverse().find((t) => t.role === "assistant");
          if (last) {
            const ids = new Set((last.steps ?? []).map((s) => s.id));
            useExamineStore.setState((s) => ({ sets: s.sets.map((x) => (x.turn === null && ids.has(x.set.stepId) ? { ...x, turn: last.id } : x)) }));
          }
          liveSteps = [];
          seen.clear();
        }
        // An auto run's own step under way is the auto run's to clear.
        const running = useExamineStore.getState().running;
        if (running && !running.stepId.startsWith("auto:")) useExamineStore.setState({ running: null });
        return;
      }
      if (steps === liveSteps) return;
      liveSteps = steps;
      const running = steps.findIndex((s) => s.status === "running");
      const what = running >= 0 ? examining(steps[running]) : null;
      const next: Examining | null = what ? { ...what, stepId: steps[running].id, n: running + 1 } : null;
      const now = useExamineStore.getState().running;
      if (next?.stepId !== now?.stepId || next?.title !== now?.title) useExamineStore.setState({ running: next });
      steps.forEach((s, i) => {
        if (s.status !== "done" || seen.has(s.id)) return;
        seen.add(s.id);
        const set = overlaysOf(s);
        if (set) addSet(set, listed, i + 1);
      });
    };
    update();
    return useChatStore.subscribe(update);
  }, []);

  // An auto run's own steps: the one under way named, each one done drawn.
  useEffect(
    () =>
      useAutoStore.subscribe((s, prev) => {
        const step = s.live;
        if (step === prev.live) return;
        const n = (s.run?.steps.findIndex((x) => x.id === step?.id) ?? -1) + 1 || (s.run?.steps.length ?? 0) + 1;
        if (!step || step.status !== "running") {
          const running = useExamineStore.getState().running;
          if (running?.stepId.startsWith("auto:")) useExamineStore.setState({ running: null });
        }
        if (!step) return;
        if (step.status === "running") {
          const what = examining(step);
          useExamineStore.setState({ running: what ? { ...what, stepId: step.id, n } : null });
          return;
        }
        if (step.status !== "done") return;
        const set = overlaysOf(step);
        // Measured against the dataset as the run left it: the listing may not have caught up with its run yet.
        if (set) addSet(set, s.work ?? listed, n, null);
      }),
    [],
  );
}

// The open dataset as the app lists it (useExamine keeps it).
let listed: Dataset | undefined;
