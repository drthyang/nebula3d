// What a NEBULA Pilot answer must stand on (THY-18).  The agent loop checks
// each final answer before the user reads it, in code after the answer (the
// paid models take no forced tool choice, and a local model ignores one):
//
// - **No verdict without its evidence.** A verdict on a stage (the ring
//   removal is clean, the punch missed peaks, the window stays inside the
//   coverage, …) needs the tool that measures it to have run in this reply,
//   after the last run that recomputed that stage (evidence.ts): a ring or
//   punch verdict needs assess_stage, the ΔPDF's correlations dpdf_peaks (or
//   a measured section), the origin ub_check. Small models answered from the
//   opening cut instead, or from a measurement the rerun made stale.
// - **Numbers by reference.** A tool's number is written as a reference,
//   {{tool.field}}, which the app fills in from the result (references.ts);
//   one that names nothing is sent back. Every other number written must come
//   from a tool result, the context, the user's words or the tools' own
//   guidance, within its written precision.
// - **Verdicts from the checks.** A stage the tools judged to need attention
//   is never called clean, and the run is not called trustworthy unless the
//   verdict computed from the checks says it met its goal: the check-verdict
//   module (verdicts/) reads both from the tools' results, the answer checks
//   as one of its readers. The tools compute verdicts, the model quotes and
//   explains them.
//
// A failed check sends the answer back once, with what to fix; what still
// fails is noted under the reply.  The text checks are heuristic by design:
// a false alarm costs one tool call, a miss is a note.  With the skills off
// (the switch, skills.ts: the validation's arm C) the same checks send the
// same answers back, worded without the method: the answer's own words and
// what they lack, never a skill, a stage or a tool to run next (issuesPrompt).

import type { AgentStep } from "./agent";
import { current, recomputedAt, type PipelineStage } from "./evidence";
import { fillReferences } from "./references";
import { factsOf } from "./tools";
import type { VerdictTopic } from "./tools/facts";
import { verdicts, type CheckId, type ComputedVerdict } from "./verdicts";

// The tools that settle a topic declare it (their facts' `settles`, in the
// registry); `evidence` names one of them, as the model is told.
export interface Topic {
  id: VerdictTopic;
  label: string; // what the verdict is about, as the note says it
  evidence: string; // the tool that settles it, as the model is told
  subject: RegExp;
  verdict?: RegExp; // the words that make a sentence a verdict on it, where VERDICT is too broad
  // The stage whose outputs the evidence reads: a run that recomputes it makes
  // the evidence stale. null: the raw volume, which no run changes.
  stage: PipelineStage | null;
}

/** Whether the step is evidence on the topic: its tool settles it, with these arguments. */
const settles = (step: AgentStep, topic: VerdictTopic): boolean => factsOf(step.name).settles(step.args).includes(topic);

