// A Run card starts no later than the first stage whose input is on disk
// (apply/proposals.ts, runnableFrom): a pre-run reply that set two punch
// settings, with only the raw volume there, offered "Run from Bragg punch".

import { beforeEach, describe, expect, it } from "vitest";

import { usePipelineStore } from "../../state/pipelineStore";
import type { AgentStep } from "../agent";
import { buildProposals, runnableFrom } from "../apply/proposals";

const out = (...names: string[]) => ["raw", ...names].map((name) => ({ name, exists: true }));
const ALL = out("ringremoved", "braggpunched", "backfilled", "flattened", "delta_pdf");

const punchChange: AgentStep = {
  id: "s1",
  name: "update_settings",
  args: { changes: { punchMinSig: 6 } },
  status: "done",
  result: JSON.stringify({ changed: [{ setting: "punchMinSig", from: "5", to: "6" }], rerun_from: "punch" }),
};
const runCards = (outputs?: { name: string; exists: boolean }[]) =>
  buildProposals({ turn: 2, steps: [punchChange], answer: "", config: usePipelineStore.getState(), dataset: "demo", firstId: 1, outputs }).filter((p) => p.kind === "run");

beforeEach(() => usePipelineStore.setState({ ...usePipelineStore.getInitialState(), running: false }));

describe("where a Run card starts", () => {
  it("from the change's stage when the stage before it has its output", () => {
    expect(runCards(ALL).map((p) => [p.runFrom, p.title])).toEqual([["punch", "Run from Bragg punch"]]);
    expect(runCards(out("ringremoved")).map((p) => p.runFrom)).toEqual(["punch"]);
    expect(runCards(undefined).map((p) => p.runFrom)).toEqual(["punch"]); // outputs unknown: as asked
  });

  it("from the first stage whose input is there: the raw volume alone runs from the ring removal", () => {
    expect(runCards(out()).map((p) => [p.runFrom, p.title])).toEqual([["rings", "Run from Ring removal"]]);
    const cfg = usePipelineStore.getState();
    expect(runnableFrom("flatten", out("ringremoved"), cfg)).toBe("punch");
    expect(runnableFrom("rings", out(), cfg)).toBe("rings");
    // A stage switched off is passed over: its output is not what the next one reads.
    expect(runnableFrom("flatten", out("ringremoved", "braggpunched"), { ...cfg, backfillEnabled: false })).toBe("flatten");
  });
});
