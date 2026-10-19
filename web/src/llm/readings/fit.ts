// A tool's result fitted to the room the model has for it. Implementation
// behind readings/index.ts (`fit`): the executor (runToolCall) makes the
// model's copy of a result here, and keeps the whole text beside it when the
// two differ.

/**
 * A result as JSON of at most *max* characters: the whole of it, or, when
 * longer, still valid JSON. The bulkiest parts go first: the last items of the
 * longest lists, then the longest texts, each named under `left_out`, so the
 * small fields a verdict lives in stay. Cutting the text mid-way left JSON
 * that nothing could parse: the answer checks then saw no verdict at all.
 */
function fitResult(value: unknown, max: number): string {
  const whole = JSON.stringify(value) ?? "null";
  if (whole.length <= max) return whole;
  if (!value || typeof value !== "object") return `${whole.slice(0, max)}… [truncated]`;
  const copy = JSON.parse(whole) as Record<string, unknown> | unknown[];
  const leftOut: string[] = [];
  const size = (v: unknown): number => JSON.stringify(v)?.length ?? 0;
  const render = (): string =>
    Array.isArray(copy) ? JSON.stringify(copy) : JSON.stringify(leftOut.length ? { ...copy, left_out: leftOut } : copy);
  let text = render();
  for (let guard = 0; text.length > max && guard < 100_000; guard++) {
    // Follow the bulkiest member down: a list loses its last item, an object
    // its bulkiest leaf.
    let node: Record<string, unknown> | unknown[] = copy;
    let path = "";
    let trimmed = false;
    for (;;) {
      if (Array.isArray(node)) {
        if (!node.length) break;
        node.pop();
        const note = `${path || "the list"}: its last items`;
        if (!leftOut.includes(note)) leftOut.push(note);
        trimmed = true;
        break;
      }
      const entries = Object.entries(node);
      if (!entries.length) break;
      const [key, child] = entries.reduce((a, b) => (size(b[1]) > size(a[1]) ? b : a));
      if (child !== null && typeof child === "object" && Object.keys(child).length > 0) {
        path = path ? `${path}.${key}` : key;
        node = child as Record<string, unknown> | unknown[];
        continue;
      }
      delete node[key];
      leftOut.push(path ? `${path}.${key}` : key);
      trimmed = true;
      break;
    }
    if (!trimmed) break;
    text = render();
  }
  return text.length <= max ? text : `${text.slice(0, max)}… [truncated]`;
}

/**
 * What the model reads of a tool's result, at most *max* characters (with the
 * marker, where a text is cut), and the whole text beside it when the two
 * differ. A text result (a skill) goes as written, cut at *max* when longer;
 * anything else as JSON, fitted to valid JSON (fitResult).
 */
export function fit(value: unknown, max: number): { text: string; full?: string } {
  const whole = typeof value === "string" ? value : (JSON.stringify(value) ?? "null");
  const text =
    whole.length <= max ? whole : typeof value === "string" ? `${whole.slice(0, max)}… [truncated]` : fitResult(value, max);
  return text === whole ? { text } : { text, full: whole };
}
