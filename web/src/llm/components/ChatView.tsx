// The conversation surface: a transcript with collapsible model "thinking", the
// tool calls the model made (each a one-line step that opens to its result),
// markdown-rendered answers, a prompt box, and the one-click stage reviews.
// Every request re-sends the opening context (with tools, the dataset's
// summary; without, one cut's metrics); stage reviews optionally attach the
// rendered slice image when the vision opt-in is on.
// The reply itself is driven by session.ts, so it outlives this component.

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDatasets } from "../../api/hooks";
import { BrandGlyph } from "../../components/ui";
import { useDatasetStore } from "../../state/datasetStore";
import { useNavStore } from "../../state/navStore";
import { toolsKnownUnsupported, type AgentStep } from "../agent";
import { untoldDecisions, useDecisionStore } from "../apply/decisions";
import { sinceLine } from "../apply/since";
import { useChatStore, type ChatTurn } from "../chatStore";
import { buildChatMessages } from "../prompts/templates";
import { seen } from "../readings";
import { askAssistant, clearConversation, replyContext, stopAssistant } from "../session";
import { saveSettings, type LlmSettings } from "../settings";
import { CHAT_TOOLS, factsOf, type ToolContext } from "../tools";
import { openView } from "../tools/openView";
import { drawsOverlays } from "../examine/overlays";
import { showStep, useExamineStore, useHasSet } from "../examine/store";
import type { AssistantContext } from "../useAssistant";
import { reportable } from "../report/collect";
import { formatDuration } from "../clock";
import { useAutoStore } from "../auto/store";
import { autoTranscript, isSeeded, type AutoBlock } from "../auto/transcript";
import { AutoChip, AutoPanel } from "./AutoPanel";
import { Markdown } from "./Markdown";
import { ProposalCards } from "./ProposalCards";
import { ReportView } from "./ReportView";
import { TuneProgress } from "./TuneProgress";
import { uncountedText, usageText } from "../usage";
import { verdictLine } from "../verdict";

// A token count in a few characters: 950, 12.3k, 1.2M.
const compactTokens = (n: number): string =>
  n < 1000 ? String(n) : n < 1e6 ? `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k` : `${(n / 1e6).toFixed(1)}M`;

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

// A step's line in the transcript: its tool's label (tools/facts.ts), and its
// running label while it runs (a run's or a tuning run's is in the present
// tense: they are long enough to be watched).
const stepLabel = (s: AgentStep): string => {
  const facts = factsOf(s.name);
  if (s.status === "stopped") return `${facts.runningLabel} (stopped)`;
  return s.status === "running" ? facts.runningLabel : facts.label;
};

// One step's row, opening to its arguments and the result the model read. The
// result (often kilobytes of JSON) is put on the page only while it is open: a
// long conversation would otherwise carry megabytes of hidden text that every
// layout of the transcript walks.
function StepDetail({ step: s, auto = false }: { step: AgentStep; auto?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span className="ai-step-dot" aria-hidden="true" />
        {auto && (
          <span className="auto-tag" title="Auto mode ran this itself">
            auto
          </span>
        )}
        <span className="ai-step-name">{stepLabel(s)}</span>
        {(s.progress ?? s.summary) && <span className="ai-step-summary">{s.progress ?? s.summary}</span>}
      </summary>
      {open && (
        <pre className="ai-step-detail">
          {JSON.stringify(s.args)}
          {seen(s) ? `\n→ ${seen(s)}` : ""}
        </pre>
      )}
    </details>
  );
}

// A step whose overlays the views keep (the Highlights): a swatch on its row.
function HighlightSwatch({ step }: { step: AgentStep }) {
  const has = useHasSet(step);
  return has ? <span className="hl-swatch" title="Its highlights are on the cleanup page's views" aria-label="Has highlights" /> : null;
}

