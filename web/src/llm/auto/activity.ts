// What an auto run is doing, in plain words (THY-65 PR 7; the user, 2026-11-07:
// "Auto mode is too silent"): one "Now" line for this moment, and an activity
// log, one row a step (the app's checks and runs, each model reply, each fact
// asked, the stages a limit left unchecked, a limit, a stop), each with its
// status and one line of what was decided, and its detail behind a click.
//
// Built only from what the run already holds: the controller's record
// (store.ts: the plan, the steps and their tools' own summaries, the replies'
// turns and where they stand, the facts), the step under way (`live`), the
// decisions, the chat's reply under way, and the tuning store's trials. No
// model text is asked for, so it costs no tokens, and the model reads none of
// it. Pure: the stores' states in, words out (activityNow reads the stores).

import type { AgentStep } from "../agent";
import { useDecisionStore, type Decision } from "../apply/decisions";
import type { Proposal } from "../apply/proposals";
import { useChatStore, type ChatTurn } from "../chatStore";
import { factsOf } from "../tools";
import { useTuneStore, type StageRun } from "../tune/tuner";
import { STAGE_NAMES } from "../verdicts/rules";
import { isStage, LIMIT_WORDS, ROW_IDS, STAGES, type RowId, type Stage } from "./plan";
import { problemLines, PROBLEMS_TITLE } from "./problems";
import { useAutoStore, type AutoRun } from "./store";
import { isAppStep } from "./transcript";

export type ActivityStatus = "done" | "running" | "needs you" | "skipped" | "stopped" | "failed";

export interface ActivityRow {
  key: string;
  status: ActivityStatus;
  title: string; // what the step was: "Checked the Bragg punch"
  line: string; // what was decided, and why, in one line
  detail: string[]; // behind a click: the evidence, the settings changed, the reply
  step?: string; // the app's step it is (its place in the chat, its highlights)
  turn?: number; // the reply it is
}

export interface Activity {
  now: string;
  rows: ActivityRow[];
}

export interface ActivityInput {
  run: AutoRun;
  live: AgentStep | null; // the app's step under way, or the last one done
  turns: readonly ChatTurn[];
  replying: boolean; // a reply of the run's is under way in the chat
  replySteps: readonly AgentStep[]; // that reply's steps so far
  decisions: readonly Decision[];
  proposals: readonly Proposal[];
  tune: { active: boolean; stages: readonly StageRun[] };
}

const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
const lower = (s: string): string => (s ? s[0].toLowerCase() + s.slice(1) : s);
const stageNumber = (s: Stage): string => `stage ${STAGES.indexOf(s) + 1} of ${STAGES.length}`;
const rowStage = (id: RowId | null): Stage | null => (id && isStage(id) ? id : null);
const rowName = (id: RowId): string => (isStage(id) ? STAGE_NAMES[id] : id === "preflight" ? "the preflight" : id === "run" ? "the run" : "the report");

// What the app's own calls are doing, in the present tense (a tool's label is the past tense of the transcript).
const DOING: Readonly<Record<string, string>> = {
  qmax_coverage: "checking Qmax against the coverage",
  ub_check: "checking the UB",
  grain_check: "checking for a second grain",
  compare_laue_classes: "comparing the Laue classes",
  run_pipeline: "running the pipeline",
  assess_stage: "assessing a stage",
  texture_check: "checking for texture",
  symmetry_check: "checking the ΔPDF's symmetry",
};
const doing = (name: string): string => DOING[name] ?? lower(factsOf(name).runningLabel);

/** A tuning under way, in words: "trial 2 of 3", or what it is doing between trials. */
function tuningWords(tune: ActivityInput["tune"]): string | null {
  if (!tune.active) return null;
  const st = tune.stages.find((s) => s.status !== "done" && s.status !== "skipped" && s.status !== "waiting") ?? null;
  if (!st) return "Tuning";
  const name = STAGE_NAMES[st.stage];
  const running = st.trials.find((t) => t.status === "running");
  if (st.status === "proposing") return `Tuning ${name}: proposing trials`;
  if (st.status === "judging") return `Tuning ${name}: judging ${st.trials.length} trials`;
  if (running) return `Tuning ${name}, trial ${running.n} of ${st.trials.length}`;
  return `Tuning ${name}`;
}

