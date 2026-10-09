// The chat session lives in a module-scoped store, not in a component's local
// state, so it survives the assistant panel closing and pages changing under
// it — including a reply that is still streaming and running tools (session.ts
// drives it).  Mirrors how pipelineStore keeps the running job alive.

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

let nextId = 1;

export const useChatStore = create<ChatState>((set) => ({
  turns: [],
  draft: "",
  busy: false,
  live: null,
  error: null,
  addTurn: (turn) => set((s) => ({ turns: [...s.turns, { ...turn, id: nextId++ }] })),
  setDraft: (draft) => set({ draft }),
  clear: () => set({ turns: [], draft: "", error: null }),
}));
