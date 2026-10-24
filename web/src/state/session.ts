// An analysis session saved to a file and brought back: what resuming a run
// needs, and nothing a reload keeps anyway.
//
//  - the input it reads: the dataset's id and raw file (its size and date,
//    to tell it is still the same file);
//  - the parameters: the Configure form;
//  - what had completed: the stage outputs present when it was saved (with
//    when each was written), and the last run's record (its stages, the
//    settings it ran with, its log);
//  - the analysis on top: the NEBULA Pilot conversation and the structure
//    drawn over the ΔPDF;
//  - the NEBULA3D version that saved it.
//
// The outputs themselves are not in the file (a volume is hundreds of MB):
// restoring lists the saved outputs that are not there now (or were rewritten
// since) and recomputes those stages from the input with the settings of the
// run that made them, when the saved run did; otherwise with the restored
// form, and says so. The pipeline is deterministic, so with the same input,
// settings and version they come back the same. The format is versioned; a
// file this build does not know is refused, never half-read, and every value
// read from a file is checked for its type before it is used.

import { create } from "zustand";

import { version as APP_VERSION } from "../../package.json";
import type { Dataset, JobEvent, StageParamsIn } from "../api/types";
import { useChatStore } from "../llm/chatStore";
import { CENTERINGS } from "../structure/symops";
import { PERMUTATIONS } from "../structure/pairs";
import { configOf } from "./configMemory";
import { useDatasetStore } from "./datasetStore";
import { enabledStages, formToParams, pipelineBusy, STAGE_LABELS, STAGES, usePipelineStore, type PipelineConfig, type RunRecord } from "./pipelineStore";
import { useStructureStore, type StructureDef } from "./structureStore";

export const SESSION_FORMAT = "nebula3d-session";
// 2: the raw file's size and date, the outputs' dates, the app version.
// Version 1 files still load (their input cannot be verified).
export const SESSION_VERSION = 2;
export { APP_VERSION };

export interface SessionRun {
  record: RunRecord | null; // what the run was asked to do
  terminal: string | null; // how it ended: "done" | "error" | "cancelled", "lost" (end unknown), null while it ran
  events: JobEvent[];
  times: number[];
}

export interface RawFile {
  size: number;
  mtime: number | null; // null where the server does not know the file's own
}

export interface SessionStructure {
  def: StructureDef;
  show: boolean;
  perm: number;
  origin: string | null;
  hidden: string[];
  depth: number | null;
}

export interface Session {
  format: typeof SESSION_FORMAT;
  version: number;
  saved: string; // ISO time
  app?: string; // the NEBULA3D version that saved it; absent before version 2
  // rawFile: null = not on disk when saved; absent = not recorded (version 1).
  dataset: { id: string; rawName: string; stem: string; temperature: string | null; rawFile?: RawFile | null } | null;
  outputs: string[]; // the dataset's stage outputs present when saved (raw, ringremoved, …)
  outputTimes?: Record<string, number>; // when each was written (POSIX s); absent before version 2
  settings: Partial<PipelineConfig>;
  run: SessionRun | null;
  chat: unknown[]; // the conversation's turns, as the chat keeps them
  structure: SessionStructure | null;
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
  const present = (dataset?.stages ?? []).filter((s) => s.exists);
  const outputTimes: Record<string, number> = {};
  for (const s of present) if (typeof s.mtime === "number") outputTimes[s.name] = s.mtime;
  return {
    format: SESSION_FORMAT,
    version: SESSION_VERSION,
    saved: now.toISOString(),
    app: APP_VERSION,
    dataset: dataset
      ? {
          id: dataset.id,
          rawName: dataset.raw_name,
          stem: dataset.stem,
          temperature: dataset.temperature,
          rawFile: dataset.raw_file ? { size: dataset.raw_file.size, mtime: dataset.raw_file.mtime } : null,
        }
      : null,
    outputs: present.map((s) => s.name),
    outputTimes,
    settings: configOf(p),
    // A run still going is saved as far as it got.
    run: p.events.length || p.terminal ? { record: p.lastRun, terminal: p.terminal, events: p.events, times: p.times } : null,
    chat: useChatStore.getState().turns,
    structure: st.def ? { def: st.def, show: st.show, perm: st.perm, origin: st.origin, hidden: st.hidden, depth: st.depth } : null,
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isStr) : []);

