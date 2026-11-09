// What the Apply cards do (docs/pilot-auto-mode-design.md §1.1–1.5), through
// today's paths: a setting or a trial through update_settings' own run(),
// with its checks, its guards and the Configure page's highlight; a run
// through run_pipeline's; Undo puts back the values from before, while the
// fields still hold the ones applied. The calls carry a context the model
// never builds and that names no sample fact (userMessage ""), so the
// sample-fact guard, the edge trim's, the symmetry average's and the ring
// gate refuse here exactly as they refuse the model.
//
// The one way past them is the user's own click (§1.3): on a card the user
// alone may act on (a sample fact, the edge trim, the symmetry average, the
// |Q| band, the magnetic ion), and on "Apply anyway" for a ring change the
// ring gate holds, the click's handler makes a click grant (llm/consent.ts)
// for exactly the values applied (applyOnClick, applyAnyway). It rides on
// this call's context alone, update_settings uses it up, and the apply
// revokes it whatever happened. Undo of a change a click made needs a click
// too. A card holding a ring change can check the rings in 3D itself
// (checkRings): a verdict of a ring left opens the gate for that card, on
// the outputs it judged, and the model's calls never read it.
//
// A run after a change starts from the earliest stage the change reaches
// (proposals.ts, runStageFor): the symmetry average, while it is on, for a
// change to what it reads (the edge trim, the Laue class).

import { noteAgentEdit } from "../../state/agentEdits";
import { usePipelineStore, type PipelineConfig } from "../../state/pipelineStore";
import { ringOutputChanged, ringOutputMark } from "../../state/ringOutput";
import { toolStepsIn, type AgentStep } from "../agent";
import { useChatStore } from "../chatStore";
import { grantForClick, grantIsFor, isTrustedClick, revokeGrant, type AppCallContext, type ClickEvent, type Grant } from "../consent";
import { callTool, CHAT_TOOLS, type ToolContext } from "../tools";
import { runPipelineFrom } from "../tools/shared/runPipeline";
import { RING_SETTINGS, ringVerdictAllowsChange } from "../tools/shared/ringGate";
import { RUN_STAGES, TUNE_STAGES, type RunStage } from "../tune/catalog";
import { useTuneStore } from "../tune/tuner";
import { autoBusy } from "../auto/store";
import {
  addProposals,
  logDecision,
  nextProposalNumber,
  setNote,
  setRingCheck,
  updateDecision,
  updateProposal,
  useDecisionStore,
  type Decision,
  type RingCheck,
} from "./decisions";
import { changeOf } from "./edit";
import { buildProposals, cardSetting, runProposal, runStageFor, stageTitle, type Proposal } from "./proposals";

const tool = (name: string) => {
  const t = CHAT_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`no ${name} tool`);
  return t;
};

const config = (): PipelineConfig => usePipelineStore.getState();

const pick = (keys: readonly string[]): Partial<PipelineConfig> => {
  const s = config();
  return Object.fromEntries(keys.map((k) => [k, s[k as keyof PipelineConfig]])) as Partial<PipelineConfig>;
};

const holds = (fields: Partial<PipelineConfig>): boolean => {
  const s = config();
  return Object.entries(fields).every(([k, v]) => s[k as keyof PipelineConfig] === v);
};

/** The context of a card's call: the conversation's steps as evidence, this reply's none, no message naming anything. */
export function cardContext(ctx: ToolContext): ToolContext {
  return {
    dataset: ctx.dataset,
    datasets: ctx.datasets,
    userMessage: "",
    replySteps: [],
    earlierSteps: toolStepsIn(useChatStore.getState().turns),
  };
}

// --------------------------------------------------------------- after a reply

/** Build and keep the proposals a finished reply leads to (session.ts calls it with the reply's whole steps). */
export function proposeFromReply(turn: number, steps: readonly AgentStep[], answer: string, dataset: string | undefined): void {
  if (!dataset) return;
  const ps = buildProposals({
    turn,
    steps,
    answer,
    config: config(),
    dataset,
    tune: useTuneStore.getState().stages,
    firstId: nextProposalNumber(),
    earlierSteps: toolStepsIn(useChatStore.getState().turns.filter((t) => t.id !== turn)),
  });
  // A card an open one makes already (an earlier reply's): none twice, its evidence joining that card's.
  addProposals(ps.filter((p) => p.kind === "run" || !mergeIntoTwin(p)));
}

