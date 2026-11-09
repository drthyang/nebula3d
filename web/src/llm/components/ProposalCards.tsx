// The Apply cards under a reply (docs/pilot-auto-mode-design.md §1.6): each
// change the reply proposed, from what its tools returned or its answer named
// (apply/proposals.ts), as one line, result first, with its evidence in the
// tool's own numbers and "?" for the rest; Apply, Edit and Dismiss. After a
// decision the card shrinks to one line with Undo. A change applied leads to a
// separate Run card. A card the user alone may act on (a sample fact, a
// setting only they set) applies on their own click alone, which counts as
// them stating the value (a click grant, llm/consent.ts); Edit opens the
// exact values, and the click applies the edited ones. A ring change the ring
// gate holds offers "Check rings in 3D" first, and "Apply anyway", the click's.

import { useState, type SyntheticEvent } from "react";

import { useDatasetStore } from "../../state/datasetStore";
import { enabledStages, STAGES, usePipelineStore } from "../../state/pipelineStore";
import {
  applyAnyway,
  applyCard,
  applyOnClick,
  byText,
  cardState,
  changeText,
  checkRings,
  clickState,
  currentRingCheck,
  dismissCard,
  needsClick,
  ringHeldNow,
  undoDecision,
  undoable,
} from "../apply/actions";
import { useDecisionStore, type Decision } from "../apply/decisions";
import { editedChange, editFields } from "../apply/edit";
import type { Proposal } from "../apply/proposals";
import { useChatStore } from "../chatStore";
import type { ToolContext } from "../tools";
import { goToStep } from "./goToStep";

const KIND_LABEL = (p: Proposal): string =>
  p.kind === "run" ? "Run" : p.kind === "trial" ? "Trial" : p.held === "fact" ? "Sample fact" : needsClick(p) ? "Yours" : "Setting";

const VIA_DETAIL: Record<Proposal["source"]["via"], string> = {
  refused: "update_settings refused this change, so nothing was set.",
  rerun: "update_settings changed the settings and no run followed: the outputs predate them.",
  ask_user: "The run's punch record asks this question; only you can answer it.",
  suggestion: "The tool's own suggestion; the value is yours to set.",
  answer: "Named in the answer with this value, and checked against the settings catalog. No call set it.",
  trial: "A trial of the tuning run.",
  apply: "A change you applied: the outputs predate it.",
  undo: "A change you undid: the outputs predate it.",
  auto: "Auto mode made this, through the model's own update_settings or tune_pipeline call under every guard, or ran it.",
  qr: "You set this on the Q–R page (Use in pipeline).",
};

/** The card's fields as the settings hold them, as one string a store selector can compare. */
const watched = (s: object, p: Proposal): string =>
  Object.keys(p.from)
    .map((k) => String((s as Record<string, unknown>)[k]))
    .join("\u0000");

/** The stages a run from `stage` recomputes, as the Configure page has them switched on. */
function stagesFrom(stage: string): number {
  const pipe = usePipelineStore.getState();
  const at = STAGES.indexOf(stage as (typeof STAGES)[number]);
  return enabledStages(pipe).filter((s) => STAGES.indexOf(s as (typeof STAGES)[number]) >= at).length;
}

function Change({ p }: { p: Proposal }) {
  if (p.kind === "run") return <span className="pc-line">{p.title}</span>;
  return (
    <span className="pc-line">
      {p.title}:
      {p.shown.from ? (
        <>
          {" "}
          <span className="from">{p.shown.from}</span>
          <span className="arrow" aria-label="to">
            →
          </span>
        </>
      ) : (
        " "
      )}
      {p.shown.to}
    </span>
  );
}

/** The line under a card the user alone may act on, and under a ring change held for a 3D verdict. */
const YOURS_NOTE = "Apply counts as you stating this value.";
const RING_NOTE = "No 3D verdict of a ring left yet.";
const RING_CLEAN_NOTE = "The 3D check finds no ring left. Apply anyway counts as you naming this setting.";

