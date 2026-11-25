// THY-84: the limits on an answer's revision, which the model never sees: its
// own output cap, and a stop when it repeats itself.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Dataset } from "../../api/types";
import { CUT_OFF_NOTE, REVISION_STOPPED_NOTE, runAgent } from "../agent";
import type { ChatMessage, StreamDelta } from "../provider/client";
import { resetTokenState } from "../provider/tokens";
import {
  endsRepeating,
  REPEAT_TAIL,
  REPEAT_TIMES,
  REVISION_LENGTH_FACTOR,
  REVISION_MIN_TOKENS,
  revisionOutputCap,
} from "../revisionLimits";
import { autoPolicyOf } from "../runPolicy";
import { DEFAULT_SETTINGS } from "../settings";
import type { AgentTool } from "../tools";

const client = vi.hoisted(() => ({ streamChat: vi.fn() }));
vi.mock("../provider/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../provider/client")>()),
  streamChat: client.streamChat,
}));

describe("the revision's own output cap", () => {
  it("is twice the answer it revises, at least the floor, within the loop's cap", () => {
    expect(revisionOutputCap("short", 16_000)).toBe(REVISION_MIN_TOKENS);
    const long = "x".repeat(35_000); // 10,000 tokens at 3.5 characters a token
    expect(revisionOutputCap(long, null)).toBe(REVISION_LENGTH_FACTOR * 10_000);
    expect(revisionOutputCap(long, 16_000)).toBe(16_000);
    expect(revisionOutputCap("short", 2_000)).toBe(2_000);
  });
});

/** A report as a model writes one: headings, numbers and repeated words, no loop. */
const REPORT = Array.from(
  { length: 40 },
  (_, i) =>
    `### Stage ${i + 1}\n* **Verdict**: meets its goal. The floor trend is 0.0${i % 10} and the span ${0.5 + i / 100} of the noise; ` +
    `the check ran on hk0, h0l and 0kl. Nothing is left for the user to decide here.\n`,
).join("");

describe("a revision that repeats itself", () => {
  it("is told apart from a long answer that restates words, headings and numbers", () => {
    expect(REPORT.length).toBeGreaterThan(6_000);
    expect(endsRepeating(REPORT)).toBe(false);
    expect(endsRepeating("too short")).toBe(false);
  });

  it("is found once its tail recurs, whatever the period of the loop", () => {
    const loop = (unit: string, n: number) => REPORT.slice(0, 2_000) + unit.repeat(n);
    expect(endsRepeating(loop("The pedestal is removed. ", 40))).toBe(true); // a short period
    const sentence = "The flatten meets its goal: the floor trend 0.04 and the span 0.6 of the noise, measured on the three planes through the origin, after the tuning kept trial 2 of 3.\n";
    expect(endsRepeating(loop(sentence, REPEAT_TIMES + 1))).toBe(true); // a longer one
    expect(endsRepeating(loop(sentence, 1))).toBe(false);
    expect(sentence.length).toBeLessThan(REPEAT_TAIL * 2);
  });

  it("ignores a tail of white space", () => {
    expect(endsRepeating(REPORT + " ".repeat(REPEAT_TAIL * REPEAT_TIMES))).toBe(false);
  });
});

// --------------------------------------------------------------- in the agent loop

const echo: AgentTool = {
  name: "echo",
  description: "returns its input",
  parameters: { type: "object", properties: { x: { type: "number" } } },
  run: async (args) => ({ result: { got: args.x }, summary: `got ${args.x}` }),
};
const call = { id: "c1", type: "function" as const, function: { name: "echo", arguments: JSON.stringify({ x: 1 }) } };
const ctx = { dataset: { id: "d" } as Dataset, datasets: [] };
const settings = { ...DEFAULT_SETTINGS, model: `m-${Math.random()}` };
const policy = autoPolicyOf(settings);
// A number no tool returned: the answer checks send it back once.
const REJECTED = "The volume has 7777 voxels.";

/** Plays the replies in turn; records each request's output cap, and how many deltas each stream gave before it was closed. */
function script(replies: StreamDelta[][]) {
  const caps: (number | undefined)[] = [];
  const given: number[] = [];
  client.streamChat.mockImplementation((args: { maxTokens?: number; messages: ChatMessage[] }) => {
    caps.push(args.maxTokens);
    const reply = replies.shift() ?? [];
    const i = given.push(0) - 1;
    return (async function* () {
      for (const d of reply) {
        given[i] += 1;
        yield d;
      }
    })();
  });
  return { caps, given };
}

beforeEach(() => {
  client.streamChat.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
  resetTokenState();
});

const run = (onTruncated?: (cut: { request: number; reason: string }) => void) =>
  runAgent({ messages: [{ role: "user", content: "hi" }], tools: [echo], ctx, settings, policy, signal: new AbortController().signal, onTruncated });

describe("the revision in the agent loop", () => {
  it("asks for its own cap, and the requests before it for the loop's", async () => {
    const { caps } = script([[{ toolCalls: [call] }], [{ content: REJECTED }], [{ content: "The volume's size was not measured." }]]);
    const r = await run();
    expect(caps).toEqual([policy.outputCap.loop, policy.outputCap.loop, revisionOutputCap(REJECTED, policy.outputCap.loop)]);
    expect(caps[2]).toBeLessThan(policy.outputCap.loop!);
    expect(r.content).toBe("The volume's size was not measured.");
  });

  it("is stopped once it repeats itself: the stream is closed, and the answer it revised stands with its note", async () => {
    const loop = Array.from({ length: 400 }, () => ({ content: "The volume has 7777 voxels, as the tool found. " }));
    const { given } = script([[{ toolCalls: [call] }], [{ content: REJECTED }], loop]);
    const cuts: { request: number; reason: string }[] = [];
    const r = await run((c) => cuts.push(c));
    expect(given[2]).toBeLessThan(loop.length); // not read to its end
    expect(cuts).toEqual([{ request: 3, reason: "repetition" }]);
    expect(r.content).toBe(REJECTED);
    expect(r.note).toContain(REVISION_STOPPED_NOTE);
    expect(r.note).not.toContain(CUT_OFF_NOTE);
  });

  it("cut at its cap keeps the answer it revised, with the loop's note on a cut", async () => {
    script([[{ toolCalls: [call] }], [{ content: REJECTED }], [{ content: "The volume has" }, { truncated: true, stopReason: "length" }]]);
    const r = await run();
    expect(r.content).toBe(REJECTED);
    expect(r.note).toContain(CUT_OFF_NOTE);
    expect(r.note).not.toContain(REVISION_STOPPED_NOTE);
  });

  it("leaves a reply cut before any send-back with the loop's note", async () => {
    script([[{ content: "Let me" }, { truncated: true, stopReason: "length" }]]);
    const r = await run();
    expect(r.note).toBe(CUT_OFF_NOTE);
  });
});
