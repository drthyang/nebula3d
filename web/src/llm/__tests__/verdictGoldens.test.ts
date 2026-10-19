// Characterisation goldens of the verdicts, taken before the check-verdict
// module (web/src/llm/verdicts/) moved them: the verdict on a reply's run
// ({{achieved}}), the answer checks' contradictions and their reading of a
// claimed success, and the report's checks and goal. Over the synthetic grid
// (verdictGrid.ts) and the replay fixtures of the dev and eval scenarios
// (evals/fixtures: validation-dev.json, heldout.json, hex90k.json). The code
// must reproduce them exactly; a disagreement the module keeps is in them as
// it was.
//
// hex90k.json was recorded on a measured dataset, so its outputs are kept as a
// digest only: nothing measured is written here.
//
// Taken with `npx vitest run src/llm/__tests__/verdictGoldens.test.ts` on a
// tree without the golden file (commit 1 of the module's PR). A diff here is a
// changed verdict: update it only in a PR that means to change one (a 2.4
// unification), and say which entries moved and why.

import { describe, expect, it } from "vitest";

import type { AgentStep } from "../agent";
import { contradictions, overallContradiction } from "../answerChecks";
import heldout from "../evals/fixtures/heldout.json";
import hex90k from "../evals/fixtures/hex90k.json";
import dev from "../evals/fixtures/validation-dev.json";
import { buildReport, type Measured } from "../report/report";
import { computedVerdict } from "../verdict";
import { CLAIMS, rerun, replyCases, reportCases, step, SUCCESS } from "./verdictGrid";

const GOLDEN = "./__goldens__/verdicts.json";

type Obj = Record<string, unknown>;

/** What a reply's verdicts are: the run's verdict, the claims the answer checks contradict, and a claimed success. */
function replyOutputs(steps: readonly AgentStep[]): Obj {
  const verdict = computedVerdict(steps);
  const success = overallContradiction(SUCCESS, verdict);
  return {
    verdict,
    contradicted: Object.entries(CLAIMS)
      .filter(([, claim]) => contradictions(claim, steps).length > 0)
      .map(([id, claim]) => `${id}: ${contradictions(claim, steps).map((t) => t.id).join(", ")}`),
    // The words sent back, with the verdict's text (above) as {text}.
    success: verdict && success ? success.replace(verdict.text, "{text}") : success,
  };
}

/** What a report's verdicts are: each check's title, verdict and headline, and the goal. */
function reportOutputs(measured: Measured): Obj {
  const r = buildReport({
    created: new Date("2026-10-19T00:00:00Z"),
    question: "Assess the run",
    answer: "",
    steps: [{ tool: "assess_stage", summary: "", ok: true }],
    model: { provider: "Scripted", model: "scripted", local: true },
    dataset: { label: "synthetic", rawName: "synthetic.nxs", temperature: null },
    settings: [],
    sampleFacts: {},
    tuning: null,
    measured,
    figures: [],
  });
  return { achieved: r.achieved, checks: r.checks.map((c) => [c.title, c.verdict, c.headline]) };
}

interface Fixture {
  results: Record<string, string | string[]>;
}

/** A fixture's recorded results by dataset, in the fixture's order, as done steps. */
function fixtureSteps(f: Fixture): Map<string, AgentStep[]> {
  const out = new Map<string, AgentStep[]>();
  for (const [key, recorded] of Object.entries(f.results)) {
    const [dataset, tool, args] = key.split("|");
    const steps = out.get(dataset) ?? [];
    for (const text of Array.isArray(recorded) ? recorded : [recorded]) steps.push(step(tool, text, JSON.parse(args) as Obj));
    out.set(dataset, steps);
  }
  return out;
}

const parsed = (s: AgentStep): Obj | null => {
  try {
    const r: unknown = JSON.parse(s.result ?? "");
    return r && typeof r === "object" && !Array.isArray(r) ? (r as Obj) : null;
  } catch {
    return null;
  }
};

/** A report's measurements from a dataset's recorded results: the newest of each. */
function measuredFrom(steps: readonly AgentStep[]): Measured {
  const newest = (tool: string): Obj | null => steps.filter((s) => s.name === tool).map(parsed).filter((r) => r).pop() ?? null;
  const stage = (k: string): Obj | null => {
    const found = steps.filter((s) => s.name === "assess_stage").map(parsed).map((r) => r?.[k] as Obj | undefined).filter((m) => m && typeof m === "object" && !("missing" in m));
    return (found.pop() as Obj | undefined) ?? null;
  };
  return {
    rings: stage("rings"),
    punch: stage("punch"),
    backfill: stage("backfill"),
    flatten: stage("flatten"),
    pdf: stage("pdf"),
    texture: newest("texture_check"),
    coverage: newest("qmax_coverage"),
    symmetry: newest("symmetry_check"),
    grains: newest("grain_check"),
  };
}

/** Each dataset's replies (every result, each alone, and all before a rerun) and report. */
function fixtureOutputs(name: string, f: Fixture): [string, Obj][] {
  const out: [string, Obj][] = [];
  for (const [dataset, steps] of fixtureSteps(f)) {
    const at = `${name} ${dataset}`;
    out.push([`reply: ${at}, every result`, replyOutputs(steps)]);
    steps.forEach((s, i) => out.push([`reply: ${at}, result ${i + 1} (${s.name} ${JSON.stringify(s.args)}) alone`, replyOutputs([s])]));
    out.push([`reply: ${at}, every result, then a rerun from the flatten`, replyOutputs([...steps, rerun({ rings: "reused", punch: "reused", backfill: "reused", flatten: "computed", pdf: "computed" })])]);
    out.push([`report: ${at}`, reportOutputs(measuredFrom(steps))]);
  }
  return out;
}

async function digest(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("the verdicts, as before the check-verdict module", () => {
  it("reproduce the goldens over the grid and the replay fixtures", async () => {
    const entries: [string, unknown][] = [
      ...replyCases().map(({ id, steps }) => [`reply: ${id}`, replyOutputs(steps)] as [string, unknown]),
      ...reportCases().map(({ id, measured }) => [`report: ${id}`, reportOutputs(measured)] as [string, unknown]),
      ...fixtureOutputs("validation-dev", dev as Fixture),
      ...fixtureOutputs("heldout", heldout as Fixture),
      // Recorded on a measured dataset: its outputs by digest only.
      ["hex90k (SHA-256 of its outputs)", await digest(JSON.stringify(fixtureOutputs("hex90k", hex90k as Fixture)))],
    ];
    const keys = entries.map(([k]) => k);
    expect(new Set(keys).size, "every case named once").toBe(keys.length);
    const text = `{\n${entries.map(([k, v]) => ` ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n")}\n}\n`;
    await expect(text).toMatchFileSnapshot(GOLDEN);
  });
});
