// A validation run on a model Ollama serves (gemma4:26b), as the live runner
// makes it (runCase, validationRun.ts), through Ollama's own chat API: its
// model scripted (scriptedOllama), the real tools on a dev case through the
// CPython bridge. The record keeps the tools each request offered, as it does
// for LM Studio and Anthropic (offers.ts); it kept none for Ollama, whose chat
// requests go to /api/chat, not /v1/chat/completions.

import { describe, expect, it } from "vitest";

import { modelNamed } from "./validationModels";
import { devCase } from "./devData";
import { scriptedOllama, SCRIPTED_OLLAMA_URL } from "./scripted";
import { caseNamed } from "./validation";
import { runCase } from "./validationRun";

describe("a validation run on Ollama", () => {
  it("records the tools each chat request offered, as they went to /api/chat", async () => {
    const gemma = modelNamed("ollama-gemma4-26b");
    const c = devCase("dev-control");
    const dataset = await c.dataset();
    const model = scriptedOllama([
      { calls: [{ name: "describe_dataset" }] },
      { calls: [{ name: "ub_check" }] },
      { text: "Done." },
    ]);
    const uninstall = model.install();
    let record: Awaited<ReturnType<typeof runCase>>;
    try {
      record = await runCase({
        job: { case: caseNamed(c.id)!, arm: "B", run: 1 },
        dataset,
        model: { key: gemma.key, label: gemma.label, provider: gemma.provider, model: gemma.model, local: gemma.local },
        settings: { baseUrl: SCRIPTED_OLLAMA_URL, model: gemma.model, apiKey: "", temperature: gemma.temperature ?? 0.2 },
        rounds: 12,
        minutes: 5,
      });
    } finally {
      uninstall();
    }
    expect(record.error).toBeNull();
    expect(model.overrun()).toBe(0);
    expect(record.decisions.map((d) => [d.tool, d.status])).toEqual([
      ["describe_dataset", "done"],
      ["ub_check", "done"],
    ]);
    // The run went through Ollama's own API: its window from /api/show and
    // /api/ps, and its three chat requests to /api/chat.
    expect(gemma.baseUrl).toContain(":11434");
    expect(model.paths().filter((p) => p === "/api/chat")).toHaveLength(3);
    expect(model.paths()).toContain("/api/show");

    // The record keeps each chat request's offer, numbered, and only those:
    // the tools the request carried, as the server saw them.
    expect(record.tool_offers.map((o) => o.request)).toEqual([1, 2, 3]);
    expect(record.tool_offers.map((o) => o.tools)).toEqual(model.offered());
    expect(record.tool_offers[0].tools).toContain("describe_dataset");
    expect(record.tool_offers[1].tools).toContain("ub_check");
    // Its counts, from Ollama's last line of each reply, are the run's usage.
    expect(record.usage?.requests).toBe(3);
  }, 300_000);
});
