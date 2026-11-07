// Summarize and continue (THY-74): the app's own summary of a conversation's
// earlier turns, which the model reads in their place. No model writes it: it
// is built from the transcript and the Apply cards' record, so it costs no
// request and states nothing the conversation did not. It names, for each
// question, the checks its reply ran (the evidence: each a step the
// transcript keeps, by its tool and stage) and the app's computed verdict
// then (verdicts/); then the decisions on the Apply cards (apply/since.ts).
// It holds no number measured or written by the model (THY-18): not the
// answers' words (their numbers are filled in from the results, references.ts,
// so a summary quoting them would carry the numbers without their source),
// not a cut's plane or value, and of the verdict only the app's met / not met
// with what needs attention, without the data's problems (which may quote
// one). The user's own words (a question, a setting they chose) stay as they
// were.
//
// MODEL-VISIBLE: the summary ends the context, the first user message
// (prompts/templates.ts, `earlier`), of every request after it; its text is
// pinned in __snapshots__/model-visible/1-chat-summarized.md.
//
// The transcript keeps every turn as it was; ChatView says in the chat where
// the summary took their place. The turns after it are sent as before.

import type { ChatTurn } from "./chatStore";
import { CHAT_HISTORY_TURNS } from "./prompts/templates";
import { baseTokens } from "./provider/tokens";
import type { ComputedVerdict } from "./verdicts";

/** What the model reads in place of the turns up to `through` (a turn id). */
export interface ChatSummary {
  through: number; // the last turn it covers
  turns: number; // how many turns it covers
  text: string;
}

// The newest questions listed; the rest are counted.
export const SUMMARY_QUESTIONS = 12;
// A question longer than this is cut, with "…".
export const QUESTION_CHARS = 160;
// The checks listed for one reply; the rest are counted.
export const LISTED_MAX = 8;

const plain = (s: string): string => s.replace(/\s+/g, " ").trim();

const quoted = (q: string): string => {
  const t = plain(q).replace(/"/g, "'");
  return `"${t.length > QUESTION_CHARS ? `${t.slice(0, QUESTION_CHARS - 1).trimEnd()}…` : t}"`;
};

const listed = (xs: readonly string[]): string =>
  xs.length > LISTED_MAX ? `${xs.slice(0, LISTED_MAX).join(", ")} and ${xs.length - LISTED_MAX} more` : xs.join(", ");

// A step as the summary names it: the tool, and its stage or skill where the
// call named one (a word, never a number: a cut's plane and value are left out).
const WORD = /^[A-Za-z][A-Za-z_-]*$/;
function stepName(s: NonNullable<ChatTurn["steps"]>[number]): string {
  const what = [s.args.stage, s.args.name].find((v): v is string => typeof v === "string" && WORD.test(v));
  return what ? `${s.name} ${what}` : s.name;
}

/** The app's verdict as the summary states it: met, or not met with what needs attention; null when the reply did not judge the run. */
export function verdictWords(v: ComputedVerdict | null | undefined): string | null {
  if (!v || v.achieved === null) return null;
  return v.achieved ? "met" : `not met, needs attention: ${v.attention.join(", ")}`;
}

/** One question and its reply, as a line. */
function item(question: ChatTurn | null, reply: ChatTurn | null): string {
  const parts = [question ? `asked ${quoted(question.content)}` : "a reply"];
  if (reply) {
    const checks = [...new Set((reply.steps ?? []).filter((s) => s.status === "done").map(stepName))];
    parts.push(checks.length ? `checks run: ${listed(checks)}` : "no checks run");
    const verdict = verdictWords(reply.verdict);
    if (verdict) parts.push(`the app's verdict then: ${verdict}`);
    if (!reply.content.trim()) parts.push("no answer");
  } else parts.push("no reply");
  return `- ${parts.join("; ")}`;
}

/**
 * The summary of `turns` (the conversation up to now, oldest first) with the
 * decisions' line (sinceLine, apply/since.ts, or null), or null when there is
 * no turn to summarize.
 */
export function summarizeTurns(turns: readonly ChatTurn[], decided: string | null): ChatSummary | null {
  if (!turns.length) return null;
  const items: string[] = [];
  let question: ChatTurn | null = null;
  for (const t of turns) {
    if (t.role === "user") {
      if (question) items.push(item(question, null));
      question = t;
    } else {
      items.push(item(question, t));
      question = null;
    }
  }
  if (question) items.push(item(question, null));
  const kept = items.slice(-SUMMARY_QUESTIONS);
  const left = items.length - kept.length;
  const n = turns.length;
  const text = [
    `Earlier in this conversation: ${n} turn${n === 1 ? "" : "s"} the app summarized in their place (Summarize and continue). ` +
      "For each question, the checks its reply ran and the app's verdict then; their answers are not repeated. " +
      "It holds no measured number, and the outputs may have changed since: call the tools again before you quote a result.",
    ...(left ? [`- (${left} earlier question${left === 1 ? "" : "s"} not listed)`] : []),
    ...kept,
    ...(decided ? [decided] : []),
  ].join("\n");
  return { through: turns[turns.length - 1].id, turns: n, text };
}

/**
 * Whether summary `next` makes the request shorter: fewer tokens than what it
 * takes off it, the turns still sent as text (the newest CHAT_HISTORY_TURNS of
 * `sent`) and the summary in place before it (`current`).
 */
export function summaryShortens(
  sent: readonly Pick<ChatTurn, "role" | "content">[],
  current: Pick<ChatSummary, "text"> | null,
  next: Pick<ChatSummary, "text"> | null,
): boolean {
  if (!next || !sent.length) return false;
  const off = sent.slice(-CHAT_HISTORY_TURNS).map(({ role, content }) => ({ role, content }));
  const before = baseTokens([...off, ...(current ? [{ role: "user" as const, content: current.text }] : [])]);
  return baseTokens([{ role: "user", content: next.text }]) < before;
}

/** The turns the model still reads as text: those after the summary, or all of them. */
export const unsummarized = <T extends { id: number }>(turns: readonly T[], summary: Pick<ChatSummary, "through"> | null): T[] =>
  summary ? turns.filter((t) => t.id > summary.through) : [...turns];
