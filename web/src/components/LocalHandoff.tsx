// The run-it-locally card: shown where the in-browser engine's limit shows
// itself, it says why in one line with the numbers and gives QUICKSTART's
// native route, which has no such limit (what it says: handoffView.ts; what
// counts as the limit: api/browserLimit.ts).
//
// - Configure: <LocalHandoffNotice />, one card at most: a load the size gate
//   refused, the selected dataset's failed run, or its estimate before a run.
// - Execution: <RunFailureHandoff /> in place of the failed run's banner, and
//   <NearLimitHandoff /> while a run goes, when the memory bar's hint opened it.
// - The memory bar: <NearLimitHint /> under a red bar during a run.
//
// In the browser build only: the native build has no such limit and never
// shows it. A dismissal is remembered per dataset (state/handoffStore.ts); a
// failure whose card was dismissed keeps a link that opens it again. Nothing
// here interrupts a run: no dialog, no focus taken.

import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";

import { checkBeforeRun } from "../api/browserLimit";
import { isMobileDevice } from "../api/device";
import { getEngineMemory, subscribeEngineMemory, type EngineMemory } from "../api/engineMemory";
import { useBootStatus, useDatasets } from "../api/hooks";
import { getLimitSignals, subscribeLimitSignals, type FailedRun, type LimitSignals } from "../api/limitSignals";
import { engine, PYODIDE_MODE } from "../api/pyodideEngine";
import { useDatasetStore } from "../state/datasetStore";
import { useHandoffStore } from "../state/handoffStore";
import { useNavStore } from "../state/navStore";
import { usePipelineStore } from "../state/pipelineStore";
import { WASM_HEAP_CEILING_BYTES } from "../workers/heapReport";
import {
  dataFolderLine,
  datasetKey,
  desktopAppLink,
  leadLine,
  localCommands,
  nearLimitLine,
  PHONE_LINE,
  pickConfigureHandoff,
  PRIVACY_LINE,
  QUICKSTART_URL,
  ROUTE_LINE,
  runLimitOf,
  type HandoffEnv,
} from "./handoffView";
import { engineMemoryView } from "./memoryView";

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

function useLimitSignals(): LimitSignals {
  const [s, setS] = useState<LimitSignals>(getLimitSignals);
  useEffect(() => subscribeLimitSignals(setS), []);
  return s;
}

function useEngineMemory(): EngineMemory {
  const [m, setM] = useState<EngineMemory>(getEngineMemory);
  useEffect(() => subscribeEngineMemory(setM), []);
  return m;
}

/** The device class and the ceilings the card's numbers come from. */
function useHandoffEnv(): HandoffEnv {
  const budget = useEngineMemory().budget;
  return useMemo(
    () => ({
      device: budget?.device ?? (typeof navigator !== "undefined" && isMobileDevice(navigator) ? "mobile" : "desktop"),
      heapCeiling: WASM_HEAP_CEILING_BYTES,
      heapBudget: budget?.heap_budget_bytes ?? null,
      tabBudget: budget?.tab_budget_bytes ?? null,
    }),
    [budget],
  );
}

/** The last run's failure when it is the engine's limit (engine's word, else its log's). */
function useRunLimit(): FailedRun | null {
  const { failedRun } = useLimitSignals();
  const run = usePipelineStore(
    useShallow((s) => ({ terminal: s.terminal, events: s.events, times: s.times, datasetId: s.lastRun?.datasetId ?? null })),
  );
  return useMemo(() => runLimitOf(failedRun, run), [failedRun, run]);
}

/** The size gate's estimate for the selected dataset, when it is over the budget. */
function useBeforeRunLimit(datasetId: string | null, rawSize: number | null) {
  const boot = useBootStatus();
  const running = usePipelineStore((s) => s.running);
  const q = useQuery({
    queryKey: ["browserGate", datasetId, rawSize],
    queryFn: () => checkBeforeRun(datasetId, engine.inspectDataset),
    // Asked of an idle engine only: a run holds the worker's queue.
    enabled: PYODIDE_MODE && Boolean(datasetId) && boot.ready && !running,
    staleTime: Infinity,
    retry: false,
  });
  return q.data ?? null;
}

