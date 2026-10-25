// The chat session lives in a module-scoped store, not in a component's local
// state, so it survives the assistant panel closing and pages changing under
// it — including a reply that is still streaming and running tools (session.ts
// drives it).  Mirrors how pipelineStore keeps the running job alive.
//
// The transcript and the draft also survive a reload of the page: they are
// kept in sessionStorage (this tab only, gone with it).  A reply still being
// written is lost, and its question gets a note saying so.  Only the newest
// turns that fit TRANSCRIPT_BYTES are kept; storage that is full or blocked
// just keeps nothing.

import { create } from "zustand";

import type { AgentProgress, AgentStep } from "./agent";
import type { Usage } from "./usage";
import type { ComputedVerdict } from "./verdicts";

export interface ChatTurn {
  id: number;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  steps?: AgentStep[];
  note?: string;
  verdict?: ComputedVerdict | null; // computed from the checks the reply ran (verdicts/)
  // The reply's model requests, measured or estimated (usage.ts); on a user
  // turn, those of a reply that ended with nothing to keep (session.ts).
  tokens?: Usage;
}

interface ChatState {
  turns: ChatTurn[];
  draft: string;
  busy: boolean;
  live: AgentProgress | null; // the reply being written
  error: string | null;
  usage: Usage | null; // the conversation's model requests so far (usage.ts); null before the first
  addUsage: (u: Usage) => void;
  addTurn: (turn: Omit<ChatTurn, "id">) => void;
  setDraft: (draft: string) => void;
  clear: () => void;
  // Replace the conversation with a saved one (state/session.ts): only its
  // well-formed turns, in their order, numbered on after them.
  restoreTurns: (turns: unknown[]) => void;
}

const TRANSCRIPT_KEY = "nebula3d.chat.turns.v1";
const DRAFT_KEY = "nebula3d.chat.draft.v1";
const USAGE_KEY = "nebula3d.chat.usage.v1";
export const TRANSCRIPT_BYTES = 1_000_000;

const isTurn = (t: unknown): t is ChatTurn =>
  !!t && typeof t === "object" && ((t as ChatTurn).role === "user" || (t as ChatTurn).role === "assistant") &&
  typeof (t as ChatTurn).content === "string" && typeof (t as ChatTurn).id === "number";

// A saved turn's steps can never be running: one that was (saved before a
// reply's end marked it, by an older build) is stopped.
const settled = (turn: ChatTurn): ChatTurn =>
  turn.steps?.some((s) => s.status === "running")
    ? { ...turn, steps: turn.steps.map((s) => (s.status === "running" ? { ...s, status: "stopped" as const, progress: undefined } : s)) }
    : turn;

// A turn read from a session file, which could hold anything: only its steps
// of the shape a step has, each marked as restored, so a later reply's number
// check does not take its result for a tool's (agent.ts toolStepsIn).
const STEP_STATUSES = new Set(["running", "done", "error", "stopped"]);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStep = (s: unknown): s is AgentStep =>
  isObj(s) && typeof s.id === "string" && typeof s.name === "string" && isObj(s.args) &&
  typeof s.status === "string" && STEP_STATUSES.has(s.status) &&
  ["summary", "progress", "result", "full"].every((k) => s[k] === undefined || typeof s[k] === "string") &&
  (s.outcomes === undefined || Array.isArray(s.outcomes)) && (s.view === undefined || isObj(s.view));
const fromFile = (turn: ChatTurn): ChatTurn => {
  const { steps, ...rest } = turn;
  return Array.isArray(steps) ? { ...rest, steps: steps.filter(isStep).map((s) => ({ ...s, restored: true as const })) } : rest;
};

const restore = (): { turns: ChatTurn[]; draft: string } => {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(TRANSCRIPT_KEY) ?? "[]");
    const turns = Array.isArray(saved) ? saved.filter(isTurn).map(settled) : [];
    // A last question without its reply: the reload cut the reply off.
    if (turns.length && turns[turns.length - 1].role === "user") {
      turns.push({
        id: turns[turns.length - 1].id + 1,
        role: "assistant",
        content: "",
        note: "The reply was cut off by a reload of the page. Ask again.",
      });
    }
    return { turns, draft: sessionStorage.getItem(DRAFT_KEY) ?? "" };
  } catch {
    return { turns: [], draft: "" }; // no storage (private mode, tests)
  }
};

