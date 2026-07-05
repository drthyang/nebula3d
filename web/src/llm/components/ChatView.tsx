// The conversation surface: a transcript with collapsible model "thinking",
// markdown-rendered answers, a prompt box, and the four one-click stage reviews.
// Every request re-sends the compact diagnostic context; stage reviews optionally
// attach the rendered slice image when the vision opt-in is on.

import { useCallback, useRef, useState } from "react";

import { COLORMAPS } from "../../colormaps/luts";
import type { Slice } from "../../api/types";
import {
  buildChatMessages,
  buildStageReviewMessages,
  STAGE_REVIEW_LABELS,
  type HistoryTurn,
  type ReviewStage,
} from "../prompts/templates";
import { renderSliceToDataUrl } from "../render/sliceImage";
import type { LlmSettings } from "../settings";
import type { AssistantContext } from "../useAssistant";
import { useStreamedReply } from "../useStreamedReply";
import { Markdown } from "./Markdown";

interface Turn extends HistoryTurn {
  id: number;
  reasoning?: string;
}

// Pick the slice + colour mapping to render for a given stage review.
function stageImage(stage: ReviewStage, ac: AssistantContext): string | null {
  const pick: Record<ReviewStage, { slice?: Slice | null; diverging: boolean; cmap: string; vmax?: number | null }> = {
    rings: {
      slice: ac.slices.ringremoved,
      diverging: false,
      cmap: "inferno",
      vmax: ac.context.ring_removal?.suggested_display_vmax,
    },
    punch: { slice: ac.slices.braggpunched, diverging: false, cmap: "inferno" },
    backfill: { slice: ac.slices.backfilled, diverging: false, cmap: "inferno" },
    dpdf: { slice: ac.slices.dpdf, diverging: true, cmap: "RdBu_r" },
  };
  const p = pick[stage];
  if (!p.slice) return null;
  const lut = COLORMAPS[p.cmap] ?? COLORMAPS.inferno;
  const vmax = p.vmax && p.vmax > 0 ? p.vmax : p.slice.header.robust_max || 1;
  return renderSliceToDataUrl(p.slice, { lut, vmax, diverging: p.diverging });
}

// A collapsible "thinking" panel for a reasoning-model chain-of-thought.
function Thinking({ text, live }: { text: string; live?: boolean }) {
  if (!text) return null;
  return (
    <details className="ai-think" open={live}>
      <summary>
        {live ? "Thinking…" : "Thoughts"}
        <span className="ai-think-count">{live ? "" : " · reasoning"}</span>
      </summary>
      <div className="ai-think-body">{text}</div>
    </details>
  );
}

export function ChatView({
  assistant,
  connected,
  settings,
  contextLoading = false,
}: {
  assistant: AssistantContext | undefined;
  connected: boolean;
  settings: LlmSettings;
  contextLoading?: boolean;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const idRef = useRef(0);
  const reply = useStreamedReply();
  const scrollRef = useRef<HTMLDivElement>(null);

  const nextId = () => (idRef.current += 1);

  const scrollDown = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  const sendChat = useCallback(async () => {
    const text = draft.trim();
    if (!text || !assistant || reply.streaming) return;
    setDraft("");
    const history = turns.map(({ role, content }) => ({ role, content }));
    setTurns((t) => [...t, { id: nextId(), role: "user", content: text }]);
    scrollDown();
    const messages = buildChatMessages(assistant.context, history, text);
    const { content, reasoning } = await reply.run(messages);
    if (content) setTurns((t) => [...t, { id: nextId(), role: "assistant", content, reasoning }]);
    scrollDown();
  }, [draft, assistant, turns, reply, scrollDown]);

  const runReview = useCallback(
    async (stage: ReviewStage) => {
      if (!assistant || reply.streaming) return;
      const image = settings.attachImages ? stageImage(stage, assistant) : null;
      const label = STAGE_REVIEW_LABELS[stage] + (image ? " (with image)" : "");
      setTurns((t) => [...t, { id: nextId(), role: "user", content: label }]);
      scrollDown();
      const messages = buildStageReviewMessages(assistant.context, stage, image);
      const { content, reasoning } = await reply.run(messages);
      if (content) setTurns((t) => [...t, { id: nextId(), role: "assistant", content, reasoning }]);
      scrollDown();
    },
    [assistant, reply, settings.attachImages, scrollDown],
  );

  const stages: ReviewStage[] = ["rings", "punch", "backfill", "dpdf"];
  const disabled = !connected || !assistant;

  return (
    <div className="ai-chat">
      <div className="ai-reviews">
        <span className="ai-reviews-label">One-click reviews</span>
        {stages.map((s) => (
          <button
            key={s}
            type="button"
            className="ai-chip"
            disabled={disabled || reply.streaming}
            onClick={() => runReview(s)}
            title={disabled ? "Connect a model and select a dataset first" : undefined}
          >
            {STAGE_REVIEW_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="ai-transcript" ref={scrollRef}>
        {turns.length === 0 && !reply.streaming && (
          <div className="ai-placeholder">
            {!connected
              ? "Connect a local or cloud model above, then ask about the reduction — or use a one-click review."
              : !assistant
                ? contextLoading
                  ? "Preparing metrics from the stage volumes…"
                  : "Select a processed dataset to prepare the assistant's context."
                : "Ask about the reduction, or click a stage review above. Answers are grounded in metrics computed from the current cut."}
          </div>
        )}
        {turns.map((t) =>
          t.role === "user" ? (
            <div key={t.id} className="ai-msg ai-msg-user">
              <span className="ai-msg-role">You</span>
              <div className="ai-msg-bubble">{t.content}</div>
            </div>
          ) : (
            <div key={t.id} className="ai-msg ai-msg-assistant">
              <span className="ai-msg-role">Assistant</span>
              {t.reasoning ? <Thinking text={t.reasoning} /> : null}
              <div className="ai-msg-bubble">
                <Markdown text={t.content} />
              </div>
            </div>
          ),
        )}
        {reply.streaming && (
          <div className="ai-msg ai-msg-assistant">
            <span className="ai-msg-role">Assistant</span>
            <Thinking text={reply.reasoning} live />
            {reply.content ? (
              <div className="ai-msg-bubble">
                <Markdown text={reply.content} />
                <span className="ai-caret" />
              </div>
            ) : !reply.reasoning ? (
              <div className="ai-msg-bubble ai-msg-waiting">
                <span className="ai-caret" />
              </div>
            ) : null}
          </div>
        )}
        {reply.error && <div className="ai-conn-alert">{reply.error}</div>}
      </div>

      <div className="ai-composer">
        <textarea
          value={draft}
          placeholder={disabled ? "Connect a model to chat" : "Ask about this reduction…"}
          disabled={disabled}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void sendChat();
            }
          }}
        />
        {reply.streaming ? (
          <button type="button" className="ai-btn ai-btn-stop" onClick={reply.cancel}>
            Stop
          </button>
        ) : (
          <button type="button" className="ai-btn ai-btn-send" disabled={disabled || !draft.trim()} onClick={sendChat}>
            Send
          </button>
        )}
      </div>
    </div>
  );
}
