// Which cards the assistant lights: what a running step works on (narrowed to
// the stage a run is on), what the reply mentions, and how long that lasts.

import { beforeEach, describe, expect, it } from "vitest";

import { usePipelineStore } from "../../state/pipelineStore";
import { useChatStore } from "../chatStore";
import { agentKeys, LINGER_MS, mentionKeys, stepKeys } from "../highlight";
import { useTuneStore } from "../tune/tuner";

const live = (steps: { name: string; args?: Record<string, unknown>; status: "running" | "done" }[], content = "") => ({
  content,
  reasoning: "",
  steps: steps.map((s, i) => ({ id: String(i), args: {}, ...s })),
});

beforeEach(() => {
  useChatStore.setState({ turns: [], busy: false, live: null });
  usePipelineStore.setState({ running: false, events: [] });
  useTuneStore.setState({ active: false, stages: [] });
});

describe("stepKeys", () => {
  it("names what each step works on", () => {
    expect(stepKeys({ name: "assess_stage", args: { stage: "rings" } })).toEqual(["rings"]);
    expect(stepKeys({ name: "assess_stage", args: { stage: "pdf" } })).toEqual(["pdf", "check"]);
    expect(stepKeys({ name: "assess_stage", args: {} })).toEqual(["rings", "punch", "backfill", "flatten", "pdf"]);
    expect(stepKeys({ name: "line_profile", args: { stage: "braggpunched" } })).toEqual(["punch"]);
    expect(stepKeys({ name: "texture_check", args: {} })).toEqual(["punch", "backfill"]);
    expect(stepKeys({ name: "qmax_coverage", args: {} })).toEqual(["raw", "pdf"]);
    expect(stepKeys({ name: "bragg_peaks", args: {} })).toEqual(["bragg"]);
    expect(stepKeys({ name: "update_settings", args: { changes: { punchMinSig: 6, backfillMethod: "laplace" } } })).toEqual(["punch", "backfill"]);
    expect(stepKeys({ name: "describe_dataset", args: {} })).toEqual([]);
  });
});

describe("mentionKeys", () => {
  it("finds the cards an answer talks about", () => {
    expect(mentionKeys("The ring_energy_ratio is 0.5 and no leftover peaks remain after the punch.")).toEqual(["rings", "punch"]);
    expect(mentionKeys("The back-FFT r is 0.98, so the ΔPDF reproduces the data.")).toEqual(["pdf", "check"]);
    expect(mentionKeys("During the run nothing changed.")).toEqual([]);
  });
});

describe("agentKeys", () => {
  it("lights the running step's cards and what the reply mentions so far", () => {
    useChatStore.setState({
      busy: true,
      live: live([{ name: "texture_check", status: "running" }], "The flatten floor is level."),
    });
    expect(agentKeys().sort()).toEqual(["backfill", "flatten", "punch"]);
  });

  it("narrows a pipeline run to the stage it is on", () => {
    useChatStore.setState({ busy: true, live: live([{ name: "run_pipeline", status: "running" }]) });
    usePipelineStore.setState({
      running: true,
      events: [
        { type: "progress", stage: "rings", status: "done" },
        { type: "progress", stage: "punch", status: "progress", fraction: 0.4 },
      ],
    });
    expect(agentKeys()).toEqual(["punch"]);
  });

  it("keeps what the last reply mentioned until the linger ends", () => {
    useChatStore.setState({ turns: [{ id: 1, role: "assistant", content: "The backfill seams are clean." }] });
    const now = 1_000_000;
    expect(agentKeys(now, now + LINGER_MS)).toEqual(["backfill"]);
    expect(agentKeys(now + LINGER_MS + 1, now + LINGER_MS)).toEqual([]);
  });
});
