// The Pilot's arms are the Pilot as it ships, and arm C is arm B with the
// skills' switch off (skills.ts) and nothing else. Run through the real agent
// loop against a scripted model server (no model): what goes over the wire,
// request by request, must differ between B and C only by what the switch
// changes: read_skill is not offered, the system prompt has no skills' section
// and its other sections no inference, and a tool whose description holds
// inference has its definitions only (descriptionWithoutSkills, inference.ts),
// whatever tools the shipped code offers a model.

import { afterEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../api/types";
import { runAgent } from "../agent";
import { toolsFor } from "../localTools";
import { SYSTEM, TOOLS } from "../prompts/system";
import { systemPrompt } from "../prompts/templates";
import { allSkills, skillsPrompt } from "../skills";
import { CHAT_TOOLS, type AgentTool } from "../tools";
import { OfferRecorder, offerChanges, toolNamesIn } from "./offers";
import { armSetup, TASK, type Arm } from "./validation";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const dataset: Dataset = { id: "v000000-B1", temperature: null, raw_name: "v000000_B1.nxs", stem: "v000000_B1", stages: [] };

// Every tool answers with a stub: the agent loop is real, the backend is not.
const STUBBED: AgentTool[] = CHAT_TOOLS.map((t) => ({ ...t, run: async () => ({ result: { stub: t.name }, summary: `${t.name} stub` }) }));

type Spec = { type: string; function: { name: string; description: string; parameters: unknown } };
type Body = { model: string; messages: { role: string; content?: unknown; tool_calls?: unknown }[]; tools?: Spec[] } & Record<string, unknown>;

const sse = (...chunks: unknown[]): Response =>
  new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });

/**
 * A scripted model server: it calls two tools in the first round, one in the
 * second, and answers in the third. Returns the request bodies it was sent.
 */
function scriptedServer(): Body[] {
  const sent: Body[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.endsWith("/chat/completions")) return new Response("{}", { status: 404 });
    const body = JSON.parse(String(init?.body)) as Body;
    sent.push(body);
    const round = body.messages.filter((m) => m.role === "assistant" && m.tool_calls).length;
    const call = (i: number, name: string) => ({ choices: [{ delta: { tool_calls: [{ index: i, id: `c${round}${i}`, type: "function", function: { name, arguments: "{}" } }] } }] });
    if (round === 0) return sse(call(0, "describe_dataset"), call(1, "assess_stage"), { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    if (round === 1) return sse(call(0, "ub_check"), { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    return sse({ choices: [{ delta: { content: "Done." } }] }, { choices: [{ delta: {}, finish_reason: "stop" }] });
  }) as typeof fetch;
  return sent;
}

async function runArm(arm: Arm, baseUrl: string) {
  const sent = scriptedServer();
  const recorder = new OfferRecorder();
  const stop = recorder.install();
  try {
    const setup = armSetup(arm, {} as never);
    const result = await runAgent({
      messages: setup.messages,
      tools: STUBBED,
      ctx: { dataset, datasets: [dataset], skills: setup.skills, skillsRead: setup.skillsRead },
      settings: { baseUrl, model: "m", apiKey: "", temperature: 0.2, attachImages: false, useTools: true, followViews: false },
      signal: new AbortController().signal,
      usage: true,
    });
    return { sent, offers: recorder.offers, result };
  } finally {
    stop();
  }
}

describe("what is offered, as it goes over the wire", () => {
  it("reads the tool names of an OpenAI-style request and of an Anthropic one", () => {
    expect(toolNamesIn({ tools: [{ type: "function", function: { name: "a" } }, { type: "function", function: { name: "b" } }] })).toEqual(["a", "b"]);
    expect(toolNamesIn({ tools: [{ name: "c", input_schema: {} }] })).toEqual(["c"]);
    expect(toolNamesIn({ model: "m" })).toEqual([]);
    expect(toolNamesIn(null)).toEqual([]);
  });

  it("records each chat request's tools, ignores any other request, and puts fetch back", async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response("{}");
    }) as typeof fetch;
    const mine = globalThis.fetch;
    const recorder = new OfferRecorder();
    const stop = recorder.install();
    const body = (names: string[]) => JSON.stringify({ tools: names.map((name) => ({ type: "function", function: { name } })) });
    await fetch("http://localhost:1234/v1/chat/completions", { method: "POST", body: body(["a", "b"]) });
    await fetch("http://localhost:1234/api/v0/models");
    await fetch("http://localhost:1234/v1/chat/completions", { method: "POST", body: body(["a", "b", "c"]) });
    await fetch("https://api.anthropic.com/v1/messages", { method: "POST", body: JSON.stringify({ tools: [{ name: "a" }] }) });
    stop();
    expect(globalThis.fetch).toBe(mine);
    expect(recorder.offers).toEqual([
      { request: 1, tools: ["a", "b"] },
      { request: 2, tools: ["a", "b", "c"] },
      { request: 3, tools: ["a"] },
    ]);
    expect(seen).toHaveLength(4); // every request still went through
    expect(offerChanges(recorder.offers)).toEqual([
      { request: 1, count: 2, added: ["a", "b"], dropped: [] },
      { request: 2, count: 3, added: ["c"], dropped: [] },
      { request: 3, count: 1, added: [], dropped: ["b", "c"] },
    ]);
  });
});

