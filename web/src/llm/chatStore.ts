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

export interface ChatTurn {
  id: number;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  steps?: AgentStep[];
  note?: string;
}

interface ChatState {
  turns: ChatTurn[];
  draft: string;
  busy: boolean;
  live: AgentProgress | null; // the reply being written
  error: string | null;
  addTurn: (turn: Omit<ChatTurn, "id">) => void;
  setDraft: (draft: string) => void;
  clear: () => void;
}

const TRANSCRIPT_KEY = "nebula3d.chat.turns.v1";
const DRAFT_KEY = "nebula3d.chat.draft.v1";
export const TRANSCRIPT_BYTES = 1_000_000;

const isTurn = (t: unknown): t is ChatTurn =>
  !!t && typeof t === "object" && ((t as ChatTurn).role === "user" || (t as ChatTurn).role === "assistant") &&
  typeof (t as ChatTurn).content === "string" && typeof (t as ChatTurn).id === "number";

const restore = (): { turns: ChatTurn[]; draft: string } => {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(TRANSCRIPT_KEY) ?? "[]");
    const turns = Array.isArray(saved) ? saved.filter(isTurn) : [];
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

// The newest turns whose JSON fits the budget.
export const fitTranscript = (turns: ChatTurn[], budget = TRANSCRIPT_BYTES): string => {
  let from = 0;
  let json = JSON.stringify(turns);
  while (json.length > budget && from < turns.length) {
    from += 1;
    json = JSON.stringify(turns.slice(from));
  }
  return json;
};

const restored = restore();
let nextId = restored.turns.reduce((m, t) => Math.max(m, t.id), 0) + 1;

export const useChatStore = create<ChatState>((set) => ({
  turns: restored.turns,
  draft: restored.draft,
  busy: false,
  live: null,
  error: null,
  addTurn: (turn) => set((s) => ({ turns: [...s.turns, { ...turn, id: nextId++ }] })),
  setDraft: (draft) => set({ draft }),
  clear: () => set({ turns: [], draft: "", error: null }),
}));

useChatStore.subscribe((s, prev) => {
  try {
    if (s.turns !== prev.turns) sessionStorage.setItem(TRANSCRIPT_KEY, fitTranscript(s.turns));
    if (s.draft !== prev.draft) sessionStorage.setItem(DRAFT_KEY, s.draft);
  } catch {
    // Full or blocked: the transcript just does not survive a reload.
  }
});
