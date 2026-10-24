// A validation run (runCase, validationRun.ts) on each transport, through the
// real client against scripted servers (scriptedTransports.ts), the backend
// stubbed: every request of either arm, and of the run's tuning, asks for the
// validation's output cap (VALIDATION_MAX_TOKENS); a reply cut at it is in the
// record (truncated) and the transcript says so; and the record keeps the run
// policy it ran under, Claude's temperature null as sent. The replay test
// (validationRun.replay.test.ts) runs the tuning for real on a dev case.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../api/types";
import { CUT_OFF_NOTE } from "../agent";
import type { TuneOptions } from "../tune/tuner";
import { claudeServer, CLAUDE_URL, LM_STUDIO_URL, localServer, OLLAMA_URL, SDK, type Body, type Script } from "../__tests__/scriptedTransports";
import { renderTranscript } from "./findings";
import { caseNamed, recordedPolicy, type Arm } from "./validation";
import { VALIDATION_MAX_TOKENS, validationPolicy } from "./validationModels";
import { runCase } from "./validationRun";

vi.mock("@anthropic-ai/sdk", async () => ({ default: (await import("../__tests__/scriptedTransports")).SDK.Anthropic }));

const DATASET: Dataset = { id: "v000001-B1", stem: "v000001_B1", temperature: null, raw_name: "v000001_B1.nxs", stages: [] };
vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  fetchDatasets: vi.fn(async () => [DATASET]),
}));
vi.mock("../context/loadContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../context/loadContext")>()),
  loadPipelineContext: vi.fn(async () => ({ context: {} })),
}));
// The tuning's own requests: as tune_pipeline hands them the run's model, each
// reported with its stop reason, the first cut at the cap.
const tuner = vi.hoisted(() => ({ startTuning: vi.fn() }));
vi.mock("../tune/tuner", async (importOriginal) => ({ ...(await importOriginal<typeof import("../tune/tuner")>()), startTuning: tuner.startTuning }));

const MODEL = { key: "m", label: "m", provider: "p", model: "m", local: true };
const SETTINGS = {
  claude: { baseUrl: CLAUDE_URL, model: "claude-sonnet-5-5", apiKey: "test-key", temperature: null },
  lmStudio: { baseUrl: LM_STUDIO_URL, model: "lm", apiKey: "", temperature: 0.2 },
  ollama: { baseUrl: OLLAMA_URL, model: "gemma4:26b", apiKey: "", temperature: 0.2 },
};
const REASON = { claude: "max_tokens", lmStudio: "length", ollama: "length" } as const;
const TRANSPORT = { claude: "anthropic", lmStudio: "openai-compatible", ollama: "ollama" } as const;

// What a request asks of the output cap and the temperature, on its transport.
const capOf = (body: Body): unknown => body.max_tokens ?? (body.options as { num_predict?: number } | undefined)?.num_predict;
const temperatureOf = (body: Body): unknown => body.temperature ?? (body.options as { temperature?: number } | undefined)?.temperature ?? null;

let script: Script;
const runOn = (name: keyof typeof SETTINGS, arm: Arm) =>
  runCase({ job: { case: caseNamed("dev-ub")!, arm, run: 1 }, dataset: DATASET, model: MODEL, settings: SETTINGS[name], rounds: 12, minutes: 5, settleMs: 1000 });

beforeEach(() => {
  SDK.stream.mockReset();
  SDK.create.mockReset();
  tuner.startTuning.mockReset();
  script = { sent: [] };
  claudeServer(SDK, script);
  localServer(script);
});
afterEach(() => vi.unstubAllGlobals());

describe("a validation run under its output cap", () => {
  it.each(["claude", "lmStudio", "ollama"] as const)("%s: every request of either arm asks for the cap, and a reply cut at it is recorded and said", async (name) => {
    script.tool = null; // the model answers at once
    script.cut = true; // and its answer stops at the cap
    for (const arm of ["B", "C"] as const) {
      script.sent = [];
      const record = await runOn(name, arm);
      expect(script.sent).toHaveLength(1);
      expect(capOf(script.sent[0])).toBe(VALIDATION_MAX_TOKENS);
      // Claude is sent no temperature, and the record says none was.
      expect(temperatureOf(script.sent[0])).toBe(SETTINGS[name].temperature);
      expect(record.run_policy).toEqual(recordedPolicy(validationPolicy(SETTINGS[name], 12)));
      expect(record.run_policy).toMatchObject({ temperature: SETTINGS[name].temperature, output_cap: { loop: 16_000, tuning: 16_000 } });
      expect(record.truncated).toEqual({
        loop: 1,
        tuning: 0,
        requests: [{ request: 1, source: "loop", transport: TRANSPORT[name], reason: REASON[name] }],
      });
      // Each transport keeps its handling of the cut: a local server's ends with the cut-off note, Claude's answer stands.
      expect(record.note).toBe(name === "claude" ? null : CUT_OFF_NOTE);
      const text = renderTranscript(record);
      expect(text).toContain(`**Cut at the output limit:** the loop's request 1 (${REASON[name]}). The run is graded as it stands.`);
      expect(text).toContain("output cap 16,000 tokens, the tuning's 16,000 tokens");
    }
  });

  it.each(["claude", "lmStudio", "ollama"] as const)("%s: the tuning asks the run's model under the cap, and its requests cut at it are recorded", async (name) => {
    tuner.startTuning.mockImplementation(async (opts: TuneOptions) => {
      opts.onUsage?.({ input: 50, output: 16_000 }, REASON[name]);
      opts.onUsage?.({ input: 50, output: 5 }, name === "claude" ? "end_turn" : "stop");
    });
    script.tool = "tune_pipeline";
    // Arm C: no skill to read before a stage is tuned.
    const record = await runOn(name, "C");
    expect(tuner.startTuning).toHaveBeenCalledTimes(1);
    expect(tuner.startTuning.mock.calls[0][0]).toMatchObject({ llm: SETTINGS[name], maxTokens: VALIDATION_MAX_TOKENS });
    expect(script.sent.map(capOf)).toEqual([VALIDATION_MAX_TOKENS, VALIDATION_MAX_TOKENS]);
    expect(record.truncated).toEqual({
      loop: 0,
      tuning: 1,
      requests: [{ request: 1, source: "tuning", transport: TRANSPORT[name], reason: REASON[name] }],
    });
    expect(record.usage?.tuning).toMatchObject({ requests: 2 });
    expect(renderTranscript(record)).toContain(`**Cut at the output limit:** the tuning's request 1 (${REASON[name]}).`);
  });
});
