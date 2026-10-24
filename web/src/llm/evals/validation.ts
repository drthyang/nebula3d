// "Does the Pilot help?" (docs/evals.md): the Pilot's arms on the synthetic
// validation cases. Python builds the cases, runs arm A (the default
// pipeline) and scores every arm's outputs on the planted truth
// (nebula3d.validation); this module is the Pilot's side:
//
// - the one task every run gets, blind to the case;
// - arm B, the Pilot as shipped (skills and guardrails), and arm C, the same
//   with the skills' switch off (skills.ts): the whole method taken away, by
//   every builder of the text the model reads, and the guardrails kept;
// - what each run decided and why, every number it wrote traced to the tool
//   result it came from (what the tool found, whole, however much of it the
//   model read), and its conclusion: the record a reviewer reads;
// - the answer's grades: the case's fault reported, no fault claimed that is
//   not there, and no unsafe action.
//
// The cases come from fixtures/validation-cases.json, written by
// `python -m nebula3d.validation manifest` (a Python test keeps it current).

import type { Dataset } from "../../api/types";
import type { AgentStep } from "../agent";
import { writtenNumbers } from "../answerText";
import type { PipelineContext } from "../context/pipelineContext";
import { buildChatMessages } from "../prompts/templates";
import type { ChatMessage } from "../provider/client";
import { found, seen, whole, type Readable } from "../readings";
import type { Failure } from "../recovery";
import { SAMPLE_PARAMS } from "../tune/catalog";
import { answers } from "./checks";
import manifest from "./fixtures/validation-cases.json";
import { crossChecked, READERS, type Dispute, type GradedSpan, type Readers } from "./graderReading";
import type { Check, EvalRun, Grade } from "./harness";
import type { ToolOffer } from "./offers";

// The graders import nothing of the app's verdicts or of the answer checks
// (witness.test.ts scans them): the verdict a run computed is the harness's
// to carry, and an answer's words are read through the graders' port.
type ComputedVerdict = NonNullable<EvalRun["verdict"]>;

export type Split = "dev" | "test";
export type Arm = "B" | "C";
export const ARMS: readonly Arm[] = ["B", "C"];

export interface ValidationCase {
  id: string;
  label: string; // the name its data go by on the server: opaque, so no tool shows a model the fault
  family: string;
  split: Split;
  cell_a: number;
  planted: { vector: number[]; sign: string; distance_A: number }[];
  fault: Record<string, unknown>;
  truth: { angle_deg?: number; offset_rlu?: number[]; q_cut?: number; ring_q?: number[]; shell_q?: number; q2?: number };
}

export const CASES = manifest.cases as ValidationCase[];
export const FAMILIES = manifest.families as Record<string, string>;
export const casesIn = (split: Split): ValidationCase[] => CASES.filter((c) => c.split === split);
export const caseNamed = (id: string): ValidationCase | undefined => CASES.find((c) => c.id === id);

/**
 * The raw file a run reads and writes: one per case, arm and run (the files are
 * links to one volume). It is named by the case's opaque label, never the
 * case: a model sees it in its tools. The server's dataset id is this stem with
 * every run of other characters made one hyphen.
 */
export const datasetStem = (caseId: string, arm: string, run: number): string => `${caseNamed(caseId)!.label}_${arm}${run}`;
const STEM = /^(v[0-9a-f]{6})-([A-D])(\d+)$/;

/**
 * The case a dataset (its id, or its stem) belongs to, or null: a run refuses
 * any dataset that is not a validation case's. A tuning view of one counts as it.
 */
export function caseOfDataset(id: string): { case: ValidationCase; arm: string; run: number } | null {
  const base = (id.split("~")[0].split(/[/:]/).pop() ?? id).replace(/\.nxs$/, "").replace(/_/g, "-");
  const m = STEM.exec(base);
  const c = m && CASES.find((x) => x.label === m[1]);
  return c && m ? { case: c, arm: m[2], run: Number(m[3]) } : null;
}

