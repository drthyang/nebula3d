// The tuning run: proposals are checked against the catalog, replies parse
// through reasoning-model noise, and the driver tries, picks, keeps the chosen
// settings and leaves the chosen trial's output on disk — stage by stage.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../api/types";
import { usePipelineStore, type RunOptions } from "../../state/pipelineStore";
import { DEFAULT_SETTINGS } from "../settings";
import { currentStageSettings, proposalToPatch, ProposalError, toFormValue } from "../tune/catalog";
import { parseJsonReply } from "../tune/prompts";
import { startTuning, useTuneStore } from "../tune/tuner";

const llm = vi.hoisted(() => ({ completeChat: vi.fn() }));
vi.mock("../provider/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../provider/client")>()),
  completeChat: llm.completeChat,
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

describe("catalog", () => {
  it("maps enum names to form values and checks ranges", () => {
    expect(toFormValue("backfillMethod", "laplace", "backfill")).toBe("");
    expect(toFormValue("backfillMethod", "q_shell", "backfill")).toBe("q_shell");
    expect(toFormValue("punchMinSig", 6, "punch")).toBe("6");
    expect(toFormValue("pdfWindowSupport", "false", "pdf")).toBe(false);
    expect(() => toFormValue("punchMinSig", 1, "punch")).toThrow(/within \[3, 12\]/);
    expect(() => toFormValue("ringPooledSectors", 7.5, "rings")).toThrow(/integer/);
    expect(() => toFormValue("backfillMethod", "kriging", "backfill")).toThrow(/one of laplace, local, q_shell/);
  });

  it("refuses settings outside the stage and outside the catalog", () => {
    expect(() => proposalToPatch("punch", { backfillMethod: "local" })).toThrow(ProposalError);
    // Physical facts about the sample are not tunable.
    expect(() => proposalToPatch("flatten", { flattenIon: "Mn2+" })).toThrow(/not a flatten setting/);
    expect(() => proposalToPatch("punch", { punchSupercellH: 3 })).toThrow(ProposalError);
  });

  it("shows blank fields as their defaults and only the settings that apply", () => {
    const s = usePipelineStore.getState();
    expect(currentStageSettings("punch", s)).toMatchObject({ punchMinSig: 5, punchMode: "both", punchHGuard: 0.12 });
    const pooled = currentStageSettings("rings", { ...s, ringModel: "pooled" });
    expect(pooled).toHaveProperty("ringPooledSectors", 72);
    expect(pooled).not.toHaveProperty("ringNFourier");
  });
});

describe("parseJsonReply", () => {
  it("finds the object inside fences and after a <think> block", () => {
    expect(parseJsonReply('<think>maybe {"best": 9}</think>\n```json\n{"best": 2, "why": "lower"}\n```')).toEqual({
      best: 2,
      why: "lower",
    });
    expect(parseJsonReply("no json here")).toBeNull();
    expect(parseJsonReply("[1, 2]")).toBeNull();
  });
});

