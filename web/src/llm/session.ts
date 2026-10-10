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
    // A reply without an answer still gets a turn — its thinking, or a note that
    // it came back empty — so a question never ends in silence.
    const empty = !result.content && !result.steps.length;
    useChatStore.getState().addTurn({
      role: "assistant",
      ...result,
      note:
        result.note ??
        (empty
          ? result.reasoning
            ? "The model stopped after thinking, without an answer. Ask again, or try another model."
            : "The model sent back an empty reply. Ask again, or try another model."
          : undefined),
    });
  } catch (e) {
    const live = useChatStore.getState().live;
    const kept = live && (live.content || live.reasoning || live.steps.length);
    if ((e as Error).name === "AbortError") {
      if (kept) useChatStore.getState().addTurn({ role: "assistant", ...live, note: "Stopped." });
    } else if (kept) {
      // The steps already ran (a tuning run, a pipeline run): keep them, and
      // what was written, with the error that ended the reply.
      useChatStore.getState().addTurn({
        role: "assistant",
        ...live,
        note: `The reply ended with an error: ${(e as Error).message.replace(/\.$/, "")}. The steps above ran; ask again to continue from them.`,
      });
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
