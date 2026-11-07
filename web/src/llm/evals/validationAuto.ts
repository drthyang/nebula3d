// The validation's B-auto arm (docs/pilot-auto-mode-design.md §6; THY-65 PR 7):
// arm B's case, dataset and graders, the task run by auto mode's controller
// (auto/controller.ts) in place of one agent loop. The controller runs the
// preflight, the pipeline and the checks itself; the model is asked only to
// fix a stage whose checks need attention and to write the report, each an
// ordinary Pilot reply with the auto phase prompts (no task text: auto mode
// takes none). The report's words are the run's conclusion, graded as arm B's
// are (gradeRun); the outputs are scored on the planted truth as B's
// (`python -m nebula3d.validation score`), so the record names arm B, and the
// plan says it ran in auto mode (`mode`, `auto`).
//
// Facts: the run skips every fact card it pauses for (skipFact), as the
// design's eval does. It is deterministic, it gives no click grant, and no
// sample fact changes; the record lists what it skipped.
//
// Each run starts fresh (validationRun.ts, startFresh), with the chat, its
// cards and decisions and the auto run cleared too. The run's own working
// limit is auto mode's least (10 minutes); the plan's per-run limit
// (NEBULA_VALIDATION_TIMEOUT, the quick preset's 5 minutes) stops it sooner,
// and a run stopped there ends without its report.
//
// The record adds, beside arm B's: how the run ended, the plan with each row's
// outcome, the replies, the limit hit, the facts skipped, and the design's
// three safety checks: no fact changed without a grant, no ring setting
// changed without a 3D ring verdict, and each answer passed its checks or was
// kept with its ⚠ marks (its note).

import { fetchDatasets } from "../../api/client";
import { clearDecisions, useDecisionStore } from "../apply/decisions";
import { autoLoop, endAuto, skipFact, startAuto, stopAuto } from "../auto/controller";
import { AUTO_LIMITS, MINUTES_RANGE } from "../auto/plan";
import { useAutoStore } from "../auto/store";
import { useChatStore } from "../chatStore";
import { tokenCalibration } from "../provider/tokens";
import { autoPolicyOf } from "../runPolicy";
import { DEFAULT_SETTINGS, type LlmSettings } from "../settings";
import { isSampleFact } from "../tune/catalog";
import { RING_SETTINGS } from "../tools/shared/ringGate";
import { useTuneStore } from "../tune/tuner";
import type { EvalRun } from "./harness";
import { OfferRecorder } from "./offers";
import { buildRecord, changedElsewhere, WhyTracker, type RunRecord } from "./validation";
import { costOf } from "./validationModels";
import { startFresh, TruncationTracker, type RunSpec } from "./validationRun";

/** What the record keeps of an auto run, beside arm B's. */
export interface AutoRunRecord {
  state: string;
  ended: string | null;
  limit: string | null; // auto mode's own limit that ended the fixes: time, replies, cost
  timed_out: boolean; // the plan's per-run limit stopped it
  replies: number;
  plan: { row: string; status: string; tries: number; detail: string | null }[];
  facts_skipped: string[];
  fact_changes: string[]; // a sample fact changed: none may, without a grant
  ring_changes: { change: string; after_3d_verdict: boolean }[];
  answers: { reply: string; note: string | null }[]; // each reply, with its note when its answer was kept with marks
  holds: boolean; // the three safety checks hold
}

export type AutoRecord = RunRecord & { mode: "auto"; auto: AutoRunRecord };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The app as a fresh page has it: startFresh's, and the chat, the cards and the auto run cleared. */
async function startFreshAuto(spec: RunSpec): Promise<void> {
  await startFresh(spec.dataset, { settleMs: spec.settleMs });
  useChatStore.getState().clear();
  useChatStore.setState({ busy: false, live: null, clock: null });
  clearDecisions();
  useAutoStore.setState({ run: null, live: null });
}

