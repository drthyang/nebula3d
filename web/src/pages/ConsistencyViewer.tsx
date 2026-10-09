// Back-FFT consistency viewer — the end-of-workflow check.  Inverse-transforms
// the ΔPDF back to reciprocal space and compares it to the diffuse data, with
// adjustable |Q| and |R| bands so you can see which signals come from low- vs
// high-|Q| data.  Four views in a workspace (grid · focus · single): Data, the
// ΔPDF, the back-FFT and the residual.  Data, back-FFT and residual share one
// plane, cut, colour scale and view; the ΔPDF has its own, oriented like the
// Q plane while "Link orientation" is on.

import { useEffect, useMemo, useRef, useState } from "react";

import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";

import { fetchConsistencyMeta, fetchConsistencySlice, saveConsistencyDpdf } from "../api/client";
import { PYODIDE_MODE } from "../api/pyodideEngine";
import { useDatasets } from "../api/hooks";
import type { Slice } from "../api/types";
import { COLORMAPS, SEQUENTIAL_NAMES, DIVERGING_NAMES, DIVERGING_NAME } from "../colormaps/luts";
import { fmtLevel } from "../components/colorScale";
import {
  AutoButton,
  BrightnessKnob,
  ClickModeControl,
  LevelsBar,
  ScaleControl,
} from "../components/DisplayBar";
import { qSection, reciprocalMetric } from "../components/reciprocal";
import { SliceCanvas } from "../components/SliceCanvas";
import { EmptyState, IconAlert, RangeSlider, Segmented, Slider, Switch } from "../components/ui";
import { UnitCellGrid } from "../components/UnitCellGrid";
import { useLevels } from "../components/useLevels";
import { ViewFrame } from "../components/ViewFrame";
import { clampHalf, displayToSlice, fitViewport, sampleIndex, type SliceGeom, type Viewport } from "../components/viewport";
import { useWorkspaceLayout } from "../components/useWorkspaceLayout";
import { LayoutControl, Workspace } from "../components/Workspace";
import { useDatasetStore, useInitializeDataset } from "../state/datasetStore";
import { defaultDpdfView, useDpdfStore } from "../state/dpdfStore";
import {
  AXIS_INDEX,
  AXIS_TO_PLANE,
  Q_TO_R_AXIS,
  R_TO_Q_AXIS,
  REAL_AXIS_INDEX,
  REAL_AXIS_TO_PLANE,
  type FixedAxis,
  type RealAxis,
  useViewerStore,
} from "../state/viewerStore";
import { useWorkspaceStore } from "../state/workspaceStore";

const AXES: FixedAxis[] = ["H", "K", "L"];
const REAL_AXES: RealAxis[] = ["X", "Y", "Z"];
const Q_PANELS = ["data", "recon", "residual"] as const;
// In-plane axes (x, y) for each fixed axis, reciprocal and real.
const Q_PLANE_AXES: Record<FixedAxis, [FixedAxis, FixedAxis]> = { H: ["K", "L"], K: ["H", "L"], L: ["H", "K"] };
const R_PLANE_AXES: Record<RealAxis, [string, string]> = { X: ["y", "z"], Y: ["z", "x"], Z: ["x", "y"] };

type Band = { min: number; max: number };

