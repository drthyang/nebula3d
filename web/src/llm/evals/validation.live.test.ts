// The validation's live arms, B (the Pilot with its skills) and C (without),
// on one model, against a backend that serves the data root
// `python -m nebula3d.validation make` fills. Skipped unless NEBULA_VALIDATION=1,
// so CI never runs it, and a paid model also needs its cap typed (see
// validationModels.ts). docs/evals.md has the whole procedure:
//
//   NEBULA_VALIDATION=1 NEBULA_VALIDATION_MODEL=lmstudio-qwen3.8-27b NEBULA_EVAL_API=http://127.0.0.1:8000 \
//     npx vitest run src/llm/evals/validation.live.test.ts
//
// NEBULA_VALIDATION_MODEL   a key of MODELS (validationModels.ts)
// NEBULA_VALIDATION_SPLIT   dev (default) or test; test needs NEBULA_VALIDATION_REPORT=1
// NEBULA_VALIDATION_ARMS    B,C (default)
// NEBULA_VALIDATION_ONLY    case ids, comma-separated (default all of the split)
// NEBULA_VALIDATION_RUNS    runs per case and arm (default 3)
// NEBULA_VALIDATION_ROUNDS  rounds of tool calls per run (default the Pilot's own, 12)
// NEBULA_VALIDATION_TIMEOUT minutes per run (default 40)
// NEBULA_VALIDATION_OUT     where the record and the transcripts go (default ../docs/evals/validation)
// NEBULA_VALIDATION_BASE_URL  the model server, where it is not the model's usual one
// NEBULA_VALIDATION_ALLOW_SPEND  a paid model's cap in dollars, to approve spending up to it
// NEBULA_VALIDATION_RENDER  a scored record to write the transcripts and findings of again
// NEBULA_VALIDATION_REGRADE a record to grade again with the current graders, in place: each
//                           run's words from its conclusion and decisions, its unsafe actions
//                           as counted, and a run that names no unsafe rule marked "counted
//                           under the pre-#68 rule" (PRE_68_RULE), which the table leaves out;
//                           a test-split record needs NEBULA_VALIDATION_REPORT=1.
//                           Then `python -m nebula3d.validation summarize` rewrites its table,
//                           and NEBULA_VALIDATION_RENDER its transcripts.
//
// The record is rewritten after every run, so a run cut short keeps what it measured.
// Each run is runCase's (validationRun.ts), and starts fresh: it reads nothing an
// earlier run left in the app, and its record keeps the token calibration it
// started from.

import { describe, it } from "vitest";

import { fetchDatasets } from "../../api/client";
import { MAX_TOOL_ROUNDS } from "../agent";
import { backendUrl, env, exists, makeDir, readText, useBackend, writeText } from "./backend";
import { installEventSource } from "./eventSource";
import { candidateFindings, renderTranscript, type Finding } from "./findings";
import { ARMS, caseNamed, PRE_68_RULE, regradeRecord, validationDatasets, type Arm, type RunRecord, type Split } from "./validation";
import { modelNamed, paidRunGate, plan, runContext, SpendTracker } from "./validationModels";
import { runCase } from "./validationRun";

