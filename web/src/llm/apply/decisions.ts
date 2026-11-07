// The Apply cards' record (docs/pilot-auto-mode-design.md §1.5): every
// proposal the replies led to (proposals.ts), and every decision on one,
// Apply, Edit and apply, Dismiss and Undo, with the values before and after.
// The cards, the Changes list and the report's Decisions section read it.
// Kept with the conversation: in sessionStorage over a reload, in session
// files (state/session.ts), cleared with it. The model reads none of it but
// the "since the last reply" line (since.ts): the decisions made since the
// model last replied, each listed in one reply's context, `told` marking those
// listed (kept with the record, so a reload or a session file does not list
// them again). A session file's copy is read back value by value (readDecisions).
// A click grant (llm/consent.ts) is never kept here: a decision records only
// that a click made it (byClick). The rings checked from a card (actions.ts,
// checkRings) are kept in memory alone, and go with a reload.

import { create } from "zustand";

import { resetsWithVolume } from "../../state/volumeReset";
import type { PipelineConfig, RunRecord } from "../../state/pipelineStore";
import type { RingOutputMark } from "../../state/ringOutput";
import type { AgentStep } from "../agent";
import { RUN_STAGES, TUNE_STAGES, type ParamValue, type RunStage } from "../tune/catalog";
import type { Held, Proposal, ProposalKind, ProposalStatus, ProposalVia } from "./proposals";

export type DecisionAction = "apply" | "edit-apply" | "dismiss" | "undo";

export interface Decision {
  id: string; // "D2"
  proposal: string; // the proposal's id
  kind: ProposalKind;
  title: string;
  shown: { from: string; to: string };
  action: DecisionAction;
  by: "you" | "auto";
  at: number; // ms
  before: Partial<PipelineConfig>;
  after: Partial<PipelineConfig>;
  runFrom?: RunStage;
  undoes?: string; // an undo: the decision it put back
  undoneBy?: string; // put back by this undo
  byClick?: true; // made by the user's own click, under a click grant (a sample fact, a setting only they set, Apply anyway)
}

/** The 3D ring verdict a card's "Check rings in 3D" found: its step, on the outputs of the run that stood then. */
export interface RingCheck {
  step: AgentStep;
  dataset: string;
  lastRun: RunRecord | null; // the run whose outputs it judged: another run since makes it stale
  ringOutput: RingOutputMark; // the ring output it judged: recomputed since, by any run, it is stale (state/ringOutput.ts)
}

interface DecisionState {
  proposals: Proposal[];
  decisions: Decision[];
  // A proposal Apply is running for (a run takes minutes), or null.
  working: string | null;
  // A proposal whose rings are being checked in 3D, or null.
  checking: string | null;
  // A line under a card or a Changes row: why Apply or Undo did nothing.
  notes: Record<string, string>;
  // Each card's last ring check, by the proposal's id: in memory only.
  ringChecks: Record<string, RingCheck>;
  // The number of the newest decision a reply's context has listed (since.ts): those after it are new to the model.
  told: number;
}

type Saved = Pick<DecisionState, "proposals" | "decisions"> & { told?: number };

const KEY = "nebula3d.chat.decisions.v1";

const numberOf = (id: string): number => Number(id.slice(1)) || 0;
const newest = (ds: readonly Decision[]): number => ds.reduce((m, d) => Math.max(m, numberOf(d.id)), 0);

// A saved record's mark; one saved without it (before the line) has told every decision it holds.
const toldOf = (saved: Saved): number => saved.told ?? newest(saved.decisions);

const restore = (): Pick<DecisionState, "proposals" | "decisions" | "told"> => {
  try {
    const saved = readDecisions(JSON.parse(sessionStorage.getItem(KEY) ?? "null"));
    return { proposals: saved.proposals, decisions: saved.decisions, told: toldOf(saved) };
  } catch {
    return { proposals: [], decisions: [], told: 0 }; // no storage (private mode, tests)
  }
};

const FRESH = { working: null, checking: null, notes: {}, ringChecks: {} };

export const useDecisionStore = create<DecisionState>(() => ({ ...restore(), ...FRESH }));

useDecisionStore.subscribe((s, prev) => {
  if (s.proposals === prev.proposals && s.decisions === prev.decisions && s.told === prev.told) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ proposals: s.proposals, decisions: s.decisions, told: s.told }));
  } catch {
    // Full or blocked: the record just does not survive a reload.
  }
});

