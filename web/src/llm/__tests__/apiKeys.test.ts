// One API key per provider: a key is saved for the server (origin) the Base
// URL named when it was typed, and goes to that server only. The storage shape
// and the move from the older single key (settings.ts), the requests after a
// provider switch as the console makes them (the connection check of
// useAssistant.ts, a chat request of agent.ts), the transport's own refusal
// (provider/client.ts), and the key field of the connection settings.
// Placeholder keys only; fetch is mocked, so nothing is sent.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "nebula3d-llm-settings-v1";
const OPENAI = "https://api.openai.com/v1";
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai";
const ANTHROPIC = "https://api.anthropic.com";
const OLLAMA = "http://localhost:11434/v1";
const LM_STUDIO = "http://localhost:1234/v1";
const KEY_A = "sk-test-PLACEHOLDER-not-a-key";
const KEY_B = "AIzaTEST-PLACEHOLDER-not-a-key";

// The browser's storage, and a fresh copy of the settings module over it.
let store: Map<string, string>;
const stored = (): Record<string, unknown> => JSON.parse(store.get(STORAGE_KEY) ?? "null");
const seed = (value: unknown) => store.set(STORAGE_KEY, JSON.stringify(value));
const settingsModule = async () => {
  vi.resetModules();
  return import("../settings");
};
const legacy = (baseUrl: string, apiKey: string) => ({ baseUrl, model: "m", apiKey, temperature: 0.2, attachImages: false, useTools: true, followViews: true });

