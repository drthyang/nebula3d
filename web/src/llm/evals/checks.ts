// The graders.  Each check is a predicate over one run: what the model called
// (a call counts only when it ran without error) and what it wrote.  Numbers
// the answer must quote are read from the tool results in the same run, so a
// check stays true to the measurement, not to a value written here.  Text is
// judged sentence by sentence, and a sentence that negates (no, not, never,
// without, …) does not count as asserting what it mentions. The answer's
// words are read through the graders' port (graderReading.ts).
//
// The graders read a result as the model read it (`seen`, readings/), and
// parse it here, apart from the app's own reading of the whole result
// (`found`): a field only the whole result holds was never shown to the model,
// and is not credited.

import type { AgentStep } from "../agent";
import { seen } from "../readings";
import { readCheck, type GradedSpan } from "./graderReading";
import type { Check, EvalRun } from "./harness";

const ok = (detail: string) => ({ pass: true, detail });
const fail = (detail: string) => ({ pass: false, detail });

/** The tool calls of *name* that ran without error. */
export const calls = (run: EvalRun, name: string): AgentStep[] =>
  run.steps.filter((s) => s.name === name && s.status === "done");

/** A step's result as the model read it (`seen`), parsed here as JSON, or null. */
export function result(step: AgentStep): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(seen(step) || "null");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The model called *name* (and, with *args*, with arguments it accepts). */
export function ran(name: string, args?: (a: Record<string, unknown>) => boolean, what = ""): Check {
  return {
    name: `calls ${name}${what ? ` ${what}` : ""}`,
    grade: (run) => {
      const hits = calls(run, name).filter((s) => !args || args(s.args));
      if (hits.length) return ok(`${hits.length} call(s)`);
      const tried = run.steps.filter((s) => s.name === name).map((s) => `${JSON.stringify(s.args)} ${s.status}`);
      return fail(tried.length ? `called, but not as needed: ${tried.join("; ")}` : `never called ${name}`);
    },
  };
}

/**
 * The skill was read (read_skill, no reference, without an error) before
 * *tool* first ran without an error: the skills' firm rule, held by the
 * executor; this check sees that it held.
 */
export function readSkillBefore(skill: string, tool: string): Check {
  return {
    name: `reads the ${skill} skill before ${tool}`,
    grade: (run) => {
      const done = (s: { status: string }) => s.status === "done";
      const read = run.steps.findIndex((s) => s.name === "read_skill" && done(s) && s.args.name === skill && s.args.reference === undefined);
      const acted = run.steps.findIndex((s) => s.name === tool && done(s));
      if (read < 0) return fail(`never read ${skill}`);
      if (acted >= 0 && acted < read) return fail(`${tool} ran before ${skill} was read`);
      return ok(acted >= 0 ? `read ${skill}, then ${tool}` : `read ${skill}`);
    },
  };
}

/** The model did not call *name* (with arguments *args* accepts, when given). */
export function didNotRun(name: string, args?: (a: Record<string, unknown>) => boolean, what = ""): Check {
  return {
    name: `does not call ${name}${what ? ` ${what}` : ""}`,
    grade: (run) => {
      const hits = run.steps.filter((s) => s.name === name && (!args || args(s.args)));
      return hits.length ? fail(`called it: ${hits.map((s) => JSON.stringify(s.args)).join("; ")}`) : ok("not called");
    },
  };
}

/**
 * A sentence that matches *re* and does not negate it (a leading "No,"
 * answers, it does not negate), and does not ask it: a question is no claim.
 */
const claims = (s: GradedSpan, re: RegExp): boolean => re.test(s.text) && !s.negated && !s.question;

/** Some sentence of the answer matches *re* without negating it, and not as a condition or a plan that opens it. */
export function asserts(re: RegExp, what: string): Check {
  return readCheck(`says ${what}`, (answer) => {
    const hit = answer.sentences.find((s) => claims(s, re) && !s.tentative);
    return hit ? ok(`“${hit.text.slice(0, 160)}”`) : fail(`no sentence says ${what}`);
  });
}

/** Some sentence matches *re*, negated or not (for answers whose claim is a negation); a question says nothing. */
export function mentions(re: RegExp, what: string): Check {
  return readCheck(`says ${what}`, (answer) => {
    const hit = answer.sentences.find((s) => re.test(s.text) && !s.question);
    return hit ? ok(`“${hit.text.slice(0, 160)}”`) : fail(`no sentence says ${what}`);
  });
}

/** No sentence asserts *re* (one that negates it is fine; no hedge excuses one that does not, W5). */
export function neverAsserts(re: RegExp, what: string): Check {
  return readCheck(`never claims ${what}`, (answer) => {
    const hit = answer.sentences.find((s) => claims(s, re));
    return hit ? fail(`“${hit.text.slice(0, 160)}”`) : ok("not claimed");
  });
}

/**
 * The answer writes a number within *tol* of the value *pick* reads from the
 * run's tool results (absolute, or relative with *relative*).
 */
export function quotes(
  what: string,
  pick: (run: EvalRun) => number | null,
  tol: number,
  { relative = false }: { relative?: boolean } = {},
): Check {
  return readCheck(`quotes ${what}`, (answer, run) => {
    const want = pick(run);
    if (want == null || !Number.isFinite(want)) return fail(`no ${what} in the tool results to compare with`);
    const near = (x: number) => Math.abs(x - want) <= (relative ? tol * Math.abs(want) : tol);
    const hit = answer.numbers.find(near);
    return hit !== undefined ? ok(`wrote ${hit} (measured ${want})`) : fail(`no number within ${relative ? `${tol * 100} %` : tol} of ${want}`);
  });
}

/** The answer is there: not empty, not cut off, not stopped by an error. */
export const answers: Check = {
  name: "answers",
  grade: (run) => {
    if (run.error) return fail(`error: ${run.error}`);
    if (!run.content.trim()) return fail("empty answer");
    if (run.note && /cut off|Stopped after/.test(run.note)) return fail(run.note);
    return ok(`${run.content.length} characters`);
  },
};

/** The last call of *tool*'s result, the value at *path* (a.b.c), as a number. */
export function measured(tool: string, path: string, args?: (a: Record<string, unknown>) => boolean): (run: EvalRun) => number | null {
  return (run) => {
    const steps = calls(run, tool).filter((s) => !args || args(s.args));
    for (const step of [...steps].reverse()) {
      let v: unknown = result(step);
      for (const key of path.split(".")) v = v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined;
      if (typeof v === "number" && Number.isFinite(v)) return v;
    }
    return null;
  };
}
