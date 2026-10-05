import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useDatasets, useHealth } from "./api/hooks";
import { PYODIDE_MODE } from "./api/pyodideEngine";
import {
  BrandGlyph,
  IconFlow,
  IconLattice,
  IconOrbits,
  IconProfileWave,
  IconRun,
  IconSpark,
  IconTransform,
} from "./components/ui";
import { ViewerImportBanner } from "./components/ViewerImportBanner";
import { AssistantPanel } from "./llm";
import { ConsistencyViewer } from "./pages/ConsistencyViewer";
import { BraggProfileViewer } from "./pages/BraggProfileViewer";
import { DeltaPdfViewer } from "./pages/DeltaPdfViewer";
import { PipelineConfig } from "./pages/PipelineConfig";
import { PipelineExecution } from "./pages/PipelineExecution";
import { ReciprocalViewer } from "./pages/ReciprocalViewer";
import { useDatasetStore, useInitializeDataset } from "./state/datasetStore";
import { usePipelineStore } from "./state/pipelineStore";

export type Tab = "config" | "execution" | "reciprocal" | "bragg" | "dpdf" | "consistency" | "assistant";

// `short` is the label used by the compact top bar (phones and iPad portrait),
// where the nav runs as one row of pills instead of the sidebar list.
const NAV: { id: Tab; label: string; short?: string; desc?: string; icon: ReactNode }[] = [
  {
    id: "config",
    label: "Configure",
    desc: "Set parameters for the full reduction from raw volume to consistency-checked 3D-ΔPDF, then launch a run.",
    icon: <IconFlow />,
  },
  {
    id: "execution",
    label: "Execution",
    desc: "Live progress for the running reduction — per-stage status and the streaming event log.",
    icon: <IconRun />,
  },
  {
    id: "reciprocal",
    label: "Reciprocal cleanup",
    short: "Cleanup",
    desc: "Compare cleanup stages slice-by-slice across the reciprocal-space volume.",
    icon: <IconLattice />,
  },
  {
    id: "bragg",
    label: "Bragg profile",
    short: "Bragg",
    desc: "Fitted radius vs. pad-free measured width for every punched peak across all three reciprocal axes — peaks sagging to the half-voxel floor are resolution-limited.",
    icon: <IconProfileWave />,
  },
  {
    id: "dpdf",
    label: "3D-ΔPDF",
    desc: "Linked orthogonal real-space cuts through the difference pair-distribution function.",
    icon: <IconOrbits />,
  },
  {
    id: "consistency",
    label: "Q–R Band Transform",
    short: "Q–R",
    desc: "Inverse-FFT the ΔPDF back to reciprocal space and compare to the data; band-limit |Q| to separate low- vs high-frequency signal.",
    icon: <IconTransform />,
  },
  {
    id: "assistant",
    label: "AI Assistant",
    short: "Assistant",
    desc: "Ask a local or cloud model to assess the reduction, grounded in metrics from the volumes.",
    icon: <IconSpark />,
  },
];

// Source repository; its README is the entry point to the documentation.
const REPO_URL = "https://github.com/drthyang/nebula3d";

// API status, version, copyright and documentation links.  Sits at the foot of
// the sidebar; in the compact top-bar layout the sidebar copy is hidden and the
// one at the end of <main> shows instead (see "Device layouts" in index.css).
function ConsoleFoot({ className, apiUp }: { className: string; apiUp: boolean }) {
  return (
    <footer className={className}>
      <span className="api-status">
        <span className={`api-dot ${apiUp ? "ok" : "down"}`} />
        {PYODIDE_MODE
          ? "in-browser engine"
          : apiUp
            ? "API connected"
            : "API offline"}
      </span>
      <span className="ver">
        <span className="ver-num">v0.3.0</span>
        <span className="ver-tag">beta</span>
      </span>
      <span className="foot-links">
        <a href={`${REPO_URL}#readme`} target="_blank" rel="noopener noreferrer">
          About &amp; documentation
        </a>
        <span className="sep" aria-hidden="true">·</span>
        <a href={`${REPO_URL}/blob/main/LICENSE`} target="_blank" rel="noopener noreferrer">
          AGPLv3
        </a>
      </span>
      <span className="copyright">© 2026 Tsung-Han Yang</span>
    </footer>
  );
}

