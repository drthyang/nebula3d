// The word-reading adapter: the outcomes a recorded step's result holds, for
// results that carry their words and numbers only (recorded replies, the
// validation's records, a reply whose tools were replayed). Reached only from
// readers.ts. Each tool's mapping reads its words where its tool writes a
// verdict, and judges its numbers by the check's rule where it writes none.

import type { AgentStep } from "../agent";
import { OPEN_WEIGHT_OK } from "../metrics/coverage";
import type { Measured } from "../report/report";
import { countsProblems, judge, STAGES, WORDS, type Kind, type Outcome, type Reason, type Stage } from "./rules";

type Obj = Record<string, unknown>;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const words = (r: Obj): string | null => (typeof r.verdict === "string" ? r.verdict : null);
const outcome = (check: Outcome["check"], kind: Kind, reasons: Reason[], text: string | null, dataProblems: string[] = []): Outcome => ({
  check,
  kind,
  reasons,
  dataProblems,
  words: text,
});

/** The result a step's tool returned, parsed: an object, or null (an error, a step still running, a result cut off). */
function resultOf(step: AgentStep): Obj | null {
  if (step.status !== "done") return null;
  // #3 (a tool result carries both readings) plugs in here: the whole result, step.full ?? step.result.
  const text = step.result;
  if (!text) return null;
  try {
    const r: unknown = JSON.parse(text);
    return r && typeof r === "object" && !Array.isArray(r) ? (r as Obj) : null;
  } catch {
    return null; // a trimmed or non-JSON result holds no fields
  }
}

const LABELLED = new Map((Object.keys(WORDS.label) as Kind[]).map((k) => [WORDS.label[k], k]));

/**
 * A stage's result from assess_stage. A stage with no output yet gives an
 * outcome the readers know as such ("no output"); a verdict label gives its
 * kind (the recorded label is trusted, as it was); other words are judged by
 * the stage's rule from the numbers, marked as words that are no label (D12);
 * no words, by the rule.
 */
function stageOutcome(stage: Stage, m: Obj): Outcome {
  const judged = judge(stage, m);
  if (judged.reasons.includes("no output")) return judged;
  const said = words(m);
  if (said === null) return judged;
  const kind = LABELLED.get(said);
  if (kind === undefined) return { ...judged, reasons: [...judged.reasons, "words not a label"] };
  if (kind === judged.kind) return judged;
  return { ...judged, kind, reasons: kind === "pass" ? [] : ["recorded verdict"], words: said };
}

/** The window's weight on unmeasured space a result records, against the limit: what the report reads (D2). */
const weightReasons = (r: Obj): Reason[] => {
  const w = num(r.window_weight_on_unmeasured);
  return w == null ? [] : [w <= OPEN_WEIGHT_OK ? "window within limit" : "window past limit"];
};

/**
 * qmax_coverage's words. "clean" passes and "too far" needs attention; the
 * reach inside full coverage passes with that reason, a pass to every reader
 * (D1, unified by 2.4.1). D10: "past", "unmeasured" and
 * "not", words no producer wrote, need attention to the answer checks and are
 * no attention to {{achieved}}: this one mapping gives them the reason
 * "legacy coverage words", which the achieved reader's cell reads as no
 * verdict. Anything else is nothing to judge. The weight it records, if any,
 * is a reason of its own.
 */
function coverageOutcome(r: Obj): Outcome {
  const said = words(r) ?? "";
  const weight = weightReasons(r);
  const problems = countsProblems(r);
  const [kind, reasons]: [Kind, Reason[]] = /^clean/i.test(said)
    ? ["pass", weight]
    : /^too far/i.test(said)
      ? ["attention", /^too far: the transform reaches/i.test(said) || !weight.length ? ["reach past coverage", ...weight] : weight]
      : /^(past|unmeasured|not)/i.test(said)
        ? ["attention", ["legacy coverage words", ...weight]]
        : /^the transform reaches .* inside full coverage/.test(said)
          ? ["pass", ["reach inside coverage", ...weight]]
          : ["info", ["nothing to judge", ...weight]];
  return outcome("coverage", kind, reasons, words(r), problems);
}

