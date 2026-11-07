// What an auto run spends on a priced model, against its spend limit (the
// user's default of 2026-11-07: $2 an auto run on Claude). Claude's published
// prices per million tokens (Anthropic's first-party API rates, the
// claude-api reference's table cached 2026-10-06): input, output, a prompt
// cache read (a tenth of the input price where the table states none) and a
// cache write (1.25 times the input price, the five-minute cache). A Claude
// model the table does not name is priced as the dearest one, so the limit
// stops a run early rather than late. A local model costs nothing, and a
// cloud model outside Claude has no price here: the run's tokens are counted
// and shown, and no spend limit applies (the run's other limits do).

import { isAnthropicUrl } from "../provider/anthropic";
import type { Usage } from "../usage";

export interface Price {
  input: number; // US dollars per million tokens; `input` counts the cached tokens too
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const priced = (input: number, output: number, cacheRead = input / 10): Price => ({ input, output, cacheRead, cacheWrite: input * 1.25 });

// By the model id's family, most specific first.
const CLAUDE_PRICES: [RegExp, Price][] = [
  [/^claude-(?:fable|mythos)-/, priced(10, 50)],
  [/^claude-opus-5-5/, priced(4, 20, 0.2)],
  [/^claude-opus-(?:5|4-[5-9])/, priced(5, 25)],
  [/^claude-sonnet-5-5/, priced(2, 10, 0.2)],
  [/^claude-sonnet-5/, priced(2, 10)],
  [/^claude-sonnet-4/, priced(3, 15)],
  // Prompts up to 100k tokens, as an auto reply's are.
  [/^claude-haiku-5/, priced(0.1, 0.5)],
  [/^claude-haiku-4/, priced(1, 5)],
];
/** The dearest price in the table: a Claude model it does not name. */
export const DEAREST: Price = priced(10, 50);

/** The price of the model on `baseUrl`, or null: a local model, or a cloud one outside Claude. */
export function priceOf(settings: { baseUrl: string; model: string }): Price | null {
  if (!isAnthropicUrl(settings.baseUrl)) return null;
  return CLAUDE_PRICES.find(([re]) => re.test(settings.model))?.[1] ?? DEAREST;
}

/** What `usage` cost at `price`, in US dollars. An estimated count is priced as a measured one. */
export function costOf(usage: Pick<Usage, "input" | "output" | "cacheRead" | "cacheWrite">, price: Price): number {
  const plain = Math.max(0, usage.input - usage.cacheRead - usage.cacheWrite);
  return (plain * price.input + usage.cacheRead * price.cacheRead + usage.cacheWrite * price.cacheWrite + usage.output * price.output) / 1e6;
}

/** A dollar amount as the run shows it: "$0.42". */
export const usd = (x: number): string => `$${x < 0.01 && x > 0 ? x.toFixed(4) : x.toFixed(2)}`;
