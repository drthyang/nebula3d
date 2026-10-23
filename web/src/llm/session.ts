// Drives one assistant reply into the chat store, at module scope so it keeps
// streaming — and its tools keep running — while the user moves between pages
// or closes the panel.  One reply at a time; stopAssistant() aborts it and
// keeps whatever was written so far.

import { runAgent, type AgentStep } from "./agent";
import { beginReply, endReply, recordUsage } from "./usage";
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
  // The reply's model requests, a tuning run's inside it included (usage.ts).
  beginReply();
  try {
    const result = await runAgent({
      messages,
      tools,
      ctx,
      settings: loadSettings(),
      signal: abort.signal,
      onProgress: (live) => useChatStore.setState({ live }),
      onUsage: recordUsage,
    });
    const tokens = endReply();
    // A reply without an answer still gets a turn — its thinking, or a note that
    // it came back empty — so a question never ends in silence.
    const empty = !result.content && !result.steps.length;
    useChatStore.getState().addTurn({
      role: "assistant",
      ...result,
      ...(tokens.requests ? { tokens } : {}),
      note:
        result.note ??
        (empty
          ? result.reasoning
            ? "The model stopped after thinking, without an answer. Ask again, or try another model."
            : "The model sent back an empty reply. Ask again, or try another model."
          : undefined),
    });
  } catch (e) {
    const counted = endReply();
    const tokens = counted.requests ? { tokens: counted } : {};
    const stopped = (e as Error).name === "AbortError";
    const ended = useChatStore.getState().live;
    // A step still running when the reply ended never finished: it is kept
    // as stopped, not as a step that runs on.
    const live = ended && { ...ended, steps: endSteps(ended.steps, stopped ? "you stopped the reply" : "the reply ended with an error") };
    const kept = live && (live.content || live.reasoning || live.steps.length);
    if (stopped) {
      if (kept) useChatStore.getState().addTurn({ role: "assistant", ...live, ...tokens, note: "Stopped." });
    } else if (kept) {
      // The steps already ran (a tuning run, a pipeline run): keep them, and
      // what was written, with the error that ended the reply.
      useChatStore.getState().addTurn({
        role: "assistant",
        ...live,
        ...tokens,
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

/** The steps of a reply that ended, any still running marked stopped (with why). */
export function endSteps(steps: AgentStep[], why: string): AgentStep[] {
  return steps.map((s) => (s.status === "running" ? { ...s, status: "stopped", progress: undefined, summary: why } : s));
}

export function stopAssistant(): void {
  controller?.abort();
}
