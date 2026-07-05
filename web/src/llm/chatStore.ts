// The chat session lives in a module-scoped store, not in ChatView's local
// state, so switching pages (which unmounts the assistant view) does not wipe
// the conversation.  Mirrors how pipelineStore keeps the running job alive
// across navigation.

import { create } from "zustand";

export interface ChatTurn {
  id: number;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
}

interface ChatState {
  turns: ChatTurn[];
  draft: string;
  addTurn: (turn: Omit<ChatTurn, "id">) => void;
  setDraft: (draft: string) => void;
  clear: () => void;
}

let nextId = 1;

export const useChatStore = create<ChatState>((set) => ({
  turns: [],
  draft: "",
  addTurn: (turn) => set((s) => ({ turns: [...s.turns, { ...turn, id: nextId++ }] })),
  setDraft: (draft) => set({ draft }),
  clear: () => set({ turns: [], draft: "" }),
}));
