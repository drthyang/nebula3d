// The graders.  Each check is a predicate over one run: what the model called
// (a call counts only when it ran without error) and what it wrote.  Numbers
// the answer must quote are read from the tool results in the same run, so a
// check stays true to the measurement, not to a value written here.  Text is
// judged sentence by sentence, and a sentence that negates (no, not, never,
// without, …) does not count as asserting what it mentions.

import type { AgentStep } from "../agent";
import type { Check, EvalRun } from "./harness";

const ok = (detail: string) => ({ pass: true, detail });
const fail = (detail: string) => ({ pass: false, detail });

const NEGATION = /\b(no|not|never|none|nothing|nowhere|neither|nor|without|cannot|isn't|aren't|wasn't|weren't|doesn't|don't|didn't|won't|shouldn't|wouldn't|lacks?)\b|n't\b/i;

/** The tool calls of *name* that ran without error. */
export const calls = (run: EvalRun, name: string): AgentStep[] =>
  run.steps.filter((s) => s.name === name && s.status === "done");

/** A step's result as the model read it (JSON), or null. */
export function result(step: AgentStep): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(step.result ?? "null");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The answer's sentences (lines and sentence ends split it). */
export function sentences(text: string): string[] {
  return text
    .replace(/\*\*|__|`/g, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const SUPERSCRIPT: Record<string, string> = { "⁻": "-", "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };

/** Every number the text writes: decimals, exponents (1e-3, 1×10⁻³, 1 x 10^-3, LaTeX 1 \times 10^{-3}) and percentages as written. */
export function numbers(text: string): number[] {
  const flat = text
    .replace(/\$/g, "")
    .replace(/\\(times|cdot)/g, "×")
    .replace(/\^\{([^}]*)\}/g, "^$1")
    .replace(/[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => "^" + [...m].map((c) => SUPERSCRIPT[c]).join(""))
    .replace(/(\d)\s*[×x·]\s*10\s*\^?\s*\(?([-+−]?\d+)\)?/g, (_m, a, e) => `${a}e${String(e).replace("−", "-")}`)
    .replace(/−/g, "-");
  // A sign counts only where nothing alphanumeric precedes it: "0.55-16.7" is a range, not −16.7.
  return [...flat.matchAll(/(?<![\w)\]}.])[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?|\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi)]
    .map((m) => Number(m[0]))
    .filter(Number.isFinite);
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

/** Some sentence of the answer matches *re* without negating it. */
export function asserts(re: RegExp, what: string): Check {
  return {
    name: `says ${what}`,
    grade: (run) => {
      const hit = sentences(run.content).find((s) => re.test(s) && !NEGATION.test(s));
      return hit ? ok(`“${hit.slice(0, 160)}”`) : fail(`no sentence says ${what}`);
    },
  };
}

/** Some sentence matches *re*, negated or not (for answers whose claim is a negation). */
export function mentions(re: RegExp, what: string): Check {
  return {
    name: `says ${what}`,
    grade: (run) => {
      const hit = sentences(run.content).find((s) => re.test(s));
      return hit ? ok(`“${hit.slice(0, 160)}”`) : fail(`no sentence says ${what}`);
    },
  };
}

/** No sentence asserts *re* (one that negates it is fine). */
export function neverAsserts(re: RegExp, what: string): Check {
  return {
    name: `never claims ${what}`,
    grade: (run) => {
      const hit = sentences(run.content).find((s) => re.test(s) && !NEGATION.test(s));
      return hit ? fail(`“${hit.slice(0, 160)}”`) : ok("not claimed");
    },
  };
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
  return {
    name: `quotes ${what}`,
    grade: (run) => {
      const want = pick(run);
      if (want == null || !Number.isFinite(want)) return fail(`no ${what} in the tool results to compare with`);
      const near = (x: number) => Math.abs(x - want) <= (relative ? tol * Math.abs(want) : tol);
      const hit = numbers(run.content).find(near);
      return hit !== undefined ? ok(`wrote ${hit} (measured ${want})`) : fail(`no number within ${relative ? `${tol * 100} %` : tol} of ${want}`);
    },
  };
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
