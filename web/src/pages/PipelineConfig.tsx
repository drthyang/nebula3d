// Pipeline configuration page — the form + live algorithm illustrations.  All
// values live in the pipeline store, so navigating away and back never resets
// them; pressing Run kicks off the job (also in the store) and jumps to the
// Execution page via `onStarted`.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useShallow } from "zustand/react/shallow";

import { browseDataRoot, checkModulation, fetchDatasets, fetchMeta, fetchStaleOutputs, fetchVolumeCoverage, setDataRoot } from "../api/client";
import {
  bootPercent,
  engine,
  PYODIDE_MODE,
  type BootStatus,
} from "../api/pyodideEngine";
import { useBootStatus, useDataRoot, useDatasets } from "../api/hooks";
import type { Lattice, StageParamsIn, VolumeMeta } from "../api/types";
import { LaueCompare } from "../components/LaueCompare";
import { PunchPreview } from "../components/PunchPreview";
import { RingModelHelp } from "../components/RingModelHelp";
import type { HklAxis, PunchGeom } from "../components/punchGeometry";
import { boxQMax, metricFromUb, reciprocalMetric } from "../components/reciprocal";
import { Field, HelpTip, RangeSlider, Switch } from "../components/ui";
import { useDatasetStore, useInitializeDataset } from "../state/datasetStore";
import { declaresNone, modulationRequest } from "../state/modulation";
import { formatOp, gridProblem, LAUE_PRESETS, laueGroup, laueSpecOf, METRIC_TOLERANCE, metricChange, presetNamed, ubUnknown, type LaueGroup } from "../state/laue";
import { useAgentEdits, type AgentEdit } from "../state/agentEdits";
import { advancedShown, useConfigViewStore, type AdvancedStage } from "../state/configViewStore";
import {
  DEFAULT_EDGE_TRIM,
  EDGE_TRIM_LAYERS,
  edgeTrimLayers,
  formToParams,
  STAGE_LABELS,
  STAGE_NO,
  usePipelineStore,
  pipelineBusy,
  type PipelineConfig,
} from "../state/pipelineStore";
import { useHighlightKeys } from "../llm/highlight";
import { datasetName } from "../api/datasetName";
import { trackStale } from "../api/stale";
import { useChatStore } from "../llm/chatStore";
import { useMarkStore } from "../state/markStore";
import { captureSession, parseSession, restoreSession, sessionFileName, useSessionNote, type SessionNote } from "../state/session";
import { advancedFields, changedFields, foldsHolding, SECTION_SUMMARY, type SectionStage } from "./configSections";

// The outputs on disk, in pipeline order. The symmetrized volume is the
// optional stage 0's: shown when the stage is on, or its output exists.
const DATASET_STAGE_BADGES = [
  { key: "raw", label: "Raw", group: "Input" },
  { key: "symmetrized", label: "Symmetrized", group: "Input" },
  { key: "ringremoved", label: "Ring removed", group: "Cleanup" },
  { key: "braggpunched", label: "Bragg punched", group: "Cleanup" },
  { key: "backfilled", label: "Backfilled", group: "Cleanup" },
  { key: "flattened", label: "Background corrected", group: "Cleanup" },
  { key: "delta_pdf", label: "3D-ΔPDF", group: "Output" },
] as const;

// Ions with a tabulated form factor for the flatten model (the default is none:
// a constant only) — mirrors nebula3d.preprocessing.form_factor.IONS.
const FLATTEN_IONS = [
  "Tb3+", "Ti3+", "V3+", "V4+", "Cr3+", "Mn2+", "Mn3+", "Mn4+", "Fe2+", "Fe3+",
  "Co2+", "Co3+", "Ni2+", "Ni3+", "Cu2+",
  "Pr3+", "Nd3+", "Gd3+", "Dy3+", "Ho3+", "Er3+", "Tm3+", "Yb3+",
];

// One stage's section, the same for every stage: its head (number, title, one
// plain line, the details behind "?", the Enable stage switch), its settings,
// and its advanced settings folded away (configSections.ts). Disabling a
// stage skips it: its input passes through to the next enabled stage.
function StageSection({
  stage,
  enabled,
  onToggle,
  glow,
  help,
  helpWide = false,
  advanced,
  children,
}: {
  stage: SectionStage;
  enabled: boolean;
  onToggle: (b: boolean) => void;
  glow: boolean; // the agent is on this stage
  help: ReactNode;
  helpWide?: boolean; // a wider bubble (the ring model's formulas)
  advanced?: ReactNode;
  children: ReactNode;
}) {
  const id = `cfg-stage-${stage}`;
  return (
    <section className={`cfg-stage${enabled ? "" : " cfg-stage--off"}${glow ? " ai-glow-within" : ""}`} aria-labelledby={id}>
      <div className="cfg-stage-head">
        <span className="cfg-stage-no">{STAGE_NO[stage]}</span>
        <h4 className="cfg-stage-title" id={id}>
          {STAGE_LABELS[stage]}
        </h4>
        <span className="cfg-stage-summary">{SECTION_SUMMARY[stage]}</span>
        <span className="cfg-stage-end">
          <HelpTip className={helpWide ? "helptip--wide" : undefined}>{help}</HelpTip>
          <span className="cfg-stage-toggle">
            <Switch label="Enable stage" checked={enabled} onChange={onToggle} />
          </span>
        </span>
      </div>
      {children}
      {advanced}
    </section>
  );
}

// A box's head inside a stage: its name, its unit, and its details behind "?".
function BoxHead({ title, unit, help }: { title: string; unit?: string; help?: ReactNode }) {
  return (
    <div className="cfg-box-head">
      <span className="cfg-box-eyebrow">{title}</span>
      {unit && <span className="cfg-box-unit">{unit}</span>}
      {help && <HelpTip>{help}</HelpTip>}
    </div>
  );
}

// A stage's advanced settings, folded away; the fold is remembered per
// browser (state/configViewStore.ts) and, closed, counts the settings in it
// that differ from their defaults, so a change made there (by the agent, a
// restored session) is not missed.
function AdvancedFold({ stage, changed, children }: { stage: AdvancedStage; changed: number; children: ReactNode }) {
  const open = useConfigViewStore((st) => advancedShown(st, stage));
  const setOpen = useConfigViewStore((st) => st.setAdvancedOpen);
  return (
    <details
      className="cfg-advanced"
      open={open}
      // The browser fires toggle when the page opens the fold too (the agent's
      // reveal): only a change from what was rendered is the user's own.
      onToggle={(e) => {
        if (e.currentTarget.open !== open) setOpen(stage, e.currentTarget.open);
      }}
    >
      <summary>
        Advanced
        {changed > 0 && (
          <span className="cfg-advanced-count" title={`${changed} advanced setting${changed === 1 ? "" : "s"} differ${changed === 1 ? "s" : ""} from the default`}>
            {changed} changed
          </span>
        )}
      </summary>
      <div className="cfg-box cfg-advanced-body">{children}</div>
    </details>
  );
}

/** Class names joined, the empty ones left out. */
const cls = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

// The symmetry average's Laue class as the run will read it (state/laue.ts):
// the closed group, and the backend's two checks on the raw volume, its UB's
// metric and its grid.
interface LaueReading {
  group: LaueGroup | null;
  error: string | null; // not a class the run can read
  metric: number | null; // the metric change; null without a UB
  grid: string | null; // why the operations do not map the grid, or null
}

function readLaue(spec: string, meta: VolumeMeta | undefined): LaueReading {
  if (!spec.trim()) return { group: null, error: null, metric: null, grid: null };
  try {
    const group = laueGroup(spec);
    const metric = meta?.ub_matrix && !ubUnknown(meta.ub_matrix) ? metricChange(group.ops, meta.ub_matrix) : null;
    const grid = meta ? gridProblem(group.ops, { shape: meta.shape, ranges: [meta.h_range, meta.k_range, meta.l_range] }) : null;
    return { group, error: null, metric, grid };
  } catch (e) {
    return { group: null, error: (e as Error).message, metric: null, grid: null };
  }
}

const SUPERCELL_TITLE =
  "Supercell factor along this axis that the volume is indexed on (e.g. 2 for a " +
  "2×2×2 reduction). Integer-mode Bragg nodes are then the parent lattice's only; " +
  "use mode 'integer' to keep superstructure diffuse at the other nodes.";

