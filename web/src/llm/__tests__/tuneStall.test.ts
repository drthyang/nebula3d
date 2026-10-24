// The tuning run against a stand-in model server that goes quiet: a stalled
// request is asked once more, a second stall ends the run with the reason, and
// the user's Stop during a stall ends it at once, never asked again. The real
// client (completeChat's stall watchdog) talks to a stand-in for the server's
// /chat/completions in place of fetch, the chat's stall limits and pauses
// shortened.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../api/types";
import { usePipelineStore } from "../../state/pipelineStore";
import { DEFAULT_SETTINGS } from "../settings";
import { startTuning, stopTuning, useTuneStore } from "../tune/tuner";

vi.mock("../recovery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../recovery")>()),
  STALL_MS: { first: 300, idle: 300 },
  RETRY_DELAYS_MS: [20, 20],
}));
const evaluate = vi.hoisted(() => ({ evaluateStage: vi.fn() }));
const api = vi.hoisted(() => ({ startTuningRun: vi.fn(), promoteTrial: vi.fn(), fetchDataset: vi.fn() }));
vi.mock("../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/client")>()),
  ...api,
}));
vi.mock("../tune/evaluate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tune/evaluate")>()),
  evaluateStage: evaluate.evaluateStage,
}));

// What the server does with its nth request (1-based): sit on it, saying
// nothing until the client gives up, or answer.
let behaviour: (n: number) => "stall" | "answer" = () => "answer";
let onRequest: (n: number) => void = () => {};
let requests = 0;
const baseUrl = "http://127.0.0.1:1310/v1";

const standIn = async (url: string, init: RequestInit): Promise<Response> => {
  expect(url).toBe(`${baseUrl}/chat/completions`);
  requests += 1;
  const n = requests;
  onRequest(n);
  if (behaviour(n) === "stall") {
    return new Promise<Response>((_resolve, reject) => {
      const gone = () => reject(new DOMException("The operation was aborted.", "AbortError"));
      if (init.signal?.aborted) gone();
      init.signal?.addEventListener("abort", gone, { once: true });
    });
  }
  const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: '{"candidates": []}' } }] })}\n\ndata: [DONE]\n\n`;
  return new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the tuning run when the model server stalls", () => {
  const dataset = { id: "demo", temperature: "T1", stem: "demo", raw_name: "demo.nxs", stages: [] } as Dataset;
  const RUN = { run_id: "20261009T120000-abcd", dataset_id: "demo~tune~20261009T120000-abcd" };
  const initial = usePipelineStore.getState();
  const llm = () => ({ ...DEFAULT_SETTINGS, baseUrl, model: "stand-in" });
  const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(standIn));
    requests = 0;
    onRequest = () => {};
    evaluate.evaluateStage.mockReset().mockResolvedValue({ total_leftover_peaks: 1, mean_punched_fraction: 0.02 });
    api.startTuningRun.mockReset().mockResolvedValue(RUN);
    api.promoteTrial.mockReset().mockResolvedValue({ ...RUN, trial: "", files: [] });
    api.fetchDataset.mockReset().mockImplementation(async (id: string) => ({ ...dataset, id }));
    usePipelineStore.setState({
      ...initial,
      ringsEnabled: false,
      punchEnabled: true,
      backfillEnabled: false,
      flatten: false,
      pdfEnabled: false,
      running: false,
      runStages: vi.fn(async () => "done" as const),
    });
    useTuneStore.setState({ active: false, run: null, stages: [], error: null, finishedNote: null });
  });

  it("asks a stalled request once more, and the run goes on with the answer", async () => {
    behaviour = (n) => (n === 1 ? "stall" : "answer");
    await startTuning({ dataset, stages: ["punch"], trialsPerStage: 3, llm: llm() });
    const { stages, error, finishedNote, active } = useTuneStore.getState();
    expect(requests).toBe(2);
    expect(error).toBeNull();
    expect(active).toBe(false);
    expect(stages[0].status).toBe("done");
    expect(finishedNote).toMatch(/^Done/);
  });

  it("ends the run with the stall's reason when the request stalls again", async () => {
    behaviour = () => "stall";
    await startTuning({ dataset, stages: ["punch"], trialsPerStage: 3, llm: llm() });
    await settle(500); // no third request comes
    const { error, active } = useTuneStore.getState();
    expect(requests).toBe(2);
    expect(active).toBe(false);
    expect(error).toMatch(/the model server sent nothing for/);
  });

  it("stops at once on the user's Stop during a stall, without asking again", async () => {
    behaviour = () => "stall";
    onRequest = (n) => n === 1 && setTimeout(stopTuning, 50); // Stop while the server sits on it
    const t0 = Date.now();
    await startTuning({ dataset, stages: ["punch"], trialsPerStage: 3, llm: llm() });
    expect(Date.now() - t0).toBeLessThan(300); // before the stall limit
    await settle(500); // no retry comes
    const { error, finishedNote, active } = useTuneStore.getState();
    expect(requests).toBe(1);
    expect(active).toBe(false);
    expect(error).toBeNull();
    expect(finishedNote).toMatch(/^Stopped/);
  });
});