describe.each([
  ["a local model (LM Studio)", "http://localhost:1234/v1"],
  ["a cloud model", "https://api.example.com/v1"],
])("arms B and C on %s", (_label, baseUrl) => {
  it("differ only by what the switch changes, on every request", async () => {
    const b = await runArm("B", baseUrl);
    const c = await runArm("C", baseUrl);
    expect(b.offers.length).toBeGreaterThanOrEqual(3);
    expect(c.offers.length).toBe(b.offers.length);
    expect(b.result.steps.map((s) => s.name)).toEqual(["describe_dataset", "assess_stage", "ub_check"]); // same script, same steps
    expect(c.result.steps.map((s) => s.name)).toEqual(["describe_dataset", "assess_stage", "ub_check"]);
    b.offers.forEach((offer, i) => {
      expect(offer.tools).toContain("read_skill"); // B offers it (read_skill is among the reading tools every question gets)
      expect(c.offers[i].tools).toEqual(offer.tools.filter((n) => n !== "read_skill"));
    });

    // The system prompt, from the same sections: B's whole, with the skills'
    // section after them; C's without that section and without the sections'
    // inference (inference.ts), never cut out of B's.
    const listing = skillsPrompt();
    expect(listing).toContain(allSkills()[0].name);
    // The tools' definitions: B's, but read_skill, each with its text with the skills off where it has one.
    const withoutSkills = (specs: Spec[] = []): Spec[] =>
      specs
        .filter((s) => s.function.name !== "read_skill")
        .map((s) => {
          const text = STUBBED.find((t) => t.name === s.function.name)?.descriptionWithoutSkills;
          return text === undefined ? s : { ...s, function: { ...s.function, description: text } };
        });
    const rewritten = STUBBED.filter((t) => t.descriptionWithoutSkills !== undefined).map((t) => t.name);
    expect(rewritten).toContain("dpdf_peaks");
    b.sent.forEach((body, i) => {
      const other = c.sent[i];
      const system = (x: Body) => String(x.messages[0].content);
      expect(system(body)).toBe(systemPrompt({ tools: true }));
      expect(system(other)).toBe(systemPrompt({ tools: true, skills: false }));
      expect(system(body)).toBe(`${SYSTEM.whole}\n${TOOLS.whole}\n${listing}`);
      expect(system(other)).toBe(`${SYSTEM.definitions}\n${TOOLS.definitions}`);
      for (const s of allSkills()) expect(system(other)).not.toContain(s.name);
      expect(other.tools).toEqual(withoutSkills(body.tools));
      // The rest of each request: the model, the settings and every other message are the same.
      const rest = (x: Body) => ({ ...x, messages: x.messages.slice(1), tools: undefined });
      expect(rest(other)).toEqual(rest(body));
    });
  });

  it("offers B what the Pilot ships: all of the tools to a cloud model, the shipped selection to a local one", async () => {
    const b = await runArm("B", baseUrl);
    const c = await runArm("C", baseUrl);
    const all = STUBBED.map((t) => t.name);
    if (baseUrl.startsWith("https")) {
      b.offers.forEach((o) => expect(o.tools).toEqual(all));
    } else {
      // The first request carries exactly what the shipped selection gives this task: no
      // bypass for the validation. Later requests only add what the model called or was asked for.
      expect(b.offers[0].tools).toEqual(toolsFor(TASK, STUBBED).map((t) => t.name));
      expect(b.offers[0].tools.length).toBeLessThanOrEqual(all.length);
      b.offers.slice(1).forEach((o, i) => b.offers[i].tools.forEach((n) => expect(o.tools).toContain(n)));
      // C is that selection made without read_skill, and nothing else changed.
      expect(c.offers[0].tools).toEqual(toolsFor(TASK, STUBBED.filter((t) => t.name !== "read_skill")).map((t) => t.name));
    }
  });
});
