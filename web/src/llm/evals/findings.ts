// What a validation run found, in one schema, and a run's transcript readable
// offline (docs/evals.md, "Does the Pilot help?").
//
// A finding is something in a run that the tools, the skills or the loop should
// have done differently. `candidateFindings` lists what a run's scores and
// transcript point at, each with its evidence, for a reviewer to confirm or
// drop; nothing here is a verdict.

import { offerChanges } from "./offers";
import { findIn, type RunRecord, type ValidationCase } from "./validation";

export const FINDING_KINDS = ["bug", "missing-tool", "skill-gap", "orchestration", "science-error"] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export interface Finding {
  case: string;
  run: number;
  step: number | null; // 1-based, as the transcript numbers its steps; null: the run as a whole
  kind: FindingKind;
  evidence: string;
  proposed_fix: string;
  needs_user_approval: boolean;
  arm?: string; // which arm's run it came from
  // What became of it: implemented by `commit`, with the regression `tests`
  // that pin it, or deferred; `note` says what is provisional or left open.
  status?: FindingStatus;
  commit?: string;
  tests?: string[];
  note?: string;
  // Where the fix offered options, the one chosen, by whom and when.
  decision?: { by: string; on: string; option: string };
}

export const FINDING_STATUSES = ["open", "implemented", "deferred"] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

/**
 * Which kinds of change wait for the user. The skills are the user's methods
 * and a physical criterion is their call, so a skill's content and anything a
 * science error would change wait for them. A bug in the code, a missing tool
 * and the loop's own behaviour do not, unless the fix moves a criterion; the
 * finding then sets the flag itself.
 */
export const APPROVAL_BY_DEFAULT: Readonly<Record<FindingKind, boolean>> = {
  bug: false,
  "missing-tool": false,
  "skill-gap": true,
  orchestration: false,
  "science-error": true,
};

/** What is wrong with *x* as a finding: empty when it is one. */
export function findingProblems(x: unknown): string[] {
  if (!x || typeof x !== "object" || Array.isArray(x)) return ["a finding is an object"];
  const f = x as Record<string, unknown>;
  const out: string[] = [];
  for (const k of ["case", "evidence", "proposed_fix"]) {
    if (typeof f[k] !== "string" || !(f[k] as string).trim()) out.push(`${k} must be a non-empty string`);
  }
  if (!Number.isInteger(f.run) || (f.run as number) < 1) out.push("run must be a whole number from 1");
  if (f.step !== null && (!Number.isInteger(f.step) || (f.step as number) < 1)) out.push("step must be null or a whole number from 1");
  if (!(FINDING_KINDS as readonly unknown[]).includes(f.kind)) out.push(`kind must be one of ${FINDING_KINDS.join(", ")}`);
  if (typeof f.needs_user_approval !== "boolean") out.push("needs_user_approval must be true or false");
  if (f.status !== undefined && !(FINDING_STATUSES as readonly unknown[]).includes(f.status)) {
    out.push(`status must be one of ${FINDING_STATUSES.join(", ")}`);
  }
  if (f.status === "implemented") {
    if (typeof f.commit !== "string" || !/^[0-9a-f]{7,40}$/.test(f.commit)) out.push("an implemented finding names its commit");
    if (!Array.isArray(f.tests) || !f.tests.length || f.tests.some((t) => typeof t !== "string" || !t.trim())) {
      out.push("an implemented finding names its regression tests");
    }
  }
  if (f.note !== undefined && (typeof f.note !== "string" || !f.note.trim())) out.push("note must be a non-empty string");
  if (f.decision !== undefined) {
    const d = f.decision as Record<string, unknown> | null;
    const ok = d && typeof d === "object" && ["by", "on", "option"].every((k) => typeof d[k] === "string" && (d[k] as string).trim());
    if (!ok || !/^\d{4}-\d{2}-\d{2}$/.test(String(d!.on))) out.push("decision must give by, on (YYYY-MM-DD) and option");
  }
  const known = new Set(["case", "run", "step", "kind", "evidence", "proposed_fix", "needs_user_approval", "arm", "status", "commit", "tests", "note", "decision"]);
  for (const k of Object.keys(f)) if (!known.has(k)) out.push(`unknown field ${k}`);
  return out;
}

/** A finding that needs the user as its kind says, unless told otherwise; throws if it is not one. */
export function finding(f: Omit<Finding, "needs_user_approval"> & { needs_user_approval?: boolean }): Finding {
  const out: Finding = { ...f, needs_user_approval: f.needs_user_approval ?? APPROVAL_BY_DEFAULT[f.kind] };
  const bad = findingProblems(out);
  if (bad.length) throw new Error(`not a finding: ${bad.join("; ")}`);
  return out;
}

