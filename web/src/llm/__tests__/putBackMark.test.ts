// The mark an auto run leaves where it put a fix's outputs back without a run
// (putBackMark.ts) is a boundary for evidence exactly as the run it stands for
// (evidence.ts, recomputedAt; the ring gate): with the same steps and the same
// answer, the answer checks, the verdict readers and the ring gate read the
// same on the path that restored the outputs and on the one that ran the
// pipeline again. Without the mark, the check made on the fix's outputs, which
// are gone, would still count. And the mark is nothing a model is offered or
// reads. Made-up numbers.

import { describe, expect, it } from "vitest";

import type { AgentStep } from "../agent";
import { toolStepsIn } from "../agent";
import { answerIssues, earlierSources, evidenceGaps } from "../answerChecks";
import { stageKind, stageOutcomes } from "../auto/plan";
import { problemsFound } from "../auto/problems";
import { digest, fixPrompt, REPORT_PROMPT } from "../auto/prompts";
import { isAppStep, autoTranscript } from "../auto/transcript";
import { FIX_TOOLS, REPORT_TOOLS } from "../auto/controller";
import { recomputedAt } from "../evidence";
import { isPutBackMark, OUTPUTS_PUT_BACK, putBackMark, putBackMarkId } from "../putBackMark";
import { CHAT_TOOLS, factsOf } from "../tools";
import { ringVerdict } from "../tools/shared/ringGate";
import { verdicts } from "../verdicts";

let n = 0;
const step = (name: string, args: Record<string, unknown>, result: unknown): AgentStep => ({ id: `auto:A1:${++n}`, name, args, status: "done", result: JSON.stringify(result) });
const ringCheck = (left: number, ratio: number) => step("assess_stage", { stage: "rings" }, { rings: { mean_ring_energy_ratio: ratio, max_over_subtraction_fraction: 0.002, max_ring_left: left, max_ring_dent: 0, shells_judged: [] } });
const FROM_RINGS = { rings: "computed", punch: "computed", backfill: "computed", flatten: "computed", pdf: "computed", pdf_check: "computed" };
const runFrom = (stage: string) => step("run_pipeline", { from_stage: stage }, { ended: "done", stages: FROM_RINGS, outputs: ["raw"], log_tail: [] });

// A ring fix put back: the check before it (0.298), its run, the check on its outputs (0.317, ratio 0.469),
// then the outputs of before again, and the check on them (0.298).
const c0 = ringCheck(0.298, 0.456);
const r1 = runFrom("rings");
const c1 = ringCheck(0.317, 0.469);
const c2 = ringCheck(0.298, 0.456);
const mark = putBackMark(putBackMarkId("A1", 9), ["rings", "punch", "backfill", "flatten", "pdf", "pdf_check"]);
const first = step("run_pipeline", {}, { ended: "done", stages: FROM_RINGS, outputs: ["raw"], log_tail: [] });

const restored: AgentStep[] = [first, c0, r1, c1, mark, c2]; // the outputs put back
const rerun: AgentStep[] = [first, c0, r1, c1, runFrom("rings"), c2]; // the pipeline run again, as before
const unmarked: AgentStep[] = [first, c0, r1, c1, c2]; // what the restore left without the mark