beforeEach(() => {
  store = new Map();
  vi.stubGlobal("window", {
    location: { origin: "http://localhost:5173" },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("the server a key belongs to", () => {
  it("is the Base URL's origin, and none for a local, half-typed or non-http URL", async () => {
    const { apiKeyOrigin } = await settingsModule();
    expect(apiKeyOrigin(OPENAI)).toBe("https://api.openai.com");
    expect(apiKeyOrigin("https://API.OpenAI.com/v1/")).toBe("https://api.openai.com");
    expect(apiKeyOrigin("https://proxy.example.com:8443/v1")).toBe("https://proxy.example.com:8443");
    expect(apiKeyOrigin("http://proxy.example.com/v1")).toBe("http://proxy.example.com");
    for (const url of [OLLAMA, LM_STUDIO, "http://127.0.0.1:18791/v1", "http://[::1]:1234/v1", "http://0.0.0.0:8080", "", "https:/", "https://", "api.openai.com/v1", "localhost:11434/v1", "file:///etc/hosts"])
      expect(apiKeyOrigin(url), url).toBeNull();
  });
});

describe("keys by server", () => {
  it("gives a key to the server it was saved for and to no other, and brings it back", async () => {
    const { loadSettings, saveSettings } = await settingsModule();
    saveSettings({ baseUrl: OPENAI });
    saveSettings({ apiKey: KEY_A });
    expect(loadSettings().apiKey).toBe(KEY_A);
    expect(saveSettings({ baseUrl: GEMINI, model: "" }).apiKey).toBe("");
    expect(saveSettings({ baseUrl: ANTHROPIC, model: "" }).apiKey).toBe("");
    saveSettings({ baseUrl: GEMINI });
    saveSettings({ apiKey: KEY_B });
    expect(saveSettings({ baseUrl: OPENAI }).apiKey).toBe(KEY_A);
    expect(saveSettings({ baseUrl: GEMINI }).apiKey).toBe(KEY_B);
    // Another path on the same server is the same server; another port or scheme is not.
    expect(saveSettings({ baseUrl: "https://api.openai.com/v2" }).apiKey).toBe(KEY_A);
    expect(saveSettings({ baseUrl: "https://api.openai.com:8443/v1" }).apiKey).toBe("");
    expect(saveSettings({ baseUrl: "http://api.openai.com/v1" }).apiKey).toBe("");
  });

  it("gives none to a local or half-typed URL, and saves none typed for one", async () => {
    const { loadSettings, saveSettings } = await settingsModule();
    saveSettings({ baseUrl: OPENAI, apiKey: KEY_A });
    for (const url of [OLLAMA, LM_STUDIO, "http://127.0.0.1:18791/v1", "", "https://", "https://api.openai.co", "https://api.openai.com.example.org/v1"])
      expect(saveSettings({ baseUrl: url }).apiKey, url).toBe("");
    saveSettings({ baseUrl: OLLAMA, apiKey: KEY_B });
    expect(loadSettings().apiKey).toBe("");
    saveSettings({ baseUrl: "https://", apiKey: KEY_B });
    expect(stored().apiKeys).toEqual({ "https://api.openai.com": KEY_A });
  });

  it("removes only the cleared server's key", async () => {
    const { saveSettings } = await settingsModule();
    saveSettings({ baseUrl: OPENAI, apiKey: KEY_A });
    saveSettings({ baseUrl: GEMINI, apiKey: KEY_B });
    saveSettings({ apiKey: "" });
    expect(stored().apiKeys).toEqual({ "https://api.openai.com": KEY_A });
    expect(saveSettings({ baseUrl: OPENAI }).apiKey).toBe(KEY_A);
  });

  it("stores the keys by server, with no key beside the Base URL, and reads them back", async () => {
    const first = await settingsModule();
    first.saveSettings({ baseUrl: OPENAI, apiKey: KEY_A });
    first.saveSettings({ baseUrl: GEMINI, apiKey: KEY_B });
    first.saveSettings({ baseUrl: OLLAMA, model: "llama3.2" });
    expect(stored()).not.toHaveProperty("apiKey");
    expect(stored()).toMatchObject({ baseUrl: OLLAMA, model: "llama3.2", apiKeys: { "https://api.openai.com": KEY_A, "https://generativelanguage.googleapis.com": KEY_B } });
    // A reload.
    const second = await settingsModule();
    expect(second.loadSettings()).toMatchObject({ baseUrl: OLLAMA, model: "llama3.2", apiKey: "" });
    expect(second.saveSettings({ baseUrl: GEMINI }).apiKey).toBe(KEY_B);
  });

  it("ignores a stored entry that is not a server's origin, or is local", async () => {
    seed({ baseUrl: OPENAI, model: "", apiKeys: { "https://api.openai.com/v1": KEY_A, "http://localhost:11434": KEY_A, "https://api.openai.com": 5, nonsense: KEY_A } });
    const { loadSettings, saveSettings } = await settingsModule();
    expect(loadSettings().apiKey).toBe("");
    expect(saveSettings({ baseUrl: OLLAMA }).apiKey).toBe("");
  });

  it("keeps a settings object from another caller as given", async () => {
    // A validation run passes its own settings (its key from the environment): the store is not in its way.
    const { DEFAULT_SETTINGS } = await settingsModule();
    expect({ ...DEFAULT_SETTINGS, baseUrl: ANTHROPIC, apiKey: "env-key" }.apiKey).toBe("env-key");
    expect(DEFAULT_SETTINGS.apiKey).toBe("");
  });
});

describe("a key saved by an older version (one key for every server)", () => {
  const cases: [string, string, string, Record<string, string>][] = [
    ["an Anthropic key (sk-ant-), whatever the Base URL", "sk-ant-PLACEHOLDER", GEMINI, { "https://api.anthropic.com": "sk-ant-PLACEHOLDER" }],
    ["a Gemini key (AIza)", "AIzaPLACEHOLDER", OPENAI, { "https://generativelanguage.googleapis.com": "AIzaPLACEHOLDER" }],
    ["an OpenAI project key (sk-proj-), whatever the Base URL", "sk-proj-PLACEHOLDER", ANTHROPIC, { "https://api.openai.com": "sk-proj-PLACEHOLDER" }],
    ["a prefixed key beside a local Base URL", "sk-proj-PLACEHOLDER", OLLAMA, { "https://api.openai.com": "sk-proj-PLACEHOLDER" }],
    ["a plain sk- key beside OpenAI: OpenAI's", "sk-PLACEHOLDER", OPENAI, { "https://api.openai.com": "sk-PLACEHOLDER" }],
    ["a plain sk- key beside a custom server: that server's, not OpenAI's", "sk-or-PLACEHOLDER", "https://proxy.example.com/v1", { "https://proxy.example.com": "sk-or-PLACEHOLDER" }],
    ["a plain sk- key beside a local Base URL: dropped", "sk-PLACEHOLDER", OLLAMA, {}],
    ["a key that is not Gemini's beside Gemini: dropped", "sk-PLACEHOLDER", GEMINI, {}],
    ["a key that is not Anthropic's beside Anthropic: dropped", "gsk_PLACEHOLDER", ANTHROPIC, {}],
    ["another key beside a hosted Base URL: that server's", "gsk_PLACEHOLDER", "https://proxy.example.com/v1", { "https://proxy.example.com": "gsk_PLACEHOLDER" }],
    ["another key beside a local Base URL: dropped", "gsk_PLACEHOLDER", OLLAMA, {}],
    ["another key beside a Base URL that does not parse: dropped", "gsk_PLACEHOLDER", "https://", {}],
    ["an empty key", "", OPENAI, {}],
  ];
  for (const [name, key, baseUrl, expected] of cases) {
    it(`${name}`, async () => {
      seed(legacy(baseUrl, key));
      const { loadSettings } = await settingsModule();
      const settings = loadSettings();
      // Written back at once, without the old field; the other settings as they were.
      expect(stored()).not.toHaveProperty("apiKey");
      expect(stored()).toMatchObject({ baseUrl, model: "m", apiKeys: expected });
      expect(JSON.stringify(stored()).split(key || "\u0000").length - 1).toBe(Object.keys(expected).length);
      const own = Object.keys(expected)[0];
      expect(settings.apiKey).toBe(own && new URL(baseUrl).origin === own ? key : "");
      // No local server holds it.
      for (const origin of Object.keys(stored().apiKeys as object)) expect(origin).not.toMatch(/localhost|127\.0\.0\.1/);
    });
  }

  it("moves it once: a key saved since is not replaced", async () => {
    seed({ ...legacy(OPENAI, "sk-old-PLACEHOLDER"), apiKeys: { "https://api.openai.com": KEY_A } });
    const { loadSettings } = await settingsModule();
    expect(loadSettings().apiKey).toBe(KEY_A);
    expect(stored().apiKeys).toEqual({ "https://api.openai.com": KEY_A });
  });
});

// What a request carried that could hold a key.
const sentTo = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.map(([input, init]) => {
    const request = input instanceof Request ? input : null;
    const headers = new Headers(request ? request.headers : (init as RequestInit | undefined)?.headers);
    return {
      url: request ? request.url : String(input),
      auth: [headers.get("authorization"), headers.get("x-api-key")].filter(Boolean).join(" "),
    };
  });
const modelList = () => new Response(JSON.stringify({ data: [{ id: "m" }] }), { status: 200, headers: { "content-type": "application/json" } });

describe("requests after a provider switch (the regression: a key went to the next provider)", () => {
  // As the console does it: a provider tab saves { baseUrl, model: "" }
  // (ConnectionSettings.tsx), the connection check then runs on the settings
  // (useAssistant.ts), and a chat request takes the same (agent.ts).
  const consoleRequests = async (nextBaseUrl: string) => {
    const { loadSettings, saveSettings } = await settingsModule();
    const { checkConnection, completeChat } = await import("../provider/client");
    saveSettings({ baseUrl: OPENAI, model: "" });
    saveSettings({ apiKey: KEY_A });
    const fetchMock = vi.fn(async () => modelList());
    vi.stubGlobal("fetch", fetchMock);
    saveSettings({ baseUrl: nextBaseUrl, model: "" });
    const s = loadSettings();
    await checkConnection(s.baseUrl, { apiKey: s.apiKey });
    await completeChat({ baseUrl: s.baseUrl, model: "m", messages: [{ role: "user", content: "hi" }], temperature: 0.2, apiKey: s.apiKey || undefined }).catch(() => {});
    return sentTo(fetchMock);
  };

  for (const [name, url] of [["Gemini", GEMINI], ["Anthropic", ANTHROPIC], ["Ollama", OLLAMA], ["LM Studio", LM_STUDIO], ["a loopback URL on another port", "http://127.0.0.1:18791/v1"], ["a custom server", "https://my-proxy.example.com/v1"]] as const) {
    it(`sends OpenAI's key to no request after switching to ${name}`, async () => {
      const requests = await consoleRequests(url);
      for (const r of requests) expect(r.auth, r.url).not.toContain(KEY_A);
      expect(requests.filter((r) => r.auth)).toEqual([]);
    });
  }

  it("sends it to no host while a custom Base URL is typed", async () => {
    const { loadSettings, saveSettings } = await settingsModule();
    const { checkConnection } = await import("../provider/client");
    saveSettings({ baseUrl: OPENAI, apiKey: KEY_A });
    const fetchMock = vi.fn(async () => modelList());
    vi.stubGlobal("fetch", fetchMock);
    const typed = "https://my-proxy.example.com/v1";
    for (let n = 0; n <= typed.length; n++) {
      saveSettings({ baseUrl: typed.slice(0, n) });
      const s = loadSettings();
      await checkConnection(s.baseUrl, { apiKey: s.apiKey }).catch(() => {});
    }
    expect(fetchMock.mock.calls.length).toBeGreaterThan(10);
    expect(sentTo(fetchMock).filter((r) => r.auth)).toEqual([]);
  });

  it("still sends each provider its own key", async () => {
    const { loadSettings, saveSettings } = await settingsModule();
    const { checkConnection } = await import("../provider/client");
    saveSettings({ baseUrl: OPENAI, apiKey: KEY_A });
    saveSettings({ baseUrl: GEMINI, apiKey: KEY_B });
    const fetchMock = vi.fn(async () => modelList());
    vi.stubGlobal("fetch", fetchMock);
    for (const url of [OPENAI, GEMINI, OLLAMA, OPENAI]) {
      saveSettings({ baseUrl: url, model: "" });
      const s = loadSettings();
      await checkConnection(s.baseUrl, { apiKey: s.apiKey });
    }
    expect(sentTo(fetchMock)).toEqual([
      { url: `${OPENAI}/models`, auth: `Bearer ${KEY_A}` },
      { url: `${GEMINI}/models`, auth: `Bearer ${KEY_B}` },
      { url: `${OLLAMA}/models`, auth: "" },
      { url: `${OPENAI}/models`, auth: `Bearer ${KEY_A}` },
    ]);
  });
});

describe("the transport, whoever calls it", () => {
  it("attaches no key for a server on this machine or a URL that is not a full one", async () => {
    const { listModels, completeChat } = await import("../provider/client");
    const fetchMock = vi.fn(async () => modelList());
    vi.stubGlobal("fetch", fetchMock);
    for (const url of [OLLAMA, LM_STUDIO, "http://127.0.0.1:18791/v1", "http://[::1]:8080/v1", "", "/v1"]) {
      await listModels(url, { apiKey: KEY_A }).catch(() => {});
      await completeChat({ baseUrl: url, model: "m", messages: [{ role: "user", content: "hi" }], apiKey: KEY_A }).catch(() => {});
    }
    expect(fetchMock.mock.calls.length).toBeGreaterThan(6);
    expect(sentTo(fetchMock).filter((r) => r.auth)).toEqual([]);
  });

  it("attaches the key it is given for a hosted server, as before", async () => {
    const { listModels } = await import("../provider/client");
    const fetchMock = vi.fn(async () => modelList());
    vi.stubGlobal("fetch", fetchMock);
    await listModels("https://run.example.com/v1", { apiKey: "env-key" });
    expect(sentTo(fetchMock)).toEqual([{ url: "https://run.example.com/v1/models", auth: "Bearer env-key" }]);
  });
});

describe("the key field of the connection settings", () => {
  const field = async (baseUrl: string) => {
    const { loadSettings, saveSettings } = await import("../settings");
    const { ConnectionSettings } = await import("../components/ConnectionSettings");
    saveSettings({ baseUrl, model: "" });
    const html = renderToStaticMarkup(
      createElement(ConnectionSettings, { settings: loadSettings(), connection: { status: "idle", ok: false, models: [], error: null, hint: null }, onTest: () => {} }),
    );
    return /<input type="password"[^>]*>/.exec(html)?.[0] ?? null;
  };

  it("shows each provider its own key, an empty field for one with none, and no field for a local server", async () => {
    const { saveSettings } = await settingsModule();
    saveSettings({ baseUrl: OPENAI, apiKey: KEY_A });
    saveSettings({ baseUrl: GEMINI, apiKey: KEY_B });
    expect(await field(OPENAI)).toContain(`value="${KEY_A}"`);
    expect(await field(GEMINI)).toContain(`value="${KEY_B}"`);
    expect(await field(ANTHROPIC)).toContain('value=""');
    expect(await field(OPENAI)).toContain(`value="${KEY_A}"`);
    expect(await field(OLLAMA)).toBeNull();
    // A half-typed URL: the field takes no key yet.
    const half = await field("https://");
    expect(half).toContain('value=""');
    expect(half).toContain("disabled");
  });
});
