// One reply into the chat store: an answer becomes a turn, and so does a reply
// that came back without one, so a question never ends in silence.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "../chatStore";
import { askAssistant } from "../session";
import { measured, notCounted } from "../usage";

const agent = vi.hoisted(() => ({ runAgent: vi.fn() }));
vi.mock("../agent", () => agent);

const ask = () => askAssistant({ label: "Process the data", messages: [], tools: [], ctx: null });

beforeEach(() => {
  useChatStore.setState({ turns: [], busy: false, live: null, error: null, usage: null });
});

describe("askAssistant", () => {
  it("adds the answer as a turn", async () => {
    agent.runAgent.mockResolvedValue({ content: "Done.", reasoning: "", steps: [] });
    await ask();
    expect(useChatStore.getState().turns.map((t) => [t.role, t.content])).toEqual([
      ["user", "Process the data"],
      ["assistant", "Done."],
    ]);
    expect(useChatStore.getState().busy).toBe(false);
  });

  it("keeps a reply that only thought, and says it has no answer", async () => {
    agent.runAgent.mockResolvedValue({ content: "", reasoning: "Let me see…", steps: [] });
    await ask();
    const reply = useChatStore.getState().turns[1];
    expect(reply).toMatchObject({ role: "assistant", reasoning: "Let me see…" });
    expect(reply.note).toMatch(/stopped after thinking, without an answer/);
  });

  it("says so when the reply came back empty", async () => {
    agent.runAgent.mockResolvedValue({ content: "", reasoning: "", steps: [] });
    await ask();
    expect(useChatStore.getState().turns[1].note).toMatch(/empty reply/);
  });

  it("keeps the steps of a reply that ended with an error, with the error", async () => {
    const step = { id: "0:a", name: "tune_pipeline", args: {}, status: "done" as const, summary: "Tuned" };
    agent.runAgent.mockImplementation(async ({ onProgress }) => {
      onProgress({ content: "Tuning done; now", reasoning: "", steps: [step] });
      throw new Error("Engine protocol predict stream returned an error");
    });
    await ask();
    const { turns, error, busy } = useChatStore.getState();
    expect(turns[1]).toMatchObject({ role: "assistant", content: "Tuning done; now", steps: [step] });
    expect(turns[1].note).toMatch(/ended with an error: Engine protocol predict stream/);
    expect(error).toBeNull();
    expect(busy).toBe(false);
  });

  it("keeps a step that was running when the user stopped the reply as stopped, not running", async () => {
    const done = { id: "0:a", name: "assess_stage", args: {}, status: "done" as const, summary: "clean" };
    const running = { id: "1:b", name: "run_pipeline", args: {}, status: "running" as const, progress: "2/6 Bragg punch" };
    agent.runAgent.mockImplementation(async ({ onProgress }) => {
      onProgress({ content: "", reasoning: "", steps: [done, running] });
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    await ask();
    const steps = useChatStore.getState().turns[1].steps!;
    expect(steps.map((st) => st.status)).toEqual(["done", "stopped"]);
    expect(steps[1]).toMatchObject({ summary: "you stopped the reply" });
    expect(steps[1].progress).toBeUndefined();
    expect(useChatStore.getState().turns[1].note).toBe("Stopped.");
  });

  it("keeps a step that was running when an error ended the reply as stopped", async () => {
    const running = { id: "0:a", name: "tune_pipeline", args: {}, status: "running" as const };
    agent.runAgent.mockImplementation(async ({ onProgress }) => {
      onProgress({ content: "", reasoning: "", steps: [running] });
      throw new Error("socket hang up");
    });
    await ask();
    expect(useChatStore.getState().turns[1].steps![0]).toMatchObject({ status: "stopped", summary: "the reply ended with an error" });
  });

  // The conversation's total as it was live, and as a restored conversation rebuilds it from its turns.
  const totals = () => {
    const live = useChatStore.getState().usage;
    useChatStore.getState().restoreTurns(JSON.parse(JSON.stringify(useChatStore.getState().turns)));
    return { live, restored: useChatStore.getState().usage };
  };

  it("keeps the requests of a reply that failed with nothing to keep with its question, so a restored total agrees", async () => {
    agent.runAgent.mockImplementation(async ({ onUsage }) => {
      onUsage(measured({ input: 900, output: 40 })); // a request that completed
      onUsage(notCounted()); // and one that did not
      throw new Error("HTTP 500");
    });
    await ask();
    expect(useChatStore.getState().turns).toHaveLength(1);
    expect(useChatStore.getState().error).toBe("HTTP 500");
    const { live, restored } = totals();
    expect(live).toMatchObject({ input: 900, output: 40, requests: 1, uncounted: 1 });
    expect(restored).toEqual(live);
  });

  it("keeps the request of a reply stopped before it wrote anything with its question", async () => {
    agent.runAgent.mockImplementation(async ({ onUsage }) => {
      onUsage(notCounted());
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    await ask();
    const { live, restored } = totals();
    expect(live).toMatchObject({ requests: 0, uncounted: 1 });
    expect(restored).toEqual(live);
  });

  it("totals a kept stopped reply the same restored, its uncounted request included", async () => {
    agent.runAgent.mockImplementation(async ({ onUsage, onProgress }) => {
      onUsage(measured({ input: 100, output: 10 }));
      onProgress({ content: "Half", reasoning: "", steps: [] });
      onUsage(notCounted());
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    await ask();
    expect(useChatStore.getState().turns[1].tokens).toMatchObject({ requests: 1, uncounted: 1 });
    const { live, restored } = totals();
    expect(restored).toEqual(live);
  });

  it("shows an error that came before anything was written as the chat's error", async () => {
    agent.runAgent.mockRejectedValue(new Error("HTTP 500"));
    await ask();
    expect(useChatStore.getState().turns).toHaveLength(1);
    expect(useChatStore.getState().error).toBe("HTTP 500");
  });
});