// The tool calls of one reply: a compact list, each row opening to the
// arguments and the JSON the model read.  A viewer step can be reopened (with
// its highlights, examine/); a run or a tuning run opens the Execution page,
// live while it goes. A block of an auto run's own steps (`block`, with each
// step's number in the run) lists them the same way, tagged auto, as are the
// checks an auto run seeded into a reply.
function Steps({ steps, live, turn, block }: { steps: AgentStep[]; live?: boolean; turn?: number; block?: { numberOf: (s: AgentStep) => number } }) {
  const datasets = useDatasets().data;
  const datasetId = useDatasetStore((s) => s.datasetId);
  if (!steps.length) return null;
  const show = (s: AgentStep, i: number) => {
    openView(s.view!);
    if (block && drawsOverlays(s.name)) showStep(s, null, block.numberOf(s), datasets?.find((d) => d.id === datasetId));
    else if (turn !== undefined && drawsOverlays(s.name)) showStep(s, turn, i + 1, datasets?.find((d) => d.id === datasetId));
    else if (live) {
      const kept = useExamineStore.getState().sets.find((x) => x.set.stepId === s.id && x.turn === null);
      if (kept) useExamineStore.setState({ current: kept.set.key, off: [] });
    }
  };
  const running = steps.find((s) => s.status === "running");
  return (
    <details className="ai-steps" open={live}>
      <summary>
        {running ? `${stepLabel(running)}…` : block ? `Auto analysis · ${steps.length} step${steps.length > 1 ? "s" : ""}` : `Used ${steps.length} tool${steps.length > 1 ? "s" : ""}`}
      </summary>
      <ol className="ai-step-list">
        {steps.map((s, i) => (
          <li
            key={s.id}
            id={block ? `ai-step-auto-${s.id}` : turn !== undefined ? `ai-step-${turn}-${s.id}` : live ? `ai-step-live-${s.id}` : undefined}
            className={`ai-step ai-step-${s.status}`}
          >
            <StepDetail step={s} auto={Boolean(block) || isSeeded(s)} />
            <HighlightSwatch step={s} />
            {s.view && (
              <button type="button" className="ai-step-open" onClick={() => show(s, i)}>
                Show
              </button>
            )}
            {factsOf(s.name).startsRuns && (
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

// A block of an auto run's own checks and runs, where the transcript shows
// them (auto/transcript.ts): before the reply they led to, or after the last.
function AutoSteps({ block, live }: { block: AutoBlock; live: boolean }) {
  const steps = useAutoStore((s) => s.run?.steps);
  const numberOf = (x: AgentStep) => (steps?.findIndex((y) => y.id === x.id) ?? -1) + 1 || (steps?.length ?? 0) + 1;
  return (
    <div className="ai-msg ai-msg-assistant ai-msg-auto">
      <span className={`ai-avatar${live ? " ai-avatar-spin" : ""}`} aria-hidden="true">
        <BrandGlyph size={22} />
      </span>
      <div className="ai-msg-main">
        <Steps steps={block.steps} live={live} block={{ numberOf }} />
      </div>
    </div>
  );
}

/** An auto run's blocks among the turns, with the app's step under way at the end while it runs. */
function useAutoBlocks(turns: readonly ChatTurn[]) {
  const run = useAutoStore((s) => s.run);
  const live = useAutoStore((s) => s.live);
  return useMemo(() => {
    if (!run) return { blocks: [] as AutoBlock[], running: false };
    const { blocks } = autoTranscript(run, turns);
    const running = run.state === "running" && live?.status === "running" && live.id.startsWith(`auto:${run.id}:`);
    if (running) {
      const end = blocks.find((b) => b.before === null);
      if (end) end.steps = [...end.steps, live!];
      else blocks.push({ key: `${run.id}:end`, before: null, after: [...run.turns].reverse().find((t) => turns.some((x) => x.id === t)) ?? null, steps: [live!] });
    }
    return { blocks, running };
  }, [run, live, turns]);
}

// The Highlights switch: off hides the overlays on the views, keeps the "Now examining" bar.
function HighlightsChip() {
  const on = useExamineStore((s) => s.enabled);
  const setEnabled = useExamineStore((s) => s.setEnabled);
  return (
    <button
      type="button"
      className={`ai-vision-chip${on ? " on" : ""}`}
      onClick={() => setEnabled(!on)}
      aria-pressed={on}
      title={
        on
          ? "Highlights on: the views show what each check measured, where it measured it."
          : "Highlights off: the views show the data alone; the bar still names each check."
      }
    >
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2" y="2" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2.4 1.6" />
        <circle cx="8" cy="8" r="2.2" fill="currentColor" />
      </svg>
      Highlights
    </button>
  );
}

// One finished turn of the transcript. A turn never changes once added, so it
// renders once: without this, every streamed piece of a reply re-rendered (and
// re-parsed the markdown of) every earlier turn, and a long conversation froze
// the page while the model wrote.
const PastTurn = memo(function PastTurn({
  turn: t,
  tuning,
  canReport,
  onReport,
  ctx,
}: {
  turn: ChatTurn;
  tuning: boolean; // the tuning run's card goes under this turn
  canReport: boolean;
  onReport: (id: number) => void;
  ctx: ToolContext | null; // what the Apply cards act on
}) {
  if (t.role === "user") {
    return (
      <div className="ai-msg ai-msg-user">
        <div className="ai-user-bubble">{t.content}</div>
      </div>
    );
  }
  return (
    <div className="ai-msg ai-msg-assistant" id={`ai-turn-${t.id}`}>
      <span className="ai-avatar" aria-hidden="true">
        <BrandGlyph size={22} />
      </span>
      <div className="ai-msg-main">
        {t.reasoning ? <Thinking text={t.reasoning} /> : null}
        {t.steps?.length ? <Steps steps={t.steps} turn={t.id} /> : null}
        {tuning && <TuneProgress turn={t.id} ctx={ctx} />}
        {t.content && (
          <div className="ai-answer">
            <Markdown text={t.content} />
          </div>
        )}
        <ProposalCards turn={t.id} ctx={ctx} />
        {verdictLine(t.verdict) && (
          <div
            className={`ai-verdict ai-verdict-${t.verdict!.achieved === true ? "met" : t.verdict!.achieved === false ? "not-met" : "open"}`}
            title="Computed from the checks this reply ran, by the report's rules; the model's words explain it"
          >
            {verdictLine(t.verdict)}
          </div>
        )}
        {t.note && <div className="ai-note">{t.note}</div>}
        {(t.ms !== undefined || usageText(t.tokens)) && (
          <div className="ai-usage">
            {[t.ms !== undefined ? `Took ${formatDuration(t.ms)}` : null, usageText(t.tokens)].filter(Boolean).join(" · ")}
          </div>
        )}
        {canReport && (
          <button
            type="button"
            className="ai-report-btn"
            onClick={() => onReport(t.id)}
            title="Measure the reduction again and open a report you can read and export (HTML, Markdown, PDF)"
          >
            Report
          </button>
        )}
      </div>
    </div>
  );
});

export function ChatView({
  assistant,
  connected,
  settings,
  toolContext,
  contextLoading = false,
  contextNote = null,
}: {
  assistant: AssistantContext | undefined;
  connected: boolean;
  settings: LlmSettings;
  toolContext: ToolContext | null;
  contextLoading?: boolean;
  // Why replies may be cut off: the model's context is too small for Tools.
  contextNote?: string | null;
}) {
  const turns = useChatStore((s) => s.turns);
  const draft = useChatStore((s) => s.draft);
  const busy = useChatStore((s) => s.busy);
  const live = useChatStore((s) => s.live);
  const error = useChatStore((s) => s.error);
  const setDraft = useChatStore((s) => s.setDraft);
  const usage = useChatStore((s) => s.usage);
  // An auto run under way owns the conversation: the composer waits (auto/controller.ts).
  const autoRunning = useAutoStore((s) => s.run?.state === "running");
  const auto = useAutoBlocks(turns);
  const scrollRef = useRef<HTMLDivElement>(null);
  // The reply whose analysis report is open (its turn id).
  const [reportFor, setReportFor] = useState<number | null>(null);

  // Follow the conversation as it grows, unless the user scrolled up to read.
  const pinned = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [turns, live, auto]);
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  const tools = settings.useTools && !toolsKnownUnsupported(settings);

  const ask = useCallback(
    (text: string) => {
      if (!text || !assistant || busy || autoRunning) return;
      pinned.current = true;
      const history = turns.map(({ role, content }) => ({ role, content }));
      // What the user's decisions on the cards changed since the last reply
      // (apply/since.ts): in this reply's context alone, marked as told once
      // the reply has come back (session.ts).
      const untold = untoldDecisions();
      const since = sinceLine(untold.decisions, useDecisionStore.getState().proposals);
      void askAssistant({
        label: text,
        messages: buildChatMessages(assistant.context, history, text, null, { tools, since }),
        ...(since ? { told: untold.through } : {}),
        tools: settings.useTools ? CHAT_TOOLS : [],
        // The earlier turns go as their text: a skill read in one is not in
        // this reply, so it opens no gate here, and the refusal asks for it again.
        ctx: toolContext && replyContext(toolContext, turns),
      });
    },
    [assistant, busy, autoRunning, turns, tools, settings.useTools, toolContext],
  );

  const sendChat = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    ask(text);
  }, [draft, setDraft, ask]);

  const disabled = !connected || !assistant || autoRunning;
  const empty = turns.length === 0 && !busy && auto.blocks.length === 0;
  // The tuning store holds one run: its card goes under the reply that started
  // it — the live one while it runs, else the last turn that called it.
  const tunes = (steps?: AgentStep[]) => Boolean(steps?.some((s) => s.name === "tune_pipeline"));
  const liveTunes = busy && tunes(live?.steps);
  const tuneTurn = liveTunes ? null : [...turns].reverse().find((t) => tunes(t.steps))?.id;

  return (
    <div className="ai-chat">
      {reportFor != null && toolContext && (() => {
        const i = turns.findIndex((x) => x.id === reportFor);
        const turn = turns[i];
        if (!turn) return null;
        const question = [...turns.slice(0, i)].reverse().find((x) => x.role === "user")?.content ?? "";
        return (
          <ReportView
            dataset={toolContext.dataset}
            datasets={toolContext.datasets}
            turn={turn}
            question={question}
            settings={settings}
            onClose={() => setReportFor(null)}
          />
        );
      })()}
      {tools && <AutoPanel ctx={toolContext} />}
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
        {turns.map((t) => (
          <Fragment key={t.id}>
            {auto.blocks.filter((b) => b.before === t.id).map((b) => (
              <AutoSteps key={b.key} block={b} live={false} />
            ))}
            <PastTurn
              turn={t}
              tuning={t.id === tuneTurn}
              canReport={reportable(t) && Boolean(toolContext) && !busy}
              onReport={setReportFor}
              ctx={toolContext}
            />
            {auto.blocks.filter((b) => b.before === null && b.after === t.id).map((b) => (
              <AutoSteps key={b.key} block={b} live={auto.running} />
            ))}
          </Fragment>
        ))}
        {auto.blocks.filter((b) => b.before === null && (b.after === null || !turns.some((t) => t.id === b.after))).map((b) => (
          <AutoSteps key={b.key} block={b} live={auto.running} />
        ))}
        {busy && live && (
          <div className="ai-msg ai-msg-assistant">
            <span className="ai-avatar ai-avatar-spin" aria-hidden="true">
              <BrandGlyph size={22} />
            </span>
            <div className="ai-msg-main">
              <Thinking text={live.reasoning} live />
              <Steps steps={live.steps} live />
              {liveTunes && <TuneProgress turn={null} ctx={toolContext} />}
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
        {connected && contextNote && <div className="ai-conn-warn">{contextNote}</div>}
        {tools && <AutoChip ctx={toolContext} canStart={connected && Boolean(assistant) && !busy} />}
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
          {tools && <HighlightsChip />}
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
          {usage && (usage.requests > 0 || !!usage.uncounted) && (
            <span className="ai-usage-total" title={`This conversation's model requests: ${usageText(usage)}`}>
              {usage.requests > 0 && `${usage.estimated ? "≈ " : ""}${compactTokens(usage.input + usage.output)} tokens`}
              {usage.requests > 0 ? (usage.uncounted ? ` ${uncountedText(usage)}` : "") : uncountedText(usage).slice(1)}
            </span>
          )}
          {turns.length > 0 && (
            <button
              type="button"
              className="ai-clear"
              onClick={clearConversation}
              disabled={busy}
              title="Clear the conversation and the regions it marked"
            >
              Clear
            </button>
          )}
        </div>

        <div className={`ai-composer${disabled ? " is-disabled" : ""}`}>
          <textarea
            value={draft}
            placeholder={autoRunning ? "Auto analysis is running…" : disabled ? "Connect a model to chat…" : "Ask about this reduction…"}
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