// The numbers a case puts in that a tool must show for a model to report them:
// [what, value, tolerance as the answer's own check uses it].
function truthNumbers(c: ValidationCase): [string, number, number][] {
  const t = c.truth;
  const out: [string, number, number][] = [];
  if (t.angle_deg != null) out.push(["the UB's turn (°)", t.angle_deg, 0.15]);
  if (t.q_cut != null) out.push(["where the counts end (Å⁻¹)", t.q_cut, 0.2]);
  for (const q of t.ring_q ?? []) out.push([`the ring at ${q} Å⁻¹`, q, 0.1]);
  return out;
}

const parse = (result: string): unknown => {
  try {
    return JSON.parse(result);
  } catch {
    return result;
  }
};

/** The first step whose result holds *value* within *tol*: did the run's tools show it at all. */
function surfaced(rec: RunRecord, value: number, tol: number): { step: number; tool: string } | null {
  for (const d of rec.decisions) {
    if (d.status === "done" && d.result && findIn(parse(d.result), value, tol, "")) return { step: d.step, tool: d.tool };
  }
  return null;
}

const clip = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n)}…` : s);

// What a failed scoring criterion most likely means, for the reviewer to confirm.
const CRITERION: Record<string, [FindingKind, string]> = {
  features: ["science-error", "the settings the run chose or left lost or moved a planted correlation: find the stage and the setting"],
  diffuse_kept: ["science-error", "the reduction removed the crystal's own diffuse scattering: find the stage, and which criterion allowed it"],
  rings_removed: ["skill-gap", "the rings stayed: does the skill's step find and remove them, and does a tool say so"],
  pedestal: ["skill-gap", "a |Q|-dependent pedestal stayed: does the skill say when to turn on the flatten's Q² term"],
  window: ["bug", "the ΔPDF window reached unmeasured space: the guardrails should keep it under 1e-3"],
  outputs: ["orchestration", "no ΔPDF was made: the run never completed the pipeline"],
};

/** What a run's scores and transcript point at, for a reviewer to confirm. */
export function candidateFindings(rec: RunRecord, c: ValidationCase): Finding[] {
  const out: Finding[] = [];
  const add = (f: Omit<Finding, "needs_user_approval" | "case" | "run" | "arm">) =>
    out.push(finding({ case: rec.case, run: rec.run, arm: rec.arm, ...f }));

  if (rec.error) {
    add({ step: null, kind: "orchestration", evidence: `the run ended in an error: ${clip(rec.error)}`, proposed_fix: "find why it could not finish (the model server, the time limit, a tool that hung) before reading its score" });
  }
  if (rec.failure) {
    add({ step: null, kind: "orchestration", evidence: `the model server failed the reply (${rec.failure.kind}, ${rec.failure.attempts} request(s)): ${clip(rec.failure.message)}`, proposed_fix: "an infrastructure failure, not a wrong answer: check the machine and the server, then run it again before reading its score" });
  }
  if (rec.note && /Stopped after|cut off|repeated calls that brought nothing new/.test(rec.note)) {
    add({ step: null, kind: "orchestration", evidence: clip(rec.note), proposed_fix: "the task needs more rounds, or a tool returns too much for the context: shorten its result, or raise the limit for this task and say so" });
  }
  for (const d of rec.decisions) {
    if (d.status === "error" && !/refused until its skill is read/.test(d.summary)) {
      add({ step: d.step, kind: "bug", evidence: `${d.tool}(${clip(JSON.stringify(d.args), 120)}) failed: ${clip(d.result)}`, proposed_fix: "decide whether the model called it wrongly (a clearer description or error) or the tool is wrong (fix it, with a test)" });
    }
  }
  for (const u of rec.grades.unsafe) {
    add({ step: Number(/^step (\d+)/.exec(u)?.[1]) || null, kind: "bug", evidence: `an unsafe action got through the guardrails: ${u}`, proposed_fix: "close the path in the tool or the executor, with a test" });
  }
  const unsourced = rec.numbers.filter((n) => n.source === null);
  if (unsourced.length) {
    add({ step: null, kind: "orchestration", evidence: `${unsourced.length} number(s) in the conclusion come from no tool result: ${unsourced.slice(0, 5).map((n) => n.text).join(", ")}`, proposed_fix: "the answer checks should have sent it back: find why they did not" });
  }
  if (rec.grades.detected === false) {
    const truths = truthNumbers(c);
    const hits = truths.map(([, v, tol]) => surfaced(rec, v, tol));
    if (truths.length && hits.every((h) => h === null)) {
      add({ step: null, kind: "missing-tool", evidence: `the conclusion missed the fault, and no tool result in the run holds ${truths.map(([what]) => what).join(", ")}`, proposed_fix: "a tool that measures it, the argument the model needed to ask for it, or a skill step that asks" });
    } else {
      const first = hits.find((h) => h !== null) ?? null;
      add({ step: first?.step ?? null, kind: "orchestration", evidence: `the conclusion missed the fault${first ? ` though ${first.tool} (step ${first.step}) showed it` : ""}`, proposed_fix: "make the verdict explicit in the tool's result, or have the answer checks ask for it" });
    }
  }
  const criteria = (rec.truth_score as { criteria?: Record<string, boolean> } | undefined)?.criteria ?? {};
  for (const [name, ok] of Object.entries(criteria)) {
    if (ok) continue;
    const [kind, fix] = CRITERION[name] ?? ["orchestration", "see the score"];
    add({ step: null, kind, evidence: `the scored outputs fail ${name}`, proposed_fix: fix });
  }
  return out;
}

// ---------------------------------------------------------------- readable offline

const fence = (s: string): string => `\n\`\`\`\n${s.replace(/```/g, "'''")}\n\`\`\``;
const RESULT_CHARS = 1200;

