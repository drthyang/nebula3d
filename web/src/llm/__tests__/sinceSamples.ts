// The "since the last reply" line (apply/since.ts) for the model-visible
// snapshot and the token budget: the cards a reply on the synthetic crystal
// leads to (buildProposals over a punch record that asks about a modulation,
// and an answer that names two settings), and the decisions on them, as the
// actions log them. Synthetic only.

import { usePipelineStore } from "../../state/pipelineStore";
import type { AgentStep } from "../agent";
import type { Decision } from "../apply/decisions";
import { buildProposals, type Proposal } from "../apply/proposals";
import { sinceLine } from "../apply/since";

const RUN: AgentStep = {
  id: "r1",
  name: "run_pipeline",
  args: {},
  status: "done",
  summary: "Ran from Bragg punch",
  result: JSON.stringify({ off_lattice_bunching: { facts: "", ask_user: "… Does the sample have a modulation with k = (0, 1/3, 0)?" } }),
};

/** The cards: the modulation (a fact), punchMinSig and ringPooledSectors (settings), as the reply's answer names them. */
export function sampleCards(): { modulation: Proposal; punch: Proposal; rings: Proposal } {
  const ps = buildProposals({
    turn: 2,
    steps: [RUN],
    answer: "Try punchMinSig 6, or ringPooledSectors 32.",
    config: usePipelineStore.getInitialState(),
    dataset: "demo",
    firstId: 1,
  });
  const by = (key: string) => ps.find((p) => key in p.change)!;
  return { modulation: by("modulation"), punch: by("punchMinSig"), rings: by("ringPooledSectors") };
}

const decision = (d: Partial<Decision> & Pick<Decision, "id" | "proposal" | "kind" | "title" | "shown" | "action">): Decision => ({
  by: "you",
  at: 0,
  before: {},
  after: {},
  ...d,
});

/**
 * The budget's case (docs/pilot-auto-mode-design.md §4: three decisions): the
 * user applied the punch setting, declined the modulation (the longest line a
 * card makes: its declaration in words) and ran from the punch. `lead`: the
 * line's words before them (sinceLine's; a summary's "on the Apply cards").
 */
export function budgetSince(lead?: string): string {
  const { modulation, punch } = sampleCards();
  return sinceLine(
    [
      decision({ id: "D1", proposal: punch.id, kind: "setting", title: punch.title, shown: punch.shown, action: "apply", before: { punchMinSig: "" }, after: { punchMinSig: "6" }, runFrom: "punch" }),
      decision({ id: "D2", proposal: modulation.id, kind: "fact", title: modulation.title, shown: modulation.shown, action: "dismiss" }),
      decision({ id: "D3", proposal: "P9", kind: "run", title: "Run from Bragg punch", shown: { from: "", to: "Punch min σ 5 → 6" }, action: "apply", runFrom: "punch" }),
    ],
    [modulation, punch],
    lead,
  )!;
}

/** Every kind of decision, one each, as the line words it. */
export function everyKind(): { what: string; line: string }[] {
  const { modulation, punch, rings } = sampleCards();
  const trial: Proposal = {
    ...punch,
    id: "P4",
    kind: "trial",
    title: "Trial #3",
    change: { punchMinSig: 6, punchSupercellH: 2 },
    fields: { punchMinSig: "6", punchSupercellH: "2" },
    shown: { from: "", to: "punchMinSig=6, punchSupercellH=2" },
    source: { via: "trial" },
    trial: { stage: "punch", n: 3 },
  };
  const cards = [modulation, punch, rings, trial];
  const one = (what: string, d: Decision) => ({ what, line: sinceLine([d], cards)! });
  return [
    one("Apply", decision({ id: "D1", proposal: punch.id, kind: "setting", title: punch.title, shown: punch.shown, action: "apply" })),
    one("Edit and apply", decision({ id: "D1", proposal: rings.id, kind: "setting", title: rings.title, shown: { from: rings.shown.from, to: "48" }, action: "edit-apply" })),
    one("Dismiss", decision({ id: "D1", proposal: rings.id, kind: "setting", title: rings.title, shown: rings.shown, action: "dismiss" })),
    one("Undo", decision({ id: "D1", proposal: punch.id, kind: "setting", title: punch.title, shown: { from: punch.shown.to, to: punch.shown.from }, action: "undo" })),
    one("Apply on a sample fact (the user's click)", decision({ id: "D1", proposal: modulation.id, kind: "fact", title: modulation.title, shown: modulation.shown, action: "apply", byClick: true })),
    one("Dismiss a sample fact", decision({ id: "D1", proposal: modulation.id, kind: "fact", title: modulation.title, shown: modulation.shown, action: "dismiss" })),
    one("Run", decision({ id: "D1", proposal: "P9", kind: "run", title: "Run from Bragg punch", shown: { from: "", to: "" }, action: "apply", runFrom: "punch" })),
    one("Dismiss a Run card", decision({ id: "D1", proposal: "P9", kind: "run", title: "Run from Ring removal", shown: { from: "", to: "" }, action: "dismiss", runFrom: "rings" })),
    one(
      "Apply a tuning trial",
      decision({ id: "D1", proposal: trial.id, kind: "trial", title: trial.title, shown: trial.shown, action: "apply", before: { punchMinSig: "", punchSupercellH: "" }, after: { punchMinSig: "6", punchSupercellH: "2" } }),
    ),
    one("Dismiss a tuning trial", decision({ id: "D1", proposal: trial.id, kind: "trial", title: trial.title, shown: trial.shown, action: "dismiss" })),
    one("A change auto mode made (THY-65 PR 6)", { ...decision({ id: "D1", proposal: punch.id, kind: "setting", title: punch.title, shown: punch.shown, action: "apply" }), by: "auto" }),
  ];
}
