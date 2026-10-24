// The tools a local model is offered for a question. Every request carries the
// definitions of the tools it offers, and all 26 come to about 7k tokens, more
// than half of the first request: a local model reads them on every request,
// and the more it is offered, the more it picks the wrong one. So it gets the
// reading tools every question needs, and the ones the question is about: each
// tool declares the questions it is for (its facts' `offeredFor`, in the
// registry), and one that declares none is offered for every question. An
// action only the user asks for (its facts' `askedFor`: the regrid) is offered
// only for a message that asks for it. A tool it calls by name all the same
// still runs (agent.ts), and stays offered.

import { factsOf, toolsWhere, type AgentTool } from "./tools";
import type { AskedAbout } from "./tools/facts";

// What a question is about, from its words.
const ABOUT: [Exclude<AskedAbout, "general">, RegExp][] = [
  ["rings", /\brings?\b|powder|alumin|\bAl\b/i],
  ["punch", /punch|bragg|peaks?\b|reflections?|satellites?|\bnodes?\b|off.?lattice/i],
  ["backfill", /backfill|\bfill|seams?\b|\bholes?\b/i],
  ["flatten", /flatten|background|floors?\b|incoherent|b·q|q²|magnetic|form factor/i],
  ["pdf", /Δ\s?pdf|delta.?pdf|\bpdf\b|real.?space|window|apodi|\bband\b|q.?max|fft|transform|consistency|features?\b|correlations?\b/i],
  ["lattice", /\bub\b|orient|lattice|\bcell\b|grains?\b|twin|tilt/i],
  ["symmetry", /symmetr|6\/mmm|\bmmm\b|equivalen|hexagonal|six.?fold/i],
  ["coverage", /coverage|measured|counts? (end|stop)|\|q\|/i],
  ["compare", /compar|temperature|other datasets?|between datasets/i],
];

/** What a question is about; a question about nothing in particular is "general", and gets the common diagnostics. */
const askedAbout = (question: string): AskedAbout[] => {
  const about = ABOUT.filter(([, re]) => re.test(question)).map(([a]) => a);
  return about.length ? about : ["general"];
};

// The tools that act on the pipeline (their facts' `actsOnPipeline`): offered
// when the message asks for an action (a sentence that starts with one, or
// "please", "can you" … before it), not when it asks whether to ("Should I
// switch …?" wants advice, and the advice not to act).
const ASKS_TO_ACT =
  /(^|[.!?\n]\s*|\b(please|can you|could you|would you|go ahead and|then)\s+)(raise|lower|increase|decrease|set|change|use|switch|turn|enable|disable|apply|run|rerun|re-run|tune|try|update|make|redo)\b/i;

/** Offered for every question: reading the dataset, the stages' verdicts, any cut, the log, the run's verdict, the viewer. */
export const CORE_TOOLS = toolsWhere((f) => f.offeredFor === "always" && !f.actsOnPipeline && !f.askedFor);

/** The tools to offer a local model for `question`, in their usual order. */
export function toolsFor(question: string, tools: readonly AgentTool[]): AgentTool[] {
  const asked = askedAbout(question);
  const acting = ASKS_TO_ACT.test(question.trim());
  return tools.filter((t) => {
    const f = factsOf(t.name);
    // An action only the user asks for (the regrid): offered when the message
    // asks for it by name, the only message it would run for.
    if (f.askedFor) return f.askedFor(question);
    if (f.actsOnPipeline) return acting;
    return f.offeredFor === "always" || f.offeredFor.some((a) => asked.includes(a));
  });
}

/** The text of the conversation's last user message: the question the reply answers. */
export const lastQuestion = (messages: { role: string; content: unknown }[]): string => {
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last) return "";
  if (typeof last.content === "string") return last.content;
  return Array.isArray(last.content)
    ? last.content.flatMap((p: { type?: string; text?: string }) => (p.type === "text" ? [p.text ?? ""] : [])).join("\n")
    : "";
};