// Each turn's JSON, written once: a turn never changes after it is added, and
// the transcript is saved again on every new turn.
const turnJson = new WeakMap<ChatTurn, string>();
const jsonOf = (turn: ChatTurn): string => {
  let json = turnJson.get(turn);
  if (json === undefined) {
    json = JSON.stringify(turn);
    turnJson.set(turn, json);
  }
  return json;
};

// The newest turns whose JSON fits the budget: the JSON of the array, `[a,b,…]`,
// counted from its turns' own, so a long conversation is not written out again
// once per turn it drops (that froze the page for seconds on every reply).
export const fitTranscript = (turns: ChatTurn[], budget = TRANSCRIPT_BYTES): string => {
  const parts = turns.map(jsonOf);
  let length = 2 + parts.reduce((n, p) => n + p.length, 0) + Math.max(0, parts.length - 1);
  let from = 0;
  while (length > budget && from < parts.length) {
    length -= parts[from].length + (from < parts.length - 1 ? 1 : 0); // the turn, and its comma
    from += 1;
  }
  return `[${parts.slice(from).join(",")}]`;
};

// The conversation's token total, kept with its transcript.
const restoreUsage = (): Usage | null => {
  try {
    const u: unknown = JSON.parse(sessionStorage.getItem(USAGE_KEY) ?? "null");
    const fields = ["input", "output", "cacheRead", "cacheWrite", "requests", "estimated"] as const;
    return u && typeof u === "object" && fields.every((f) => typeof (u as Record<string, unknown>)[f] === "number") ? (u as Usage) : null;
  } catch {
    return null;
  }
};

const restored = restore();
let nextId = restored.turns.reduce((m, t) => Math.max(m, t.id), 0) + 1;

// A step's outcomes (verdicts/) and its whole result (`full`, readings/)
// serve the reply's own checks and its record: the transcript keeps what the
// model and the user read, at the size it had.
const asRead = (steps: AgentStep[]): AgentStep[] =>
  steps.map((step) => {
    const { outcomes, full, ...kept } = step;
    void outcomes;
    void full;
    return kept;
  });

export const useChatStore = create<ChatState>((set) => ({
  turns: restored.turns,
  draft: restored.draft,
  busy: false,
  live: null,
  error: null,
  usage: restoreUsage(),
  addUsage: (u) =>
    set((s) => {
      const t = s.usage;
      return {
        usage: t
          ? {
              input: t.input + u.input,
              output: t.output + u.output,
              cacheRead: t.cacheRead + u.cacheRead,
              cacheWrite: t.cacheWrite + u.cacheWrite,
              requests: t.requests + u.requests,
              estimated: t.estimated + u.estimated,
              ...(t.uncounted || u.uncounted ? { uncounted: (t.uncounted ?? 0) + (u.uncounted ?? 0) } : {}),
            }
          : { ...u },
      };
    }),
  addTurn: (turn) => set((s) => ({ turns: [...s.turns, { ...turn, ...(turn.steps ? { steps: asRead(turn.steps) } : {}), id: nextId++ }] })),
  setDraft: (draft) => set({ draft }),
  clear: () => set({ turns: [], draft: "", error: null, usage: null }),
  restoreTurns: (saved) => {
    const turns = saved.filter(isTurn).map((t) => settled(fromFile(t)));
    nextId = Math.max(nextId, turns.reduce((m, t) => Math.max(m, t.id), 0) + 1);
    // The conversation's total is its replies' counts.
    const counted = turns.flatMap((t) => (t.tokens?.requests || t.tokens?.uncounted ? [t.tokens] : []));
    const usage = counted.length
      ? counted.reduce((a, u) => ({
          input: a.input + u.input,
          output: a.output + u.output,
          cacheRead: a.cacheRead + u.cacheRead,
          cacheWrite: a.cacheWrite + u.cacheWrite,
          requests: a.requests + u.requests,
          estimated: a.estimated + u.estimated,
          ...(a.uncounted || u.uncounted ? { uncounted: (a.uncounted ?? 0) + (u.uncounted ?? 0) } : {}),
        }))
      : null;
    set({ turns, error: null, usage });
  },
}));

useChatStore.subscribe((s, prev) => {
  try {
    if (s.turns !== prev.turns) sessionStorage.setItem(TRANSCRIPT_KEY, fitTranscript(s.turns));
    if (s.draft !== prev.draft) sessionStorage.setItem(DRAFT_KEY, s.draft);
    if (s.usage !== prev.usage) sessionStorage.setItem(USAGE_KEY, JSON.stringify(s.usage));
  } catch {
    // Full or blocked: the transcript just does not survive a reload.
  }
});
