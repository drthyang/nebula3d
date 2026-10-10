// The conversation surface: a transcript with collapsible model "thinking", the
// tool calls the model made (each a one-line step that opens to its result),
// markdown-rendered answers, a prompt box, and the one-click stage reviews.
// Every request re-sends the compact diagnostic context; stage reviews
// optionally attach the rendered slice image when the vision opt-in is on.
// The reply itself is driven by session.ts, so it outlives this component.

import { useCallback, useEffect, useRef } from "react";

import { COLORMAPS } from "../../colormaps/luts";
import type { Slice } from "../../api/types";
import { BrandGlyph } from "../../components/ui";
import { useNavStore } from "../../state/navStore";
import { toolsKnownUnsupported, type AgentStep } from "../agent";
import { useChatStore } from "../chatStore";
import {
  buildChatMessages,
  buildStageReviewMessages,
  STAGE_REVIEW_LABELS,
  type ReviewStage,
} from "../prompts/templates";
import { renderSliceToDataUrl } from "../render/sliceImage";
import { askAssistant, stopAssistant } from "../session";
import { saveSettings, type LlmSettings } from "../settings";
import { CHAT_TOOLS, type ToolContext } from "../tools";
import { openView } from "../tools/openView";
import type { AssistantContext } from "../useAssistant";
import { Markdown } from "./Markdown";
import { TuneProgress } from "./TuneProgress";

// One-click requests that have the model act: assess the run on the four
// checks that decide whether it can be trusted, or tune it.
const ACTIONS = [
  {
    label: "Assess the run",
    prompt:
      "Assess this reduction on four checks, each with its tool: (1) is the ring removal clean (assess_stage rings, radial_profile); (2) are the Bragg peaks removed cleanly (assess_stage punch); (3) did the punch and backfill add texture to reciprocal space (texture_check); (4) is Qmax inside the data coverage (qmax_coverage). Also report any other stage that misses its goal, such as the flatten floor. Run the pipeline first if outputs are missing.",
  },
  {
    label: "Tune for the best result",
    prompt: "Tune the pipeline for the best result, then process the data with the chosen settings and assess it.",
  },
];

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
    flatten: { slice: ac.slices.flattened, diverging: true, cmap: "RdBu_r" },
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

const TOOL_LABELS: Record<string, string> = {
  describe_dataset: "Read the dataset",
  current_view: "Checked your view",
  measure_reciprocal_cut: "Measured a reciprocal cut",
  measure_dpdf_cut: "Measured a ΔPDF section",
  line_profile: "Took a line profile",
  bragg_peaks: "Looked up Bragg peaks",
  consistency_details: "Read the back-FFT check",
  compare_datasets: "Compared datasets",
  configure_settings: "Read the run settings",
  assess_stage: "Assessed a stage",
  radial_profile: "Took a radial profile",
  texture_check: "Checked for texture",
  qmax_coverage: "Checked Qmax against coverage",
  run_log: "Read the run log",
  update_settings: "Changed settings",
  run_pipeline: "Ran the pipeline",
  tune_pipeline: "Tuned the pipeline",
  show_in_viewer: "Opened the viewer",
};

// Tools long enough to be watched get a present-tense label while they run.
const RUNNING_LABELS: Record<string, string> = {
  run_pipeline: "Running the pipeline",
  tune_pipeline: "Tuning the pipeline",
};

const stepLabel = (s: AgentStep): string =>
  (s.status === "running" ? RUNNING_LABELS[s.name] : undefined) ?? TOOL_LABELS[s.name] ?? s.name;

