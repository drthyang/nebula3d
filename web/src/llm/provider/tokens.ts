// How long a request is in tokens, before it is sent. No tokenizer runs in the
// browser, so a request is measured in characters at a starting rate per kind
// of text, then scaled by what the server itself counted for the model.
//
// Prose runs about 3.5 characters a token. Number-dense JSON runs far fewer: a
// tokenizer may give every digit its own token, and RMC's review measured tool
// results at 1.64 characters a token on gemma4:26b. So tool results, call
// arguments and fenced JSON (the run's context block) start at 1.4, a
// result's rows of bare values at 1.2 (TABLE_CHARS_PER_TOKEN), and read_skill's
// Markdown at 3.0 (MARKDOWN_CHARS_PER_TOKEN).

import type { ChatMessage, ToolSpec } from "./client";

export const PROSE_CHARS_PER_TOKEN = 3.5;
export const DATA_CHARS_PER_TOKEN = 1.4;

// A tool result's rows of bare values, a column table's (tools/shared/table.ts:
// "rows": [[...], ...]) or line_profile's points ("points": [[x, y], ...]),
// run denser than other JSON: no key between the numbers. Local tokenizers
// read radial_profile's table at 1.21 characters a token and line_profile's
// points at 1.31 to 1.37 (gemma4:26b, qwen3:32b; docs/pilot-context-design.md
// §4.6), so their characters count at 1.2, under the densest measured.
export const TABLE_CHARS_PER_TOKEN = 1.2;
const ROWS_START = /"(?:rows|points)":\[\[/g;

// read_skill's results are Markdown prose, not JSON (THY-63 R5;
// docs/pilot-context-design.md C6, §4.6 and §5.7). Local tokenizers read the
// skills at 3.30 to 4.10 characters a token and the reference pages at 3.48 to
// 3.60 (gemma4:26b, qwen3:32b), where the data rate counted them 2.5 to 2.8
// times too long. They count at 3.0, 9 % under the lowest measured, so the
// estimate stays on the long side for them. What guards a model against a
// prompt cut short stays as it was: a server's own counts scale the estimate
// up (observeTokens keeps the largest ratio seen), Ollama's window is sized to
// the estimate with REPLY_RESERVE on top, and a request that leaves less than
// MIN_REPLY is refused (window.ts).
export const MARKDOWN_CHARS_PER_TOKEN = 3.0;
// A read_skill result, by its first line (skills.ts, readSkill): a skill's core
// ("Skill <name>" and a blank line), one section of a skill ('Skill <name>,
// section "…"'), or a reference page ('Reference "…" of skill <name> (…)').
// Their shortened copies (readings/compact.ts) begin the same way.
export const MARKDOWN_RESULT = /^(?:Skill [\w.-]+(?:\n\n|, section ")|Reference "[^"\n]+" of skill [\w.-]+ \()/;

/** The characters of a JSON text's rows of bare values (ROWS_START to its closing bracket), strings read as strings. */
export function tableChars(text: string): number {
  let total = 0;
  for (const m of text.matchAll(ROWS_START)) {
    const start = m.index + m[0].length - 2; // the list's opening bracket
    let depth = 0;
    let inString = false;
    let i = start;
    for (; i < text.length; i++) {
      const c = text[i];
      if (inString) {
        if (c === "\\") i++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === "[") depth++;
      else if (c === "]" && --depth === 0) break;
    }
    total += Math.min(i + 1, text.length) - start;
  }
  return total;
}

// An attached image costs the model about a thousand tokens, not the length of
// its base64 text; each message, a few for its role and the template's markers.
const IMAGE_TOKENS = 1000;
const MESSAGE_TOKENS = 5;

// Room left for the reply: thinking and answer (REPLY_RESERVE) where the window
// is ours to size, and at the least MIN_REPLY before a request is refused.
export const REPLY_RESERVE = 6144;
export const MIN_REPLY = 2048;

const FENCED_JSON = /```json\n[\s\S]*?```/g;

// A text's characters split into prose and data: fenced JSON blocks are data.
const splitText = (text: string): { prose: number; data: number } => {
  const data = (text.match(FENCED_JSON) ?? []).reduce((n, block) => n + block.length, 0);
  return { prose: text.length - data, data };
};

const messageTokens = (m: ChatMessage): number => {
  let prose = 0;
  let data = 0;
  let table = 0;
  let markdown = 0;
  let images = 0;
  for (const part of typeof m.content === "string" ? [m.content] : m.content) {
    if (typeof part !== "string" && part.type === "image_url") {
      images += 1;
      continue;
    }
    const text = typeof part === "string" ? part : part.text;
    if (m.role === "tool" && MARKDOWN_RESULT.test(text)) markdown += text.length;
    else if (m.role === "tool") {
      const rows = tableChars(text);
      table += rows;
      data += text.length - rows;
    }
    else {
      const s = splitText(text);
      prose += s.prose;
      data += s.data;
    }
  }
  for (const c of m.tool_calls ?? []) {
    prose += c.function.name.length;
    data += c.function.arguments.length;
  }
  return (
    MESSAGE_TOKENS +
    images * IMAGE_TOKENS +
    prose / PROSE_CHARS_PER_TOKEN +
    data / DATA_CHARS_PER_TOKEN +
    table / TABLE_CHARS_PER_TOKEN +
    markdown / MARKDOWN_CHARS_PER_TOKEN
  );
};

/**
 * A request's tokens at the starting rates, before any server's counts: its
 * messages, and its tools' definitions (mostly descriptions: prose).
 */
export const baseTokens = (messages: ChatMessage[], tools?: ToolSpec[]): number =>
  messages.reduce((n, m) => n + messageTokens(m), 0) +
  (tools?.length ? JSON.stringify(tools).length / PROSE_CHARS_PER_TOKEN : 0);

// What each server counted over what the starting rates gave, keyed by base
// URL + model: its tokenizer against the estimate.
const scales = new Map<string, number>();

export const tokenScale = (key: string): number => scales.get(key) ?? 1;

/** A request's counted prompt tokens against its base estimate: the largest ratio seen is kept. */
export function observeTokens(key: string, base: number, promptTokens: number): void {
  if (!(base > 0 && promptTokens > 0)) return;
  const ratio = promptTokens / base;
  // A prompt the server cut to fit counts fewer tokens than it had: a ratio past
  // reason is left out, and the largest one kept errs on the long side.
  if (ratio >= 0.25 && ratio <= 4) scales.set(key, scales.has(key) ? Math.max(ratio, tokenScale(key)) : ratio);
}

/** A request's estimated prompt tokens, scaled by its server's counts where known. */
export const estimateTokens = (base: number, key: string): number => Math.ceil(base * tokenScale(key));

// The context lengths asked of Ollama. Each change reloads the model, so a
// model keeps the largest it has run with in this session.
const WINDOW_STEPS = [8192, 16384, 32768, 65536, 131072];
const windows = new Map<string, number>();

/**
 * The context length to run an Ollama model with: the smallest step that holds
 * `needed` tokens, never below what it last ran with, and within `max`, the
 * longest it supports. Null when even `max` cannot hold them.
 */
export function ollamaWindow(key: string, needed: number, max: number | null): number | null {
  const want = Math.max(needed, windows.get(key) ?? 0);
  const step = WINDOW_STEPS.find((s) => s >= want) ?? want;
  const size = max != null ? Math.min(step, max) : step;
  if (size < needed) return null;
  windows.set(key, size);
  return size;
}

/** Run with the length the model is loaded with now (another app may hold it). */
export function keepWindow(key: string, size: number): number {
  windows.set(key, size);
  return size;
}

/**
 * What the estimate has learned of a server's model (key: base URL + model):
 * its counted prompt tokens over the starting rates' (the largest ratio seen;
 * null: none counted yet), and the context length an Ollama model last ran
 * with (null: none yet). It carries over from one reply to the next, and from
 * one validation run to the next, by design: the validation's record keeps the
 * calibration each run started from (evals/validationRun.ts).
 */
export interface TokenCalibration {
  scale: number | null;
  ollamaNumCtx: number | null;
}

export const tokenCalibration = (key: string): TokenCalibration => ({
  scale: scales.get(key) ?? null,
  ollamaNumCtx: windows.get(key) ?? null,
});

/** Forget what was measured and sized (tests). */
export function resetTokenState(): void {
  scales.clear();
  windows.clear();
}
