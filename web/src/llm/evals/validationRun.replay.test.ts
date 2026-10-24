// Validation runs back to back, each as the live runner makes it (runCase,
// validationRun.ts), with a scripted model in place of the real one and the
// real tools on a dev case through the CPython bridge (devData/). The second
// run reads nothing the first left in the app: its log (run_log), the views it
// moved (current_view), its tuning run, the settings it changed, and a server
// it found refusing tools. The token calibration carries over on purpose, and
// each record keeps the one its run started from. A run's tuning asks the
// run's model, not the console's, and its tokens are the run's: in the
// record's usage and cost, and in the paid model's spend.

import { describe, expect, it } from "vitest";

import { useDpdfStore } from "../../state/dpdfStore";
import { useNavStore } from "../../state/navStore";
import { usePipelineStore } from "../../state/pipelineStore";
import { useViewerStore } from "../../state/viewerStore";
import { CUT_OFF_NOTE, TOOLS_UNSUPPORTED_NOTE, toolsKnownUnsupported } from "../agent";
import { DATA_CHARS_PER_TOKEN, resetTokenState, tokenCalibration } from "../provider/tokens";
import { loadSettings, saveSettings } from "../settings";
import { callTool, CHAT_TOOLS } from "../tools";
import { currentStageSettings, TUNE_STAGES, type ParamValue } from "../tune/catalog";
import { evaluateStage } from "../tune/evaluate";
import { buildJudgeMessages, buildProposeMessages } from "../tune/prompts";
import { useTuneStore } from "../tune/tuner";
import { devCase, type DevCase } from "./devData";
import { DEV_GRIDS } from "./devData/bridgeWorker";
import { renderTranscript } from "./findings";
import { scriptedModel, SCRIPTED_URL, type ScriptedRequest, type ScriptTurn } from "./scripted";
import { caseNamed, type Arm, type Decision, type RunRecord } from "./validation";
import { costOf, FIRST_RUN_WORST, firstRunWorstUsd, modelNamed, SPEND_CAP_USD, SpendTracker, VALIDATION_MAX_TOKENS, type Price } from "./validationModels";
import { runCase } from "./validationRun";

const SETTINGS = { baseUrl: SCRIPTED_URL, model: "scripted", apiKey: "", temperature: 0 };
const KEY = `${SETTINGS.baseUrl}|${SETTINGS.model}`;
const MODEL = { key: "scripted", label: "a scripted model", provider: "scripted", model: "scripted", local: false };

/** One run on the case's dataset, as the live runner makes it, its model scripted; with the script's counts and the requests it answered. */
async function run(
  c: DevCase,
  arm: Arm,
  script: ScriptTurn[],
  { price = null }: { price?: Price | null } = {},
): Promise<{ record: RunRecord; overrun: number; log: ScriptedRequest[] }> {
  const dataset = await c.dataset();
  const model = scriptedModel(script);
  const uninstall = model.install();
  try {
    const record = await runCase({ job: { case: caseNamed(c.id)!, arm, run: 1 }, dataset, model: MODEL, settings: SETTINGS, rounds: 12, minutes: 5, price });
    return { record, overrun: model.overrun(), log: model.log() };
  } finally {
    uninstall();
  }
}

const CONSOLE_URL = "http://console.invalid/v1";

/**
 * The console's settings (settings.ts) on a model of their own, which the
 * tuning asks in the app: content with the current settings, counting its
 * requests. `restore` puts fetch and the settings back.
 */
function consoleModel(): { requests: () => number; restore: () => void } {
  let requests = 0;
  const real = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(CONSOLE_URL)) return real(input, init);
    requests += 1;
    const reply = { choices: [{ message: { content: JSON.stringify({ candidates: [], best: 1, why: "the current settings" }) } }] };
    return Promise.resolve(new Response(JSON.stringify(reply), { status: 200, headers: { "Content-Type": "application/json" } }));
  }) as typeof fetch;
  const settings = loadSettings();
  saveSettings({ baseUrl: CONSOLE_URL, model: "console" });
  return {
    requests: () => requests,
    restore: () => {
      globalThis.fetch = real;
      saveSettings(settings);
    },
  };
}