/** The "Now" line: what the run is doing at this moment. */
export function nowLine(a: ActivityInput): string {
  const { run, live } = a;
  if (run.state === "done") return run.ended ?? "Done.";
  if (run.state === "paused" && run.pause?.kind === "fact") {
    const fact = run.facts.find((f) => f.proposal === (run.pause as { proposal: string }).proposal);
    return `Waiting for your answer: ${fact?.title ?? "a fact about the sample"}`;
  }
  if (run.state === "paused" && run.pause?.kind === "failure") return run.pause.what === "model" ? "Paused: the model server failed. Retry, or stop." : "Paused: the pipeline run failed. Retry, or stop.";
  const at = run.plan.find((r) => r.id === run.at);
  if (run.state === "stopped") return `Paused by you${at ? ` in ${rowName(at.id)}` : ""}. Resume restarts it.`;
  if (!at) return "Starting…";
  const stage = rowStage(at.id);
  const appRunning = live?.status === "running" && live.id.startsWith(`auto:${run.id}:`) ? live : null;
  if (appRunning) {
    const name = appRunning.name;
    if (at.id === "preflight") return `Preflight: ${doing(name)}…`;
    if (at.id === "run") return "Running the pipeline…";
    if (at.id === "report") return name === "run_pipeline" ? "Running the pipeline before the report…" : "Running the final checks for the report…";
    if (stage && name === "run_pipeline") return at.tries ? `Running the pipeline from ${STAGE_NAMES[stage]} after fix ${at.tries}…` : `Running the pipeline before ${STAGE_NAMES[stage]}…`;
    if (stage) return at.tries ? `Checking ${STAGE_NAMES[stage]} again after fix ${at.tries}…` : `Checking ${STAGE_NAMES[stage]} (${stageNumber(stage)})…`;
  }
  if (at.id === "preflight") return "Preflight: checking the raw volume…";
  if (at.id === "run") return "Running the pipeline…";
  if (at.id === "report") return "Writing the report";
  if (stage && at.status === "fixing") return tuningWords(a.tune) ?? `Fixing ${STAGE_NAMES[stage]}, try ${at.tries} of ${run.limits.fixesPerStage}`;
  if (stage) return `Checking ${STAGE_NAMES[stage]} (${stageNumber(stage)})…`;
  return cap(run.now || "Working…");
}

// ---------------------------------------------------------------- the log

const args = (s: AgentStep): string => {
  const a = JSON.stringify(s.args ?? {});
  return a === "{}" ? "" : a;
};

function stepRow(s: AgentStep, i: number, a: ActivityInput): ActivityRow {
  // The app's own change (THY-43: the settings the pre-run sensing recommends):
  // what it set, each from its card, and the line it rests on.
  if (s.name === "update_settings" && s.status === "done") {
    const ps = a.proposals.filter((p) => p.source.step === s.id);
    const ds = a.decisions.filter((d) => ps.some((p) => p.id === d.proposal) && d.action === "apply");
    if (ps.length) {
      const putBack = ds.some((d) => !!d.undoneBy && a.decisions.some((u) => u.id === d.undoneBy && u.by === "auto"));
      const why = [...new Set(ps.flatMap((p) => p.evidence.map((e) => e.text)).filter(Boolean))].join("; ");
      return {
        key: s.id,
        status: "done",
        title: `Set ${ps.map((p) => `${lower(p.title)} to ${p.shown.to}`).join(", ")}`,
        line: `${why || (s.summary ?? "")}${putBack ? " (it made the punch's check worse: put back)" : ""}`,
        detail: [...ps.map((p) => `${p.title}: ${p.shown.from} → ${p.shown.to}`), ...ps.flatMap((p) => p.evidence.map((e) => `${e.label}, step ${e.n}: ${e.text}`)), `Step ${i + 1} of the run, by the app; Undo auto changes puts it back`],
        step: s.id,
      };
    }
  }
  const stage = s.name === "assess_stage" && typeof s.args?.stage === "string" && (STAGES as readonly string[]).includes(s.args.stage) ? (s.args.stage as Stage) : null;
  const title = stage ? `Checked ${STAGE_NAMES[stage]}` : factsOf(s.name).label;
  const line = s.summary ?? (s.status === "error" ? "failed" : "");
  return {
    key: s.id,
    status: s.status === "error" ? "failed" : s.status === "stopped" ? "stopped" : "done",
    title,
    line,
    detail: [`${factsOf(s.name).label}${args(s) ? ` ${args(s)}` : ""}`, ...(s.summary ? [`→ ${s.summary}`] : []), `Step ${i + 1} of the run, by the app`],
    step: s.id,
  };
}

