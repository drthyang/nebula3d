// Assistant settings live in localStorage so they survive reloads with no
// backend.  A tiny external store (subscribe + snapshot) keeps every consumer in
// sync when any of them edits the settings, exposed through useSyncExternalStore.

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "nebula3d-llm-settings-v1";

export interface LlmSettings {
  baseUrl: string;
  model: string;
  // Sent as a Bearer token to cloud providers (OpenAI, Gemini, …). Empty for
  // local servers, which need none. Persisted in this browser only.
  apiKey: string;
  temperature: number;
  // When true, and the model is vision-capable, the rendered slice PNG is
  // attached to stage-review prompts so the model can literally assess the
  // image. Off by default — keeps the metrics-only path fully text/private.
  attachImages: boolean;
}

export const DEFAULT_SETTINGS: LlmSettings = {
  baseUrl: "http://localhost:11434/v1",
  model: "",
  apiKey: "",
  temperature: 0.2,
  attachImages: false,
};

const readStorage = (): LlmSettings => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return { ...DEFAULT_SETTINGS, ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

let snapshot: LlmSettings | null = null;
const listeners = new Set<() => void>();

export const loadSettings = (): LlmSettings => {
  if (!snapshot) snapshot = readStorage();
  return snapshot;
};

export const saveSettings = (patch: Partial<LlmSettings>): LlmSettings => {
  snapshot = { ...loadSettings(), ...patch };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Private mode or quota errors just mean settings do not persist.
  }
  listeners.forEach((listener) => listener());
  return snapshot;
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useLlmSettings = (): LlmSettings => useSyncExternalStore(subscribe, loadSettings);