function useDismissed(key: string | null): boolean {
  return useHandoffStore((s) => (key ? s.dismissed.includes(key) : false));
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

function CopyCommands({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "selected">("idle");
  const pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (state === "idle") return;
    const t = window.setTimeout(() => setState("idle"), 2500);
    return () => window.clearTimeout(t);
  }, [state]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      // No clipboard (an insecure origin, a refused permission): select the
      // commands so a keyboard copy takes them.
      const sel = window.getSelection();
      if (pre.current && sel) {
        const range = document.createRange();
        range.selectNodeContents(pre.current);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      setState("selected");
    }
  };
  return (
    <div className="handoff-cmd">
      <div className="handoff-cmd-head">
        <span className="handoff-cmd-label">Terminal</span>
        <button type="button" className="btn btn-ghost btn-sm handoff-copy" onClick={() => void copy()}>
          {state === "copied" ? "Copied" : state === "selected" ? "Selected: copy it" : "Copy"}
        </button>
      </div>
      <pre ref={pre} className="handoff-cmd-text">
        <code>{text}</code>
      </pre>
    </div>
  );
}

export interface HandoffCardProps {
  lead: string; // why, in one line with the numbers
  heading?: string; // a title above it (the Execution page's "Ring removal failed")
  tone: "error" | "warn";
  fileName?: string | null; // the volume, for where it goes
  device: "desktop" | "mobile";
  detail?: string | null; // the original error, behind "Details"
  onDismiss: () => void;
}

export function HandoffCard({ lead, heading, tone, fileName, device, detail, onDismiss }: HandoffCardProps) {
  const id = useId();
  const commands = localCommands().join("\n");
  const app = desktopAppLink(device); // THY-50: null until the desktop app exists
  return (
    <section className={`handoff handoff--${tone}`} role="status" aria-labelledby={`${id}-lead`}>
      <div className="handoff-head">
        <span className="handoff-ico" aria-hidden="true">
          {tone === "error" ? "✕" : "!"}
        </span>
        <div className="handoff-headtext">
          {heading && <span className="handoff-heading">{heading}</span>}
          <p id={`${id}-lead`} className="handoff-lead">
            {lead}
          </p>
        </div>
        <button type="button" className="gh-close handoff-close" aria-label="Dismiss" title="Dismiss" onClick={onDismiss}>
          ×
        </button>
      </div>
      <div className="handoff-body">
        <p className="handoff-route">{ROUTE_LINE}</p>
        {device === "mobile" && <p className="handoff-route">{PHONE_LINE}</p>}
        {app && (
          <p className="handoff-desktop">
            <a href={app.href} target="_blank" rel="noopener noreferrer">
              {app.label} ↗
            </a>
          </p>
        )}
        <CopyCommands text={commands} />
        <p className="handoff-data">
          {dataFolderLine(fileName)}{" "}
          <a href={QUICKSTART_URL} target="_blank" rel="noopener noreferrer">
            Quickstart ↗
          </a>
        </p>
        <p className="handoff-privacy">{PRIVACY_LINE}</p>
        {detail && (
          <details className="handoff-details">
            <summary>Details</summary>
            <pre>{detail}</pre>
          </details>
        )}
      </div>
    </section>
  );
}

