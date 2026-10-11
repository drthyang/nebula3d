// Records what the tools read on the held-out datasets, for their CI replay:
// the pipeline context the chat panel opens with, and each scripted tool
// call's result as the model reads it. The volumes are synthetic
// (examples/make_eval_volumes.py), so nothing needs scrubbing. Needs a backend
// serving them; skipped unless NEBULA_EVAL_PROBE_HELDOUT=1:
//
//   NEBULA_EVAL_PROBE_HELDOUT=1 NEBULA_EVAL_API=http://127.0.0.1:8002 npx vitest run src/llm/evals/heldoutProbe.test.ts

import { describe, expect, it } from "vitest";

import { fetchDatasets } from "../../api/client";
import type { Dataset } from "../../api/types";
import { configOf } from "../../state/configMemory";
import { usePipelineStore } from "../../state/pipelineStore";
import { loadPipelineContext } from "../context/loadContext";
import { CHAT_TOOLS, runToolCall } from "../tools";
import { env, useBackend, writeText } from "./backend";
import { pickDataset } from "./harness";
import { HELDOUT_CALLS } from "./heldout";

const probe = env("NEBULA_EVAL_PROBE_HELDOUT") === "1";

describe.skipIf(!probe)("record the held-out fixtures", () => {
  it("reads the context and every scripted tool call", async () => {
    useBackend();
    const datasets = await fetchDatasets();
    const contexts: Record<string, unknown> = {};
    const results: Record<string, string> = {};
    const used: Dataset[] = [];
    for (const [suffix, calls] of Object.entries(HELDOUT_CALLS)) {
      const dataset = pickDataset(datasets, suffix);
      used.push(dataset);
      usePipelineStore.getState().patch(configOf(usePipelineStore.getInitialState())); // the defaults it was run with
      contexts[suffix] = (await loadPipelineContext(dataset)).context;
      for (const call of calls) {
        const key = `${suffix}|${call.name}|${JSON.stringify(call.args)}`;
        const run = await runToolCall(
          { id: key, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } },
          CHAT_TOOLS,
          { dataset, datasets },
        );
        expect(run.ok, `${key}: ${run.text}`).toBe(true);
        results[key] = run.text;
        console.log(`${key}\n  ${run.summary}\n  ${run.text.slice(0, 600)}\n`);
      }
    }
    const fixture = { recorded: new Date().toISOString().slice(0, 10), datasets: used, contexts, results };
    await writeText(new URL("./fixtures/heldout.json", import.meta.url), JSON.stringify(fixture, null, 1) + "\n");
  }, 600_000);
});