function OpenCard({ p, ctx, pinned = false }: { p: Proposal; ctx: ToolContext | null; pinned?: boolean }) {
  const datasetId = useDatasetStore((s) => s.datasetId);
  const busy = useChatStore((s) => s.busy);
  const working = useDecisionStore((s) => s.working);
  const checking = useDecisionStore((s) => s.checking);
  const note = useDecisionStore((s) => s.notes[p.id]);
  // The card's own ring check, and the run it judged: a run since makes it stale.
  useDecisionStore((s) => s.ringChecks[p.id]);
  usePipelineStore((s) => s.lastRun);
  usePipelineStore((s) => s.running);
  // The card's fields as they stand, so it goes stale as they move.
  usePipelineStore((s) => watched(s, p));
  const [details, setDetails] = useState(false);
  const fields = editFields(p);
  const editable = fields.length > 0;
  const [edit, setEdit] = useState<string[] | null>(null);
  const yours = needsClick(p);
  const ring = !yours && ringHeldNow(p, ctx);
  const state = yours || ring ? clickState(p, datasetId, busy) : cardState(p, datasetId, ctx, busy);
  const check = currentRingCheck(p);
  const running = working === p.id;
  const why = state.can ? null : state.why;
  const edited = (): Record<string, unknown> | undefined => (edit !== null ? editedChange(p, edit) : undefined);
  // The user's own click or key press: the DOM's event goes with it, whose isTrusted only the browser sets.
  const apply = (e: SyntheticEvent) => {
    if (!ctx) return;
    void applyOnClick(p, ctx, e.nativeEvent, edited());
  };
  const anyway = (e: SyntheticEvent) => {
    if (ctx) void applyAnyway(p, ctx, e.nativeEvent, edited());
  };
  const line = note ?? why ?? (yours ? (p.what ? `${p.what} ${YOURS_NOTE}` : YOURS_NOTE) : ring ? (check ? RING_CLEAN_NOTE : RING_NOTE) : null);

  return (
    <div className={`pc pc--${p.kind}${yours ? " pc--fact" : ""}`} data-proposal={p.id}>
      <div className="pc-row">
        <span className={`pc-kind pc-kind--${p.kind === "run" ? "run" : yours ? "fact" : p.kind}`}>{KIND_LABEL(p)}</span>
        <Change p={p} />
        {p.kind === "run" ? (
          <span className="pc-note pc-count">
            {stagesFrom(p.runFrom ?? "rings")} stage{stagesFrom(p.runFrom ?? "rings") === 1 ? "" : "s"}
          </span>
        ) : (
          <button
            type="button"
            className="gh-trigger pc-q"
            aria-expanded={details}
            aria-label="Details"
            title="Where this card comes from"
            onClick={() => setDetails((d) => !d)}
          >
            ?
          </button>
        )}
      </div>
      {p.kind === "run" ? (
        <div className="pc-ev">The outputs predate {p.shown.to}.</div>
      ) : p.source.via === "answer" ? (
        <div className="pc-ev">Suggested in the answer.</div>
      ) : (
        p.evidence.map((e) => (
          <div className="pc-ev" key={e.step}>
            {e.text && <>{e.text} · </>}
            <button type="button" className="pc-src" onClick={() => goToStep(p.turn, e.step)} title="Show this step in the chat">
              {e.label}, step {e.n}
            </button>
          </div>
        ))
      )}
      {check && (
        <div className="pc-ev pc-check">
          {check.step.summary} · <span className="pc-check-src">Ring check in 3D, from this card</span>
        </div>
      )}
      {details && (
        <div className="pc-details">
          {VIA_DETAIL[p.source.via]}
          {Object.keys(p.fields).length > 0 && (
            <>
              {" "}
              Sets {Object.entries(p.fields).map(([k, v], i) => (
                <span key={k}>
                  {i ? ", " : ""}
                  <code>{k}</code> = {String(v) || "(default)"}
                </span>
              ))}
              .
            </>
          )}
        </div>
      )}
      {line && <div className="pc-note">{line}</div>}
      {edit !== null && (
        <div className="pc-edit">
          {fields.map((f, i) => {
            const set = (v: string) => setEdit((xs) => (xs ? xs.map((x, j) => (j === i ? v : x)) : xs));
            return (
              <label key={`${f.key}.${f.part ?? ""}`} className="pc-edit-row">
                <span>{f.label}</span>
                {f.options ? (
                  <select value={edit[i]} onChange={(e) => set(e.target.value)} autoFocus={i === 0}>
                    {[...new Set([edit[i], ...f.options])].map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={edit[i]}
                    autoFocus={i === 0}
                    spellCheck={false}
                    onChange={(e) => set(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter applies as the main button does; on a held ring change it does nothing (Apply anyway is a click of its own).
                      if (e.key === "Enter" && ctx && state.can && !ring) apply(e);
                      if (e.key === "Escape") setEdit(null);
                    }}
                  />
                )}
              </label>
            );
          })}
        </div>
      )}
      <div className={`pc-actions${ring ? " pc-actions--ring" : ""}`}>
        {ring ? (
          <>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!state.can || !ctx}
              title={why ?? "Judge the rings in 3D on the outputs as they are (assess_stage rings): a ring left lets this change go ahead"}
              onClick={() => ctx && void checkRings(p, ctx)}
            >
              {checking === p.id ? "Checking…" : "Check rings in 3D"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!state.can || !ctx}
              title={why ?? "Set it without a 3D verdict of a ring left: your click counts as you naming this setting"}
              onClick={anyway}
            >
              {running ? "Applying…" : "Apply anyway"}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={!state.can || !ctx}
            title={why ?? (p.kind === "run" ? "Run the pipeline from this stage, as the Run button does" : yours ? "Set this on the Configure page: your click counts as you stating this value" : "Set this on the Configure page")}
            onClick={apply}
          >
            {running ? (p.kind === "run" ? "Running…" : "Applying…") : p.kind === "run" ? "Run" : "Apply"}
          </button>
        )}
        {editable && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!state.can}
            aria-pressed={edit !== null}
            onClick={() => setEdit((e) => (e === null ? fields.map((f) => f.value) : null))}
          >
            Edit
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-quiet"
          disabled={running}
          onClick={() => dismissCard(p)}
          title={pinned ? "Leave it as it is: the run goes on, and its report lists this as an open question" : undefined}
        >
          {pinned ? "Skip" : "Dismiss"}
        </button>
      </div>
    </div>
  );
}