export const TOPICS: readonly Topic[] = [
  {
    id: "rings",
    label: "the ring removal",
    // A ring is judged in 3D (assess_stage); a radial profile shows a bump on one plane only.
    evidence: "assess_stage with stage rings",
    subject: /\b(powder[- ]?rings?|rings?|ring[- ]removal)\b/i,
    stage: "rings",
  },
  {
    id: "punch",
    label: "the Bragg punch",
    evidence: "assess_stage with stage punch",
    // The peaks' offset from their nodes is the UB's verdict, not the punch's.
    subject: /^(?!.*\b(UB|ub_check|grain_check|offsets?|orientation|rotation)\b)(?=.*\b(bragg (peaks?|punch|nodes?)|punch(ed|ing)?|(?<!off-)lattice peaks?|leftover peaks?|missed peaks?)\b)/is,
    stage: "punch",
  },
  {
    id: "backfill",
    label: "the backfill",
    evidence: "texture_check, or assess_stage with stage backfill",
    subject: /\b(backfill(ed|ing)?|fill bias|texture)\b/i,
    stage: "backfill",
  },
  {
    id: "flatten",
    label: "the flatten",
    evidence: "assess_stage with stage flatten",
    subject: /\b(flatten(ed|ing)?|floors?|pedestal)\b/i,
    stage: "flatten",
  },
  {
    id: "coverage",
    label: "the ΔPDF window against the coverage",
    evidence: "qmax_coverage",
    subject: /\b(q[ _-]?max|coverage|unmeasured)\b/i,
    stage: "pdf",
  },
  {
    id: "symmetry",
    label: "the ΔPDF's symmetry",
    evidence: "symmetry_check",
    // A verdict on the ΔPDF itself; "a separable window breaks the six-fold
    // symmetry" is about a setting, not this run.
    subject: /^(?=.*\b(symmetr(y|ic)|six-?fold|6-?fold|three-?fold|3-?fold)\b)(?=.*(Δ\s?PDF|delta-?pdf|section)).*/is,
    stage: "pdf",
  },
  {
    id: "grain",
    label: "a second grain",
    evidence: "grain_check",
    subject: /\b(second grains?|grains?|twin(s|ned|ning)?)\b/i,
    stage: "punch",
  },
  {
    id: "pdf",
    label: "the 3D-ΔPDF",
    evidence: "assess_stage with stage pdf",
    // A verdict on the stage as a whole; its symmetry and its coverage are
    // their own topics, and a feature the ΔPDF shows is no verdict.
    subject: /^(?!.*\b(symmetr(y|ic)|six-?fold|three-?fold|coverage|unmeasured)\b)(?=.*(Δ\s?PDF|delta-?pdf)).*/is,
    verdict: /\b(meets? (its|the) goal|needs attention|pass(es|ed)?|fail(s|ed)?|clean|trustworthy|reliable|sound)\b/i,
    stage: "pdf",
  },
  {
    id: "ub",
    label: "the UB",
    evidence: "ub_check",
    subject: /\bUB\b|\borientation matrix\b/,
    stage: null,
  },
  {
    id: "origin",
    label: "the HKL origin",
    evidence: "ub_check",
    subject: /\borigin\b/i,
    // "The origin is shifted", not "the origin's peak is cut off" (the ΔPDF's origin).
    verdict: /\b(shift\w*|offset|displaced|moved)\b|\b(is|was|looks|seems)\s+(off|wrong|right|correct|fine)\b/i,
    stage: null,
  },
  {
    id: "features",
    label: "the 3D-ΔPDF's pair correlations",
    evidence: "dpdf_peaks",
    // Not the origin's self-correlation, which is no pair correlation.
    subject: /\b(pair[- ]correlations?|(?<!self-)correlations?|(positive|negative) (features?|peaks?|lobes?))\b/i,
    // A correlation named with a vector or a sign.
    verdict: /⟨|\(\s*[-−]?\d|\[\s*[-−]?\d|\b(positive|negative)\b|\b\d+(\.\d+)?\s*Å(?!⁻)/i,
    stage: "pdf",
  },
];

/** Words that make a sentence about a topic a verdict on it. */
const VERDICT =
  /\b(clean(ly)?|left|leftovers?|remain(s|ing|ed)?|residu\w*|removed|miss(ed|es)?|pass(es|ed)?|fail(s|ed)?|meets?|met|kept|keeps|holds?|held|broken|breaks?|lost|preserved|intact|successful(ly)?|(in)?complete(ly)?|over-?subtract\w*|dent(s|ed)?|biased|unbiased|seamless|flat|level|inside|within|past|beyond|exceeds?|right|correct|wrong|misorient\w*|turned|rotated|present|absent|no second|spurious|fine|good|ok(ay)?|shows?|showing|found|indicates?|confirms?|suggests?|off by|(is|are|was|were) off)\b/i;

/** A sentence that weighs a possibility, plans, or asks is not a verdict. */
const NOT_A_VERDICT = /\b(if|whether|unless|would|could|might|may|once|until|let me|i will|i'll|i'd|i'm going to|to check|to see|next)\b/i;

/** Negations (a negated claim is still a verdict, but not a claim of success). */
const NEGATION = /\b(no|not|never|none|nothing|neither|nor|without|cannot|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|won't|lacks?)\b|n't\b/i;

/** The answer's sentences (lines and sentence ends split it), without Markdown emphasis. */
export function sentences(text: string): string[] {
  return text
    .replace(/\*\*|__|`/g, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A leading answer word ("Yes,", "No:"), not the "No" of "No ring is left". */
export const ANSWER_WORD = /^(yes|no)\s*[,:.!—–-]\s*/i;

/**
 * The claims an answer makes: its sentences split into clauses at ; and :, so
 * "The UB is fine: the fit changed nothing" makes its claim without the next
 * clause's negation, and without a leading answer word.
 */
export function clauses(text: string): string[] {
  return sentences(text)
    .map((s) => s.replace(ANSWER_WORD, ""))
    .flatMap((s) => s.split(/;\s+/))
    .flatMap((s) => {
      // A short label before a colon ("Ring removal: clean") stays with what follows it.
      const parts = s.split(/:\s+/);
      return parts.length > 1 && parts[0].split(/\s+/).length <= 3 ? [s] : parts;
    })
    .map((c) => c.trim())
    .filter(Boolean);
}

/** The verdict clauses about each topic. */
export function verdictsIn(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const s of clauses(text)) {
    if (s.endsWith("?") || NOT_A_VERDICT.test(s)) continue;
    for (const t of TOPICS) {
      if (t.subject.test(s) && (t.verdict ?? VERDICT).test(s)) out.set(t.id, [...(out.get(t.id) ?? []), s]);
    }
  }
  return out;
}

/**
 * Topics the answer gives a verdict on without the tool that settles it having
 * run (without an error) in this reply after the last run that recomputed its
 * stage: `missing` when it never ran, `stale` when it ran only before that run.
 */
export function evidenceGaps(text: string, steps: readonly AgentStep[]): { missing: Topic[]; stale: Topic[] } {
  const at = recomputedAt(steps);
  const claimed = verdictsIn(text);
  const missing: Topic[] = [];
  const stale: Topic[] = [];
  for (const t of TOPICS) {
    if (!claimed.has(t.id)) continue;
    const ran = steps.map((s, i) => [s, i] as const).filter(([s]) => s.status === "done" && settles(s, t.id));
    if (ran.some(([, i]) => current(at, t.stage, i))) continue;
    (ran.length ? stale : missing).push(t);
  }
  return { missing, stale };
}

/** Topics the answer gives a verdict on without current evidence (missing or stale). */
export function missingEvidence(text: string, steps: readonly AgentStep[]): Topic[] {
  const { missing, stale } = evidenceGaps(text, steps);
  return [...missing, ...stale];
}

/** A claim that a stage met its goal. */
const SUCCESS = /\b(clean(ly)?|pass(es|ed)?|meets? (its|the) goal|successful(ly)?|fully removed|completely removed|removed (every|all)|all (removed|gone)|perfect(ly)?|flawless(ly)?)\b/i;
const SUCCESS_BY_NEGATION = /\b(no\s+(\w+\s+){0,3}|nothing\s+(is\s+|was\s+)?|none\s+(is\s+|are\s+|was\s+|were\s+)?)(left|leftovers?|missed|remain\w*|residu\w*)\b/i;
const claimsSuccess = (s: string): boolean => (SUCCESS.test(s) && !NEGATION.test(s)) || SUCCESS_BY_NEGATION.test(s);

interface VerdictRule {
  topic: CheckId; // the check whose verdict the claim is held to, as the answer checks read it (verdicts/readers.ts)
  claimsOk: (s: string) => boolean; // a non-hedged claim that it is fine
  claimsNotOk?: (s: string) => boolean; // checked against a passing verdict, where calling it wrong is as bad
}

const asserted = (re: RegExp) => (s: string): boolean => re.test(s) && !NEGATION.test(s) && !/\b(unlikely|doubt\w*)\b/i.test(s);

const RULES: readonly VerdictRule[] = [
  { topic: "rings", claimsOk: claimsSuccess },
  { topic: "punch", claimsOk: claimsSuccess },
  { topic: "backfill", claimsOk: claimsSuccess },
  { topic: "flatten", claimsOk: claimsSuccess },
  { topic: "pdf", claimsOk: claimsSuccess },
  { topic: "coverage", claimsOk: asserted(/\b(inside|within|stays|clean)\b/i) },
  { topic: "symmetry", claimsOk: asserted(/\b(kept|keeps|holds?|preserved|intact)\b/i) },
  {
    topic: "grain",
    claimsOk: (s) => /\bno second grain\b|\bone grain\b|\bsingle grain\b/i.test(s),
    claimsNotOk: asserted(/\b(a|the) second grain\b|\btwin(ned|s)?\b|\bsecond grain (is|was) (present|there|found)\b/i),
  },
  {
    topic: "ub",
    claimsOk: asserted(/\b(right|correct|fine|accurate|good|on (their|its) nodes)\b/i),
    // When the fit finds the UB right (no turn, or offsets no UB explains),
    // blaming the UB sends the user to the wrong fix.
    claimsNotOk: asserted(/\bUB\b[^.,;]{0,30}\b(is|was|looks|seems)\s+(off|wrong|incorrect|misorient\w*)\b|\bUB\b[^.,;]{0,20}\b(turned|rotated|off) by\b|\b(misoriented|wrong) UB\b/i),
  },
];

/** Where the answer contradicts the tools' computed verdicts in this reply (on the outputs as they now are): each topic, with the clauses that do. */
function contradicting(text: string, steps: readonly AgentStep[]): { topic: Topic; said: string[] }[] {
  const claimed = verdictsIn(text);
  // Each check's verdict as the answer checks read it: the newest current result that decides.
  const { checks } = verdicts({ reply: steps });
  return RULES.flatMap((rule) => {
    const kind = checks[rule.topic];
    const lines = claimed.get(rule.topic) ?? [];
    const said = kind === "attention" ? lines.filter(rule.claimsOk) : kind === "pass" && rule.claimsNotOk ? lines.filter(rule.claimsNotOk) : [];
    const topic = TOPICS.find((t) => t.id === rule.topic);
    return said.length && topic ? [{ topic, said }] : [];
  });
}

/** Topics where the answer contradicts the tools' computed verdicts in this reply (on the outputs as they now are). */
export function contradictions(text: string, steps: readonly AgentStep[]): Topic[] {
  return contradicting(text, steps).map((c) => c.topic);
}

// ------------------------------------------------------------------ the run as a whole

/** What the run is, said of the whole: the ΔPDF, the result, the reduction, the checks. */
// (No \b before Δ: it is no word character, and "3D-ΔPDF" has none there.)
const WHOLE = /Δ\s?PDF|\b(delta-?pdf|result|run|reduction|pipeline|volume|outputs?|analysis|checks|stages|everything|goal)\b/i;
/** A claim that it met its goal: it can be trusted, every check passes, the goal is met. */
const ACHIEVED_CLAIM =
  /\b(trust(worthy|ed)?|reliable|ready (for|to)|fit for (analysis|use|interpretation)|all (the )?(checks|stages) (pass(ed)?|meet|met)|every (check|stage) (passes|passed|meets|met)|(meets?|met) (every|all) (its |their |the )?(goals?|checks)|(goal|target) (is |was |has been )?(met|achieved|reached)|achieved)\b/i;

/** The clauses that call the run a success the computed verdict does not give (none where it gives it). */
function successClaims(text: string, verdict: ComputedVerdict | null): string[] {
  if (verdict?.achieved === true) return [];
  return clauses(text).filter(
    (c) => !c.endsWith("?") && !NOT_A_VERDICT.test(c) && !NEGATION.test(c) && WHOLE.test(c) && ACHIEVED_CLAIM.test(c),
  );
}

/**
 * Where the answer calls the run a success that the computed verdict does not
 * give: the reason, as the model is told it, or null. A claim with the verdict
 * not met contradicts it; one with it not judged rests on checks that did not
 * all run on the outputs as they now are, or that ran on a grid too coarse for
 * them, which the verdict says.
 */
export function overallContradiction(text: string, verdict: ComputedVerdict | null): string | null {
  if (!successClaims(text, verdict).length) return null;
  // Not judged for a grid too coarse for a check, the checks ran: the verdict says why (G1).
  return verdict?.achieved === false || verdict?.notJudged?.length
    ? `It calls the run a success, but the verdict computed from the checks is "${verdict.text}"`
    : `It calls the run a success, but the checks it rests on did not all run on the outputs as they now are (${verdict ? verdict.text : "nothing measured"})`;
}

// ------------------------------------------------------------------ numbers

export interface WrittenNumber {
  text: string; // as written
  value: number;
  tolerance: number; // half a unit of the last digit written (of the last non-zero one, for a round integer)
  percent: boolean;
  signed: boolean; // written with a + or − of its own
}

const SUPERSCRIPT: Record<string, string> = { "⁻": "-", "⁺": "+", "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };

/** Text with exponents as e-notation, unit exponents (Å⁻¹, Q²) and list markers dropped. */
function flatten(text: string): string {
  return text
    .replace(/\$/g, "")
    .replace(/\\(times|cdot)/g, "×")
    .replace(/\\[,;:! ]/g, " ")
    .replace(/\^\{([^}]*)\}/g, "^$1")
    .replace(/[⁻⁺⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => "^" + [...m].map((c) => SUPERSCRIPT[c]).join(""))
    .replace(/−/g, "-")
    .replace(/(\d(?:\.\d+)?)\s*[×x·]\s*10\s*\^\s*\(?([-+]?\d+)\)?/g, "$1e$2")
    .replace(/(?<![\d.])10\s*\^\s*\(?([-+]?\d+)\)?/g, "1e$1")
    .replace(/\^\s*\(?[-+]?\d+\)?/g, "")
    .replace(/^\s*(?:[-*]\s+)?\(?\d+[.)]\s+/gm, "");
}

/** The numbers an answer writes, as written; numbers inside names (hk0, 3D, 6/mmm, 201x201) are not numbers. */
export function writtenNumbers(text: string): WrittenNumber[] {
  const out: WrittenNumber[] = [];
  // Thousands separators in prose ("12,345"); not in the sources, where a
  // comma separates a JSON list's items.
  const prose = flatten(text).replace(/(?<![\d.,])\d{1,3}(?:,\d{3})+(?![\d,]|\.\d)/g, (m) => m.replace(/,/g, ""));
  const re = /(?<![A-Za-z_\d.^/])([-+]?)(\d+(?:\.(\d+))?)(?:e([-+]?\d+))?(\s*%)?(?![A-Za-z_\d/]|\.\d)/gi;
  for (const m of prose.matchAll(re)) {
    const [whole, sign, mantissa, decimals = "", exp, percent] = m;
    const scale = exp ? 10 ** Number(exp) : 1;
    const value = Number(`${sign}${mantissa}`) * scale;
    if (!Number.isFinite(value)) continue;
    // A round integer is as precise as its last non-zero digit: 1500 is 1532 rounded.
    const zeros = !decimals && !exp ? (/0+$/.exec(mantissa.replace(/^0+(?=\d)/, ""))?.[0].length ?? 0) : 0;
    const unit = decimals ? 10 ** -decimals.length : 10 ** Math.min(zeros, Math.max(mantissa.length - 1, 0));
    out.push({ text: whole.trim(), value, tolerance: 0.5 * unit * scale, percent: Boolean(percent), signed: sign !== "" });
  }
  return out;
}

export interface SourceNumbers {
  all: number[]; // every number, as a magnitude, sorted
  negative: number[]; // the magnitudes of those written with a minus sign, sorted
  positive: number[]; // the magnitudes of the others, sorted
}

/** Every number in the sources, sorted: all of them, and by sign. A minus counts
 * only right before the digits with no digit or point before it, so a range
 * ("4-8") reads as two positive numbers. */
export function sourceNumbers(sources: string): SourceNumbers {
  const all: number[] = [];
  const negative: number[] = [];
  const positive: number[] = [];
  for (const m of flatten(sources).matchAll(/(?<![\d.])(-?)(\d+(?:\.\d+)?(?:e[-+]?\d+)?)/gi)) {
    const v = Math.abs(Number(m[2]));
    if (!Number.isFinite(v)) continue;
    all.push(v);
    (m[1] === "-" ? negative : positive).push(v);
  }
  const sort = (xs: number[]) => xs.sort((a, b) => a - b);
  return { all: sort(all), negative: sort(negative), positive: sort(positive) };
}

/** Is some source within tolerance of |v| (a written precision, or 2 % for a rounded figure)? */
function traced(v: number, tolerance: number, sorted: readonly number[]): boolean {
  const target = Math.abs(v);
  const tol = Math.max(tolerance, 0.02 * target) + 1e-12;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < target - tol) lo = mid + 1;
    else hi = mid;
  }
  return lo < sorted.length && sorted[lo] <= target + tol;
}

/** The numbers an answer writes that no source holds (distinct, as written). */
export function untracedNumbers(text: string, sources: string): string[] {
  const found = sourceNumbers(sources);
  const out: string[] = [];
  for (const n of writtenNumbers(text)) {
    // A signed number needs a source of its sign: +0.14 is not −0.14.
    const pool = !n.signed ? found.all : n.value < 0 ? found.negative : found.positive;
    const ok = traced(n.value, n.tolerance, pool) || (n.percent && traced(n.value / 100, n.tolerance / 100, pool));
    if (!ok && !out.includes(n.text)) out.push(n.text);
  }
  return out;
}

// ------------------------------------------------------------------ the check

export interface AnswerIssues {
  missing: Topic[]; // verdicts without their tool
  stale: Topic[]; // verdicts on a measurement a later run made stale
  untraced: string[]; // numbers from nowhere
  contradicted: Topic[]; // contradicts the verdict a tool computed
  unknownReferences: string[]; // {{references}} that name nothing in this reply's results
  overall: string | null; // calls the run a success the computed verdict does not give
  // The answer's own clauses behind those findings, each once, in order: what
  // a send-back with the skills off quotes instead of naming the topic, its
  // stage or the tool that settles it (issuesPrompt).
  said: { missing: string[]; stale: string[]; contradicted: string[]; overall: string[] };
  achieved: boolean | null; // the computed verdict's: false, not met; null, not judged or nothing measured
}

const unique = <T>(xs: T[]): T[] => [...new Set(xs)];

/**
 * What the answer fails, or null when it stands on its evidence. The answer is
 * read with its references filled in from this reply's results, as the user
 * will read it.
 */
export function answerIssues(text: string, steps: readonly AgentStep[], sources: string): AnswerIssues | null {
  if (!text.trim()) return null;
  const { text: filled, unknown } = fillReferences(text, steps);
  const { missing, stale } = evidenceGaps(filled, steps);
  const claimed = verdictsIn(filled);
  const about = (topics: readonly Topic[]): string[] => unique(topics.flatMap((t) => claimed.get(t.id) ?? []));
  const contradicted = contradicting(filled, steps);
  const verdict = verdicts({ reply: steps }).achieved;
  const issues: AnswerIssues = {
    missing,
    stale,
    // An unfilled reference is no number written; its digits (features.0) are not either.
    untraced: untracedNumbers(filled.replace(/\{\{[^}]*\}\}/g, ""), sources),
    contradicted: contradicted.map((c) => c.topic),
    unknownReferences: unknown,
    overall: overallContradiction(filled, verdict),
    said: {
      missing: about(missing),
      stale: about(stale),
      contradicted: unique(contradicted.flatMap((c) => c.said)),
      overall: unique(successClaims(filled, verdict)),
    },
    achieved: verdict?.achieved ?? null,
  };
  return issues.missing.length || issues.stale.length || issues.untraced.length || issues.contradicted.length || issues.unknownReferences.length || issues.overall
    ? issues
    : null;
}

const MAX_LISTED = 8;
const listed = (xs: string[]): string => (xs.length > MAX_LISTED ? `${xs.slice(0, MAX_LISTED).join(", ")}, …` : xs.join(", "));

/**
 * What the model is told, to fix the answer before the user reads it. With
 * the skills off (the switch, skills.ts: the validation's arm C) the same
 * findings go back as often, worded to name no skill, no stage and no tool
 * the method would run next (withoutSkills, below).
 */
export function issuesPrompt(issues: AnswerIssues, { skills = true }: { skills?: boolean } = {}): string {
  if (!skills) return withoutSkills(issues);
  const lines = ["Before this answer goes to the user, fix it:"];
  for (const t of issues.missing) lines.push(`- It gives a verdict on ${t.label} without its evidence in this reply: call ${t.evidence}, and answer from its result.`);
  for (const t of issues.stale) {
    lines.push(`- It gives a verdict on ${t.label} from a measurement taken before the last run recomputed it: call ${t.evidence} again on the new outputs, and answer from that.`);
  }
  if (issues.overall) {
    lines.push(`- ${issues.overall}. That verdict is the checks', not yours: quote it as {{achieved}} and explain what it rests on${/did not all run/.test(issues.overall) ? " (call assess_stage with stage all first)" : ""}.`);
  }
  if (issues.unknownReferences.length) {
    lines.push(
      `- These references name no value in this reply's tool results: ${listed(issues.unknownReferences.map((k) => `{{${k}}}`))}. Write a reference as {{tool.field}}, the path of a field in a result above as the tool returned it (e.g. {{assess_stage.flatten.verdict}}), or quote the number itself.`,
    );
  }
  for (const t of issues.contradicted) lines.push(`- What it says about ${t.label} contradicts the verdict the tool computed: quote that verdict and its numbers.`);
  if (issues.untraced.length) {
    lines.push(`- These numbers appear in no tool result or the context: ${listed(issues.untraced)}. Quote the tools' numbers, or leave them out.`);
  }
  lines.push("Then write the whole answer again.");
  return lines.join("\n");
}

/** The longest stretch of the answer a send-back quotes. */
const QUOTE_MAX = 200;

/** The answer's own words, quoted (and clipped): what a send-back points at instead of a topic's name. */
const quoted = (s: string): string => `“${s.length > QUOTE_MAX ? `${s.slice(0, QUOTE_MAX - 1)}…` : s}”`;

/**
 * The send-back with the skills off: the checks hold the answer as they do
 * with them on (the guardrail is the same), but the method stays out of what
 * the model is told. Each finding is the answer's own words, quoted, and what
 * they lack: no topic's label (each is a stage's or a check's), no stage, no
 * tool to call, no skill. Which check gives the evidence is the model's to
 * find. The numbers and the references it wrote are its own words too.
 */
function withoutSkills(issues: AnswerIssues): string {
  const lines = ["Before this answer goes to the user, fix it:"];
  for (const s of issues.said.missing) {
    lines.push(`- ${quoted(s)}: this verdict needs its evidence from a check run in this reply. Answer from that check's result.`);
  }
  for (const s of issues.said.stale) {
    lines.push(
      `- ${quoted(s)}: this verdict rests on a measurement taken before the last run recomputed what it measured. It needs its evidence from a check run in this reply, after that run; answer from that check's result.`,
    );
  }
  if (issues.overall) {
    const claims = issues.said.overall;
    const why = issues.achieved === false ? "the run did not meet its goal" : "the checks it rests on did not all run on the outputs as they now are";
    lines.push(
      `- ${claims.map(quoted).join(", ")}: ${claims.length > 1 ? "these call" : "this calls"} the run a success, but the verdict computed from the checks does not give it: ${why}. That verdict is the checks', not yours: quote it as {{achieved}} and explain what it rests on.`,
    );
  }
  if (issues.unknownReferences.length) {
    lines.push(
      `- These references name no value in this reply's tool results: ${listed(issues.unknownReferences.map((k) => quoted(`{{${k}}}`)))}. Write a reference as {{tool.field}}, the path of a field in a result above as the tool returned it, or quote the number itself.`,
    );
  }
  for (const s of issues.said.contradicted) {
    lines.push(`- ${quoted(s)}: this contradicts the verdict a check computed in this reply. Quote that verdict and its numbers.`);
  }
  if (issues.untraced.length) {
    lines.push(`- These numbers appear in no tool result or the context: ${listed(issues.untraced)}. Quote the tools' numbers, or leave them out.`);
  }
  lines.push("Then write the whole answer again.");
  return lines.join("\n");
}

/** The note under a reply that still fails after its one revision. */
export function issuesNote(issues: AnswerIssues): string {
  const parts: string[] = [];
  if (issues.missing.length) parts.push(`Not measured in this reply: ${issues.missing.map((t) => `${t.label} (${t.evidence})`).join("; ")}.`);
  if (issues.stale.length) parts.push(`Measured before the last run recomputed it: ${issues.stale.map((t) => `${t.label} (${t.evidence})`).join("; ")}.`);
  if (issues.overall) parts.push(`${issues.overall.replace(/^It calls/, "The answer calls")}.`);
  if (issues.unknownReferences.length) parts.push(`References that name no tool value: ${listed(issues.unknownReferences.map((k) => `{{${k}}}`))}.`);
  if (issues.contradicted.length) parts.push(`Contradicts the tools' verdict on ${issues.contradicted.map((t) => t.label).join(" and ")}.`);
  if (issues.untraced.length) parts.push(`Not found in any tool result or the context: ${listed(issues.untraced)}.`);
  return parts.join(" ");
}
