// The tools a model was offered on each request of a run, as they went over the
// wire. The Pilot offers a local model the tools its question needs (and more as
// it calls them), so the list changes inside one run, and the validation measures
// the Pilot as it ships: it records what was sent, request by request, rather than
// what the evals think should have been.

export interface ToolOffer {
  request: number; // 1-based, over every chat request of the agent loop, retries included
  tools: string[]; // the names, in the order sent
}

// OpenAI-style servers (LM Studio, Ollama) and Anthropic's Messages API.
const CHAT_URL = /\/(chat\/completions|v1\/messages)(\?|$)/;

/** The tool names in a chat request's body: OpenAI-style `tools[].function.name`, Anthropic's `tools[].name`. */
export function toolNamesIn(body: unknown): string[] {
  const tools = (body as { tools?: unknown } | null)?.tools;
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((t: { name?: unknown; function?: { name?: unknown } }) => {
    const name = t?.function?.name ?? t?.name;
    return typeof name === "string" ? [name] : [];
  });
}

/**
 * Records the tool list of every chat request that goes through `fetch` while
 * installed, save those sent while `others` is true: requests that are not the
 * agent loop's (a validation run's tuning, which offers no tools).
 */
export class OfferRecorder {
  readonly offers: ToolOffer[] = [];

  constructor(private readonly others: () => boolean = () => false) {}

  /** Wraps `globalThis.fetch`; returns the function that puts it back. */
  install(): () => void {
    const real = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (CHAT_URL.test(url) && typeof init?.body === "string" && !this.others()) {
        try {
          this.offers.push({ request: this.offers.length + 1, tools: toolNamesIn(JSON.parse(init.body)) });
        } catch {
          // not JSON: not a chat request we can read
        }
      }
      return real(input, init);
    }) as typeof fetch;
    return () => {
      globalThis.fetch = real;
    };
  }
}

/** The tools each request added or dropped against the one before it, for a reader. */
export function offerChanges(offers: readonly ToolOffer[]): { request: number; count: number; added: string[]; dropped: string[] }[] {
  let prev: string[] = [];
  return offers.map((o) => {
    const added = o.tools.filter((t) => !prev.includes(t));
    const dropped = prev.filter((t) => !o.tools.includes(t));
    prev = o.tools;
    return { request: o.request, count: o.tools.length, added, dropped };
  });
}
