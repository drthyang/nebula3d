// Each tool's facts (tools/facts.ts), declared on the tool in the registry and
// read by the modules around the agent loop through factsOf and toolsWhere:
// the fallbacks for a name the registry does not hold, the invariants every
// declaration keeps, and the tool names other modules still write by hand,
// checked against the registry.

import { describe, expect, it } from "vitest";

import { TOPICS } from "../answerChecks";
import { HELDOUT_SCENARIOS } from "../evals/heldout";
import { SCENARIOS } from "../evals/scenarios";
import { toolsFor } from "../localTools";
import collectSource from "../report/collect.ts?raw";
import { CHAT_TOOLS, factsOf, toolSpecs, toolsWhere, type AgentTool } from "../tools";
import { ASKED_ABOUT, VERDICT_TOPICS, type HighlightKey } from "../tools/facts";
import { TUNE_STAGES } from "../tune/catalog";
import verdictSource from "../verdict.ts?raw";

const NAMES = CHAT_TOOLS.map((t) => t.name);
const HIGHLIGHT_KEYS: readonly HighlightKey[] = ["raw", "rings", "punch", "backfill", "flatten", "pdf", "check", "bragg", "log"];
// Arguments a model may send that no tool accepts.
const JUNK: Record<string, unknown>[] = [{}, { stage: 5 }, { changes: "x" }, { stages: "x" }];
// Arguments that reach each fact that depends on them.
const PROBES: Record<string, unknown>[] = [{}, ...[...TUNE_STAGES, "all", "delta_pdf"].map((stage) => ({ stage }))];

describe("factsOf", () => {
  it("gives a name the registry does not hold the fallbacks: it reads, needs the server, is offered always, settles nothing", () => {
    const f = factsOf("custom");
    expect(f).toMatchObject({
      name: "custom",
      label: "custom",
      runningLabel: "custom",
      acts: null,
      actsOnPipeline: false,
      startsRuns: false,
      reachesBackend: true,
      invalidates: [],
      offeredFor: "always",
      reportable: false,
      gate: null,
    });
    expect(f.settles({ stage: "rings" })).toEqual([]);
    expect(f.highlights({ stage: "rings" })).toEqual([]);
    const custom: AgentTool = { name: "custom", description: "d", parameters: {}, run: async () => ({ result: {}, summary: "" }) };
    expect(toolsFor("Is the ring removal clean?", [...CHAT_TOOLS, custom]).map((t) => t.name)).toContain("custom");
  });

  it("keeps the facts from the model: a tool's spec is its name, description and parameters", () => {
    for (const spec of toolSpecs(CHAT_TOOLS)) expect(Object.keys(spec.function).sort()).toEqual(["description", "name", "parameters"]);
  });

  it("lists the tools whose facts pass, in the registry's order", () => {
    expect(toolsWhere(() => true)).toEqual(NAMES);
    expect(toolsWhere((f) => f.startsRuns)).toEqual(["run_pipeline", "tune_pipeline"]);
  });
});

describe("the declared facts", () => {
  it("name each tool once", () => {
    expect(new Set(NAMES).size).toBe(NAMES.length);
  });

  it("say what a tool that acts changes, and only for one that acts", () => {
    for (const name of NAMES) {
      const f = factsOf(name);
      expect(f.invalidates.length > 0, name).toBe(f.acts !== null);
    }
  });

  it("gate every tool that changes a stage's settings or tunes it on the stage's skill, and no other", () => {
    for (const name of NAMES) {
      const f = factsOf(name);
      expect(f.gate !== null, name).toBe(f.acts === "settings" || f.acts === "tune");
    }
    expect(factsOf("update_settings").gate?.doing).toBe("change");
    expect(factsOf("tune_pipeline").gate?.doing).toBe("tuning");
  });

  it("offer a tool that acts on the pipeline by no question: the message asking to act offers it", () => {
    for (const name of toolsWhere((f) => f.actsOnPipeline)) expect(factsOf(name).offeredFor, name).toBe("always");
  });

  it("settle every verdict topic the answer checks hold, each by some tool", () => {
    expect(TOPICS.map((t) => t.id)).toEqual([...VERDICT_TOPICS]);
    for (const topic of VERDICT_TOPICS) {
      const by = NAMES.filter((name) => PROBES.some((args) => factsOf(name).settles(args).includes(topic)));
      expect(by.length, topic).toBeGreaterThan(0);
    }
  });

  it("offer a local model a tool for everything a question can be about", () => {
    for (const about of ASKED_ABOUT) {
      const by = toolsWhere((f) => f.offeredFor !== "always" && f.offeredFor.includes(about));
      expect(by.length, about).toBeGreaterThan(0);
    }
  });

  it("take any arguments a model sends: the facts that depend on them never throw, and answer in their own terms", () => {
    for (const name of NAMES) {
      const f = factsOf(name);
      for (const args of JUNK) {
        const what = `${name} ${JSON.stringify(args)}`;
        expect(f.settles(args).every((t) => (VERDICT_TOPICS as readonly string[]).includes(t)), what).toBe(true);
        expect(f.highlights(args).every((k) => HIGHLIGHT_KEYS.includes(k)), what).toBe(true);
        expect((f.gate?.stages(args) ?? []).every((s) => TUNE_STAGES.includes(s)), what).toBe(true);
      }
    }
  });
});