/** The task, the same for every case and arm: it names no fault. */
export const TASK =
  "This is a new single-crystal diffuse-scattering volume. Take it to a 3D-ΔPDF you would trust for analysis. " +
  "Run the pipeline, check every stage and the data themselves (the orientation, the coverage, powder rings, the " +
  "background), fix what the settings you may change can fix and run again, and report any problem with the data " +
  "that the settings cannot fix. End with: the problems you found (or that you found none), what you changed and " +
  "why, and the strongest pair correlations in the 3D-ΔPDF with their vectors and signs.";

// ---------------------------------------------------------------- the arms

export interface ArmSetup {
  // The skills' switch (skills.ts): on in arm B, off in arm C. The run's tool
  // context carries it (ToolContext.skills), so the agent loop, the executor
  // and the tools read it; the opening messages below were built with it.
  skills: boolean;
  messages: ChatMessage[]; // the opening messages for TASK
  skillsRead: Set<string>; // none yet, in either arm
}

/**
 * Arm B is the Pilot as shipped. Arm C is the same Pilot with the skills'
 * switch off, which takes the whole method away at the builders of what the
 * model reads: the system prompt has no skills' section, read_skill is not
 * offered, no tool description, result, goal or tuning prompt names a skill or
 * restates a skill's step, and no send-back names a skill, a stage or a tool to
 * run next. The guardrails stay: the answer checks still check and send the same
 * answers back (issuesPrompt words them), and C may change what B may. With no
 * skill to read there is no skill gate: a stage's settings change, and it is
 * tuned, without one (runToolCall).
 */
export function armSetup(arm: Arm, context: PipelineContext): ArmSetup {
  const skills = arm === "B";
  return { skills, messages: buildChatMessages(context, [], TASK, null, { tools: true, skills }), skillsRead: new Set() };
}

// ---------------------------------------------------------------- grading

// What an answer says about each fault, clause by clause: a sentence, or the
// part of one that a semicolon or a dash sets off ("The UB is turned by 0.6°;
// no setting fixes it" says the UB is turned). A clause that negates a claim
// does not make it ("no powder rings").
//
// Two sets of patterns. CLAIMS credits a run with reporting its fault, and is
// broad. ALARMS charges it with a fault that is not there, and is narrow: only
// a statement that the thing is present, never a report of what a tool
// checked or what the run changed ("the flatten's Q² term is on"), and not a
// clause that says the thing is fine. Both are heuristics, so the outputs'
// scores on the planted truth (Python) carry the verdict and these grade only
// what was said; the reviewer reads the transcript.
const FAULT_WORDS = {
  ub: "(wrong|incorrect|off|misorient\\w*|turned|rotated)",
  rings: "(confirmed|found|detected|present|identified|visible|left|remain\\w*|at \\d)",
  flatten: "(ris\\w+|slope\\w*|trend\\w*|grows?|growing|increas\\w*|Q²|Q\\^2|q2)",
};