function renderPage(tab: Tab, setTab: (t: Tab) => void): ReactNode {
  switch (tab) {
    case "config":
      return <PipelineConfig onStarted={() => setTab("execution")} />;
    case "execution":
      return <PipelineExecution onNavigate={setTab} />;
    case "reciprocal":
      return <ReciprocalViewer />;
    case "bragg":
      return <BraggProfileViewer />;
    case "dpdf":
      return <DeltaPdfViewer />;
    case "consistency":
      return <ConsistencyViewer />;
    case "assistant":
      return <AssistantPanel />;
  }
}

export function App() {
  const [tab, setTab] = useState<Tab>("config");
  // A volume sent by the NeXus Viewer lands on the Configure page.
  const showConfig = useCallback(() => setTab("config"), []);
  const health = useHealth();
  const apiUp = health.isSuccess;
  const running = usePipelineStore((s) => s.running);
  const active = NAV.find((n) => n.id === tab) ?? NAV[0];

  // The dataset is switched here in the sidebar; every page reads it from the
  // shared store — no per-page dataset pickers.
  const datasetsQ = useDatasets();
  const datasets = useMemo(() => datasetsQ.data ?? [], [datasetsQ.data]);
  useInitializeDataset(datasets);
  const datasetId = useDatasetStore((s) => s.datasetId);
  const setDataset = useDatasetStore((s) => s.setDataset);

  // In the compact top bar the nav is a horizontally scrolling row of pills;
  // keep the active one in view when the tab changes (including programmatic
  // switches such as Configure → Execution on launch).
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    const btn = nav?.querySelector<HTMLElement>("button.active");
    if (!nav || !btn || nav.scrollWidth <= nav.clientWidth) return;
    const offset = btn.getBoundingClientRect().left - nav.getBoundingClientRect().left;
    const left = nav.scrollLeft + offset - (nav.clientWidth - btn.offsetWidth) / 2;
    nav.scrollTo({ left: Math.max(0, left) });
  }, [tab]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-glyph">
            <BrandGlyph />
          </span>
          <span className="brand-name">
            <b>nebula3d</b>
          </span>
        </div>

        <div className="sidebar-dataset">
          <span className="sidebar-dataset-label">Dataset</span>
          <div className="sidebar-dataset-control">
            <select
              value={datasetId ?? ""}
              onChange={(e) => setDataset(e.target.value)}
              disabled={!datasets.length}
              aria-label="Dataset"
            >
              {!datasets.length && <option value="">—</option>}
              {datasets.map((d) => (
                <option key={d.id} value={d.id} title={d.raw_name}>
                  {d.temperature ?? d.stem}
                </option>
              ))}
            </select>
            <svg
              className="sidebar-dataset-caret"
              width="12"
              height="12"
              viewBox="0 0 12 12"
              aria-hidden="true"
            >
              <path
                d="M2.5 4.5 6 8l3.5-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>

        <nav className="nav" ref={navRef}>
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              className={n.id === tab ? "active" : ""}
              onClick={() => setTab(n.id)}
            >
              {n.icon}
              <span className="nav-label">{n.label}</span>
              <span className="nav-label-short">{n.short ?? n.label}</span>
              {n.id === "assistant" && <span className="nav-beta">Beta</span>}
              {n.id === "execution" && running && (
                <span className="nav-dot" title="a job is running" />
              )}
            </button>
          ))}
        </nav>

        <ConsoleFoot className="sidebar-foot" apiUp={apiUp} />
      </aside>

      <main className="main">
        <header className="page-head">
          <h2>{active.label}</h2>
          {active.desc && <p>{active.desc}</p>}
        </header>
        <ViewerImportBanner onLoaded={showConfig} />
        {renderPage(tab, setTab)}
        <ConsoleFoot className="main-foot" apiUp={apiUp} />
      </main>
    </div>
  );
}