function readRawFile(v: unknown): RawFile | null {
  return isObject(v) && isNum(v.size) ? { size: v.size, mtime: isNum(v.mtime) ? v.mtime : null } : null;
}

// A run's record, kept only when every part has its type: its params go to
// the pipeline on a recompute.
function readRecord(v: unknown): RunRecord | null {
  if (!isObject(v) || !isStr(v.datasetId) || !Array.isArray(v.stages) || !v.stages.every(isStr)) return null;
  if (typeof v.force !== "boolean" || typeof v.flattenEnabled !== "boolean" || !isObject(v.params)) return null;
  const params: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v.params)) {
    if (isNum(x) || isStr(x) || typeof x === "boolean" || (Array.isArray(x) && x.every(isNum))) params[k] = x;
    else return null;
  }
  return {
    datasetId: v.datasetId,
    stages: v.stages as string[],
    force: v.force,
    flattenEnabled: v.flattenEnabled,
    params: params as StageParamsIn,
    ...(v.tuning !== undefined ? { tuning: v.tuning as RunRecord["tuning"] } : {}),
  };
}

function readEvent(v: unknown): JobEvent | null {
  if (!isObject(v) || !isStr(v.type)) return null;
  const ev: JobEvent = { type: v.type };
  if (isStr(v.stage)) ev.stage = v.stage;
  if (isStr(v.status)) ev.status = v.status;
  if (isNum(v.fraction) || v.fraction === null) ev.fraction = v.fraction;
  if (isStr(v.message)) ev.message = v.message;
  return ev;
}

// The structure, rebuilt from the keys it has (never merged as it is in the
// file, which could carry anything over the store's own), or null when its
// structure is not of the shape the overlay draws.
function readStructure(v: unknown): SessionStructure | null {
  if (!isObject(v) || !isObject(v.def)) return null;
  const d = v.def;
  const cell = d.cell === null || d.cell === undefined
    ? null
    : isObject(d.cell) && ["a", "b", "c", "alpha", "beta", "gamma"].every((k) => isNum((d.cell as Record<string, unknown>)[k]))
      ? (d.cell as unknown as StructureDef["cell"])
      : undefined;
  const site = (x: unknown) => isObject(x) && isStr(x.label) && isStr(x.element) && ["x", "y", "z", "occ"].every((k) => isNum(x[k]));
  if (!isStr(d.name) || cell === undefined || !Array.isArray(d.sites) || !d.sites.every(site) || !isStr(d.ops)) return null;
  if (!isStr(d.centering) || !(CENTERINGS as readonly string[]).includes(d.centering)) return null;
  const def: StructureDef = {
    name: d.name,
    cell,
    sites: (d.sites as Record<string, unknown>[]).map((x) => ({ label: x.label, element: x.element, x: x.x, y: x.y, z: x.z, occ: x.occ }) as StructureDef["sites"][number]),
    ops: d.ops,
    centering: d.centering as StructureDef["centering"],
    notes: strings(d.notes),
  };
  return {
    def,
    show: typeof v.show === "boolean" ? v.show : true,
    perm: Number.isInteger(v.perm) && (v.perm as number) >= 0 && (v.perm as number) < PERMUTATIONS.length ? (v.perm as number) : 0,
    origin: isStr(v.origin) ? v.origin : null,
    hidden: strings(v.hidden),
    depth: isNum(v.depth) && v.depth > 0 ? v.depth : null,
  };
}

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
  const dataset = isObject(v.dataset) && isStr(v.dataset.id) ? v.dataset : null;
  const run = isObject(v.run) && Array.isArray(v.run.events) ? v.run : null;
  let outputTimes: Record<string, number> | undefined;
  if (isObject(v.outputTimes)) {
    outputTimes = {};
    for (const [k, t] of Object.entries(v.outputTimes)) if (isNum(t)) outputTimes[k] = t;
  }
  return {
    format: SESSION_FORMAT,
    version: v.version,
    saved: isStr(v.saved) ? v.saved : "",
    ...(isStr(v.app) ? { app: v.app } : {}),
    dataset: dataset
      ? {
          id: dataset.id as string,
          rawName: isStr(dataset.rawName) ? dataset.rawName : "",
          stem: isStr(dataset.stem) ? dataset.stem : (dataset.id as string),
          temperature: isStr(dataset.temperature) ? dataset.temperature : null,
          ...(own(dataset, "rawFile") ? { rawFile: readRawFile(dataset.rawFile) } : {}),
        }
      : null,
    outputs: strings(v.outputs),
    ...(outputTimes ? { outputTimes } : {}),
    // Checked against the form's own keys and types where they are applied
    // (restoreSession).
    settings: isObject(v.settings) ? (v.settings as Partial<PipelineConfig>) : {},
    run: run
      ? {
          record: readRecord(run.record),
          terminal: isStr(run.terminal) ? run.terminal : null,
          events: (run.events as unknown[]).map(readEvent).filter((e): e is JobEvent => e !== null),
          times: Array.isArray(run.times) ? run.times.filter(isNum) : [],
        }
      : null,
    chat: Array.isArray(v.chat) ? v.chat : [],
    structure: readStructure(v.structure),
  };
}

