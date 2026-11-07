// The longest context an Ollama model supports, for the context meter
// (contextMeter.ts): the window it works to is the 32k Tools need, within it.

import { useEffect, useState } from "react";

import { isOllamaUrl, ollamaModel } from "./provider/client";
import type { LlmSettings } from "./settings";

/** The longest context an Ollama model supports (its /api/show, read once), or null. */
export function useOllamaMax(settings: Pick<LlmSettings, "baseUrl" | "model">, connected: boolean): number | null {
  const [max, setMax] = useState<{ key: string; max: number | null } | null>(null);
  const key = `${settings.baseUrl}|${settings.model}`;
  const ollama = connected && Boolean(settings.model) && isOllamaUrl(settings.baseUrl);
  useEffect(() => {
    if (!ollama) return;
    // No signal: the read is cached and shared with the agent loop's window
    // plan (client.ts), which an abort here would fail.
    let live = true;
    ollamaModel(settings.baseUrl, settings.model)
      .then((m) => live && setMax({ key, max: m.maxContext }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [ollama, key, settings.baseUrl, settings.model]);
  return ollama && max?.key === key ? max.max : null;
}
