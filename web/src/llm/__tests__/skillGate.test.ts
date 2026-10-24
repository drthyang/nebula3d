// The skill gate holds within a reply (plan 1.7): a stage's settings change
// only after its skill has been read in this reply, or while the skill's text
// is in the messages the reply was sent. The chat sends an earlier turn as its
// text alone, so a skill read there is gone from the next reply, and the
// refusal asks for it again.
//
// Through the chat's own path: askAssistant into the chat store, each reply's
// messages built from the earlier turns' text and its context from the turns
// (replyContext), as ChatView builds them, the real agent loop and tools, and a
// scripted model. Hermetic: no model is loaded, no backend or API is called.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../api/types";
import { usePipelineStore } from "../../state/pipelineStore";
import type { AgentStep } from "../agent";
import { useChatStore } from "../chatStore";
import { buildChatMessages, buildStageReviewMessages, STAGE_REVIEW_LABELS, type ReviewStage } from "../prompts/templates";
import type { ChatMessage, StreamDelta } from "../provider/client";
import { askAssistant, replyContext } from "../session";
import { saveSettings } from "../settings";
import { readSkill, skillNamed } from "../skills";
import { CHAT_TOOLS, type ToolContext } from "../tools";

const client = vi.hoisted(() => ({ streamChat: vi.fn() }));
vi.mock("../provider/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../provider/client")>()),
  streamChat: client.streamChat,
}));

const dataset = { id: "demo", raw_name: "demo.nxs", stem: "demo", temperature: null, stages: [] } as unknown as Dataset;
const toolContext: ToolContext = { dataset, datasets: [dataset] };

const FIRST =
  'Error: read the method first: call read_skill with name "reduction-qc". It is how the user works on the flatten stage, ' +
  "and this change waits until it has been read in this conversation.";
const AGAIN =
  'Error: read the method again: call read_skill with name "reduction-qc". It was read earlier in the conversation, but its ' +
  "text is not in this reply. It is how the user works on the flatten stage, and this change waits until it has been read in this reply.";

/** A round of the scripted model: one call. */
const calls = (id: string, name: string, args: object): StreamDelta[] => [
  { toolCalls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }] },
];
const answer = (content: string): StreamDelta[] => [{ content }];

/**
 * One request as the chat sends it: a question (ChatView's ask), with the
 * earlier turns as their text, or a stage review (its runReview), with none;
 * either way the reply's context from the turns. Returns every request's
 * messages and the reply's steps.
 */
async function ask(text: string | { review: ReviewStage }, script: StreamDelta[][]): Promise<{ sent: ChatMessage[][]; steps: AgentStep[] }> {
  const sent: ChatMessage[][] = [];
  client.streamChat.mockImplementation((args: { messages: ChatMessage[] }) => {
    sent.push([...args.messages]);
    const reply = script.shift() ?? [];
    return (async function* () {
      for (const d of reply) yield d;
    })();
  });
  const turns = useChatStore.getState().turns;
  const history = turns.map(({ role, content }) => ({ role, content }));
  await askAssistant({
    label: typeof text === "string" ? text : STAGE_REVIEW_LABELS[text.review],
    messages:
      typeof text === "string"
        ? buildChatMessages({} as never, history, text, null, { tools: true })
        : buildStageReviewMessages({} as never, text.review, null, { tools: true }),
    tools: CHAT_TOOLS,
    ctx: replyContext(toolContext, turns),
  });
  expect(script).toEqual([]); // the reply ran as scripted
  const after = useChatStore.getState().turns;
  const last = after[after.length - 1];
  expect(last.role).toBe("assistant");
  return { sent, steps: last.steps ?? [] };
}

const outcome = (steps: AgentStep[]) => steps.map((s) => [s.name, s.status]);
const carries = (messages: ChatMessage[], text: string) => messages.some((m) => typeof m.content === "string" && m.content.includes(text));

beforeEach(() => {
  // A cloud URL: no window plan to fetch, every tool offered, nothing shortened.
  saveSettings({ baseUrl: "https://scripted.invalid/v1", model: "scripted", useTools: true, followViews: false });
  useChatStore.setState({ turns: [], busy: false, live: null, error: null });
  usePipelineStore.setState({ running: false, flattenQ2: false, flattenFitQMax: "" });
  client.streamChat.mockReset();
});
afterEach(() => usePipelineStore.setState(usePipelineStore.getInitialState()));