/** Whether `p` has an open twin; its evidence then joins the twin's (the Laue comparison's beside the Bragg sensing's). */
export function mergeIntoTwin(p: Proposal): boolean {
  const twin = openTwin(p);
  if (!twin) return false;
  const more = p.evidence.filter((e) => !twin.evidence.some((x) => x.step === e.step));
  if (more.length) updateProposal(twin.id, { evidence: [...twin.evidence, ...more] });
  return true;
}

/** The same change as `p`: its kind, fields and change. */
export const sameChange = (p: Proposal, q: Proposal): boolean =>
  q.kind === p.kind && JSON.stringify(q.fields) === JSON.stringify(p.fields) && JSON.stringify(q.change) === JSON.stringify(p.change);

/** An open card on `p`'s dataset with `p`'s change, if any. */
const openTwin = (p: Proposal): Proposal | undefined =>
  useDecisionStore.getState().proposals.find((q) => q.id !== p.id && q.status === "open" && q.dataset === p.dataset && sameChange(p, q));

/**
 * After a card's change, the other open cards on its dataset whose change
 * now holds (a Laue class the Bragg sensing and the Laue comparison both
 * offered): covered, with no Apply left, never stale and waiting. Returns them.
 */
export function retireCovered(dataset: string, except: string): Proposal[] {
  const s = config();
  const covered = useDecisionStore
    .getState()
    .proposals.filter(
      (q) =>
        q.id !== except &&
        q.dataset === dataset &&
        q.status === "open" &&
        q.kind !== "run" &&
        Object.keys(q.fields).length > 0 &&
        Object.entries(q.fields).every(([k, v]) => s[k as keyof PipelineConfig] === v),
    );
  for (const q of covered) updateProposal(q.id, { status: "covered" });
  return covered;
}

// --------------------------------------------------------------- the card's state

export type CardState =
  | { can: true }
  | { can: false; why: string };

// Why a card cannot be acted on at all now: decided, gone stale; then busy.
const staleWhy = (p: Proposal, datasetId: string | undefined): string | null => {
  if (p.status !== "open") return "";
  if (datasetId !== p.dataset) return "Stale: another dataset is open.";
  if (p.kind !== "run" && !holds(p.from)) return "Stale: the settings changed since.";
  return null;
};
const busyWhy = (busy: boolean): string | null => {
  if (busy) return "Wait for the reply to end.";
  // An auto run under way owns the settings and the runs (auto/controller.ts): a
  // card waits for it to pause, stop or end. A fact it paused for applies then.
  if (autoBusy()) return "Wait for the auto run to pause.";
  const { working, checking } = useDecisionStore.getState();
  return working || checking ? "" : null;
};

/**
 * Whether a card can be applied now without the user's own click, and why
 * not: a card the user alone may act on never can (held), nor a ring change
 * with no 3D verdict of a ring left standing for it (the conversation's, or
 * its own check's).
 */
export function cardState(p: Proposal, datasetId: string | undefined, ctx: ToolContext | null, busy: boolean): CardState {
  const stale = staleWhy(p, datasetId);
  if (stale !== null) return { can: false, why: stale };
  if (p.held === "ring") {
    if (!ctx || !ringVerdictAllowsChange(ringContext(p, ctx))) return { can: false, why: "Held: no 3D verdict of a ring left yet." };
  } else if (p.held) {
    return { can: false, why: HELD_NOTE[p.held] };
  }
  const wait = busyWhy(busy);
  return wait === null ? { can: true } : { can: false, why: wait };
}

/** Whether the user's own click can apply a card now (under a click grant), and why not: only staleness and a reply or apply under way stop it. */
export function clickState(p: Proposal, datasetId: string | undefined, busy: boolean): CardState {
  const why = staleWhy(p, datasetId) ?? busyWhy(busy);
  return why === null ? { can: true } : { can: false, why };
}

/** Whether a card is the user's alone to apply: only their own click does, under a click grant (a fact, the edge trim, the symmetry average, the |Q| band, the ion). */
export const needsClick = (p: Proposal): boolean => !!p.held && p.held !== "ring";

/**
 * Whether a card changes the ring removal while no 3D verdict of a ring left
 * stands for it: its main action is then "Check rings in 3D", and "Apply
 * anyway" its click's.
 */
