// Assistant settings live in localStorage so they survive reloads with no
// backend.  A tiny external store (subscribe + snapshot) keeps every consumer in
// sync when any of them edits the settings, exposed through useSyncExternalStore.

import { useSyncExternalStore } from "react";

import { isLocalUrl, PROVIDER_PRESETS } from "./provider/presets";

const STORAGE_KEY = "nebula3d-llm-settings-v1";

export interface LlmSettings {
  baseUrl: string;
  model: string;
  // The key saved for the server `baseUrl` names, or "": each server has its
  // own (see apiKeyOrigin), so a key only ever goes to the server it was typed
  // for. Derived, never stored under this name. Sent as a Bearer token to
  // OpenAI-compatible cloud providers and through Anthropic's SDK. Empty for
  // local servers, which need none. Persisted in this browser only.
  apiKey: string;
  // Sent with each request. Null: none is sent, for a model that takes no
  // sampling parameters (a validation run's Claude, evals/validationModels.ts);
  // Claude's transport sends none whatever this says (the run policy,
  // runPolicy.ts). The console keeps the default.
  temperature: number | null;
  // When true, and the model is vision-capable, the rendered slice PNG is
  // attached to stage-review prompts so the model can literally assess the
  // image. Off by default — keeps the metrics-only path fully text/private.
  attachImages: boolean;
  // When true, the model may call the assistant's tools (measure other cuts,
  // look up the Bragg profile, open a viewer, …).  Models that cannot call
  // tools fall back to the fixed-cut metrics on their own.
  useTools: boolean;
  // When true, the console moves to the figure each measuring or assessing
  // tool call looked at, as it finishes, so the user sees what the model sees.
  followViews: boolean;
}

export const DEFAULT_SETTINGS: LlmSettings = {
  baseUrl: "http://localhost:11434/v1",
  model: "",
  apiKey: "",
  temperature: 0.2,
  attachImages: false,
  useTools: true,
  followViews: true,
};

/**
 * The server a key saved while the Base URL is `baseUrl` belongs to: the URL's
 * origin (scheme, host in lower case, port). Null for a URL that takes no key:
 * one that does not parse (half typed), is not http(s), or names this machine.
 * A half-typed host is another origin, so it has no key either.
 */
export const apiKeyOrigin = (baseUrl: string): string | null => {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return isLocalUrl(baseUrl) ? null : url.origin;
  } catch {
    return null;
  }
};

type ApiKeys = Record<string, string>;

const presetOrigin = (id: string): string | null => apiKeyOrigin(PROVIDER_PRESETS.find((p) => p.id === id)?.baseUrl ?? "");

// Where the single key of an older version goes: to the provider its prefix
// names, whatever Base URL was set beside it (that version sent one key to
// every server, so the URL does not say whose key it is); a key with no known
// prefix goes to the stored Base URL's server, and to none when that is local.
const legacyKeyOrigin = (key: string, baseUrl: string): string | null => {
  if (key.startsWith("sk-ant-")) return presetOrigin("anthropic");
  if (key.startsWith("AIza")) return presetOrigin("gemini");
  if (key.startsWith("sk-")) return presetOrigin("openai");
  return apiKeyOrigin(baseUrl);
};

const storedKeys = (raw: unknown): ApiKeys => {
  const keys: ApiKeys = {};
  if (!raw || typeof raw !== "object") return keys;
  for (const [origin, key] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key === "string" && key && apiKeyOrigin(origin) === origin) keys[origin] = key;
  }
  return keys;
};

// The keys, by server. Kept beside the snapshot, which carries only the
// current server's.
let apiKeys: ApiKeys = {};

const persist = (settings: LlmSettings): void => {
  const { apiKey: _derived, ...rest } = settings;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...rest, apiKeys }));
  } catch {
    // Private mode or quota errors just mean settings do not persist.
  }
};

const readStorage = (): LlmSettings => {
  let parsed: Record<string, unknown> = {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (value && typeof value === "object") parsed = value as Record<string, unknown>;
  } catch {
    // Nothing stored, or nothing readable: the defaults.
  }
  const { apiKey: legacy, apiKeys: stored, ...rest } = parsed;
  apiKeys = storedKeys(stored);
  const settings: LlmSettings = { ...DEFAULT_SETTINGS, ...rest, apiKey: "" };
  if (typeof settings.baseUrl !== "string") settings.baseUrl = DEFAULT_SETTINGS.baseUrl;
  if (legacy !== undefined) {
    // An older version's one key for every server: filed under one server,
    // once, and the old field removed from the browser's storage.
    const key = typeof legacy === "string" ? legacy.trim() : "";
    const origin = key ? legacyKeyOrigin(key, settings.baseUrl) : null;
    if (origin && !apiKeys[origin]) apiKeys[origin] = key;
    persist(settings);
  }
  const origin = apiKeyOrigin(settings.baseUrl);
  settings.apiKey = (origin && apiKeys[origin]) || "";
  return settings;
};

let snapshot: LlmSettings | null = null;
const listeners = new Set<() => void>();

export const loadSettings = (): LlmSettings => {
  if (!snapshot) snapshot = readStorage();
  return snapshot;
};

/**
 * Change settings. `apiKey` is saved for the server the Base URL names (the
 * patch's, when it has one), "" removing it; a URL that takes no key
 * (apiKeyOrigin) saves none. A new Base URL brings its own server's key.
 */
export const saveSettings = (patch: Partial<LlmSettings>): LlmSettings => {
  const { apiKey, ...rest } = patch;
  const next: LlmSettings = { ...loadSettings(), ...rest };
  const origin = apiKeyOrigin(next.baseUrl);
  if (apiKey !== undefined && origin) {
    const { [origin]: _old, ...others } = apiKeys;
    apiKeys = apiKey ? { ...others, [origin]: apiKey } : others;
  }
  next.apiKey = (origin && apiKeys[origin]) || "";
  snapshot = next;
  persist(next);
  listeners.forEach((listener) => listener());
  return snapshot;
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useLlmSettings = (): LlmSettings => useSyncExternalStore(subscribe, loadSettings);
