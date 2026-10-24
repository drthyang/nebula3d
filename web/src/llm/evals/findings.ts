// What a validation run found, in one schema, and a run's transcript readable
// offline (docs/evals.md, "Does the Pilot help?").
//
// A finding is something in a run that the tools, the skills or the loop should
// have done differently. `candidateFindings` lists what a run's scores and
// transcript point at, each with its evidence, for a reviewer to confirm or
// drop; nothing here is a verdict.
//
// One record holds two sources of finding. A "validation" finding comes from a
// run: it names the case, the run and the step. A "review" finding comes from
// reading the code: it names no case and no run, and its evidence cites
// file:line on the commit `at` names. Only validation findings enter per-case
// logic (the transcript, a case's checks).

import { seen, type Readable } from "../readings";
import { SAMPLE_FACT_REFUSED } from "../tune/catalog";
import { offerChanges } from "./offers";
import {
  findIn,
  numbersIn,
  stepOf,
  wasRefused,
  type Decision,
  type RecordedRunPolicy,
  type RunRecord,
  type Truncations,
  type ValidationCase,
} from "./validation";

export const FINDING_KINDS = ["bug", "missing-tool", "skill-gap", "orchestration", "science-error"] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

export const FINDING_SOURCES = ["validation", "review"] as const;
export type FindingSource = (typeof FINDING_SOURCES)[number];

/** What every finding holds, whatever its source. */
interface FindingCommon {
  kind: FindingKind;
  evidence: string;
  proposed_fix: string;
  needs_user_approval: boolean;
  // What became of it: implemented by `commit`, with the regression `tests`
  // that pin it, or deferred; `note` says what is provisional or left open.
  status?: FindingStatus;
  commit?: string;
  tests?: string[];
  note?: string;
  // Where the fix offered options, the one chosen, by whom and when.
  decision?: { by: string; on: string; option: string };
}

/** A finding from a validation run. Without `source` a finding reads as one, so records made before the field stay valid. */
export interface ValidationFinding extends FindingCommon {
  source?: "validation";
  case: string;
  run: number;
  step: number | null; // 1-based, as the transcript numbers its steps; null: the run as a whole
  arm?: string; // which arm's run it came from
}

/** A finding from a review of the code: no case, run or step; its evidence cites file:line on the commit `at`. */
export interface ReviewFinding extends FindingCommon {
  source: "review";
  at: string; // the commit (SHA) the evidence's file:line citations read on
  ref?: string; // the review's own handle for it ("D1"), for the change that implements it to find it
}

export type Finding = ValidationFinding | ReviewFinding;

export const sourceOf = (f: Finding): FindingSource => f.source ?? "validation";
// A source neither of these (a record findingProblems would refuse) is neither: it enters no per-case logic.
export const isValidationFinding = (f: Finding): f is ValidationFinding => sourceOf(f) === "validation";
export const isReviewFinding = (f: Finding): f is ReviewFinding => f.source === "review";

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

const SHA = /^[0-9a-f]{7,40}$/;
// A file:line citation: "web/src/llm/verdict.ts:99", "report.ts:333-336".
const CITES_FILE_LINE = /[\w.-]+\.[A-Za-z]+:\d+/;
const REF = /^[A-Za-z][\w.-]{0,15}$/;
const COMMON_FIELDS = ["source", "kind", "evidence", "proposed_fix", "needs_user_approval", "status", "commit", "tests", "note", "decision"];
// The fields each source alone has: on the other source they are an error.
const SOURCE_FIELDS: Readonly<Record<FindingSource, readonly string[]>> = {
  validation: ["case", "run", "step", "arm"],
  review: ["at", "ref"],
};

