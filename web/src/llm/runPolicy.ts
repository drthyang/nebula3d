// The run policy: what a reply of the Pilot runs under, transport by transport.
// The agent loop (agent.ts) reads it for what the loop decides itself: how many
// rounds of tool calls, which tools a model is offered, when older results are
// shortened, the temperature and the output cap it asks for, and whether it
// asks a local server for its token counts. The rest each transport does on its
// own, and the policy says what: whether the model's thinking goes back with a
// turn that called tools, the tuning's output cap, and how a request is held
// to the model's context window (provider/window.ts). Every value is read from
// the constant or setting that decides it, never written again here
// (runPolicy.test.ts pins each, and what each transport sends).
//
// The app ships one policy per transport: Claude through Anthropic's SDK, an
// OpenAI-compatible server (LM Studio on this machine; OpenAI and Gemini in the
// cloud), and Ollama's own chat API. A validation run is the Pilot as it ships
// (arm B), so it runs on its transport's policy, with the run's round limit and
// the validation's output cap (validationPolicy, evals/validationModels.ts),
// and its record keeps the policy it ran under (run_policy, evals/validation.ts).

import { COMPLETE_MAX_TOKENS, isAnthropicUrl, STREAM_MAX_TOKENS } from "./provider/anthropic";
import { isOllamaUrl } from "./provider/client";
import { isLocalUrl } from "./provider/presets";
import { MIN_REPLY, REPLY_RESERVE } from "./provider/tokens";
import { DEFAULT_SETTINGS, type LlmSettings } from "./settings";

// Rounds of tool calls before the model is asked to answer with what it has;
// each round may call several tools.  Enough to change a setting, rerun and
// measure a few times over.
export const MAX_TOOL_ROUNDS = 12;

// A local model's request past this many tokens has its older tool results
// shortened to their verdicts, headlines and numbers (shorten, readings/), the
// newest KEEP_FULL left whole: it keeps the request inside a 32k window with
// room to reply, and fast. A request no window can hold is shortened down to
// the newest result before it is refused.
export const SOFT_BUDGET = 24_000;
export const KEEP_FULL = 3;

/** How a request goes to the model server (provider/client.ts). */
export type Transport =
  | "anthropic" // Claude, through Anthropic's SDK (anthropic.ts)
  | "openai-compatible" // POST /chat/completions: LM Studio, OpenAI, Gemini
  | "ollama"; // Ollama's own chat API, /api/chat

/** How a request is held to the model's context window (provider/window.ts). */
export interface WindowPolicy {
  // "sized": Ollama is asked for a context length (num_ctx) that holds the
  // request and room for the reply; "loaded": the length LM Studio loaded the
  // model with, read and never set; "none": not checked (a cloud model's
  // window is far longer than the app's requests).
  plan: "sized" | "loaded" | "none";
  replyReserve: number | null; // the room for the reply a sized window holds (REPLY_RESERVE); null: none is sized
  minReply: number | null; // the least room for the reply before a request is refused (MIN_REPLY); null: none is refused
}

export interface RunPolicy {
  transport: Transport;
  local: boolean; // served on this machine (a loopback base URL): it is asked for its token counts, which calibrate the estimate
  maxRounds: number; // rounds of tool calls before the model is asked to answer (MAX_TOOL_ROUNDS)
  // "question": a local model is offered the tools its question needs, and more
  // as it calls them (localTools.ts); "all": every tool.
  toolScoping: "question" | "all";
  // Past `softBudget` estimated tokens, a request's older tool results are
  // shortened, the newest `keepFull` left whole (SOFT_BUDGET, KEEP_FULL);
  // null: never (a cloud model).
  pruning: { softBudget: number; keepFull: number } | null;
  temperature: number | null; // sent with every request; null: none is sent (Claude takes no sampling parameters)
  // The most tokens a request asks the reply to run to: the agent loop's, and
  // a tuning run's (tune_pipeline). Null: none is asked, and the server's own
  // limit holds (a local model's window plan keeps room for the reply).
  outputCap: { loop: number | null; tuning: number | null };
  // The model's thinking goes back with a turn that called tools (Claude's
  // own content blocks, replayed whole); false: it is shown, never sent back.
  reasoningReplay: boolean;
  window: WindowPolicy;
}

/** The transport a base URL is served by, as the client picks it (streamChat). */
export const transportOf = (baseUrl: string): Transport =>
  isAnthropicUrl(baseUrl) ? "anthropic" : isOllamaUrl(baseUrl) ? "ollama" : "openai-compatible";

/** What a transport runs under in the app, on a server on this machine or not. */
function shipped(transport: Transport, local: boolean): RunPolicy {
  const claude = transport === "anthropic";
  return {
    transport,
    local,
    maxRounds: MAX_TOOL_ROUNDS,
    toolScoping: local ? "question" : "all",
    pruning: local ? { softBudget: SOFT_BUDGET, keepFull: KEEP_FULL } : null,
    temperature: claude ? null : DEFAULT_SETTINGS.temperature,
    outputCap: claude ? { loop: STREAM_MAX_TOKENS, tuning: COMPLETE_MAX_TOKENS } : { loop: null, tuning: null },
    reasoningReplay: claude,
    window:
      transport === "ollama"
        ? { plan: "sized", replyReserve: REPLY_RESERVE, minReply: MIN_REPLY }
        : local
          ? { plan: "loaded", replyReserve: null, minReply: MIN_REPLY }
          : { plan: "none", replyReserve: null, minReply: null },
  };
}

/**
 * The policy each transport ships with, on the app's default settings: Claude;
 * an OpenAI-compatible server on this machine (LM Studio); Ollama on this
 * machine; and an OpenAI-compatible cloud server (OpenAI, Gemini).
 */
export const RUN_POLICIES: Readonly<Record<"claude" | "lmStudio" | "ollama" | "openAiCloud", RunPolicy>> = {
  claude: shipped("anthropic", false),
  lmStudio: shipped("openai-compatible", true),
  ollama: shipped("ollama", true),
  openAiCloud: shipped("openai-compatible", false),
};

/**
 * The policy a reply on *settings* runs under, as the app ships it: its
 * transport's, on this machine or not by its base URL, with the settings'
 * temperature where the transport sends one (Claude's sends none). An Ollama
 * server off this machine is sized as Ollama, and offered every tool, unpruned,
 * as a cloud model is.
 */
export function runPolicyOf(settings: Pick<LlmSettings, "baseUrl" | "temperature">): RunPolicy {
  const policy = shipped(transportOf(settings.baseUrl), isLocalUrl(settings.baseUrl));
  return { ...policy, temperature: policy.temperature === null ? null : settings.temperature };
}