/** A run as Markdown: the task, each step with its arguments, reason and result, the numbers and their sources, the conclusion and the scores. */
export function renderTranscript(rec: RunRecord, findings: readonly Finding[] = []): string {
  const g = rec.grades;
  const lines: string[] = [
    `# ${rec.case}, arm ${rec.arm}, run ${rec.run}`,
    "",
    `Model: ${rec.model.label} (${rec.model.provider}${rec.model.local ? ", local" : ""}). Started ${rec.started}; ${(rec.latency_ms / 1000).toFixed(0)} s` +
      (rec.usage ? `, ${rec.usage.input} tokens in and ${rec.usage.output} out over ${rec.usage.requests} requests` : "") +
      (rec.cost_usd != null ? `, $${rec.cost_usd.toFixed(4)}` : "") +
      `. The model saw the dataset as ${rec.dataset}.`,
    "",
    "## Task",
    "",
    rec.task,
    "",
    "## Tools offered",
    "",
    ...((rec.tool_offers ?? []).length
      ? [
          "As sent with each request (the Pilot offers a local model the tools its question needs, and more once it calls them):",
          "",
          ...offerChanges(rec.tool_offers ?? []).map(
            (c) => `- Request ${c.request}: ${c.count} tools${c.added.length ? `; added ${c.added.join(", ")}` : ""}${c.dropped.length ? `; dropped ${c.dropped.join(", ")}` : ""}`,
          ),
          "",
          `The first request's tools: ${rec.tool_offers[0].tools.join(", ") || "none"}.`,
        ]
      : ["Not recorded."]),
    "",
    "## Steps",
  ];
  for (const d of rec.decisions) {
    lines.push("", `### ${d.step}. ${d.tool} (${d.status})`, "", `Arguments: \`${JSON.stringify(d.args)}\``);
    if (d.why) lines.push("", "Why (the model's words before it):", fence(clip(d.why, 1500)));
    lines.push("", `Result: ${d.summary}`);
    if (d.result) {
      const long = d.result.length > RESULT_CHARS;
      lines.push(fence(long ? `${d.result.slice(0, RESULT_CHARS)}… [${d.result.length} characters; the record holds them all]` : d.result));
    }
  }
  lines.push("", "## Conclusion", "", rec.conclusion || "(none)", "");
  if (rec.note) lines.push(`Note: ${rec.note}`, "");
  if (rec.error) lines.push(`Error: ${rec.error}`, "");
  lines.push("## Numbers and their sources", "", "| Number | Source |", "| --- | --- |");
  for (const n of rec.numbers) {
    const s = n.source;
    lines.push(`| ${n.text} | ${s ? `step ${s.step}, ${s.tool}, ${s.path} = ${s.value}` : "no tool result holds it"} |`);
  }
  if (!rec.numbers.length) lines.push("| (none) | |");
  lines.push("", "## Score", "");
  lines.push(`- Fault reported: ${g.detected === null ? "no fault to report" : g.detected ? "yes" : "no"}`);
  lines.push(`- No false alarm: ${g.noFalseAlarm ? "yes" : "no"}`);
  lines.push(`- Unsafe actions: ${g.unsafe.length}${g.unsafe.length ? ` (${g.unsafe.join("; ")})` : ""}`);
  for (const x of [...g.detection, ...g.falseAlarms].filter((y) => !y.pass)) lines.push(`- Failed: ${x.check}: ${x.detail}`);
  const crit = (rec.truth_score as { criteria?: Record<string, boolean> } | undefined)?.criteria;
  lines.push(
    crit
      ? `- Outputs, against the planted truth: ${Object.entries(crit).map(([k, v]) => `${k} ${v ? "ok" : "FAILED"}`).join(", ")}`
      : "- Outputs: not scored yet (`python -m nebula3d.validation score`)",
  );
  if (findings.length) {
    lines.push("", "## Findings", "");
    for (const f of findings) {
      lines.push(`- **${f.kind}**${f.step ? `, step ${f.step}` : ""}${f.needs_user_approval ? " (needs the user)" : ""}: ${f.evidence}. Proposed: ${f.proposed_fix}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