describe("startTuning", () => {
  const dataset = { id: "demo", temperature: "T1", stem: "demo", raw_name: "demo.nxs", stages: [] } as Dataset;
  const RUN = { run_id: "20261009T120000-abcd", dataset_id: "demo~tune~20261009T120000-abcd" };
  const runs: { stages: string[]; trial: string | undefined; minSig: string; method: string }[] = [];
  const initial = usePipelineStore.getState();

  beforeEach(() => {
    runs.length = 0;
    llm.completeChat.mockReset();
    evaluate.evaluateStage.mockReset();
    api.startTuningRun.mockReset().mockResolvedValue(RUN);
    api.promoteTrial.mockReset().mockResolvedValue({ ...RUN, trial: "", files: [] });
    api.fetchDataset.mockReset().mockImplementation(async (id: string) => ({ ...dataset, id }));
    usePipelineStore.setState({
      ...initial,
      ringsEnabled: false,
      punchEnabled: true,
      backfillEnabled: true,
      flatten: false,
      pdfEnabled: false,
      punchMinSig: "",
      backfillMethod: "",
      running: false,
      runStages: vi.fn(async (stages: string[], opts?: RunOptions) => {
        const s = usePipelineStore.getState();
        expect(opts?.datasetId).toBe("demo");
        runs.push({ stages, trial: opts?.tuning?.trial, minSig: s.punchMinSig, method: s.backfillMethod });
        return "done";
      }),
    });
    useTuneStore.setState({ active: false, run: null, stages: [], error: null, finishedNote: null });
    // Leftover peaks fall as the significance gate drops; the punched fraction rises.
    evaluate.evaluateStage.mockImplementation(async (stage: string) => {
      const s = usePipelineStore.getState();
      if (stage === "punch") {
        const sig = s.punchMinSig ? Number(s.punchMinSig) : 5;
        return { total_leftover_peaks: Math.max(0, sig - 4), mean_punched_fraction: 0.1 / sig };
      }
      return { mean_median_seam_sigma: s.backfillMethod === "local" ? 0.6 : 0.9 };
    });
  });

  const promoted = () => api.promoteTrial.mock.calls.map(([, trial]) => trial);

  it("tries each stage in its own trial folder and keeps the best", async () => {
    llm.completeChat
      // punch: propose two, one of them invalid, then pick trial 2
      .mockResolvedValueOnce(
        '{"candidates": [{"changes": {"punchMinSig": 4}, "why": "1 leftover peak"}, {"changes": {"punchMinSig": 1}}]}',
      )
      .mockResolvedValueOnce('{"best": 2, "why": "0 leftover peaks for a small punched-fraction rise"}')
      // backfill: propose one, pick the user's settings
      .mockResolvedValueOnce('{"candidates": [{"changes": {"backfillMethod": "local"}}]}')
      .mockResolvedValueOnce('{"best": 1, "why": "both seamless"}');

    await startTuning({ dataset, stages: ["punch", "backfill"], trialsPerStage: 3, llm: DEFAULT_SETTINGS });

    const { stages, error, finishedNote, run } = useTuneStore.getState();
    expect(error).toBeNull();
    expect(finishedNote).toMatch(/processed files are unchanged/);
    expect(run).toEqual(RUN);
    expect(api.startTuningRun).toHaveBeenCalledWith("demo", "punch");
    const [punch, backfill] = stages;
    // The invalid candidate (min σ 1 < 3) was dropped, not run.
    expect(punch.trials.map((t) => t.changes)).toEqual([{}, { punchMinSig: 4 }]);
    expect(punch.best).toBe(2);
    expect(punch.trials[1].evaluation).toEqual({ total_leftover_peaks: 0, mean_punched_fraction: 0.025 });
    expect(backfill.best).toBe(1);
    // Configure keeps the chosen settings.
    expect(usePipelineStore.getState().punchMinSig).toBe("4");
    expect(usePipelineStore.getState().backfillMethod).toBe("");
    // Every run is a trial in its own folder (none writes processed/), and the
    // chosen trial is kept by copying it — never by running it again.
    expect(runs).toEqual([
      { stages: ["punch"], trial: "punch-1", minSig: "", method: "" },
      { stages: ["punch"], trial: "punch-2", minSig: "4", method: "" },
      { stages: ["backfill"], trial: "backfill-1", minSig: "4", method: "" },
      { stages: ["backfill"], trial: "backfill-2", minSig: "4", method: "local" },
    ]);
    expect(promoted()).toEqual(["punch-2", "backfill-1"]);
    // Each trial is measured through its own view.
    expect(api.fetchDataset).toHaveBeenCalledWith(`${RUN.dataset_id}~punch-2`);
  });

  it("keeps the user's settings when the model proposes nothing", async () => {
    llm.completeChat.mockResolvedValueOnce('{"candidates": []}');
    await startTuning({ dataset, stages: ["backfill"], trialsPerStage: 3, llm: DEFAULT_SETTINGS });
    const [backfill] = useTuneStore.getState().stages;
    expect(backfill.trials).toHaveLength(1);
    expect(backfill.best).toBe(1);
    expect(runs.map((r) => r.trial)).toEqual(["backfill-1"]);
    expect(promoted()).toEqual(["backfill-1"]);
  });

  it("re-runs untuned stages between tuned ones, into the run", async () => {
    llm.completeChat.mockResolvedValue('{"candidates": []}');
    usePipelineStore.setState({ ringsEnabled: true });
    await startTuning({ dataset, stages: ["rings", "backfill"], trialsPerStage: 2, llm: DEFAULT_SETTINGS });
    expect(runs.map((r) => r.trial)).toEqual(["rings-1", "punch-1", "backfill-1"]);
    expect(promoted()).toEqual(["rings-1", "punch-1", "backfill-1"]);
    const punch = useTuneStore.getState().stages.find((r) => r.stage === "punch")!;
    expect(punch.tuned).toBe(false);
    expect(punch.status).toBe("done");
  });

  it("stops with an error when the user's settings fail to run", async () => {
    usePipelineStore.setState({ runStages: vi.fn(async () => "error") });
    await startTuning({ dataset, stages: ["punch"], trialsPerStage: 3, llm: DEFAULT_SETTINGS });
    const { stages, error, active } = useTuneStore.getState();
    expect(active).toBe(false);
    expect(error).toMatch(/punch: the run with the current settings failed/);
    expect(stages[0].status).toBe("failed");
    expect(llm.completeChat).not.toHaveBeenCalled();
    expect(api.promoteTrial).not.toHaveBeenCalled();
  });
});
