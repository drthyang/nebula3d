// The validation's dev cases, built where the tests run: the interface the
// replay tests (*.replay.test.ts) use.
//
// devCase(id) is a handle on one dev case of the validation (synthetic, with a
// planted fault and its truth; nebula3d.validation). Its first use builds the
// case's volume in Python and gives it a fresh workspace: the case's default
// run (the Run button's settings, through usePipelineStore.runStages), with the
// stores and the query cache reset. Then
//
// - dataset() is the dataset as the console lists it;
// - tool(name, args) runs one of the Pilot's tools on it, as the app runs it;
// - replay(question, script) runs the agent loop on it, a scripted model
//   (scripted.ts) in place of the real one, with the real tools.
//
// Everything below the model is real: the tools call the client, which in
// the Pages mode (VITE_DATA_MODE=pyodide) goes to the engine, whose Worker
// messages reach nebula3d.webbridge through the CPython bridge
// (bridgeWorker.ts, bridge.py) instead of Pyodide. Nothing is recorded, so
// nothing goes stale: the Python and the TypeScript of the checkout run
// together.
//
// Invariants:
// - the dev split only, held three times: by the DevCaseId type, by devCase
//   at run time against the manifest's dev entries (before any Python starts),
//   and by bridge.py, which builds no case outside the dev split;
// - each handle starts fresh, and the bridge holds one workspace, so a newer
//   handle supersedes the older one: the older one's calls then fail;
// - a tool that fails comes back as ok: false, with its message.
//
// The default run is computed once per test file and case: the bridge keeps
// its outputs as a snapshot, devCase keeps the run's log (the store's events),
// and a later handle on the case starts from both.

import { fetchDataset, fetchDatasets } from "../../../api/client";
import { ensureBooted, PYODIDE_MODE } from "../../../api/pyodideEngine";
import { queryClient } from "../../../api/queryClient";
import type { Dataset, JobEvent } from "../../../api/types";
import { useDatasetStore } from "../../../state/datasetStore";
import { useDpdfStore } from "../../../state/dpdfStore";
import { useNavStore } from "../../../state/navStore";
import { enabledStages, usePipelineStore } from "../../../state/pipelineStore";
import { useStructureStore } from "../../../state/structureStore";
import { useViewerStore } from "../../../state/viewerStore";
import { useWorkspaceStore } from "../../../state/workspaceStore";
import { runAgent, type AgentResult } from "../../agent";
import { useChatStore } from "../../chatStore";
import { useHighlightStore } from "../../highlight";
import { safe } from "../../context/loadContext";
import type { LlmSettings } from "../../settings";
import { CHAT_TOOLS, type AgentTool, type ToolContext } from "../../tools";
import { useTuneStore } from "../../tune/tuner";
import type { Outcome } from "../../verdicts";
import { scriptedModel, SCRIPTED_URL, type ScriptTurn } from "../scripted";
import { casesIn, type ValidationCase } from "../validation";
import { bridgeConfig, currentBridge, RING_WORKERS_KEY } from "./bridgeWorker";

/** The validation's dev cases: the only ones a replay builds (the manifest's dev entries; devData.replay.test.ts pins the two equal). */
export const DEV_CASE_IDS = [
  "dev-control",
  "dev-ub",
  "dev-origin",
  "dev-coverage",
  "dev-rings",
  "dev-shell",
  "dev-flatten",
  "dev-rings-shell",
] as const;
export type DevCaseId = (typeof DEV_CASE_IDS)[number];

/** A tool's run, as the app runs it: its result (as JSON reads it), summary and outcomes; a failure is ok: false. */
export interface ToolRunResult {
  ok: boolean;
  result: Record<string, unknown>; // a text result (a skill) as { text }; a failure as { error }
  summary: string;
  outcomes: Outcome[];
}

/** A replay's agent result, with the scripted model's counts and the tools' whole results. */
export interface ReplayResult extends AgentResult {
  requests: number;
  overrun: number; // requests after the script ran out
  sent: string[]; // each request's last user message: what the app said to the model
  results(tool: string): Record<string, unknown>[]; // that tool's results in this replay, in order, whole
}

export interface DevCase {
  readonly id: DevCaseId;
  readonly truth: ValidationCase["truth"]; // from the manifest's dev entry
  readonly fault: ValidationCase["fault"];
  dataset(): Promise<Dataset>;
  tool(name: string, args?: Record<string, unknown>): Promise<ToolRunResult>;
  replay(question: string, script: ScriptTurn[]): Promise<ReplayResult>;
}

// What a replay's model is told and may read: the skills count as read, as in
// THY-18's replays (the skill gate on a stage's settings is not under test).
const SKILLS_READ = ["reduction-qc", "bragg-node-audit", "delta-pdf-interpretation"];
const SYSTEM = "You are NEBULA Pilot.";
const SETTINGS: LlmSettings = {
  baseUrl: SCRIPTED_URL,
  model: "scripted",
  apiKey: "",
  temperature: 0,
  attachImages: false,
  useTools: true,
  followViews: false,
};

/** The case's handle; it builds nothing until it is used. Only the dev split's ids are taken. */
export function devCase(id: DevCaseId): DevCase {
  const entry = casesIn("dev").find((c) => c.id === id);
  if (!entry) throw new Error(`${JSON.stringify(id)} is not a dev case of the validation: devCase builds the dev split only`);
  return new Handle(id, entry);
}

// ---------------------------------------------------------------- implementation

type RunLog = { events: JobEvent[]; times: number[]; terminal: string | null };

