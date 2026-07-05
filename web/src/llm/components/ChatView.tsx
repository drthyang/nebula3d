// The conversation surface: a transcript with collapsible model "thinking",
// markdown-rendered answers, a prompt box, and the four one-click stage reviews.
// Every request re-sends the compact diagnostic context; stage reviews optionally
// attach the rendered slice image when the vision opt-in is on.

import { useCallback, useEffect, useRef } from "react";

import { COLORMAPS } from "../../colormaps/luts";
import type { Slice } from "../../api/types";
import {
  buildChatMessages,
  buildStageReviewMessages,
  STAGE_REVIEW_LABELS,
  type ReviewStage,
} from "../prompts/templates";
import { renderSliceToDataUrl } from "../render/sliceImage";
import { saveSettings, type LlmSettings } from "../settings";
import type { AssistantContext } from "../useAssistant";
import { useStreamedReply } from "../useStreamedReply";
import { useChatStore } from "../chatStore";
import { BrandGlyph } from "../../components/ui";
import { Markdown } from "./Markdown";

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

// A collapsible "thinking" panel for a reasoning-model chain-of-thought. While
// live, the body auto-scrolls to the newest reasoning as it streams in.
function Thinking({ text, live }: { text: string; live?: boolean }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [text, live]);
  if (!text) return null;
  return (
    <details className="ai-think" open={live}>
      <summary>
        {live ? "Thinking…" : "Thoughts"}
        <span className="ai-think-count">{live ? "" : " · reasoning"}</span>
      </summary>
      <div className="ai-think-body" ref={bodyRef}>
        {text}
      </div>
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
  const turns = useChatStore((s) => s.turns);
  const draft = useChatStore((s) => s.draft);
  const addTurn = useChatStore((s) => s.addTurn);
  const setDraft = useChatStore((s) => s.setDraft);
  const clearChat = useChatStore((s) => s.clear);
  const reply = useStreamedReply();
  const scrollRef = useRef<HTMLDivElement>(null);

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
    addTurn({ role: "user", content: text });
    scrollDown();
    const messages = buildChatMessages(assistant.context, history, text);
    const { content, reasoning } = await reply.run(messages);
    if (content) addTurn({ role: "assistant", content, reasoning });
    scrollDown();
  }, [draft, assistant, turns, reply, addTurn, setDraft, scrollDown]);

  const runReview = useCallback(
    async (stage: ReviewStage) => {
      if (!assistant || reply.streaming) return;
      const image = settings.attachImages ? stageImage(stage, assistant) : null;
      const label = STAGE_REVIEW_LABELS[stage] + (image ? " (with image)" : "");
      addTurn({ role: "user", content: label });
      scrollDown();
      const messages = buildStageReviewMessages(assistant.context, stage, image);
      const { content, reasoning } = await reply.run(messages);
      if (content) addTurn({ role: "assistant", content, reasoning });
      scrollDown();
    },
    [assistant, reply, settings.attachImages, addTurn, scrollDown],
  );

  const stages: ReviewStage[] = ["rings", "punch", "backfill", "dpdf"];
  const disabled = !connected || !assistant;
  const empty = turns.length === 0 && !reply.streaming;

  return (
    <div className="ai-chat">
      <div className="ai-transcript" ref={scrollRef}>
        {empty && (
          <div className="ai-placeholder">
            <span className="ai-placeholder-title">
              {!connected
                ? "Connect a model to begin"
                : !assistant
                  ? contextLoading
                    ? "Preparing metrics…"
                    : "Select a processed dataset"
                  : "Ask about this reduction"}
            </span>
            <span className="ai-placeholder-sub">
              {!connected
                ? "Open connection settings (gear) to point at a local or cloud model."
                : !assistant
                  ? contextLoading
                    ? "Reading the stage volumes and computing quality metrics."
                    : "Its stage outputs feed the assistant's context."
                  : "Answers are grounded in metrics computed from the current cut — or use a one-click review below."}
            </span>
          </div>
        )}
        {turns.map((t) =>
          t.role === "user" ? (
            <div key={t.id} className="ai-msg ai-msg-user">
              <div className="ai-user-bubble">{t.content}</div>
            </div>
          ) : (
            <div key={t.id} className="ai-msg ai-msg-assistant">
              <span className="ai-avatar" aria-hidden="true">
                <BrandGlyph size={22} />
              </span>
              <div className="ai-msg-main">
                {t.reasoning ? <Thinking text={t.reasoning} /> : null}
                <div className="ai-answer">
                  <Markdown text={t.content} />
                </div>
              </div>
            </div>
          ),
        )}
        {reply.streaming && (
          <div className="ai-msg ai-msg-assistant">
            <span className="ai-avatar ai-avatar-spin" aria-hidden="true">
              <BrandGlyph size={22} />
            </span>
            <div className="ai-msg-main">
              <Thinking text={reply.reasoning} live />
              {reply.content ? (
                <div className="ai-answer">
                  <Markdown text={reply.content} />
                  <span className="ai-caret" />
                </div>
              ) : !reply.reasoning ? (
                <div className="ai-answer ai-answer-waiting">
                  <span className="ai-caret" />
                </div>
              ) : null}
            </div>
          </div>
        )}
        {reply.error && <div className="ai-conn-alert">{reply.error}</div>}
      </div>

      <div className="ai-dock">
        <div className="ai-reviews">
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
          <button
            type="button"
            className={`ai-vision-chip${settings.attachImages ? " on" : ""}`}
            onClick={() => saveSettings({ attachImages: !settings.attachImages })}
            aria-pressed={settings.attachImages}
            title={
              settings.attachImages
                ? "Vision on: the rendered slice is sent with stage reviews so a vision model can assess the image."
                : "Vision off: only computed metrics are sent. Turn on for vision-capable models."
            }
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
              />
              <circle cx="8" cy="8" r="2.1" fill="currentColor" />
            </svg>
            Vision
          </button>
          {turns.length > 0 && (
            <button
              type="button"
              className="ai-clear"
              onClick={clearChat}
              disabled={reply.streaming}
              title="Clear the conversation"
            >
              Clear
            </button>
          )}
        </div>

        <div className={`ai-composer${disabled ? " is-disabled" : ""}`}>
          <textarea
            value={draft}
            placeholder={disabled ? "Connect a model to chat…" : "Ask about this reduction…"}
            disabled={disabled}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendChat();
              }
            }}
          />
          {reply.streaming ? (
            <button type="button" className="ai-send is-stop" onClick={reply.cancel} title="Stop">
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <rect x="3" y="3" width="8" height="8" rx="1.5" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              className="ai-send"
              disabled={disabled || !draft.trim()}
              onClick={sendChat}
              title="Send"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M8 13V3M8 3l-4 4M8 3l4 4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
