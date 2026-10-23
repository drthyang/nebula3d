// An analysis session saved to a file and brought back: what resuming a run
// needs, and nothing a reload keeps anyway.
//
//  - the input it reads: the dataset's id and raw file;
//  - the parameters: the Configure form;
//  - what had completed: the stage outputs present when it was saved, and the
//    last run's record (its stages, the settings it ran with, its log);
//  - the analysis on top: the NEBULA Pilot conversation and the structure
//    drawn over the ΔPDF.
//
// The outputs themselves are not in the file (a volume is hundreds of MB):
// restoring lists the saved outputs that are not there now and recomputes
// exactly those stages from the input with the restored settings. The
// pipeline is deterministic, so they come back the same. The format is
// versioned; a file this build does not know is refused, never half-read.

import { create } from "zustand";

import type { Dataset, JobEvent } from "../api/types";
import { useChatStore } from "../llm/chatStore";
import { configOf } from "./configMemory";
import { useDatasetStore } from "./datasetStore";
import { enabledStages, STAGES, usePipelineStore, type PipelineConfig, type RunRecord } from "./pipelineStore";
import { useStructureStore } from "./structureStore";

export const SESSION_FORMAT = "nebula3d-session";
export const SESSION_VERSION = 1;

export interface SessionRun {
  record: RunRecord | null; // what the run was asked to do
  terminal: string | null; // how it ended: "done" | "error" | "cancelled", null while it ran
  events: JobEvent[];
  times: number[];
}

export interface Session {
  format: typeof SESSION_FORMAT;
  version: number;
  saved: string; // ISO time
  dataset: { id: string; rawName: string; stem: string; temperature: string | null } | null;
  outputs: string[]; // the dataset's stage outputs present when saved (raw, ringremoved, …)
  settings: Partial<PipelineConfig>;
  run: SessionRun | null;
  chat: unknown[]; // the conversation's turns, as the chat keeps them
  structure: Record<string, unknown> | null;
}

// The pipeline stage that writes each output.
export const OUTPUT_STAGE: Record<string, string> = {
  ringremoved: "rings",
  braggpunched: "punch",
  backfilled: "backfill",
  flattened: "flatten",
  delta_pdf: "pdf",
};

