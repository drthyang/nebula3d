// The dev corpus of answers: what the graders and the answer checks are
// characterised on (answerTextGoldens.test.ts). Nothing in it is held out:
//
// - the canned answers the validation's tests grade on the dev cases
//   (validation.test.ts), copied here as they read when the goldens were taken;
// - the scripted replays' answers (replays.ts), good and bad, each with the run
//   it ended;
// - the answers of the scenario records in docs/evals/results/ (121 runs wrote
//   one; the rest ended in an error), each with its own run's steps. The
//   records name no sample (scrub.ts); what they measured is never written out
//   of them: the goldens keep booleans and digests.

import { readText } from "./backend";
import { runOfRecord, type EvalRun, type RecordedRun, type Scenario } from "./harness";
import { replay, REPLAYS } from "./replays";
import { SCENARIOS } from "./scenarios";

export interface CorpusAnswer {
  id: string; // stable: where it comes from, never what it says
  text: string;
  run: EvalRun; // the run that wrote it: its steps, note and error
  scenario: Scenario | null; // the scenario it answered, whose checks grade it too; null: a canned answer
}

/** The canned answers of validation.test.ts, graded there on the dev cases, each once, in their order there. */
export const CANNED_DEV_ANSWERS: readonly string[] = [
  "The UB is turned by about 0.62° (ub_check). No setting fixes it; the sample must be re-indexed.",
  "The UB is right and the data are clean.",
  "The orientation is off by 2.4°.",
  "",
  "The origin is shifted by (0.03, 0.02, 0).",
  "The UB is wrong by 0.4°.",
  "The UB is not wrong; the origin is offset.",
  "Powder rings are present at 2.2 Å⁻¹.",
  "The shell at 2.9 Å⁻¹ is the crystal's own diffuse scattering; no powder ring.",
  "A powder ring was found at 2.9 Å⁻¹.",
  "Powder rings at 2.2 and 4.05 Å⁻¹ were removed. The 2.9 Å⁻¹ shell is the crystal's own.",
  "Powder rings at 2.2 and 4.05 Å⁻¹ were found and removed.",
  "Powder rings were found at 2.2 Å⁻¹.",
  "The counts end at 4.5 Å⁻¹, so the data are incomplete beyond that.",
  "The counts end at 6 Å⁻¹, so the data are incomplete beyond that.",
  "The UB is turned by 0.6°; no setting fixes it.",
  "The UB is not turned; the data are fine at 0.6 Å⁻¹.",
  "The UB is correct (turned 0.001°).",
  "The UB refinement turned 0.03° at most, which is negligible.",
  "Powder-ring removal ran with the defaults, and no rings were found.",
  "The ring stage confirmed 0 rings.",
  "The counts end at 6.4 Å⁻¹, the box's faces.",
  "The window puts 5.6e-4 of its weight on unmeasured space, which is clean.",
  "I turned on the flatten's Q² term.",
  "The counts end well inside the box, so the coverage is incomplete.",
  "The background rises with |Q|.",
  "Aluminium rings are present at 2.7 Å⁻¹.",
  "The background rises with |Q|, so I turned on the flatten's Q² term.",
  "I found no problem with the data.",
  "The UB is turned by 1°.",
  "The UB is turned by 0.61° and a is 3.9 Å. There are 7777 voxels.",
  "The last node is offset by 0.777.",
  "The UB is turned by {{ub_check.angle_deg}}°; the last node is offset by 0.777.",
  "The UB is turned by 0.61° (ub_check). No setting fixes it.",
  "No fault found.",
];

/** The scenario records whose answers are in the corpus: every one in docs/evals/results/. */
export const RESULT_RECORDS = [
  "claude-haiku-5-5-pilot",
  "claude-haiku-5-5",
  "claude-sonnet-5-5",
  "lmstudio-qwen3.8-27b",
  "ollama-gemma4-26b",
  "ollama-qwen3-32b",
] as const;

const RESULTS = new URL("../../../../docs/evals/results/", import.meta.url); // evals → llm → src → web → the checkout

const two = (n: number): string => String(n).padStart(2, "0");

/** A canned answer as the run that wrote it: no steps, as validation.test.ts grades it. */
const cannedRun = (text: string): EvalRun => ({ scenario: "canned", steps: [], content: text, latencyMs: 0, usage: null });

/** The scenario records' runs that wrote an answer, each with its own run. */
export async function recordAnswers(): Promise<CorpusAnswer[]> {
  const out: CorpusAnswer[] = [];
  for (const name of RESULT_RECORDS) {
    const record = JSON.parse(await readText(new URL(`${name}.json`, RESULTS))) as { runs: RecordedRun[] };
    record.runs.forEach((r, i) => {
      if (!r.answer) return;
      out.push({ id: `${name} run ${two(i + 1)} (${r.scenario})`, text: r.answer, run: runOfRecord(r), scenario: SCENARIOS.find((s) => s.id === r.scenario) ?? null });
    });
  }
  return out;
}

/** The scripted replays' answers, good and bad, each as its run ended. */
export async function replayAnswers(): Promise<CorpusAnswer[]> {
  const out: CorpusAnswer[] = [];
  for (const scenario of SCENARIOS) {
    for (const kind of ["good", "bad"] as const) {
      const { result } = await replay(scenario, REPLAYS[scenario.id][kind]);
      out.push({ id: `replay ${scenario.id} ${kind}`, text: result.run.content, run: result.run, scenario });
    }
  }
  return out;
}

/** The whole dev corpus: the canned answers, the replays' and the records'. */
export async function answerCorpus(): Promise<CorpusAnswer[]> {
  const canned = CANNED_DEV_ANSWERS.map((text, i): CorpusAnswer => ({ id: `canned ${two(i + 1)}`, text, run: cannedRun(text), scenario: null }));
  return [...canned, ...(await replayAnswers()), ...(await recordAnswers())];
}
