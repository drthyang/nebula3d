// Drives one assistant reply into the chat store, at module scope so it keeps
// streaming — and its tools keep running — while the user moves between pages
// or closes the panel.  One reply at a time; stopAssistant() aborts it and
// keeps whatever was written so far.

import { runAgent } from "./agent";
import { useChatStore } from "./chatStore";
import type { ChatMessage } from "./provider/client";
import { loadSettings } from "./settings";
import type { AgentTool, ToolContext } from "./tools";

let controller: AbortController | null = null;

export async function askAssistant({
  label,
  messages,
  tools,
  ctx,
}: {
  label: string; // the user turn shown in the transcript
  messages: ChatMessage[];
  tools: AgentTool[];
  ctx: ToolContext | null;
}): Promise<void> {
  const chat = useChatStore.getState();
  if (chat.busy) return;
  const abort = new AbortController();
  controller = abort;
  chat.addTurn({ role: "user", content: label });
  useChatStore.setState({ busy: true, live: { content: "", reasoning: "", steps: [] }, error: null });
  try {
    const result = await runAgent({
      messages,
      tools,
      ctx,
      settings: loadSettings(),
      signal: abort.signal,
      onProgress: (live) => useChatStore.setState({ live }),
    });
    if (result.content || result.steps.length) useChatStore.getState().addTurn({ role: "assistant", ...result });
  } catch (e) {
    const live = useChatStore.getState().live;
    if ((e as Error).name === "AbortError") {
      if (live && (live.content || live.steps.length)) {
        useChatStore.getState().addTurn({ role: "assistant", ...live, note: "Stopped." });
      }
    } else {
      useChatStore.setState({ error: (e as Error).message });
    }
  } finally {
    if (controller === abort) controller = null;
    useChatStore.setState({ busy: false, live: null });
  }
}

export function stopAssistant(): void {
  controller?.abort();
}
