// The executor's round: the tool calls of one model turn, run one at a time
// and in order, over the reply's history. The history is all the next round
// depends on: the tools the reply offers, its tool context, its steps so far,
// the calls that ran since the state last changed, and how many rounds in a
// row brought nothing new. runRound is pure over it: the calls run on a copy
// of the history's tool context, which becomes the next history's, and the
// round hands back a new history, never changing the one it was given (frozen
// in dev and test).
//
// A deep module behind a small interface: startReply, runRound and forget. The
// history is the seam between it and the agent loop (agent.ts): the loop hands
// one in and takes the next back, and a test drives a round from a history
// alone, with no model and no loop. The loop keeps what is its own: the
// requests, the window, compaction (which forgets calls through forget), the
// local offer, the figures it follows (onStep), the answer checks.
//
// The repeat guard: a call with the arguments of one that ran without an
// error since the state last changed does not run again; the model is pointed
// at that step. A call of a tool that acts (its facts' `acts`, facts.ts)
// changes what a reading may give, so one that runs empties the record and is
// not recorded itself; it runs every time it is called, an identical call
// included (dpdf_contrast sets the ΔPDF viewer's colour limit: what it set is
// what the console now shows). An error is never recorded. A tool whose
// result reads the reply's own steps (its facts' `readsReply`: run_verdict)
// is a repeat only while no other call has run since it.

import type { AgentStep } from "../agent";
import type { ChatMessage, ToolCall } from "../provider/client";
import { skillsCarriedIn, skillsOn } from "../skills";
import { parseArguments, runParsed } from "./call";
import { factsOf, toolsWithSkills } from "./registry";
import type { AgentTool, Args, ToolContext } from "./types";

// A call repeated with the same arguments, with nothing changed in between,
// is not run again: the model is pointed at the earlier result. After this
// many rounds in a row that brought nothing new (only repeats and errors),
// the round is stuck, and the loop asks the model to answer with what it has.
export const BARREN_ROUNDS = 2;

/** One call, whatever order its arguments were written in: its tool's name and its arguments as canonical JSON. */
export type CallKey = string & { readonly brand: "CallKey" };

const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]))
      : v;

export const callKey = (name: string, args: Readonly<Args>): CallKey => `${name}|${JSON.stringify(canonical(args))}` as CallKey;

/** The tool a call's key names. */
const toolOf = (key: CallKey): string => key.slice(0, key.indexOf("|"));

/** What the next round depends on. Never changed in place: a round, and forget, hand back a new one. */
export interface History {
  /** The tools the reply offers and runs: the given ones under the skills' switch (toolsWithSkills; off, no read_skill). */
  readonly tools: readonly AgentTool[];
  /** The tool context the next round runs on a copy of: a run's fresh dataset, the skills read so far in this reply, its steps so far (replySteps), the user's latest message. */
  readonly ctx: Readonly<ToolContext>;
  /** The reply's steps so far: the next step's number is steps + 1. */
  readonly steps: number;
  /** The calls that ran without an error since the state last changed, each with its step's number. */
  readonly ran: readonly { readonly key: CallKey; readonly step: number }[];
  /** Rounds in a row that brought nothing new. */
  readonly barren: number;
}

// In dev and test a history is frozen, so a change in place throws there; the
// build leaves this out. Its tools and its context are its own copies.
function sealed(history: History): History {
  if (!import.meta.env.DEV) return history;
  history.ran.forEach((r) => Object.freeze(r));
  Object.freeze(history.ran);
  Object.freeze(history.tools);
  Object.freeze(history.ctx);
  return Object.freeze(history);
}

/**
 * A reply's first history. The skills' switch, as the conversation's context
 * carries it, decides the tools (toolsWithSkills); the context is copied, and
 * its skills read with it, so this reply's reads (read_skill) and a run's
 * fresh dataset (run_pipeline) stay this reply's. The skills read start as the
 * context's (the chat's: none, replyContext in session.ts) and those whose
 * text the reply's opening messages carry (skillsCarriedIn): a skill read in
 * an earlier turn opens no gate unless its text came with the messages. The
 * user's latest message it carries (the loop sets it) stays the same for every
 * round of the reply.
 */
export function startReply(ctx: ToolContext, given: readonly AgentTool[], opening: readonly ChatMessage[] = []): History {
  const on = skillsOn(ctx);
  return sealed({
    tools: [...toolsWithSkills(given, on)],
    ctx: { ...ctx, skillsRead: new Set([...(ctx.skillsRead ?? []), ...(on ? skillsCarriedIn(opening) : [])]), replySteps: [] },
    steps: 0,
    ran: [],
    barren: 0,
  });
}