/** What a dismissed card leaves where a failure happened: a link that opens it again. */
function Reopen({ onOpen, children }: { onOpen: () => void; children: ReactNode }) {
  return (
    <p className="handoff-reopen">
      {children}{" "}
      <button type="button" className="handoff-reopen-btn" onClick={onOpen}>
        Run it on your computer ›
      </button>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Configure
// ---------------------------------------------------------------------------

function ConfigureHandoff() {
  const env = useHandoffEnv();
  const { refusedLoad } = useLimitSignals();
  const runLimit = useRunLimit();
  const datasetId = useDatasetStore((s) => s.datasetId);
  const datasets = useDatasets().data;
  const dataset = datasets?.find((d) => d.id === datasetId);
  const beforeRun = useBeforeRunLimit(datasetId ?? null, dataset?.raw_file?.size ?? null);
  const choice = pickConfigureHandoff({
    refusedLoad,
    failedRun: runLimit,
    beforeRun,
    datasetId: datasetId ?? null,
    datasetFile: dataset?.raw_name ?? null,
  });
  const dismissed = useDismissed(choice?.key ?? null);
  const dismiss = useHandoffStore((s) => s.dismiss);
  const reopen = useHandoffStore((s) => s.reopen);
  if (!choice) return null;
  if (dismissed) {
    // A refused load (its status line says so) or a failed run keeps a way
    // back; the estimate does not.
    if (choice.context === "before-run") return null;
    return (
      <Reopen onOpen={() => reopen(choice.key)}>
        {choice.context === "run" ? "The last run hit the in-browser engine's limit." : null}
      </Reopen>
    );
  }
  return (
    <HandoffCard
      lead={leadLine(choice.limit, env, choice.fileName)}
      tone={choice.context === "before-run" ? "warn" : "error"}
      fileName={choice.fileName}
      device={choice.limit.device ?? env.device}
      detail={choice.context === "before-run" ? null : choice.limit.detail}
      onDismiss={() => dismiss(choice.key)}
    />
  );
}

/** The Configure page's mount: renders nothing in the native build. */
export function LocalHandoffNotice() {
  return PYODIDE_MODE ? <ConfigureHandoff /> : null;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

function RunFailureCard({ heading, fallback }: { heading: string; fallback: ReactNode }) {
  const env = useHandoffEnv();
  const runLimit = useRunLimit();
  const files = useDatasets().data;
  const key = runLimit ? datasetKey(runLimit.datasetId) : null;
  const dismissed = useDismissed(key);
  const dismiss = useHandoffStore((s) => s.dismiss);
  const reopen = useHandoffStore((s) => s.reopen);
  if (!runLimit || !key) return <>{fallback}</>;
  if (dismissed) {
    return (
      <>
        {fallback}
        <Reopen onOpen={() => reopen(key)}>This is the in-browser engine's limit.</Reopen>
      </>
    );
  }
  return (
    <HandoffCard
      lead={leadLine(runLimit.limit, env)}
      heading={heading}
      tone="error"
      fileName={files?.find((d) => d.id === runLimit.datasetId)?.raw_name ?? null}
      device={runLimit.limit.device ?? env.device}
      detail={runLimit.limit.detail}
      onDismiss={() => dismiss(key)}
    />
  );
}

/**
 * A failed run's banner on the Execution page, or, when the failure is the
 * in-browser engine's limit, the card in its place (the banner's words behind
 * its "Details").
 */
export function RunFailureHandoff({ heading, children }: { heading: string; children: ReactNode }) {
  return PYODIDE_MODE ? <RunFailureCard heading={heading} fallback={children} /> : <>{children}</>;
}

function NearLimitCard() {
  const env = useHandoffEnv();
  const view = engineMemoryView(useEngineMemory());
  const { running, lastRun } = usePipelineStore(useShallow((s) => ({ running: s.running, lastRun: s.lastRun })));
  const askedFor = useHandoffStore((s) => s.nearLimitRun);
  const hide = useHandoffStore((s) => s.hideNearLimit);
  const files = useDatasets().data;
  if (!running || !view || askedFor === null || askedFor !== lastRun) return null;
  return (
    <HandoffCard
      lead={nearLimitLine(view)}
      tone="warn"
      fileName={files?.find((d) => d.id === lastRun?.datasetId)?.raw_name ?? null}
      device={env.device}
      onDismiss={hide}
    />
  );
}

/** The card the memory bar's hint opened, while that run goes. */
export function NearLimitHandoff() {
  return PYODIDE_MODE ? <NearLimitCard /> : null;
}

// ---------------------------------------------------------------------------
// The memory bar
// ---------------------------------------------------------------------------

/**
 * Under a red memory bar during a run: a soft hint that opens the card on the
 * Execution page. The run goes on; nothing is stopped or asked.
 */
export function NearLimitHint() {
  const running = usePipelineStore((s) => s.running);
  if (!PYODIDE_MODE || !running) return null;
  const open = () => {
    useHandoffStore.getState().showNearLimit(usePipelineStore.getState().lastRun);
    useNavStore.getState().setTab("execution");
  };
  return (
    <button type="button" className="mem-hint" onClick={open} title="How to run it on your computer, where only its memory limits a run">
      Near the browser's limit · run it locally ›
    </button>
  );
}