describe("what the facts say", () => {
  it("names the cards each step works on", () => {
    const keys = (name: string, args: Record<string, unknown>) => factsOf(name).highlights(args);
    expect(keys("assess_stage", { stage: "rings" })).toEqual(["rings"]);
    expect(keys("assess_stage", { stage: "pdf" })).toEqual(["pdf", "check"]);
    expect(keys("assess_stage", {})).toEqual(["rings", "punch", "backfill", "flatten", "pdf"]);
    expect(keys("line_profile", { stage: "braggpunched" })).toEqual(["punch"]);
    expect(keys("texture_check", {})).toEqual(["punch", "backfill"]);
    expect(keys("qmax_coverage", {})).toEqual(["raw", "pdf"]);
    expect(keys("bragg_peaks", {})).toEqual(["bragg"]);
    expect(keys("update_settings", { changes: { punchMinSig: 6, backfillMethod: "laplace" } })).toEqual(["punch", "backfill"]);
    expect(keys("describe_dataset", {})).toEqual([]);
  });

  it("knows which stages a call changes or tunes, for the skill gate", () => {
    const gated = (name: string, args: Record<string, unknown>) => factsOf(name).gate?.stages(args) ?? [];
    expect(gated("update_settings", { changes: { punchMinSig: 6, pdfApod: "hann", nope: 1 } })).toEqual(["punch", "pdf"]);
    expect(gated("update_settings", { changes: "x" })).toEqual([]);
    expect(gated("tune_pipeline", { stages: ["rings", "flatten"] })).toEqual(["rings", "flatten"]);
    expect(gated("tune_pipeline", {})).toEqual(["rings", "punch", "backfill", "flatten", "pdf"]);
    expect(gated("assess_stage", { stage: "punch" })).toEqual([]);
  });

  it("tells the answer checks' evidence apart by its arguments", () => {
    expect(factsOf("assess_stage").settles({})).toEqual(["rings", "punch", "backfill", "flatten", "pdf"]);
    expect(factsOf("assess_stage").settles({ stage: "all" })).toEqual(["rings", "punch", "backfill", "flatten", "pdf"]);
    expect(factsOf("assess_stage").settles({ stage: "flatten" })).toEqual(["flatten"]);
    expect(factsOf("line_profile").settles({ stage: "delta_pdf" })).toEqual(["features"]);
    expect(factsOf("line_profile").settles({ stage: "flattened" })).toEqual([]);
  });

  it("names, in each topic's evidence, only tools that settle that topic", () => {
    for (const t of TOPICS) {
      const named = NAMES.filter((name) => new RegExp(`\\b${name}\\b`).test(t.evidence));
      expect(named.length, t.id).toBeGreaterThan(0);
      for (const name of named) {
        const stage = new RegExp(`\\b${name} with stage (\\w+)`).exec(t.evidence)?.[1];
        expect(factsOf(name).settles(stage ? { stage } : {}), `${t.id}: ${name}`).toContain(t.id);
      }
    }
  });
});

// Recipes that call tools by name, kept by hand: each name must be the registry's.
describe("the tool names written by hand", () => {
  const found = (source: string, re: RegExp): string[] => [...new Set([...source.matchAll(re)].map((m) => m[1]))];

  it("the computed verdict reads only tools the registry holds", () => {
    const names = found(verdictSource, /(?:resultsNewestFirst\(steps, |latest\()"([a-z_]+)"/g);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(NAMES, name).toContain(name);
  });

  it("the report measures with tools the registry holds", () => {
    const names = found(collectSource, /\brun\("([a-z_]+)"/g);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(NAMES, name).toContain(name);
  });

  it("the evals' checks name tools the registry holds", () => {
    let seen = 0;
    for (const s of [...SCENARIOS, ...HELDOUT_SCENARIOS]) {
      for (const c of s.checks) {
        const name = /^(?:calls|does not call) ([a-z_]+)|^reads the \S+ skill before ([a-z_]+)/.exec(c.name);
        const tool = name?.[1] ?? name?.[2];
        if (!tool) continue;
        seen += 1;
        expect(NAMES, `${s.id}: ${c.name}`).toContain(tool);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});
