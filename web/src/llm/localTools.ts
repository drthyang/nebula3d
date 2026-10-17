// The tools a local model is offered for a question. Every request carries the
// definitions of the tools it offers, and all 24 come to about 5k tokens, more
// than half of the first request: a local model reads them on every request,
// and the more it is offered, the more it picks the wrong one. So it gets the
// reading tools every question needs, and the ones the question is about. A
// tool it calls by name all the same still runs (agent.ts), and stays offered.

import type { AgentTool } from "./tools";

/** Offered for every question: reading the dataset, the stages' verdicts, any cut, the log, the viewer. */
export const CORE_TOOLS = [
  "read_skill",
  "describe_dataset",
  "current_view",
  "configure_settings",
  "assess_stage",
  "measure_reciprocal_cut",
  "line_profile",
  "run_log",
  "show_in_viewer",
];

// What a question is about, and the tools for it.
const TOPICS: { about: RegExp; tools: string[] }[] = [
  { about: /\brings?\b|powder|alumin|\bAl\b/i, tools: ["radial_profile", "texture_check"] },
  { about: /punch|bragg|peaks?\b|reflections?|satellites?|\bnodes?\b|off.?lattice/i, tools: ["bragg_peaks", "grain_check", "ub_check"] },
  { about: /backfill|\bfill|seams?\b|\bholes?\b/i, tools: ["texture_check", "radial_profile"] },
  { about: /flatten|background|floors?\b|incoherent|b·q|q²|magnetic|form factor/i, tools: ["radial_profile"] },
  {
    about: /Δ\s?pdf|delta.?pdf|\bpdf\b|real.?space|window|apodi|\bband\b|q.?max|fft|transform|consistency|features?\b|correlations?\b/i,
    tools: ["measure_dpdf_cut", "dpdf_peaks", "dpdf_contrast", "qmax_coverage", "symmetry_check", "consistency_details"],
  },
  { about: /\bub\b|orient|lattice|\bcell\b|grains?\b|twin|tilt/i, tools: ["ub_check", "grain_check", "bragg_peaks"] },
  { about: /symmetr|6\/mmm|\bmmm\b|equivalen|hexagonal|six.?fold/i, tools: ["symmetry_check"] },
  { about: /coverage|measured|counts? (end|stop)|\|q\|/i, tools: ["qmax_coverage"] },
  { about: /compar|temperature|other datasets?|between datasets/i, tools: ["compare_datasets"] },
];

// A question that asks for nothing in particular gets the common diagnostics.
const DEFAULT_TOOLS = ["radial_profile", "qmax_coverage", "symmetry_check", "bragg_peaks"];

// The tools that act: offered when the message asks for an action (a sentence
// that starts with one, or "please", "can you" … before it), not when it asks
// whether to ("Should I switch …?" wants advice, and the advice not to act).
const ACT_TOOLS = ["update_settings", "run_pipeline", "tune_pipeline"];
const ASKS_TO_ACT =
  /(^|[.!?\n]\s*|\b(please|can you|could you|would you|go ahead and|then)\s+)(raise|lower|increase|decrease|set|change|use|switch|turn|enable|disable|apply|run|rerun|re-run|tune|try|update|make|redo)\b/i;

// The tools these rules choose among; any other is always offered.
const CHOSEN = new Set([...TOPICS.flatMap((t) => t.tools), ...DEFAULT_TOOLS, ...ACT_TOOLS]);

/** The tools to offer a local model for `question`, in their usual order. */
export function toolsFor(question: string, tools: AgentTool[]): AgentTool[] {
  const names = new Set(CORE_TOOLS);
  const topics = TOPICS.filter((t) => t.about.test(question));
  for (const name of (topics.length ? topics.flatMap((t) => t.tools) : DEFAULT_TOOLS)) names.add(name);
  if (ASKS_TO_ACT.test(question.trim())) ACT_TOOLS.forEach((name) => names.add(name));
  return tools.filter((t) => names.has(t.name) || !CHOSEN.has(t.name));
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