export function ringHeldNow(p: Proposal, ctx: ToolContext | null): boolean {
  if (p.kind !== "setting" && p.kind !== "fact") return false;
  if (!Object.keys(p.change).some((k) => RING_SETTINGS.includes(k))) return false;
  return !ctx || !ringVerdictAllowsChange(ringContext(p, ctx));
}

/**
 * A card's own ring check while it judges the outputs as they are: same
 * dataset, no run started since, none running, and the ring output it judged
 * still the one there (state/ringOutput.ts, the ring gate's own test of a
 * verdict: recomputed since by any run, or dated otherwise in `dataset`, the
 * dataset as it is listed now).
 */
export function currentRingCheck(p: Proposal, dataset?: ToolContext["dataset"]): RingCheck | undefined {
  const check = useDecisionStore.getState().ringChecks[p.id];
  const pipe = usePipelineStore.getState();
  if (!check || check.dataset !== p.dataset || pipe.running || pipe.lastRun !== check.lastRun) return undefined;
  return ringOutputChanged(check.ringOutput, dataset) ? undefined : check;
}

// The card's context, its own ring check, while it stands, as the reply's step the ring gate reads last.
function ringContext(p: Proposal, ctx: ToolContext): ToolContext {
  const base = cardContext(ctx);
  const check = currentRingCheck(p, ctx.dataset);
  return check ? { ...base, replySteps: [check.step] } : base;
}

export const HELD_NOTE: Record<NonNullable<Proposal["held"]>, string> = {
  fact: "A sample fact: set it on Configure, or name it in your message.",
  choice: "Yours to choose: set it on Configure, or name it in your message.",
  symmetry: "Yours to set on Configure.",
  "user-only": "Yours to set on Configure.",
  ring: "Held: no 3D verdict of a ring left yet.",
};

// --------------------------------------------------------------- apply

const message = (e: unknown): string => (e as Error).message.replace(/\.$/, "");

/** What a click that is not the user's own says: a script's, or none. */
export const NOT_YOUR_CLICK = "Not applied: only your own click applies this.";

/**
 * Apply a card on the user's click or key press (`event`, the DOM's own): a
 * card the user alone may act on under a click grant for exactly the values
 * applied (edited, or the card's), made here, in the handler; any other
 * through applyCard as it stands.
 */
export function applyOnClick(p: Proposal, ctx: ToolContext, event: ClickEvent, edited?: Record<string, unknown>): Promise<void> {
  if (p.kind === "run" || !needsClick(p)) return applyCard(p, ctx, edited);
  return withGrant(p, ctx, event, edited);
}

/** "Apply anyway" on a ring change the ring gate holds: the user's click names the setting, under a click grant for exactly the values applied. */
export function applyAnyway(p: Proposal, ctx: ToolContext, event: ClickEvent, edited?: Record<string, unknown>): Promise<void> {
  if (p.kind === "run" || p.kind === "trial") return Promise.resolve();
  return withGrant(p, ctx, event, edited);
}

function withGrant(p: Proposal, ctx: ToolContext, event: ClickEvent, edited: Record<string, unknown> | undefined): Promise<void> {
  const grant = grantForClick(event, { card: p.id, dataset: p.dataset, changes: edited ?? changeOf(p) });
  if (!grant) {
    setNote(p.id, NOT_YOUR_CLICK);
    return Promise.resolve();
  }
  return applyCard(p, ctx, edited, grant);
}

/**
 * Apply a setting or a trial card through update_settings (an edited value in
 * place of the card's, with Edit). With `grant`, the user's click's
 * (applyOnClick, applyAnyway): only for the card it was made for, revoked
 * once the call is made, whatever happened.
 */
export async function applyCard(p: Proposal, ctx: ToolContext, edited?: Record<string, unknown>, grant?: Grant | null): Promise<void> {
  if (p.kind === "run") {
    revokeGrant(grant);
    return runCard(p, ctx);
  }
  try {
    await applyChange(p, ctx, edited, grant ?? null);
  } finally {
    revokeGrant(grant);
  }
}

