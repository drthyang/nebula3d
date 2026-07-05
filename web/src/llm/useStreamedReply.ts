// Drives one streaming chat completion into React state: accumulates `content`
// and `reasoning` deltas, exposes a cancel handle, and reports errors.  Kept
// tiny and self-contained so any component can own a live reply.

import { useCallback, useRef, useState } from "react";

import { streamChat, type ChatMessage } from "./provider/client";
import { loadSettings } from "./settings";

export interface StreamState {
  streaming: boolean;
  content: string;
  reasoning: string;
  error: string | null;
}

const IDLE: StreamState = { streaming: false, content: "", reasoning: "", error: null };

export function useStreamedReply() {
  const [state, setState] = useState<StreamState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState((s) => ({ ...s, streaming: false }));
  }, []);

  // Stream a reply for `messages`; resolves with the final text (or "" on error
  // / abort) so the caller can commit it to the transcript.
  const run = useCallback(async (messages: ChatMessage[]): Promise<string> => {
    cancel();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ streaming: true, content: "", reasoning: "", error: null });
    const settings = loadSettings();
    let content = "";
    let reasoning = "";
    try {
      for await (const delta of streamChat({
        baseUrl: settings.baseUrl,
        model: settings.model,
        messages,
        temperature: settings.temperature,
        apiKey: settings.apiKey || undefined,
        signal: controller.signal,
      })) {
        if (delta.content) content += delta.content;
        if (delta.reasoning) reasoning += delta.reasoning;
        setState({ streaming: true, content, reasoning, error: null });
      }
      setState({ streaming: false, content, reasoning, error: null });
      return content;
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        setState({ streaming: false, content, reasoning, error: null });
        return content;
      }
      setState({ streaming: false, content, reasoning, error: (e as Error).message });
      return "";
    } finally {
      abortRef.current = null;
    }
  }, [cancel]);

  const reset = useCallback(() => setState(IDLE), []);

  return { ...state, run, cancel, reset };
}
