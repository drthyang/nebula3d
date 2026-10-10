// Which cards the assistant is on: while a tool step runs, the cards for what
// that step works on (its stage, the fitted peaks, the run log, …); while it
// writes, the cards for what its answer mentions — kept a few seconds after
// the reply ends.  Pages read the keys and give those cards a breathing edge
// (.ai-glow), so the user can see where the agent is looking.

import { useEffect } from "react";
import { create } from "zustand";

import { useNavStore } from "../state/navStore";
import { usePipelineStore } from "../state/pipelineStore";
import type { AgentStep } from "./agent";
import { useChatStore } from "./chatStore";
import { TUNE_PARAMS } from "./tune/catalog";
import { useTuneStore } from "./tune/tuner";

export type HighlightKey =
  | "raw" // the measured volume and its coverage
  | "rings"
  | "punch"
  | "backfill"
  | "flatten"
  | "pdf" // the 3D-ΔPDF transform
  | "check" // the back-FFT consistency check
  | "bragg" // the fitted Bragg peaks
  | "log"; // the run log

const RECIP: HighlightKey[] = ["rings", "punch", "backfill", "flatten"];
const ALL_STAGES: HighlightKey[] = [...RECIP, "pdf"];

// Pipeline stage names and stage-output names, as highlight keys.
const STAGE_KEY: Record<string, HighlightKey> = {
  raw: "raw",
  rings: "rings",
  ringremoved: "rings",
  punch: "punch",
  braggpunched: "punch",
  backfill: "backfill",
  backfilled: "backfill",
  flatten: "flatten",
  flattened: "flatten",
  pdf: "pdf",
  delta_pdf: "pdf",
  pdf_check: "check",
};
export const stageKey = (name: string): HighlightKey | undefined => STAGE_KEY[name];

const keysOf = (names: unknown): HighlightKey[] =>
  Array.isArray(names) ? names.map((n) => stageKey(String(n))).filter((k): k is HighlightKey => Boolean(k)) : [];

/** What a tool step works on, from its name and arguments. */
export function stepKeys(step: Pick<AgentStep, "name" | "args">): HighlightKey[] {
  const a = step.args ?? {};
  switch (step.name) {
    case "assess_stage": {
      const s = typeof a.stage === "string" ? a.stage : "all";
      if (s === "all") return ALL_STAGES;
      const k = stageKey(s);
      return k === "pdf" ? ["pdf", "check"] : k ? [k] : [];
    }
    case "measure_reciprocal_cut":
      return RECIP;
    case "measure_dpdf_cut":
      return ["pdf"];
    case "line_profile":
      return keysOf([a.stage]);
    case "radial_profile":
      return a.stages === undefined ? ["raw", ...RECIP] : keysOf(a.stages);
    case "texture_check":
      return ["punch", "backfill"];
    case "qmax_coverage":
      return ["raw", "pdf"];
    case "bragg_peaks":
      return ["bragg"];
    case "consistency_details":
      return ["check"];
    case "run_log":
      return ["log"];
    case "update_settings": {
      const changes = a.changes && typeof a.changes === "object" ? Object.keys(a.changes) : [];
      return keysOf(changes.map((key) => TUNE_PARAMS.find((p) => p.key === key)?.stage));
    }
    case "run_pipeline":
      return a.from_stage === undefined ? ALL_STAGES : keysOf([a.from_stage]);
    case "tune_pipeline":
      return a.stages === undefined ? ALL_STAGES : keysOf(a.stages);
    default:
      return [];
  }
}

// Words in an answer that point at a card.
const MENTIONS: [HighlightKey, RegExp][] = [
  ["rings", /\brings?\b|\bring[_ -]/i],
  ["punch", /\bpunch|\bleftover peak/i],
  ["backfill", /\bbackfill|\bseams?\b|\bfill bias/i],
  ["flatten", /\bflatten|\bshell floors?\b|\bpedestal/i],
  ["pdf", /ΔPDF|\bdelta[- ]?pdf|\bQ_?max\b|\bapodi[sz]ation/i],
  ["check", /\bback-?FFT|\bconsistency check|\bPearson\b/i],
  ["bragg", /\bBragg peaks?\b|\bfitted peaks?\b/i],
  ["raw", /\bcoverage\b|\braw (data|volume|slice)/i],
  ["log", /\brun log\b|\bevent log\b/i],
];