const live = env("NEBULA_VALIDATION") === "1";
const renderFrom = env("NEBULA_VALIDATION_RENDER");
const here = () => `file://${env("PWD") ?? ""}/`;
const list = (name: string): string[] =>
  (env(name) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const transcriptName = (r: Pick<RunRecord, "case" | "arm" | "run">) => `${r.case}_${r.arm}${r.run}.md`;

describe.skipIf(!live)("validation, live", () => {
  it("runs the plan on one model", async () => {
    const model = modelNamed(env("NEBULA_VALIDATION_MODEL") ?? "");
    const gate = paidRunGate(model, env("NEBULA_VALIDATION_ALLOW_SPEND"));
    if (gate) throw new Error(gate);
    const split = (env("NEBULA_VALIDATION_SPLIT") ?? "dev") as Split;
    const arms = (list("NEBULA_VALIDATION_ARMS").length ? list("NEBULA_VALIDATION_ARMS") : ["B", "C"]) as Arm[];
    for (const a of arms) if (!ARMS.includes(a)) throw new Error(`arm ${a} is not one of ${ARMS.join(", ")}`);
    const runs = Number(env("NEBULA_VALIDATION_RUNS") ?? model.runsPerCase);
    const rounds = Number(env("NEBULA_VALIDATION_ROUNDS") ?? MAX_TOOL_ROUNDS);
    const minutes = Number(env("NEBULA_VALIDATION_TIMEOUT") ?? 40);
    const jobs = plan(model, split, { report: env("NEBULA_VALIDATION_REPORT") === "1", arms, only: list("NEBULA_VALIDATION_ONLY"), runs });
    const baseUrl = env("NEBULA_VALIDATION_BASE_URL") ?? model.baseUrl;
    const apiKey = model.apiKeyEnv ? (env(model.apiKeyEnv) ?? "") : "";
    if (model.apiKeyEnv && !apiKey) throw new Error(`set ${model.apiKeyEnv}`);

    useBackend();
    installEventSource();
    // The run policy's minimum context for a local live run (RUN_POLICY): a model
    // whose window is under it would have the skills it read cut to stubs and be
    // graded for it, so the plan does not start.
    const context = await runContext(model, baseUrl);
    if (context.refusal) throw new Error(context.refusal);
    const datasets = validationDatasets(await fetchDatasets());
    // Before an hour of runs: every dataset the plan needs is there.
    const missing = jobs.filter((j) => !datasets.some((d) => d.stem === j.stem)).map((j) => j.stem);
    if (missing.length) {
      throw new Error(`the backend serves no dataset ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? `, and ${missing.length - 3} more` : ""}: run \`python -m nebula3d.validation make\` for this split, these arms and this many runs`);
    }

    const out = env("NEBULA_VALIDATION_OUT") ?? "../docs/evals/validation";
    const dir = new URL(`${out.replace(/\/$/, "")}/`, here());
    const transcripts = new URL(`${model.key}-${split}/`, dir);
    await makeDir(transcripts);
    const recordUrl = new URL(`${model.key}-${split}.json`, dir);
    const ledgerUrl = new URL(`.spend-${model.key}.json`, dir);
    const tracker =
      model.spendCapUsd === null
        ? null
        : SpendTracker.fromJSON((await exists(ledgerUrl)) ? JSON.parse(await readText(ledgerUrl)) : null, model.spendCapUsd);

    const records: RunRecord[] = [];
    const started = new Date().toISOString();
    const save = async (complete: boolean) => {
      const record = {
        schema: "nebula3d-validation/1",
        model: {
          key: model.key,
          label: model.label,
          provider: model.provider,
          model: model.model,
          local: model.local,
          context_tokens: model.contextTokens,
          min_context_tokens: model.minContextTokens,
        },
        split,
        arms,
        runs_per_case: runs,
        max_rounds: rounds,
        timeout_minutes: minutes,
        started,
        complete,
        backend: backendUrl(),
        spend: tracker ? tracker.toJSON() : null,
        runs: records,
      };
      await writeText(recordUrl, `${JSON.stringify(record, null, 1)}\n`);
    };

    for (const job of jobs) {
      const refusal = tracker?.refusal();
      if (refusal) {
        console.log(`stopped before ${job.stem}: ${refusal}`);
        break;
      }
      // Read again before each run, which records it: LM Studio may have unloaded
      // the model and loaded it again with its defaults.
      const runWindow = await runContext(model, baseUrl);
      if (runWindow.refusal) {
        await save(false);
        throw new Error(`stopped before ${job.stem}: ${runWindow.refusal}`);
      }
      const dataset = datasets.find((d) => d.stem === job.stem)!;

      // The run starts fresh (validationRun.ts: nothing an earlier run left in the
      // app is read), from the defaults, and sees its own dataset alone: another
      // run's volume (or the control's) in compare_datasets would answer for it.
      let record: RunRecord;
      try {
        record = await runCase({
          job,
          dataset,
          model: { key: model.key, label: model.label, provider: model.provider, model: model.model, local: model.local },
          // The model's temperature, null where it takes none (Claude): none is sent,
          // and the record's run_policy says so (validationPolicy).
          settings: { baseUrl, model: model.model, apiKey, temperature: model.temperature },
          rounds,
          minutes,
          price: model.price,
          context: { tokens: runWindow.tokens, min_tokens: runWindow.min_tokens, read_from: runWindow.read_from },
        });
      } catch (e) {
        // It could not start (a pipeline or tuning run the run before left going
        // did not end, or the backend failed): the record keeps the runs so far.
        await save(false);
        throw new Error(`stopped before ${job.stem}: ${(e as Error).message}`);
      }
      if (tracker) {
        tracker.record({ case: job.case.id, arm: job.arm, run: job.run, usd: record.cost_usd });
        await writeText(ledgerUrl, `${JSON.stringify(tracker.toJSON(), null, 1)}\n`);
      }
      const costUsd = record.cost_usd;
      records.push(record);
      await writeText(new URL(transcriptName(record), transcripts), renderTranscript(record, candidateFindings(record, job.case)));
      await save(false);
      const g = record.grades;
      console.log(
        `${job.case.id} ${job.arm}${job.run}: ${(record.latency_ms / 1000).toFixed(0)} s, ${record.decisions.length} steps, ` +
          `reported ${g.detected === null ? "n/a" : g.detected ? "yes" : "no"}, false alarms ${g.noFalseAlarm ? 0 : "yes"}, unsafe ${g.unsafe.length}` +
          `${g.disputes?.length ? `, disputed ${g.disputes.length}` : ""}` +
          `${record.truncated?.requests.length ? `, CUT at the output cap: ${record.truncated.loop} of the loop's requests, ${record.truncated.tuning} of the tuning's` : ""}` +
          `${costUsd != null ? `, $${costUsd.toFixed(3)}` : ""}${record.error ? `, ERROR ${record.error}` : ""}`,
      );
    }
    await save(true);
    console.log(`${records.length} of ${jobs.length} runs. Score them: python -m nebula3d.validation score --root <data root> --record ${out}/${model.key}-${split}.json${split === "test" ? " --report" : ""}`);
  }, 8 * 3600_000);
});

// Writes the transcripts and the candidate findings of a scored record again
// (`score` merged the outputs' grades into it).
describe.skipIf(!renderFrom)("validation, transcripts", () => {
  it("renders a scored record", async () => {
    const url = new URL(renderFrom!, here());
    const record = JSON.parse(await readText(url)) as { runs: RunRecord[]; findings?: Finding[]; model: { key: string }; split: string };
    const folder = new URL(`${record.model.key}-${record.split}/`, url);
    await makeDir(folder);
    const findings: Finding[] = [];
    for (const run of record.runs) {
      const mine = candidateFindings(run, caseNamed(run.case)!);
      findings.push(...mine);
      await writeText(new URL(transcriptName(run), folder), renderTranscript(run, mine));
    }
    record.findings = findings;
    await writeText(url, `${JSON.stringify(record, null, 1)}\n`);
    console.log(`${record.runs.length} transcripts, ${findings.length} candidate findings`);
  });
});

// Grades a record's runs again with the current graders (NEBULA_VALIDATION_REGRADE=<record.json>,
// relative to the working directory), rewriting their grades in place. It prints counts only.
const regradeFrom = env("NEBULA_VALIDATION_REGRADE");

describe.skipIf(!regradeFrom)("validation, re-graded", () => {
  it("grades a record's runs again", async () => {
    const url = new URL(regradeFrom!, here());
    const record = JSON.parse(await readText(url)) as { split?: string; runs: RunRecord[] };
    const moved = regradeRecord(record, { report: env("NEBULA_VALIDATION_REPORT") === "1" });
    await writeText(url, `${JSON.stringify(record, null, 1)}\n`);
    const disputed = record.runs.reduce((n, r) => n + (r.grades.disputes?.length ?? 0), 0);
    const pre68 = record.runs.filter((r) => r.unsafe_rule === PRE_68_RULE).length;
    console.log(
      `${record.runs.length} runs graded again; the grades of ${moved} moved; ${disputed} check(s) disputed; ` +
        `${pre68} run(s) ${PRE_68_RULE}, left out of the table`,
    );
  });
});