/** symmetry_check's words: "kept" passes, "not kept" needs attention; "not judged" (no symmetry declared) and a note judge nothing. */
function symmetryOutcome(r: Obj): Outcome {
  const said = words(r) ?? "";
  if (/^kept/i.test(said)) return outcome("symmetry", "pass", [], said);
  if (/^not kept/i.test(said)) return outcome("symmetry", "attention", ["symmetry broken"], said);
  return outcome("symmetry", "info", [/^not judged/i.test(said) ? "not declared" : "nothing to judge"], words(r));
}

/**
 * grain_check's words and counts: "a second grain", "no second grain", "with
 * the UB off", and half or more of the strongest orbits beside Bragg nodes.
 * Without words, nothing to judge.
 */
function grainOutcome(r: Obj): Outcome {
  const said = words(r);
  if (said === null) return outcome("grain", "info", ["nothing to judge"], null);
  const judged = num(r.judged) ?? 0;
  const near = num(r.near_bragg_nodes) ?? 0;
  const reasons: Reason[] = [
    ...(/^a second grain/i.test(said) ? (["second grain"] as const) : []),
    ...(/^no second grain/i.test(said) ? (["no second grain"] as const) : []),
    ...(said.includes("with the UB off") ? (["UB off"] as const) : []),
    ...(judged > 0 && near >= judged / 2 ? (["peaks beside nodes"] as const) : []),
  ];
  const off = reasons.some((x) => x === "second grain" || x === "UB off" || x === "peaks beside nodes");
  return outcome("grain", off ? "attention" : "pass", reasons, said);
}

/**
 * D17: the pointer the agent loop writes for a repeated call (already_called,
 * agent.ts) reads as a result of its tool that holds nothing: {{achieved}}
 * reads it as the newest result, so it hides the verdict it points to (a
 * qmax_coverage "too far" no longer needs attention); the answer checks, which
 * read the newest result that decides, keep the earlier one. Unify: set this
 * to false; a pointer then holds no outcome, and both read the result it
 * points to.
 */
export const D17_REPEAT_POINTER_READS_AS_A_RESULT = true;

/**
 * The outcomes a step holds: the producer's, kept beside its result (the
 * sidecar), else read from its recorded words, else judged from its recorded
 * numbers. None for an error, a step still running or a result that does not
 * parse.
 */
export function outcomesOf(step: AgentStep): Outcome[] {
  if (step.status !== "done") return [];
  if (step.outcomes) return step.outcomes;
  const r = resultOf(step);
  if (!r || (!D17_REPEAT_POINTER_READS_AS_A_RESULT && "already_called" in r)) return [];
  switch (step.name) {
    case "assess_stage":
      return STAGES.flatMap((stage) => {
        const m = r[stage];
        return m && typeof m === "object" ? [stageOutcome(stage, m as Obj)] : [];
      });
    case "qmax_coverage":
      return [coverageOutcome(r)];
    case "symmetry_check":
      return [symmetryOutcome(r)];
    case "grain_check":
      return [grainOutcome(r)];
    // These write no verdict: their numbers, by the rule.
    case "texture_check":
      return [judge("texture", r)];
    case "ub_check":
      return [judge("ub", r)];
    default:
      return [];
  }
}

/**
 * D18: the report judges a stage's measurements by its rule, from the
 * numbers, and takes no recorded label, where the reply's reading trusts the
 * label (stageOutcome). Its measurements come fresh from the producers
 * (collect.ts), whose labels the numbers give; a label they do not give reads
 * apart. Unify: set this to false; the report then reads a label as the reply
 * does.
 */
export const D18_REPORT_JUDGES_STAGE_NUMBERS = true;

/** The outcomes a report's measurements hold, each tool's result read as a recorded step's is: for the checks whose outcomes the measurement pass did not keep. */
export function outcomesOfMeasured(m: Measured): Outcome[] {
  const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
  const out: Outcome[] = [];
  for (const stage of STAGES) {
    const x = obj(m[stage]);
    if (x) out.push(D18_REPORT_JUDGES_STAGE_NUMBERS ? judge(stage, x) : stageOutcome(stage, x));
  }
  const texture = obj(m.texture);
  if (texture) out.push(judge("texture", texture));
  const coverage = obj(m.coverage);
  if (coverage) out.push(coverageOutcome(coverage));
  const symmetry = obj(m.symmetry);
  if (symmetry) out.push(symmetryOutcome(symmetry));
  const grains = obj(m.grains);
  if (grains) out.push(grainOutcome(grains));
  return out;
}
