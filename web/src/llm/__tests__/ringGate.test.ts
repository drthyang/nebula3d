// The ring gate (tools/shared/ringGate.ts): a change to the ring removal, or a
// tuning of it, waits for the 3D ring verdict to find a ring left or dented on
// the outputs as they now are. A free local eval (THY-63, arm C, 2026-11-01)
// saw gemma4:26b change the ring model on one cut's significant residuals,
// with the 3D verdict clean, and take the dev-rings-shell case's own diffuse
// shell with it. Synthetic results only.

import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../../api/types";
import { usePipelineStore } from "../../state/pipelineStore";
import type { AgentStep } from "../agent";
import { writtenInferences } from "../inference";
import { callTool, CHAT_TOOLS, toolsWithSkills } from "../tools";
import { RECIP_FIELDS } from "../tools/shared/fields";
import { namesRingSetting, namesRingTuning, RING_SETTINGS, ringEvidenceRefusal, ringVerdict, ringVerdictAllowsChange } from "../tools/shared/ringGate";
import { verdicts } from "../verdicts";
import { TASK } from "../evals/validation";
import { namedInOwnWords, skillNamesIn } from "./methodText";

const DATASET = { id: "v-B1", stem: "v_B1", stages: [] } as unknown as Dataset;
const step = (name: string, args: Record<string, unknown>, result: unknown, id = name): AgentStep => ({ id, name, args, status: "done", result: JSON.stringify(result) });

const run = step("run_pipeline", {}, { ended: "done", stages: { rings: "computed", punch: "computed", backfill: "computed", flatten: "computed", pdf: "computed" } }, "run1");
const ringsClean = step("assess_stage", { stage: "rings" }, { rings: { verdict: "meets its goal", max_ring_left: 0, max_ring_dent: 0, mean_ring_energy_ratio: 0.798, max_over_subtraction_fraction: 0.0002 } }, "a1");
const ringsLeft = step("assess_stage", { stage: "rings" }, { rings: { verdict: "needs attention", max_ring_left: 0.42, max_ring_dent: 0, mean_ring_energy_ratio: 0.95, max_over_subtraction_fraction: 0, worst_ring_left: { at: 2.17, residual_fraction: 0.42 } } }, "a2");
// One cut's residuals, as the eval's runs read them: significant bumps, the crystal's own shell at 2.89 among them.
const cut = step("measure_reciprocal_cut", { plane: "hk0", value: 0 }, { cut: "H–K plane at L = 0", ring_removal: { ring_energy_ratio: 0.796, ring_residuals: [{ at: 2.89, residual_fraction: 0.415, noise_fraction: 0.0843, significant: true }] } }, "c1");

const armC = (replySteps: readonly AgentStep[] | undefined, userMessage = TASK) => ({
  dataset: DATASET,
  datasets: [DATASET],
  skills: false,
  skillsRead: new Set<string>(),
  userMessage,
  ...(replySteps ? { replySteps } : {}),
});
const offered = toolsWithSkills(CHAT_TOOLS, false);