async function applyChange(p: Proposal, ctx: ToolContext, edited: Record<string, unknown> | undefined, grant: Grant | null): Promise<void> {
  const state = grant ? clickState(p, ctx.dataset.id, false) : cardState(p, ctx.dataset.id, ctx, false);
  if (!state.can) {
    setNote(p.id, state.why || "Not now.");
    return;
  }
  if (grant && !grantIsFor(grant, p.id)) {
    setNote(p.id, NOT_YOUR_CLICK);
    return;
  }
  const changes = edited ?? changeOf(p);
  const keys = [...new Set([...Object.keys(p.fields), ...Object.keys(p.from)])];
  setNote(p.id, null);
  useDecisionStore.setState({ working: p.id });
  try {
    const before = pick(keys);
    let out: { result: unknown };
    // The app's own call: the card's context, and the click's grant where there is one.
    const call: AppCallContext = { ...ringContext(p, ctx), ...(grant ? { grant } : {}) };
    try {
      out = await tool("update_settings").run({ changes }, call, {});
    } catch (e) {
      setNote(p.id, `Not applied: ${message(e)}.`);
      return;
    }
    const r = out.result as { changed?: { setting: string }[]; refused?: { setting: string; why: string }[] };
    if (r.refused?.length) setNote(p.id, `Not applied: ${r.refused.map((x) => x.why).join(" ")}`);
    if (!r.changed?.length) {
      if (!r.refused?.length) setNote(p.id, "Already set.");
      return;
    }
    const after = pick(keys);
    const changedKeys = keys.filter((k) => before[k as keyof PipelineConfig] !== after[k as keyof PipelineConfig]);
    const b = Object.fromEntries(changedKeys.map((k) => [k, before[k as keyof PipelineConfig]])) as Partial<PipelineConfig>;
    const a = Object.fromEntries(changedKeys.map((k) => [k, after[k as keyof PipelineConfig]])) as Partial<PipelineConfig>;
    const shown = edited ? { from: p.shown.from, to: shownTo(p, config()) } : p.shown;
    const runAt = runStageOf(p);
    logDecision({
      proposal: p.id,
      kind: p.kind,
      title: p.title,
      shown,
      action: edited ? "edit-apply" : "apply",
      by: "you",
      at: Date.now(),
      before: b,
      after: a,
      ...(runAt ? { runFrom: runAt } : {}),
      ...(grant ? { byClick: true as const } : {}),
    });
    updateProposal(p.id, { status: "applied", ...(edited ? { shown } : {}) });
    retireCovered(p.dataset, p.id);
    if (runAt) offerRun(p.turn, p.dataset, runAt, changeText(p.title, shown));
  } finally {
    useDecisionStore.setState({ working: null });
  }
}

export const changeText = (title: string, shown: { from: string; to: string }): string => (shown.from ? `${title} ${shown.from} → ${shown.to}` : `${title}: ${shown.to}`);

/**
 * The stage a run after a card's change starts from, with the settings as
 * they are now, the change applied (runStageFor): its settings' own stage (a
 * trial's, its stage), or the symmetry average before it, while the average
 * is on, for a change to what it reads.
 */
function runStageOf(p: Proposal): RunStage | undefined {
  const keys = Object.keys(p.change);
  const own = p.trial?.stage ?? TUNE_STAGES.find((st) => keys.some((k) => cardSetting(k)?.stage === st));
  return runStageFor(keys, own, config());
}

const asText = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));

/** What a card's settings read now, as its line shows them: the |Q| band as one, else each setting's value. */
function shownTo(p: Proposal, s: PipelineConfig): string {
  // A Laue class declared through the symmetry average reads as the class.
  const keys = Object.keys(p.change).filter((k, _i, all) => !(k === "symmetryAverageEnabled" && all.includes("symmetryLaue")));
  if (keys.includes("pdfQMin") && keys.includes("pdfQMax")) return s.pdfQMax ? `${s.pdfQMin ? Number(s.pdfQMin) : 0}–${Number(s.pdfQMax)} Å⁻¹` : "full";
  return keys
    .map((k) => {
      const c = cardSetting(k);
      return c ? asText(c.read(s)) : "";
    })
    .filter(Boolean)
    .join(", ");
}

// --------------------------------------------------------------- the ring check

/**
 * "Check rings in 3D" on a card holding a ring change: assess_stage's rings,
 * run by the app on the card's context, kept with the card (setRingCheck) on
 * the outputs as they now are. A verdict of a ring left opens the ring gate
 * for this card's Apply; none, and "Apply anyway" is the user's. The model's
 * calls never read it: it is no step of the conversation.
 */