/** The session as it stands, for the dataset selected now. */
export function captureSession(dataset: Dataset | undefined, now = new Date()): Session {
  const p = usePipelineStore.getState();
  const st = useStructureStore.getState();
  return {
    format: SESSION_FORMAT,
    version: SESSION_VERSION,
    saved: now.toISOString(),
    dataset: dataset
      ? { id: dataset.id, rawName: dataset.raw_name, stem: dataset.stem, temperature: dataset.temperature }
      : null,
    outputs: (dataset?.stages ?? []).filter((s) => s.exists).map((s) => s.name),
    settings: configOf(p),
    // A run still going is saved as far as it got.
    run: p.events.length || p.terminal ? { record: p.lastRun, terminal: p.terminal, events: p.events, times: p.times } : null,
    chat: useChatStore.getState().turns,
    structure: st.def ? { def: st.def, show: st.show, perm: st.perm, origin: st.origin, hidden: st.hidden, depth: st.depth } : null,
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A session file's text read and checked; throws saying what is wrong. */
export function parseSession(text: string): Session {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error("this file is not a saved session (it is not JSON)");
  }
  if (!isObject(v) || v.format !== SESSION_FORMAT) throw new Error("this file is not a saved NEBULA3D session");
  if (typeof v.version !== "number" || v.version > SESSION_VERSION) {
    throw new Error(`this session was saved by a newer NEBULA3D (format version ${String(v.version)}); this one reads version ${SESSION_VERSION}`);
  }
  const dataset = isObject(v.dataset) && typeof v.dataset.id === "string" ? v.dataset : null;
  const run = isObject(v.run) && Array.isArray(v.run.events) ? v.run : null;
  return {
    format: SESSION_FORMAT,
    version: v.version,
    saved: typeof v.saved === "string" ? v.saved : "",
    dataset: dataset
      ? {
          id: dataset.id as string,
          rawName: typeof dataset.rawName === "string" ? dataset.rawName : "",
          stem: typeof dataset.stem === "string" ? dataset.stem : (dataset.id as string),
          temperature: typeof dataset.temperature === "string" ? dataset.temperature : null,
        }
      : null,
    outputs: Array.isArray(v.outputs) ? v.outputs.filter((o): o is string => typeof o === "string") : [],
    settings: isObject(v.settings) ? (v.settings as Partial<PipelineConfig>) : {},
    run: run
      ? {
          record: isObject(run.record) ? (run.record as unknown as RunRecord) : null,
          terminal: typeof run.terminal === "string" ? run.terminal : null,
          events: (run.events as unknown[]).filter(isObject) as unknown as JobEvent[],
          times: Array.isArray(run.times) ? run.times.filter((t): t is number => typeof t === "number") : [],
        }
      : null,
    chat: Array.isArray(v.chat) ? v.chat : [],
    structure: isObject(v.structure) && isObject(v.structure.def) ? v.structure : null,
  };
}

/**
 * The stages to run so that every output the session had exists again: from
 * the first one missing through the last one it had (a stage reads the one
 * before it), those the settings switch on, the consistency check with the ΔPDF.
 */
export function stagesToRecompute(saved: readonly string[], present: readonly string[], settings: PipelineConfig): string[] {
  const order = STAGES.filter((s) => s !== "pdf_check");
  const had = order.map((stage) => saved.some((o) => OUTPUT_STAGE[o] === stage));
  const missing = order.map((stage, i) => had[i] && !present.some((o) => OUTPUT_STAGE[o] === stage));
  const first = missing.indexOf(true);
  if (first < 0) return [];
  const last = had.lastIndexOf(true);
  const range = new Set<string>(order.slice(first, last + 1));
  if (range.has("pdf")) range.add("pdf_check");
  return enabledStages(settings).filter((s) => range.has(s));
}

export interface RestoreResult {
  datasetFound: boolean;
  missing: string[]; // saved outputs not present now
  recompute: string[]; // the stages that bring them back (empty when nothing is missing or no dataset)
  restored: string[]; // what was brought back, in words
}

/**
 * Bring a session back into the console. The dataset is selected first (when
 * it is here), so the session's settings, applied after, are the ones it
 * keeps. A run in progress is never overwritten.
 */
export function restoreSession(session: Session, datasets: readonly Dataset[]): RestoreResult {
  const restored: string[] = [];
  const dataset = session.dataset ? datasets.find((d) => d.id === session.dataset!.id) : undefined;
  // Its dataset is not here (not loaded, or another data folder): nothing is
  // applied, or its settings would land on another dataset.
  if (session.dataset && !dataset) return { datasetFound: false, missing: [], recompute: [], restored };
  if (dataset) useDatasetStore.getState().setDataset(dataset.id);

  const pipeline = usePipelineStore.getState();
  // Only the settings the form still has (configMemory does the same).
  const known = configOf(usePipelineStore.getInitialState());
  const settings = Object.fromEntries(Object.entries(session.settings).filter(([k]) => k in known)) as Partial<PipelineConfig>;
  pipeline.patch(settings);
  restored.push("the settings");

  if (session.run && !pipeline.running) {
    // Saved while it ran: it never finished here, and its page says so.
    const unfinished = session.run.terminal === null && session.run.events.length > 0;
    usePipelineStore.setState({
      events: unfinished
        ? [...session.run.events, { type: "progress", status: "error", message: "The session was saved while this run was going, so it did not finish here." }]
        : session.run.events,
      times: unfinished ? [...session.run.times, session.run.times[session.run.times.length - 1] ?? Date.now()] : session.run.times,
      terminal: unfinished ? "error" : session.run.terminal,
      lastRun: session.run.record,
      jobId: null,
    });
    restored.push("the last run's log");
  }

  useChatStore.getState().restoreTurns(session.chat);
  const n = useChatStore.getState().turns.length;
  restored.push(n ? `the NEBULA Pilot conversation (${n} message${n === 1 ? "" : "s"})` : "an empty NEBULA Pilot conversation");

  if (session.structure) {
    useStructureStore.setState(session.structure as Partial<ReturnType<typeof useStructureStore.getState>>);
    restored.push("the structure overlay");
  }

  const present = (dataset?.stages ?? []).filter((s) => s.exists).map((s) => s.name);
  const missing = dataset ? session.outputs.filter((o) => o !== "raw" && !present.includes(o)) : [];
  return {
    datasetFound: Boolean(dataset) || !session.dataset,
    missing,
    recompute: dataset ? stagesToRecompute(session.outputs, present, usePipelineStore.getState()) : [],
    restored,
  };
}

/** The session file's name: the dataset and the day. */
export function sessionFileName(session: Session): string {
  const stem = (session.dataset?.stem ?? "session").replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60) || "session";
  return `${stem}-${session.saved.slice(0, 10)}.nebula-session.json`;
}

/**
 * What the last save or restore said, and the recompute it offers: kept here,
 * not in the Configure page, so it is still there after a look at another
 * page.
 */
export interface SessionNote {
  kind: "ok" | "warn" | "error";
  text: string;
  recompute?: { datasetId: string; stages: string[] };
}

export const useSessionNote = create<{ note: SessionNote | null; setNote: (note: SessionNote | null) => void }>((set) => ({
  note: null,
  setNote: (note) => set({ note }),
}));