// Parse a numeric form value, falling back to `dflt` for empty/invalid input and
// clamping into [lo, hi] so the preview's overlay stays well-formed while typing.
function clampFloat(raw: string, dflt: number, lo: number, hi: number): number {
  const n = raw === "" ? dflt : Number(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

// The largest |Q| in the volume's box, under the cell's own metric (the
// farthest corner: for a non-orthogonal cell it is not the orthogonal sum).
// The ΔPDF takes the whole box (no crop) unless one is set.
function qSpanFromMeta(meta: {
  h_range: [number, number];
  k_range: [number, number];
  l_range: [number, number];
  lattice: Lattice;
  ub_matrix?: number[][];
} | null | undefined): number {
  if (!meta) return 0;
  const h = Math.max(Math.abs(meta.h_range[0]), Math.abs(meta.h_range[1]));
  const k = Math.max(Math.abs(meta.k_range[0]), Math.abs(meta.k_range[1]));
  const l = Math.max(Math.abs(meta.l_range[0]), Math.abs(meta.l_range[1]));
  const G = metricFromUb(meta.ub_matrix) ?? reciprocalMetric({ ...meta.lattice, a: meta.lattice.a ?? 1, b: meta.lattice.b ?? 1, c: meta.lattice.c ?? 1 });
  return G ? boxQMax(G, [h, k, l]) : 0;
}

// ---------------------------------------------------------------------------
// In-browser boot progress panel (shown during the one-time WASM download)
// ---------------------------------------------------------------------------

const BOOT_PHASE_LABELS: Record<string, string> = {
  runtime: "Downloading Python runtime (~10 MB)…",
  packages: "Loading numpy, scipy, h5py…",
  wheel: "Installing nebula3d package…",
  ready: "Compute engine ready",
  error: "Boot failed",
};

function BootProgressPanel({ status }: { status: BootStatus }) {
  const pct = bootPercent(status);
  const isError = status.phase === "error";
  const isReady = status.phase === "ready";

  return (
    <div className={`boot-panel${isError ? " boot-panel--error" : isReady ? " boot-panel--ready" : ""}`}>
      <div className="boot-panel-icon">
        {isError ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
            <path d="M5 5l4 4M9 5l-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        ) : isReady ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
            <path d="M4.5 7l2 2 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <span className="spin" />
        )}
      </div>
      <div className="boot-panel-body">
        <span className="boot-panel-label">
          {BOOT_PHASE_LABELS[status.phase] ?? status.message}
        </span>
        {!isReady && !isError && (
          <div className="boot-panel-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="boot-panel-fill" style={{ width: `${pct}%` }} />
          </div>
        )}
        {isError && <span className="boot-panel-error">{status.error}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

// Hand a text file to the browser's downloads.
function downloadText(name: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PipelineConfig({ onStarted }: { onStarted: () => void }) {
  const lit = useHighlightKeys();
  const datasetsQ = useDatasets();
  const dataRootQ = useDataRoot();
  const queryClient = useQueryClient();
  const datasets = useMemo(() => datasetsQ.data ?? [], [datasetsQ.data]);
  useInitializeDataset(datasets);
  const datasetId = useDatasetStore((st) => st.datasetId);
  const setDataset = useDatasetStore((st) => st.setDataset);
  const resetDataset = useDatasetStore((st) => st.resetDataset);
  const selectedDataset = datasets.find((d) => d.id === datasetId);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [rootDraft, setRootDraft] = useState("");
  const [rootError, setRootError] = useState<string | null>(null);
  const [rootNote, setRootNote] = useState<string | null>(null);

  // In-browser (Pyodide) mode: the user supplies a volume file that is loaded
  // into the local runtime instead of pointing the server at a data folder.
  const bootStatus = useBootStatus();
  const bootBusy = PYODIDE_MODE && !bootStatus.ready && bootStatus.phase !== "idle";
  const volumeInputRef = useRef<HTMLInputElement>(null);
  const [loadBusy, setLoadBusy] = useState(false);
  const [loadNote, setLoadNote] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadLocalVolume = async (run: () => Promise<string>, label: string) => {
    setLoadBusy(true);
    setLoadError(null);
    setLoadNote(`Loading ${label}… (first load boots the in-browser engine)`);
    try {
      const id = await run();
      await queryClient.invalidateQueries({ queryKey: ["datasets"] });
      setDataset(id);
      setLoadNote(`Loaded ${label}`);
    } catch (e) {
      setLoadNote(null);
      setLoadError((e as Error).message);
    } finally {
      setLoadBusy(false);
    }
  };

  useEffect(() => {
    if (dataRootQ.data?.data_root) setRootDraft(dataRootQ.data.data_root);
  }, [dataRootQ.data?.data_root]);

  const s = usePipelineStore(
    useShallow((st) => ({
      symmetryAverageEnabled: st.symmetryAverageEnabled,
      symmetryLaue: st.symmetryLaue,
      symmetryReaverage: st.symmetryReaverage,
      symmetryAllowMetricChange: st.symmetryAllowMetricChange,
      edgeTrim: st.edgeTrim,
      ringsEnabled: st.ringsEnabled,
      punchEnabled: st.punchEnabled,
      backfillEnabled: st.backfillEnabled,
      flatten: st.flatten,
      pdfEnabled: st.pdfEnabled,
      force: st.force,
      ringModel: st.ringModel,
      ringRadialMode: st.ringRadialMode,
      ringNPatches: st.ringNPatches,
      ringNFourier: st.ringNFourier,
      ringSliceAxis: st.ringSliceAxis,
      ringWidth: st.ringWidth,
      ringGlobalMaterial: st.ringGlobalMaterial,
      ringGlobalSubtraction: st.ringGlobalSubtraction,
      ringGlobalConfidence: st.ringGlobalConfidence,
      ringGlobalLmax: st.ringGlobalLmax,
      ringGlobalMinSnr: st.ringGlobalMinSnr,
      ringPooledSectors: st.ringPooledSectors,
      ringPooledWindow: st.ringPooledWindow,
      punchMinSig: st.punchMinSig,
      punchFootprint: st.punchFootprint,
      punchProfileNSigma: st.punchProfileNSigma,
      punchMode: st.punchMode,
      punchSupercellH: st.punchSupercellH,
      punchSupercellK: st.punchSupercellK,
      punchSupercellL: st.punchSupercellL,
      punchHGuard: st.punchHGuard,
      punchSearchFloor: st.punchSearchFloor,
      modulationK: st.modulationK,
      modulationOrder: st.modulationOrder,
      modulationForm: st.modulationForm,
      modulationHalfWidth: st.modulationHalfWidth,
      punchSearchMaxWidth: st.punchSearchMaxWidth,
      punchFrame: st.punchFrame,
      punchRho: st.punchRho,
      punchTheta: st.punchTheta,
      punchPhi: st.punchPhi,
      punchQA: st.punchQA,
      punchQB: st.punchQB,
      punchQC: st.punchQC,
      punchFitUnconstrained: st.punchFitUnconstrained,
      punchMargin: st.punchMargin,
      incidentBeamQA: st.incidentBeamQA,
      incidentBeamQB: st.incidentBeamQB,
      incidentBeamQC: st.incidentBeamQC,
      incidentBeamMargin: st.incidentBeamMargin,
      incidentBeamFitCovariance: st.incidentBeamFitCovariance,
      punchCutH: st.punchCutH,
      punchCutK: st.punchCutK,
      punchCutL: st.punchCutL,
      backfillMethod: st.backfillMethod,
      flattenEstimator: st.flattenEstimator,
      flattenIon: st.flattenIon,
      flattenQ2: st.flattenQ2,
      flattenFitQMax: st.flattenFitQMax,
      pdfApod: st.pdfApod,
      pdfWindowShape: st.pdfWindowShape,
      pdfWindowSupport: st.pdfWindowSupport,
      pdfQMin: st.pdfQMin,
      pdfQMax: st.pdfQMax,
      running: st.running,
      // Also while a run that lost its connection may still be going on the server.
      busy: pipelineBusy(st),
    })),
  );
  const patch = usePipelineStore((st) => st.patch);
  // A folded section's count of advanced settings changed from their defaults.
  const changed = (stage: SectionStage) =>
    changedFields(s, usePipelineStore.getInitialState(), advancedFields(stage, s)).length;
  const flattenIsModel = s.flattenEstimator === "" || s.flattenEstimator === "model";
  // The agent's changes (state/agentEdits.ts: update_settings, a tuning run's
  // kept settings): the Advanced folds that hold them open, and their fields
  // flash once. The user's own edits and a restored session never come through
  // here. An edit made while the page was closed is shown once when it opens.
  const agentEdit = useAgentEdits((st) => st.last);
  const revealAdvanced = useConfigViewStore((st) => st.revealAdvanced);
  const [flashEdit, setFlashEdit] = useState<AgentEdit | null>(null);
  useEffect(() => {
    if (!agentEdit || agentEdit.seq <= useAgentEdits.getState().shown) return;
    useAgentEdits.getState().markShown(agentEdit.seq);
    revealAdvanced(foldsHolding(agentEdit.fields, usePipelineStore.getState()));
    setFlashEdit(agentEdit);
  }, [agentEdit, revealAdvanced]);
  // Two class names that alternate, so the same field changed again flashes again.
  const flash = (key: keyof PipelineConfig) =>
    flashEdit?.fields.includes(key) ? `cfg-flash cfg-flash-${flashEdit.seq % 2}` : undefined;
  // A stage section another page asked to show (the Execution page's
  // "Symmetrize here"): brought into view once, its first field flashed.
  const focusStage = useConfigViewStore((st) => st.focusStage);
  const [focusFlash, setFocusFlash] = useState(0);
  useEffect(() => {
    if (!focusStage) return;
    useConfigViewStore.getState().setFocusStage(null);
    document.getElementById(`cfg-stage-${focusStage}`)?.closest("section")?.scrollIntoView({ behavior: "smooth", block: "center" });
    setFocusFlash((n) => n + 1);
  }, [focusStage]);
  const run = usePipelineStore((st) => st.run);

  const punchFrame = s.punchFrame === "q" ? "q" : "spherical";
  const sphRadii: [number, number, number] = [
    clampFloat(s.punchRho, 0.097, 0.005, 0.6),
    clampFloat(s.punchTheta, 0.072, 0.005, 0.6),
    clampFloat(s.punchPhi, 0.115, 0.005, 0.6),
  ];
  const punchGeom: PunchGeom = {
    r0: clampFloat(s.punchQA, 0.097, 0.005, 0.6),
    r1: clampFloat(s.punchQB, 0.072, 0.005, 0.6),
    r2: clampFloat(s.punchQC, 0.115, 0.005, 0.6),
    frame: punchFrame,
    sphRadii,
    margin: clampFloat(s.punchMargin, 0.02, 0, 0.5),
    mode: s.punchMode || "both",
    supercell: [
      Math.round(clampFloat(s.punchSupercellH, 1, 1, 12)),
      Math.round(clampFloat(s.punchSupercellK, 1, 1, 12)),
      Math.round(clampFloat(s.punchSupercellL, 1, 1, 12)),
    ],
    isQ: true,
    unit: "Å⁻¹",
    ax: punchFrame === "spherical" ? ["ρ", "θ", "φ"] : ["a*", "b*", "c*"],
    directBeamRadiiQ: [
      clampFloat(s.incidentBeamQA, 0.16, 0.005, 2.0),
      clampFloat(s.incidentBeamQB, 0.30, 0.005, 2.0),
      clampFloat(s.incidentBeamQC, 0.25, 0.005, 2.0),
    ],
    directBeamMargin: clampFloat(s.incidentBeamMargin, 0.0, 0, 1.0),
  };
  // Single reciprocal-space preview for the whole punch → ΔPDF card, sourced
  // from the raw volume (falls back to ringremoved if raw is absent).
  const punchPreviewStage = useMemo(() => {
    if (!selectedDataset) return undefined;
    return (
      selectedDataset.stages.find((stage) => stage.name === "raw" && stage.exists) ??
      selectedDataset.stages.find((stage) => stage.name === "ringremoved" && stage.exists)
    );
  }, [selectedDataset]);
  const punchInputId = punchPreviewStage?.volume_id;
  const punchMetaQ = useQuery({
    queryKey: ["meta", punchInputId, "config-punch"],
    queryFn: () => fetchMeta(punchInputId as string),
    enabled: Boolean(punchInputId),
  });
  // Where the raw counts begin and end in |Q|: past either edge most voxels hold
  // no counts, so the ΔPDF's |Q| band belongs inside them.
  const rawCoverageQ = useQuery({
    queryKey: ["coverage", punchInputId],
    queryFn: () => fetchVolumeCoverage(punchInputId as string),
    enabled: Boolean(punchInputId) && punchPreviewStage?.name === "raw",
    staleTime: Infinity,
  });
  const rawEdges = rawCoverageQ.data;
  // The symmetry average (stage 0), read against the raw volume: the class the
  // run will take and its checks, what the file declares (symmetrized already:
  // the stage passes it through) and what is declared for it ("Use it").
  const rawMeta = punchPreviewStage?.name === "raw" ? punchMetaQ.data : undefined;
  const laue = useMemo(() => readLaue(s.symmetryLaue, rawMeta), [s.symmetryLaue, rawMeta]);
  // "Compare Laue classes" reads the raw volume with the run's settings (its
  // edge trim, punch cell and footprint), and the form's custom class beside
  // the presets.
  const rawVolumeId = punchPreviewStage?.name === "raw" ? punchPreviewStage.volume_id : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `s` changes with every field the run reads
  const compareParams = useMemo(() => formToParams(usePipelineStore.getState()), [s]);
  const compareExtra = useMemo(() => (laue.group?.label === "custom" ? [s.symmetryLaue.trim()] : []), [laue.group, s.symmetryLaue]);
  const declaredOrder = rawMeta?.symmetry_ops?.length ?? 0;
  const passesThrough = declaredOrder > 1 && !s.symmetryReaverage;
  const metricOff = (laue.metric ?? 0) > METRIC_TOLERANCE;
  const laueRefused = !laue.group || laue.group.ops.length < 2 || laue.grid !== null || (metricOff && !s.symmetryAllowMetricChange);
  const symmetrizes = s.symmetryAverageEnabled && !passesThrough && !laueRefused;
  const laueHint = rawMeta?.declared_for ?? null;
  const hintSpec = laueHint ? laueSpecOf(laueHint.symmetry, laueHint.symmetry_ops) : null;
  const lauePreset = presetNamed(s.symmetryLaue);
  const laueNote: { text: string; error: boolean; warn?: boolean } = (() => {
    if (declaredOrder > 1 && !s.symmetryReaverage)
      return {
        text: `The volume declares ${rawMeta?.symmetry || "a symmetry"} (${declaredOrder} operations): it is symmetrized already, so the stage passes it through.`,
        error: false,
      };
    if (laue.error) return { text: `Not a class the run can read: ${laue.error}`, error: true };
    if (!laue.group)
      return s.symmetryAverageEnabled
        ? { text: "Choose the sample's Laue class: the run refuses without one.", error: true }
        : { text: "Averages each voxel with its symmetry equivalents, by the NeXus Viewer's rules.", error: false };
    const n = laue.group.ops.length;
    if (n < 2) return { text: "The identity alone averages nothing: choose the sample's Laue class.", error: true };
    if (laue.grid) return { text: `The run will refuse: ${laue.grid}. Re-bin the volume, or choose a class that fits its grid.`, error: true };
    if (laue.metric !== null && laue.metric > METRIC_TOLERANCE)
      return s.symmetryAllowMetricChange
        ? {
            text: `⚠ These operations change the cell metric by up to ${(100 * laue.metric).toFixed(0)}%, more than 2%: they are not symmetries of this lattice. Proceed despite the metric change is on, so the run averages over them anyway and records a warning.`,
            error: false,
            warn: true,
          }
        : {
            text: `The run will refuse: these operations change the cell metric by up to ${(100 * laue.metric).toFixed(0)}%, more than 2%, so they are not symmetries of this lattice. Check the class and its setting, or see Advanced.`,
            error: true,
          };
    const metric = laue.metric === null ? (rawMeta ? "No UB: the metric is not checked." : "") : `Metric (UB) kept to ${(100 * laue.metric).toFixed(2)}%.`;
    return { text: `${n} operations, pooled with equal weight. ${metric}`.trim(), error: false };
  })();
  // What the sample's modulation as the form declares it protects, from the
  // backend (POST /api/modulation/check): on the punch cell, under the
  // symmetry the volume declares. In the browser build only once the engine
  // is up: typing must not boot it.
  const modulation = modulationRequest(s);
  // With the symmetry average on, the punch sees the stage's group.
  const modulationSymmetry = symmetrizes && laue.group ? laue.group.ops.map((m) => m.map((row) => [...row])) : (punchMetaQ.data?.symmetry_ops ?? null);
  const modulationCheckQ = useQuery({
    queryKey: ["modulation-check", JSON.stringify(modulation ?? null), punchGeom.supercell.join(","), JSON.stringify(modulationSymmetry)],
    queryFn: () => checkModulation({ modulation, cell: punchGeom.supercell, symmetry_ops: modulationSymmetry }),
    enabled: !PYODIDE_MODE || bootStatus.ready,
    staleTime: Infinity,
  });
  // The outputs a run with these settings would make again, and why: the
  // backend's resume rule, from each output's record of what it was made from
  // (its input, the edge trim, the symmetry, its stage's settings). Asked a
  // moment after the form settles and again when a run rewrites the outputs;
  // in the browser build only once the engine is up, and never during a run.
  const runParamsJson = usePipelineStore((st) => JSON.stringify(formToParams(st)));
  const [staleAsk, setStaleAsk] = useState(runParamsJson);
  useEffect(() => {
    const t = setTimeout(() => setStaleAsk(runParamsJson), 300);
    return () => clearTimeout(t);
  }, [runParamsJson]);
  const outputsKey = JSON.stringify((selectedDataset?.stages ?? []).map((x) => [x.name, x.exists, x.mtime ?? null]));
  const hasOutputs = selectedDataset?.stages.some((x) => x.exists && x.name !== "raw") ?? false;
  const staleQ = useQuery({
    queryKey: ["stale-outputs", datasetId, staleAsk, s.flatten, outputsKey],
    queryFn: () =>
      fetchStaleOutputs({ dataset_id: datasetId ?? "", flatten_enabled: s.flatten, params: JSON.parse(staleAsk) as StageParamsIn }),
    enabled: Boolean(datasetId) && hasOutputs && !s.busy && (!PYODIDE_MODE || bootStatus.ready),
    // The last answer for this dataset stands while the next one comes.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === datasetId ? prev : undefined),
    staleTime: Infinity,
    retry: false,
  });
  const modulationChecked = modulationCheckQ.data;
  const modulationNote = !modulationChecked
    ? "The sample's modulation, a fact about the sample: the off-lattice search leaves alone the satellites G ± m·k it implies, or the planes through them."
    : modulationChecked.ok
      ? `${modulationChecked.default ? "Blank, the backend's default: " : declaresNone(s.modulationK) ? "" : "Protects "}${modulationChecked.description}.`
      : `Not a declaration the run can read: ${modulationChecked.error}.`;
  const punchCuts: Record<HklAxis, number> = {
    H: s.punchCutH,
    K: s.punchCutK,
    L: s.punchCutL,
  };
  const pdfQSpanMax = Math.ceil(qSpanFromMeta(punchMetaQ.data) * 20) / 20;
  const pdfQMin = s.pdfQMin ? Number(s.pdfQMin) : 0;
  const pdfQMax = s.pdfQMax ? Number(s.pdfQMax) : pdfQSpanMax;
  const pdfQBandIsFull = !s.pdfQMin && !s.pdfQMax;

  const updatePdfQBand = (lo: number, hi: number) => {
    if (!pdfQSpanMax) return;
    const nextLo = Math.max(0, Math.min(lo, pdfQSpanMax));
    const nextHi = Math.max(nextLo, Math.min(hi, pdfQSpanMax));
    const isFull = nextLo <= 0 && Math.abs(nextHi - pdfQSpanMax) < 0.025;
    patch({
      pdfQMin: isFull ? "" : nextLo.toFixed(2),
      pdfQMax: isFull ? "" : nextHi.toFixed(2),
    });
  };

  const onRun = async () => {
    // Jump to the Execution page as soon as the job starts (run() streams
    // progress into the store for the whole run), not after it finishes.
    onStarted();
    await run();
  };

  // Save the analysis to a file, and bring one back (state/session.ts): the
  // settings, the last run, the Pilot conversation; outputs that are not
  // here any more are recomputed on request.
  const sessionInputRef = useRef<HTMLInputElement>(null);
  const chatBusy = useChatStore((st) => st.busy);
  const sessionNote = useSessionNote((st) => st.note);
  const setSessionNote = useSessionNote((st) => st.setNote);
  const onSaveSession = async () => {
    // The outputs as they are now, not as last fetched.
    let now = datasets;
    try {
      now = await queryClient.fetchQuery({ queryKey: ["datasets"], queryFn: fetchDatasets, staleTime: 0 });
    } catch {
      // the server is unreachable: save what the page knows
    }
    const session = captureSession(now.find((d) => d.id === datasetId));
    downloadText(sessionFileName(session), "application/json", JSON.stringify(session, null, 1));
    const marks = session.marks.length ? `, its marked regions (${session.marks.length})` : "";
    setSessionNote({ kind: "ok", text: `Saved ${sessionFileName(session)}: the settings, the last run, the NEBULA Pilot conversation${marks} and the outputs present (${session.outputs.length}). The outputs themselves stay here; restoring recomputes any that are gone.` });
  };
  const onRestoreSession = async (file: File) => {
    try {
      const session = parseSession(await file.text());
      // It replaces the conversation and the run's log: ask first when there
      // is one to lose.
      const turns = useChatStore.getState().turns.length;
      const logged = usePipelineStore.getState().events.length;
      const marked = useMarkStore.getState().marks.length;
      if (turns || logged || marked) {
        const losing = [
          turns ? `the NEBULA Pilot conversation (${turns} message${turns === 1 ? "" : "s"})` : "",
          marked ? `the marked regions (${marked})` : "",
          logged ? "the last run's log" : "",
        ].filter(Boolean).join(", ").replace(/, ([^,]*)$/, " and $1");
        if (!window.confirm(`Restoring ${file.name} replaces ${losing} with the session's. Restore it?`)) return;
      }
      // The outputs as they are now, not as last fetched.
      const now = await queryClient.fetchQuery({ queryKey: ["datasets"], queryFn: fetchDatasets, staleTime: 0 });
      const label = (o: string) => DATASET_STAGE_BADGES.find((b) => b.key === o)?.label ?? o;
      const result = restoreSession(session, now, label);
      const when = session.saved ? new Date(session.saved).toLocaleString() : "earlier";
      if (!result.datasetFound) {
        setSessionNote({
          kind: "warn",
          text: PYODIDE_MODE
            ? `This session's input, ${session.dataset?.rawName || session.dataset?.id}, is not loaded. Load it (Load volume…), then restore the session again.`
            : `This session's input, ${session.dataset?.rawName || session.dataset?.id}, is not in this data folder. Point the data folder at the one that holds it, then restore the session again.`,
        });
        return;
      }
      const missing = result.missing.length
        ? ` ${result.missing.length} of the outputs it had are not here: ${result.missing.map(label).join(", ")}.`
        : "";
      const warnings = result.warnings.length ? ` ${result.warnings.join(" ")}` : "";
      setSessionNote({
        kind: result.missing.length || result.warnings.length ? "warn" : "ok",
        text: `Restored ${result.restored.join(", ")} from the session saved ${when}.${missing}${warnings}`,
        ...(result.recompute.length && session.dataset
          ? { recompute: { datasetId: session.dataset.id, stages: result.recompute, ...(result.recomputeWith ?? {}) } }
          : {}),
      });
    } catch (e) {
      setSessionNote({ kind: "error", text: `${file.name}: ${(e as Error).message}` });
    }
  };
  const onRecompute = async ({ datasetId, stages, params, flattenEnabled }: NonNullable<SessionNote["recompute"]>) => {
    setSessionNote(null);
    onStarted();
    // With the settings of the run that made the outputs, when the session
    // knows them (params), else the form's.
    await usePipelineStore.getState().runStages(stages, { datasetId, force: true, params, flattenEnabled });
  };

  const applyDataRoot = async () => {
    const nextRoot = rootDraft.trim();
    if (!nextRoot) return;
    setRootError(null);
    setRootNote(null);
    try {
      const next = await setDataRoot(nextRoot);
      setRootDraft(next.data_root);
      resetDataset();
      await queryClient.invalidateQueries();
      setRootNote(`${next.n_datasets} datasets`);
    } catch (e) {
      setRootError((e as Error).message);
    }
  };

  const onBrowseFolder = async () => {
    setRootError(null);
    setRootNote("Opening folder picker…");
    try {
      const next = await browseDataRoot();
      setRootDraft(next.data_root);
      resetDataset();
      await queryClient.invalidateQueries();
      setRootNote(`${next.n_datasets} datasets`);
    } catch (e) {
      const message = (e as Error).message;
      if (message.startsWith("409 ")) {
        setRootNote(null);
        return;
      }
      if (
        message.startsWith("404 ") ||
        message.startsWith("405 ") ||
        message.includes("Failed to fetch")
      ) {
        setRootNote(null);
        folderInputRef.current?.click();
        return;
      }
      setRootNote(null);
      setRootError(message);
    }
  };

  const onFolderPicked = (files: FileList | null) => {
    const first = files?.[0] as (File & { path?: string }) | undefined;
    if (!first) return;
    const rel = first.webkitRelativePath;
    const folderName = rel.split("/")[0] || first.name;
    if (first.path && rel && first.path.endsWith(rel)) {
      const root = first.path.slice(0, first.path.length - rel.length).replace(/[\\/]$/, "");
      setRootDraft(root);
      setRootNote(`Selected ${folderName}`);
      setRootError(null);
    } else {
      setRootNote(`Selected ${folderName}`);
      setRootError("This browser cannot share the full folder path. Paste it, then apply.");
    }
    if (folderInputRef.current) folderInputRef.current.value = "";
  };

  const stale = trackStale(selectedDataset?.stages ?? [], hasOutputs ? staleQ.data?.stale : undefined);
  const stageStatus = DATASET_STAGE_BADGES.map((stage) => ({
    ...stage,
    exists: selectedDataset?.stages.some((s) => s.name === stage.key && s.exists) ?? false,
    stale: stale.get(stage.key),
  })).filter((stage) => stage.key !== "symmetrized" || stage.exists || s.symmetryAverageEnabled);
  const badgeLabel = (key: string) => DATASET_STAGE_BADGES.find((b) => b.key === key)?.label ?? key;
  const rootStatus = rootError
    ? rootError
    : rootNote ??
      (dataRootQ.data
        ? `${dataRootQ.data.raw_exists ? "raw" : "no raw"} · ${dataRootQ.data.processed_exists ? "processed" : "no processed"} · ${dataRootQ.data.n_datasets} datasets`
        : " ");

  return (
    <div className="config-page">
      {/* ------------------------------------------------- run and session controls:
          the page's top-level actions, above the cards */}
      <div className="config-toolbar" role="toolbar" aria-label="Run and session">
        <div className="config-toolbar-run">
          <Switch
            label="Force"
            checked={s.force}
            onChange={(v) => patch({ force: v })}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={onRun}
            disabled={s.busy || !datasetId}
            title={s.busy && !s.running ? "The last run lost its connection to the server and may still be going there: wait until it is heard from (Execution page)" : undefined}
          >
            {s.running && <span className="spin" />}
            {s.running ? "Running…" : s.busy ? "Waiting for the last run…" : "Run pipeline"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onStarted}
            disabled={!s.busy}
          >
            View execution →
          </button>
        </div>
        <div className="config-toolbar-session">
          <input
            ref={sessionInputRef}
            type="file"
            accept=".json,application/json"
            className="visually-hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onRestoreSession(f);
              if (sessionInputRef.current) sessionInputRef.current.value = "";
            }}
          />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void onSaveSession()}
            title="Save the settings, the last run's log, the outputs present and the NEBULA Pilot conversation to a file"
          >
            Save session
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => sessionInputRef.current?.click()}
            disabled={s.busy || chatBusy}
            title={s.busy || chatBusy ? "Wait for the run or the reply to finish" : "Bring back a saved session: its settings, last run and conversation"}
          >
            Restore session…
          </button>
        </div>
      </div>
      {sessionNote && (
        <div className={`session-note ${sessionNote.kind}`} role="status">
          <span>{sessionNote.text}</span>
          {sessionNote.recompute && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={s.busy}
              onClick={() => void onRecompute(sessionNote.recompute!)}
            >
              Recompute them
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSessionNote(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {/* ----------------------------------------------------------- data card */}
      <section className="card data-card">
        <div className="card-title-row">
          <h3>Data</h3>
          <span className="card-title-rule" />
        </div>
        <div className="data-card-head">
          <div className="stage-track-wrap">
            <ol className="stage-track" aria-label="Pipeline outputs on disk">
              {stageStatus.map((stage) => {
                const state = stage.stale ? "stale" : stage.exists ? "ok" : "missing";
                return (
                  <li
                    key={stage.key}
                    className={`stage-step ${state}`}
                    title={
                      stage.stale?.kind === "settings"
                        ? `${stage.group} · ${stage.label}: stale (${stage.stale.why}); the next run makes it again.`
                        : stage.stale
                          ? stage.stale.chained
                            ? `${stage.group} · ${stage.label}: stale. It was made from ${badgeLabel(stage.stale.after)}, which is itself stale; run the pipeline from the first stale stage to update it.`
                            : `${stage.group} · ${stage.label}: stale. It is older than ${badgeLabel(stage.stale.after)}, so it was made before that stage last ran; run the pipeline from here to update it.`
                          : `${stage.group} · ${stage.label}: ${stage.exists ? "available" : "missing"}`
                    }
                  >
                    <span className="stage-node" aria-hidden="true" />
                    <span className="stage-name">{stage.label}</span>
                    {state === "ok" ? (
                      <span className="visually-hidden">available</span>
                    ) : (
                      <span className="stage-flag">{state}</span>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
        <div className="data-card-grid">
          {PYODIDE_MODE ? (
            <div className="data-source-panel">
              <Field label="Volume file" grow>
                <div className="data-root-row">
                  <input
                    ref={volumeInputRef}
                    type="file"
                    accept=".nxs,.h5,.hdf5"
                    className="visually-hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void loadLocalVolume(() => engine.loadFile(f), f.name);
                      if (volumeInputRef.current) volumeInputRef.current.value = "";
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={loadBusy || bootBusy}
                    onClick={() => volumeInputRef.current?.click()}
                  >
                    {loadBusy && <span className="spin" />}
                    Load volume…
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={loadBusy || bootBusy}
                    title="Load a simulated volume (synthetic_rocksalt) — not measured data"
                    onClick={() =>
                      void loadLocalVolume(
                        () => engine.loadDemo(),
                        "synthetic demo volume (simulated, not measured data)",
                      )
                    }
                  >
                    Use demo
                  </button>
                </div>
                {bootBusy ? (
                  <BootProgressPanel status={bootStatus} />
                ) : (
                  <span className={`data-root-status${loadError ? " error" : ""}`}>
                    {loadError ??
                      loadNote ??
                      "Your .nxs / .h5 is processed locally in your browser (float32 compute) — nothing is uploaded."}
                  </span>
                )}
              </Field>
            </div>
          ) : (
            <div className="data-source-panel">
              <Field label="Data folder" grow>
                <div className="data-root-row">
                  <input
                    type="text"
                    value={rootDraft}
                    placeholder="/path/to/data"
                    onChange={(e) => {
                      setRootDraft(e.target.value);
                      setRootError(null);
                      setRootNote(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void applyDataRoot();
                    }}
                  />
                  <input
                    ref={folderInputRef}
                    type="file"
                    className="visually-hidden"
                    // @ts-expect-error Chromium directory picker attribute.
                    webkitdirectory=""
                    directory=""
                    multiple
                    onChange={(e) => onFolderPicked(e.target.files)}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void onBrowseFolder()}
                  >
                    Browse
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!rootDraft.trim() || dataRootQ.isFetching}
                    onClick={() => void applyDataRoot()}
                  >
                    Apply
                  </button>
                </div>
                <span className={`data-root-status${rootError ? " error" : ""}`}>
                  {rootStatus}
                </span>
              </Field>
            </div>
          )}

          <div className="dataset-panel">
            <Field label="Dataset">
              <div className="dataset-current" title="Switch datasets from the sidebar">
                {selectedDataset ? datasetName(selectedDataset, datasets) : "—"}
              </div>
            </Field>
            <div className="dataset-meta">
              <span>{selectedDataset?.raw_name ?? "No raw file selected"}</span>
              <span>{datasets.length} datasets in folder · switch in the sidebar</span>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------- preview */}
      <PunchPreview
        datasetId={datasetId}
        inputId={punchInputId}
        sourceName={punchPreviewStage?.name}
        meta={punchMetaQ.data}
        geom={punchGeom}
        cuts={punchCuts}
        onCut={(axis, value) => {
          if (axis === "H") patch({ punchCutH: value });
          else if (axis === "K") patch({ punchCutK: value });
          else patch({ punchCutL: value });
        }}
        bands={[pdfQMin, s.pdfQMax ? pdfQMax : 0]}
        bandText={pdfQBandIsFull ? "full" : `${pdfQMin.toFixed(2)}–${pdfQMax.toFixed(2)} Å⁻¹`}
        footprintText={`${punchFrame === "spherical" ? "ρ, θ, φ" : "a*, b*, c*"} = ${(punchFrame === "spherical" ? sphRadii : [punchGeom.r0, punchGeom.r1, punchGeom.r2]).join(", ")} Å⁻¹`}
      />

      {/* ------------------------------------------------ stage sections */}
      <section className="card cfg-workflow" aria-labelledby="cfg-workflow-title">
        <div className="card-title-row">
          <h3 id="cfg-workflow-title">3D-ΔPDF Workflow</h3>
          <span className="cfg-card-summary">The stages, in the order they run</span>
          <span className="card-title-rule" />
        </div>
        <div className="cfg-stages">
          <StageSection
            stage="symmetry_average"
            enabled={s.symmetryAverageEnabled}
            onToggle={(v) => patch({ symmetryAverageEnabled: v })}
            glow={false}
            help={
              <>
                Optional, and off by default. Averages the raw volume over the sample&apos;s Laue class before the ring
                removal, by the NeXus Viewer&apos;s rules: every voxel takes the equal-weight mean of the measured voxels
                among its symmetry equivalents, so coverage gaps fill from their equivalents. The operations must map
                the grid onto itself, and change the cell&apos;s metric (from the UB) by no more than 2%; otherwise the run
                refuses (Proceed despite the metric change, under Advanced, averages anyway and records a warning). The
                coverage edge is always trimmed first. The output declares the operations, and the stages after it
                treat equivalent voxels alike. A volume that declares a symmetry (a NeXus Viewer export) is symmetrized
                already and passes through. Which class the sample has is yours to say: the NEBULA Pilot may suggest
                one, but does not set it.
              </>
            }
            advanced={
              <AdvancedFold stage="symmetry_average" changed={changed("symmetry_average")}>
                <div className="cfg-fields">
                  <div className="switch-row">
                    <Switch
                      label="Average again"
                      checked={s.symmetryReaverage}
                      title="A volume that declares a symmetry (a NeXus Viewer export) was averaged already and passes through; this averages it again, over the class above. The unsymmetrized volume is the better input."
                      onChange={(v) => patch({ symmetryReaverage: v })}
                    />
                  </div>
                  <div className="switch-row">
                    <Switch
                      label="Proceed despite the metric change"
                      checked={s.symmetryAllowMetricChange}
                      title="Operations that change the cell's metric (from the UB) by more than 2% are not symmetries of this lattice, and the run refuses them. On, it averages over them anyway, pooling voxels at different |Q|, and records a warning in the log and in the stage's output."
                      onChange={(v) => patch({ symmetryAllowMetricChange: v })}
                    />
                  </div>
                </div>
              </AdvancedFold>
            }
          >
            <div className="cfg-stage-grid">
            <div className="cfg-box cfg-box--always">
              <BoxHead
                title="Raw input"
                help={
                  <>
                    Measured voxels next to unmeasured space are only partly covered by the detectors: their
                    normalisation is tiny, and their values can be orders of magnitude off. The edge trim unmeasures every
                    measured voxel within that many voxels (the (2N+1)³ box around it) of an unmeasured or NaN voxel; the
                    volume&apos;s own faces are not an edge. It is the NeXus Viewer&apos;s &quot;Edge erosion&quot;, the
                    same rule voxel for voxel, and it applies to the raw input before every stage, whether or not the
                    symmetry average is on (an input that declares a symmetry is trimmed across each orbit, so it stays
                    symmetric). &quot;Compare Laue classes&quot; reads the raw input with this trim too. A change applies to
                    the outputs made after it: switch on Force to remake those already on disk.
                  </>
                }
              />
              <div className="cfg-fields">
                <Field className={flash("edgeTrim")} label="Edge trim">
                  <select
                    aria-label="Edge trim"
                    value={String(edgeTrimLayers(s))}
                    title="Voxel layers taken off the raw input's coverage edge (the NeXus Viewer's edge erosion)"
                    onChange={(e) => patch({ edgeTrim: Number(e.target.value) === DEFAULT_EDGE_TRIM ? "" : e.target.value })}
                  >
                    {EDGE_TRIM_LAYERS.map((n) => (
                      <option key={n} value={n}>
                        {n === 0 ? "None" : `${n} voxel layer${n === 1 ? "" : "s"}`}
                        {n === DEFAULT_EDGE_TRIM ? " (default)" : ""}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <p className="config-note">Drops measured voxels next to unmeasured space in the raw input, whether or not averaging is on.</p>
            </div>
            <div className="cfg-box">
              <BoxHead title="Laue class" />
              <div className="cfg-fields">
                <Field className={focusFlash ? `cfg-flash cfg-flash-${focusFlash % 2}` : flash("symmetryLaue")} label="Laue class">
                  <select
                    value={lauePreset ? lauePreset[0] : s.symmetryLaue.trim() ? "custom" : ""}
                    title="The sample's Laue class: trigonal and hexagonal classes are on hexagonal axes"
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "custom") patch({ symmetryLaue: lauePreset ? lauePreset[1] : s.symmetryLaue });
                      else patch({ symmetryLaue: v });
                    }}
                  >
                    <option value="">Choose…</option>
                    {LAUE_PRESETS.filter(([name]) => name !== "1").map(([name]) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                    <option value="custom">Custom generators</option>
                  </select>
                </Field>
                <Field label="Generators" grow>
                  <input
                    type="text"
                    spellCheck={false}
                    value={lauePreset ? lauePreset[1] : s.symmetryLaue}
                    placeholder="h+k,-h,l; -k,-h,-l; -h,-k,-l"
                    title='Operations on reflections, like coordinate triplets ("h+k,-h,l"; real-space "x-y,x,z" too), separated by ";". They are closed into a group.'
                    onChange={(e) => patch({ symmetryLaue: e.target.value })}
                  />
                </Field>
              </div>
              <p
                className={cls("config-note", laueNote.error && s.symmetryAverageEnabled && "config-note--error", laueNote.warn && "config-note--warn")}
                role="status"
              >
                {laueNote.text}
                {laueHint && hintSpec !== s.symmetryLaue.trim() && declaredOrder < 2 && (
                  <>
                    {" "}
                    {laueHint.symmetry} is declared for this volume by {laueHint.from}.{" "}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => patch({ symmetryLaue: hintSpec ?? "" })}>
                      Use it
                    </button>
                  </>
                )}
              </p>
              {laue.group && laue.group.ops.length > 1 && (
                <details className="cfg-ops">
                  <summary>{laue.group.ops.length} operations</summary>
                  <code>{laue.group.ops.map(formatOp).join("   ")}</code>
                </details>
              )}
            </div>
            <div className="cfg-box cfg-box--always cfg-box--wide">
              <BoxHead title="Which class: the evidence" />
              <LaueCompare
                volumeId={rawVolumeId}
                params={compareParams}
                extra={compareExtra}
                currentSpec={s.symmetryLaue}
                onPick={(spec) => patch({ symmetryLaue: spec })}
                disabled={s.running}
              />
            </div>
            </div>
          </StageSection>

          <StageSection
            stage="rings"
            enabled={s.ringsEnabled}
            onToggle={(v) => patch({ ringsEnabled: v })}
            glow={lit.includes("rings")}
            helpWide
            help={
              <RingModelHelp
                model={s.ringModel}
                sectors={s.ringPooledSectors}
                window={s.ringPooledWindow}
                fourier={s.ringNFourier}
                patches={s.ringNPatches}
                lmax={s.ringGlobalLmax}
              />
            }
            advanced={
              <AdvancedFold stage="rings" changed={changed("rings")}>
                <div className="cfg-fields">
                  {s.ringModel !== "global_v2" && (
                    <Field className={flash("ringSliceAxis")} label="Slice axis">
                      <select
                        value={s.ringSliceAxis}
                        title="Stack axis: the planes the per-plane models fit one by one, and that the pooled model pools across"
                        onChange={(e) => patch({ ringSliceAxis: e.target.value })}
                      >
                        <option value="H">H · fit 0kl planes</option>
                        <option value="K">K · fit h0l planes</option>
                        <option value="L">L · fit hk0 planes</option>
                      </select>
                    </Field>
                  )}
                  {s.ringModel === "pooled" && (
                    <>
                      <Field className={flash("ringPooledSectors")} label="Sectors (n)">
                        <input
                          type="number"
                          min="8"
                          step="1"
                          placeholder="72"
                          value={s.ringPooledSectors}
                          title="Azimuthal sectors each plane's radial profiles are read in (72 = 5° each)"
                          onChange={(e) => patch({ ringPooledSectors: e.target.value })}
                        />
                      </Field>
                      <Field className={flash("ringPooledWindow")} label="Stack window (°)">
                        <input
                          type="number"
                          min="0.5"
                          step="0.5"
                          placeholder="5"
                          value={s.ringPooledWindow}
                          title="Half-width, as an angle on the ring sphere, of the neighbouring planes pooled with each plane (the plane window widens with |Q|)"
                          onChange={(e) => patch({ ringPooledWindow: e.target.value })}
                        />
                      </Field>
                    </>
                  )}
                  {s.ringModel === "global_v2" && (
                    <>
                      <Field className={flash("ringGlobalConfidence")} label="Confidence z">
                        <input
                          type="number"
                          min="0"
                          step="0.25"
                          value={s.ringGlobalConfidence}
                          title="Conservative subtraction removes max(mean − z·sigma, 0). Higher retains more uncertain intensity."
                          onChange={(e) => patch({ ringGlobalConfidence: e.target.value })}
                        />
                      </Field>
                      <Field className={flash("ringGlobalLmax")} label="Angular degree">
                        <input
                          type="number"
                          min="0"
                          max="8"
                          step="1"
                          value={s.ringGlobalLmax}
                          title="Maximum real-spherical-harmonic degree for the full 3D shell texture."
                          onChange={(e) => patch({ ringGlobalLmax: e.target.value })}
                        />
                      </Field>
                      <Field className={flash("ringGlobalMinSnr")} label="Minimum SNR">
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={s.ringGlobalMinSnr}
                          title="Minimum global radial-profile signal-to-noise ratio required to fit a shell."
                          onChange={(e) => patch({ ringGlobalMinSnr: e.target.value })}
                        />
                      </Field>
                      <Field className={flash("ringWidth")} label="Max FWHM (Å⁻¹)">
                        <input
                          type="number"
                          min="0.02"
                          step="0.02"
                          placeholder="0.24"
                          value={s.ringWidth}
                          title="Broader radial features are retained as possible sample diffuse scattering."
                          onChange={(e) => patch({ ringWidth: e.target.value })}
                        />
                      </Field>
                    </>
                  )}
                  {s.ringModel === "parametric" && (
                    <Field className={flash("ringWidth")} label={s.ringRadialMode === "rolling" ? "Window (Å⁻¹)" : "Ring width (Å⁻¹)"}>
                      <input
                        type="number"
                        min="0.02"
                        step="0.02"
                        placeholder="0.24"
                        value={s.ringWidth}
                        title={
                          s.ringRadialMode === "rolling"
                            ? "Rolling-window half-width in |Q| (Å⁻¹). Thicker = more azimuthal voxels per shell = smoother texture."
                            : "Max powder-ring full width / SNIP baseline window in |Q| (Å⁻¹). Broader features are kept as diffuse."
                        }
                        onChange={(e) => patch({ ringWidth: e.target.value })}
                      />
                    </Field>
                  )}
                  {s.ringModel === "patched" && (
                    <Field className={flash("ringNPatches")} label="Patches (n)">
                      <input
                        type="number"
                        min="4"
                        step="1"
                        placeholder="36"
                        value={s.ringNPatches}
                        title="Number of azimuthal patches the powder rings are divided into"
                        onChange={(e) => patch({ ringNPatches: e.target.value })}
                      />
                    </Field>
                  )}
                  {(s.ringModel === "patched" || s.ringModel === "parametric") && (
                    <Field className={flash("ringNFourier")} label="Fourier order">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="8"
                        value={s.ringNFourier}
                        title="Fourier order of the legacy azimuthal texture T(φ)"
                        onChange={(e) => patch({ ringNFourier: e.target.value })}
                      />
                    </Field>
                  )}
                </div>
              </AdvancedFold>
            }
          >
            <div className="cfg-box">
              <div className="cfg-fields">
                <Field className={flash("ringModel")} label="Model">
                  <select
                    value={s.ringModel}
                    title="Pooled: per-sector radial profiles pooled across neighbouring planes (follows rings whose radius wanders with direction). Global 3D: sample-only spherical-shell inference with uncertainty. Patched/parametric: legacy plane-by-plane models."
                    onChange={(e) => patch({ ringModel: e.target.value })}
                  >
                    <option value="pooled">Pooled 3D sectors</option>
                    <option value="global_v2">Global 3D (sample-only)</option>
                    <option value="patched">Patched (per-patch)</option>
                    <option value="parametric">Parametric (pseudo-Voigt)</option>
                  </select>
                </Field>
                {s.ringModel === "global_v2" && (
                  <>
                    <Field className={flash("ringGlobalMaterial")} label="Material prior">
                      <select
                        value={s.ringGlobalMaterial}
                        title="Auto keeps supported powder shells and labels Al matches. Aluminum keeps only FCC-Al-matched shells. Generic uses no material prior."
                        onChange={(e) => patch({ ringGlobalMaterial: e.target.value })}
                      >
                        <option value="auto">Auto · Al + generic</option>
                        <option value="aluminum">Aluminum FCC only</option>
                        <option value="generic">Material agnostic</option>
                      </select>
                    </Field>
                    <Field className={flash("ringGlobalSubtraction")} label="Subtraction">
                      <select
                        value={s.ringGlobalSubtraction}
                        title="Conservative subtracts the lower confidence bound; Mean subtracts the fitted mean; Diagnose only leaves intensity unchanged."
                        onChange={(e) => patch({ ringGlobalSubtraction: e.target.value })}
                      >
                        <option value="conservative">Conservative</option>
                        <option value="mean">Fitted mean</option>
                        <option value="diagnose_only">Diagnose only</option>
                      </select>
                    </Field>
                  </>
                )}
                {s.ringModel === "parametric" && (
                  <Field className={flash("ringRadialMode")} label="Radial mode">
                    <select
                      value={s.ringRadialMode}
                      title="Rolling: a thick window swept Qmin→Qmax fits a continuous Ring(|Q|) × per-shell texture (no discrete peaks; thicker = smoother). Peaks: detect discrete rings and fit a pseudo-Voigt each."
                      onChange={(e) => patch({ ringRadialMode: e.target.value })}
                    >
                      <option value="rolling">Rolling (continuous)</option>
                      <option value="peaks">Peaks (pseudo-Voigt)</option>
                    </select>
                  </Field>
                )}
              </div>
            </div>
          </StageSection>

          <StageSection
            stage="punch"
            enabled={s.punchEnabled}
            onToggle={(v) => patch({ punchEnabled: v })}
            glow={lit.includes("punch")}
            help={
              <>
                Each Bragg peak and the direct beam are cut out before the transform. Footprint: how far each peak is
                punched; Min σ: the significance a peak must reach; Mode: integer nodes, the |Q|-shell search off the
                lattice, or both. The preview above draws the footprints over the data.
              </>
            }
            advanced={
              <AdvancedFold stage="punch" changed={changed("punch")}>
                <div className="cfg-fields">
                  <Field className={flash("punchProfileNSigma")} label="Profile reach ×σ">
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      placeholder="0.5"
                      value={s.punchProfileNSigma}
                      disabled={s.punchFootprint === "ellipsoid"}
                      title="Own-width and profile-matched footprints: each peak is punched out to where its tail falls to this × the local noise. Lower reaches further down the wings of very strong peaks; higher punches tighter."
                      onChange={(e) => patch({ punchProfileNSigma: e.target.value })}
                    />
                  </Field>
                  <Field className={flash("punchHGuard")} label="H guard (r.l.u.)">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.12"
                      value={s.punchHGuard}
                      title="Integer punches stop this far from their node's H plane, so satellite planes at fractional H (e.g. H = ±1/3) stay unpunched. 0 turns the guard off."
                      onChange={(e) => patch({ punchHGuard: e.target.value })}
                    />
                  </Field>
                  <Field className={flash("punchSearchFloor")} label="Search floor ×σ">
                    <input
                      type="number"
                      step="1"
                      min="1"
                      placeholder="27"
                      value={s.punchSearchFloor}
                      title="Off-lattice search: a peak must stand this many diffuse-scatter units above its shell and its neighbourhood. Lower catches weaker spurious peaks, and risks punching diffuse maxima."
                      onChange={(e) => patch({ punchSearchFloor: e.target.value })}
                    />
                  </Field>
                  <Field className={flash("punchSearchMaxWidth")} label="Search width ×Bragg">
                    <input
                      type="number"
                      step="0.1"
                      min="1"
                      placeholder="off"
                      value={s.punchSearchMaxWidth}
                      title="Off-lattice search: leave a candidate broader than this × the dataset's Bragg width (along any axis) as diffuse — a short-range-order maximum, not a spurious reflection. Spurious peaks are as sharp as Bragg peaks; 2 keeps them punched. Blank punches every candidate."
                      onChange={(e) => patch({ punchSearchMaxWidth: e.target.value })}
                    />
                  </Field>
                  <div className={cls("switch-row", flash("punchFitUnconstrained"))}>
                    <Switch
                      label="Drop fit constraints"
                      checked={s.punchFitUnconstrained}
                      onChange={(v) => patch({ punchFitUnconstrained: v })}
                    />
                    <HelpTip>
                      Each integer Bragg peak&apos;s ellipsoid, tilt included, is fitted from its measured shape in Q.
                      It always contains the resolution ellipsoid (the Bragg footprint) and is capped at a few times
                      it. This switch drops both limits: useful for profile diagnostics, but it can create unstable
                      punch masks on weak or noisy peaks.
                    </HelpTip>
                  </div>
                  <div className={cls("switch-row", flash("incidentBeamFitCovariance"))}>
                    <Switch
                      label="Fit the direct-beam ellipsoid"
                      checked={s.incidentBeamFitCovariance}
                      onChange={(v) => patch({ incidentBeamFitCovariance: v })}
                    />
                    <HelpTip>
                      Fit a tilted ellipsoid to the direct-beam remnant at the origin during punching (analogue of the
                      Bragg footprint fit), floored at the direct-beam radii so it only follows or expands the real
                      beam shape. The preview shows the UB-derived floor; the fitted tilt is best checked in the
                      punched slices.
                    </HelpTip>
                  </div>
                </div>
              </AdvancedFold>
            }
          >
            <div className="cfg-stage-grid">
              <div className="cfg-box">
                <BoxHead title="Detection" />
                <div className="cfg-fields">
                  <Field className={flash("punchFootprint")} label="Footprint">
                    <select
                      value={s.punchFootprint}
                      title="How far each peak is punched. Own width (default): each peak to its own measured width, as far as that peak stays above the noise, so a sharp spike on a broad maximum takes a small punch. Profile-matched: every peak shares the dataset's learned Bragg profile (a consistent width), punched as far as it stays above the noise. Ellipsoid: the fixed resolution ellipsoid below, scaled with intensity."
                      onChange={(e) => patch({ punchFootprint: e.target.value })}
                    >
                      <option value="">Own width (default)</option>
                      <option value="profile">Profile-matched (shared width)</option>
                      <option value="ellipsoid">Ellipsoid</option>
                    </select>
                  </Field>
                  <Field className={flash("punchMinSig")} label="Min σ">
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      placeholder="5"
                      value={s.punchMinSig}
                      title={
                        "Significance a peak must reach, in standard errors of its " +
                        "excess over its own background. Integer nodes are judged by " +
                        "this alone, so it means the same for data of any intensity " +
                        "scale (X-ray rates, neutron counts)."
                      }
                      onChange={(e) => patch({ punchMinSig: e.target.value })}
                    />
                  </Field>
                  <Field className={flash("punchMode")} label="Mode">
                    <select
                      value={s.punchMode}
                      title="Which peaks to punch: integer (the lattice nodes), search (off-lattice peaks found in |Q| shells) or both"
                      onChange={(e) => patch({ punchMode: e.target.value })}
                    >
                      <option value="">both (default)</option>
                      <option value="integer">integer</option>
                      <option value="search">search</option>
                      <option value="both">both</option>
                    </select>
                  </Field>
                </div>
              </div>

              <div className="cfg-box">
                <BoxHead
                  title="Sample"
                  help={
                    <>
                      Facts about the crystal, yours to declare: the supercell the volume is indexed on (Bragg nodes
                      are then the parent lattice&apos;s only), and its modulation, whose satellites G ± m·k the
                      off-lattice search leaves alone.
                    </>
                  }
                />
                <div className="config-grid-3">
                  <Field className={flash("punchSupercellH")} label="Supercell H">
                    <input
                      type="number"
                      step="1"
                      min="1"
                      placeholder="1"
                      value={s.punchSupercellH}
                      title={SUPERCELL_TITLE}
                      onChange={(e) => patch({ punchSupercellH: e.target.value })}
                    />
                  </Field>
                  <Field className={flash("punchSupercellK")} label="Supercell K">
                    <input
                      type="number"
                      step="1"
                      min="1"
                      placeholder="1"
                      value={s.punchSupercellK}
                      title={SUPERCELL_TITLE}
                      onChange={(e) => patch({ punchSupercellK: e.target.value })}
                    />
                  </Field>
                  <Field className={flash("punchSupercellL")} label="Supercell L">
                    <input
                      type="number"
                      step="1"
                      min="1"
                      placeholder="1"
                      value={s.punchSupercellL}
                      title={SUPERCELL_TITLE}
                      onChange={(e) => patch({ punchSupercellL: e.target.value })}
                    />
                  </Field>
                </div>
                <Field className={flash("modulationK")} label="Modulation k (r.l.u.)">
                  <input
                    type="text"
                    placeholder="default"
                    value={s.modulationK}
                    title="The sample's modulation, a fact about the sample: its wave vector k in r.l.u., e.g. 1/3, 0, 0 (several separated by ;). The off-lattice search leaves its satellites G ± m·k alone, at every symmetry-equivalent position. 'none' declares none; blank leaves the backend's default."
                    onChange={(e) => patch({ modulationK: e.target.value })}
                  />
                </Field>
                <div className="config-grid-3">
                  <Field className={flash("modulationForm")} label="Form">
                    <select
                      value={s.modulationForm === "planes" ? "planes" : ""}
                      disabled={!s.modulationK.trim() || declaresNone(s.modulationK)}
                      title="points: each satellite G ± m·k, in a box of ± the width on every axis. planes: the whole planes through the satellites. Yours to declare with k."
                      onChange={(e) => patch({ modulationForm: e.target.value })}
                    >
                      <option value="">points</option>
                      <option value="planes">planes</option>
                    </select>
                  </Field>
                  <Field className={flash("modulationOrder")} label="Order m">
                    <input
                      type="number"
                      step="1"
                      min="1"
                      max="6"
                      placeholder="1"
                      value={s.modulationOrder}
                      disabled={!s.modulationK.trim() || declaresNone(s.modulationK)}
                      title="The highest harmonic m of the satellites G ± m·k, 1 to 6."
                      onChange={(e) => patch({ modulationOrder: e.target.value })}
                    />
                  </Field>
                  <Field className={flash("modulationHalfWidth")} label="± width (r.l.u.)">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.08"
                      value={s.modulationHalfWidth}
                      disabled={!s.modulationK.trim() || declaresNone(s.modulationK)}
                      title="How far from each satellite, or each plane, the search leaves alone (r.l.u.)."
                      onChange={(e) => patch({ modulationHalfWidth: e.target.value })}
                    />
                  </Field>
                </div>
                <p className="config-note">{modulationNote}</p>
              </div>

              <div className="cfg-box">
                <BoxHead
                  title="Bragg footprint"
                  unit="Å⁻¹"
                  help={
                    <>
                      Punch ellipsoid radii in Q-space. <b>Spherical</b> (default) sets axes in the local spherical
                      frame at each peak — r<sub>ρ</sub> radial (along Q̂), r<sub>θ</sub> polar, r<sub>φ</sub> azimuth
                      (c* pole). <b>Reciprocal</b> uses fixed a*, b*, c* axes. This is the resolution ellipsoid: the
                      smallest punch, and the whole punch for peaks without a fit. Blank fields use the validated
                      defaults (0.097, 0.072, 0.115).
                    </>
                  }
                />
                <Field className={flash("punchFrame")} label="Frame">
                  <select
                    value={s.punchFrame || "spherical"}
                    title="Punch ellipsoid axis frame"
                    onChange={(e) => patch({ punchFrame: e.target.value })}
                  >
                    <option value="spherical">spherical (ρ, θ, φ)</option>
                    <option value="q">reciprocal (a*, b*, c*)</option>
                  </select>
                </Field>
                {(s.punchFrame || "spherical") === "spherical" ? (
                  <div className="config-grid-3">
                    <Field className={flash("punchRho")} label={<>r<sub>ρ</sub></>}>
                      <input
                        type="number"
                        step="0.005"
                        min="0"
                        placeholder="0.097"
                        value={s.punchRho}
                        title="Punch half-radius along the radial direction Q̂ (Å⁻¹)"
                        onChange={(e) => patch({ punchRho: e.target.value })}
                      />
                    </Field>
                    <Field className={flash("punchTheta")} label={<>r<sub>θ</sub></>}>
                      <input
                        type="number"
                        step="0.005"
                        min="0"
                        placeholder="0.072"
                        value={s.punchTheta}
                        title="Punch half-radius along the polar tangent (Å⁻¹)"
                        onChange={(e) => patch({ punchTheta: e.target.value })}
                      />
                    </Field>
                    <Field className={flash("punchPhi")} label={<>r<sub>φ</sub></>}>
                      <input
                        type="number"
                        step="0.005"
                        min="0"
                        placeholder="0.115"
                        value={s.punchPhi}
                        title="Punch half-radius along the azimuthal (a*–b* ring) tangent (Å⁻¹)"
                        onChange={(e) => patch({ punchPhi: e.target.value })}
                      />
                    </Field>
                  </div>
                ) : (
                  <div className="config-grid-3">
                    <Field className={flash("punchQA")} label={<>r<sub>a*</sub></>}>
                      <input
                        type="number"
                        step="0.005"
                        min="0"
                        placeholder="0.097"
                        value={s.punchQA}
                        title="Punch half-radius along a* (Å⁻¹)"
                        onChange={(e) => patch({ punchQA: e.target.value })}
                      />
                    </Field>
                    <Field className={flash("punchQB")} label={<>r<sub>b*</sub></>}>
                      <input
                        type="number"
                        step="0.005"
                        min="0"
                        placeholder="0.072"
                        value={s.punchQB}
                        title="Punch half-radius along b* (Å⁻¹)"
                        onChange={(e) => patch({ punchQB: e.target.value })}
                      />
                    </Field>
                    <Field className={flash("punchQC")} label={<>r<sub>c*</sub></>}>
                      <input
                        type="number"
                        step="0.005"
                        min="0"
                        placeholder="0.115"
                        value={s.punchQC}
                        title="Punch half-radius along c* (Å⁻¹)"
                        onChange={(e) => patch({ punchQC: e.target.value })}
                      />
                    </Field>
                  </div>
                )}
                <div className="config-grid-3">
                  <Field className={flash("punchMargin")} label="Margin">
                    <input
                      type="number"
                      step="0.005"
                      min="0"
                      placeholder="0.02"
                      value={s.punchMargin}
                      title="Q-space guard band added to every punch half-radius (Å⁻¹)"
                      onChange={(e) => patch({ punchMargin: e.target.value })}
                    />
                  </Field>
                </div>
              </div>

              <div className="cfg-box">
                <BoxHead
                  title="Direct beam"
                  unit="Å⁻¹"
                  help={
                    <>
                      Origin-centred incident/direct-beam ellipsoid in Q-space, using half-radii along a*, b*, c*. The
                      backend converts these through UB, matching the Bragg footprint geometry.
                    </>
                  }
                />
                <div className="config-grid-3">
                  <Field className={flash("incidentBeamQA")} label={<>r<sub>a*</sub></>}>
                    <input
                      type="number"
                      step="0.005"
                      min="0"
                      placeholder="0.16"
                      value={s.incidentBeamQA}
                      title="Direct-beam half-radius along a* (Å⁻¹)"
                      onChange={(e) => patch({ incidentBeamQA: e.target.value })}
                    />
                  </Field>
                  <Field className={flash("incidentBeamQB")} label={<>r<sub>b*</sub></>}>
                    <input
                      type="number"
                      step="0.005"
                      min="0"
                      placeholder="0.30"
                      value={s.incidentBeamQB}
                      title="Direct-beam half-radius along b* (Å⁻¹)"
                      onChange={(e) => patch({ incidentBeamQB: e.target.value })}
                    />
                  </Field>
                  <Field className={flash("incidentBeamQC")} label={<>r<sub>c*</sub></>}>
                    <input
                      type="number"
                      step="0.005"
                      min="0"
                      placeholder="0.25"
                      value={s.incidentBeamQC}
                      title="Direct-beam half-radius along c* (Å⁻¹)"
                      onChange={(e) => patch({ incidentBeamQC: e.target.value })}
                    />
                  </Field>
                </div>
                <div className="config-grid-3">
                  <Field className={flash("incidentBeamMargin")} label="Margin">
                    <input
                      type="number"
                      step="0.005"
                      min="0"
                      placeholder="0.00"
                      value={s.incidentBeamMargin}
                      title="Q-space guard band added to every direct-beam half-radius (Å⁻¹)"
                      onChange={(e) => patch({ incidentBeamMargin: e.target.value })}
                    />
                  </Field>
                </div>
              </div>
            </div>
          </StageSection>

          <div className="cfg-stage-row">
            <StageSection
              stage="backfill"
              enabled={s.backfillEnabled}
              onToggle={(v) => patch({ backfillEnabled: v })}
              glow={lit.includes("backfill")}
              help={
                <>
                  How punched Bragg / direct-beam holes are filled before the transform, always from the diffuse around
                  each hole. laplace (default) interpolates it smoothly into the hole, from one voxel past the punch
                  edge, and fills that voxel too; local uses the median of the hole&apos;s surrounding shell. q_shell
                  (the |Q|-shell level) is for comparison only: it is biased at the lattice nodes and leaves ΔPDF
                  artefacts at lattice vectors.
                </>
              }
            >
              <div className="cfg-box">
                <div className="cfg-fields">
                  <Field className={flash("backfillMethod")} label="Method">
                    <select value={s.backfillMethod} onChange={(e) => patch({ backfillMethod: e.target.value })}>
                      <option value="">laplace (default)</option>
                      <option value="local">local</option>
                      <option value="q_shell">q_shell</option>
                    </select>
                  </Field>
                </div>
              </div>
            </StageSection>

            <StageSection
              stage="flatten"
              enabled={s.flatten}
              onToggle={(v) => patch({ flatten: v })}
              glow={lit.includes("flatten")}
              help={
                <>
                  Subtracts the isotropic pedestal before the transform. The default model fits const + c·F(Q)² to each
                  |Q| shell&apos;s floor: nuclear incoherent plus single-ion paramagnetic scattering, with F the
                  magnetic ion&apos;s form factor (neutron data only: X-rays carry no magnetic scattering). Both are
                  self scattering, so they only touch the ΔPDF at r ≈ 0. floor and snip subtract a free-form curve and
                  also remove some isotropic diffuse.
                </>
              }
              advanced={
                <AdvancedFold stage="flatten" changed={changed("flatten")}>
                  <div className="cfg-fields">
                    <Field className={flash("flattenFitQMax")} label="Fit to |Q| (Å⁻¹)">
                      <input
                        type="number"
                        step="0.5"
                        min="1"
                        placeholder="10"
                        value={s.flattenFitQMax}
                        disabled={!s.flatten || !flattenIsModel}
                        title="The model is fitted to the shell floors from 0.8 Å⁻¹ up to here. Raise it to the data's coverage when the background keeps changing beyond 10 Å⁻¹."
                        onChange={(e) => patch({ flattenFitQMax: e.target.value })}
                      />
                    </Field>
                    <div className={cls("switch-row", flash("flattenQ2"))}>
                      <Switch label="+ b·Q² term" checked={s.flattenQ2} onChange={(v) => patch({ flattenQ2: v })} />
                      <HelpTip>
                        Adds b·Q² to the model: the smooth rise of the inelastic background (thermal diffuse scattering,
                        Debye–Waller exponent 2W ∝ Q²; with X-rays also Compton scattering). Like the other two terms it
                        varies only on the scale of the whole |Q| range, so it cannot follow a pair correlation&apos;s
                        oscillation. Use it when the floors climb across the coverage.
                      </HelpTip>
                    </div>
                  </div>
                </AdvancedFold>
              }
            >
              <div className="cfg-box">
                <div className="cfg-fields">
                  <Field className={flash("flattenEstimator")} label="Estimator">
                    <select
                      value={s.flattenEstimator}
                      disabled={!s.flatten}
                      onChange={(e) => patch({ flattenEstimator: e.target.value })}
                    >
                      <option value="">model: const + c·F(Q)² (default)</option>
                      <option value="floor">floor</option>
                      <option value="snip">snip</option>
                    </select>
                  </Field>
                  <Field className={flash("flattenIon")} label="Magnetic ion">
                    <select
                      value={s.flattenIon}
                      disabled={!s.flatten || !flattenIsModel}
                      onChange={(e) => patch({ flattenIon: e.target.value })}
                    >
                      <option value="">none: constant only (default)</option>
                      {FLATTEN_IONS.map((ion) => (
                        <option key={ion} value={ion}>
                          {ion}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </div>
            </StageSection>

            <StageSection
              stage="pdf"
              enabled={s.pdfEnabled}
              onToggle={(v) => patch({ pdfEnabled: v })}
              glow={lit.includes("pdf")}
              help={
                <>
                  3D-FFT of the cleaned, backfilled diffuse volume. The apodization window tapers Q-space before the
                  transform to suppress real-space termination ripples; the |Q| band (drawn on the preview) sets the
                  radial window the transform keeps.
                </>
              }
              advanced={
                <AdvancedFold stage="pdf" changed={changed("pdf")}>
                  <div className="cfg-fields">
                    <Field className={flash("pdfWindowShape")} label="Window shape">
                      <select
                        value={s.pdfWindowShape}
                        title="auto: an ellipsoid that respects the lattice symmetry where a per-axis window would break it (hexagonal cells), else per-axis"
                        onChange={(e) => patch({ pdfWindowShape: e.target.value })}
                      >
                        <option value="">auto (default)</option>
                        <option value="separable">per-axis (H × K × L)</option>
                        <option value="ellipsoid">ellipsoid</option>
                      </select>
                    </Field>
                    <div className={cls("switch-row", flash("pdfWindowSupport"))}>
                      <Switch
                        label="Taper to the measured coverage"
                        checked={s.pdfWindowSupport}
                        onChange={(v) => patch({ pdfWindowSupport: v })}
                      />
                      <HelpTip>
                        Voxels the input leaves masked count as no deviation from the mean (ΔI = 0) instead of zero
                        intensity, and where the measured coverage ends inside the box the window becomes an ellipsoid
                        shrunk to it, so it tapers to zero at the coverage edge rather than the box faces. Changes
                        nothing when the whole box holds data.
                      </HelpTip>
                    </div>
                  </div>
                </AdvancedFold>
              }
            >
              <div className="cfg-box">
                <div className="cfg-fields">
                  <Field className={flash("pdfApod")} label="Apodization">
                    <select
                      value={s.pdfApod}
                      title="Q-space window applied before the FFT to suppress termination ripples"
                      onChange={(e) => patch({ pdfApod: e.target.value })}
                    >
                      <option value="">gaussian (default)</option>
                      <option value="hann">hann</option>
                      <option value="none">none</option>
                    </select>
                  </Field>
                  <div className="cfg-qband">
                    <RangeSlider
                      grow
                      label="|Q| band"
                      readout={
                        pdfQBandIsFull
                          ? `full 0.00 … ${(pdfQSpanMax || 0).toFixed(2)} Å⁻¹`
                          : `${pdfQMin.toFixed(2)} … ${pdfQMax.toFixed(2)} Å⁻¹`
                      }
                      min={0}
                      max={pdfQSpanMax || 1}
                      step={0.05}
                      valueMin={pdfQMin}
                      valueMax={pdfQMax || 1}
                      disabled={!pdfQSpanMax}
                      onChange={updatePdfQBand}
                    />
                    {rawEdges?.q_max_edge != null && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        title="Set the band to where the raw data's counts begin and end"
                        onClick={() =>
                          updatePdfQBand(
                            rawEdges.q_min_edge != null ? Math.ceil(rawEdges.q_min_edge * 20) / 20 : 0,
                            Math.floor(rawEdges.q_max_edge! * 20) / 20,
                          )
                        }
                      >
                        From raw data
                      </button>
                    )}
                  </div>
                  {rawEdges?.q_max_edge != null && (
                    <p className="config-note cfg-fields-wide">
                      Raw counts <b>{(rawEdges.q_min_edge ?? 0).toFixed(2)} … {rawEdges.q_max_edge.toFixed(2)} Å⁻¹</b>{" "}
                      (most voxels outside hold none) · box face <b>{rawEdges.box_q.toFixed(2)} Å⁻¹</b>
                    </p>
                  )}
                </div>
              </div>
            </StageSection>
          </div>
        </div>
      </section>
    </div>
  );
}