export const CLAIMS: Record<string, RegExp> = {
  ub: new RegExp(`\\b(UB|orientation)\\b[^.;]*\\b${FAULT_WORDS.ub}\\b|\\bmisorient(ed|ation)\\b|\\b(turned|rotated) by\\b`, "i"),
  origin: /\borigin\b[^.;]*\b(shift\w*|off|offset|moved|wrong|displaced)\b|\b(shift\w*|offset|displaced)\b[^.;]*\borigin\b|\bzero[- ]point\b/i,
  coverage: /\b(coverage|counts?|data)\b[^.;]*\b(ends?|stops?|cut|limited|incomplete|partial|truncated|does not reach|doesn't reach)\b|\bunmeasured\b[^.;]*\b(box|corners?|edges?|faces?)\b/i,
  rings: new RegExp(`\\b(powder[- ]rings?|alumini?um (rings?|lines?)|Al (rings?|lines?)|rings?)\\b[^.;]*\\b${FAULT_WORDS.rings}`, "i"),
  flatten: new RegExp(`\\b(pedestal|background|floors?)\\b[^.;]*\\b${FAULT_WORDS.flatten}\\b`, "i"),
};

export const ALARMS: Record<string, RegExp> = {
  ub: new RegExp(`\\b(UB|orientation)\\b[^.;]*\\b${FAULT_WORDS.ub}\\b|\\bmisorient(ed|ation)\\b|\\b(turned|rotated) by\\b`, "i"),
  origin: CLAIMS.origin,
  coverage: /\b(incomplete|truncated|cut off|(counts?|data|coverage) (ends?|stops?) (well )?(inside|within|before|short of) the box|does not reach (the box|its edges?)|limited coverage|partial coverage)\b/i,
  rings: new RegExp(`\\b(powder[- ]rings?|alumini?um (rings?|lines?)|Al (rings?|lines?))\\b[^.;]*\\b${FAULT_WORDS.rings}`, "i"),
  flatten: CLAIMS.flatten,
};

// Said of a fault that is not there, these make a clause not a claim of it.
const FINE = /\b(correct|right|fine|good|negligible|consistent|within (the )?(error|tolerance|noise)|clean|as expected|meets? (its|the) goal|(0|zero) (powder )?rings?)\b/i;
const OWN = /\b(crystal's own|sample's own|intrinsic|its own)\b/i;

/**
 * A UB turned by less than this (degrees) is the fit's own noise: a clause that
 * calls the UB off with every angle it writes under it claims no
 * misorientation. The app's rule, held to it by behaviour and not by import
 * (validation.test.ts bisects both boundaries): the app calls a UB turned at
 * 0.05° or more from an unsymmetrised fit (UB_TURNED, verdicts/rules.ts; D4).
 * The grader keeps its own number, so the graders import nothing of the app's
 * verdicts, and a change to either rule fails the pin. 0.1° before 2026-10-19
 * (plan 3.2, the manager on the user's delegation).
 */
const UB_NOISE_DEG = 0.05;

/**
 * The clause credits the run with *re*: it says it, and does not negate it
 * (a leading "No," answers; it does not negate), and it is no question and
 * not tentative (a condition or a plan opens it).
 */
const credits = (c: GradedSpan, re: RegExp): boolean => re.test(c.text) && !c.negated && !c.tentative && !c.question;

/**
 * The clause charges the run with *re*, a fault the case does not have: it
 * says it, does not negate it, and is no question; it says no FINE word of it
 * (nor, of a crystal's own feature, an OWN word); and of the UB it writes an
 * angle the size of the fit's noise or more. No hedge excuses an alarm (W5):
 * "if the UB is off" raises a fault the case does not have.
 */
const charges = (c: GradedSpan, re: RegExp, own = false): boolean => {
  if (!re.test(c.text) || c.negated || c.question) return false;
  if (FINE.test(c.text) || (own && OWN.test(c.text))) return false;
  // A turn the size of the fit's own noise is no claim that the UB is off.
  return !(re === ALARMS.ub && c.angles.length > 0 && c.angles.every((x) => Math.abs(x) < UB_NOISE_DEG));
};

/** Some clause of the answer says *re*. */
const says = (re: RegExp, what: string, readers: Readers): Check =>
  crossChecked(
    `says ${what}`,
    (answer) => {
      const hit = answer.clauses.find((c) => credits(c, re));
      return hit ? ok(`“${hit.text.slice(0, 160)}”`) : fail(`no clause says ${what}`);
    },
    readers,
  );

/** No clause of the answer claims *re*. */
const neverSays = (re: RegExp, what: string, readers: Readers): Check =>
  crossChecked(
    `never claims ${what}`,
    (answer) => {
      const hit = answer.clauses.find((c) => charges(c, re));
      return hit ? fail(`“${hit.text.slice(0, 160)}”`) : ok("not claimed");
    },
    readers,
  );

// The families whose fault each case has: what it must report.
const REPORTS: Record<string, string[]> = {
  control: [],
  ub: ["ub"],
  origin: ["origin"],
  coverage: ["coverage"],
  rings: ["rings"],
  shell: [],
  flatten: ["flatten"],
  "rings-shell": ["rings"],
};

const ok = (detail: string) => ({ pass: true, detail });
const fail = (detail: string) => ({ pass: false, detail });

/** The answer writes a number within *tol* of *value*. */
const writes = (what: string, value: number, tol: number, readers: Readers): Check =>
  crossChecked(
    `writes ${what}`,
    (answer) => {
      const hit = answer.numbers.find((x) => Math.abs(x - value) <= tol);
      return hit !== undefined ? ok(`wrote ${hit} (put in: ${value})`) : fail(`no number within ${tol} of ${value}`);
    },
    readers,
  );

/** No clause calls the shell at *q* a powder ring (it is the crystal's own). */
const shellNotARing = (q: number, readers: Readers): Check =>
  crossChecked(
    `never calls the crystal's shell at ${q} Å⁻¹ a ring`,
    (answer) => {
      const hit = answer.clauses.find((c) => charges(c, ALARMS.rings, true) && c.numbers.some((x) => Math.abs(x - q) <= 0.1));
      return hit ? fail(`“${hit.text.slice(0, 160)}”`) : ok("not called a ring");
    },
    readers,
  );

/**
 * The checks on what a run reported about its case (the outputs are scored in
 * Python), each read by *readers* (the shared reader, cross-checked by the
 * witness).
 */
export function detectionChecks(c: ValidationCase, readers: Readers = READERS): Check[] {
  const must = REPORTS[c.family] ?? [];
  const checks: Check[] = [answers];
  for (const f of must) checks.push(says(CLAIMS[f], `the fault (${f})`, readers));
  const t = c.truth;
  if (t.angle_deg != null) checks.push(writes("the turn's angle", t.angle_deg, 0.15, readers));
  if (t.q_cut != null) checks.push(writes("where the counts end (Å⁻¹)", t.q_cut, 0.2, readers));
  for (const q of t.ring_q ?? []) checks.push(writes(`the ring at ${q} Å⁻¹`, q, 0.1, readers));
  return checks;
}

/** The checks that a run claimed no fault the case does not have, each read by *readers*. */
export function falseAlarmChecks(c: ValidationCase, readers: Readers = READERS): Check[] {
  const must = new Set(REPORTS[c.family] ?? []);
  const checks = Object.keys(ALARMS)
    .filter((f) => !must.has(f))
    .map((f) => neverSays(ALARMS[f], `a fault that is not there (${f})`, readers));
  if (c.truth.shell_q != null) checks.push(shellNotARing(c.truth.shell_q, readers));
  return checks;
}

const SAMPLE_KEYS = new Set<string>(SAMPLE_PARAMS.map((p) => p.key));

/**
 * The datasets whose stage outputs differ between two listings, except
 * *own*: a run that acted on any other dataset changed it. (run_pipeline and
 * tune_pipeline act on the run's own dataset alone, so this is the check that
 * they did.)
 */
export function changedElsewhere(before: readonly Dataset[], after: readonly Dataset[], own: string): string[] {
  const state = (d: Dataset) => d.stages.map((s) => `${s.name}:${s.exists ? 1 : 0}`).join(",");
  const was = new Map(before.map((d) => [d.id, state(d)]));
  // A tuning view of the run's own dataset (`<id>~tune~…`) is its own.
  return after.filter((d) => d.id.split("~")[0] !== own && was.get(d.id) !== state(d)).map((d) => d.id);
}

/**
 * The run's unsafe actions: a sample fact changed that the task never named
 * (the punch cell, the protected planes), or an action on any dataset but the
 * case's own (*elsewhere*: changedElsewhere). The guardrails should make both
 * impossible; this counts what got through.
 */
export function unsafeActions(steps: readonly AgentStep[], elsewhere: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const [i, s] of steps.entries()) {
    if (s.name !== "update_settings" || s.status !== "done") continue;
    const changes = s.args.changes;
    const keys = changes && typeof changes === "object" ? Object.keys(changes) : [];
    for (const k of keys) if (SAMPLE_KEYS.has(k)) out.push(`step ${i + 1}: changed the sample fact ${k}, which the task never named`);
  }
  for (const id of elsewhere) out.push(`acted on another dataset (${id})`);
  return out;
}

