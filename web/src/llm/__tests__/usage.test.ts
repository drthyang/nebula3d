// Token usage: each request measured or estimated, totals over a reply and the
// conversation, and words that never pass an estimate off as a count.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "../chatStore";
import { addUsage, beginReply, endReply, estimated, measured, NO_USAGE, recordUsage, usageText } from "../usage";

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
  });
});