/** The history without the calls `keys` names, every step of each: compaction shortened a result, so its call may run again. */
export function forget(history: History, keys: Iterable<CallKey>): History {
  const gone = new Set(keys);
  return sealed({ ...history, ran: history.ran.filter((r) => !gone.has(r.key)) });
}

/** A round's calls run: what goes back into the conversation, and the next history. */
export interface Round {
  /** The calls as the conversation keeps them: arguments that are no JSON object as {}. */
  replay: ToolCall[];
  /** Each call's step, its tool message, its key, and the step a repeat points at (null: it ran). */
  results: { step: AgentStep; message: ChatMessage; key: CallKey; repeatOf: number | null }[];
  history: History;
  /** BARREN_ROUNDS rounds in a row brought nothing new: time to answer. */
  stuck: boolean;
}

/**
 * Run a round's calls, one at a time and in order, over `history`. Each
 * call's arguments are parsed once. `onStep` sees each step as it changes
 * (started, its live line, ended), synchronously, so what the loop does with
 * an ended step (open its figure) happens before the next call starts. Never
 * rejects, but with an AbortError when `signal` is aborted before a call
 * starts.
 */
export async function runRound(
  calls: readonly ToolCall[],
  history: History,
  { signal, onStep }: { signal?: AbortSignal; onStep?: (step: AgentStep) => void } = {},
): Promise<Round> {
  // The reply's steps so far go with the context (replySteps), each call's
  // added as it ends, so a call reads the steps before it and the next round
  // starts from all of them.
  const ctx: ToolContext = { ...history.ctx, skillsRead: new Set(history.ctx.skillsRead ?? []), replySteps: history.ctx.replySteps ?? [] };
  const ended = (step: AgentStep) => {
    ctx.replySteps = [...(ctx.replySteps ?? []), step];
  };
  const parsed = calls.map((call) => parseArguments(call.function.arguments));
  let ran = history.ran;
  let fresh = 0; // calls that brought a new result
  const results: Round["results"] = [];
  for (const [i, call] of calls.entries()) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const n = history.steps + i + 1; // the step's number in the reply
    const id = `${n - 1}:${call.id}`; // servers may reuse call ids across rounds
    const name = call.function.name;
    const args = parsed[i] ?? {};
    const key = callKey(name, args);
    const earlier = ran.find((r) => r.key === key)?.step;
    if (earlier !== undefined) {
      // The same reading again: point the model at the one it has.
      const text = JSON.stringify({
        already_called: `Called with these arguments earlier in this reply (step ${earlier}); its result is above. Use it, or call with other arguments.`,
      });
      const step: AgentStep = { id, name, args, status: "done", summary: `same call as step ${earlier}: not run again`, result: text };
      onStep?.(step);
      ended(step);
      results.push({ step, message: { role: "tool", tool_call_id: call.id, content: text }, key, repeatOf: earlier });
      continue;
    }
    let step: AgentStep = { id, name, args, status: "running" };
    onStep?.(step);
    const run = await runParsed(call, parsed[i], history.tools, ctx, {
      signal,
      progress: (progress) => {
        step = { ...step, progress };
        onStep?.(step);
      },
    });
    // The whole result arrives with the status, where the model reads it fitted.
    // A call that failed once the reply was stopped ended because of the Stop
    // (run_pipeline cancels its run on it): it is stopped, not an error.
    step = {
      ...step,
      progress: undefined,
      args: run.args,
      status: run.ok ? "done" : signal?.aborted ? "stopped" : "error",
      summary: run.summary,
      result: run.text,
      ...(run.full !== undefined ? { full: run.full } : {}),
      view: run.view,
      outcomes: run.outcomes,
    };
    onStep?.(step);
    ended(step);
    if (run.ok) {
      fresh += 1;
      // A reading of the reply's own steps (readsReply) differs once another call has run: it is a repeat only until then.
      ran = factsOf(name).acts !== null ? [] : [...ran.filter((r) => !factsOf(toolOf(r.key)).readsReply), { key, step: n }];
    }
    results.push({ step, message: { role: "tool", tool_call_id: call.id, content: run.text }, key, repeatOf: null });
  }
  const barren = fresh ? 0 : history.barren + 1;
  return {
    // A call whose arguments are not a JSON object goes back to the model with {}
    // (its result says what was wrong): a server that renders the history through
    // the model's chat template parses them, and fails the whole request on a
    // call cut off mid-way (LM Studio: HTTP 500).
    replay: calls.map((call, i) => (parsed[i] ? call : { ...call, function: { ...call.function, arguments: "{}" } })),
    results,
    history: sealed({ tools: history.tools, ctx, steps: history.steps + calls.length, ran, barren }),
    stuck: barren >= BARREN_ROUNDS,
  };
}
