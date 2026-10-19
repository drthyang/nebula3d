// The word-reading adapter: the outcomes a recorded step's result holds, for
// results that carry their words and numbers only (recorded replies, the
// validation's records, a reply whose tools were replayed). Reached only from
// readers.ts. Each tool's mapping reads its words where its tool writes a
// verdict, and judges its numbers by the check's rule where it writes none.

import type { AgentStep } from "../agent";
import { OPEN_WEIGHT_OK } from "../metrics/coverage";
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
  if ("missing" in m) return outcome(stage, "info", ["no output"], null);
  const judged = judge(stage, m);
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
 * reach inside full coverage passes with that reason, which the answer checks
 * do not take as settling anything (D1). D10: "past", "unmeasured" and
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

/** The outcomes a step holds, read from its recorded result: none for an error, a step still running or a result that does not parse. */
export function outcomesOf(step: AgentStep): Outcome[] {
  const r = resultOf(step);
  if (!r) return [];
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