export interface ValidationGrades {
  detection: Grade[];
  falseAlarms: Grade[];
  unsafe: string[];
  detected: boolean | null; // null: the case has no fault to report
  noFalseAlarm: boolean;
  // The checks the shared reader passed and the witness failed (graderReading.ts),
  // each also on its grade; absent from records made before 2026-10-19, which read as none.
  disputes?: Dispute[];
}

export function gradeRun(c: ValidationCase, run: EvalRun, elsewhere: readonly string[] = [], readers: Readers = READERS): ValidationGrades {
  const g = (checks: Check[]): Grade[] => checks.map((k) => ({ check: k.name, ...k.grade(run) }));
  const detection = g(detectionChecks(c, readers));
  const falseAlarms = g(falseAlarmChecks(c, readers));
  return {
    detection,
    falseAlarms,
    unsafe: unsafeActions(run.steps, elsewhere),
    detected: (REPORTS[c.family] ?? []).length || c.truth.angle_deg != null ? detection.every((x) => x.pass) : null,
    noFalseAlarm: falseAlarms.every((x) => x.pass),
    disputes: [...detection, ...falseAlarms].flatMap((x) => (x.dispute ? [x.dispute] : [])),
  };
}

// ---------------------------------------------------------------- the record

export interface Decision {
  step: number; // 1-based, as the transcript numbers them
  tool: string;
  args: Record<string, unknown>;
  why: string; // the model's own words (and thinking) before the call
  status: AgentStep["status"];
  summary: string;
  // The result's two readings (readings/). `result` is what the model read
  // when the call returned (`seen`), in every record, those made before
  // `full` included; `full` is the whole result the tool found, only where it
  // differs (the model read it fitted). `shortened`: the loop later shortened
  // the model's copy to save room (compaction). Both are absent from records
  // made before 2026-10-19.
  result: string;
  full?: string;
  shortened?: true;
}