describe("the skill gate, over a conversation", () => {
  it("opens in the reply that read the skill, and asks for it again in the next reply, which it opens once it is read there", async () => {
    // Turn 1: read the method, then change a flatten setting. It goes through.
    const one = await ask("Fit the flatten's Q² term.", [
      calls("a1", "read_skill", { name: "reduction-qc" }),
      calls("a2", "update_settings", { changes: { flattenQ2: true } }),
      answer("Done."),
    ]);
    expect(outcome(one.steps)).toEqual([
      ["read_skill", "done"],
      ["update_settings", "done"],
    ]);
    expect(usePipelineStore.getState().flattenQ2).toBe(true);

    // Turn 2: another flatten change, without reading the method. Turn 1's
    // text came with the messages; the skill's text did not.
    const two = await ask("Now end the flatten's fit at 12 Å⁻¹.", [
      calls("b1", "update_settings", { changes: { flattenFitQMax: 12 } }),
      calls("b2", "read_skill", { name: "reduction-qc" }),
      calls("b3", "update_settings", { changes: { flattenFitQMax: 12 } }),
      answer("Done."),
    ]);
    const body = skillNamed("reduction-qc")!.body;
    expect(carries(two.sent[0], "Fit the flatten's Q² term.")).toBe(true);
    expect(carries(two.sent[0], body)).toBe(false);
    expect(outcome(two.steps)).toEqual([
      ["update_settings", "error"],
      ["read_skill", "done"],
      ["update_settings", "done"],
    ]);
    expect(two.steps[0]).toMatchObject({ result: AGAIN, summary: "refused until its skill is read" });
    // Read in this reply, the change goes through.
    expect(usePipelineStore.getState().flattenFitQMax).toBe("12");
  });

  it("is unchanged in a single reply: a change before the read is refused as it always was, and one after it goes through", async () => {
    const one = await ask("End the flatten's fit at 12 Å⁻¹.", [
      calls("a1", "update_settings", { changes: { flattenFitQMax: 12 } }),
      calls("a2", "read_skill", { name: "reduction-qc" }),
      calls("a3", "update_settings", { changes: { flattenFitQMax: 12 } }),
      answer("Done."),
    ]);
    expect(outcome(one.steps)).toEqual([
      ["update_settings", "error"],
      ["read_skill", "done"],
      ["update_settings", "done"],
    ]);
    expect(one.steps[0].result).toBe(FIRST);
    expect(usePipelineStore.getState().flattenFitQMax).toBe("12");
  });

  it("opens for a skill whose text the reply's messages carry, though it was not read in the reply", async () => {
    // The user pastes the method into the question: its text is in front of the model.
    const one = await ask(`${readSkill("reduction-qc")}\n\nBy that method, fit the flatten's Q² term.`, [
      calls("a1", "update_settings", { changes: { flattenQ2: true } }),
      answer("Done."),
    ]);
    expect(outcome(one.steps)).toEqual([["update_settings", "done"]]);
    expect(usePipelineStore.getState().flattenQ2).toBe(true);
  });

  it("asks for a skill again in a stage review, which sends no earlier turn", async () => {
    await ask("Fit the flatten's Q² term.", [
      calls("a1", "read_skill", { name: "reduction-qc" }),
      calls("a2", "update_settings", { changes: { flattenQ2: true } }),
      answer("Done."),
    ]);
    const review = await ask({ review: "flatten" }, [calls("b1", "update_settings", { changes: { flattenFitQMax: 12 } }), answer("Done.")]);
    expect(outcome(review.steps)).toEqual([["update_settings", "error"]]);
    expect(review.steps[0].result).toBe(AGAIN);
    expect(usePipelineStore.getState().flattenFitQMax).toBe("");
  });
});

describe("replyContext", () => {
  const step = (name: string, args: Record<string, unknown>, status: AgentStep["status"] = "done", result = "r"): AgentStep => ({
    id: "s",
    name,
    args,
    status,
    result,
  });

  it("counts no skill as read, keeps the earlier reads for the refusal and the earlier tool calls that ran for the answer checks", () => {
    const turns = [
      { steps: [step("read_skill", { name: "reduction-qc" }, "done", "Skill reduction-qc"), step("read_skill", { name: "bragg-node-audit", reference: "x" })] },
      { steps: [step("read_skill", { name: "delta-pdf-interpretation" }, "error", "Error: no")] },
      {},
    ];
    const ctx = replyContext({ ...toolContext, skillsRead: new Set(["reduction-qc"]) }, turns);
    expect(ctx.skillsRead).toEqual(new Set());
    expect(ctx.skillsReadEarlier).toEqual(new Set(["reduction-qc"]));
    expect(ctx.earlierSteps?.map((s) => s.result)).toEqual(["Skill reduction-qc", "r"]);
    expect([ctx.dataset, ctx.datasets]).toEqual([dataset, [dataset]]);
  });
});