// Each case's default run, as the store logged it, kept with the bridge's
// snapshot of its outputs: one per test file, case and grid.
const defaultRuns = new Map<string, RunLog>();
let active: Handle | null = null;

const reset = <S>(store: { getInitialState: () => S; setState: (s: S, replace: true) => void }): void =>
  store.setState(store.getInitialState(), true);

/** The console as a fresh page has it: every store at its start, an empty query cache, storage with the ring pool off. */
function resetApp(): void {
  reset(usePipelineStore);
  reset(useDatasetStore);
  reset(useNavStore);
  reset(useViewerStore);
  reset(useDpdfStore);
  reset(useStructureStore);
  reset(useWorkspaceStore);
  reset(useTuneStore);
  reset(useChatStore);
  reset(useHighlightStore);
  queryClient.clear();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(RING_WORKERS_KEY, "0");
}

const lastError = (events: readonly JobEvent[]): string =>
  [...events].reverse().find((e) => e.status === "error")?.message ?? "no error logged";

async function activate(id: DevCaseId): Promise<ToolContext> {
  if (!PYODIDE_MODE) throw new Error("devCase runs in the replay project, where VITE_DATA_MODE is pyodide: npx vitest --project replay");
  const { n } = bridgeConfig();
  resetApp();
  await ensureBooted();
  const bridge = currentBridge();
  if (!bridge) throw new Error("the engine booted no CPython bridge");
  const which = { case: id, n, arm: "B", run: 1 };
  const { dataset_id: datasetId, restored } = await bridge.control<{ dataset_id: string; restored: boolean }>({ type: "dev_case", ...which });
  useDatasetStore.getState().setDataset(datasetId);

  const key = `${id}|${n}`;
  const saved = defaultRuns.get(key);
  if (restored && saved) {
    usePipelineStore.setState(saved);
  } else {
    // The Run button's settings: every enabled stage, outputs that exist reused.
    const s = usePipelineStore.getState();
    const ended = await s.runStages(enabledStages(s), { datasetId, force: s.force });
    const { events, times, terminal } = usePipelineStore.getState();
    if (ended !== "done") throw new Error(`the default run of ${id} ended "${ended}": ${lastError(events)}`);
    defaultRuns.set(key, { events, times, terminal });
    await bridge.control({ type: "dev_snapshot", ...which });
  }
  const [dataset, datasets] = await Promise.all([fetchDataset(datasetId), fetchDatasets()]);
  return { dataset, datasets };
}

/** A result as JSON reads it, as an object. */
function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") return { text: value };
  const json = JSON.parse(JSON.stringify(value ?? null)) as unknown;
  return json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : { value: json };
}

class Handle implements DevCase {
  private ready: Promise<ToolContext> | null = null;
  private superseded = false;

  constructor(
    readonly id: DevCaseId,
    private readonly entry: ValidationCase,
  ) {}

  get truth(): ValidationCase["truth"] {
    return this.entry.truth;
  }

  get fault(): ValidationCase["fault"] {
    return this.entry.fault;
  }

  private start(): Promise<ToolContext> {
    if (this.superseded) {
      return Promise.reject(new Error(`this handle on ${this.id} was superseded by a newer devCase(): the bridge holds one workspace`));
    }
    if (!this.ready) {
      Handle.takeOver(this);
      this.ready = activate(this.id);
    }
    return this.ready;
  }

  /** The bridge holds one workspace: a handle that starts supersedes the one before it. */
  private static takeOver(handle: Handle): void {
    if (active && active !== handle) active.superseded = true;
    active = handle;
  }

  async dataset(): Promise<Dataset> {
    return (await this.start()).dataset;
  }

  async tool(name: string, args: Record<string, unknown> = {}): Promise<ToolRunResult> {
    const ctx = await this.start();
    const tool = CHAT_TOOLS.find((t) => t.name === name);
    if (!tool) throw new Error(`no tool named ${name}`);
    try {
      // ctx is the handle's: a run refreshes its dataset for the calls after it.
      const out = await tool.run(args, ctx, {});
      return { ok: true, result: asRecord(out.result), summary: out.summary, outcomes: out.outcomes ?? [] };
    } catch (e) {
      const message = (e as Error).message;
      return { ok: false, result: { error: message }, summary: message, outcomes: [] };
    }
  }

  async replay(question: string, script: ScriptTurn[]): Promise<ReplayResult> {
    const ctx = await this.start();
    // The real tools, each result kept whole as it leaves the tool.
    const recorded: { tool: string; result: Record<string, unknown> }[] = [];
    const tools: AgentTool[] = CHAT_TOOLS.map((t) => ({
      ...t,
      run: async (args, c, io) => {
        const out = await t.run(args, c, io);
        recorded.push({ tool: t.name, result: asRecord(out.result) });
        return out;
      },
    }));
    const model = scriptedModel(script);
    const uninstall = model.install();
    try {
      const result = await runAgent({
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: question },
        ],
        tools,
        ctx: { ...ctx, skillsRead: new Set(SKILLS_READ) },
        settings: SETTINGS,
        signal: new AbortController().signal,
      });
      return {
        ...result,
        requests: model.requests(),
        overrun: model.overrun(),
        sent: model.sent(),
        results: (tool) => recorded.filter((r) => r.tool === tool).map((r) => r.result),
      };
    } finally {
      uninstall();
      // A run in the replay rewrote the outputs: the handle's later calls see them.
      ctx.dataset = (await safe(fetchDataset(ctx.dataset.id))) ?? ctx.dataset;
    }
  }
}
