// Auto mode live on a local model (opt-in, never in CI): a whole auto run on
// dev cases built where the tests run (devData: the pipeline in Python
// through the CPython bridge), the model a real one on this machine. The
// smoke the controller's PR states (THY-65 PR 6); PR 7's B-auto eval builds
// on it. The harness skips every fact card (Skip), as that eval will.
//
//   NEBULA_AUTO_SMOKE=1 NEBULA_PYTHON=… npx vitest run --project replay src/llm/evals/devData/autoSmoke.replay.test.ts
//
// NEBULA_AUTO_SMOKE_MODEL (default gemma4:26b) on NEBULA_AUTO_SMOKE_URL
// (default Ollama's), NEBULA_AUTO_SMOKE_CASES (default dev-flatten,dev-control),
// a 30-minute cap over the whole smoke (the user's rule for a local run): each
// run's own working limit is cut to what the cap leaves, and no run starts
// with less than two minutes left. NEBULA_AUTO_SMOKE_OUT: a file for the
// record. Synthetic data only (the dev cases).

import { describe, expect, it } from "vitest";

import { clearDecisions, useDecisionStore } from "../../apply/decisions";
import { autoLoop, skipFact, startAuto } from "../../auto/controller";
import { useAutoStore } from "../../auto/store";
import { useChatStore } from "../../chatStore";
import { formatDuration } from "../../clock";
import { DEFAULT_SETTINGS, type LlmSettings } from "../../settings";
import { usageText } from "../../usage";
import { env, writeText } from "../backend";
import { devCase, type DevCaseId } from "./index";

const SMOKE = env("NEBULA_AUTO_SMOKE") === "1";
const CAP_MS = 30 * 60_000;
const CASES = (env("NEBULA_AUTO_SMOKE_CASES") ?? "dev-flatten,dev-control").split(",") as DevCaseId[];
const SETTINGS: LlmSettings = {
  ...DEFAULT_SETTINGS,
  baseUrl: env("NEBULA_AUTO_SMOKE_URL") ?? "http://localhost:11434/v1",
  model: env("NEBULA_AUTO_SMOKE_MODEL") ?? "gemma4:26b",
  followViews: false,
};
const started = Date.now();
const record: unknown[] = [];

describe.skipIf(!SMOKE)("auto mode, live on a local model (opt-in smoke)", () => {
  for (const id of CASES) {
    it(
      id,
      async () => {
        const left = CAP_MS - (Date.now() - started);
        if (left < 2 * 60_000) {
          record.push({ case: id, skipped: "the 30-minute cap" });
          return;
        }
        const dataset = await devCase(id).dataset();
        useChatStore.getState().clear();
        useChatStore.setState({ busy: false, live: null, clock: null });
        clearDecisions();
        useAutoStore.setState({ run: null });
        const t0 = Date.now();
        // Its own working limit: the default, cut to the cap left (the run then writes its report).
        const minutes = Math.max(10, Math.min(30, Math.floor((left - 3 * 60_000) / 60_000)));
        await startAuto({ ctx: { dataset, datasets: [dataset] }, settings: SETTINGS, limits: { minutes } });
        await (autoLoop() ?? Promise.resolve());
        const facts: string[] = [];
        while (useAutoStore.getState().run?.state === "paused" && Date.now() - started < CAP_MS) {
          const r = useAutoStore.getState().run!;
          if (r.pause?.kind !== "fact") break;
          facts.push(r.now);
          skipFact();
          await new Promise((res) => setTimeout(res, 50));
          await (autoLoop() ?? Promise.resolve());
        }
        const r = useAutoStore.getState().run!;
        const turns = useChatStore.getState().turns;
        const entry = {
          case: id,
          model: SETTINGS.model,
          state: r.state,
          ended: r.ended,
          pause: r.pause,
          seconds: Math.round((Date.now() - t0) / 1000),
          clock: formatDuration(Date.now() - t0),
          replies: r.replies,
          limit: r.limit,
          usage: usageText(r.usage),
          plan: r.plan.map((x) => ({ row: x.id, status: x.status, tries: x.tries, detail: x.detail })),
          facts_skipped: facts,
          decisions: useDecisionStore
            .getState()
            .decisions.filter((d) => r.decisions.includes(d.id))
            .map((d) => `${d.by} ${d.action} ${d.title} ${d.shown.from} → ${d.shown.to}`),
          replies_text: turns.filter((t) => t.role === "assistant").map((t) => ({ said: t.content.slice(0, 600), note: t.note ?? null, steps: (t.steps ?? []).map((s) => `${s.name} ${JSON.stringify(s.args)}${s.status === "done" ? "" : ` (${s.status}: ${(s.summary ?? "").slice(0, 160)})`}`) })),
        };
        record.push(entry);
        const out = env("NEBULA_AUTO_SMOKE_OUT");
        if (out) await writeText(new URL(`file://${out}`), JSON.stringify(record, null, 2));
        console.log(JSON.stringify(entry, null, 2));
        expect(["done", "paused", "stopped"]).toContain(r.state);
      },
      CAP_MS,
    );
  }
});