/** The decision a run made with `tool`, the only one. */
const only = (r: RunRecord, tool: string): Decision => {
  const hits = r.decisions.filter((d) => d.tool === tool);
  expect(hits.map((d) => d.tool), tool).toEqual([tool]);
  return hits[0];
};

/** What a decision's tool found, as the model read it. */
const read = (d: Decision): Record<string, unknown> => JSON.parse(d.result) as Record<string, unknown>;

describe("validation runs back to back", () => {
  it("the second reads nothing the first left: its log, its views, its tuning run, its settings", async () => {
    resetTokenState();
    const c = devCase("dev-flatten");
    const dataset = await c.dataset();

    // The first run (arm B) reads the stages' skills, changes the flatten and
    // runs it again, moves both viewers, sets the ΔPDF's contrast, tunes the
    // ΔPDF and reads the log.
    const first = await run(c, "B", [
      { calls: [{ name: "read_skill", args: { name: "reduction-qc" } }, { name: "read_skill", args: { name: "delta-pdf-interpretation" } }] },
      { calls: [{ name: "update_settings", args: { changes: { flattenQ2: true } } }, { name: "run_pipeline", args: { from_stage: "flatten" } }] },
      {
        calls: [
          { name: "show_in_viewer", args: { view: "cleanup", plane: "hk0", value: 0.5 } },
          { name: "show_in_viewer", args: { view: "dpdf", plane: "xy", value: 2 } },
          { name: "dpdf_contrast" },
          { name: "current_view" },
        ],
      },
      { calls: [{ name: "tune_pipeline", args: { stages: ["pdf"], trials_per_stage: 2 } }] },
      // The tuning asks the run's model for alternatives: content with the current settings.
      { text: JSON.stringify({ candidates: [] }) },
      { calls: [{ name: "run_log" }] },
      { text: "Done." },
    ]);
    const one = first.record;
    expect(one.error).toBeNull();
    expect(one.decisions.filter((d) => d.status !== "done").map((d) => `${d.tool}: ${d.result}`)).toEqual([]);
    expect(first.overrun).toBe(0);
    // What it left in the app: what a second run would read, were it not cleared.
    expect(read(only(one, "run_log")).lines).not.toEqual([]);
    expect(read(only(one, "current_view")).page).toBe("dpdf");
    const pipe = usePipelineStore.getState();
    expect([pipe.events.length > 0, pipe.terminal, pipe.flattenQ2]).toEqual([true, "done", true]);
    expect(useNavStore.getState().tab).toBe("execution");
    expect(useViewerStore.getState()).toMatchObject({ fixedAxis: "L", focus: { axis: "L", value: 0.5 } });
    expect(useDpdfStore.getState()).toMatchObject({ centered: true, limit: { dataset: dataset.id } });
    const tuned = useTuneStore.getState();
    expect(tuned.run).not.toBeNull();
    expect(tuned.stages.map((s) => [s.stage, s.status, s.trials.length])).toEqual([["pdf", "done", 1]]);
    // What its requests taught the token estimate, kept for the next run.
    const learned = tokenCalibration(KEY);
    expect(learned.scale).not.toBeNull();

    // The second run (arm C) reads the log, the view and the settings.
    const second = await run(c, "C", [
      { calls: [{ name: "run_log" }, { name: "current_view" }, { name: "configure_settings" }] },
      { text: "Done." },
    ]);
    const two = second.record;
    expect(second.overrun).toBe(0);
    // No pipeline run in its session yet: not the first run's log.
    expect(only(two, "run_log")).toMatchObject({ status: "error", result: "Error: no pipeline run in this session yet" });
    // The page and the cuts a fresh page has, not those the first run left:
    // what current_view reads with the view stores at their start.
    const view = read(only(two, "current_view"));
    expect(view.page).toBe("config");
    useNavStore.setState(useNavStore.getInitialState(), true);
    useViewerStore.setState(useViewerStore.getInitialState(), true);
    useDpdfStore.setState(useDpdfStore.getInitialState(), true);
    const fresh = await callTool({ dataset, datasets: [dataset] }, "current_view");
    expect(view).toEqual(JSON.parse(fresh.text));
    expect(view).not.toEqual(read(only(one, "current_view")));
    // The default settings, not the first run's change.
    expect((read(only(two, "configure_settings")).settings as Record<string, unknown>).flattenQ2).toBe(false);
    // No tuning run, trial or note, and no contrast: the second run made none, and found none.
    expect(useTuneStore.getState()).toMatchObject({ active: false, run: null, stages: [], error: null, finishedNote: null });
    expect(useDpdfStore.getState()).toMatchObject({ centered: false, limit: null });

    // The token calibration carried over, and each record keeps where its run started.
    expect(one.tokens_at_start).toEqual({ scale: null, ollama_num_ctx: null });
    expect(two.tokens_at_start).toEqual({ scale: learned.scale, ollama_num_ctx: null });
  }, 300_000);

  it("offers tools again to a server the run before found refusing them", async () => {
    const c = devCase("dev-control");
    // The first run's server fails a request that carries tools, as one that cannot call them does.
    const first = await run(c, "B", [{ fail: { status: 400, message: "scripted does not support tools" } }, { text: "I cannot call tools here." }]);
    expect(first.record.note).toBe(TOOLS_UNSUPPORTED_NOTE);
    expect(first.record.tool_offers.map((o) => o.tools.length > 0)).toEqual([true, false]);
    expect(toolsKnownUnsupported(SETTINGS)).toBe(true); // what it left

    // The second run's server calls tools: it is offered them, and its call runs.
    const second = await run(c, "B", [{ calls: [{ name: "run_log" }] }, { text: "Done." }]);
    expect(second.record.tool_offers[0].tools).toContain("run_log");
    expect(second.record.decisions.map((d) => d.tool)).toEqual(["run_log"]);
    expect(second.record.note).toBeNull();
    expect(second.overrun).toBe(0);
  }, 300_000);
});

