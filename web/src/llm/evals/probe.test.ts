// Records what the tools read on the eval datasets, for the CI replay: the
// pipeline context the chat panel opens with, and each scripted tool call's
// result as the model reads it.  Needs the backend with the eval datasets;
// skipped unless NEBULA_EVAL_PROBE=1:
//
//   NEBULA_EVAL_PROBE=1 NEBULA_EVAL_API=http://127.0.0.1:8000 npx vitest run src/llm/evals/probe.test.ts

import { describe, expect, it } from "vitest";

import { fetchDatasets } from "../../api/client";
import type { Dataset } from "../../api/types";
import { usePipelineStore } from "../../state/pipelineStore";
import { loadPipelineContext } from "../context/loadContext";
import { CHAT_TOOLS, runToolCall } from "../tools";
import { env, useBackend, writeText } from "./backend";
import { pickDataset } from "./harness";
import { FIXTURE_CALLS, HEX_CONFIG } from "./scenarios";

const probe = env("NEBULA_EVAL_PROBE") === "1";

describe.skipIf(!probe)("record the eval fixtures", () => {
  it("reads the context and every scripted tool call", async () => {
    useBackend();
    const datasets = await fetchDatasets();
    usePipelineStore.getState().patch(HEX_CONFIG);
    const contexts: Record<string, unknown> = {};
    const results: Record<string, string> = {};
    const neutral: Dataset[] = [];
    // The fixtures are committed: each dataset's file name and id become a
    // neutral label (sample-90K-<suffix>), so no sample is named.
    const renames: [string, string][] = [];
    for (const suffix of Object.keys(FIXTURE_CALLS)) {
      const d = pickDataset(datasets, suffix);
      const id = `sample-90K-${suffix}`;
      renames.push([d.raw_name, `${suffix}.nxs`], [d.stem, suffix], [d.id, id]);
      neutral.push({ ...d, id, raw_name: `${suffix}.nxs`, stem: suffix,
        stages: d.stages.map((st) => ({ ...st, volume_id: `${id}.${st.name}` })) });
    }
    const scrub = (text: string) => renames.reduce((t, [a, b]) => t.split(a).join(b), text);
    for (const [suffix, calls] of Object.entries(FIXTURE_CALLS)) {
      const dataset = pickDataset(datasets, suffix);
      contexts[suffix] = JSON.parse(scrub(JSON.stringify((await loadPipelineContext(dataset)).context)));
      for (const call of calls) {
        const key = `${suffix}|${call.name}|${JSON.stringify(call.args)}`;
        const run = await runToolCall(
          { id: key, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } },
          CHAT_TOOLS,
          { dataset, datasets },
        );
        expect(run.ok, `${key}: ${run.text}`).toBe(true);
        results[key] = scrub(run.text);
        console.log(`${key}\n  ${run.summary}\n  ${run.text.slice(0, 600)}\n`);
      }
    }
    const out = new URL("./fixtures/hex90k.json", import.meta.url);
    const fixture = { recorded: new Date().toISOString().slice(0, 10), datasets: neutral, contexts, results };
    await writeText(out, JSON.stringify(fixture, null, 1) + "\n");
  }, 600_000);
});