// Closing the volume starts the conversation afresh, and its record with it.
resetsWithVolume(useDecisionStore, { fresh: () => ({ proposals: [], decisions: [], told: 0, ...FRESH }) });

/** The number the next proposal takes ("P<n>"). */
export const nextProposalNumber = (): number => useDecisionStore.getState().proposals.reduce((m, p) => Math.max(m, numberOf(p.id)), 0) + 1;

const nextDecisionId = (): string => `D${newest(useDecisionStore.getState().decisions) + 1}`;

/** Add a reply's proposals. */
export function addProposals(ps: readonly Proposal[]): void {
  if (!ps.length) return;
  useDecisionStore.setState((s) => ({ proposals: [...s.proposals, ...ps] }));
}

/** Change one proposal. */
export function updateProposal(id: string, patch: Partial<Proposal>): void {
  useDecisionStore.setState((s) => ({ proposals: s.proposals.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
}

/** Log a decision; returns it. */
export function logDecision(d: Omit<Decision, "id">): Decision {
  const decision = { ...d, id: nextDecisionId() };
  useDecisionStore.setState((s) => ({ decisions: [...s.decisions, decision] }));
  return decision;
}

/** Change one decision. */
export function updateDecision(id: string, patch: Partial<Decision>): void {
  useDecisionStore.setState((s) => ({ decisions: s.decisions.map((d) => (d.id === id ? { ...d, ...patch } : d)) }));
}

/** Set (or clear, with null) the line under a card or a Changes row. */
export function setNote(id: string, note: string | null): void {
  useDecisionStore.setState((s) => {
    const notes = { ...s.notes };
    if (note) notes[id] = note;
    else delete notes[id];
    return { notes };
  });
}

/** Keep a card's ring check (actions.ts, checkRings). */
export function setRingCheck(id: string, check: RingCheck): void {
  useDecisionStore.setState((s) => ({ ringChecks: { ...s.ringChecks, [id]: check } }));
}

/** Clear the record (the chat's Clear). */
export function clearDecisions(): void {
  useDecisionStore.setState({ proposals: [], decisions: [], told: 0, ...FRESH });
}

/** Replace the record with a saved one (a session file's, already read: readDecisions). */
export function restoreDecisions(saved: Saved): void {
  useDecisionStore.setState({ proposals: saved.proposals, decisions: saved.decisions, told: toldOf(saved), ...FRESH });
}

/** The record as a session file keeps it. */
export const decisionsForFile = (): Saved => {
  const { proposals, decisions, told } = useDecisionStore.getState();
  return { proposals, decisions, told };
};

/**
 * The decisions no reply's context has listed yet, oldest first, and the
 * number of the newest of them: the mark to set (markTold) once a reply that
 * listed them has come back.
 */
export function untoldDecisions(): { decisions: Decision[]; through: number } {
  const { decisions, told } = useDecisionStore.getState();
  return { decisions: decisions.filter((d) => numberOf(d.id) > told), through: newest(decisions) };
}

/** Mark the decisions up to number `through` as listed (never back: a later mark stands). */
export function markTold(through: number): void {
  useDecisionStore.setState((s) => (through > s.told ? { told: through } : {}));
}

// --------------------------------------------------------------- reading back

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isValue = (v: unknown): v is ParamValue => isStr(v) || isNum(v) || typeof v === "boolean";
const oneOf = <T extends string>(v: unknown, xs: readonly T[]): v is T => isStr(v) && (xs as readonly string[]).includes(v);

const KINDS: readonly ProposalKind[] = ["setting", "fact", "run", "trial"];
const STATUSES: readonly ProposalStatus[] = ["open", "applied", "dismissed", "undone"];
const VIAS: readonly ProposalVia[] = ["refused", "rerun", "ask_user", "suggestion", "answer", "trial", "apply", "undo", "auto"];
const HELD: readonly Held[] = ["fact", "choice", "symmetry", "ring", "user-only"];
const ACTIONS: readonly DecisionAction[] = ["apply", "edit-apply", "dismiss", "undo"];

// Settings as the form holds them: strings and booleans, by name.
const readFields = (v: unknown): Partial<PipelineConfig> | null => {
  if (!isObj(v)) return null;
  const out: Record<string, string | boolean> = {};
  for (const [k, x] of Object.entries(v)) {
    if (isStr(x) || typeof x === "boolean") out[k] = x;
    else return null;
  }
  return out as Partial<PipelineConfig>;
};

const readValues = (v: unknown): Record<string, ParamValue> | null => {
  if (!isObj(v)) return null;
  const out: Record<string, ParamValue> = {};
  for (const [k, x] of Object.entries(v)) {
    if (isValue(x)) out[k] = x;
    else if (isObj(x)) out[k] = JSON.stringify(x) as ParamValue; // a declaration (the modulation), kept as its text
    else return null;
  }
  return out;
};

const readShown = (v: unknown): { from: string; to: string } | null => (isObj(v) && isStr(v.from) && isStr(v.to) ? { from: v.from, to: v.to } : null);

function readProposal(v: unknown): Proposal | null {
  if (!isObj(v) || !isStr(v.id) || !/^P\d+$/.test(v.id) || !isNum(v.turn) || !oneOf(v.kind, KINDS) || !isStr(v.title)) return null;
  const change = readValues(v.change);
  const fields = readFields(v.fields);
  const from = readFields(v.from);
  const shown = readShown(v.shown);
  if (!change || !fields || !from || !shown || !isStr(v.dataset) || !oneOf(v.status, STATUSES)) return null;
  const source = isObj(v.source) && oneOf(v.source.via, VIAS) ? { via: v.source.via, ...(isStr(v.source.step) ? { step: v.source.step } : {}) } : null;
  if (!source) return null;
  const evidence = Array.isArray(v.evidence)
    ? v.evidence.flatMap((e) => (isObj(e) && isStr(e.step) && isNum(e.n) && isStr(e.label) && isStr(e.text) ? [{ step: e.step, n: e.n, label: e.label, text: e.text }] : []))
    : [];
  const trial = isObj(v.trial) && oneOf(v.trial.stage, TUNE_STAGES) && isNum(v.trial.n) ? { stage: v.trial.stage, n: v.trial.n } : undefined;
  return {
    id: v.id,
    turn: v.turn,
    kind: v.kind,
    title: v.title,
    change,
    fields,
    from,
    shown,
    ...(oneOf(v.runFrom, RUN_STAGES) ? { runFrom: v.runFrom } : {}),
    source,
    evidence,
    dataset: v.dataset,
    status: v.status,
    ...(oneOf(v.held, HELD) ? { held: v.held } : {}),
    ...(trial ? { trial } : {}),
  };
}

function readDecision(v: unknown): Decision | null {
  if (!isObj(v) || !isStr(v.id) || !/^D\d+$/.test(v.id) || !isStr(v.proposal) || !oneOf(v.kind, KINDS) || !isStr(v.title)) return null;
  const shown = readShown(v.shown);
  const before = readFields(v.before);
  const after = readFields(v.after);
  if (!shown || !before || !after || !oneOf(v.action, ACTIONS) || !oneOf(v.by, ["you", "auto"] as const) || !isNum(v.at)) return null;
  return {
    id: v.id,
    proposal: v.proposal,
    kind: v.kind,
    title: v.title,
    shown,
    action: v.action,
    by: v.by,
    at: v.at,
    before,
    after,
    ...(oneOf(v.runFrom, RUN_STAGES) ? { runFrom: v.runFrom } : {}),
    ...(isStr(v.undoes) ? { undoes: v.undoes } : {}),
    ...(isStr(v.undoneBy) ? { undoneBy: v.undoneBy } : {}),
    ...(v.byClick === true ? { byClick: true as const } : {}),
  };
}

/** A saved record (storage, a session file) read back: only its well-formed proposals and decisions, each id once, and its mark of those told. */
export function readDecisions(v: unknown): Saved {
  if (!isObj(v)) return { proposals: [], decisions: [] };
  const once = <T extends { id: string }>(xs: (T | null)[]): T[] => {
    const seen = new Set<string>();
    return xs.filter((x): x is T => !!x && !seen.has(x.id) && !!seen.add(x.id));
  };
  return {
    proposals: once(Array.isArray(v.proposals) ? v.proposals.map(readProposal) : []),
    decisions: once(Array.isArray(v.decisions) ? v.decisions.map(readDecision) : []),
    ...(isNum(v.told) && v.told >= 0 ? { told: Math.floor(v.told) } : {}),
  };
}
