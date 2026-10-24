// The tuning run against a stand-in model server that goes quiet: a stalled
// request is asked once more, a second stall ends the run with the reason, and
// the user's Stop during a stall ends it at once, never asked again. The real
// client (completeChat's stall watchdog) talks to a real HTTP server here, the
// chat's stall limits and pauses shortened.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

// What the server does with its nth request (1-based): sit on it, or answer.
let behaviour: (n: number) => "stall" | "answer" = () => "answer";
let onRequest: (n: number) => void = () => {};
let requests = 0;
const open = new Set<ServerResponse>();
let server: Server;
let baseUrl = "";

const answer = (res: ServerResponse) => {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '{"candidates": []}' } }] })}\n\n`);
  res.end("data: [DONE]\n\n");
};

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    req.resume();
    req.on("end", () => {
      requests += 1;
      const n = requests;
      onRequest(n);
      if (behaviour(n) === "answer") answer(res);
      else open.add(res); // says nothing until the client gives up
      res.on("close", () => open.delete(res));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  for (const res of open) res.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("the tuning run when the model server stalls", () => {
  const dataset = { id: "demo", temperature: "T1", stem: "demo", raw_name: "demo.nxs", stages: [] } as Dataset;
  const RUN = { run_id: "20261009T120000-abcd", dataset_id: "demo~tune~20261009T120000-abcd" };
  const initial = usePipelineStore.getState();
  const llm = () => ({ ...DEFAULT_SETTINGS, baseUrl, model: "stand-in" });
  const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeEach(() => {
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