export async function checkRings(p: Proposal, ctx: ToolContext): Promise<void> {
  const state = clickState(p, ctx.dataset.id, false);
  if (!state.can) {
    setNote(p.id, state.why || "Not now.");
    return;
  }
  setNote(p.id, null);
  useDecisionStore.setState({ checking: p.id });
  try {
    const lastRun = usePipelineStore.getState().lastRun;
    // The ring output as it stands before the check reads it.
    const ringOutput = ringOutputMark(ctx.dataset);
    const run = await callTool(cardContext(ctx), "assess_stage", { stage: "rings" });
    if (!run.ok) {
      setNote(p.id, `The ring check did not run: ${run.summary.replace(/\.$/, "")}.`);
      return;
    }
    const step: AgentStep = {
      id: `${p.id}:rings`,
      name: "assess_stage",
      args: { stage: "rings" },
      status: "done",
      summary: run.summary,
      result: run.text,
      ...(run.full !== undefined ? { full: run.full } : {}),
      ...(run.outcomes ? { outcomes: run.outcomes } : {}),
    };
    setRingCheck(p.id, { step, dataset: p.dataset, lastRun, ringOutput });
  } finally {
    useDecisionStore.setState({ checking: null });
  }
}

/** The change a decision made, in one line ("punchMinSig 8 → 6"). */
export const decisionText = (d: Pick<Decision, "title" | "shown" | "kind" | "runFrom">): string =>
  d.kind === "run" ? `Ran from ${d.runFrom ? stageTitle(d.runFrom) : "the start"}` : changeText(d.title, d.shown);

/**
 * A Run card after a change: one open Run card per dataset, from the earliest
 * stage any change since calls for (Apply first, then a separate Run card).
 */
export function offerRun(turn: number, dataset: string, stage: RunStage, because: string): void {
  const open = useDecisionStore.getState().proposals.find((p) => p.kind === "run" && p.status === "open" && p.dataset === dataset);
  if (open) {
    const earlier = RUN_STAGES.indexOf(stage) < RUN_STAGES.indexOf(open.runFrom ?? "rings") ? stage : open.runFrom!;
    const reasons = open.shown.to.split("; ").filter(Boolean);
    updateProposal(open.id, {
      runFrom: earlier,
      title: `Run from ${stageTitle(earlier)}`,
      shown: { from: "", to: [...reasons.filter((x) => x !== because), because].join("; ") },
      ...(open.turn < turn ? { turn } : {}),
    });
    return;
  }
  addProposals([runProposal(`P${nextProposalNumber()}`, turn, dataset, stage, because, "apply")]);
}

/**
 * Run the pipeline from the card's stage, through run_pipeline (it opens the
 * Execution page); from the symmetry average, which run_pipeline's from_stage
 * does not name, through its own run (runPipelineFrom).
 */
async function runCard(p: Proposal, ctx: ToolContext): Promise<void> {
  const state = cardState(p, ctx.dataset.id, ctx, false);
  if (!state.can || !p.runFrom) {
    setNote(p.id, (state.can ? "" : state.why) || "Not now.");
    return;
  }
  setNote(p.id, null);
  useDecisionStore.setState({ working: p.id });
  try {
    if (p.runFrom === "symmetry_average") await runPipelineFrom(p.runFrom, cardContext(ctx), {});
    else await tool("run_pipeline").run({ from_stage: p.runFrom }, cardContext(ctx), {});
    logDecision({ proposal: p.id, kind: "run", title: p.title, shown: p.shown, action: "apply", by: "you", at: Date.now(), before: {}, after: {}, runFrom: p.runFrom });
    updateProposal(p.id, { status: "applied" });
  } catch (e) {
    setNote(p.id, `The run did not finish: ${message(e)}.`);
  } finally {
    useDecisionStore.setState({ working: null });
  }
}

/** Dismiss a card: logged, nothing changed. */
export function dismissCard(p: Proposal): void {
  if (p.status !== "open") return;
  logDecision({ proposal: p.id, kind: p.kind, title: p.title, shown: p.shown, action: "dismiss", by: "you", at: Date.now(), before: {}, after: {}, ...(p.runFrom ? { runFrom: p.runFrom } : {}) });
  updateProposal(p.id, { status: "dismissed" });
  setNote(p.id, null);
}

// --------------------------------------------------------------- undo

/** Whether a decision can be undone: a change applied, not undone yet. */
export const undoable = (d: Decision): boolean => (d.action === "apply" || d.action === "edit-apply") && d.kind !== "run" && !d.undoneBy && Object.keys(d.after).length > 0;

