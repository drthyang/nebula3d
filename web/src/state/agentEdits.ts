// The Configure settings the agent changed, one event per change: NEBULA
// Pilot's update_settings, and the settings a tuning run keeps for a stage.
// The Configure page listens, so a change it would otherwise hide is shown:
// it opens the Advanced fold that holds the setting and briefly highlights
// the field. The user's own edits and a restored session change the form
// directly and never come through here. UI only: nothing here is read back
// to the model, and the tools' results are unchanged.

import { create } from "zustand";

import type { PipelineConfig } from "./pipelineStore";

export interface AgentEdit {
  fields: (keyof PipelineConfig)[]; // the form's fields the agent changed
  seq: number; // counts the edits, so the same field changed twice is two events
}

interface AgentEditsState {
  last: AgentEdit | null;
  // The last edit the page has shown: an edit made while it was not open is
  // shown once when it opens, not again on every visit.
  shown: number;
  markShown: (seq: number) => void;
}

export const useAgentEdits = create<AgentEditsState>((set) => ({
  last: null,
  shown: 0,
  markShown: (seq) => set((s) => (seq > s.shown ? { shown: seq } : s)),
}));

/** Tell the page the agent changed these fields (none: nothing to tell). */
export function noteAgentEdit(fields: readonly (keyof PipelineConfig)[]): void {
  const unique = [...new Set(fields)];
  if (!unique.length) return;
  useAgentEdits.setState((s) => ({ last: { fields: unique, seq: (s.last?.seq ?? 0) + 1 } }));
}