/** What is wrong with *x* as a finding: empty when it is one. Each source has its own shape; a finding without `source` is a validation one. */
export function findingProblems(x: unknown): string[] {
  if (!x || typeof x !== "object" || Array.isArray(x)) return ["a finding is an object"];
  const f = x as Record<string, unknown>;
  const out: string[] = [];
  const named = f.source === undefined ? "validation" : f.source;
  const source = (FINDING_SOURCES as readonly unknown[]).includes(named) ? (named as FindingSource) : null;
  if (!source) out.push(`source must be one of ${FINDING_SOURCES.join(", ")}`);
  for (const k of [...(source === "validation" ? ["case"] : []), "evidence", "proposed_fix"]) {
    if (typeof f[k] !== "string" || !(f[k] as string).trim()) out.push(`${k} must be a non-empty string`);
  }
  if (source === "validation") {
    if (!Number.isInteger(f.run) || (f.run as number) < 1) out.push("run must be a whole number from 1");
    if (f.step !== null && (!Number.isInteger(f.step) || (f.step as number) < 1)) out.push("step must be null or a whole number from 1");
  }
  if (source === "review") {
    if (typeof f.at !== "string" || !SHA.test(f.at)) out.push("at must name the commit the evidence reads (7 to 40 hex digits)");
    if (typeof f.evidence === "string" && f.evidence.trim() && !CITES_FILE_LINE.test(f.evidence)) out.push("a review finding's evidence cites file:line");
    if (f.ref !== undefined && (typeof f.ref !== "string" || !REF.test(f.ref))) out.push("ref must be a short handle, as D1");
  }
  if (source) {
    const other = source === "validation" ? "review" : "validation";
    for (const k of SOURCE_FIELDS[other]) if (f[k] !== undefined) out.push(`a ${source} finding has no ${k}`);
  }
  if (!(FINDING_KINDS as readonly unknown[]).includes(f.kind)) out.push(`kind must be one of ${FINDING_KINDS.join(", ")}`);
  if (typeof f.needs_user_approval !== "boolean") out.push("needs_user_approval must be true or false");
  if (f.status !== undefined && !(FINDING_STATUSES as readonly unknown[]).includes(f.status)) {
    out.push(`status must be one of ${FINDING_STATUSES.join(", ")}`);
  }
  if (f.status === "implemented") {
    if (typeof f.commit !== "string" || !SHA.test(f.commit)) out.push("an implemented finding names its commit");
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
  // A field of the other source is named above; any other field is unknown.
  const known = new Set([...COMMON_FIELDS, ...SOURCE_FIELDS.validation, ...SOURCE_FIELDS.review]);
  for (const k of Object.keys(f)) if (!known.has(k)) out.push(`unknown field ${k}`);
  return out;
}

type Draft<F extends Finding> = Omit<F, "needs_user_approval"> & { needs_user_approval?: boolean };

/** A finding that needs the user as its kind says, unless told otherwise, with its source written out (validation, unless named); throws if it is not one. */
export function finding(f: Draft<ValidationFinding>): ValidationFinding;
export function finding(f: Draft<ReviewFinding>): ReviewFinding;
export function finding(f: Draft<ValidationFinding> | Draft<ReviewFinding>): Finding {
  const { source, ...rest } = f;
  const out = { source: source ?? "validation", ...rest, needs_user_approval: f.needs_user_approval ?? APPROVAL_BY_DEFAULT[f.kind] } as Finding;
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

/** A decision as the model read it: its readings without the whole result (readings/). */
const asRead = (d: Decision): Readable => ({ status: d.status, result: seen(stepOf(d)) });

/**
 * The first step whose result holds *value* within *tol*, in one reading of
 * each step (*reading*): what the model read (asRead), or what the tool found
 * (stepOf, the whole result).
 */
function surfaced(rec: RunRecord, value: number, tol: number, reading: (d: Decision) => Readable): { step: number; tool: string } | null {
  for (const d of rec.decisions) {
    const step = reading(d);
    if (step.status === "done" && seen(step) && findIn(numbersIn(step), value, tol, "")) return { step: d.step, tool: d.tool };
  }
  return null;
}

const clip = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** A call a guardrail refused, which is no tool failing: until its stage's skill is read, or a fact about the sample the user did not name. */
const refusedByAGuardrail = (summary: string): boolean => /refused until its skill is read/.test(summary) || summary.includes(SAMPLE_FACT_REFUSED);

// What a failed scoring criterion most likely means, for the reviewer to confirm.
const CRITERION: Record<string, [FindingKind, string]> = {
  features: ["science-error", "the settings the run chose or left lost or moved a planted correlation: find the stage and the setting"],
  diffuse_kept: ["science-error", "the reduction removed the crystal's own diffuse scattering: find the stage, and which criterion allowed it"],
  rings_removed: ["skill-gap", "the rings stayed: does the skill's step find and remove them, and does a tool say so"],
  pedestal: ["skill-gap", "a |Q|-dependent pedestal stayed: does the skill say when to turn on the flatten's Q² term"],
  window: ["bug", "the ΔPDF window reached unmeasured space: the guardrails should keep it under 1e-3"],
  outputs: ["orchestration", "no ΔPDF was made: the run never completed the pipeline"],
};

/** What a run's scores and transcript point at, for a reviewer to confirm: validation findings, on this run's case. */
export function candidateFindings(rec: RunRecord, c: ValidationCase): ValidationFinding[] {
  const out: ValidationFinding[] = [];
  const add = (f: Omit<ValidationFinding, "source" | "needs_user_approval" | "case" | "run" | "arm">) =>
    out.push(finding({ source: "validation", case: rec.case, run: rec.run, arm: rec.arm, ...f }));

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
    if (d.status === "error" && !refusedByAGuardrail(d.summary)) {
      add({ step: d.step, kind: "bug", evidence: `${d.tool}(${clip(JSON.stringify(d.args), 120)}) failed: ${clip(d.result)}`, proposed_fix: "decide whether the model called it wrongly (a clearer description or error) or the tool is wrong (fix it, with a test)" });
    }
  }
  for (const u of rec.grades.unsafe) {
    const step = Number(/^step (\d+)/.exec(u)?.[1]) || null;
    if (wasRefused(u)) {
      // The guardrails held: what to look at is why the model tried.
      add({ step, kind: "orchestration", evidence: `the model tried an unsafe action, which the guardrails refused: ${u}`, proposed_fix: "nothing changed: read why the model tried (its words before the step), and whether the tool's description should say it plainer" });
    } else {
      add({ step, kind: "bug", evidence: `an unsafe action got through the guardrails: ${u}`, proposed_fix: "close the path in the tool or the executor, with a test" });
    }
  }
  // The graders' two readings disagree: one of them misread the conclusion. A
  // dev run's only: a held-out run's are counted and reported, and nothing is
  // learned from them.
  if (rec.split === "dev") {
    for (const d of rec.grades.disputes ?? []) {
      add({
        step: null,
        kind: "bug",
        evidence: `the graders' two readings of the conclusion disagree on "${d.check}": the shared reader passed it (${clip(d.reader, 160)}), the witness failed it (${clip(d.witness, 160)})`,
        proposed_fix:
          "read the conclusion and find which reader misread it, the shared reader (web/src/llm/answerText/, evals/graderReading.ts) or the witness (evals/witness.ts); fix that one with a test, then grade the record again (NEBULA_VALIDATION_REGRADE)",
      });
    }
  }
  const unsourced = rec.numbers.filter((n) => n.source === null);
  if (unsourced.length) {
    add({ step: null, kind: "orchestration", evidence: `${unsourced.length} number(s) in the conclusion come from no tool result: ${unsourced.slice(0, 5).map((n) => n.text).join(", ")}`, proposed_fix: "the answer checks should have sent it back: find why they did not" });
  }
  if (rec.grades.detected === false) {
    // Where the case's numbers show: in the text the model read, else only in
    // the whole result a tool found (a field the model's copy left out).
    const truths = truthNumbers(c);
    const read = truths.map(([, v, tol]) => surfaced(rec, v, tol, asRead));
    const foundOnly = truths.flatMap(([what, v, tol]) => {
      const hit = surfaced(rec, v, tol, stepOf);
      return hit ? [{ what, ...hit }] : [];
    });
    if (truths.length && read.every((h) => h === null) && foundOnly.length) {
      const first = foundOnly[0];
      add({
        step: first.step,
        kind: "bug",
        evidence: `the conclusion missed the fault: ${first.tool} (step ${first.step}) found ${foundOnly.map((x) => x.what).join(", ")}, but the text the model read left ${foundOnly.length > 1 ? "them" : "it"} out`,
        proposed_fix: "keep that field in the text the model reads: a long result is fitted to the limit by dropping its bulkiest parts (readings/fit.ts), and the field the fault shows in must stay",
      });
    } else if (truths.length && read.every((h) => h === null)) {
      add({ step: null, kind: "missing-tool", evidence: `the conclusion missed the fault, and no tool result in the run holds ${truths.map(([what]) => what).join(", ")}`, proposed_fix: "a tool that measures it, the argument the model needed to ask for it, or a skill step that asks" });
    } else {
      const first = read.find((h) => h !== null) ?? null;
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

const thousands = (x: number): string => x.toLocaleString("en-US");

const TRANSPORT_NAMES: Record<RecordedRunPolicy["transport"], string> = {
  anthropic: "Claude through Anthropic's SDK",
  "openai-compatible": "an OpenAI-compatible server",
  ollama: "Ollama's own chat API",
};

/** The run policy a run ran under (runPolicy.ts), in one short paragraph. */
export function policyBlock(p: RecordedRunPolicy): string {
  const cap = (x: number | null) => (x == null ? "none asked" : `${thousands(x)} tokens`);
  const window =
    p.window.plan === "sized"
      ? `sized for each request with ${thousands(p.window.reply_reserve ?? 0)} tokens for the reply`
      : p.window.plan === "loaded"
        ? `as the server loaded it, a request refused with under ${thousands(p.window.min_reply ?? 0)} tokens left for the reply`
        : "not checked";
  return (
    `Run policy: ${TRANSPORT_NAMES[p.transport]}${p.local ? " on this machine" : ""}; up to ${p.max_rounds} rounds of tool calls; ` +
    `${p.tool_scoping === "question" ? "offered the tools its question needs" : "offered every tool"}; ` +
    `${p.pruning ? `older results shortened past ${thousands(p.pruning.soft_budget)} tokens, the newest ${p.pruning.keep_full} whole` : "no result shortened"}; ` +
    `temperature ${p.temperature ?? "none sent"}; output cap ${cap(p.output_cap.loop)}, the tuning's ${cap(p.output_cap.tuning)}; ` +
    `thinking ${p.reasoning_replay ? "sent back with each turn that called tools" : "not sent back"}; window ${window}.`
  );
}

/** The requests cut at the output limit, in words; null when none was. */
export function truncatedLine(t: Truncations): string | null {
  if (!t.requests.length) return null;
  const which = (source: "loop" | "tuning") => {
    const cut = t.requests.filter((r) => r.source === source);
    const whose = source === "loop" ? "the loop's" : "the tuning's";
    return cut.length ? `${whose} request${cut.length === 1 ? "" : "s"} ${cut.map((r) => `${r.request} (${r.reason})`).join(", ")}` : null;
  };
  return `${[which("loop"), which("tuning")].filter(Boolean).join("; ")}`;
}

/** A run as Markdown: the task, each step with its arguments, reason and result, the numbers and their sources, the conclusion and the scores. A review finding is on no run, so it is never listed. */
export function renderTranscript(rec: RunRecord, given: readonly Finding[] = []): string {
  const findings = given.filter(isValidationFinding);
  const g = rec.grades;
  const lines: string[] = [
    `# ${rec.case}, arm ${rec.arm}, run ${rec.run}`,
    "",
    `Model: ${rec.model.label} (${rec.model.provider}${rec.model.local ? ", local" : ""}). Started ${rec.started}; ${(rec.latency_ms / 1000).toFixed(0)} s` +
      (rec.usage ? `, ${rec.usage.input} tokens in and ${rec.usage.output} out over ${rec.usage.requests} requests` : "") +
      (rec.usage?.tuning ? ` (the tuning's ${rec.usage.tuning.requests}: ${rec.usage.tuning.input} in, ${rec.usage.tuning.output} out)` : "") +
      (rec.cost_usd != null ? `, $${rec.cost_usd.toFixed(4)}` : "") +
      `. The model saw the dataset as ${rec.dataset}.`,
    "",
    // Read as not recorded from a record made before the policy was kept.
    rec.run_policy ? policyBlock(rec.run_policy) : "Run policy: not recorded.",
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
  // A reply cut at the output cap is graded as it stands, and said so.
  const cut = rec.truncated ? truncatedLine(rec.truncated) : null;
  if (cut) lines.push(`**Cut at the output limit:** ${cut}. The run is graded as it stands.`, "");
  if (rec.computed_verdict) lines.push(`**Verdict computed from the checks:** ${rec.computed_verdict.text}.`, "");
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
  // Read as none from a record made before the graders cross-checked their readings.
  const disputes = g.disputes ?? [];
  lines.push(`- Checks the graders' two readings dispute: ${disputes.length}`);
  // Not recorded in a record made before the runs kept them.
  lines.push(
    `- Requests cut at the output limit: ${rec.truncated ? `${rec.truncated.requests.length}${cut ? ` (${cut})` : ""}` : "not recorded"}`,
  );
  for (const x of [...g.detection, ...g.falseAlarms].filter((y) => !y.pass)) lines.push(`- Failed: ${x.check}: ${x.detail}`);
  for (const d of disputes) lines.push(`- Disputed: ${d.check}: the shared reader passed it (${d.reader}); the witness failed it (${d.witness})`);
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