export function ConsistencyViewer() {
  const datasetsQ = useDatasets();
  const datasets = useMemo(() => datasetsQ.data ?? [], [datasetsQ.data]);
  useInitializeDataset(datasets);
  const datasetId = useDatasetStore((s) => s.datasetId);
  // Only datasets whose ΔPDF input (flattened/backfilled) exists can be inverted.
  const usable = useMemo(
    () =>
      datasets.filter((d) =>
        d.stages.some(
          (s) =>
            s.kind === "hkl" &&
            s.exists &&
            (s.name === "flattened" || s.name === "backfilled"),
        ),
      ),
    [datasets],
  );
  const dataset = datasets.find((d) => d.id === datasetId);
  const selectedUsable = Boolean(dataset && usable.some((d) => d.id === dataset.id));

  // Reciprocal display state is shared with the cleanup page, real-space state
  // with the 3D-ΔPDF page.  The real-space cut *indices* are not shared: the
  // round trip can use a different grid than the saved ΔPDF volume.
  const fixedAxis = useViewerStore((s) => s.fixedAxis);
  const cutIndex = useViewerStore((s) => s.cutIndex);
  const scale = useViewerStore((s) => s.scale);
  const qManual = useViewerStore((s) => s.levels);
  const qViews = useViewerStore((s) => s.views);
  const colormap = useViewerStore((s) => s.colormap);
  const setFixedAxis = useViewerStore((s) => s.setFixedAxis);
  const setCutIndex = useViewerStore((s) => s.setCutIndex);
  const setScale = useViewerStore((s) => s.setScale);
  const setQManual = useViewerStore((s) => s.setLevels);
  const setQView = useViewerStore((s) => s.setView);
  const setColormap = useViewerStore((s) => s.setColormap);

  const rManual = useDpdfStore((s) => s.limit);
  const rViews = useDpdfStore((s) => s.views);
  const dpdfColormap = useDpdfStore((s) => s.colormap);
  const gridlines = useDpdfStore((s) => s.gridlines);
  const setRManual = useDpdfStore((s) => s.setLimit);
  const setRView = useDpdfStore((s) => s.setView);
  const setDpdfColormap = useDpdfStore((s) => s.setColormap);
  const setGridlines = useDpdfStore((s) => s.setGridlines);

  const clickMode = useWorkspaceStore((s) => s.clickMode);

  // Orientation: while linked the R plane follows the Q plane (H ↔ x, …).
  const [link, setLink] = useState(true);
  const [ownRAxis, setOwnRAxis] = useState<RealAxis>("X");
  const dpdfFixedAxis: RealAxis = link ? Q_TO_R_AXIS[fixedAxis] : ownRAxis;
  const pickQAxis = (a: FixedAxis) => setFixedAxis(a);
  const pickRAxis = (a: RealAxis) => (link ? setFixedAxis(R_TO_Q_AXIS[a]) : setOwnRAxis(a));
  const toggleLink = (on: boolean) => {
    if (!on) setOwnRAxis(Q_TO_R_AXIS[fixedAxis]);
    setLink(on);
  };

  const [dpdfCuts, setDpdfCuts] = useState<{ X: number; Y: number; Z: number }>({ X: 0, Y: 0, Z: 0 });
  const dpdfCutIndex = dpdfCuts[dpdfFixedAxis];
  const setDpdfCutIndex = (i: number) => setDpdfCuts((c) => ({ ...c, [dpdfFixedAxis]: i }));

  // Applied bands (null = full) and the drafts their sliders edit.
  const [band, setBand] = useState<Band | null>(null);
  const [draftQ, setDraftQ] = useState<Band>({ min: 0, max: 0 });
  const [rBand, setRBand] = useState<Band | null>(null);
  const [draftR, setDraftR] = useState<Band>({ min: 0, max: 0 });

  // The residual's own ± limit (signed data, not shared).
  const [resLimit, setResLimit] = useState<number | null>(null);
  const [qCursor, setQCursor] = useState<[number, number] | null>(null);
  const [rCursor, setRCursor] = useState<[number, number] | null>(null);

  // Save the final band-limited 3D-ΔPDF to disk (end of the workflow).
  const [saveState, setSaveState] = useState<
    { status: "idle" | "saving" } | { status: "saved"; filename: string } | { status: "error"; message: string }
  >({ status: "idle" });

  const [layout, dispatchLayout] = useWorkspaceLayout("qr", ["data", "dpdf", "recon", "residual"], {
    mode: "focus",
    primary: "data",
    lastMulti: "focus",
  });

  // Meta drives the metrics + grid ranges + |Q| span; it recomputes the (heavy)
  // round trip whenever an applied band changes.
  const metaQ = useQuery({
    queryKey: ["consMeta", datasetId, band?.min, band?.max, rBand?.min, rBand?.max],
    queryFn: () =>
      fetchConsistencyMeta(datasetId as string, band?.min, band?.max, rBand?.min, rBand?.max),
    enabled: Boolean(datasetId && selectedUsable),
    placeholderData: keepPreviousData,
  });
  const meta = metaQ.data;
  const spanMax = meta ? Math.ceil(meta.q_data_max) : 0;
  const rSpanMax = meta ? Math.ceil(meta.r_data_max) : 0;

  // Initialise the drafts to the full span once it is known, and again (clearing
  // any applied band) when the dataset changes.  The ref makes it idempotent and
  // keeps the user's own edits.
  const bandInitKey = useRef("");
  useEffect(() => {
    if (spanMax <= 0 || rSpanMax <= 0) return;
    const key = `${datasetId}|${spanMax}|${rSpanMax}`;
    if (bandInitKey.current === key) return;
    bandInitKey.current = key;
    setBand(null);
    setDraftQ({ min: 0, max: spanMax });
    setRBand(null);
    setDraftR({ min: 0, max: rSpanMax });
  }, [datasetId, spanMax, rSpanMax]);

  const axisInfo = useMemo(() => {
    if (!meta) return null;
    const i = AXIS_INDEX[fixedAxis];
    const [min, max] = [meta.h_range, meta.k_range, meta.l_range][i];
    const n = meta.shape[i];
    return { min, max, n, step: n > 1 ? (max - min) / (n - 1) : 0 };
  }, [meta, fixedAxis]);

  const dpdfAxisInfo = useMemo(() => {
    if (!meta || !meta.x_range || !meta.dpdf_shape) return null;
    const i = REAL_AXIS_INDEX[dpdfFixedAxis];
    const [min, max] = [meta.x_range, meta.y_range, meta.z_range][i];
    const n = meta.dpdf_shape[i];
    return { min, max, n, step: n > 1 ? (max - min) / (n - 1) : 0 };
  }, [meta, dpdfFixedAxis]);

  // Centre a cut only when its grid changes (dataset, axis, size) — not when a
  // band is applied: applying refetches `meta`, which recreates axisInfo, and
  // used to snap both cuts back to the centre.
  const qCentredFor = useRef("");
  useEffect(() => {
    if (!axisInfo) return;
    const key = `${datasetId}|${fixedAxis}|${axisInfo.n}`;
    if (qCentredFor.current === key) return;
    qCentredFor.current = key;
    setCutIndex(Math.floor(axisInfo.n / 2));
  }, [axisInfo, datasetId, fixedAxis, setCutIndex]);
  const rCentredFor = useRef("");
  useEffect(() => {
    if (!dpdfAxisInfo) return;
    const key = `${datasetId}|${dpdfFixedAxis}|${dpdfAxisInfo.n}`;
    if (rCentredFor.current === key) return;
    rCentredFor.current = key;
    setDpdfCuts((c) => ({ ...c, [dpdfFixedAxis]: Math.floor(dpdfAxisInfo.n / 2) }));
  }, [dpdfAxisInfo, datasetId, dpdfFixedAxis]);

  const a = meta?.lattice.a ?? 1;
  const b = meta?.lattice.b ?? 1;
  const c = meta?.lattice.c ?? 1;
  const qLat: Record<FixedAxis, number> = { H: a, K: b, L: c };
  const rLat: Record<string, number> = { x: a, y: b, z: c };
  const [qx, qy] = Q_PLANE_AXES[fixedAxis];
  const [rx, ry] = R_PLANE_AXES[dpdfFixedAxis];
  const latX = qLat[qx];
  const latY = qLat[qy];
  const latCut = qLat[fixedAxis];
  const qGeom: SliceGeom = useMemo(
    () => ({ sx: (2 * Math.PI) / latX, sy: (2 * Math.PI) / latY, angle: 90 }),
    [latX, latY],
  );

  const idx = axisInfo ? Math.min(cutIndex, axisInfo.n - 1) : 0;
  const value = axisInfo ? axisInfo.min + idx * axisInfo.step : 0;
  // The Q slice as a section of reciprocal space, so the |Q| band is drawn as
  // its true contour: a tilted ellipse for a non-orthogonal cell.
  const lattice = meta?.lattice;
  const qSec = useMemo(() => {
    const G = reciprocalMetric(lattice);
    return G ? qSection(G, AXIS_INDEX[qx], AXIS_INDEX[qy], value, qGeom.sx, qGeom.sy) : null;
  }, [lattice, qx, qy, value, qGeom]);
  const plane = AXIS_TO_PLANE[fixedAxis];
  const dpdfIdx = dpdfAxisInfo ? Math.min(dpdfCutIndex, dpdfAxisInfo.n - 1) : 0;
  const dpdfValue = dpdfAxisInfo ? dpdfAxisInfo.min + dpdfIdx * dpdfAxisInfo.step : 0;
  const dpdfPlane = REAL_AXIS_TO_PLANE[dpdfFixedAxis];
  const seqLut = COLORMAPS[colormap] ?? COLORMAPS.inferno;
  const divLut = COLORMAPS[dpdfColormap] ?? COLORMAPS[DIVERGING_NAME];

  const commitCut = (v: number) => {
    if (!axisInfo || axisInfo.step === 0) return;
    const i = Math.round((v - axisInfo.min) / axisInfo.step);
    setCutIndex(Math.max(0, Math.min(axisInfo.n - 1, i)));
  };

  const sliceQuery = (key: string, p: string, v: number, enabled: boolean, stable = false) => ({
    queryKey: ["consSlice", datasetId, key, p, v, band?.min, band?.max, rBand?.min, rBand?.max],
    queryFn: () =>
      fetchConsistencySlice(datasetId as string, key, p, v, band?.min, band?.max, rBand?.min, rBand?.max),
    enabled: Boolean(datasetId && selectedUsable && enabled),
    ...(stable ? { staleTime: Infinity } : { placeholderData: keepPreviousData }),
  });

  // Current Q slices, and the centre-cut ones that set Auto (so the scale holds
  // still while the cut is dragged).
  const qCentre = axisInfo ? axisInfo.min + Math.floor(axisInfo.n / 2) * axisInfo.step : 0;
  const qResults = useQueries({ queries: Q_PANELS.map((k) => sliceQuery(k, plane, value, Boolean(axisInfo))) });
  const qCentreResults = useQueries({
    queries: Q_PANELS.map((k) => sliceQuery(k, plane, qCentre, Boolean(axisInfo), true)),
  });
  const rCentre = dpdfAxisInfo ? dpdfAxisInfo.min + Math.floor(dpdfAxisInfo.n / 2) * dpdfAxisInfo.step : 0;
  const rResult = useQuery(sliceQuery("dpdf", dpdfPlane, dpdfValue, Boolean(dpdfAxisInfo)));
  const rCentreResult = useQuery(sliceQuery("dpdf", dpdfPlane, rCentre, Boolean(dpdfAxisInfo), true));

  const [cData, cRecon, cRes] = qCentreResults.map((r) => r.data);
  const qSamples = useMemo(() => (cData && cRecon ? [cData.data, cRecon.data] : null), [cData, cRecon]);
  const resSamples = useMemo(() => (cRes ? [cRes.data] : null), [cRes]);
  const rCentreData = rCentreResult.data;
  const rSamples = useMemo(() => (rCentreData ? [rCentreData.data] : null), [rCentreData]);

  const qLv = useLevels({
    samples: qSamples,
    histData: qResults[0]?.data?.data,
    scale,
    manual: qManual && qManual.dataset === datasetId ? qManual : null,
  });
  const resLv = useLevels({
    samples: resSamples,
    histData: qResults[2]?.data?.data,
    signed: true,
    manual: resLimit != null ? { lo: -resLimit, hi: resLimit } : null,
  });
  const rLv = useLevels({
    samples: rSamples,
    histData: rResult.data?.data,
    signed: true,
    manual: rManual && rManual.dataset === datasetId ? { lo: -rManual.value, hi: rManual.value } : null,
  });
  const setQLevels = (l: { lo: number; hi: number }) => datasetId && setQManual({ ...l, dataset: datasetId });
  const setRLimit = (hi: number) => datasetId && setRManual({ value: Math.abs(hi), dataset: datasetId });
  // Residual Auto follows the applied bands.
  useEffect(() => setResLimit(null), [datasetId, band?.min, band?.max, rBand?.min, rBand?.max]);

  // Viewports: Q shared with the cleanup page (per plane), R with the 3D-ΔPDF page.
  const qFit = useMemo(() => {
    if (!meta) return { cx: 0, cy: 0, half: 1 };
    const range = { H: meta.h_range, K: meta.k_range, L: meta.l_range };
    return fitViewport({ x_axis: range[qx], y_axis: range[qy] }, qGeom);
  }, [meta, qx, qy, qGeom]);
  const qViewport = qViews[plane] ?? qFit;
  const qStep = (ax: FixedAxis) => {
    if (!meta) return 0.01;
    const [lo, hi] = [meta.h_range, meta.k_range, meta.l_range][AXIS_INDEX[ax]];
    return (hi - lo) / Math.max(1, meta.shape[AXIS_INDEX[ax]] - 1);
  };
  const qLimit = (h: number) => clampHalf(h, qFit.half, Math.min(qStep(qx) * qGeom.sx, qStep(qy) * qGeom.sy));
  const rFit = defaultDpdfView();
  const rViewport: Viewport = rViews[dpdfPlane] ?? rFit;
  const rLimit = (h: number) => clampHalf(h, Math.max(rSpanMax, rFit.half), dpdfAxisInfo?.step || 0.5);

  const m = meta?.metrics;
  const qBandPending = band ? draftQ.min !== band.min || draftQ.max !== band.max : draftQ.min !== 0 || draftQ.max !== spanMax;
  const rBandPending = rBand ? draftR.min !== rBand.min || draftR.max !== rBand.max : draftR.min !== 0 || draftR.max !== rSpanMax;
  const computing = metaQ.isFetching;

  // Saving reuses the cached reconstruction for the *applied* bands, i.e.
  // exactly what the views show — pending drafts are saved only after Apply.
  const saveDpdf = async () => {
    if (!datasetId) return;
    setSaveState({ status: "saving" });
    try {
      const res = await saveConsistencyDpdf(datasetId, band?.min, band?.max, rBand?.min, rBand?.max);
      setSaveState({ status: "saved", filename: res.filename });
    } catch (e) {
      setSaveState({ status: "error", message: (e as Error).message });
    }
  };
  // A saved file reflects one band selection; clear the confirmation when the
  // applied bands (or dataset) change so the message can't go stale.
  useEffect(() => {
    setSaveState({ status: "idle" });
  }, [datasetId, band?.min, band?.max, rBand?.min, rBand?.max]);

  const consistent = m && Number.isFinite(m.pearson_r) && m.pearson_r >= 0.95;
  const valueAt = (s: Slice | undefined, p: [number, number], g: SliceGeom) => {
    if (!s) return undefined;
    const ij = sampleIndex(s.header, p[0], p[1], g);
    return ij ? s.data[ij[1] * s.header.nx + ij[0]] : undefined;
  };
  const rGeom = (s: Slice | undefined): SliceGeom => ({ sx: 1, sy: 1, angle: s?.header.axes_angle ?? 90 });

  const body = (
    r: { data?: Slice; isError?: boolean; error?: unknown; isFetching?: boolean } | undefined,
    frame: (s: Slice) => React.ReactNode,
  ) =>
    r?.isError ? (
      <div className="panel-err">{(r.error as Error)?.message}</div>
    ) : r?.data ? (
      <>
        {frame(r.data)}
        {(r.isFetching || computing) && <span className="spin vf-spin" />}
      </>
    ) : (
      <div className="skeleton" style={{ width: "100%", height: "100%" }} />
    );

  const qAxes = { sx: qGeom.sx, sy: qGeom.sy, xLabel: qx, yLabel: qy, unit: "r.l.u.", fovUnit: "Å⁻¹" };
  const qFrame = (s: Slice, opts: { lut: Uint8ClampedArray; lo: number; hi: number; diverging?: boolean; bands?: boolean }) => (
    <ViewFrame
      viewport={qViewport}
      onViewport={(v) => setQView(plane, v)}
      fit={qFit}
      limit={qLimit}
      mode={clickMode}
      axes={qAxes}
      cursor={qCursor}
      onCursor={setQCursor}
    >
      <SliceCanvas
        slice={s}
        lut={opts.lut}
        vmin={opts.lo}
        vmax={opts.hi}
        log={false}
        scale={scale}
        soft={qLv.soft}
        diverging={opts.diverging}
        viewport={qViewport}
        bands={opts.bands ? [draftQ.min, draftQ.max] : undefined}
        cutDistance={value}
        reciprocalAxes
        qSection={qSec}
        latX={latX}
        latY={latY}
        latCut={latCut}
      />
    </ViewFrame>
  );

  const bandControl = (
    kind: "q" | "r",
    draft: Band,
    setDraft: (b: Band) => void,
    max: number,
    pending: boolean,
    apply: () => void,
    full: () => void,
  ) => (
    <div className="qr-foot-band ws-band">
      <RangeSlider
        grow
        label={kind === "q" ? "|Q| band" : "|R| band"}
        readout={`${draft.min.toFixed(kind === "q" ? 2 : 0)} … ${draft.max.toFixed(kind === "q" ? 2 : 0)} ${kind === "q" ? "Å⁻¹" : "Å"}`}
        min={0}
        max={max || 1}
        step={kind === "q" ? 0.05 : 1}
        valueMin={draft.min}
        valueMax={draft.max}
        disabled={!max}
        onChange={(lo, hi) => setDraft({ min: lo, max: hi })}
      />
      <button
        type="button"
        className={`btn ${pending ? "btn-primary" : "btn-ghost"} btn-sm`}
        disabled={!pending || computing}
        title="Recompute the round trip with this band; the cuts stay where they are"
        onClick={apply}
      >
        {computing && pending ? "Computing…" : pending ? "Apply" : "Applied"}
      </button>
      <button type="button" className="btn btn-ghost btn-sm" disabled={computing || (!pending && draft.min === 0 && draft.max === max)} onClick={full}>
        Full
      </button>
    </div>
  );

  return (
    <div className="page-body qr-page">
      {/* ── Header: round trip · description ───────── */}
      <div className="qr-header">
        <div className="qr-roundtrip">
          <span className="qr-rt qr-rt--q">Q</span>
          <span className="qr-rt-arrow">→</span>
          <span className="qr-rt qr-rt--r">R</span>
          <span className="qr-rt-arrow">→</span>
          <span className="qr-rt qr-rt--qp">Q′</span>
        </div>
        <span className="qr-desc">Band-limited round-trip · reconstruction compared to the input</span>
        <div className="qr-header-actions">
          {m && (
            <span className="qr-metric-row">
              {consistent && (
                <span className="qr-verdict">
                  <span className="qr-dot" /> CONSISTENT
                </span>
              )}
              <span className="qr-metric-r">r = {Number.isFinite(m.pearson_r) ? m.pearson_r.toFixed(5) : "—"}</span>
              <span className="qr-metric-rms">RMS {m.normalized_rms.toExponential(2)}</span>
            </span>
          )}
        </div>
      </div>

      {/* ── Workspace header: click mode · orientation · layout, then Q and R display ── */}
      <div className="ws-head">
        <div className="ws-row">
          <ClickModeControl />
          <span className="ws-sep" />
          <Switch label="Link orientation" checked={link} onChange={toggleLink} />
          <span className="ws-group">
            <span className="qr-rt-badge qr-rt--q">Q</span>
            <Segmented options={AXES} value={fixedAxis} onChange={(x) => pickQAxis(x as FixedAxis)} />
          </span>
          <span className="ws-group">
            <span className="qr-rt-badge qr-rt--r">R</span>
            <Segmented options={REAL_AXES} value={dpdfFixedAxis} onChange={(x) => pickRAxis(x as RealAxis)} />
          </span>
          <span className={`ws-orient ${Q_TO_R_AXIS[fixedAxis] === dpdfFixedAxis ? "ok" : "warn"}`}>
            {Q_TO_R_AXIS[fixedAxis] === dpdfFixedAxis ? `${plane} ↔ ${dpdfPlane}` : `different planes: ${plane} vs ${dpdfPlane}`}
          </span>
          <span className="ws-spacer" />
          <LayoutControl state={layout} dispatch={dispatchLayout} />
        </div>
        <div className="ws-row ws-display">
          <div className="ws-display-group">
            <span className="ws-group">
              <span className="qr-rt-badge qr-rt--q">Q</span>
              <select aria-label="Q colormap" value={colormap} onChange={(e) => setColormap(e.target.value)}>
                {SEQUENTIAL_NAMES.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </span>
            <LevelsBar lut={seqLut} levels={qLv.levels} domain={qLv.domain} hist={qLv.hist} scale={scale} onChange={setQLevels} />
            <ScaleControl value={scale} onChange={setScale} />
            <AutoButton active={qLv.isAuto} onClick={() => setQManual(null)} />
            <BrightnessKnob autoHi={qLv.auto.hi} hi={qLv.levels.hi} onChange={(hi) => setQLevels({ lo: qLv.levels.lo, hi })} />
          </div>
          <span className="ws-sep" />
          <div className="ws-display-group">
            <span className="ws-group">
              <span className="qr-rt-badge qr-rt--r">R</span>
              <select aria-label="R colormap" value={dpdfColormap} onChange={(e) => setDpdfColormap(e.target.value)}>
                {DIVERGING_NAMES.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </span>
            <LevelsBar lut={divLut} levels={rLv.levels} domain={rLv.domain} hist={rLv.hist} symmetric onChange={(l) => setRLimit(l.hi)} />
            <AutoButton active={rLv.isAuto} onClick={() => setRManual(null)} />
            <Switch label="Unit cells" checked={gridlines} onChange={setGridlines} />
          </div>
        </div>
      </div>

      {datasetsQ.isError && (
        <EmptyState
          error
          icon={<IconAlert />}
          title="Backend unreachable"
          hint="Start the API server (nebula3d-web or uvicorn on port 8000) and reload."
        />
      )}
      {!datasetsQ.isError && usable.length === 0 && (
        <EmptyState
          title="No invertible volumes yet"
          hint="Run the pipeline first — the flattened/backfilled volume feeds this back-FFT check."
        />
      )}
      {!datasetsQ.isError && usable.length > 0 && dataset && !selectedUsable && (
        <EmptyState
          title="No invertible volume for this dataset"
          hint="Run this dataset through backfill or flatten first — the flattened/backfilled volume feeds this back-FFT check."
        />
      )}
      {metaQ.isError && (
        <EmptyState
          error
          icon={<IconAlert />}
          title="Consistency check failed"
          hint={(metaQ.error as Error)?.message}
        />
      )}

      {selectedUsable && (
        <Workspace
          state={layout}
          dispatch={dispatchLayout}
          views={[
            {
              id: "data",
              title: "Data",
              badge: "Q",
              badgeClass: "qr-rt-badge qr-rt--q",
              caption: `${plane} · ${fixedAxis} = ${value.toFixed(3)}`,
              onResetView: () => setQView(plane, null),
              footer: (
                <>
                  <div className="qr-foot-cut">
                    <Slider
                      label={`Cut ${fixedAxis}`}
                      readout={axisInfo ? undefined : "—"}
                      valueInput={axisInfo ? { value, prefix: `${fixedAxis} =`, suffix: "r.l.u.", onCommit: commitCut } : undefined}
                      min={0}
                      max={axisInfo ? axisInfo.n - 1 : 0}
                      value={idx}
                      disabled={!axisInfo}
                      onChange={setCutIndex}
                    />
                  </div>
                  {bandControl("q", draftQ, setDraftQ, spanMax, qBandPending, () => setBand({ ...draftQ }), () => {
                    setBand(null);
                    setDraftQ({ min: 0, max: spanMax });
                  })}
                </>
              ),
              children: body(qResults[0], (s) => qFrame(s, { lut: seqLut, lo: qLv.levels.lo, hi: qLv.levels.hi, bands: true })),
            },
            {
              id: "dpdf",
              title: "3D-ΔPDF",
              badge: "R",
              badgeClass: "qr-rt-badge qr-rt--r",
              caption: `${dpdfPlane} · ${dpdfFixedAxis.toLowerCase()} = ${dpdfValue.toFixed(2)} Å`,
              onResetView: () => setRView(dpdfPlane, null),
              actions: (
                <>
                  {saveState.status === "saved" && (
                    <span className="qr-saved" title={saveState.filename}>
                      <span className="qr-dot" /> {PYODIDE_MODE ? "downloaded" : "saved"}
                    </span>
                  )}
                  {saveState.status === "error" && (
                    <span className="qr-saved qr-saved--err" title={saveState.message}>save failed</span>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary qr-save-btn"
                    title={
                      PYODIDE_MODE
                        ? "Download the band-limited 3D-ΔPDF (final processed file) as .h5"
                        : "Save the band-limited 3D-ΔPDF (final processed file) to data/processed"
                    }
                    disabled={!selectedUsable || computing || saveState.status === "saving"}
                    onClick={saveDpdf}
                  >
                    ↓ {saveState.status === "saving" ? "Saving…" : PYODIDE_MODE ? "Download ΔPDF" : "Save ΔPDF"}
                  </button>
                </>
              ),
              footer: (
                <>
                  <div className="qr-foot-cut">
                    <Slider
                      label={`Cut ${dpdfFixedAxis.toLowerCase()}`}
                      readout={dpdfAxisInfo ? undefined : "—"}
                      valueInput={
                        dpdfAxisInfo
                          ? {
                              value: dpdfValue,
                              prefix: `${dpdfFixedAxis.toLowerCase()} =`,
                              suffix: "Å",
                              onCommit: (v) => {
                                if (!dpdfAxisInfo || dpdfAxisInfo.step === 0) return;
                                const i = Math.round((v - dpdfAxisInfo.min) / dpdfAxisInfo.step);
                                setDpdfCutIndex(Math.max(0, Math.min(dpdfAxisInfo.n - 1, i)));
                              },
                            }
                          : undefined
                      }
                      min={0}
                      max={dpdfAxisInfo ? dpdfAxisInfo.n - 1 : 0}
                      value={dpdfIdx}
                      disabled={!dpdfAxisInfo}
                      onChange={setDpdfCutIndex}
                    />
                  </div>
                  {bandControl("r", draftR, setDraftR, rSpanMax, rBandPending, () => setRBand({ ...draftR }), () => {
                    setRBand(null);
                    setDraftR({ min: 0, max: rSpanMax });
                  })}
                </>
              ),
              children: body(rResult, (s) => (
                <ViewFrame
                  viewport={rViewport}
                  onViewport={(v) => setRView(dpdfPlane, v)}
                  fit={rFit}
                  limit={rLimit}
                  mode={clickMode}
                  axes={{ sx: 1, sy: 1, xLabel: rx, yLabel: ry, unit: "Å", fovUnit: "Å" }}
                  cursor={rCursor}
                  onCursor={setRCursor}
                >
                  <SliceCanvas
                    slice={s}
                    lut={divLut}
                    vmax={rLv.levels.hi}
                    log={false}
                    diverging
                    viewport={rViewport}
                    bands={[draftR.min, draftR.max]}
                    cutDistance={dpdfValue}
                  />
                  {gridlines && (
                    <UnitCellGrid
                      half={rViewport.half}
                      viewport={rViewport}
                      latX={rLat[rx]}
                      latY={rLat[ry]}
                      angle={s.header.axes_angle}
                    />
                  )}
                </ViewFrame>
              )),
            },
            {
              id: "recon",
              title: "Back-FFT  IFFT[ΔPDF]",
              badge: "Q′",
              badgeClass: "qr-rt-badge qr-rt--qp",
              caption: "same cut & scale as Data",
              onResetView: () => setQView(plane, null),
              footer: (
                <div className="qr-metric-row">
                  {consistent && (
                    <span className="qr-verdict">
                      <span className="qr-dot" /> CONSISTENT
                    </span>
                  )}
                  <span className="qr-metric-r">r = {m && Number.isFinite(m.pearson_r) ? m.pearson_r.toFixed(5) : "—"}</span>
                  <span className="qr-metric-rms">RMS {m ? m.normalized_rms.toExponential(2) : "—"}</span>
                </div>
              ),
              children: body(qResults[1], (s) => qFrame(s, { lut: seqLut, lo: qLv.levels.lo, hi: qLv.levels.hi })),
            },
            {
              id: "residual",
              title: "Residual",
              badge: "Δ",
              badgeClass: "qr-rt-badge qr-rt--r",
              caption: "data − recon",
              onResetView: () => setQView(plane, null),
              footer: (
                <div className="ws-res-levels">
                  <span className="field-label">± range</span>
                  <LevelsBar lut={divLut} levels={resLv.levels} domain={resLv.domain} hist={resLv.hist} symmetric onChange={(l) => setResLimit(Math.abs(l.hi))} />
                  <AutoButton active={resLv.isAuto} onClick={() => setResLimit(null)} />
                </div>
              ),
              children: body(qResults[2], (s) => qFrame(s, { lut: divLut, lo: resLv.levels.lo, hi: resLv.levels.hi, diverging: true })),
            },
          ]}
        />
      )}

      {selectedUsable && (
        <div className="ws-readout">
          {qCursor ? (
            <>
              <b>
                {qx} {(qCursor[0] / qGeom.sx).toFixed(3)} · {qy} {(qCursor[1] / qGeom.sy).toFixed(3)}
              </b>
              {(["Data", "Back-FFT", "Residual"] as const).map((label, i) => {
                const v = valueAt(qResults[i]?.data, qCursor, qGeom);
                return (
                  <span key={label}>
                    <i>{label}</i> {v === undefined ? "—" : fmtLevel(v)}
                  </span>
                );
              })}
            </>
          ) : rCursor ? (
            (() => {
              const s = rResult.data;
              const [h, v] = displayToSlice(rCursor[0], rCursor[1], rGeom(s));
              const val = valueAt(s, rCursor, rGeom(s));
              return (
                <>
                  <b>{rx} {h.toFixed(2)} · {ry} {v.toFixed(2)} Å</b>
                  <span><i>ΔPDF</i> {val === undefined ? "—" : fmtLevel(val)}</span>
                </>
              );
            })()
          ) : (
            <span className="muted">Hover a slice to read values; Data, Back-FFT and Residual share one crosshair.</span>
          )}
        </div>
      )}
    </div>
  );
}
