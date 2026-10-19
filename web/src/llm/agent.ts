// One assistant reply as an agent loop: stream the model's answer; when it calls
// tools, run them here in the browser, send the results back, and let it carry
// on — within a budget — until it answers in plain text.  A model or server
// that cannot call tools gets the same request without them.  Each request is
// first held to the model's context window (provider/window.ts): a local
// server would cut a longer one without saying so.  A request that fails the
// way a local server's do, a crash, a model unloaded, a server gone quiet, is
// asked again after a pause; what still fails ends the reply with a note that
// says what to do (recovery.ts).

import {
  isMalformedOutput,
  isToolsUnsupported,
  streamChat,
  type ChatMessage,
  type TokenUsage,
  type ToolCall,
} from "./provider/client";
import { answerIssues, issuesNote, issuesPrompt } from "./answerChecks";
import { fillReferences } from "./references";
import { compactResult, isCompacted } from "./compact";
import { lastQuestion, toolsFor } from "./localTools";
import { isLocalUrl } from "./provider/presets";
import { classifyFailure, explainFailure, pause, RETRIES, RETRY_DELAYS_MS, StallError, type Failure } from "./recovery";
import { baseTokens, estimateTokens, observeTokens } from "./provider/tokens";
import { planWindow } from "./provider/window";
import type { LlmSettings } from "./settings";
import { factsOf, runToolCall, toolSpecs, type AgentTool, type ToolContext, type ViewTarget } from "./tools";
import { openView } from "./tools/openView";
import { verdicts, type ComputedVerdict, type Outcome } from "./verdicts";

export interface AgentStep {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  summary?: string;
  progress?: string; // a running tool's live line (run_pipeline: stage, %, log)
  result?: string; // the JSON the model read
  view?: ViewTarget;
  // The checks' outcomes the tool judged (verdicts/), kept beside the result
  // and never in it: the model reads the result alone.
  outcomes?: Outcome[];
}

export interface AgentProgress {
  content: string;
  reasoning: string;
  steps: AgentStep[];
}

export interface AgentResult extends AgentProgress {
  note?: string;
  // Set when the model server failed the reply after its retries; the note
  // explains it, and the steps and text before it stay.
  failure?: Failure;
  // With `usage`: the reply's token counts over all its requests, when the
  // server reported them (null when it did not).
  usage?: (TokenUsage & { requests: number }) | null;
  // The verdict on the run computed from the checks this reply ran
  // (verdicts/): what "achieved" is, which the answer explains. Null when the
  // reply measured nothing it rests on.
  verdict?: ComputedVerdict | null;
}

// Rounds of tool calls before the model is asked to answer with what it has;
// each round may call several tools.  Enough to change a setting, rerun and
// measure a few times over.
export const MAX_TOOL_ROUNDS = 12;

// Servers known (this session) to refuse `tools`, keyed by base URL + model, so
// the next request goes straight to the plain path.
const noTools = new Set<string>();
export const toolsKnownUnsupported = (s: Pick<LlmSettings, "baseUrl" | "model">): boolean =>
  noTools.has(`${s.baseUrl}|${s.model}`);

export const TOOLS_UNSUPPORTED_NOTE =
  "This model cannot call tools, so it answered from the fixed-cut metrics only. Pick a tool-capable model (Ollama and LM Studio mark them) to let it measure other cuts.";

export const CUT_OFF_NOTE =
  "The reply was cut off: the model ran out of room (its context window, or its output limit), so its last step was not run. Load the model with a larger Context Length (48k or more: with Tools on, the first request alone is about 10k tokens, and a full assessment that reads two skills reaches about 46k), or turn Tools off; Clear starts a shorter conversation.";

// A reply its server could not parse ran none of its tools, so the same request
// is sent again, at most this many times in one reply.
export const MALFORMED_RETRIES = 2;

// A server that sends nothing for this long is taken as stuck: before the first
// piece of a reply (loading the model and reading a long prompt on a busy
// machine can take minutes), and between pieces.
export const STALL_MS = { first: 300_000, idle: 120_000 };

// Retries for failures a moment may cure, over the whole reply.
export const MAX_RECOVERIES = 4;