/** The cards an answer talks about. */
export const mentionKeys = (text: string): HighlightKey[] =>
  text ? MENTIONS.filter(([, re]) => re.test(text)).map(([k]) => k) : [];

// The stage a pipeline run or tuning run is busy with right now, if any.
function runningStage(): HighlightKey[] {
  const pipe = usePipelineStore.getState();
  if (pipe.running) {
    const ev = [...pipe.events].reverse().find((e) => e.stage && (e.status === "start" || e.status === "progress"));
    const k = ev?.stage ? stageKey(ev.stage) : undefined;
    if (k) return [k];
  }
  const tuning = useTuneStore.getState();
  if (tuning.active) {
    const r = tuning.stages.find((s) => !["waiting", "done", "skipped", "failed"].includes(s.status));
    const k = r ? stageKey(r.stage) : undefined;
    if (k) return [k];
  }
  return [];
}

/**
 * The keys to light: the running step's (narrowed to the stage a run or a
 * tuning run is on), then what the reply being written mentions.  After a
 * reply, what it mentioned, until `lingerUntil`.
 */
export function agentKeys(now = Date.now(), lingerUntil = 0): HighlightKey[] {
  const chat = useChatStore.getState();
  const keys = new Set<HighlightKey>();
  if (chat.busy && chat.live) {
    const step = chat.live.steps.find((s) => s.status === "running");
    if (step) {
      const live = step.name === "run_pipeline" || step.name === "tune_pipeline" ? runningStage() : [];
      for (const k of live.length ? live : stepKeys(step)) keys.add(k);
    }
    for (const k of mentionKeys(chat.live.content)) keys.add(k);
  } else if (now < lingerUntil) {
    const last = [...chat.turns].reverse().find((t) => t.role === "assistant");
    for (const k of mentionKeys(last?.content ?? "")) keys.add(k);
  }
  return [...keys];
}

export const LINGER_MS = 8000;

interface HighlightState {
  keys: HighlightKey[];
}

export const useHighlightStore = create<HighlightState>(() => ({ keys: [] }));

/** The keys lit right now; empty while the assistant panel is closed. */
export const useHighlightKeys = (): HighlightKey[] => useHighlightStore((s) => s.keys);

/** Whether the stage (or stage output) `name` is among the lit keys. */
export const litStage = (keys: HighlightKey[], name: string): boolean => {
  const k = stageKey(name);
  return k ? keys.includes(k) : false;
};

/** Whether any of `keys` is lit: a card's breathing edge. */
export const useGlow = (...keys: HighlightKey[]): boolean =>
  useHighlightStore((s) => keys.some((k) => s.keys.includes(k)));

const same = (a: HighlightKey[], b: HighlightKey[]) => a.length === b.length && a.every((k, i) => k === b[i]);

/** Keeps the highlight keys in step with the assistant; mount once. */
export function useAgentHighlights(): void {
  useEffect(() => {
    let lingerUntil = 0;
    let wasBusy = useChatStore.getState().busy;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const busy = useChatStore.getState().busy;
      if (wasBusy && !busy) {
        lingerUntil = Date.now() + LINGER_MS;
        clearTimeout(timer);
        timer = setTimeout(update, LINGER_MS + 50);
      }
      wasBusy = busy;
      const keys = useNavStore.getState().dockOpen ? agentKeys(Date.now(), lingerUntil) : [];
      if (!same(keys, useHighlightStore.getState().keys)) useHighlightStore.setState({ keys });
    };
    const unsubs = [
      useChatStore.subscribe(update),
      usePipelineStore.subscribe(update),
      useTuneStore.subscribe(update),
      useNavStore.subscribe(update),
    ];
    update();
    return () => {
      unsubs.forEach((u) => u());
      clearTimeout(timer);
    };
  }, []);
}
