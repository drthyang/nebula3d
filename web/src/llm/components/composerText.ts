// What the chat box says while it cannot take a question, by why: the panel's
// placeholder says the same (ChatView). "Connect a model" only when no model
// is connected; while the stage metrics load (a run, a dataset just opened)
// or no processed dataset is open, it says that instead.

export interface ComposerState {
  connected: boolean;
  assistant: boolean; // the dataset's context is ready
  contextLoading: boolean;
  autoRunning: boolean;
}

export function composerPlaceholder({ connected, assistant, contextLoading, autoRunning }: ComposerState): string {
  if (autoRunning) return "Auto analysis is running…";
  if (!connected) return "Connect a model to chat…";
  if (!assistant) return contextLoading ? "Preparing metrics…" : "Select a processed dataset…";
  return "Ask about this reduction…";
}
