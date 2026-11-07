// The Apply cards' proposals (apply/proposals.ts): each source a reply's tools
// return to its card, the answer parser's corpus, and what gets no card.

import { describe, expect, it } from "vitest";

import { usePipelineStore, type PipelineConfig } from "../../state/pipelineStore";
import type { AgentStep } from "../agent";
import { buildProposals, settingsInAnswer, type BuildInput } from "../apply/proposals";
import type { StageRun } from "../tune/tuner";

const step = (name: string, args: Record<string, unknown>, result: unknown, id = name, status: AgentStep["status"] = "done"): AgentStep => ({
  id,
  name,
  args,
  status,
  summary: `${name} line`,
  result: typeof result === "string" ? result : JSON.stringify(result),
});

const CONFIG = (over: Partial<PipelineConfig> = {}): PipelineConfig => ({ ...usePipelineStore.getInitialState(), ...over });

const build = (over: Partial<BuildInput>) =>
  buildProposals({ turn: 4, steps: [], answer: "", config: CONFIG(), dataset: "demo", firstId: 1, ...over });

describe("the proposals a reply's tools lead to", () => {
  it("a refused sample fact: its card holds the call's own values, held for the user", () => {
    const punch = step("assess_stage", { stage: "punch" }, { punch: { verdict: "needs attention" } }, "a1");
    const refused = step(
      "update_settings",
      { changes: { punchSupercellL: 2, punchMinSig: 6 } },
      { changed: [{ setting: "punchMinSig", from: 5, to: 6 }], refused: [{ setting: "punchSupercellL", why: "…" }], rerun_from: "punch" },
      "u1",
    );
    const run = step("run_pipeline", { from_stage: "punch" }, { ended: "done", stages: { punch: "computed" } }, "r1");
    const ps = build({ steps: [punch, refused, run] });
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({
      id: "P1",
      turn: 4,
      kind: "fact",
      held: "fact",
      title: "Supercell L",
      change: { punchSupercellL: 2 },
      fields: { punchSupercellL: "2" },
      from: { punchSupercellL: "" },
      shown: { from: "1", to: "2" },
      runFrom: "punch",
      source: { step: "u1", via: "refused" },
      evidence: [{ step: "a1", n: 1, label: "Assessed a stage", text: "assess_stage line" }],
      dataset: "demo",
      status: "open",
    });
  });

  it("a change and no run after it: a Run card from its rerun_from; a run after it: none", () => {
    const set = step("update_settings", { changes: { punchMinSig: 6 } }, { changed: [{ setting: "punchMinSig", from: 5, to: 6 }], rerun_from: "punch" }, "u1");
    const [run] = build({ steps: [set] });
    expect(run).toMatchObject({ kind: "run", title: "Run from Bragg punch", runFrom: "punch", shown: { from: "", to: "Punch min σ 5 → 6" }, source: { via: "rerun" } });
    const ran = step("run_pipeline", { from_stage: "punch" }, { ended: "done" }, "r1");
    expect(build({ steps: [set, ran] })).toEqual([]);
  });

  it("a call that failed with every change refused: a card per refused fact, and a ring change the gate held", () => {
    const failed = step(
      "update_settings",
      { changes: { modulation: { k: "1/3, 0, 0" }, ringModel: "parametric" } },
      "Error: modulation is a fact about the sample … ringModel waits for a 3D verdict that a powder ring is left",
      "u1",
      "error",
    );
    const ps = build({ steps: [failed] });
    expect(ps.map((p) => [p.kind, p.held, Object.keys(p.change)[0]])).toEqual([
      ["fact", "fact", "modulation"],
      ["setting", "ring", "ringModel"],
    ]);
  });

  it("the edge trim and a symmetry setting are the user's: held", () => {
    const refused = step(
      "update_settings",
      { changes: { edgeTrim: 2, symmetryLaue: "m-3m" } },
      { changed: [], refused: [{ setting: "edgeTrim", why: "" }, { setting: "symmetryLaue", why: "" }], rerun_from: null },
    );
    expect(build({ steps: [refused] }).map((p) => [p.title, p.held])).toEqual([
      ["Edge trim", "choice"],
      ["Laue class", "symmetry"],
    ]);
  });

  it("the punch record's question: a modulation card at its k", () => {
    const run = step("run_pipeline", {}, {
      ended: "done",
      off_lattice_bunching: { facts: "…", ask_user: "7 of the 31 sharp peaks off the lattice sit at K = n ± 1/3, where about 0.4 would by chance. Does the sample have a modulation with k = (0, 1/3, 0)?" },
    });
    const [p] = build({ steps: [run] });
    expect(p).toMatchObject({ kind: "fact", held: "fact", title: "Modulation", source: { via: "ask_user" } });
    expect(p.fields).toMatchObject({ modulationK: "0, 1/3, 0" });
    expect(p.evidence[0].text).toBe("7 of the 31 sharp peaks off the lattice sit at K = n ± 1/3, where about 0.4 would by chance.");
  });

  it("the Laue class compare_laue_classes suggests, and a |Q| band the band check flags", () => {
    const laue = step("compare_laue_classes", {}, { suggestion: "m-3m", classes: [], flag: null });
    const flagged = step("qmax_coverage", {}, { suggested_band: [0.5, 7.2], band_check: "no |Q| band is set: the transform takes every voxel" });
    const fine = step("qmax_coverage", {}, { suggested_band: [0.5, 7.2], band_check: "the band 0.5–7.2 Å⁻¹ stays inside the counts" }, "q2");
    const ps = build({ steps: [laue, flagged] });
    expect(ps.map((p) => [p.title, p.held, p.shown.to])).toEqual([
      ["Laue class", "symmetry", "m-3m"],
      ["|Q| band", "user-only", "0.5–7.2 Å⁻¹"],
    ]);
    expect(build({ steps: [fine] })).toEqual([]);
    // The class already set: no card.
    expect(build({ steps: [laue], config: CONFIG({ symmetryLaue: "m-3m" }) })).toEqual([]);
  });

  it("a setting the answer names with a value no call set: a card marked as the answer's", () => {
    const [p] = build({ answer: "The leftovers are faint; I suggest punchMinSig 6 and another run." });
    expect(p).toMatchObject({ kind: "setting", title: "Punch min σ", source: { via: "answer" }, fields: { punchMinSig: "6" }, shown: { from: "5", to: "6" }, evidence: [] });
    // A call set it: the call's card (or none), not the answer's.
    const set = step("update_settings", { changes: { punchMinSig: 6 } }, { changed: [{ setting: "punchMinSig", from: 5, to: 6 }], rerun_from: "punch" });
    expect(build({ steps: [set], answer: "I set punchMinSig to 6." }).map((x) => x.source.via)).toEqual(["rerun"]);
    // Out of range, not a value, or the value it has: no card.
    expect(build({ answer: "punchMinSig 99" })).toEqual([]);
    expect(build({ answer: "punchMinSig is fine" })).toEqual([]);
    expect(build({ answer: "punchMinSig 5 is the default" })).toEqual([]);
    // A fact named in the answer is the user's: held.
    expect(build({ answer: "Try punchSupercellH = 2." })[0]).toMatchObject({ kind: "fact", held: "fact" });
  });

  it("a tuning run's trials: each that ran, but the one it kept", () => {
    const tune = step("tune_pipeline", { stages: ["punch"] }, { minutes: 1 });
    const run: StageRun = {
      stage: "punch",
      tuned: true,
      status: "done",
      best: 2,
      trials: [
        { n: 1, changes: {}, settings: { punchMinSig: 5 }, status: "done" },
        { n: 2, changes: { punchMinSig: 6 }, settings: { punchMinSig: 6 }, status: "done" },
        { n: 3, changes: { punchMinSig: 7 }, settings: { punchMinSig: 7 }, status: "done" },
        { n: 4, changes: { punchMinSig: 8 }, settings: { punchMinSig: 8 }, status: "error" },
      ],
    };
    const ps = build({ steps: [tune], tune: [run], config: CONFIG({ punchMinSig: "6" }) });
    expect(ps.map((p) => [p.kind, p.trial, p.fields, p.shown.to])).toEqual([
      ["trial", { stage: "punch", n: 1 }, { punchMinSig: "5" }, "your settings"],
      ["trial", { stage: "punch", n: 3 }, { punchMinSig: "7" }, "punchMinSig=7"],
    ]);
    // No tuning call in the reply: the store's last run is another reply's.
    expect(build({ tune: [run] })).toEqual([]);
  });

  it("names a method setting by its stage and its Configure label, the key behind it", () => {
    const [p] = build({ answer: "punchMinSig 6" });
    expect(p.title).toBe("Punch min σ");
    expect(Object.keys(p.change)).toEqual(["punchMinSig"]);
    expect(build({ answer: "punchHGuard 0.2" })[0].title).toBe("Punch H guard (r.l.u.)"); // a capital that is no word's start stays
  });

  it("numbers on from firstId, and the same change twice is one card", () => {
    const ps = build({ answer: "punchMinSig 6. Again: punchMinSig → 6, and ringPooledSectors 32.", firstId: 7 });
    expect(ps.map((p) => [p.id, p.title])).toEqual([
      ["P7", "Ring sectors (n)"],
      ["P8", "Punch min σ"],
    ]);
  });
});

describe("the answer parser", () => {
  // [answer, the (key, value) mentions it reads]
  const CORPUS: [string, [string, string][]][] = [
    ["Set punchMinSig to 6.", [["punchMinSig", "6"]]],
    ["`punchMinSig`: 6", [["punchMinSig", "6"]]],
    ["**punchMinSig** = 6", [["punchMinSig", "6"]]],
    ["punchMinSig from 8 to 6", [["punchMinSig", "6"]]],
    ["punchMinSig 8 → 6", [["punchMinSig", "6"]]],
    ["punchMinSig 8 -> 6", [["punchMinSig", "6"]]],
    ["ringModel parametric would follow the texture", [["ringModel", "parametric"]]],
    ["punchFitUnconstrained true", [["punchFitUnconstrained", "true"]]],
    ["the min sigma (punchMinSigma) 6", []], // not the exact key
    ["mypunchMinSig 6", []],
    ["No settings named here.", []],
  ];
  it.each(CORPUS)("%s", (answer, want) => {
    expect(settingsInAnswer(answer).map(({ key, value }) => [key, value])).toEqual(want);
  });

  it("never reads the modulation, a declaration of several parts", () => {
    expect(settingsInAnswer("modulation none")).toEqual([]);
  });
});