// A call repeated with the same arguments, with nothing changed in between,
// is not run again: the model is pointed at the earlier result. After this
// many rounds in a row that brought nothing new (only repeats and errors),
// the model is asked to answer with what it has.
export const BARREN_ROUNDS = 2;
export const LOOP_NOTE = "The model repeated calls that brought nothing new, so it was asked to answer with what it had.";
const ANSWER_NOW = "The tool calls are bringing nothing new. Answer now from the results above, without calling more tools.";

// A local model's request past this many tokens has its older tool results
// shortened to their readings and numbers (compact.ts), the newest KEEP_FULL
// left whole: it keeps the request inside a 32k window with room to reply, and
// fast. A request no window can hold is shortened down to the newest result
// before it is refused.
export const SOFT_BUDGET = 24_000;
export const KEEP_FULL = 3;

// Calls after which the same reading may differ: those of a tool that acts (its
// facts' `acts`, tools/facts.ts), which change the settings, the files on disk,
// or what the console shows (dpdf_contrast sets the ΔPDF viewer's colour
// limit). One of these runs every time it is called, an identical call
// included: what it set is what the console now shows.
const changesState = (name: string): boolean => factsOf(name).acts !== null;

const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]))
      : v;

// A final answer that fails its checks (answerChecks.ts: a verdict without its
// tool, a number from nowhere, a stage called clean that the tools judged to
// need attention) goes back to the model this many times; what still fails is
// noted under the reply.
export const ANSWER_REVISIONS = 1;
export const REVISING_NOTE = "Checking the answer against its evidence…";

// What an answer's numbers may come from: the conversation as it arrived (the
// system prompt, the context, the user's words), the tool results of this reply
// (whole, though the model may read them shortened) and of earlier turns, and
// the tools' own guidance. No assistant text: an earlier answer's number from
// nowhere would otherwise vouch for the next answer, and this reply's drafts,
// and the notes sent back about them, for themselves.
function numberSources(convo: ChatMessage[], arrived: number, results: readonly string[], tools: AgentTool[], earlier: readonly string[]): string {
  const text = (m: ChatMessage): string =>
    typeof m.content === "string"
      ? m.content
      : Array.isArray(m.content)
        ? m.content.map((part) => (part.type === "text" ? part.text : "")).join("\n")
        : "";
  return [
    ...convo.slice(0, arrived).filter((m) => m.role !== "assistant").map(text),
    ...results,
    ...earlier,
    ...tools.map((t) => t.description),
  ].join("\n");
}

/** The tool results of a conversation's turns, as the model read them: number sources for the next reply. */
export const toolResultsIn = (turns: readonly { steps?: readonly AgentStep[] }[]): string[] =>
  turns.flatMap((t) => (t.steps ?? []).flatMap((s) => (s.status === "done" && s.result ? [s.result] : [])));

const joinText = (a: string, b: string): string => (a && b ? `${a}\n\n${b}` : a || b);

// A call whose arguments are not a JSON object goes back to the model with {}
// (its result says what was wrong): a server that renders the history through
// the model's chat template parses them, and fails the whole request on a
// call cut off mid-way (LM Studio: HTTP 500).
const replayable = (call: ToolCall): ToolCall => {
  try {
    const args: unknown = JSON.parse(call.function.arguments || "{}");
    if (args && typeof args === "object" && !Array.isArray(args)) return call;
  } catch {
    // not JSON at all
  }
  return { ...call, function: { ...call.function, arguments: "{}" } };
};

// A call's arguments as soon as it starts, so the console can show what the
// step works on while it runs (the tool checks them properly).
const startArgs = (call: ToolCall): Record<string, unknown> => {
  try {
    const a = JSON.parse(call.function.arguments || "{}");
    return a && typeof a === "object" && !Array.isArray(a) ? a : {};
  } catch {
    return {};
  }
};

// One call, whatever order its arguments were written in.
const callKey = (call: ToolCall): string => `${call.function.name}|${JSON.stringify(canonical(startArgs(call)))}`;

