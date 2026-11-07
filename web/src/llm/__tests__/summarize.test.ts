// Summarize and continue (summarize.ts, THY-74): the app's own summary of the
// earlier turns, built without a model. What it lists, what it leaves out (no
// number the model or a tool wrote: THY-18), that it is shorter than the
// turns it replaces, and how the chat's next request carries it.

import { describe, expect, it } from "vitest";

import type { ChatTurn } from "../chatStore";
import { buildChatMessages } from "../prompts/templates";
import { baseTokens } from "../provider/tokens";
import { QUESTION_CHARS, SUMMARY_QUESTIONS, summarizeTurns, unsummarized, verdictWords } from "../summarize";
import { SUMMARY_TURNS, summaryDecided } from "./summarySamples";
import type { PipelineContext } from "../context/pipelineContext";

const decided = summaryDecided();
const summary = summarizeTurns(SUMMARY_TURNS, decided)!;

describe("the summary of a conversation", () => {
  it("covers every turn up to the last, and lists each question with its checks and the app's verdict then", () => {
    expect(summary.through).toBe(8);
    expect(summary.turns).toBe(8);
    const lines = summary.text.split("\n");
    expect(lines[0]).toMatch(/^Earlier in this conversation: 8 turns the app summarized/);
    expect(lines.slice(1)).toEqual([
      '- asked "How clean is the ring removal?"; checks run: read_skill ring-removal, assess_stage rings, radial_profile rings',
      "- asked \"Assess the whole run, and check the Bragg punch at L = 0.5 too.\"; checks run: assess_stage punch, measure_reciprocal_cut; the app's verdict then: not met, needs attention: the Bragg punch",
      '- asked "Raise the punch threshold and run from the punch."; no checks run; no answer',
      "- asked \"Is it met now?\"; checks run: assess_stage punch; the app's verdict then: met",
      decided,
    ]);
  });

  it("holds no number a tool measured or the model wrote: only the user's own words and settings carry digits", () => {
    const own = [...SUMMARY_TURNS.filter((t) => t.role === "user").map((t) => t.content), decided].join(" ");
    const digits = (s: string) => s.match(/\d+(?:\.\d+)?/g) ?? [];
    const ownDigits = new Set(digits(own));
    // Besides them, the header's count of the turns it covers, the app's own.
    const body = summary.text.replace(`${summary.turns} turns`, "");
    expect(digits(body).filter((d) => !ownDigits.has(d))).toEqual([]);
    // The answers' numbers, the step summaries' and a cut's value: none.
    for (const n of ["0.8", "-0.002", "7.2", "6.5", "36", "0.02"]) expect(summary.text).not.toContain(n);
    // The data's problems (which may quote a number) and the answers' words are left out.
    expect(summary.text).not.toContain("HKL origin");
    expect(summary.text).not.toContain("survived");
    expect(summary.text).not.toContain("{{achieved}}");
  });

  it("is shorter than the turns it replaces once the answers run to a paragraph", () => {
    // The sample's answers are a line each; an answer of a paragraph (600 characters) is short for the Pilot's.
    const paragraph = (t: ChatTurn) => (t.role === "assistant" && t.content ? `${t.content} ${"The evidence above supports it. ".repeat(18)}` : t.content);
    const asText = SUMMARY_TURNS.map((t) => ({ role: t.role, content: paragraph(t) }));
    // The turns as the chat sends them, against the summary alone (the decisions' line aside: no turn carries it).
    const without = summarizeTurns(SUMMARY_TURNS, null)!;
    expect(without.text.length).toBeLessThan(summary.text.length);
    expect(baseTokens([{ role: "user", content: without.text }])).toBeLessThan(baseTokens(asText) / 2);
  });

  it("the verdict as it states it: met, not met with what needs attention, or nothing when not judged", () => {
    expect(verdictWords(null)).toBeNull();
    expect(verdictWords(SUMMARY_TURNS[1].verdict)).toBeNull();
    expect(verdictWords(SUMMARY_TURNS[3].verdict)).toBe("not met, needs attention: the Bragg punch");
    expect(verdictWords(SUMMARY_TURNS[7].verdict)).toBe("met");
  });

  it("cuts a long question, and lists only the newest questions, counting the rest", () => {
    const long: ChatTurn[] = Array.from({ length: SUMMARY_QUESTIONS + 3 }, (_, i) => ({ id: i + 1, role: "user" as const, content: `Question ${i} ${"x".repeat(300)}` }));
    const s = summarizeTurns(long, null)!;
    const items = s.text.split("\n").slice(1);
    expect(items[0]).toBe("- (3 earlier questions not listed)");
    expect(items).toHaveLength(SUMMARY_QUESTIONS + 1);
    const quoted = /"([^"]*)"/.exec(items[1])![1];
    expect(quoted.length).toBe(QUESTION_CHARS);
    expect(quoted.endsWith("…")).toBe(true);
    expect(items[1]).toContain("no reply");
  });

  it("is bounded however long the conversation: the newest questions at their longest, every check listed, the decisions' line", () => {
    const stages = ["rings", "punch", "backfill", "flatten", "pdf"];
    const longest: ChatTurn[] = Array.from({ length: 40 }, (_, i): ChatTurn[] => [
      { id: 2 * i + 1, role: "user", content: "q".repeat(400) },
      {
        id: 2 * i + 2,
        role: "assistant",
        content: "a".repeat(4000),
        steps: Array.from({ length: 12 }, (_, j) => ({ id: `s${i}-${j}`, name: `measure_reciprocal_cut_${"x".repeat(j)}`, args: { stage: stages[j % 5] }, status: "done" as const })),
        verdict: { achieved: false, stages: {}, attention: stages.map((x) => `the ${x} stage output`), notMeasured: [], dataProblems: [], text: "" },
      },
    ]).flat();
    const s = summarizeTurns(longest, decided)!;
    expect(s.text.split("\n")).toHaveLength(1 + 1 + SUMMARY_QUESTIONS + 1);
    // 2,378 at the starting rates (2026-11-07): about what three short answers take.
    expect(baseTokens([{ role: "user", content: s.text }])).toBeLessThan(2_500);
  });

  it("nothing to summarize: null", () => {
    expect(summarizeTurns([], decided)).toBeNull();
  });
});

describe("the next request after a summary", () => {
  const context = { dataset: "synthetic_a" } as PipelineContext;
  const later: ChatTurn[] = [...SUMMARY_TURNS, { id: 9, role: "user", content: "And the backfill?" }, { id: 10, role: "assistant", content: "It is seamless." }];

  it("sends the turns after it as their text, and the summary at the end of the context", () => {
    const history = unsummarized(later, summary).map(({ role, content }) => ({ role, content }));
    expect(history).toEqual([
      { role: "user", content: "And the backfill?" },
      { role: "assistant", content: "It is seamless." },
    ]);
    const plain = buildChatMessages(context, history, "Next?", null, { tools: true });
    const withSummary = buildChatMessages(context, history, "Next?", null, { tools: true, earlier: summary.text, since: "- since the last reply, you ran the pipeline" });
    expect(withSummary[1].content).toBe(`${plain[1].content as string}\n${summary.text}\n- since the last reply, you ran the pipeline`);
    expect(withSummary.filter((_, i) => i !== 1)).toEqual(plain.filter((_, i) => i !== 1));
  });

  it("without a summary, every turn", () => {
    expect(unsummarized(later, null)).toEqual(later);
  });
});
