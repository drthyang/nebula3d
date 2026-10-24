// The parse behind `found` (readings/index.ts). Each text is parsed once: the
// value is cached by the text and deep-frozen, so every reader of a result
// shares one copy that none can change, and a step copied by the loop (or
// mapped back from a record) finds the parse of its text already made. The
// cache is bounded: the oldest texts go first, past MAX_TEXTS texts or
// MAX_CHARS characters, the newest staying whatever its size.

import type { Found } from "./index";

export const MAX_TEXTS = 256;
export const MAX_CHARS = 4_000_000;

const cache = new Map<string, Found | null>();
let chars = 0;

/** A JSON value with every object and list in it frozen. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** The text parsed: an object, deep-frozen, or null (not JSON, or JSON but no object). Never throws. */
export function parsed(text: string): Found | null {
  if (cache.has(text)) {
    // The newest again: it goes last of the texts to drop.
    const hit = cache.get(text) ?? null;
    cache.delete(text);
    cache.set(text, hit);
    return hit;
  }
  let value: Found | null = null;
  try {
    const v: unknown = JSON.parse(text);
    value = v && typeof v === "object" && !Array.isArray(v) ? deepFreeze(v as Found) : null;
  } catch {
    value = null; // not JSON: a skill's text, an error, a text cut mid-way
  }
  cache.set(text, value);
  chars += text.length;
  for (const oldest of cache.keys()) {
    if (cache.size <= 1 || (cache.size <= MAX_TEXTS && chars <= MAX_CHARS)) break;
    cache.delete(oldest);
    chars -= oldest.length;
  }
  return value;
}
