// The console's memory bar, in the sidebar's foot beside the API status (and
// in the page's foot in the compact top-bar layout). What it measures, per
// build, is in memoryView.ts; it renders nothing until there is a measurement.
//
// Updates: the in-browser engine's workers push their heaps when they grow
// (workers/heapReport.ts), so nothing polls; the native server is asked every
// 15 s, every 3 s while a run goes, and after each stage a run finishes.

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { fetchServerMemory } from "../api/client";
import { getEngineMemory, subscribeEngineMemory, type EngineMemory } from "../api/engineMemory";
import { PYODIDE_MODE } from "../api/pyodideEngine";
import type { JobEvent } from "../api/types";
import { usePipelineStore } from "../state/pipelineStore";
import { engineMemoryView, serverMemoryView, type MemoryView } from "./memoryView";

const IDLE_MS = 15_000;
const RUNNING_MS = 3_000;

const stageEnds = (events: JobEvent[]): number =>
  events.reduce((n, ev) => n + (ev.stage && (ev.status === "done" || ev.status === "skip") ? 1 : 0), 0);

function useEngineMemory(): EngineMemory {
  const [m, setM] = useState<EngineMemory>(getEngineMemory);
  useEffect(() => subscribeEngineMemory(setM), []);
  return m;
}

function useServerMemory() {
  const running = usePipelineStore((s) => s.running);
  const ended = usePipelineStore((s) => stageEnds(s.events));
  const q = useQuery({
    queryKey: ["memory"],
    queryFn: fetchServerMemory,
    refetchInterval: running ? RUNNING_MS : IDLE_MS,
    retry: false,
  });
  const { refetch } = q;
  useEffect(() => {
    if (ended > 0) void refetch({ cancelRefetch: false }); // both foots share one request
  }, [ended, refetch]);
  return q.isError ? undefined : q.data; // an unreachable server: no stale bar
}

function MemoryMeter({ view }: { view: MemoryView }) {
  return (
    <div
      className={`mem mem--${view.level}`}
      title={view.tooltip}
      tabIndex={0}
      role="meter"
      aria-label={view.title}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, view.percent)}
      aria-valuetext={`${view.amount} (${view.percent}%), ${view.note}`}
    >
      <div className="mem-head">
        <span className="mem-title">{view.title}</span>
        <span className="mem-pct">{view.percent}%</span>
      </div>
      <div className="mem-track" aria-hidden="true">
        <div className="mem-fill" style={{ width: `${view.fraction * 100}%` }} />
      </div>
      <div className="mem-foot">
        <span className="mem-amount">{view.amount}</span>
        <span className="mem-note">{view.note}</span>
      </div>
    </div>
  );
}

function EngineMemoryBar() {
  const view = engineMemoryView(useEngineMemory());
  return view ? <MemoryMeter view={view} /> : null;
}

function ServerMemoryBar() {
  const data = useServerMemory();
  const view = data ? serverMemoryView(data) : null;
  return view ? <MemoryMeter view={view} /> : null;
}

export function MemoryBar() {
  return PYODIDE_MODE ? <EngineMemoryBar /> : <ServerMemoryBar />;
}