/** What a reply changed, from its decisions and its cards: "punchMinSig 12 → 5"; a fact it asked; or nothing. */
function replyLine(turn: number, a: ActivityInput, report: boolean): { line: string; detail: string[] } {
  const ps = a.proposals.filter((p) => p.turn === turn);
  const ds = a.decisions.filter((d) => ps.some((p) => p.id === d.proposal) && d.by === "auto" && d.action !== "undo");
  // A change the run put back for making its check worse says so (controller.ts, madeWorse).
  const putBack = (d: Decision) => !!d.undoneBy && a.decisions.some((u) => u.id === d.undoneBy && u.by === "auto");
  const changed = ds.filter((d) => d.kind === "setting").map((d) => `${d.title} ${d.shown.from} → ${d.shown.to}${putBack(d) ? " (it made the check worse: put back)" : ""}`);
  const asked = ps.filter((p) => p.held === "fact").map((p) => `${p.title} ${p.shown.from ? `${p.shown.from} → ` : ""}${p.shown.to}`);
  const t = a.turns.find((x) => x.id === turn);
  const steps = (t?.steps ?? []).filter((s) => !/:seed_\d+$/.test(s.id)).map((s) => `${factsOf(s.name).label}${s.summary ? `: ${s.summary}` : ""}`);
  const said = (t?.content ?? "").replace(/\s+/g, " ").trim();
  const detail = [...steps, ...(said ? [`Said: ${said.length > 400 ? `${said.slice(0, 400)}…` : said}`] : []), ...(t?.note ? [t.note] : [])];
  if (report) return { line: t?.note ? `Written, kept with marks: ${t.note}` : "Written", detail };
  const line = changed.length ? `Changed ${changed.join("; ")}` : asked.length ? `Asked you: ${asked.join("; ")} (a fact about the sample)` : steps.some((s) => s.startsWith(factsOf("tune_pipeline").label)) ? "Tuned the stage" : "No change";
  return { line, detail };
}

