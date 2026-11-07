// The context meter by the chat box (THY-74): how much of the model's context
// window the next reply's opening request takes, with the room kept for the
// reply. It is measured as the agent loop measures a request before sending
// it (provider/window.ts): the messages the chat would send now (ChatView's
// requestFor, the same builder its Send uses), the tools the loop would offer
// with them, at the starting rates scaled by what the server counted for the
// model (provider/tokens.ts, estimateTokens). Nothing here is sent; the meter
// is UI only.
//
// The window is the active model's own:
//  - Ollama: the 32k Tools need (TOOLS_CONTEXT), within the longest the model
//    supports, or the length it last ran with when that is longer (the window
//    plan sizes num_ctx to the request, so a 7k request runs in 16k: the
//    meter reads the window the app works to, not the step it ran in);
//  - LM Studio (another local server): the length the model is loaded with
//    where the server says, else the 32k Tools need;
//  - Claude: the model's window (1M for the current models, 200k for the
//    older ones and any it does not name);
//  - another cloud model: not known here, so the meter counts tokens only.
// The reply's room is what the loop keeps for it: REPLY_RESERVE (thinking and
// answer) on a local model, the output cap the loop asks for on Claude
// (STREAM_MAX_TOKENS: a request whose prompt and max_tokens pass the window
// is refused).

import { toolsKnownUnsupported } from "./agent";
import { costOf, priceOf, usd } from "./auto/cost";
import { lastQuestion, toolsFor } from "./localTools";
import { isAnthropicUrl } from "./provider/anthropic";
import { isOllamaUrl, TOOLS_CONTEXT, type ChatMessage, type ModelContext, type ToolSpec } from "./provider/client";
import { isLocalUrl } from "./provider/presets";
import { baseTokens, estimateTokens, REPLY_RESERVE, tokenCalibration } from "./provider/tokens";
import { runPolicyOf, type RunPolicy } from "./runPolicy";
import type { LlmSettings } from "./settings";
import { skillsOn } from "./skills";
import { toolSpecs, toolsWithSkills, type AgentTool, type ToolContext } from "./tools";
import type { Usage } from "./usage";

/** Below this share of the window the meter is neutral; from it, amber. */
export const AMBER_AT = 0.7;
/** Above this share, red. */
export const RED_ABOVE = 0.9;

// Claude's context windows by model id, most specific first (the claude-api
// reference's table, cached 2026-10-06): 1M for the 4.6 models and later, and
// for Fable, Mythos and Haiku 5; 200k for Haiku 4.5 and the older models, and
// for a Claude model this table does not name (the smaller window: the meter
// warns early rather than late).
const CLAUDE_WINDOWS: [RegExp, number][] = [
  [/^claude-(?:fable|mythos)-/, 1_000_000],
  [/^claude-(?:opus|sonnet|haiku)-5/, 1_000_000],
  [/^claude-(?:opus|sonnet)-4-[6-9]/, 1_000_000],
];
export const CLAUDE_DEFAULT_WINDOW = 200_000;

export const claudeWindow = (model: string): number =>
  CLAUDE_WINDOWS.find(([re]) => re.test(model))?.[1] ?? CLAUDE_DEFAULT_WINDOW;

/** The window a request must fit, with the room kept for the reply. */
export interface ContextWindow {
  size: number | null; // null: not known (a cloud model outside Claude)
  reserve: number; // the reply's room, counted in the meter
  // Where the size comes from: LM Studio's loaded length; the length Tools
  // need (TOOLS_CONTEXT); Ollama's, the longer of that and what it ran with;
  // Claude's table; none.
  source: "loaded" | "tools" | "ollama" | "claude" | "unknown";
}

/**
 * The window of the model on *settings*: `loaded` is what LM Studio says it
 * loaded the model with (useAssistant), `ollamaMax` the longest context an
 * Ollama model supports (its /api/show), each null where not known.
 */
