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
//   guidance, within its written precision; an earlier turn's result only
//   while no later run has recomputed the stage it measured (earlierSources).
// - **Verdicts from the checks.** A stage the tools judged to need attention
//   is never called clean, and the run is not called trustworthy unless the
//   verdict computed from the checks says it met its goal: the check-verdict
//   module (verdicts/) reads both from the tools' results, the answer checks
//   as one of its readers. The tools compute verdicts, the model quotes and
//   explains them.
// - **The user's questions are asked, never answered for them.** A result
//   that carries a question only the user can answer (ask_user: the punch's
//   sharp peaks off the lattice bunched at one commensurate fraction) has the
//   answer ask it, naming the fraction or the modulation (`unasked`), and
//   never say outright that the sample has that modulation (`assumed`).
// - **Only marks that were made.** An answer names a marked region by the id
//   mark_region returned for it in this conversation (`unmadeMarks`): an id
//   no call made points the user at nothing.
//
// A failed check sends the answer back once, with what to fix; what still
// fails is noted under the reply.  The text checks are heuristic by design:
// a false alarm costs one tool call, a miss is a note.  With the skills off
// (the switch, skills.ts: the validation's arm C) the same checks send the
// same answers back, worded without the method: the answer's own words and
// what they lack, never a skill, a stage or a tool to run next (issuesPrompt).

import type { AgentStep } from "./agent";
import { readAnswer, sourceNumbers, writtenNumbers, type Cue, type ReadOptions, type Span } from "./answerText";
import { current, recomputedAt, type PipelineStage } from "./evidence";
import { found, seen } from "./readings";
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

// ------------------------------------------------------------------ the answer's words
//
// The answer is read by the one reader of an answer's words (answerText/),
// which the validation's graders read too. The answer checks keep their own
// reading where the two differ, each difference named here and pinned with
// both readings (answerTextPins.test.ts); each is the graders' rule once its
// flag is true, after the validation.

/** W1: the answer checks split a clause at "; " and at ": " after a long label, not at a spaced dash (the graders do). */
export const W1_GATE_SPLITS_AT_DASHES = false;

/** W2: the answer checks negate on a negation alone, not on an absence ("nowhere", "too few", "insufficient"), as the graders do. */
export const W2_GATE_NEGATES_ABSENCE = false;

/** The curly apostrophe: the answer checks read "isn’t" as no negation (their blind spot, kept until after the validation); the graders read it as "isn't". */
export const W9_GATE_READS_CURLY_APOSTROPHE = false;

/** How the answer checks read an answer. */
const READING: ReadOptions = { dashes: W1_GATE_SPLITS_AT_DASHES, apostrophes: W9_GATE_READS_CURLY_APOSTROPHE };

/** A clause that weighs a possibility, plans, or speaks of what comes next or what a step is for is not a verdict: its words anywhere (W4). A question is not one either. */
const NOT_A_VERDICT: readonly Cue[] = ["conditional", "modal", "plan", "sequence", "purpose"];
const notAVerdict = (c: Span): boolean => c.question || NOT_A_VERDICT.some((k) => c.cues.has(k));

/** Negations (a negated claim is still a verdict, but not a claim of success). */
const NEGATING: readonly Cue[] = W2_GATE_NEGATES_ABSENCE ? ["negation", "absence"] : ["negation"];
const negated = (c: Span): boolean => NEGATING.some((k) => c.cues.has(k));

/**
 * The claims an answer makes: its sentences split into clauses at ; and :, so
 * "The UB is fine: the fit changed nothing" makes its claim without the next
 * clause's negation, and without a leading answer word.
 */
const claimsOf = (text: string): readonly Span[] => readAnswer(text, READING).clauses;

/** The claims an answer makes, as written. */
export function clauses(text: string): string[] {
  return claimsOf(text).map((c) => c.text);
}

/** The verdict clauses about each topic. */
function verdictClauses(text: string): Map<string, Span[]> {
  const out = new Map<string, Span[]>();
  for (const c of claimsOf(text)) {
    if (notAVerdict(c)) continue;
    for (const t of TOPICS) {
      if (t.subject.test(c.text) && (t.verdict ?? VERDICT).test(c.text)) out.set(t.id, [...(out.get(t.id) ?? []), c]);
    }
  }
  return out;
}

