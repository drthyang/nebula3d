// OpenAI-compatible servers this module can talk to.  Local servers (Ollama, LM
// Studio) expose GET /models and POST /chat/completions under a /v1 prefix with
// no API key, so the browser calls them directly and run data never leaves the
// machine.  Cloud providers speak the same dialect but need a Bearer key — and,
// unlike the local ones, they receive the run-derived context (and, when the
// user opts in, the rendered slice image), so they are flagged `cloud` and
// surfaced with a data-leaves-your-device warning.

export interface ProviderPreset {
  id: string;
  label: string;
  baseUrl: string;
  cloud: boolean;
  keyUrl?: string;
  hint: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "ollama",
    label: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    cloud: false,
    hint: 'Allow this site before starting the server: OLLAMA_ORIGINS="' +
      (typeof window !== "undefined" ? window.location.origin : "https://drthyang.github.io") +
      '" ollama serve (or OLLAMA_ORIGINS="*"). For image assessment, pull a vision model (e.g. llava, llama3.2-vision, qwen2.5vl).',
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    baseUrl: "http://localhost:1234/v1",
    cloud: false,
    hint: "Enable CORS in LM Studio: Developer tab → server settings → Enable CORS, then start the local server. Load a vision model for image assessment.",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    cloud: true,
    keyUrl: "https://platform.openai.com/api-keys",
    hint: "Needs an OpenAI API key. Your run-derived metrics (and, if you enable image assessment, the rendered slice) are sent to OpenAI — they do not stay on your device.",
  },
  {
    id: "gemini",
    label: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    cloud: true,
    keyUrl: "https://aistudio.google.com/apikey",
    hint: "Needs a Google AI Studio (Gemini) API key. Your run-derived metrics (and, if you enable image assessment, the rendered slice) are sent to Google — they do not stay on your device.",
  },
];

export const providerForUrl = (baseUrl: string): ProviderPreset | null =>
  PROVIDER_PRESETS.find((preset) => preset.baseUrl === baseUrl) || null;

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

// A base URL is treated as local (private, no key) when its host is loopback.
export const isLocalUrl = (baseUrl: string): boolean => {
  try {
    return LOCAL_HOSTNAMES.has(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
};
