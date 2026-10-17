// The review's sweep (docs/pilot-review.md): every reading tool on every dev
// case of a served validation root, with no model, written to one JSON file a
// reviewer compares before and after a change to the tools. The dev split only:
// a dataset of a test case is refused. Skipped unless NEBULA_VALIDATION_SWEEP
// names the output file:
//
//   NEBULA_VALIDATION_SWEEP=/tmp/sweep.json NEBULA_EVAL_API=http://127.0.0.1:8011 \
//     npx vitest run src/llm/evals/validationSweep.test.ts
//
// The root is `python -m nebula3d.validation make --split dev`, each dataset run
// once (any settings; the sweep reads what is on disk).

import { describe, expect, it } from "vitest";

import { fetchDatasets } from "../../api/client";
import { configOf } from "../../state/configMemory";
import { usePipelineStore } from "../../state/pipelineStore";
import { CHAT_TOOLS, runToolCall } from "../tools";
import { env, useBackend, writeText } from "./backend";
import { caseOfDataset } from "./validation";

const out = env("NEBULA_VALIDATION_SWEEP");

/** The calls, in order: every reading tool a validation run's task needs. */
export const SWEEP_CALLS: { name: string; args: Record<string, unknown> }[] = [
  ...["rings", "punch", "backfill", "flatten", "pdf"].map((stage) => ({ name: "assess_stage", args: { stage } })),
  { name: "texture_check", args: {} },
  { name: "qmax_coverage", args: {} },
  { name: "ub_check", args: {} },
  { name: "consistency_details", args: {} },
  { name: "symmetry_check", args: {} },
  { name: "dpdf_contrast", args: {} },
  { name: "dpdf_peaks", args: {} },
];

describe.skipIf(!out)("the dev sweep", () => {
  it("runs every reading tool on every dev dataset", async () => {
    useBackend();
    const datasets = await fetchDatasets();
    const rows: Record<string, unknown>[] = [];
    for (const dataset of datasets) {
      const of = caseOfDataset(dataset.id);
      if (!of) continue;
      expect(of.case.split, `${dataset.id} is a test case: the sweep reads dev only`).toBe("dev");
      usePipelineStore.getState().patch(configOf(usePipelineStore.getInitialState()));
      const results: Record<string, unknown> = {};
      for (const call of SWEEP_CALLS) {
        if (!CHAT_TOOLS.some((t) => t.name === call.name)) continue;
        const run = await runToolCall(
          { id: call.name, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } },
          CHAT_TOOLS,
          { dataset, datasets: [dataset] },
        );
        const key = call.name === "assess_stage" ? `assess_stage:${String(call.args.stage)}` : call.name;
        results[key] = { ok: run.ok, summary: run.summary, result: run.ok ? JSON.parse(run.full ?? run.text) : run.text };
      }
      rows.push({ case: of.case.id, arm: of.arm, run: of.run, dataset: dataset.id, results });
      console.log(`${of.case.id} ${of.arm}${of.run}: done`);
    }
    expect(rows.length).toBeGreaterThan(0);
    await writeText(new URL(`file://${out}`), JSON.stringify({ swept: new Date().toISOString(), rows }, null, 1) + "\n");
  }, 1_800_000);
});
