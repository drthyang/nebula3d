// One assistant reply as an agent loop: stream the model's answer; when it calls
// tools, run them here in the browser, send the results back, and let it carry
// on — within a budget — until it answers in plain text.  The executor runs
// each round of calls over the reply's history (tools/round.ts); the loop
// keeps the requests and what it says to the model.  A model or server
// that cannot call tools gets the same request without them.  Each request is
// first held to the model's context window (provider/window.ts): a local
// server would cut a longer one without saying so.  A request that fails the
// way a local server's do, a crash, a model unloaded, a server gone quiet, is
// asked again after a pause; what still fails ends the reply with a note that
// says what to do (recovery.ts). What the loop runs under, transport by
// transport (its round limit, the tools a model is offered, when results are
// shortened, the temperature and output cap it sends), is the run policy's
// (runPolicy.ts): the app's own for its settings, or a validation run's.

import {
  isMalformedOutput,
  isToolsUnsupported,
  isUsageUnsupported,
  refuseUsage,
  streamChat,
  usageRefused,
  type ChatMessage,
  type TokenUsage,
  type ToolCall,
} from "./provider/client";
import { answerIssues, earlierSources, issuesNote, issuesPrompt } from "./answerChecks";
import { fillReferences } from "./references";
import { lastQuestion, toolsFor } from "./localTools";
import { classifyFailure, explainFailure, pause, RETRIES, RETRY_DELAYS_MS, STALL_MS, StallError, type Failure } from "./recovery";
import { baseTokens, DATA_CHARS_PER_TOKEN, estimateTokens, observeTokens, PROSE_CHARS_PER_TOKEN } from "./provider/tokens";
import { planWindow } from "./provider/window";
import { seen, shorten, whole } from "./readings";
import { runPolicyOf, type RunPolicy } from "./runPolicy";
import { estimated, measured, notCounted, ranNothing, type Usage } from "./usage";
import type { LlmSettings } from "./settings";
import { skillsOn } from "./skills";
import {
  forget,
  runRound,
  startReply,
  toolSpecs,
  type AgentTool,
  type CallKey,
  type History,
  type ToolContext,
  type ViewTarget,
} from "./tools";
import { openView } from "./tools/openView";
import { verdicts, type ComputedVerdict, type Outcome } from "./verdicts";