describe("a validation run's tuning", () => {
  // What the run's model costs, as a paid model's entry gives it (validationModels.ts).
  const PRICE: Price = { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 };
  const total = (requests: ScriptedRequest[]) => ({
    input: requests.reduce((n, r) => n + r.usage!.input, 0),
    output: requests.reduce((n, r) => n + r.usage!.output, 0),
    cacheRead: 0,
    cacheWrite: 0,
    requests: requests.length,
  });

  it("asks the run's model, not the console's, and its tokens are the run's: its usage, its cost and the spend", async () => {
    const c = devCase("dev-control");
    const onConsole = consoleModel();
    let tuned: Awaited<ReturnType<typeof run>>;
    try {
      tuned = await run(
        c,
        "C",
        [
          { calls: [{ name: "tune_pipeline", args: { stages: ["pdf"], trials_per_stage: 2 } }] },
          // The tuning's own requests: one alternative, run as trial 2, then the pick.
          { text: JSON.stringify({ candidates: [{ changes: { pdfApod: "hann" }, why: "fewer ripples" }] }) },
          { text: JSON.stringify({ best: 1, why: "the current settings" }) },
          { text: "Done." },
        ],
        { price: PRICE },
      );
    } finally {
      onConsole.restore();
    }
    const { record, log, overrun } = tuned;
    expect(record.error).toBeNull();
    expect(record.decisions.map((d) => [d.tool, d.status])).toEqual([["tune_pipeline", "done"]]);
    expect(overrun).toBe(0);
    expect(useTuneStore.getState().stages.map((s) => [s.stage, s.status, s.trials.length, s.best])).toEqual([["pdf", "done", 2, 1]]);

    // Every request went to the run's model: the loop's streamed, the
    // tuning's read whole; none to the model on the console's settings.
    expect(log.map((r) => [r.model, r.stream])).toEqual([
      ["scripted", true],
      ["scripted", false],
      ["scripted", false],
      ["scripted", true],
    ]);
    expect(onConsole.requests()).toBe(0);

    // The record's usage is every token the model reported: the loop's plus
    // the tuning's, which it keeps apart. The offers are the loop's alone.
    const loop = total(log.filter((r) => r.stream));
    const tuning = total(log.filter((r) => !r.stream));
    expect(tuning.requests).toBe(2);
    expect(record.usage).toEqual({
      input: loop.input + tuning.input,
      output: loop.output + tuning.output,
      cacheRead: 0,
      cacheWrite: 0,
      requests: 4,
      tuning,
    });
    expect(record.tool_offers.map((o) => o.request)).toEqual([1, 2]);

    // Its cost, and the paid model's spend, at the run model's price.
    const usd = (u: { input: number; output: number }) => (u.input * PRICE.input + u.output * PRICE.output) / 1e6;
    expect(usd(tuning)).toBeGreaterThan(0);
    expect(record.cost_usd).toBeCloseTo(usd(loop) + usd(tuning), 12);
    const tracker = new SpendTracker(SPEND_CAP_USD);
    tracker.record({ case: record.case, arm: record.arm, run: record.run, usd: record.cost_usd });
    expect(tracker.spent).toBeCloseTo(usd(loop) + usd(tuning), 12);
    expect(tracker.spent - costOf(loop, PRICE)!).toBeCloseTo(usd(tuning), 12);
  }, 300_000);

  it("asks for the validation's output cap on every request, the loop's and the tuning's, and records each cut at it", async () => {
    const c = devCase("dev-control");
    const { record, log, overrun } = await run(c, "C", [
      { calls: [{ name: "tune_pipeline", args: { stages: ["pdf"], trials_per_stage: 2 } }] },
      { text: JSON.stringify({ candidates: [{ changes: { pdfApod: "hann" }, why: "fewer ripples" }] }) },
      // The pick stops at the cap, its JSON whole: the tuning reads it, and the record says it was cut.
      { text: JSON.stringify({ best: 1, why: "the current settings" }), cut: true },
      // The answer stops at the cap too.
      { text: "Done, and then", cut: true },
    ]);
    expect(overrun).toBe(0);
    expect(record.decisions.map((d) => [d.tool, d.status])).toEqual([["tune_pipeline", "done"]]);
    expect(log.map((r) => [r.stream, r.maxTokens])).toEqual([
      [true, VALIDATION_MAX_TOKENS],
      [false, VALIDATION_MAX_TOKENS],
      [false, VALIDATION_MAX_TOKENS],
      [true, VALIDATION_MAX_TOKENS],
    ]);
    expect(record.truncated).toEqual({
      loop: 1,
      tuning: 1,
      requests: [
        { request: 2, source: "tuning", transport: "openai-compatible", reason: "length" },
        { request: 2, source: "loop", transport: "openai-compatible", reason: "length" },
      ],
    });
    expect(record.note).toBe(CUT_OFF_NOTE);
    expect(record.run_policy).toMatchObject({ transport: "openai-compatible", max_rounds: 12, temperature: 0, output_cap: { loop: 16_000, tuning: 16_000 } });
    const text = renderTranscript(record);
    expect(text).toContain("**Cut at the output limit:** the loop's request 2 (length); the tuning's request 2 (length). The run is graded as it stands.");
  }, 300_000);

  it("is covered by the first run's reserve at its worst: a stage's most requests, each as long as the longest measured", async () => {
    const sonnet = modelNamed("claude-sonnet-5-5").price!;
    // A request's tokens as the token estimate counts number-dense JSON, for every character.
    const tokens = (r: { messages: number; chars: number }) => r.messages * 5 + r.chars / DATA_CHARS_PER_TOKEN;
    const most = (CHAT_TOOLS.find((t) => t.name === "tune_pipeline")!.parameters.properties as { trials_per_stage: { maximum: number } })
      .trials_per_stage.maximum;
    expect(most).toBe(5);
    // The validation's own grid, where the ring stage's numbers run longest: its
    // pick of five trials is the longest tuning request (FIRST_RUN_WORST).
    const c = devCase("dev-flatten", { n: DEV_GRIDS[1] });
    const { record, log, overrun } = await run(
      c,
      "B",
      [
        { calls: [{ name: "read_skill", args: { name: "reduction-qc" } }] },
        { calls: [{ name: "tune_pipeline", args: { stages: ["rings"], trials_per_stage: most } }] },
        // A reply none of whose candidates can run, so the stage asks again; then four that can; then the pick.
        { text: JSON.stringify({ candidates: [{ changes: { ringPooledSectors: 2 }, why: "fewer sectors" }] }) },
        {
          text: JSON.stringify({
            candidates: [
              { changes: { ringPooledSectors: 36 }, why: "coarser sectors" },
              { changes: { ringPooledWindow: 10 }, why: "a wider window" },
              { changes: { ringModel: "global_v2" }, why: "one profile" },
              { changes: { ringModel: "patched", ringNFourier: 12 }, why: "patched" },
            ],
          }),
        },
        { text: JSON.stringify({ best: 1, why: "the current settings" }) },
        { text: "Done." },
      ],
      { price: sonnet },
    );
    expect(record.error).toBeNull();
    expect(overrun).toBe(0);
    expect(useTuneStore.getState().stages[0]).toMatchObject({ stage: "rings", status: "done", best: 1 });
    expect(useTuneStore.getState().stages[0].trials.map((t) => t.status)).toEqual(["done", "done", "done", "done", "done"]);

    // A stage's most requests, 3, and every one inside the reserve's tokens a request.
    const tuning = log.filter((r) => !r.stream);
    expect(tuning).toHaveLength(3);
    expect(FIRST_RUN_WORST.tuning.requests).toBe(TUNE_STAGES.length * tuning.length);
    const longest = Math.max(...tuning.map(tokens));
    expect(longest).toBe(tokens(tuning[2])); // the pick of five trials
    expect(longest).toBeLessThanOrEqual(FIRST_RUN_WORST.tuning.inputPerRequest);

    // Every other stage's longest requests on this dataset, with its numbers
    // in each of five trials, are inside it too: the pick, and asking again
    // with every earlier stage's settings.
    const dataset = await c.dataset();
    const earlier: Record<string, Record<string, ParamValue>> = {};
    for (const stage of TUNE_STAGES) {
      const settings = currentStageSettings(stage, usePipelineStore.getState());
      const metrics = await evaluateStage(stage, dataset);
      const trials = [1, 2, 3, 4, 5].map((trial) => ({ trial, settings, metrics }));
      const again = [
        ...buildProposeMessages({ stage, current: settings, earlier, trials: trials.slice(0, 1), count: most - 1 }),
        { role: "user" as const, content: `None of those can run: ${"a candidate outside the catalog; ".repeat(4)}Propose again.` },
      ];
      for (const messages of [buildJudgeMessages({ stage, trials }), again]) {
        const chars = messages.reduce((n, m) => n + String(m.content).length, 0);
        expect(tokens({ messages: messages.length, chars }), stage).toBeLessThanOrEqual(FIRST_RUN_WORST.tuning.inputPerRequest);
      }
      earlier[stage] = settings;
    }

    // The run at its worst: the loop's worst, every request at the output cap
    // it asked for, and every stage tuned as the ring stage was here, each
    // request as long as the longest measured and with its whole cap out; with
    // the margin. The reserve covers it, and this run, as the scripted model
    // counted it, is far inside.
    expect(log.every((r) => r.maxTokens === VALIDATION_MAX_TOKENS)).toBe(true);
    const { loop, margin } = FIRST_RUN_WORST;
    const worst =
      ((loop.requests * (loop.inputPerRequest * sonnet.input + VALIDATION_MAX_TOKENS * sonnet.output) +
        TUNE_STAGES.length * tuning.length * (longest * sonnet.input + VALIDATION_MAX_TOKENS * sonnet.output)) /
        1e6) *
      (1 + margin);
    expect(worst).toBeLessThanOrEqual(firstRunWorstUsd(sonnet));
    expect(worst).toBeLessThanOrEqual(SpendTracker.FIRST_RUN_RESERVE_USD);
    const tracker = new SpendTracker(SPEND_CAP_USD);
    expect(tracker.reserve()).toBe(SpendTracker.FIRST_RUN_RESERVE_USD);
    expect(tracker.canStart()).toBe(true);
    expect(record.usage?.tuning?.requests).toBe(3);
    expect(record.cost_usd!).toBeLessThan(SpendTracker.FIRST_RUN_RESERVE_USD);
  }, 300_000);
});