function DoneCard({ p, decision }: { p: Proposal; decision: Decision | undefined }) {
  const note = useDecisionStore((s) => (decision ? s.notes[decision.id] : undefined));
  const busy = useChatStore((s) => s.busy);
  const text = p.kind === "run" ? p.title : changeText(p.title, decision?.shown ?? p.shown);
  const what =
    p.status === "dismissed"
      ? "dismissed"
      : p.status === "undone"
        ? "undone"
        : p.status === "covered"
          ? "applied with another card"
          : p.kind === "run"
            ? `run by ${decision ? byText(decision) : "you"}`
            : `applied by ${decision ? byText(decision) : "you"}`;
  return (
    <div className={`pc-done pc-done--${p.status}`} data-proposal={p.id}>
      <span className="ok" aria-hidden="true">
        {p.status === "applied" || p.status === "covered" ? "✓" : p.status === "undone" ? "↶" : "–"}
      </span>
      <span className="pc-done-text">
        <b>{text}</b> · {what}
        {note && <span className="pc-note"> · {note}</span>}
      </span>
      {decision && undoable(decision) && (
        <button type="button" className="pc-link" disabled={busy} onClick={(e) => undoDecision(decision, e.nativeEvent)}>
          Undo
        </button>
      )}
    </div>
  );
}

/** The cards one reply led to, under its answer; none: nothing. */
export function ProposalCards({ turn, ctx }: { turn: number; ctx: ToolContext | null }) {
  const proposals = useDecisionStore((s) => s.proposals);
  const decisions = useDecisionStore((s) => s.decisions);
  const mine = proposals.filter((p) => p.turn === turn && p.kind !== "trial");
  if (!mine.length) return null;
  const applied = (p: Proposal) => [...decisions].reverse().find((d) => d.proposal === p.id && (d.action === "apply" || d.action === "edit-apply"));
  return (
    <section className="pc-group" aria-label="Proposed changes">
      <div className="pc-group-head">Proposed changes · {mine.length}</div>
      {mine.map((p) => (p.status === "open" ? <OpenCard key={p.id} p={p} ctx={ctx} /> : <DoneCard key={p.id} p={p} decision={applied(p)} />))}
    </section>
  );
}

/**
 * One card by its id, wherever it was made: the fact an auto run waits for,
 * pinned in the Auto panel (AutoPanel.tsx). Its Apply is the card's own, on
 * the user's click; Skip (the card's Dismiss) declines it.
 */
export function PinnedCard({ id, ctx }: { id: string; ctx: ToolContext | null }) {
  const p = useDecisionStore((s) => s.proposals.find((x) => x.id === id));
  if (!p || p.status !== "open") return null;
  return <OpenCard p={p} ctx={ctx} pinned />;
}

/** A tuning trial's Apply, on its row (TuneProgress): its settings onto the Configure page. */
export function TrialApply({ turn, stage, n, ctx }: { turn: number | null; stage: string; n: number; ctx: ToolContext | null }) {
  const p = useDecisionStore((s) => s.proposals.find((x) => x.kind === "trial" && x.turn === turn && x.trial?.stage === stage && x.trial.n === n));
  const decision = useDecisionStore((s) => (p ? [...s.decisions].reverse().find((d) => d.proposal === p.id && d.action !== "dismiss" && d.action !== "undo") : undefined));
  const note = useDecisionStore((s) => (p ? s.notes[p.id] : undefined));
  const datasetId = useDatasetStore((s) => s.datasetId);
  const busy = useChatStore((s) => s.busy);
  usePipelineStore((s) => (p ? watched(s, p) : ""));
  if (!p) return null;
  if (p.status === "applied" && decision) {
    return (
      <span className="tune-apply">
        applied
        {undoable(decision) && (
          <button type="button" className="pc-link" disabled={busy} onClick={(e) => undoDecision(decision, e.nativeEvent)}>
            Undo
          </button>
        )}
      </span>
    );
  }
  if (p.status !== "open") return null;
  const state = cardState(p, datasetId, ctx, busy);
  return (
    <span className="tune-apply">
      {note && <span className="pc-note">{note}</span>}
      <button
        type="button"
        className="btn btn-ghost tune-apply-btn"
        disabled={!state.can || !ctx}
        title={state.can ? "Put this trial's settings on the Configure page" : state.why}
        onClick={() => ctx && void applyCard(p, ctx)}
      >
        Apply
      </button>
    </span>
  );
}