export interface AgentStep {
  id: string;
  name: string;
  args: Record<string, unknown>;
  // "stopped": it was running when the reply ended (Stop, or an error), so
  // it never finished; set by session.ts, never while the reply runs.
  status: "running" | "done" | "error" | "stopped";
  summary?: string;
  progress?: string; // a running tool's live line (run_pipeline: stage, %, log)
  // The result's two readings (readings/): what the model read when the call
  // returned, byte for byte as it was sent (`seen`), and, only where the model
  // read it fitted, the whole result the tool found (`whole`, `found`).
  result?: string;
  full?: string;
  // The loop later shortened the model's copy, in the conversation, to save
  // room (compaction): `result` stays what was sent.
  shortened?: true;
  view?: ViewTarget;
  // The checks' outcomes the tool judged (verdicts/), kept beside the result
  // and never in it: the model reads the result alone.
  outcomes?: Outcome[];
  // Brought back from a saved session file (state/session.ts): shown, but
  // never taken as evidence for a later reply's numbers (toolStepsIn), since
  // the file could say anything.
  restored?: true;
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

// The loop's round limit and compaction budget are the run policy's
// (runPolicy.ts), under the names the loop has always given them.
export { KEEP_FULL, MAX_TOOL_ROUNDS, SOFT_BUDGET } from "./runPolicy";

// Servers known (this session) to refuse `tools`, keyed by base URL + model, so
// the next request goes straight to the plain path.
const noTools = new Set<string>();
export const toolsKnownUnsupported = (s: Pick<LlmSettings, "baseUrl" | "model">): boolean =>
  noTools.has(`${s.baseUrl}|${s.model}`);

/** Forget the servers found to refuse tools: each is offered them again (a validation run starts so, evals/validationRun.ts). */
export const forgetToolsUnsupported = (): void => noTools.clear();

export const TOOLS_UNSUPPORTED_NOTE =
  "This model cannot call tools, so it answered from the fixed-cut metrics only. Pick a tool-capable model (Ollama and LM Studio mark them) to let it measure other cuts.";

export const CUT_OFF_NOTE =
  "The reply was cut off: the model ran out of room (its context window, or its output limit), so its last step was not run. Load the model with a larger Context Length (56k or more: with Tools on, the first request alone is about 10k tokens, and a full assessment that reads two skills reaches about 48k), or turn Tools off; Clear starts a shorter conversation.";

// A reply its server could not parse ran none of its tools, so the same request
// is sent again, at most this many times in one reply.
export const MALFORMED_RETRIES = 2;

// A server that sends nothing for this long is taken as stuck (recovery.ts).
export { STALL_MS };

// Retries for failures a moment may cure, over the whole reply.
export const MAX_RECOVERIES = 4;

// A round of calls that repeat earlier ones or fail brings nothing new; after
// BARREN_ROUNDS of them in a row the executor's round is stuck
// (tools/round.ts), and the model is asked to answer with what it has.
export const LOOP_NOTE = "The model repeated calls that brought nothing new, so it was asked to answer with what it had.";
const ANSWER_NOW = "The tool calls are bringing nothing new. Answer now from the results above, without calling more tools.";

// A final answer that fails its checks (answerChecks.ts: a verdict without its
// tool, a number from nowhere, a stage called clean that the tools judged to
// need attention) goes back to the model this many times; what still fails is
// noted under the reply. An answer that arrives with no round of calls to
// spare goes back all the same, as the reply's last request, which offers no
// tools: the send-back then asks for the claim to be left out, or said to be
// unmeasured, instead of a call (issuesPrompt's `final`). Before THY-63 R3 it
// was only noted, and a model that used every round but one kept a verdict,
// or a list of results, no tool had returned.
export const ANSWER_REVISIONS = 1;
export const REVISING_NOTE = "Checking the answer against its evidence…";

// What an answer's numbers may come from: the conversation as it arrived (the
// system prompt, the context, the user's words), the tool results of this
// reply (whole, though the model may read them fitted or shortened) and of
// earlier turns while what they measured stands (earlierSources), and the
// tools' own guidance. No assistant text: an earlier answer's number from
// nowhere would otherwise vouch for the next answer, and this reply's drafts,
// and the notes sent back about them, for themselves.
function numberSources(convo: ChatMessage[], arrived: number, results: readonly string[], tools: readonly AgentTool[], earlier: readonly string[]): string {
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

/**
 * The tool calls of a conversation's turns that ran, oldest first, as the
 * transcript keeps them: the next reply's number sources, each result as the
 * model read it (`seen`) while what it measured stands (earlierSources). Not
 * those restored from a session file.
 */
export const toolStepsIn = (turns: readonly { steps?: readonly AgentStep[] }[]): AgentStep[] =>
  turns.flatMap((t) => (t.steps ?? []).filter((s) => s.status === "done" && !s.restored && seen(s)));

const joinText = (a: string, b: string): string => (a && b ? `${a}\n\n${b}` : a || b);

export async function runAgent({
  messages,
  tools: given,
  ctx,
  settings,
  policy = runPolicyOf(settings),
  signal,
  onProgress,
  maxRounds = policy.maxRounds,
  usage: wantUsage = false,
  checkAnswers = true,
  stallMs = STALL_MS,
  retryDelaysMs = RETRY_DELAYS_MS,
  softBudget = policy.pruning?.softBudget,
  onTruncated,
  onUsage,
}: {
  messages: ChatMessage[];
  tools: AgentTool[];
  ctx: ToolContext | null;
  settings: LlmSettings;
  // What the reply runs under (runPolicy.ts): the app's for its settings
  // unless given (a validation run gives its own, validationRun.ts).
  policy?: RunPolicy;
  signal: AbortSignal;
  onProgress?: (p: AgentProgress) => void;
  maxRounds?: number; // the policy's unless given (tests)
  usage?: boolean; // count the reply's tokens (the evals)
  checkAnswers?: boolean; // hold a final answer to its evidence (answerChecks.ts); on whenever tools are
  stallMs?: { first: number; idle: number }; // the watchdog's limits (tests shorten them)
  retryDelaysMs?: number[]; // the pauses before each retry
  softBudget?: number; // the tokens past which a pruned request's older results are shortened: the policy's unless given (tests)
  // Each request whose reply stopped at its output limit (stoppedAtLimit,
  // provider/client.ts): its number, 1-based over every request the loop
  // sent, retries included, and the server's stop reason (a validation run's
  // record keeps them, validationRun.ts).
  onTruncated?: (cut: { request: number; reason: string }) => void;
  onUsage?: (u: Usage) => void; // each completed request's tokens, measured or estimated, and each one sent that did not complete (usage.ts)
}): Promise<AgentResult> {
  // The reply's history, which the executor runs each round of calls over
  // (tools/round.ts): the tools the reply offers, runs and checks answers
  // against are the given ones under the skills' switch (skills.ts), as the
  // conversation's context carries it (with the skills off, no read_skill);
  // the tool context is the reply's own copy, so a run's fresh dataset and
  // the skills read stay this reply's, and a skill counts as read from the
  // start only if its text is in the messages. It carries the user's latest
  // message, as the conversation arrived: what the loop later sends as the
  // user (a send-back, the note to answer now) is not the user's, and names
  // no fact about the sample to update_settings. Without a context no tool
  // runs, and the tools are the given ones.
  let history: History | null = ctx && startReply({ ...ctx, userMessage: lastQuestion(messages) }, given, messages);
  const tools = history ? history.tools : given;
  const convo = [...messages];
  const arrived = convo.length;
  let revisions = 0;
  let rejected = ""; // the last answer sent back, kept if the revision writes nothing
  let rejectedIssues: ReturnType<typeof answerIssues> = null; // what it failed, noted if it is kept
  let useTools = tools.length > 0 && ctx !== null && !toolsKnownUnsupported(settings);
  let content = "";
  let reasoning = "";
  // Each step carries its result's two readings (readings/): the answer
  // checks, the references and the verdict read what the tools found, not
  // what fit.
  let steps: AgentStep[] = [];
  let note: string | undefined = tools.length && !useTools && ctx ? TOOLS_UNSUPPORTED_NOTE : undefined;
  const emit = (roundText = "") => onProgress?.({ content: joinText(content, roundText), reasoning, steps });

  let retries = 0;
  let attempts = 0; // retries of the current request
  let recoveries = 0; // retries over the reply
  let failure: Failure | undefined;
  // This reply's tool results in the conversation, oldest first: where each
  // sits, which call made it, and its step.
  const results: { index: number; key: CallKey; id: string }[] = [];
  // Shorten all but the newest `keep` results in the conversation, the model's
  // copies: each step keeps its result as it was sent (`seen`), and is marked
  // `shortened`. A shortened call may run again: the history forgets it, by
  // its key.
  const compactOlder = (keep: number): boolean => {
    const shortened = new Set<string>();
    const forgotten: CallKey[] = [];
    for (const r of results.slice(0, Math.max(0, results.length - keep))) {
      const m = convo[r.index];
      if (typeof m.content !== "string") continue;
      const short = shorten(m.content);
      if (short === m.content) continue;
      convo[r.index] = { ...m, content: short };
      forgotten.push(r.key);
      shortened.add(r.id);
    }
    if (history && forgotten.length) history = forget(history, forgotten, shortened);
    if (shortened.size) steps = steps.map((s) => (shortened.has(s.id) ? { ...s, shortened: true } : s));
    return shortened.size > 0;
  };
  const windowKey = `${settings.baseUrl}|${settings.model}`;
  // A local model is offered the reading tools and those its question is
  // about (localTools.ts); one it calls by name all the same runs, and joins.
  let offered = policy.toolScoping === "question" ? toolsFor(lastQuestion(messages), tools) : tools;
  const offer = (name: string) => {
    const tool = tools.find((t) => t.name === name);
    if (tool && !offered.includes(tool)) offered = tools.filter((t) => offered.includes(t) || t === tool);
  };
  let answerNow = false; // asked to answer without calling more tools
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 }; // over the requests that reported them
  let requests = 0;
  let sent = 0; // requests sent, retries included
  for (let round = 0; ; round++) {
    const last = round >= maxRounds;
    let roundText = "";
    let calls: ToolCall[] = [];
    let native: unknown;
    let cutOff = false;
    const reasoningBefore = reasoning;
    let reported: TokenUsage | undefined; // the request's counts, as its server gave them
    const specs = useTools ? toolSpecs(offered) : undefined;
    if (policy.pruning && softBudget !== undefined && estimateTokens(baseTokens(convo, specs), windowKey) > softBudget) {
      compactOlder(policy.pruning.keepFull);
    }
    // The request's own controller: the reply's Stop ends it, and so does the
    // watchdog when the server goes quiet.
    const request = new AbortController();
    const stopRequest = () => request.abort();
    signal.addEventListener("abort", stopRequest, { once: true });
    let stalled = false;
    let heard = false; // a piece of the reply arrived
    let dispatched = false; // the request went to the server
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
      dispatched = true;
      sent += 1;
      for await (const delta of streamChat({
        baseUrl: settings.baseUrl,
        model: settings.model,
        messages: convo,
        temperature: policy.temperature, // null: none is sent
        apiKey: settings.apiKey || undefined,
        signal: request.signal,
        tools: specs,
        toolChoice: useTools && (last || answerNow) ? "none" : undefined,
        // Every server is asked for the request's counts: they are shown with
        // the reply (usage.ts), and a local server's calibrate the token estimate.
        includeUsage: !usageRefused(settings.baseUrl),
        numCtx: plan.numCtx,
        ...(policy.outputCap.loop != null ? { maxTokens: policy.outputCap.loop } : {}),
      })) {
        // A request the provider dropped and sent again itself (anthropic.ts).
        if (delta.discarded) {
          onUsage?.(notCounted());
          continue;
        }
        heard = true;
        watch(stallMs.idle);
        if (delta.stopReason) onTruncated?.({ request: sent, reason: delta.stopReason });
        if (delta.usage) {
          observeTokens(plan.key, plan.base, delta.usage.input);
          tokens.input += delta.usage.input;
          tokens.output += delta.usage.output;
          tokens.cacheRead += delta.usage.cacheRead ?? 0;
          tokens.cacheWrite += delta.usage.cacheWrite ?? 0;
          tokens.requests += 1;
          reported = delta.usage;
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
      // The request's tokens: as its server counted them, else by the estimate
      // (the prompt as the window planning measures it; the reply's text,
      // thinking and calls at the same rates), marked as one.
      onUsage?.(
        reported
          ? measured(reported)
          : estimated(
              estimateTokens(baseTokens(convo, specs), windowKey),
              (roundText.length + reasoning.length - reasoningBefore.length) / PROSE_CHARS_PER_TOKEN +
                calls.reduce((n, c) => n + c.function.name.length + c.function.arguments.length, 0) / DATA_CHARS_PER_TOKEN,
            ),
      );
    } catch (e) {
      // A request sent that did not complete has no counts: said apart (usage.ts).
      if (dispatched && (heard || !ranNothing(e))) onUsage?.(notCounted());
      if (signal.aborted) throw e; // the reply was stopped
      if (useTools && round === 0 && !roundText && isToolsUnsupported(e)) {
        noTools.add(`${settings.baseUrl}|${settings.model}`);
        useTools = false;
        note = TOOLS_UNSUPPORTED_NOTE;
        round = -1; // the same request again, without tools
        continue;
      }
      // A server that will not give token counts is asked again without them.
      if (!roundText && isUsageUnsupported(e) && !usageRefused(settings.baseUrl)) {
        refuseUsage(settings.baseUrl);
        reasoning = reasoningBefore;
        round -= 1; // the same request again
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

    // An answer sent back stands, with what it still fails, when its revision
    // wrote nothing in its place: none at all, only calls where none were left,
    // or one cut off at the output limit (keepRejected). Returns what the kept
    // answer fails, for the note ("" when none is kept).
    const keepRejected = ({ cut = false } = {}): string => {
      if (!rejected || (roundText.trim() && !cut)) return "";
      content = joinText(before, rejected);
      return rejectedIssues ? issuesNote(rejectedIssues) : "";
    };

    // A reply that ran out of room may end mid-call: never run that round's tools.
    if (cutOff) {
      const failed = keepRejected({ cut: true });
      note = failed ? `${failed} ${CUT_OFF_NOTE}` : CUT_OFF_NOTE;
      break;
    }
    if (!calls.length || !useTools) {
      // The final answer: held to its evidence before the user reads it. A
      // revision that wrote nothing leaves the answer it revised.
      const answer = roundText.trim() ? roundText : rejected;
      const earlier = earlierSources(ctx?.earlierSteps ?? [], steps);
      const sources = numberSources(convo, arrived, steps.map(whole), tools, earlier.standing);
      const issues = useTools && checkAnswers ? answerIssues(answer, steps, sources, earlier.stale, ctx?.marksEarlier) : null;
      if (issues && roundText.trim() && revisions < ANSWER_REVISIONS && round < maxRounds && !signal.aborted) {
        revisions += 1;
        rejected = roundText;
        rejectedIssues = issues;
        content = before;
        convo.push({ role: "assistant", content: roundText });
        // The tools the fix asks for are offered. With the skills off the
        // send-back names none of them (issuesPrompt reads the switch), and
        // the guardrail still keeps them within reach.
        for (const t of [...issues.missing, ...issues.stale]) tools.forEach((tool) => t.evidence.includes(tool.name) && offer(tool.name));
        // The revision is the last request when no round of calls is left (or
        // the model was asked to answer now): it can only rewrite.
        const final = round + 1 >= maxRounds || answerNow;
        convo.push({ role: "user", content: issuesPrompt(issues, { skills: skillsOn(ctx), final }) });
        emit(`_${REVISING_NOTE}_`);
        continue;
      }
      if (!roundText.trim() && rejected) content = joinText(before, rejected);
      if (issues) note = note ? `${note} ${issuesNote(issues)}` : issuesNote(issues);
      break;
    }
    if (last) {
      const failed = keepRejected();
      const stopped = `Stopped after ${maxRounds} rounds of tool calls; the answer uses what was gathered so far.`;
      note = failed ? `${failed} ${stopped}` : stopped;
      break;
    }
    if (answerNow) {
      const failed = keepRejected();
      if (failed) note = note ? `${note} ${failed}` : failed;
      break; // asked to answer, it called again: what it has stands
    }

    // The executor runs the round's calls (tools/round.ts). The transcript
    // shows each step as it changes; the console follows what the model
    // looked at, step by step, before the next call starts.
    const executed = await runRound(calls, history!, {
      signal,
      onStep: (step) => {
        const before = steps.find((s) => s.id === step.id);
        steps = before ? steps.map((s) => (s.id === step.id ? step : s)) : [...steps, step];
        emit();
        if (before?.status === "running" && step.status === "done" && step.view && settings.followViews) openView(step.view);
      },
    });
    history = executed.history;
    convo.push({ role: "assistant", content: roundText, tool_calls: executed.replay, ...(native ? { native } : {}) });
    for (const r of executed.results) {
      if (r.repeatOf === null) {
        if (r.step.status === "done") offer(r.step.name);
        results.push({ index: convo.length, key: r.key, id: r.step.id });
      }
      convo.push(r.message);
    }
    if (executed.stuck && !answerNow) {
      answerNow = true;
      note = note ? `${note} ${LOOP_NOTE}` : LOOP_NOTE;
      convo.push({ role: "user", content: ANSWER_NOW });
    }
  }

  // A server that reported some requests' counts but not all leaves the total unknown.
  const usage = wantUsage ? (tokens.requests > 0 && tokens.requests === requests ? tokens : null) : undefined;
  // Numbers by reference: the words the user reads have each {{tool.field}}
  // filled in from what the tools found (whole, however much the model read);
  // and the verdict on the run is computed from the checks, never taken from
  // the words.
  content = fillReferences(content, steps).text;
  const verdict = useTools ? verdicts({ reply: steps }).achieved : null;
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