/** The settings of a file the form has, each of the type the form keeps it in. */
export function knownSettings(settings: Record<string, unknown>): Partial<PipelineConfig> {
  const known = configOf(usePipelineStore.getInitialState()) as unknown as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(settings).filter(([k, v]) => own(known, k) && typeof v === typeof known[k] && (typeof v !== "number" || Number.isFinite(v))),
  ) as Partial<PipelineConfig>;
}

// The stages (in order, without the consistency check) from the first saved
// output not here now through the last one saved: a stage reads the one
// before it, so those after a missing one are recomputed with it.
function recomputeRange(saved: readonly string[], present: readonly string[]): string[] {
  const order = STAGES.filter((s) => s !== "pdf_check");
  const had = order.map((stage) => saved.some((o) => OUTPUT_STAGE[o] === stage));
  const missing = order.map((stage, i) => had[i] && !present.some((o) => OUTPUT_STAGE[o] === stage));
  const first = missing.indexOf(true);
  return first < 0 ? [] : order.slice(first, had.lastIndexOf(true) + 1);
}

/**
 * The stages to run so that every output the session had exists again: from
 * the first one missing through the last one it had (a stage reads the one
 * before it), those the settings switch on, the consistency check with the ΔPDF.
 */
export function stagesToRecompute(saved: readonly string[], present: readonly string[], settings: PipelineConfig): string[] {
  const range = new Set<string>(recomputeRange(saved, present));
  if (range.has("pdf")) range.add("pdf_check");
  return enabledStages(settings).filter((s) => range.has(s));
}