describe("the ring gate", () => {
  beforeEach(() => usePipelineStore.setState({ ...usePipelineStore.getInitialState(), running: false }));

  it("refuses a ring-model change on one cut's residuals with the 3D verdict clean, and lets the rest of the call go", async () => {
    expect(ringVerdictAllowsChange({ replySteps: [run, ringsClean, cut] })).toBe(false);
    const alone = await callTool(armC([run, ringsClean, cut]), "update_settings", { changes: { ringModel: "parametric" } }, { tools: offered });
    expect(alone.ok).toBe(false);
    expect(alone.text).toBe(`Error: ${ringEvidenceRefusal("ringModel")}`);
    expect(usePipelineStore.getState().ringModel).toBe("pooled");
    const beside = await callTool(armC([run, ringsClean, cut]), "update_settings", { changes: { punchMinSig: 7, ringGlobalSubtraction: "mean" } }, { tools: offered });
    expect(beside.ok, beside.text).toBe(true);
    const r = JSON.parse(beside.text) as { changed: { setting: string }[]; refused: { setting: string; why: string }[] };
    expect(r.changed.map((c) => c.setting)).toEqual(["punchMinSig"]);
    expect(r.refused).toEqual([{ setting: "ringGlobalSubtraction", why: ringEvidenceRefusal("ringGlobalSubtraction") }]);
  });

  it("refuses with no 3D verdict at all, and lets a change through once the verdict finds a ring left", async () => {
    expect(ringVerdictAllowsChange({ replySteps: [run, cut] })).toBe(false);
    expect(ringVerdictAllowsChange({ replySteps: [run, ringsLeft] })).toBe(true);
    const ok = await callTool(armC([run, ringsLeft]), "update_settings", { changes: { ringModel: "parametric" } }, { tools: offered });
    expect(ok.ok, ok.text).toBe(true);
    expect(usePipelineStore.getState().ringModel).toBe("parametric");
  });

  it("counts a verdict only on the outputs as they now are: a run that recomputed the rings makes it stale", () => {
    const rerun = { ...run, id: "run2" };
    expect(ringVerdictAllowsChange({ replySteps: [run, ringsLeft, rerun] })).toBe(false);
    // An earlier turn's verdict counts while it stands.
    expect(ringVerdictAllowsChange({ earlierSteps: [run, ringsLeft], replySteps: [cut] })).toBe(true);
  });

  it("reads the verdict as the answer checks' reader does (verdicts/readers.ts), stale after a run that recomputed the rings", () => {
    const rerun = { ...run, id: "run2" };
    const reused = step("run_pipeline", {}, { ended: "done", stages: { rings: "reused", punch: "computed" } }, "run3");
    for (const steps of [[run], [run, ringsClean], [run, ringsLeft], [run, ringsLeft, rerun], [run, ringsLeft, reused], [run, ringsLeft, cut, ringsClean]]) {
      expect(ringVerdict(steps), steps.map((x) => x.id).join(", ")).toBe(verdicts({ reply: steps }).checks.rings);
    }
  });

  it("lets the user ask by name, and holds nothing the app calls itself", async () => {
    expect(namesRingSetting(TASK)).toBe(false);
    expect(namesRingTuning(TASK)).toBe(false);
    expect(namesRingSetting("Use the parametric ring model.")).toBe(true);
    expect(namesRingSetting("Set ringPooledSectors to 96.")).toBe(true);
    expect(namesRingTuning("Tune the rings, please.")).toBe(true);
    const asked = await callTool(armC([run, ringsClean, cut], "Use the parametric ring model."), "update_settings", { changes: { ringModel: "parametric" } }, { tools: offered });
    expect(asked.ok, asked.text).toBe(true);
    expect(ringVerdictAllowsChange({})).toBe(true);
  });

  it("holds a tuning of the rings alone the same way", async () => {
    const t = await callTool(armC([run, ringsClean, cut]), "tune_pipeline", { stages: ["rings"] }, { tools: offered });
    expect(t.ok).toBe(false);
    expect(t.text).toBe(`Error: ${ringEvidenceRefusal("A tuning of the powder-ring subtraction")}`);
  });

  it("refuses in words that name no skill, tool or stage and hold no inference, the same in both arms", async () => {
    const spans = writtenInferences()
      .map((e) => e.span.text.trim())
      .filter((x) => x.split(/\s+/).length >= 3);
    for (const what of [...RING_SETTINGS, "A tuning of the powder-ring subtraction"]) {
      const text = ringEvidenceRefusal(what);
      expect([...skillNamesIn(text), ...namedInOwnWords(text), ...spans.filter((x) => text.includes(x))], text).toEqual([]);
    }
    const c = await callTool(armC([run, ringsClean, cut]), "update_settings", { changes: { ringModel: "patched" } }, { tools: offered });
    const b = await callTool({ ...armC([run, ringsClean, cut]), skills: true, skillsRead: new Set(["reduction-qc"]) }, "update_settings", { changes: { ringModel: "patched" } });
    expect(b.text).toBe(c.text);
  });
});

describe("the cut's glossary says its bumps are no ring verdict", () => {
  it("in both arms, with the 3D verdict named only as arm B's reading", () => {
    expect(RECIP_FIELDS.whole).toMatch(/no ring verdict: one cut's bumps include the crystal's own scattering, and only assess_stage rings judges rings, in 3D\./);
    expect(RECIP_FIELDS.definitions).toMatch(/no ring verdict: one cut's bumps include the crystal's own scattering\./);
    expect(RECIP_FIELDS.definitions).not.toMatch(/assess_stage/);
    expect(RECIP_FIELDS.whole).not.toMatch(/a ring left/);
  });
});
