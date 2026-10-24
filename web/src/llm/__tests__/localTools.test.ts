// The tools a local model is offered: the reading tools always, those its
// question is about, the acting ones only when it is asked to act. Held to the
// evals: every tool a scenario's checks call for is offered, and no action a
// check forbids.

import { describe, expect, it } from "vitest";

import { HELDOUT_SCENARIOS } from "../evals/heldout";
import { holdoutOptedIn } from "../evals/heldoutFixture";
import { SCENARIOS } from "../evals/scenarios";
import { TASK } from "../evals/validation";
import { CORE_TOOLS, lastQuestion, toolsFor } from "../localTools";
import { CHAT_TOOLS, toolSpecs, type AgentTool } from "../tools";

const offered = (question: string) => toolsFor(question, CHAT_TOOLS).map((t) => t.name);

describe("toolsFor", () => {
  it("offers each eval question every tool its checks call for, and no action a check forbids", () => {
    // The held-out scenarios need no recorded data here, only their questions and
    // checks; they still run with the opt-in alone (heldoutFixture.ts), and a failure
    // names one by its place in the held-out set, not its id or check.
    const named = [
      ...SCENARIOS.map((s) => ({ s, name: s.id, held: false })),
      ...(holdoutOptedIn() ? HELDOUT_SCENARIOS : []).map((s, i) => ({ s, name: `held-out scenario ${i}`, held: true })),
    ];
    for (const { s, name, held } of named) {
      const names = offered(s.question);
      for (const c of s.checks) {
        const what = held ? name : `${name}: ${c.name}`;
        const needs = /^calls ([a-z_]+)/.exec(c.name)?.[1];
        if (needs) expect(names.includes(needs), `${what} is not offered a tool its checks call for`).toBe(true);
        const forbids = /^does not call ([a-z_]+)/.exec(c.name)?.[1];
        if (forbids) expect(names.includes(forbids), `${what} is offered an action a check forbids`).toBe(false);
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

  it("offers a generic question ub_check and texture_check, which the method's checks need (Q10, 2.4.10)", () => {
    const generic = offered("How clean is this reduction?");
    expect(generic).toEqual(expect.arrayContaining(["assess_stage", "qmax_coverage", "symmetry_check", "texture_check", "ub_check"]));
    // A question about something else does without them, as before.
    expect(offered("What are the strongest pair correlations in the 3D-ΔPDF?")).not.toEqual(expect.arrayContaining(["ub_check"]));
    expect(offered("What are the strongest pair correlations in the 3D-ΔPDF?")).not.toContain("texture_check");
  });

  it("offers the regrid only to a message that asks for one: the only message it would run for", () => {
    for (const q of ["Regrid the volume onto the refined UB.", "Please regrid it.", "Run examples/refine_ub.py on this dataset."]) {
      expect(offered(q), q).toContain("regrid_refined_ub");
    }
    for (const q of ["Is the UB right?", "How clean is this reduction?", "Refine the UB.", "Raise the punch's minimum significance to 6.", "Yes, do it.", TASK]) {
      expect(offered(q), q).not.toContain("regrid_refined_ub");
    }
    expect(CORE_TOOLS).not.toContain("regrid_refined_ub");
  });

  it("offers the ΔPDF's feature list to a question about its pair correlations", () => {
    expect(offered("What are the strongest pair correlations in the 3D-ΔPDF, with their vectors and signs?")).toContain("dpdf_peaks");
    expect(offered("Which correlations does the data show?")).toContain("dpdf_peaks");
    expect(offered("Is the powder-ring removal clean on this run?")).not.toContain("dpdf_peaks");
  });
});

describe("lastQuestion", () => {
  it("reads the last user message, text parts included", () => {
    expect(lastQuestion([{ role: "user", content: "first" }, { role: "assistant", content: "ok" }, { role: "user", content: "second" }])).toBe("second");
    expect(lastQuestion([{ role: "user", content: [{ type: "text", text: "look" }, { type: "image_url", image_url: { url: "x" } }] }])).toBe("look");
    expect(lastQuestion([{ role: "system", content: "s" }])).toBe("");
  });
});