export async function runAgent({
  messages,
  tools,
  ctx,
  settings,
  signal,
  onProgress,
  maxRounds = MAX_TOOL_ROUNDS,
  usage: wantUsage = false,
  checkAnswers = true,
  stallMs = STALL_MS,
  retryDelaysMs = RETRY_DELAYS_MS,
  softBudget = SOFT_BUDGET,
}: {
  messages: ChatMessage[];
  tools: AgentTool[];
  ctx: ToolContext | null;
  settings: LlmSettings;
  signal: AbortSignal;
  onProgress?: (p: AgentProgress) => void;
  maxRounds?: number;
  usage?: boolean; // count the reply's tokens (the evals)
  checkAnswers?: boolean; // hold a final answer to its evidence (answerChecks.ts); on whenever tools are
  stallMs?: { first: number; idle: number }; // the watchdog's limits (tests shorten them)
  retryDelaysMs?: number[]; // the pauses before each retry
  softBudget?: number; // a local request's tokens past which older results are shortened
}): Promise<AgentResult> {
  const convo = [...messages];
  const arrived = convo.length;
  let revisions = 0;
  let rejected = ""; // the last answer sent back, kept if the revision writes nothing
  // The tools may refresh the dataset (run_pipeline does); keep that to this reply.
  // The skills read so far gate a stage's changes (skills.ts); this reply's
  // reads add to its own copy.
  const toolCtx = ctx && { ...ctx, skillsRead: new Set(ctx.skillsRead ?? []) };
  let useTools = tools.length > 0 && ctx !== null && !toolsKnownUnsupported(settings);
  let content = "";
  let reasoning = "";
  let steps: AgentStep[] = [];
  // Each step's whole result, where the model read it trimmed: the answer
  // checks judge against what the tools found, not against what fit.
  const fullResults = new Map<string, string>();
  let note: string | undefined = tools.length && !useTools && ctx ? TOOLS_UNSUPPORTED_NOTE : undefined;
  const emit = (roundText = "") => onProgress?.({ content: joinText(content, roundText), reasoning, steps });
  const setStep = (id: string, patch: Partial<AgentStep>) => {
    steps = steps.map((s) => (s.id === id ? { ...s, ...patch } : s));
    emit();
  };

  let retries = 0;
  let attempts = 0; // retries of the current request
  let recoveries = 0; // retries over the reply
  let failure: Failure | undefined;
  // The calls that ran since the state last changed, by key → their step number.
  const called = new Map<string, number>();
  // This reply's tool results in the conversation, oldest first: where each
  // sits and which call made it.
  const results: { index: number; key: string }[] = [];
  // Shorten all but the newest `keep` results; a shortened call may run again.
  const compactOlder = (keep: number): boolean => {
    let changed = false;
    for (const r of results.slice(0, Math.max(0, results.length - keep))) {
      const m = convo[r.index];
      if (typeof m.content !== "string" || isCompacted(m.content)) continue;
      const short = compactResult(m.content);
      if (short === m.content) continue;
      convo[r.index] = { ...m, content: short };
      called.delete(r.key);
      changed = true;
    }
    return changed;
  };
  const windowKey = `${settings.baseUrl}|${settings.model}`;
  // A local model is offered the reading tools and those its question is
  // about (localTools.ts); one it calls by name all the same runs, and joins.
  let offered = isLocalUrl(settings.baseUrl) ? toolsFor(lastQuestion(messages), tools) : tools;
  const offer = (name: string) => {
    const tool = tools.find((t) => t.name === name);
    if (tool && !offered.includes(tool)) offered = tools.filter((t) => offered.includes(t) || t === tool);
  };
  let barren = 0; // rounds in a row that brought nothing new
  let answerNow = false; // asked to answer without calling more tools
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 }; // over the requests that reported them
  let requests = 0;
  for (let round = 0; ; round++) {
    const last = round >= maxRounds;
    let roundText = "";
    let calls: ToolCall[] = [];
    let native: unknown;
    let cutOff = false;
    const reasoningBefore = reasoning;
    const specs = useTools ? toolSpecs(offered) : undefined;
    if (isLocalUrl(settings.baseUrl) && estimateTokens(baseTokens(convo, specs), windowKey) > softBudget) compactOlder(KEEP_FULL);
    // The request's own controller: the reply's Stop ends it, and so does the
    // watchdog when the server goes quiet.
    const request = new AbortController();
    const stopRequest = () => request.abort();
    signal.addEventListener("abort", stopRequest, { once: true });
    let stalled = false;
    let heard = false; // a piece of the reply arrived
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const watch = (ms: number) => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        stalled = true;
        request.abort();
      }, ms);
    };
    watch(stallMs.first);
    try {
      // A request the model's window cannot hold is shortened to its newest
      // result, and if that is not enough, not sent: the reply says why.
      const planned = () => planWindow({ baseUrl: settings.baseUrl, model: settings.model, messages: convo, tools: specs, signal: request.signal });
      let plan = await planned();
      if (plan.refusal && compactOlder(1)) plan = await planned();
      if (plan.refusal) {
        note = note ? `${note} ${plan.refusal}` : plan.refusal;
        break;
      }
      for await (const delta of streamChat({
        baseUrl: settings.baseUrl,
        model: settings.model,
        messages: convo,
        temperature: settings.temperature,
        apiKey: settings.apiKey || undefined,
        signal: request.signal,
        tools: specs,
        toolChoice: useTools && (last || answerNow) ? "none" : undefined,
        // A local server's counts calibrate the token estimate.
        includeUsage: wantUsage || isLocalUrl(settings.baseUrl),
        numCtx: plan.numCtx,
      })) {
        heard = true;
        watch(stallMs.idle);
        if (delta.usage) {
          observeTokens(plan.key, plan.base, delta.usage.input);
          tokens.input += delta.usage.input;
          tokens.output += delta.usage.output;
          tokens.cacheRead += delta.usage.cacheRead ?? 0;
          tokens.cacheWrite += delta.usage.cacheWrite ?? 0;
          tokens.requests += 1;
        }
        if (delta.content) roundText += delta.content;
        if (delta.reasoning) reasoning += delta.reasoning;
        if (delta.toolCalls) calls = delta.toolCalls;
        if (delta.native) native = delta.native;
        if (delta.truncated) cutOff = true;
        emit(roundText);
      }
      requests += 1;
      attempts = 0;
    } catch (e) {
      if (signal.aborted) throw e; // the reply was stopped
      if (useTools && round === 0 && !roundText && isToolsUnsupported(e)) {
        noTools.add(`${settings.baseUrl}|${settings.model}`);
        useTools = false;
        note = TOOLS_UNSUPPORTED_NOTE;
        round = -1; // the same request again, without tools
        continue;
      }
      if (isMalformedOutput(e) && retries < MALFORMED_RETRIES) {
        retries += 1;
        reasoning = reasoningBefore; // the failed attempt's thinking goes with it
        round -= 1; // the same request again
        emit();
        continue;
      }
      const kind = classifyFailure(e, stalled);
      if (attempts < (RETRIES[kind] ?? 0) && recoveries < MAX_RECOVERIES) {
        await pause(retryDelaysMs[Math.min(attempts, retryDelaysMs.length - 1)] ?? 0, signal);
        attempts += 1;
        recoveries += 1;
        reasoning = reasoningBefore;
        round -= 1; // the same request again
        emit();
        continue;
      }
      // What still fails ends the reply, with what was written and what ran.
      const message = stalled
        ? new StallError(Math.round((heard ? stallMs.idle : stallMs.first) / 1000)).message
        : ((e as Error)?.message ?? String(e));
      failure = { kind, message, attempts: attempts + 1 };
      content = joinText(content, roundText);
      note = note ? `${note} ${explainFailure(failure, steps.length > 0)}` : explainFailure(failure, steps.length > 0);
      break;
    } finally {
      clearTimeout(watchdog);
      signal.removeEventListener("abort", stopRequest);
    }
    const before = content;
    content = joinText(content, roundText);

    // A reply that ran out of room may end mid-call: never run that round's tools.
    if (cutOff) {
      note = CUT_OFF_NOTE;
      break;
    }
    if (!calls.length || !useTools) {
      // The final answer: held to its evidence before the user reads it. A
      // revision that wrote nothing leaves the answer it revised.
      const answer = roundText.trim() ? roundText : rejected;
      const checked = steps.map((st) => (fullResults.has(st.id) ? { ...st, result: fullResults.get(st.id) } : st));
      const sources = numberSources(convo, arrived, checked.map((st) => st.result ?? ""), tools, ctx?.earlierResults ?? []);
      const issues = useTools && checkAnswers ? answerIssues(answer, checked, sources) : null;
      if (issues && roundText.trim() && revisions < ANSWER_REVISIONS && round + 1 < maxRounds && !signal.aborted) {
        revisions += 1;
        rejected = roundText;
        content = before;
        convo.push({ role: "assistant", content: roundText });
        // The tools the fix asks for are offered.
        for (const t of [...issues.missing, ...issues.stale]) tools.forEach((tool) => t.evidence.includes(tool.name) && offer(tool.name));
        convo.push({ role: "user", content: issuesPrompt(issues) });
        emit(`_${REVISING_NOTE}_`);
        continue;
      }
      if (!roundText.trim() && rejected) content = joinText(before, rejected);
      if (issues) note = note ? `${note} ${issuesNote(issues)}` : issuesNote(issues);
      break;
    }
    if (last) {
      note = `Stopped after ${maxRounds} rounds of tool calls; the answer uses what was gathered so far.`;
      break;
    }
    if (answerNow) break; // asked to answer, it called again: what it has stands

    convo.push({ role: "assistant", content: roundText, tool_calls: calls.map(replayable), ...(native ? { native } : {}) });
    let fresh = 0; // calls this round that brought a new result
    for (const call of calls) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const id = `${steps.length}:${call.id}`; // servers may reuse call ids across rounds
      const key = callKey(call);
      const earlier = called.get(key);
      if (earlier !== undefined) {
        // The same reading again: point the model at the one it has.
        const text = JSON.stringify({
          already_called: `Called with these arguments earlier in this reply (step ${earlier}); its result is above. Use it, or call with other arguments.`,
        });
        steps = [...steps, { id, name: call.function.name, args: startArgs(call), status: "done", summary: `same call as step ${earlier}: not run again`, result: text }];
        emit();
        convo.push({ role: "tool", tool_call_id: call.id, content: text });
        continue;
      }
      steps = [...steps, { id, name: call.function.name, args: startArgs(call), status: "running" }];
      emit();
      const run = await runToolCall(call, tools, toolCtx!, {
        signal,
        progress: (progress) => setStep(id, { progress }),
      });
      setStep(id, {
        progress: undefined,
        args: run.args,
        status: run.ok ? "done" : "error",
        summary: run.summary,
        result: run.text,
        view: run.view,
        outcomes: run.outcomes,
      });
      if (run.full) fullResults.set(id, run.full);
      if (run.ok) {
        offer(call.function.name);
        fresh += 1;
        if (changesState(call.function.name)) called.clear();
        else called.set(key, steps.length);
      }
      // The console follows what the model looked at, step by step.
      if (run.ok && run.view && settings.followViews) openView(run.view);
      results.push({ index: convo.length, key });
      convo.push({ role: "tool", tool_call_id: call.id, content: run.text });
    }
    barren = fresh ? 0 : barren + 1;
    if (barren >= BARREN_ROUNDS && !answerNow) {
      answerNow = true;
      note = note ? `${note} ${LOOP_NOTE}` : LOOP_NOTE;
      convo.push({ role: "user", content: ANSWER_NOW });
    }
  }

  // A server that reported some requests' counts but not all leaves the total unknown.
  const usage = wantUsage ? (tokens.requests > 0 && tokens.requests === requests ? tokens : null) : undefined;
  // Numbers by reference: the words the user reads have each {{tool.field}}
  // filled in from the result (whole, as the tools found it); and the verdict
  // on the run is computed from the checks, never taken from the words.
  const measured = steps.map((st) => (fullResults.has(st.id) ? { ...st, result: fullResults.get(st.id) } : st));
  content = fillReferences(content, measured).text;
  const verdict = useTools ? verdicts({ reply: measured }).achieved : null;
  return {
    content,
    reasoning,
    steps,
    note,
    ...(failure ? { failure } : {}),
    ...(wantUsage ? { usage } : {}),
    ...(verdict ? { verdict } : {}),
  };
}