// The tool calls of one reply: a compact list, each row opening to the
// arguments and the JSON the model read.  A viewer step can be reopened; a
// run or a tuning run opens the Execution page, live while it goes.
function Steps({ steps, live }: { steps: AgentStep[]; live?: boolean }) {
  if (!steps.length) return null;
  const running = steps.find((s) => s.status === "running");
  return (
    <details className="ai-steps" open={live}>
      <summary>
        {running ? `${stepLabel(running)}…` : `Used ${steps.length} tool${steps.length > 1 ? "s" : ""}`}
      </summary>
      <ol className="ai-step-list">
        {steps.map((s) => (
          <li key={s.id} className={`ai-step ai-step-${s.status}`}>
            <details>
              <summary>
                <span className="ai-step-dot" aria-hidden="true" />
                <span className="ai-step-name">{stepLabel(s)}</span>
                {(s.progress ?? s.summary) && <span className="ai-step-summary">{s.progress ?? s.summary}</span>}
              </summary>
              <pre className="ai-step-detail">
                {JSON.stringify(s.args)}
                {s.result ? `\n→ ${s.result}` : ""}
              </pre>
            </details>
            {s.view && (
              <button type="button" className="ai-step-open" onClick={() => openView(s.view!)}>
                Show
              </button>
            )}
            {(s.name === "run_pipeline" || s.name === "tune_pipeline") && (
              <button
                type="button"
                className="ai-step-open"
                onClick={() => useNavStore.getState().setTab("execution")}
                title="Open the Execution page"
              >
                {s.status === "running" ? "Watch" : "Log"}
              </button>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

export function ChatView({
  assistant,
  connected,
  settings,
  toolContext,
  contextLoading = false,
}: {
  assistant: AssistantContext | undefined;
  connected: boolean;
  settings: LlmSettings;
  toolContext: ToolContext | null;
  contextLoading?: boolean;
}) {
  const turns = useChatStore((s) => s.turns);
  const draft = useChatStore((s) => s.draft);
  const busy = useChatStore((s) => s.busy);
  const live = useChatStore((s) => s.live);
  const error = useChatStore((s) => s.error);
  const setDraft = useChatStore((s) => s.setDraft);
  const clearChat = useChatStore((s) => s.clear);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Follow the conversation as it grows, unless the user scrolled up to read.
  const pinned = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [turns, live]);
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  const tools = settings.useTools && !toolsKnownUnsupported(settings);

  const ask = useCallback(
    (text: string) => {
      if (!text || !assistant || busy) return;
      pinned.current = true;
      const history = turns.map(({ role, content }) => ({ role, content }));
      void askAssistant({
        label: text,
        messages: buildChatMessages(assistant.context, history, text, null, { tools }),
        tools: settings.useTools ? CHAT_TOOLS : [],
        ctx: toolContext,
      });
    },
    [assistant, busy, turns, tools, settings.useTools, toolContext],
  );

  const sendChat = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    ask(text);
  }, [draft, setDraft, ask]);

  const runReview = useCallback(
    (stage: ReviewStage) => {
      if (!assistant || busy) return;
      const image = settings.attachImages ? stageImage(stage, assistant) : null;
      pinned.current = true;
      void askAssistant({
        label: STAGE_REVIEW_LABELS[stage] + (image ? " (with image)" : ""),
        messages: buildStageReviewMessages(assistant.context, stage, image, { tools }),
        tools: settings.useTools ? CHAT_TOOLS : [],
        ctx: toolContext,
      });
    },
    [assistant, busy, settings.attachImages, settings.useTools, tools, toolContext],
  );

  const stages: ReviewStage[] = ["rings", "punch", "backfill", "flatten", "dpdf"];
  const disabled = !connected || !assistant;
  const empty = turns.length === 0 && !busy;
  // The tuning store holds one run: its card goes under the reply that started
  // it — the live one while it runs, else the last turn that called it.
  const tunes = (steps?: AgentStep[]) => Boolean(steps?.some((s) => s.name === "tune_pipeline"));
  const liveTunes = busy && tunes(live?.steps);
  const tuneTurn = liveTunes ? null : [...turns].reverse().find((t) => tunes(t.steps))?.id;

  return (
    <div className="ai-chat">
      <div className="ai-transcript" ref={scrollRef} onScroll={onScroll}>
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
                    : "Its stage outputs feed NEBULA Pilot's context."
                  : tools
                    ? "It can run and tune the pipeline while you watch, assess each stage, measure any cut, and open the viewer where it matters — or use a one-click request below."
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
                {t.steps?.length ? <Steps steps={t.steps} /> : null}
                {t.id === tuneTurn && <TuneProgress />}
                {t.content && (
                  <div className="ai-answer">
                    <Markdown text={t.content} />
                  </div>
                )}
                {t.note && <div className="ai-note">{t.note}</div>}
              </div>
            </div>
          ),
        )}
        {busy && live && (
          <div className="ai-msg ai-msg-assistant">
            <span className="ai-avatar ai-avatar-spin" aria-hidden="true">
              <BrandGlyph size={22} />
            </span>
            <div className="ai-msg-main">
              <Thinking text={live.reasoning} live />
              <Steps steps={live.steps} live />
              {liveTunes && <TuneProgress />}
              {live.content ? (
                <div className="ai-answer">
                  <Markdown text={live.content} />
                  <span className="ai-caret" />
                </div>
              ) : !live.reasoning && !live.steps.some((s) => s.status === "running") ? (
                <div className="ai-answer ai-answer-waiting">
                  <span className="ai-caret" />
                </div>
              ) : null}
            </div>
          </div>
        )}
        {error && <div className="ai-conn-alert">{error}</div>}
      </div>

      <div className="ai-dock">
        <div className="ai-reviews">
          {tools &&
            ACTIONS.map((a) => (
              <button
                key={a.label}
                type="button"
                className="ai-chip ai-chip-act"
                disabled={disabled || busy}
                onClick={() => ask(a.prompt)}
                title={disabled ? "Connect a model and select a dataset first" : a.prompt}
              >
                {a.label}
              </button>
            ))}
          {stages.map((s) => (
            <button
              key={s}
              type="button"
              className="ai-chip"
              disabled={disabled || busy}
              onClick={() => runReview(s)}
              title={disabled ? "Connect a model and select a dataset first" : undefined}
            >
              {STAGE_REVIEW_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="ai-toggles">
          <button
            type="button"
            className={`ai-vision-chip${settings.useTools ? " on" : ""}`}
            onClick={() => saveSettings({ useTools: !settings.useTools })}
            aria-pressed={settings.useTools}
            title={
              settings.useTools
                ? "Tools on: the model can measure other cuts, look things up and open the viewer. Needs a tool-capable model."
                : "Tools off: the model answers from the fixed-cut metrics only."
            }
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M10.2 2.3a3.3 3.3 0 0 0-4.1 4.3L2.4 10.3a1.4 1.4 0 0 0 2 2l3.7-3.7a3.3 3.3 0 0 0 4.3-4.1l-2 2-1.7-.4-.4-1.7 1.9-2.1Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
            </svg>
            Tools
          </button>
          {tools && (
            <button
              type="button"
              className={`ai-vision-chip${settings.followViews ? " on" : ""}`}
              onClick={() => saveSettings({ followViews: !settings.followViews })}
              aria-pressed={settings.followViews}
              title={
                settings.followViews
                  ? "Follow on: the console moves to the figure each measurement or assessment looks at."
                  : "Follow off: the console stays put; each step's Show button opens its figure."
              }
            >
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
                <circle cx="8" cy="8" r="1.8" fill="currentColor" />
                <path d="M8 0.8v2.4M8 12.8v2.4M0.8 8h2.4M12.8 8h2.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              Follow
            </button>
          )}
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
              disabled={busy}
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
                sendChat();
              }
            }}
          />
          {busy ? (
            <button type="button" className="ai-send is-stop" onClick={stopAssistant} title="Stop">
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
