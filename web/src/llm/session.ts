// Drives one assistant reply into the chat store, at module scope so it keeps
// streaming — and its tools keep running — while the user moves between pages
// or closes the panel.  One reply at a time; stopAssistant() aborts it and
// keeps whatever was written so far.

import { runAgent, toolStepsIn, type AgentResult, type AgentStep, type RunAgentOptions } from "./agent";
import { proposeFromReply } from "./apply/actions";
import { clearDecisions, markTold } from "./apply/decisions";
import { elapsedMs, startClock, stopClock } from "./clock";
import { marksMade } from "./answerChecks";
import { beginReply, endReply, recordUsage, type Usage } from "./usage";
import { useMarkStore } from "../state/markStore";
import { useChatStore } from "./chatStore";
import type { ChatMessage } from "./provider/client";
import { loadSettings, type LlmSettings } from "./settings";
import { skillsReadIn } from "./skills";
import type { AgentTool, ToolContext } from "./tools";

let controller: AbortController | null = null;

/**
 * The tool context of a conversation's next reply. No skill counts as read
 * yet: the chat sends the earlier turns as their text alone (ChatView), so a
 * skill read in one of them is not in this reply, and the gate opens on a
 * read in this reply, or on a skill whose text the messages carry
 * (startReply, tools/round.ts). The earlier reads word the refusal, which asks
 * for the skill again; the earlier tool calls that ran are what an answer's
 * numbers may come from besides this reply's, while what each measured stands
 * (toolStepsIn, agent.ts; earlierSources, answerChecks.ts). The marks the
 * earlier turns made, restored ones too, are what an answer may name besides
 * this reply's (marksMade, unmadeMarks).
 */
export function replyContext(ctx: ToolContext, turns: readonly { steps?: readonly AgentStep[] }[]): ToolContext {
  return {
    ...ctx,
    skillsRead: new Set(),
    skillsReadEarlier: skillsReadIn(turns),
    earlierSteps: toolStepsIn(turns),
    marksEarlier: new Set(marksMade(turns.flatMap((t) => t.steps ?? []))),
  };
}

/** How a reply ended, for a caller that drives replies itself (auto/controller.ts). */
export interface ReplyOutcome {
  turn: number | null; // the assistant turn it added; null: none (it ended with nothing to keep)
  result: AgentResult | null; // null: it was stopped, or ended with an error
  stopped: boolean;
  error: string | null;
  tokens: Usage;
}

/**
 * The options an auto-mode reply adds (auto/controller.ts): its settings, its
 * run's Stop (`signal`, besides stopAssistant), and what runAgent takes for it
 * (the seeded checks, the user's words as "", its round limit, its run
 * policy with the output cap, and a hook for a request cut at it); each
 * request's tokens go to `onUsage` as well.
 */
export interface ReplyOptions {
  settings?: LlmSettings;
  signal?: AbortSignal;
  agent?: Pick<RunAgentOptions, "seed" | "userMessage" | "maxRounds" | "onSeedForm" | "policy" | "onTruncated">;
  onUsage?: (u: Usage) => void;
}

