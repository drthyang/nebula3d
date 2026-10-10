// One reply into the chat store: an answer becomes a turn, and so does a reply
// that came back without one, so a question never ends in silence.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "../chatStore";
import { askAssistant } from "../session";

const agent = vi.hoisted(() => ({ runAgent: vi.fn() }));
vi.mock("../agent", () => agent);

const ask = () => askAssistant({ label: "Process the data", messages: [], tools: [], ctx: null });

beforeEach(() => {
  useChatStore.setState({ turns: [], busy: false, live: null, error: null });
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
});
