// A conversation to summarize (Summarize and continue, summarize.ts), for the
// model-visible snapshot and the summary's tests: four questions on the
// synthetic crystal, their replies' steps, answers and computed verdicts, one
// reply stopped before it answered, and the Apply cards' decisions of the
// token budget's case (sinceSamples.ts). The answers and the steps carry
// numbers on purpose: none may reach the summary. Synthetic only.

import type { AgentStep } from "../agent";
import type { ChatTurn } from "../chatStore";
import type { ComputedVerdict } from "../verdicts";
import { budgetSince } from "./sinceSamples";

const step = (id: string, name: string, args: Record<string, unknown>, summary: string, status: AgentStep["status"] = "done"): AgentStep => ({
  id,
  name,
  args,
  status,
  summary,
  result: JSON.stringify({ headline: summary }),
});

const verdict = (v: Partial<ComputedVerdict>): ComputedVerdict => ({
  achieved: null,
  stages: {},
  attention: [],
  notMeasured: [],
  dataProblems: [],
  text: "",
  ...v,
});

/** The conversation, oldest first. */
export const SUMMARY_TURNS: ChatTurn[] = [
  { id: 1, role: "user", content: "How clean is the ring removal?" },
  {
    id: 2,
    role: "assistant",
    content: "The rings are gone: the residual is 0.8 % of the powder intensity, and the floor sits at -0.002.",
    steps: [
      step("s1", "read_skill", { name: "ring-removal" }, "Read ring-removal"),
      step("s2", "assess_stage", { stage: "rings" }, "rings: residual 0.8 %"),
      step("s3", "radial_profile", { stage: "rings", q_max: 6.5 }, "36 shells to 6.5 Å⁻¹"),
    ],
    verdict: verdict({ achieved: null, stages: { rings: "pass" }, notMeasured: ["the Bragg punch"], text: "not judged" }),
  },
  { id: 3, role: "user", content: "Assess the whole run, and   check the Bragg punch\nat L = 0.5 too." },
  {
    id: 4,
    role: "assistant",
    content: "Two lattice peaks survived the punch at (1, 0, 0.5), 7.2 σ.",
    steps: [
      step("s4", "assess_stage", { stage: "punch" }, "punch: 2 peaks left at 7.2 σ"),
      step("s5", "measure_reciprocal_cut", { plane: "L", value: 0.5 }, "cut at L = 0.5"),
      step("s6", "assess_stage", { stage: "punch" }, "punch again"),
      step("s7", "grain_check", {}, "failed", "error"),
    ],
    verdict: verdict({
      achieved: false,
      attention: ["the Bragg punch"],
      dataProblems: ["the HKL origin is off by 0.02 r.l.u."],
      text: "not met: needs attention: the Bragg punch; data problems no setting fixes: the HKL origin is off by 0.02 r.l.u.",
    }),
  },
  { id: 5, role: "user", content: "Raise the punch threshold and run from the punch." },
  { id: 6, role: "assistant", content: "", steps: [step("s8", "run_pipeline", { from: "punch" }, "stopped", "stopped")], note: "Stopped." },
  { id: 7, role: "user", content: "Is it met now?" },
  {
    id: 8,
    role: "assistant",
    content: "Yes: {{achieved}}. The punch leaves no lattice peak above 5 σ.",
    steps: [step("s9", "assess_stage", { stage: "punch" }, "punch: none left")],
    verdict: verdict({ achieved: true, text: "met: every stage meets its goal" }),
  },
];

/** The decisions a reply's context has listed, as the summary words them. */
export const summaryDecided = (): string => budgetSince("on the Apply cards");