/** The activity log, in the order things happened. */
export function activityRows(a: ActivityInput): ActivityRow[] {
  const { run } = a;
  const rows: ActivityRow[] = [];
  const replyAt = new Map<number, number[]>(); // step index → the replies that started there
  if (run.turns.length === run.turnAt.length) run.turnAt.forEach((i, k) => replyAt.set(i, [...(replyAt.get(i) ?? []), run.turns[k]]));
  const factAt = new Map<number, typeof run.facts>();
  for (const f of run.facts) factAt.set(f.at ?? run.steps.length, [...(factAt.get(f.at ?? run.steps.length) ?? []), f]);
  const pausedOn = run.state === "paused" && run.pause?.kind === "fact" ? run.pause.proposal : null;

  // The problems the final checks found (problems.ts): the app's list,
  // computed, once the run is done; before the report reply, as in the chat.
  let problemsShown = false;
  const problemsRow = () => {
    if (run.state !== "done" || run.problems === undefined) return;
    const lines = problemLines(run.problems);
    rows.push({ key: "problems", status: "done", title: PROBLEMS_TITLE, line: lines.join("; "), detail: lines });
    problemsShown = true;
  };
  const replyRow = (turn: number) => {
    const t = a.turns.findIndex((x) => x.id === turn);
    const label = (t > 0 && a.turns[t - 1].role === "user" ? a.turns[t - 1].content : "").replace(/^Auto · /, "");
    const report = turn === run.reportTurn || label === "the report";
    if (turn === run.reportTurn) problemsRow();
    const { line, detail } = replyLine(turn, a, report);
    rows.push({ key: `reply:${turn}`, status: "done", title: report ? "Wrote the report" : cap(label || "A model reply"), line, detail, turn });
  };
  const factRows = (i: number) => {
    for (const f of factAt.get(i) ?? []) {
      const status: ActivityStatus = f.status === "applied" ? "done" : f.status === "declined" ? "skipped" : "needs you";
      const line =
        f.status === "applied" ? "Applied by you: the run goes on from its stage" : f.status === "declined" ? "Skipped by you: the report lists it as an open question" : f.proposal === pausedOn ? "Waiting for your answer: the run is paused before the stage it changes" : "Asked: the run pauses before the stage it changes";
      rows.push({ key: `fact:${f.proposal}`, status, title: `Asked you: ${f.title} ${f.shown}`, line, detail: ["A fact about the sample: only your click sets it, and it counts as you stating it."] });
    }
  };

  run.steps.forEach((s, i) => {
    for (const turn of replyAt.get(i) ?? []) replyRow(turn);
    factRows(i);
    if (isAppStep(s)) rows.push(stepRow(s, i, a));
  });
  // What came after the last step: replies, facts asked there.
  for (const [i, turns] of replyAt) if (i >= run.steps.length) turns.forEach(replyRow);
  for (const i of factAt.keys()) if (i >= run.steps.length) factRows(i);

  // Under way: the app's step, or a reply of the run's.
  if (run.state === "running") {
    const live = a.live?.status === "running" && a.live.id.startsWith(`auto:${run.id}:`) ? a.live : null;
    if (live) rows.push({ key: live.id, status: "running", title: cap(doing(live.name)), line: "…", detail: [], step: live.id });
    else if (a.replying) {
      const last = [...a.turns].reverse().find((t) => t.role === "user");
      const doing = a.replySteps.find((s) => s.status === "running");
      const at = run.plan.find((r) => r.id === run.at);
      const title = at?.id === "report" ? "Writing the report" : cap((last?.content ?? "A model reply").replace(/^Auto · /, ""));
      rows.push({ key: "reply:live", status: "running", title, line: tuningWords(a.tune) ?? (doing ? `${factsOf(doing.name).runningLabel}…` : "The model is replying…"), detail: [] });
    }
  }
  // How it ended or stopped: a limit, the stages it left, a stop by you.
  if (run.limit) rows.push({ key: "limit", status: "skipped", title: "Limit reached", line: `The fixes ended at ${LIMIT_WORDS[run.limit]}; the run went to its report`, detail: [] });
  for (const id of ROW_IDS) {
    const r = run.plan.find((x) => x.id === id)!;
    if (r.status === "skipped") rows.push({ key: `skipped:${id}`, status: "skipped", title: `Not checked: ${r.title}`, line: r.detail ?? "skipped", detail: [] });
  }
  // The problems the final checks found, where no report reply came after them.
  if (!problemsShown) problemsRow();
  // The report the app wrote alone (store.ts, appReport): no reply, no cost.
  if (run.appReport === "stopped") rows.push({ key: "app-report", status: "done", title: "The app's report", line: `${(run.ended ?? "Stopped by you").split(":")[0]}: written from what the run checked, with no model reply and no cost`, detail: [] });
  if (run.appReport === "limit") rows.push({ key: "app-report", status: "done", title: "The app's report", line: `Written without the model${run.limit ? `: ${LIMIT_WORDS[run.limit]}` : ""}`, detail: [] });
  if (run.state === "stopped") {
    const at = run.plan.find((r) => r.id === run.at);
    rows.push({ key: "stopped", status: "stopped", title: "Paused by you", line: at ? `In ${rowName(at.id)}; Resume restarts it` : "Resume goes on", detail: [] });
  }
  if (run.state === "paused" && run.pause?.kind === "failure") rows.push({ key: "failure", status: "failed", title: run.pause.what === "model" ? "The model server failed" : "The pipeline run failed", line: run.pause.message, detail: [] });
  return rows;
}

export const activity = (a: ActivityInput): Activity => ({ now: nowLine(a), rows: activityRows(a) });

/** The activity as the stores hold it now; null without a run. */
export function activityNow(): Activity | null {
  const { run, live } = useAutoStore.getState();
  if (!run) return null;
  const chat = useChatStore.getState();
  const { decisions, proposals } = useDecisionStore.getState();
  const tune = useTuneStore.getState();
  return activity({ run, live, turns: chat.turns, replying: chat.busy, replySteps: chat.live?.steps ?? [], decisions, proposals, tune });
}