export function contextWindow(
  settings: Pick<LlmSettings, "baseUrl" | "model" | "temperature">,
  { loaded = null, ollamaMax = null }: { loaded?: ModelContext | null; ollamaMax?: number | null } = {},
  policy: RunPolicy = runPolicyOf(settings),
): ContextWindow {
  if (isAnthropicUrl(settings.baseUrl)) {
    return { size: claudeWindow(settings.model), reserve: policy.outputCap.loop ?? 0, source: "claude" };
  }
  if (isOllamaUrl(settings.baseUrl)) {
    const ran = tokenCalibration(`${settings.baseUrl}|${settings.model}`).ollamaNumCtx ?? 0;
    const target = ollamaMax != null ? Math.min(TOOLS_CONTEXT, ollamaMax) : TOOLS_CONTEXT;
    return { size: Math.max(target, ran), reserve: REPLY_RESERVE, source: ran > target ? "ollama" : "tools" };
  }
  if (isLocalUrl(settings.baseUrl)) {
    const size = loaded?.loaded ?? null;
    return size != null ? { size, reserve: REPLY_RESERVE, source: "loaded" } : { size: TOOLS_CONTEXT, reserve: REPLY_RESERVE, source: "tools" };
  }
  return { size: null, reserve: 0, source: "unknown" };
}

/**
 * The tools the loop offers with `messages` on its first request (agent.ts,
 * runAgent): none without a context, or for a model known to refuse tools;
 * else the given ones under the skills' switch, and on a local model those
 * the question is about (localTools.ts).
 */
export function openingSpecs(
  messages: readonly ChatMessage[],
  given: readonly AgentTool[],
  ctx: ToolContext | null,
  settings: Pick<LlmSettings, "baseUrl" | "model" | "temperature">,
  policy: RunPolicy = runPolicyOf(settings),
): ToolSpec[] | undefined {
  if (!given.length || !ctx || toolsKnownUnsupported(settings)) return undefined;
  const tools = toolsWithSkills(given, skillsOn(ctx));
  return toolSpecs(policy.toolScoping === "question" ? toolsFor(lastQuestion([...messages]), tools) : tools);
}

/** The opening request's estimated prompt tokens, as the loop's window plan counts them (planWindow). */
export const requestTokens = (
  messages: ChatMessage[],
  specs: ToolSpec[] | undefined,
  settings: Pick<LlmSettings, "baseUrl" | "model">,
): number => estimateTokens(baseTokens(messages, specs), `${settings.baseUrl}|${settings.model}`);

export type MeterLevel = "ok" | "amber" | "red";

export interface MeterReading {
  prompt: number; // the request's estimated tokens
  used: number; // with the reply's room
  share: number | null; // of the window; null: the window is not known
  percent: number | null; // rounded, as shown
  level: MeterLevel;
}

/** The meter for a request of `prompt` tokens in window `w`. */
export function meterReading(prompt: number, w: ContextWindow): MeterReading {
  const used = prompt + w.reserve;
  const share = w.size ? used / w.size : null;
  const level: MeterLevel = share === null ? "ok" : share > RED_ABOVE ? "red" : share >= AMBER_AT ? "amber" : "ok";
  return { prompt, used, share, percent: share === null ? null : Math.round(share * 100), level };
}

const n = (x: number): string => x.toLocaleString("en-US");

/**
 * The meter's detail, one plain line: the tokens used of the window, the
 * reply's room, and on a priced model what the conversation has cost.
 */
export function meterDetail(r: MeterReading, w: ContextWindow, cost: string | null): string {
  const spend = cost ? ` · ${cost} so far` : "";
  if (w.size === null) return `≈ ${n(r.prompt)} tokens for the next request; this model's window is not known here${spend}.`;
  const reserve = w.reserve ? `, ${n(w.reserve)} of them kept for the reply` : "";
  return `≈ ${n(r.used)} of ${n(w.size)} tokens${reserve}${spend}.`;
}

/** What the conversation has cost on a priced model ("$0.04"), or null. */
export const conversationCost = (settings: Pick<LlmSettings, "baseUrl" | "model">, usage: Usage | null): string | null => {
  const price = priceOf(settings);
  return price ? usd(usage ? costOf(usage, price) : 0) : null;
};