describe("the mark as an evidence boundary: the same as the run it stands for", () => {
  it("marks the stages from the fix's on as recomputed where it stands", () => {
    expect(recomputedAt(restored)).toEqual(recomputedAt(rerun));
    expect(recomputedAt(restored).rings).toBe(4);
    expect(recomputedAt(unmarked).rings).toBe(2);
    // Only the stages it names: outputs put back from the flatten on leave the rings' checks standing.
    const later = putBackMark("put-back:A1:1", ["flatten", "pdf", "pdf_check"]);
    expect(recomputedAt([c0, later])).toMatchObject({ rings: -1, punch: -1, backfill: -1, flatten: 1, pdf: 1 });
  });

  it("earlierSources: the check on the fix's outputs is stale on both paths, the re-check current", () => {
    const a = earlierSources(toolStepsIn([{ steps: restored }]), []);
    const b = earlierSources(toolStepsIn([{ steps: rerun }]), []);
    // The same but for the boundary's own text (the run's result; the mark's, which holds no number).
    const checks = (xs: string[]) => xs.filter((x) => x.includes("max_ring_left"));
    expect(checks(a.standing)).toEqual(checks(b.standing));
    expect(a.stale).toBe(b.stale);
    expect(checks(a.standing)).toEqual([c2.result]);
    expect(a.stale).toContain("0.317");
    expect(a.stale).toContain("0.469");
    expect(mark.result).not.toMatch(/\d/);
    // Without the mark the fix's check would stand, its numbers a source.
    const without = earlierSources(toolStepsIn([{ steps: unmarked }]), []);
    expect(checks(without.standing)).toEqual([c1.result, c2.result]);
    expect(without.stale).not.toContain("0.317");
  });

  it("answerIssues: a number only the fix's check holds is stale on both paths, the re-check's go through", () => {
    const issues = (earlier: AgentStep[], text: string) => {
      const { standing, stale } = earlierSources(toolStepsIn([{ steps: earlier }]), []);
      return answerIssues(text, [], standing.join("\n"), stale);
    };
    const quotesFix = "The ring left is 0.317, at a ring ratio of 0.469.";
    const quotesNow = "The ring left is 0.298, at a ring ratio of 0.456.";
    expect(issues(restored, quotesFix)).toEqual(issues(rerun, quotesFix));
    expect(issues(restored, quotesFix)!.staleNumbers).toEqual(["0.317", "0.469"]);
    expect(issues(restored, quotesFix)!.untraced).toEqual([]);
    expect(issues(restored, quotesNow)).toEqual(issues(rerun, quotesNow));
    const numbers = (i: ReturnType<typeof issues>) => [i?.staleNumbers ?? [], i?.untraced ?? []];
    expect(numbers(issues(restored, quotesNow))).toEqual([[], []]);
    // Without the mark the fix's numbers pass as current.
    expect(numbers(issues(unmarked, quotesFix))).toEqual([[], []]);
  });

  it("evidenceGaps: a verdict resting on a check made before the outputs were put back is stale on both paths", () => {
    const claim = "The ring removal is clean.";
    const before = (boundary: AgentStep) => [first, c0, r1, c1, boundary];
    expect(evidenceGaps(claim, before(mark))).toEqual(evidenceGaps(claim, before(runFrom("rings"))));
    expect(evidenceGaps(claim, before(mark)).stale.map((t) => t.id)).toEqual(["rings"]);
    expect(evidenceGaps(claim, [first, c0, r1, c1]).stale).toEqual([]);
    expect(evidenceGaps(claim, restored)).toEqual(evidenceGaps(claim, rerun));
    expect(evidenceGaps(claim, restored)).toEqual({ missing: [], stale: [] });
  });

  it("the verdict readers, the run's problems and the ring gate read the same on both paths", () => {
    expect(verdicts({ reply: restored })).toEqual(verdicts({ reply: rerun }));
    expect(problemsFound(restored)).toEqual(problemsFound(rerun));
    expect(ringVerdict(restored)).toBe(ringVerdict(rerun));
    // With no check after it, no ring verdict stands on either; without the mark, the fix's would.
    expect([ringVerdict([c0, r1, c1, mark]), ringVerdict([c0, r1, c1, runFrom("rings")])]).toEqual([undefined, undefined]);
    expect(ringVerdict([c0, r1, c1])).toBe("attention");
  });

  it("leaves a stage's own verdict from its checks as it was", () => {
    for (const steps of [restored, rerun, unmarked]) {
      expect(stageKind("rings", steps)).toBe("attention");
      expect(stageOutcomes("rings", steps).map((o) => [o.check, o.kind, o.reasons])).toEqual([["rings", "attention", ["ring left"]]]);
    }
    expect(stageOutcomes("rings", [mark])).toEqual([]);
  });
});

describe("the mark is the record's alone: nothing a model is offered or reads", () => {
  it("is no tool: in no list a reply is offered, with no facts of its own", () => {
    for (const tools of [CHAT_TOOLS, FIX_TOOLS, REPORT_TOOLS]) expect(tools.map((t) => t.name)).not.toContain(OUTPUTS_PUT_BACK);
    expect(factsOf(OUTPUTS_PUT_BACK)).toMatchObject({ acts: null, invalidates: [], reportable: false });
    expect(isPutBackMark(mark)).toBe(true);
    expect(isPutBackMark(c2)).toBe(false);
  });

  it("is in no text an auto reply reads: the phase prompts and the digest hold no step", () => {
    const texts = [fixPrompt("rings"), REPORT_PROMPT, digest({ plan: [], fixesPerStage: 2, limit: null, decisions: [], proposals: [] })];
    for (const t of texts) expect(t).not.toMatch(/put.back|outputs_put_back/i);
  });

  it("is none of the app's own calls: the activity log and the transcript, which list those, show no row for it", () => {
    expect(isAppStep(mark)).toBe(false);
    const { blocks, where } = autoTranscript({ id: "A1", steps: restored, turns: [], turnAt: [] }, []);
    expect(blocks.flatMap((b) => b.steps.map((s) => s.name))).not.toContain(OUTPUTS_PUT_BACK);
    expect(where.has(mark.id)).toBe(false);
  });
});