/**
 * Undo a decision: put back `before` for exactly its fields, while they still
 * hold `after`; otherwise say so. A change the user's click made (a fact, a
 * setting only they set) is put back on their own click alone (`event`, the
 * DOM's); a change auto mode made is not one. A Run card follows, as after
 * any change. `by`: who undoes it, the user unless auto mode puts back a fix
 * that made a check worse (auto/controller.ts), which it never does to a
 * change a click made.
 */
export function undoDecision(d: Decision, event?: ClickEvent, by: Decision["by"] = "you"): boolean {
  if (!undoable(d)) return false;
  if (d.byClick && (by !== "you" || !isTrustedClick(event))) {
    setNote(d.id, "Undo needs your own click.");
    return false;
  }
  if (!holds(d.after)) {
    setNote(d.id, "Changed since: undo on Configure.");
    return false;
  }
  const pipe = usePipelineStore.getState();
  pipe.patch(d.before);
  noteAgentEdit(Object.keys(d.before) as (keyof PipelineConfig)[]);
  const undo = logDecision({
    proposal: d.proposal,
    kind: d.kind,
    title: d.title,
    shown: { from: d.shown.to, to: d.shown.from || "before" },
    action: "undo",
    by,
    at: Date.now(),
    before: d.after,
    after: d.before,
    ...(d.runFrom ? { runFrom: d.runFrom } : {}),
    undoes: d.id,
    ...(d.byClick ? { byClick: true as const } : {}),
    ...(d.page ? { page: d.page } : {}),
  });
  updateDecision(d.id, { undoneBy: undo.id });
  updateProposal(d.proposal, { status: "undone" });
  setNote(d.id, null);
  const { proposals, decisions } = useDecisionStore.getState();
  const p = proposals.find((x) => x.id === d.proposal);
  if (!d.runFrom || !p) return true;
  // No run since the change: the outputs still follow from the settings put
  // back, so the Run card the change led to loses that reason (and goes, with none left).
  const ranSince = decisions.some((x) => x.kind === "run" && x.action === "apply" && x.at >= d.at);
  const open = proposals.find((x) => x.kind === "run" && x.status === "open" && x.dataset === p.dataset);
  const text = changeText(d.title, d.shown);
  if (!ranSince && open) {
    const reasons = open.shown.to.split("; ").filter((x) => x && x !== text);
    updateProposal(open.id, reasons.length ? { shown: { from: "", to: reasons.join("; ") } } : { status: "dismissed" });
    return true;
  }
  if (ranSince) offerRun(p.turn, p.dataset, d.runFrom, `undid ${text}`);
  return true;
}

/** Undo every change still standing, newest first (those a click made on the user's own click, `event`). */
export function undoAll(event?: ClickEvent): void {
  const ds = [...useDecisionStore.getState().decisions].reverse();
  for (const d of ds) if (undoable(d)) undoDecision(useDecisionStore.getState().decisions.find((x) => x.id === d.id)!, event);
}

// --------------------------------------------------------------- the report

const ACTION_WORD: Record<Decision["action"], string> = { apply: "Applied", "edit-apply": "Edited and applied", dismiss: "Dismissed", undo: "Put back" };

/** Who made a decision, as the record shows it: "you (click)" for a change only the user's own click makes; "auto mode" for auto mode's. */
export const byText = (d: Pick<Decision, "by" | "byClick">): string => (d.by === "auto" ? "auto mode" : d.byClick ? `${d.by} (click)` : d.by);

/** One decision as the report's Decisions section lists it. */
export function decisionLine(d: Decision): string {
  if (d.kind === "run") return d.action === "dismiss" ? `Dismissed ${d.title}` : decisionText(d);
  return `${ACTION_WORD[d.action]} ${changeText(d.title, d.shown)}`;
}

/** The decisions on the dataset's cards, oldest first, for the report. */
export function reportDecisions(datasetId: string): { time: string; by: string; decision: string }[] {
  const { proposals, decisions } = useDecisionStore.getState();
  const mine = new Set(proposals.filter((p) => p.dataset === datasetId).map((p) => p.id));
  return decisions
    .filter((d) => mine.has(d.proposal))
    .map((d) => {
      const t = new Date(d.at);
      return { time: `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`, by: byText(d), decision: decisionLine(d) };
    });
}
