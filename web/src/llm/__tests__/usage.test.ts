// Token usage: each request measured or estimated, totals over a reply and the
// conversation, and words that never pass an estimate off as a count.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "../chatStore";
import { addUsage, beginReply, endReply, estimated, measured, NO_USAGE, notCounted, ranNothing, recordUsage, usageText } from "../usage";

beforeEach(() => {
  vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  useChatStore.setState({ turns: [], usage: null });
});

describe("usage", () => {
  it("says the server's counts as they are, with the cached part", () => {
    expect(usageText(measured({ input: 12345, output: 678, cacheRead: 9800 }))).toBe("12,345 tokens in (9,800 read from the prompt cache) · 678 out · 1 request");
    expect(usageText(measured({ input: 500, output: 40, cacheWrite: 450 }))).toBe("500 tokens in (450 written to it) · 40 out · 1 request");
    expect(usageText(NO_USAGE)).toBeNull();
  });

  it("marks any estimated part, and says how much of it is", () => {
    expect(usageText(estimated(1000.4, 99.6))).toBe("≈ 1,000 tokens in · ≈ 100 out · 1 request (estimated: the server reported no token counts)");
    const mixed = addUsage(measured({ input: 100, output: 10 }), estimated(50, 5));
    expect(usageText(mixed)).toBe("≈ 150 tokens in · ≈ 15 out · 2 requests (1 of them estimated: the server reported no counts for them)");
  });

  it("says the requests sent but not counted after the total, never as if the total were whole", () => {
    const stopped = addUsage(addUsage(measured({ input: 100, output: 10 }), measured({ input: 200, output: 20 })), notCounted());
    expect(usageText(stopped)).toBe("300 tokens in · 30 out · 2 requests · +1 request not counted (stopped, failed or asked again: no counts from the server)");
    expect(usageText(addUsage(stopped, notCounted()))).toMatch(/· 2 requests · \+2 requests not counted/);
    // Only requests that never completed: said, not hidden.
    expect(usageText(notCounted())).toBe("1 request not counted (stopped, failed or asked again: no counts from the server)");
    // None: the field stays out, as in a saved total from before.
    expect(addUsage(measured({ input: 1, output: 1 }), estimated(1, 1))).not.toHaveProperty("uncounted");
  });

  it("tells a request that ran nothing (refused, never reached) from one that did not complete", () => {
    expect(ranNothing(Object.assign(new Error("HTTP 401: bad key"), { status: 401 }))).toBe(true);
    expect(ranNothing(Object.assign(new Error("HTTP 429: slow down"), { status: 429 }))).toBe(true);
    expect(ranNothing(new TypeError("Failed to fetch"))).toBe(true);
    expect(ranNothing(new DOMException("Aborted", "AbortError"))).toBe(false);
    expect(ranNothing(Object.assign(new Error("HTTP 500: crashed"), { status: 500 }))).toBe(false);
    expect(ranNothing(Object.assign(new Error("does not match the expected tool call format"), { status: 400 }))).toBe(false);
  });

  it("adds a reply's requests, a tuning run's inside it included, to the reply and the conversation", () => {
    recordUsage(measured({ input: 10, output: 1 })); // before any reply: the conversation only
    beginReply();
    recordUsage(measured({ input: 100, output: 20 })); // the agent's request
    recordUsage(estimated(40, 4)); // a tuning request during the reply
    const reply = endReply();
    expect(reply).toEqual({ input: 140, output: 24, cacheRead: 0, cacheWrite: 0, requests: 2, estimated: 1 });
    expect(useChatStore.getState().usage).toEqual({ input: 150, output: 25, cacheRead: 0, cacheWrite: 0, requests: 3, estimated: 1 });
    expect(endReply()).toEqual(NO_USAGE); // no reply under way
  });

  it("starts again on Clear, and a restored conversation totals its replies", () => {
    recordUsage(measured({ input: 10, output: 1 }));
    useChatStore.getState().clear();
    expect(useChatStore.getState().usage).toBeNull();
    useChatStore.getState().restoreTurns([
      { id: 1, role: "user", content: "q" },
      { id: 2, role: "assistant", content: "a", tokens: measured({ input: 30, output: 3 }) },
      { id: 3, role: "assistant", content: "b", tokens: estimated(20, 2) },
    ]);
    expect(useChatStore.getState().usage).toEqual({ input: 50, output: 5, cacheRead: 0, cacheWrite: 0, requests: 2, estimated: 1 });
    // A stopped reply's uncounted request comes back with it.
    useChatStore.getState().restoreTurns([{ id: 4, role: "assistant", content: "c", tokens: addUsage(measured({ input: 30, output: 3 }), notCounted()) }]);
    expect(useChatStore.getState().usage).toMatchObject({ requests: 1, uncounted: 1 });
  });
});