export async function askAssistant({
  label,
  messages,
  tools,
  ctx,
  told,
  settings,
  signal,
  agent,
  onUsage,
}: {
  label: string; // the user turn shown in the transcript
  messages: ChatMessage[];
  tools: AgentTool[];
  ctx: ToolContext | null;
  // The newest decision the messages' "since the last reply" line lists
  // (apply/since.ts): marked as told once the reply has come back with a turn;
  // a reply that ended with nothing lists them again in the next one.
  told?: number;
} & ReplyOptions): Promise<ReplyOutcome | null> {
  const chat = useChatStore.getState();
  if (chat.busy) return null;
  const abort = new AbortController();
  controller = abort;
  // The caller's Stop ends the reply too.
  const stopReply = () => abort.abort();
  if (signal?.aborted) abort.abort();
  signal?.addEventListener("abort", stopReply, { once: true });
  chat.addTurn({ role: "user", content: label });
  // The reply's clock (clock.ts): the panel shows it while the reply runs, and the turn keeps it.
  useChatStore.setState({ busy: true, live: { content: "", reasoning: "", steps: [] }, error: null, clock: startClock(Date.now()) });
  const took = (): { ms?: number } => {
    const c = useChatStore.getState().clock;
    return c ? { ms: elapsedMs(stopClock(c, Date.now()), Date.now()) } : {};
  };
  // The reply's model requests, a tuning run's inside it included (usage.ts).
  beginReply();
  try {
    const result = await runAgent({
      messages,
      tools,
      ctx,
      settings: settings ?? loadSettings(),
      signal: abort.signal,
      onProgress: (live) => useChatStore.setState({ live }),
      onUsage: (u) => {
        recordUsage(u);
        onUsage?.(u);
      },
      ...agent,
    });
    const tokens = endReply();
    // A reply without an answer still gets a turn — its thinking, or a note that
    // it came back empty — so a question never ends in silence.
    const empty = !result.content && !result.steps.length;
    // The user reads the answer as shown (an answer kept although it failed
    // its checks carries its marks: agent.ts, `shown`).
    const { shown, ...reply } = result;
    useChatStore.getState().addTurn({
      role: "assistant",
      ...reply,
      ...(shown ? { content: shown } : {}),
      ...(tokens.requests || tokens.uncounted ? { tokens } : {}),
      ...took(),
      note:
        result.note ??
        (empty
          ? result.reasoning
            ? "The model stopped after thinking, without an answer. Ask again, or try another model."
            : "The model sent back an empty reply. Ask again, or try another model."
          : undefined),
    });
    // The Apply cards the reply leads to, built from its steps' whole results
    // (the transcript keeps what was read): UI only, the model reads none of them.
    proposeFromReply(lastTurnId(), result.steps, result.content, ctx?.dataset.id);
    if (told !== undefined) markTold(told);
    return { turn: lastTurnId(), result, stopped: false, error: null, tokens };
  } catch (e) {
    const counted = endReply();
    const tokens = counted.requests || counted.uncounted ? { tokens: counted } : {};
    const stopped = (e as Error).name === "AbortError";
    const ended = useChatStore.getState().live;
    // A step still running when the reply ended never finished: it is kept
    // as stopped, not as a step that runs on.
    const live = ended && { ...ended, steps: endSteps(ended.steps, stopped ? "you stopped the reply" : "the reply ended with an error") };
    const kept = live && (live.content || live.reasoning || live.steps.length);
    if (kept && told !== undefined) markTold(told);
    const outcome = (turn: number | null): ReplyOutcome => ({ turn, result: null, stopped, error: stopped ? null : (e as Error).message, tokens: counted });
    if (stopped) {
      if (kept) useChatStore.getState().addTurn({ role: "assistant", ...live, ...tokens, ...took(), note: "Stopped." });
      else withQuestion(tokens);
      return outcome(kept ? lastTurnId() : null);
    } else if (kept) {
      // The steps already ran (a tuning run, a pipeline run): keep them, and
      // what was written, with the error that ended the reply.
      useChatStore.getState().addTurn({
        role: "assistant",
        ...live,
        ...tokens,
        ...took(),
        note: `The reply ended with an error: ${(e as Error).message.replace(/\.$/, "")}. The steps above ran; ask again to continue from them.`,
      });
      return outcome(lastTurnId());
    } else {
      withQuestion(tokens);
      useChatStore.setState({ error: (e as Error).message });
      return outcome(null);
    }
  } finally {
    signal?.removeEventListener("abort", stopReply);
    if (controller === abort) controller = null;
    useChatStore.setState({ busy: false, live: null, clock: null });
  }
}

const lastTurnId = (): number => {
  const turns = useChatStore.getState().turns;
  return turns[turns.length - 1]?.id ?? 0;
};

// A reply that ended with nothing to keep adds no turn, but its requests are
// in the conversation's total already: they go with the question that asked,
// so a restored conversation (chatStore.restoreTurns) totals the same.
function withQuestion({ tokens }: { tokens?: Usage }): void {
  if (!tokens) return;
  useChatStore.setState((s) => {
    const last = s.turns[s.turns.length - 1];
    return last?.role === "user" ? { turns: [...s.turns.slice(0, -1), { ...last, tokens }] } : {};
  });
}

/** The steps of a reply that ended, any still running marked stopped (with why). */
export function endSteps(steps: AgentStep[], why: string): AgentStep[] {
  return steps.map((s) => (s.status === "running" ? { ...s, status: "stopped", progress: undefined, summary: why } : s));
}

export function stopAssistant(): void {
  controller?.abort();
}

/**
 * The chat's Clear: the conversation, the regions it marked in the slice
 * views (state/markStore.ts), every dataset's, and its Apply cards' record
 * (apply/decisions.ts). A mark rests on the steps of
 * the reply that made it, and the transcript's Show reopens it: with the
 * transcript gone, its marks go too.
 */
export function clearConversation(): void {
  useChatStore.getState().clear();
  useMarkStore.getState().clearAll();
  clearDecisions();
}