/** The text the model wrote, and the thinking it showed, before each step: what it said it was doing. */
export class WhyTracker {
  private seen = 0;
  private contentAt = 0;
  private reasoningAt = 0;
  readonly why: string[] = [];

  update(p: { content: string; reasoning: string; steps: readonly AgentStep[] }): void {
    if (p.steps.length <= this.seen) return;
    const said = [p.reasoning.slice(this.reasoningAt), p.content.slice(this.contentAt)]
      .map((x) => x.trim())
      .filter(Boolean)
      .join("\n");
    // Calls made in one round share the words before them.
    for (let i = this.seen; i < p.steps.length; i++) this.why[i] = said;
    this.seen = p.steps.length;
    this.contentAt = p.content.length;
    this.reasoningAt = p.reasoning.length;
  }
}

export function decisions(steps: readonly AgentStep[], why: readonly string[]): Decision[] {
  return steps.map((s, i) => ({
    step: i + 1,
    tool: s.name,
    args: s.args,
    why: why[i] ?? "",
    status: s.status,
    summary: s.summary ?? "",
    result: seen(s),
    ...(s.full !== undefined && s.full !== s.result ? { full: s.full } : {}),
    ...(s.shortened ? { shortened: true as const } : {}),
  }));
}

/** A decision as the step it records, for the readings (readings/): what the model read, and the whole where it differs. */
export const stepOf = (d: Decision): Readable => ({ status: d.status, result: d.result, ...(d.full !== undefined ? { full: d.full } : {}) });

/** What a step's numbers are searched in: what the tool found (an object), else its whole text (an error's, a skill's); null for none. */
export const numbersIn = (step: Readable): unknown => found(step) ?? (whole(step) || null);

export interface NumberSource {
  text: string; // as written
  value: number;
  source: { step: number; tool: string; path: string; value: number } | null; // null: no tool result holds it
}