/** The verdict clauses about each topic, as written. */
export function verdictsIn(text: string): Map<string, string[]> {
  return new Map([...verdictClauses(text)].map(([id, cs]) => [id, cs.map((c) => c.text)]));
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
const claimsSuccess = (c: Span): boolean => (SUCCESS.test(c.text) && !negated(c)) || SUCCESS_BY_NEGATION.test(c.text);

interface VerdictRule {
  topic: CheckId; // the check whose verdict the claim is held to, as the answer checks read it (verdicts/readers.ts)
  claimsOk: (c: Span) => boolean; // a non-hedged claim that it is fine
  claimsNotOk?: (c: Span) => boolean; // checked against a passing verdict, where calling it wrong is as bad
}

/** A claim the clause makes outright: its words, not negated, and not doubted (W3: doubt is the answer checks' alone). */
const asserted = (re: RegExp) => (c: Span): boolean => re.test(c.text) && !negated(c) && !c.cues.has("doubt");

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
    claimsOk: (c) => /\bno second grain\b|\bone grain\b|\bsingle grain\b/i.test(c.text),
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
  const claimed = verdictClauses(text);
  // Each check's verdict as the answer checks read it: the newest current result that decides.
  const { checks } = verdicts({ reply: steps });
  return RULES.flatMap((rule) => {
    const kind = checks[rule.topic];
    const lines = claimed.get(rule.topic) ?? [];
    const said = kind === "attention" ? lines.filter(rule.claimsOk) : kind === "pass" && rule.claimsNotOk ? lines.filter(rule.claimsNotOk) : [];
    const topic = TOPICS.find((t) => t.id === rule.topic);
    return said.length && topic ? [{ topic, said: said.map((c) => c.text) }] : [];
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
  return claimsOf(text)
    .filter((c) => !notAVerdict(c) && !negated(c) && WHOLE.test(c.text) && ACHIEVED_CLAIM.test(c.text))
    .map((c) => c.text);
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

// ------------------------------------------------------------------ the user's questions
//
// A result may carry a question only the user can answer, as ask_user:
// off_lattice_bunching's, when the punch's sharp peaks off the lattice bunch
// at one commensurate fraction, as the satellites of a modulation nobody
// declared would (metrics/bunching.ts). Whether the sample has one, and in
// which form, is the user's to say (the user's decision, 2026-10-19): the
// answer asks it, and never answers it for the user.
//
// - unasked: no question of the answer (a sentence ending with "?") names the
//   question's fraction (p/q, its twin 1 − p/q, or a decimal of either to
//   two places) or the word "modulation";
// - assumed: with such a question in the reply, a clause that says outright
//   that the sample has the modulation or that its peaks are satellites: one
//   that names them and claims them, not hedged, conditional, negated or a
//   question, and not about the question or the setting (asking, answering,
//   declaring). Hedged clauses are exempt.
//
// Heuristic, as the other text checks are: known answers on both sides are
// pinned in answerChecks.test.ts.

/** The questions for the user that the reply's results carry (ask_user, at any depth), each once, in order. */
export function questionsForUser(steps: readonly AgentStep[]): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach(walk);
    for (const [k, x] of Object.entries(v)) {
      if (k === "ask_user" && typeof x === "string" && x.trim()) {
        if (!out.includes(x)) out.push(x);
      } else walk(x);
    }
  };
  for (const s of steps) walk(found(s));
  return out;
}

const VULGAR: Record<string, number> = { "½": 1 / 2, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 1 / 4, "¾": 3 / 4, "⅕": 1 / 5, "⅖": 2 / 5, "⅗": 3 / 5, "⅘": 4 / 5, "⅙": 1 / 6, "⅚": 5 / 6 };

/** The fractions a text writes, as p/q or ⅓, by value. */
const fractionsIn = (text: string): number[] => [
  ...[...text.matchAll(/(?<![\d/.])(\d+)\s*\/\s*(\d+)(?![\d/])/g)].map((m) => Number(m[1]) / Number(m[2])),
  ...[...text].filter((c) => c in VULGAR).map((c) => VULGAR[c]),
].filter(Number.isFinite);

/** The decimals of two places or more a text writes. */
const decimalsIn = (text: string): number[] => [...text.matchAll(/(?<![\d.])\d*\.\d{2,}(?![\d.])/g)].map((m) => Number(m[0]));

const MODULATION_WORD = /\bmodulat\w*/i;

/** Whether one of the answer's questions names the fraction `question` asks about, or the modulation. */
function asksIt(text: string, question: string): boolean {
  const asked = fractionsIn(question).map((f) => f % 1).filter((f) => f > 0);
  const wanted = [...asked, ...asked.map((f) => 1 - f)];
  const near = (v: number) => wanted.some((f) => Math.abs((v % 1) - f) < 0.005);
  return readAnswer(text, READING).sentences.some(
    (s) => s.question && (MODULATION_WORD.test(s.text) || fractionsIn(s.text).some(near) || decimalsIn(s.text).some(near)),
  );
}

/** The questions for the user that the reply's results carry and the answer does not ask. */
export function unaskedQuestions(text: string, steps: readonly AgentStep[]): string[] {
  return questionsForUser(steps).filter((q) => !asksIt(text, q));
}

/** A clause that names the sample's modulation, its satellites or its wave vector. */
const NAMES_MODULATION = /\bmodulat\w*|\bsatellites?\b|\b(?:wave[- ]?|propagation[- ])vectors?\b/i;
/** That claims it: the sample has it, the peaks are its satellites, the data show it. */
const CLAIMS_IT =
  /\b(?:has|have|had|is|are|was|were|been|shows?|showed|shown|exhibits?|displays?|hosts?|carr(?:y|ies)|contains?|reveals?|revealed|indicates?|indicated|confirms?|confirmed|proves?|proved|exists?|present|real|genuine)\b/i;
/** A hedge, or the question or the setting spoken of: no claim about the sample. */
const NOT_A_CLAIM =
  /\b(?:possibl\w*|perhaps|maybe|likely|unlikely|probabl\w*|suggest\w*|consistent with|compatible with|appears?|seems?|looks? like|hints?|points? to|candidates?|potential\w*|tentative\w*|unconfirmed|ask\w*|question\w*|answer\w*|declar\w*|your call|yours to|up to you|you decide|let me know|tell me)\b/i;

/** The answer's clauses that say outright the sample has a modulation (not hedged, conditional, negated or a question). */
export function assumedModulation(text: string): string[] {
  return claimsOf(text)
    .filter((c) => !notAVerdict(c) && !c.cues.has("doubt") && !negated(c) && NAMES_MODULATION.test(c.text) && CLAIMS_IT.test(c.text) && !NOT_A_CLAIM.test(c.text))
    .map((c) => c.text);
}

// ------------------------------------------------------------------ the marks it names
//
// mark_region marks a region in the slice views and names the mark by an id:
// "marked": "M1" in its result (a call that finds the same mark there already
// names that one). An answer may name a mark that a call made in this reply
// or an earlier turn (a restored turn's too: its marks came back with it), and
// no other: an id the model made up points the user at nothing.
//
// Only an id in the tool's form counts (M and a number, a word of its own),
// and only where the answer speaks of a mark: near a mark word ("marked as
// M2", "the marks M1 and M3", "M1 marks the ring") or in the tool's own
// "M1 · label" form. Not a site or an irrep of the same form (the M2 site,
// M2+, mM3), and not in a clause that negates, asks, plans or weighs a
// condition ("there is no M3", "I could mark it as M3"). Heuristic, as the
// other text checks are, and leaning to a miss over a false alarm: a bare
// "(M1)" beside a finding is not read as a mark.

/** The marks the steps' mark_region calls made, by the id each result names, each once, in order. */
export function marksMade(steps: readonly AgentStep[]): string[] {
  const ids = steps.flatMap((s) => {
    if (s.name !== "mark_region") return [];
    const id = found(s)?.marked;
    return typeof id === "string" && MARK_ID_FORM.test(id) ? [id] : [];
  });
  return unique(ids);
}

/** A mark's id as mark_region gives it. */
const MARK_ID_FORM = /^M[1-9]\d*$/;
/** That id in an answer: a word of its own, not a site, an irrep or a decimal (M2 site, M2+, M2−, mM3, M1.5). */
const MARK_ID = /(?<![\p{L}\p{N}_])M[1-9]\d*(?![\p{L}\p{N}_]|[+−-]|\.\d|\s+sites?\b)/gu;
/** A word that speaks of a mark: the noun or the verb. */
const MARK_WORD = /\bmark(?:s|ed|ing)?\b/i;
/** Words that join ids in a list ("M1, M2 and M3"), which no distance counts. */
const JOINER = /^(?:and|or|&|\/)?$/i;
/** How many words may stand between a mark word and an id after it ("marked the ring at 3.2 Å⁻¹, M1"), or before it ("M1 is the mark"). */
const AFTER_MARK_WORD = 6;
const BEFORE_MARK_WORD = 2;
/** Clauses that name no mark as made: negated, a question, a condition, a plan, or what might be. */
const NOT_A_CITATION: readonly Cue[] = ["conditional", "plan", "modal"];

/** The mark ids an answer names as marks, each once, in order. */
export function citedMarks(text: string): string[] {
  const out: string[] = [];
  for (const s of readAnswer(text, READING).sentences) {
    const ids = [...s.text.matchAll(MARK_ID)];
    if (!ids.length || s.question) continue;
    // Each clause where it sits in the sentence: an id in one that names no mark as made is passed over.
    let from = 0;
    const passed = s.clauses.flatMap((c) => {
      const at = s.text.indexOf(c.text, from);
      if (at < 0) return [];
      from = at + c.text.length;
      return c.question || negated(c) || NOT_A_CITATION.some((k) => c.cues.has(k)) ? [[at, from] as const] : [];
    });
    // The sentence as words, each where it starts: a mark word, one holding an id, a joiner, or another word.
    const words = [...s.text.matchAll(/\S+/g)].map((m) => ({ text: m[0], at: m.index }));
    const wordAt = (index: number): number => words.reduce((found, w, i) => (w.at <= index ? i : found), 0);
    const idWords = new Set(ids.map((m) => wordAt(m.index)));
    const kinds = words.map((w, i) => {
      if (idWords.has(i)) return { mark: false, counts: false };
      if (MARK_WORD.test(w.text)) return { mark: true, counts: false };
      return { mark: false, counts: !JOINER.test(w.text.replace(/[()[\].,;:!"“”'‘’]/g, "")) };
    });
    // The words that count between two (neither end).
    const between = (a: number, b: number) => kinds.slice(Math.min(a, b) + 1, Math.max(a, b)).filter((k) => k.counts).length;
    for (const m of ids) {
      if (passed.some(([a, b]) => m.index >= a && m.index < b)) continue;
      const i = wordAt(m.index);
      // The tool's own form of a mark, its id and label: "M1 · a ring left over".
      const chip = /^\s*·/.test(s.text.slice(m.index + m[0].length));
      const after = kinds.some((k, j) => k.mark && j < i && between(j, i) <= AFTER_MARK_WORD);
      const before = kinds.some((k, j) => k.mark && j > i && between(i, j) <= BEFORE_MARK_WORD);
      // Named after a mark word, however far: "I marked the ring left over on the punch stage as M7".
      const named = /\bas\s*\(?$/i.test(s.text.slice(0, m.index)) && kinds.some((k, j) => k.mark && j < i);
      if ((chip || after || before || named) && !out.includes(m[0])) out.push(m[0]);
    }
  }
  return out;
}

/** The mark ids an answer names as marks that no mark_region call made: in this reply (`steps`), or an earlier turn (`earlier`). */
export function unmadeMarks(text: string, steps: readonly AgentStep[], earlier: Iterable<string> = []): string[] {
  const made = new Set([...earlier, ...marksMade(steps)]);
  return citedMarks(text).filter((id) => !made.has(id));
}

// ------------------------------------------------------------------ numbers
//
// Read by the reader (answerText/numbers.ts: writtenNumbers, sourceNumbers).
// W7: a percentage is also read as a share here (12 % is 0.12 in a source),
// where the graders read it as written.

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

/** The stages whose outputs a step measured, as its evidence reads them: the stage of each topic it settles (none for the raw volume). */
const measuredStages = (step: AgentStep): PipelineStage[] => {
  const topics = factsOf(step.name).settles(step.args);
  return [...new Set(TOPICS.flatMap((t) => (t.stage !== null && topics.includes(t.id) ? [t.stage] : [])))];
};

/**
 * The results of a conversation's earlier turns as number sources for this
 * reply (`steps`), each as the model read it, while what it measured stands:
 * a run after it (in a later turn, or in this reply) that recomputed the stage
 * it measured takes it out, as it takes such a measurement out of a verdict's
 * evidence (evidence.ts). An assessment of several stages (assess_stage, one
 * part per stage) keeps the parts of the stages still standing; any other
 * result goes whole. A result that settles no topic counts as it is. What is
 * taken out is kept apart (`stale`), so that a number only it holds is told
 * from one from nowhere.
 */
export function earlierSources(earlier: readonly AgentStep[], steps: readonly AgentStep[]): { standing: string[]; stale: string } {
  const at = recomputedAt([...earlier, ...steps]);
  const standing: string[] = [];
  const stale: string[] = [];
  earlier.forEach((step, i) => {
    const text = step.status === "done" ? seen(step) : "";
    if (!text) return;
    const gone: string[] = measuredStages(step).filter((s) => !current(at, s, i));
    if (!gone.length) {
      standing.push(text);
      return;
    }
    const r = found({ status: "done", result: text });
    if (r && gone.every((s) => s in r)) {
      const part = (keep: boolean) => JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => gone.includes(k) !== keep)));
      standing.push(part(true));
      stale.push(part(false));
    } else {
      stale.push(text);
    }
  });
  return { standing, stale: stale.join("\n") };
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
  staleNumbers: string[]; // numbers only an earlier result holds that a later run made stale (earlierSources)
  contradicted: Topic[]; // contradicts the verdict a tool computed
  unknownReferences: string[]; // {{references}} that name nothing in this reply's results
  overall: string | null; // calls the run a success the computed verdict does not give
  // The answer's own clauses behind those findings, each once, in order: what
  // a send-back with the skills off quotes instead of naming the topic, its
  // stage or the tool that settles it (issuesPrompt).
  said: { missing: string[]; stale: string[]; contradicted: string[]; overall: string[] };
  achieved: boolean | null; // the computed verdict's: false, not met; null, not judged or nothing measured
  // The questions for the user the reply's results carry (ask_user) that the
  // answer does not ask, as the results word them.
  unasked: string[];
  // With such a question in the reply, the answer's clauses that say outright
  // the sample has the modulation it asks about: the answer's own words.
  assumed: string[];
  // The mark ids the answer names as marks that no mark_region call in this
  // conversation made (unmadeMarks), as written.
  unmadeMarks: string[];
}

const unique = <T>(xs: T[]): T[] => [...new Set(xs)];

/**
 * What the answer fails, or null when it stands on its evidence. The answer is
 * read with its references filled in from this reply's results, as the user
 * will read it. `stale`: what earlierSources took out of the sources, which
 * tells a number measured before a later run from one from nowhere.
 * `marksEarlier`: the marks the conversation's earlier turns made
 * (marksMade), which the answer may name besides this reply's.
 */
export function answerIssues(
  text: string,
  steps: readonly AgentStep[],
  sources: string,
  stale = "",
  marksEarlier: Iterable<string> = [],
): AnswerIssues | null {
  if (!text.trim()) return null;
  const { text: filled, unknown } = fillReferences(text, steps);
  const { missing, stale: staleTopics } = evidenceGaps(filled, steps);
  const claimed = verdictsIn(filled);
  const about = (topics: readonly Topic[]): string[] => unique(topics.flatMap((t) => claimed.get(t.id) ?? []));
  const contradicted = contradicting(filled, steps);
  const verdict = verdicts({ reply: steps }).achieved;
  // An unfilled reference is no number written; its digits (features.0) are not either.
  const written = filled.replace(/\{\{[^}]*\}\}/g, "");
  const notCurrent = untracedNumbers(written, sources);
  const nowhere = stale && notCurrent.length ? untracedNumbers(written, `${sources}\n${stale}`) : notCurrent;
  const questions = questionsForUser(steps);
  const issues: AnswerIssues = {
    missing,
    stale: staleTopics,
    untraced: nowhere,
    staleNumbers: notCurrent.filter((n) => !nowhere.includes(n)),
    contradicted: contradicted.map((c) => c.topic),
    unknownReferences: unknown,
    overall: overallContradiction(filled, verdict),
    said: {
      missing: about(missing),
      stale: about(staleTopics),
      contradicted: unique(contradicted.flatMap((c) => c.said)),
      overall: unique(successClaims(filled, verdict)),
    },
    achieved: verdict?.achieved ?? null,
    unasked: questions.filter((q) => !asksIt(filled, q)),
    assumed: questions.length ? unique(assumedModulation(filled)) : [],
    unmadeMarks: unmadeMarks(filled, steps, marksEarlier),
  };
  return issues.missing.length ||
    issues.stale.length ||
    issues.untraced.length ||
    issues.staleNumbers.length ||
    issues.contradicted.length ||
    issues.unknownReferences.length ||
    issues.overall ||
    issues.unasked.length ||
    issues.assumed.length ||
    issues.unmadeMarks.length
    ? issues
    : null;
}

const MAX_LISTED = 8;
const listed = (xs: string[]): string => (xs.length > MAX_LISTED ? `${xs.slice(0, MAX_LISTED).join(", ")}, …` : xs.join(", "));

/** The send-back's opening on mark ids no call made, in either arm. */
const marksNamed = (ids: readonly string[]): string => (ids.length > 1 ? "These mark ids name" : "This mark id names");

/** The send-back's line on numbers a later run made stale, in either arm: it names no tool, stage or skill. */
const staleNumbersLine = (xs: string[]): string =>
  `- These numbers were measured before the last run recomputed the outputs they describe: ${listed(xs)}. Quote numbers measured since, or leave them out.`;

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
  if (issues.staleNumbers.length) lines.push(staleNumbersLine(issues.staleNumbers));
  for (const q of issues.unasked) {
    lines.push(`- A result in this reply has a question for the user (ask_user) that the answer does not ask: "${q}" Ask it, naming the fraction or the modulation, and leave the answer to the user.`);
  }
  if (issues.assumed.length) {
    lines.push(
      `- ${issues.assumed.map(quoted).join(", ")}: ${issues.assumed.length > 1 ? "these say" : "this says"} the sample has the modulation a result in this reply asks the user about (ask_user). Only the user can say so: ask instead, and declare nothing.`,
    );
  }
  if (issues.unmadeMarks.length) {
    lines.push(
      `- ${marksNamed(issues.unmadeMarks)} no mark that mark_region made in this conversation: ${listed(issues.unmadeMarks)}. Cite a mark only by the id its call returned ("marked" in the result); to show a region not yet marked, call mark_region first.`,
    );
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
  if (issues.staleNumbers.length) lines.push(staleNumbersLine(issues.staleNumbers));
  // The result's question is the result's words, not the answer's: given as written, never quoted as the answer's.
  for (const q of issues.unasked) {
    lines.push(`- A result in this reply has a question for the user that the answer does not ask: ${q} Ask it, naming the fraction or the modulation, and leave the answer to the user.`);
  }
  if (issues.assumed.length) {
    lines.push(
      `- ${issues.assumed.map(quoted).join(", ")}: ${issues.assumed.length > 1 ? "these say" : "this says"} as fact what a result in this reply asks the user. Only the user can say so: ask instead.`,
    );
  }
  if (issues.unmadeMarks.length) {
    lines.push(`- ${marksNamed(issues.unmadeMarks)} no mark made in this conversation: ${listed(issues.unmadeMarks)}. Cite a mark only by the id its call returned, or leave it out.`);
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
  if (issues.staleNumbers.length) parts.push(`Measured before the last run recomputed the outputs they describe: ${listed(issues.staleNumbers)}.`);
  for (const q of issues.unasked) parts.push(`Not asked of you, though a result asks it: ${q}`);
  if (issues.assumed.length) parts.push(`Says as fact what only you can say: ${listed(issues.assumed.map(quoted))}.`);
  if (issues.unmadeMarks.length) parts.push(`Names ${issues.unmadeMarks.length > 1 ? "marks that were" : "a mark that was"} never made: ${listed(issues.unmadeMarks)}.`);
  return parts.join(" ");
}
