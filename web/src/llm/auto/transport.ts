// How an auto reply's seeded checks reach the model, transport by transport
// (docs/pilot-auto-mode-design.md §2.3; agent.ts, `seed`). They go as a round
// of tool calls the app made, after the phase prompt, where the transport
// takes one: Ollama's chat API, LM Studio and OpenAI's chat completions, and
// Claude on a model without adaptive thinking. Where it does not, they go in
// the phase message (prompts/seeded.ts):
//  - Claude with adaptive thinking (anthropic.ts, adaptiveThinking): a turn
//    that called tools is replayed with the model's own thinking block before
//    its calls, and the Messages API refuses a last assistant turn of calls
//    without one, which a round the app made cannot have;
//  - Gemini's OpenAI-compatible endpoint: its thinking models bind each call
//    to a thought signature the model wrote, which a round the app made has
//    none of.
// Any other transport that refuses the round all the same (a 400 or 422 on
// the reply's first request) gets the request again in the message form, and
// the run keeps that form for its next replies (controller.ts).

import type { SeedForm } from "../agent";
import { adaptiveThinking, isAnthropicUrl } from "../provider/anthropic";
import type { LlmSettings } from "../settings";

const isGeminiUrl = (baseUrl: string): boolean => {
  try {
    return new URL(baseUrl).hostname === "generativelanguage.googleapis.com";
  } catch {
    return false;
  }
};

/** The form the seeded checks go in on `settings`' transport: the run's, once a refusal found it. */
export function seedFormFor(settings: Pick<LlmSettings, "baseUrl" | "model">, found: SeedForm | null = null): SeedForm {
  if (found) return found;
  if (isAnthropicUrl(settings.baseUrl) && adaptiveThinking(settings.model)) return "message";
  if (isGeminiUrl(settings.baseUrl)) return "message";
  return "round";
}