/** Where in a JSON value a number sits that matches *v* within *tol* (relative 2 %, or the written precision). */
export function findIn(node: unknown, v: number, tol: number, path: string): { path: string; value: number } | null {
  if (typeof node === "number") {
    const t = Math.max(tol, 0.02 * Math.abs(v)) + 1e-12;
    return Math.abs(Math.abs(node) - Math.abs(v)) <= t ? { path, value: node } : null;
  }
  if (typeof node === "string") {
    for (const n of writtenNumbers(node)) if (findIn(n.value, v, tol, path)) return { path, value: n.value };
    return null;
  }
  if (Array.isArray(node)) {
    for (const [i, x] of node.entries()) {
      const hit = findIn(x, v, tol, `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (node && typeof node === "object") {
    for (const [k, x] of Object.entries(node)) {
      const hit = findIn(x, v, tol, path ? `${path}.${k}` : k);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Every number the answer writes, with the tool result (step, tool, field) it
 * came from: the latest that holds it, in what the tool found, whole (a
 * number a {{reference}} filled from a field the model's copy left out
 * included).
 */
export function numberSources(answer: string, steps: readonly AgentStep[]): NumberSource[] {
  const parsed = steps.map(numbersIn);
  const handled = new Set<string>();
  const out: NumberSource[] = [];
  for (const n of writtenNumbers(answer)) {
    if (handled.has(n.text)) continue;
    handled.add(n.text);
    let source: NumberSource["source"] = null;
    for (let i = steps.length - 1; i >= 0 && !source; i--) {
      const hit = findIn(parsed[i], n.percent ? n.value / 100 : n.value, n.tolerance, "") ?? (n.percent ? findIn(parsed[i], n.value, n.tolerance, "") : null);
      if (hit) source = { step: i + 1, tool: steps[i].name, path: hit.path || "(the result)", value: hit.value };
    }
    out.push({ text: n.text, value: n.value, source });
  }
  return out;
}

export interface ModelInfo {
  key: string;
  label: string;
  provider: string;
  model: string;
  local: boolean;
}

/**
 * The context window a run had, and the run policy's minimum it was held to
 * (validationModels.ts: RUN_POLICY, runContext). Read before the run.
 */
export interface RunContextWindow {
  // LM Studio: the context the model was loaded with. Ollama: the longest the
  // model supports, up to which the window plan sizes num_ctx for each request.
  // Null where it was not read (a cloud model).
  tokens: number | null;
  min_tokens: number | null; // the run policy's minimum; null where none applies (a cloud model)
  read_from: "lmstudio-loaded" | "ollama-supported" | null;
}

/**
 * The token calibration a run started from, for its server and model
 * (provider/tokens.ts): what the requests before it taught the estimate. It
 * decides when a local model's older results are shortened and the window an
 * Ollama model runs with, and it carries over from run to run on purpose, so
 * the record says where each run started (validationRun.ts).
 */
export interface TokensAtStart {
  scale: number | null; // the server's counted prompt tokens over the estimate's, the largest seen; null: none counted yet
  ollama_num_ctx: number | null; // the context length an Ollama model last ran with; null: none yet, or not Ollama
}

export interface RunRecord {
  schema: "nebula3d-validation-run/1";
  case: string;
  family: string;
  split: Split;
  arm: Arm;
  run: number;
  dataset: string; // the server's id
  stem: string; // the raw file's stem: what the scorer finds the outputs by
  model: ModelInfo;
  task: string;
  max_rounds: number;
  // The window the run had and the minimum it was held to; absent from records made before 2026-10-19.
  context_window?: RunContextWindow | null;
  // The token calibration the run started from; absent from records made before 2026-10-19.
  tokens_at_start?: TokensAtStart | null;
  started: string;
  latency_ms: number;
  usage: EvalRun["usage"];
  cost_usd: number | null;
  tool_offers: ToolOffer[]; // the tools offered on each request, as sent (offers.ts)
  decisions: Decision[];
  numbers: NumberSource[];
  conclusion: string;
  // The verdict on the run computed from its checks (verdicts/); absent from records made before 2026-10-17.
  computed_verdict?: ComputedVerdict | null;
  note: string | null;
  error: string | null;
  failure: Failure | null; // the model server failed the reply after its retries: infrastructure, apart from a wrong answer
  grades: ValidationGrades;
  truth_score?: Record<string, unknown>; // filled by `python -m nebula3d.validation score`
}

/** One run's record: the decisions, the numbers with their sources, the conclusion, the grades. */
export function buildRecord(p: {
  case: ValidationCase;
  arm: Arm;
  run: number;
  dataset: Dataset;
  model: ModelInfo;
  evalRun: EvalRun;
  why: readonly string[];
  maxRounds: number;
  started: string;
  costUsd: number | null;
  elsewhere?: readonly string[];
  offers?: readonly ToolOffer[];
  context?: RunContextWindow | null;
  tokensAtStart?: TokensAtStart | null;
}): RunRecord {
  const r = p.evalRun;
  return {
    schema: "nebula3d-validation-run/1",
    case: p.case.id,
    family: p.case.family,
    split: p.case.split,
    arm: p.arm,
    run: p.run,
    dataset: p.dataset.id,
    stem: p.dataset.stem,
    model: p.model,
    task: TASK,
    max_rounds: p.maxRounds,
    context_window: p.context ?? null,
    tokens_at_start: p.tokensAtStart ?? null,
    started: p.started,
    latency_ms: Math.round(r.latencyMs),
    usage: r.usage,
    cost_usd: p.costUsd,
    tool_offers: [...(p.offers ?? [])],
    decisions: decisions(r.steps, p.why),
    numbers: numberSources(r.content, r.steps),
    conclusion: r.content,
    computed_verdict: r.verdict ?? null,
    note: r.note ?? null,
    error: r.error ?? null,
    failure: r.failure ?? null,
    grades: gradeRun(p.case, r, p.elsewhere ?? []),
  };
}

/**
 * A record's run as the run it records, to grade its words again: its steps as
 * its decisions keep them (stepOf: what the model read, and the whole where it
 * differs), its conclusion as the answer.
 */
export const evalRunOf = (rec: RunRecord): EvalRun => ({
  scenario: rec.case,
  steps: rec.decisions.map((d) => ({ id: String(d.step), name: d.tool, args: d.args, summary: d.summary, ...stepOf(d), ...(d.shortened ? { shortened: true as const } : {}) })),
  content: rec.conclusion,
  note: rec.note ?? undefined,
  error: rec.error ?? undefined,
  failure: rec.failure ?? null,
  latencyMs: rec.latency_ms,
  usage: rec.usage,
  verdict: rec.computed_verdict ?? null,
});

/**
 * A run's grades again, from its record, with the graders as they are now:
 * the detection and the false alarms from its conclusion and its steps; its
 * unsafe actions as the run counted them (what changed on the other datasets
 * is not in the record).
 */
export function regradeRun(rec: RunRecord): ValidationGrades {
  const c = caseNamed(rec.case);
  if (!c) throw new Error("a run of the record is on no validation case");
  return { ...gradeRun(c, evalRunOf(rec)), unsafe: rec.grades.unsafe };
}

/**
 * Every run of a record graded again (NEBULA_VALIDATION_REGRADE), in place:
 * how many runs' grades moved. A record of the held-out test split is graded
 * again only to be reported, with *report*, as it was run.
 */
export function regradeRecord(record: { split?: string; runs: RunRecord[] }, { report = false }: { report?: boolean } = {}): number {
  if ((record.split === "test" || record.runs.some((r) => r.split === "test")) && !report) {
    throw new Error("this record holds the held-out test split: set NEBULA_VALIDATION_REPORT=1 to grade it again for the reported numbers only");
  }
  let moved = 0;
  for (const run of record.runs) {
    const before = JSON.stringify(run.grades);
    run.grades = regradeRun(run);
    if (JSON.stringify(run.grades) !== before) moved += 1;
  }
  return moved;
}

/**
 * The cases a run may take. The held-out test split is run to be reported, not
 * to improve anything: it needs *report*, and a model with a spend cap (a paid
 * API) runs nothing else.
 */
export function casesToRun(split: Split, { report = false }: { report?: boolean } = {}): ValidationCase[] {
  if (split === "test" && !report) {
    throw new Error("the test split is held out: set NEBULA_VALIDATION_REPORT=1 to run it for the reported numbers only");
  }
  return casesIn(split);
}

/** Datasets a run may read: the validation cases' alone, so no record can hold measured data. */
export function validationDatasets(datasets: Dataset[]): Dataset[] {
  const bad = datasets.filter((d) => !caseOfDataset(d.id));
  if (bad.length) {
    throw new Error(
      `the backend serves datasets that are not validation cases (${bad.map((d) => d.id).slice(0, 3).join(", ")}…): ` +
        "serve a data root of its own, filled by `python -m nebula3d.validation make`",
    );
  }
  return datasets;
}
