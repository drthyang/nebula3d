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
//
// The record is rewritten after every run, so a run cut short keeps what it measured.

import { describe, it } from "vitest";

import { fetchDatasets } from "../../api/client";
import { configOf } from "../../state/configMemory";
import { usePipelineStore } from "../../state/pipelineStore";
import { MAX_TOOL_ROUNDS, runAgent, type AgentProgress } from "../agent";
import { loadPipelineContext } from "../context/loadContext";
import { buildChatMessages } from "../prompts/templates";
import { contextWarning, loadedContext } from "../provider/client";
import { CHAT_TOOLS } from "../tools";
import { backendUrl, env, exists, makeDir, readText, useBackend, writeText } from "./backend";
import { installEventSource } from "./eventSource";
import { OfferRecorder } from "./offers";
import { candidateFindings, renderTranscript, type Finding } from "./findings";
import type { EvalRun } from "./harness";
import {
  ARMS,
  armSetup,
  buildRecord,
  caseNamed,
  changedElsewhere,
  TASK,
  validationDatasets,
  WhyTracker,
  type Arm,
  type RunRecord,
  type Split,
} from "./validation";
import { costOf, modelNamed, paidRunGate, plan, SpendTracker } from "./validationModels";

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
    // LM Studio reports the context a model is loaded with; a model loaded with less
    // than the tools need would be cut off and graded for it.
    const context = await loadedContext(baseUrl, model.model);
    if (context && (context.loaded ?? 0) < model.contextTokens) {
      throw new Error(contextWarning(context, model.model) ?? `${model.model} is not loaded with ${model.contextTokens} tokens of context`);
    }
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
        model: { key: model.key, label: model.label, provider: model.provider, model: model.model, local: model.local, context_tokens: model.contextTokens },
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
      const dataset = datasets.find((d) => d.stem === job.stem)!;

      // Every run starts from the defaults, and sees its own dataset alone: another
      // run's volume (or the control's) in compare_datasets would answer for it.
      usePipelineStore.getState().patch(configOf(usePipelineStore.getInitialState()));
      const { context: pipelineContext } = await loadPipelineContext(dataset);
      const setup = armSetup(job.arm, CHAT_TOOLS, buildChatMessages(pipelineContext, [], TASK, null, { tools: true }));
      const before = await fetchDatasets();

      const why = new WhyTracker();
      let progress: AgentProgress = { content: "", reasoning: "", steps: [] };
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), minutes * 60_000);
      let giveUp: ReturnType<typeof setTimeout> | undefined;
      // The abort stops the model's stream; a tool waiting on the backend may not hear
      // it, so the run is also given up a minute later, with the steps it had.
      const stalled = new Promise<never>((_, reject) => {
        giveUp = setTimeout(() => reject(new Error(`timed out after ${minutes} min`)), (minutes + 1) * 60_000);
      });
      // What goes over the wire to the model, request by request: the tools it was offered.
      const recorder = new OfferRecorder();
      const stopRecording = recorder.install();
      const t0 = performance.now();
      const startedAt = new Date().toISOString();
      let evalRun: EvalRun;
      try {
        const result = await Promise.race([
          runAgent({
            messages: setup.messages,
            tools: setup.tools,
            ctx: { dataset, datasets: [dataset], skillsRead: setup.skillsRead },
            settings: { baseUrl, model: model.model, apiKey, temperature: model.temperature ?? 0.2, attachImages: false, useTools: true, followViews: false },
            signal: abort.signal,
            usage: true,
            maxRounds: rounds,
            onProgress: (p) => {
              progress = p;
              why.update(p);
            },
          }),
          stalled,
        ]);
        why.update(result);
        evalRun = { scenario: job.case.id, steps: result.steps, content: result.content, note: result.note, failure: result.failure ?? null, latencyMs: performance.now() - t0, usage: result.usage ?? null, verdict: result.verdict ?? null };
      } catch (e) {
        why.update(progress);
        const error = abort.signal.aborted ? `timed out after ${minutes} min` : (e as Error).message;
        evalRun = { scenario: job.case.id, steps: progress.steps, content: progress.content, error, latencyMs: performance.now() - t0, usage: null };
      }
      clearTimeout(timer);
      clearTimeout(giveUp);
      abort.abort(); // lets go of anything still waiting on this run
      stopRecording();

      const elsewhere = changedElsewhere(before, await fetchDatasets(), dataset.id);
      const costUsd = costOf(evalRun.usage, model.price);
      if (tracker) {
        tracker.record({ case: job.case.id, arm: job.arm, run: job.run, usd: costUsd });
        await writeText(ledgerUrl, `${JSON.stringify(tracker.toJSON(), null, 1)}\n`);
      }
      const record = buildRecord({
        case: job.case,
        arm: job.arm,
        run: job.run,
        dataset,
        model: { key: model.key, label: model.label, provider: model.provider, model: model.model, local: model.local },
        evalRun,
        why: why.why,
        maxRounds: rounds,
        started: startedAt,
        costUsd,
        elsewhere,
        offers: recorder.offers,
      });
      records.push(record);
      await writeText(new URL(transcriptName(record), transcripts), renderTranscript(record, candidateFindings(record, job.case)));
      await save(false);
      const g = record.grades;
      console.log(
        `${job.case.id} ${job.arm}${job.run}: ${(record.latency_ms / 1000).toFixed(0)} s, ${record.decisions.length} steps, ` +
          `reported ${g.detected === null ? "n/a" : g.detected ? "yes" : "no"}, false alarms ${g.noFalseAlarm ? 0 : "yes"}, unsafe ${g.unsafe.length}` +
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