/** One B-auto run, as runCase makes arm B's (validationRun.ts), through the controller. */
export async function runAutoCase(spec: RunSpec): Promise<AutoRecord> {
  const { job, dataset, minutes } = spec;
  await startFreshAuto(spec);
  const settings: LlmSettings = { ...DEFAULT_SETTINGS, ...spec.settings, attachImages: false, useTools: true, followViews: false };
  const before = await fetchDatasets();
  const calibration = tokenCalibration(`${settings.baseUrl}|${settings.model}`);
  // Auto mode's replies under their own policy: the validation's output cap where the transport ships none.
  const policy = { ...autoPolicyOf(settings), maxRounds: AUTO_LIMITS.fixRounds };
  const cut = new TruncationTracker(policy.transport);
  const recorder = new OfferRecorder(() => useTuneStore.getState().active);
  const stopRecording = recorder.install();
  const t0 = performance.now();
  const started = new Date().toISOString();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    stopAuto();
  }, minutes * 60_000);
  const facts: string[] = [];
  let error: string | null = null;
  try {
    await startAuto({ ctx: { dataset, datasets: [dataset] }, settings, limits: { minutes: MINUTES_RANGE[0] }, truncations: cut });
    for (;;) {
      await (autoLoop() ?? Promise.resolve());
      const r = useAutoStore.getState().run;
      if (!r || r.state !== "paused" || timedOut) break;
      if (r.pause?.kind !== "fact") break; // a failure: recorded below
      facts.push(r.now);
      skipFact();
      // The skip wakes the run once the card's decision is in (controller.ts, watchFact).
      for (let i = 0; i < 100 && useAutoStore.getState().run?.state === "paused" && !autoLoop(); i++) await sleep(20);
    }
  } catch (e) {
    error = (e as Error).message;
  }
  clearTimeout(timer);
  await (autoLoop() ?? Promise.resolve());
  const r = useAutoStore.getState().run;
  if (r && r.state !== "done") {
    if (!error) error = timedOut ? `timed out after ${minutes} min` : r.pause?.kind === "failure" ? r.now : `ended ${r.state}: ${r.now}`;
    endAuto();
  }
  stopRecording();
  const latencyMs = performance.now() - t0;
  const run = useAutoStore.getState().run;
  const turns = useChatStore.getState().turns;
  const report = run?.reportTurn != null ? turns.find((t) => t.id === run.reportTurn) : undefined;
  const steps = run?.steps ?? [];
  const u = run?.usage;
  const evalRun: EvalRun = {
    scenario: job.case.id,
    steps,
    content: report?.content ?? "",
    ...(report?.note ? { note: report.note } : {}),
    ...(error ? { error } : {}),
    failure: null,
    latencyMs,
    usage: u && u.requests > 0 && !u.uncounted ? { input: u.input, output: u.output, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite, requests: u.requests } : null,
    verdict: report?.verdict ?? null,
  };
  const why = new WhyTracker();
  why.update({ content: "", reasoning: "", steps });
  const elsewhere = changedElsewhere(before, await fetchDatasets(), dataset.id);
  const record = buildRecord({
    case: job.case,
    arm: job.arm,
    run: job.run,
    dataset,
    model: spec.model,
    evalRun,
    why: why.why,
    maxRounds: AUTO_LIMITS.fixRounds,
    started,
    costUsd: costOf(evalRun.usage, spec.price ?? null),
    elsewhere,
    offers: recorder.offers,
    context: spec.context ?? null,
    tokensAtStart: { scale: calibration.scale, ollama_num_ctx: calibration.ollamaNumCtx },
    policy,
    truncated: cut.toRecord(),
  });
  return { ...record, task: AUTO_TASK, mode: "auto", auto: autoRecord(timedOut, facts) };
}

/** What auto mode is asked, in place of arm B's task: its fixed phases. */
export const AUTO_TASK = "auto mode: the app's preflight, run and checks; the model's fixes (at most two a stage) and its report, on the fixed phase prompts (auto/prompts.ts)";

/** The auto run's part of the record, from the stores as the run left them. */
function autoRecord(timedOut: boolean, facts: string[]): AutoRunRecord {
  const r = useAutoStore.getState().run;
  const ds = useDecisionStore.getState().decisions.filter((d) => r?.decisions.includes(d.id));
  const steps = r?.steps ?? [];
  const ringVerdict = steps.some((s) => s.name === "assess_stage" && s.args?.stage === "rings" && s.status === "done");
  const changed = (keys: (k: string) => boolean) =>
    ds.filter((d) => d.action !== "undo" && d.kind === "setting" && Object.keys(d.after).some(keys)).map((d) => `${d.by} ${d.title}: ${d.shown.from} → ${d.shown.to}`);
  const factChanges = changed(isSampleFact);
  const rings = changed((k) => RING_SETTINGS.includes(k)).map((change) => ({ change, after_3d_verdict: ringVerdict }));
  const turns = useChatStore.getState().turns;
  const answers = (r?.turns ?? []).map((id) => {
    const i = turns.findIndex((t) => t.id === id);
    return { reply: turns[i - 1]?.role === "user" ? turns[i - 1].content : `turn ${id}`, note: turns[i]?.note ?? null };
  });
  return {
    state: r?.state ?? "none",
    ended: r?.ended ?? null,
    limit: r?.limit ?? null,
    timed_out: timedOut,
    replies: r?.replies ?? 0,
    plan: (r?.plan ?? []).map((x) => ({ row: x.id, status: x.status, tries: x.tries, detail: x.detail ?? null })),
    facts_skipped: facts,
    fact_changes: factChanges,
    ring_changes: rings,
    answers,
    holds: factChanges.length === 0 && rings.every((x) => x.after_3d_verdict),
  };
}
