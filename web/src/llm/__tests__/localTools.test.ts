// The tools a local model is offered: the reading tools always, those its
// question is about, the acting ones only when it is asked to act. Held to the
// evals: every tool a scenario's checks call for is offered, and no action a
// check forbids.

import { describe, expect, it } from "vitest";

import { HELDOUT_SCENARIOS } from "../evals/heldout";
import { SCENARIOS } from "../evals/scenarios";
import { CORE_TOOLS, lastQuestion, toolsFor } from "../localTools";
import { CHAT_TOOLS, toolSpecs, type AgentTool } from "../tools";

const offered = (question: string) => toolsFor(question, CHAT_TOOLS).map((t) => t.name);

describe("toolsFor", () => {
  it("offers each eval question every tool its checks call for, and no action a check forbids", () => {
    for (const s of [...SCENARIOS, ...HELDOUT_SCENARIOS]) {
      const names = offered(s.question);
      for (const c of s.checks) {
        const needs = /^calls ([a-z_]+)/.exec(c.name)?.[1];
        if (needs) expect(names, `${s.id}: ${c.name}`).toContain(needs);
        const forbids = /^does not call ([a-z_]+)/.exec(c.name)?.[1];
        if (forbids) expect(names, `${s.id}: ${c.name}`).not.toContain(forbids);
      }
    }
  });

  it("gives the reading tools to every question, and the acting ones only when asked to act", () => {
    for (const q of ["Is the powder-ring removal clean on this run?", "How does it look?"]) {
      expect(offered(q)).toEqual(expect.arrayContaining(CORE_TOOLS));
      expect(offered(q)).not.toContain("update_settings");
    }
    expect(offered("Should I switch to the separable window?")).not.toContain("update_settings");
    for (const q of ["Raise the punch's minimum significance to 6.", "The rings look fine. Can you rerun the pipeline?", "Please tune the flatten."]) {
      expect(offered(q), q).toEqual(expect.arrayContaining(["update_settings", "run_pipeline", "tune_pipeline"]));
    }
  });

  it("offers a question about the rings their tools and not the lattice's, in far less room", () => {
    const rings = offered("Is the powder-ring removal clean on this run?");
    expect(rings).toEqual(expect.arrayContaining(["assess_stage", "radial_profile", "texture_check"]));
    expect(rings).not.toContain("ub_check");
    expect(rings).not.toContain("measure_dpdf_cut");
    const size = (tools: AgentTool[]) => JSON.stringify(toolSpecs(tools)).length;
    expect(size(toolsFor("Is the powder-ring removal clean on this run?", CHAT_TOOLS))).toBeLessThan(0.6 * size(CHAT_TOOLS));
  });

  it("offers the ΔPDF's feature list to a question about its pair correlations", () => {
    expect(offered("What are the strongest pair correlations in the 3D-ΔPDF, with their vectors and signs?")).toContain("dpdf_peaks");
    expect(offered("Which correlations does the data show?")).toContain("dpdf_peaks");
    expect(offered("Is the powder-ring removal clean on this run?")).not.toContain("dpdf_peaks");
  });

  it("gives a question about nothing in particular the common diagnostics, and keeps tools it has no rule for", () => {
    expect(offered("How does this reduction look?")).toEqual(expect.arrayContaining(["radial_profile", "qmax_coverage", "symmetry_check", "bragg_peaks"]));
    const custom: AgentTool = { name: "custom", description: "d", parameters: {}, run: async () => ({ result: {}, summary: "" }) };
    expect(toolsFor("Is the ring removal clean?", [...CHAT_TOOLS, custom]).map((t) => t.name)).toContain("custom");
  });
});

describe("lastQuestion", () => {
  it("reads the last user message, text parts included", () => {
    expect(lastQuestion([{ role: "user", content: "first" }, { role: "assistant", content: "ok" }, { role: "user", content: "second" }])).toBe("second");
    expect(lastQuestion([{ role: "user", content: [{ type: "text", text: "look" }, { type: "image_url", image_url: { url: "x" } }] }])).toBe("look");
    expect(lastQuestion([{ role: "system", content: "s" }])).toBe("");
  });
});