/** The stages a saved run computed on `datasetId` (its log says each finished), not skipped or a tuning trial's. */
function producedBy(run: SessionRun | null, datasetId: string): Set<string> {
  const r = run?.record;
  if (!run || !r || r.datasetId !== datasetId || r.tuning) return new Set();
  return new Set(run.events.flatMap((e) => (e.status === "done" && e.stage && r.stages.includes(e.stage) ? [e.stage] : [])));
}

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) => (isObject(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

/** Whether the form would run with the settings `record` ran with. */
export function formMatchesRun(form: PipelineConfig, record: RunRecord): boolean {
  return form.flatten === record.flattenEnabled && stable(formToParams(form)) === stable(record.params);
}

export interface RestoreResult {
  datasetFound: boolean;
  missing: string[]; // saved outputs not present now
  changed: string[]; // saved outputs present now but rewritten after the save
  recompute: string[]; // the stages that bring them back (empty when nothing is missing, no dataset, or the input changed)
  // The settings Recompute runs with: the last run's, which made the outputs;
  // null = the form's (the run did not make them all; a warning says so).
  recomputeWith: { params: StageParamsIn; flattenEnabled: boolean } | null;
  inputChanged: boolean; // the raw file is not the session's: nothing is recomputed
  unverified: boolean; // an earlier version's file: the input and outputs cannot be checked
  warnings: string[];
  restored: string[]; // what was brought back, in words
}

const outputLabel = (o: string): string => (OUTPUT_STAGE[o] ? STAGE_LABELS[OUTPUT_STAGE[o]] : o);
const dated = (t: number): string => new Date(t * 1000).toLocaleString();

// Whether the raw file here is the one the session was saved with.
function checkInput(session: Session, dataset: Dataset, warnings: string[]): { changed: boolean; unverified: boolean } {
  const name = session.dataset?.rawName || dataset.raw_name;
  const saved = session.dataset?.rawFile;
  if (saved === undefined) return { changed: false, unverified: true };
  const now = dataset.raw_file;
  if (saved && now) {
    if (now.size !== saved.size) {
      warnings.push(`${name} is not the file this session was saved with (${now.size} bytes; the session's had ${saved.size}). Outputs computed from it would not be the session's, so none is recomputed: load the session's input, or run the pipeline on this file yourself.`);
      return { changed: true, unverified: false };
    }
    if (now.mtime !== null && saved.mtime !== null && now.mtime !== saved.mtime) {
      warnings.push(`${name} was modified after the session was saved (the same size, but dated ${dated(now.mtime)}, not ${dated(saved.mtime)}): a copy re-dates a file, but if it was reduced again, recomputed outputs will not match the saved ones.`);
    }
  } else if (saved || now) {
    warnings.push(
      saved
        ? `Cannot verify the input: ${name} is not on disk here${now === undefined ? " (or this server does not report it)" : ""}.`
        : `Cannot verify the input: ${name} was not on disk when the session was saved.`,
    );
  }
  return { changed: false, unverified: false };
}

/**
 * Bring a session back into the console. The dataset is selected first (when
 * it is here), so the session's settings, applied after, are the ones it
 * keeps. A run in progress is never overwritten. `label` names an output in
 * the warnings.
 */
export function restoreSession(session: Session, datasets: readonly Dataset[], label: (output: string) => string = outputLabel): RestoreResult {
  const listOf = (outputs: readonly string[]): string => outputs.map(label).join(", ");
  const restored: string[] = [];
  const warnings: string[] = [];
  const none = { missing: [], changed: [], recompute: [], recomputeWith: null, inputChanged: false, unverified: false };
  const dataset = session.dataset ? datasets.find((d) => d.id === session.dataset!.id) : undefined;
  // Its dataset is not here (not loaded, or another data folder): nothing is
  // applied, or its settings would land on another dataset.
  if (session.dataset && !dataset) return { datasetFound: false, ...none, warnings, restored };
  if (dataset) useDatasetStore.getState().setDataset(dataset.id);

  const pipeline = usePipelineStore.getState();
  if (dataset) {
    // Only the settings the form still has, of the type it keeps them in.
    pipeline.patch(knownSettings(session.settings as Record<string, unknown>));
    restored.push("the settings");
  } else {
    // Saved with no dataset: it has no input, and its settings would land on
    // whichever dataset is selected now.
    warnings.push("This session was saved with no dataset selected, so its settings and run were not applied to the dataset selected now.");
  }

  if (dataset && session.run && !pipelineBusy(pipeline)) {
    // Saved while it ran (or while its connection was lost): it never
    // finished here, and its page says so.
    const unfinished = (session.run.terminal === null || session.run.terminal === "lost") && session.run.events.length > 0;
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
    useStructureStore.setState(session.structure);
    restored.push("the structure overlay");
  }

  if (!dataset) return { datasetFound: true, ...none, warnings, restored };

  const input = checkInput(session, dataset, warnings);
  const unverified = input.unverified || session.outputTimes === undefined;
  if (unverified) {
    warnings.push(`This session file was written by an earlier NEBULA3D that did not record the input file's size and date, the outputs' dates or its version, so it cannot verify that ${session.dataset?.rawName || dataset.raw_name} and the outputs here are the ones it was saved with.`);
  } else if (session.app && session.app !== APP_VERSION) {
    warnings.push(`It was saved by NEBULA3D ${session.app}; this is ${APP_VERSION}. If the pipeline changed between them, recomputed outputs may differ from the saved ones.`);
  }

  const status = new Map(dataset.stages.filter((s) => s.exists).map((s) => [s.name, s]));
  const saved = session.outputs.filter((o) => o !== "raw");
  const missing = saved.filter((o) => !status.has(o));
  const times = session.outputTimes ?? {};
  const changed = saved.filter((o) => {
    const now = status.get(o)?.mtime;
    return status.has(o) && typeof times[o] === "number" && typeof now === "number" && now !== times[o];
  });
  if (changed.length) {
    warnings.push(`${changed.length} of its outputs ${changed.length === 1 ? "was" : "were"} written again after the session was saved, so ${changed.length === 1 ? "it is" : "they are"} not the session's: ${listOf(changed)}.`);
  }
  // The outputs that are the session's still.
  const present = [...status.keys()].filter((o) => !changed.includes(o));
  const gone = [...missing, ...changed];
  if (!gone.length || input.changed) {
    return { datasetFound: true, missing, changed, recompute: [], recomputeWith: null, inputChanged: input.changed, unverified, warnings, restored };
  }

  // With the settings of the run that made them, when the saved run made
  // every output it would recompute (its log says so); else with the form.
  const range = recomputeRange(session.outputs, present);
  const record = session.run?.record ?? null;
  const produced = producedBy(session.run, dataset.id);
  const fromRun = record
    ? record.stages.filter((s) => range.includes(s) || (s === "pdf_check" && range.includes("pdf")))
    : [];
  const covers =
    record !== null &&
    fromRun.filter((s) => s !== "pdf_check").every((s) => produced.has(s)) &&
    gone.every((o) => produced.has(OUTPUT_STAGE[o]) && fromRun.includes(OUTPUT_STAGE[o]));
  const form = usePipelineStore.getState();
  if (covers) {
    if (!formMatchesRun(form, record)) {
      warnings.push("Recompute uses the settings of the last run, which made these outputs, not the Configure form: the form was changed after that run (it is restored as it was saved).");
    }
    return { datasetFound: true, missing, changed, recompute: fromRun, recomputeWith: { params: record.params, flattenEnabled: record.flattenEnabled }, inputChanged: false, unverified, warnings, restored };
  }
  const recompute = stagesToRecompute(session.outputs, present, form);
  const lost = gone.filter((o) => !recompute.includes(OUTPUT_STAGE[o]));
  if (lost.length) {
    warnings.push(`Recompute cannot bring back ${listOf(lost)}: the restored settings switch ${lost.length === 1 ? "its stage" : "their stages"} off.`);
  }
  if (recompute.length) {
    const differs = record && record.datasetId === dataset.id && !formMatchesRun(form, record);
    warnings.push(`The session's last run did not make all of these outputs, so the settings that made them are not known: Recompute uses the restored Configure form${differs ? ", which differs from the last run's settings" : ""}, and what it computes may differ from the saved outputs.`);
  }
  return { datasetFound: true, missing, changed, recompute, recomputeWith: null, inputChanged: false, unverified, warnings, restored };
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
  // The Recompute offer: its stages, and the settings to run them with (the
  // last run's; absent = the form's).
  recompute?: { datasetId: string; stages: string[]; params?: StageParamsIn; flattenEnabled?: boolean };
}

export const useSessionNote = create<{ note: SessionNote | null; setNote: (note: SessionNote | null) => void }>((set) => ({
  note: null,
  setNote: (note) => set({ note }),
}));
