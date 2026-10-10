// Reciprocal-space cleanup viewer — replaces examples/explore_slice.py.
// One view per existing HKLVolume stage in a workspace (grid · focus · single),
// all on the same plane and cut, one shared colour scale and one linked view,
// so the cleanup stages are directly comparable.

import { useEffect, useMemo, useState } from "react";

import { keepPreviousData, useQueries } from "@tanstack/react-query";

import { fetchSlice } from "../api/client";
import { useDatasets, useMeta } from "../api/hooks";
import type { Slice } from "../api/types";
import { COLORMAPS, SEQUENTIAL_NAMES } from "../colormaps/luts";
import { autoLevels, fmtLevel, type AutoLevels, type ScaleKind } from "../components/colorScale";
import {
  AutoButton,
  BrightnessKnob,
  ClickModeControl,
  LevelsBar,
  ScaleControl,
} from "../components/DisplayBar";
import { SliceCanvas } from "../components/SliceCanvas";
import {
  EmptyState,
  IconAlert,
  MetaStrip,
  Segmented,
  Slider,
} from "../components/ui";
import { useLevels } from "../components/useLevels";
import { ViewFrame } from "../components/ViewFrame";
import { clampHalf, fitViewport, sampleIndex, type SliceGeom } from "../components/viewport";
import { useWorkspaceLayout } from "../components/useWorkspaceLayout";
import { LayoutControl, Workspace } from "../components/Workspace";
import {
  AXIS_INDEX,
  AXIS_TO_PLANE,
  type FixedAxis,
  useViewerStore,
} from "../state/viewerStore";
import { useDatasetStore, useInitializeDataset } from "../state/datasetStore";
import { useWorkspaceStore } from "../state/workspaceStore";
import { litStage, useHighlightKeys } from "../llm/highlight";

const STAGE_ORDER = ["raw", "ringremoved", "braggpunched", "backfilled", "flattened"];
const STAGE_LABELS: Record<string, string> = {
  raw: "Raw",
  ringremoved: "Ring-removed",
  braggpunched: "Bragg-punched",
  backfilled: "Backfilled",
  flattened: "Flattened",
};
const AXES: FixedAxis[] = ["H", "K", "L"];
// In-plane axes (x, y) for each fixed axis.
const PLANE_AXES: Record<FixedAxis, [FixedAxis, FixedAxis]> = { H: ["K", "L"], K: ["H", "L"], L: ["H", "K"] };

// Auto per slice, cached on the slice object (fetched slices are immutable).
const autoCache = new WeakMap<Slice, Map<string, AutoLevels>>();
function cachedAuto(s: Slice, scale: ScaleKind): AutoLevels {
  let m = autoCache.get(s);
  if (!m) autoCache.set(s, (m = new Map()));
  let a = m.get(scale);
  if (!a) m.set(scale, (a = autoLevels([s.data], { scale })));
  return a;
}

export function ReciprocalViewer() {
  const lit = useHighlightKeys();
  const datasetsQ = useDatasets();
  const datasets = useMemo(() => datasetsQ.data ?? [], [datasetsQ.data]);
  useInitializeDataset(datasets);

  const datasetId = useDatasetStore((s) => s.datasetId);
  const fixedAxis = useViewerStore((s) => s.fixedAxis);
  const cutIndex = useViewerStore((s) => s.cutIndex);
  const scale = useViewerStore((s) => s.scale);
  const manual = useViewerStore((s) => s.levels);
  const scaleRef = useViewerStore((s) => s.scaleRef);
  const views = useViewerStore((s) => s.views);
  const colormap = useViewerStore((s) => s.colormap);
  const setFixedAxis = useViewerStore((s) => s.setFixedAxis);
  const setCutIndex = useViewerStore((s) => s.setCutIndex);
  const setScale = useViewerStore((s) => s.setScale);
  const setManual = useViewerStore((s) => s.setLevels);
  const setScaleRef = useViewerStore((s) => s.setScaleRef);
  const setView = useViewerStore((s) => s.setView);
  const setColormap = useViewerStore((s) => s.setColormap);
  const clickMode = useWorkspaceStore((s) => s.clickMode);
  const [cursor, setCursor] = useState<[number, number] | null>(null);

  const dataset = datasets.find((d) => d.id === datasetId);
  const stages = (dataset?.stages ?? [])
    .filter((s) => s.kind === "hkl" && s.exists)
    .sort((a, b) => STAGE_ORDER.indexOf(a.name) - STAGE_ORDER.indexOf(b.name));
  const stageIds = stages.map((s) => s.name);

  const [layout, dispatchLayout] = useWorkspaceLayout("cleanup", STAGE_ORDER, {
    mode: "grid",
    primary: "flattened",
    lastMulti: "grid",
  });

  const metaVolId = stages[0]?.volume_id;
  const meta = useMeta(metaVolId).data;

  const axisInfo = useMemo(() => {
    if (!meta) return null;
    const i = AXIS_INDEX[fixedAxis];
    const [min, max] = [meta.h_range, meta.k_range, meta.l_range][i];
    const n = meta.shape[i];
    return { min, max, n, step: n > 1 ? (max - min) / (n - 1) : 0 };
  }, [meta, fixedAxis]);

  // Centre the cut when the axis or dataset changes (axisInfo is re-memoised
  // only when meta or the fixed axis changes, not while scrubbing the slider) —
  // unless a cut was asked for (the assistant's "show in viewer"), which the
  // next effect opens instead, whether or not this page was already showing.
  const focus = useViewerStore((s) => s.focus);
  const setFocus = useViewerStore((s) => s.setFocus);
  useEffect(() => {
    if (axisInfo && !useViewerStore.getState().focus) setCutIndex(Math.floor(axisInfo.n / 2));
  }, [axisInfo, setCutIndex]);
  useEffect(() => {
    if (!axisInfo || !focus || focus.axis !== fixedAxis) return;
    const v = Math.max(axisInfo.min, Math.min(focus.value, axisInfo.max));
    setCutIndex(axisInfo.step > 0 ? Math.round((v - axisInfo.min) / axisInfo.step) : 0);
    setFocus(null);
  }, [axisInfo, focus, fixedAxis, setCutIndex, setFocus]);

  const idx = axisInfo ? Math.min(cutIndex, axisInfo.n - 1) : 0;
  const value = axisInfo ? axisInfo.min + idx * axisInfo.step : 0;
  const plane = AXIS_TO_PLANE[fixedAxis];
  const lut = COLORMAPS[colormap] ?? COLORMAPS.inferno;

  // Snap a typed cut value to the nearest available data point.
  const commitCut = (v: number) => {
    if (!axisInfo || axisInfo.step === 0) return;
    const bounded = Math.max(axisInfo.min, Math.min(v, axisInfo.max));
    setCutIndex(Math.round((bounded - axisInfo.min) / axisInfo.step));
  };

  const a = meta?.lattice.a ?? 1;
  const b = meta?.lattice.b ?? 1;
  const c = meta?.lattice.c ?? 1;
  const lat: Record<FixedAxis, number> = { H: a, K: b, L: c };
  const [xAxis, yAxis] = PLANE_AXES[fixedAxis];
  const latX = lat[xAxis];
  const latY = lat[yAxis];
  const latCut = lat[fixedAxis];
  const geom: SliceGeom = useMemo(
    () => ({ sx: (2 * Math.PI) / latX, sy: (2 * Math.PI) / latY, angle: 90 }),
    [latX, latY],
  );

  // Displayed slices at the current cut (one per stage).
  const sliceResults = useQueries({
    queries: stages.map((s) => ({
      queryKey: ["slice", s.volume_id, plane, value, false],
      queryFn: () => fetchSlice(s.volume_id, plane, value),
      enabled: Boolean(axisInfo),
      placeholderData: keepPreviousData,
    })),
  });

  // Auto is taken from the CENTRE cut, so the scale holds still while the cut
  // slider is dragged and intensities stay comparable across cut positions.
  const centerValue = axisInfo ? axisInfo.min + Math.floor(axisInfo.n / 2) * axisInfo.step : 0;
  const scaleResults = useQueries({
    queries: stages.map((s) => ({
      queryKey: ["slice", s.volume_id, plane, centerValue, false],
      queryFn: () => fetchSlice(s.volume_id, plane, centerValue),
      enabled: Boolean(axisInfo),
      staleTime: Infinity,
    })),
  });

  // The shared scale comes from one reference stage (the output stage unless
  // chosen otherwise), or each view scales itself ("panel").
  const perPanel = scaleRef === "panel";
  const refIdx = perPanel
    ? -1
    : stageIds.includes(scaleRef)
      ? stageIds.indexOf(scaleRef)
      : stageIds.includes("flattened")
        ? stageIds.indexOf("flattened")
        : stageIds.length - 1;
  const refCentre = refIdx >= 0 ? scaleResults[refIdx]?.data : undefined;
  const refSamples = useMemo(() => (refCentre ? [refCentre.data] : null), [refCentre]);
  const lv = useLevels({
    samples: refSamples,
    histData: refIdx >= 0 ? sliceResults[refIdx]?.data?.data : null,
    scale,
    manual: manual && manual.dataset === datasetId ? manual : null,
  });
  const setLevels = (l: { lo: number; hi: number }) => datasetId && setManual({ ...l, dataset: datasetId });

  // "Each view": every stage on its own Auto from its centre-cut slice.
  const panelAuto = scaleResults.map((r) => (perPanel && r.data ? cachedAuto(r.data, scale) : null));

  // One viewport for every stage view on this plane, shared with the Q–R page.
  const fit = useMemo(() => {
    if (!meta) return { cx: 0, cy: 0, half: 1 };
    const range = { H: meta.h_range, K: meta.k_range, L: meta.l_range };
    return fitViewport({ x_axis: range[xAxis], y_axis: range[yAxis] }, geom);
  }, [meta, xAxis, yAxis, geom]);
  const viewport = views[plane] ?? fit;
  const step = (ax: FixedAxis) => {
    if (!meta) return 0.01;
    const [lo, hi] = [meta.h_range, meta.k_range, meta.l_range][AXIS_INDEX[ax]];
    return (hi - lo) / Math.max(1, meta.shape[AXIS_INDEX[ax]] - 1);
  };
  const voxel = Math.min(step(xAxis) * geom.sx, step(yAxis) * geom.sy);
  const limit = (h: number) => clampHalf(h, fit.half, voxel);

  const valueAt = (s: Slice | undefined, p: [number, number]) => {
    if (!s) return undefined;
    const ij = sampleIndex(s.header, p[0], p[1], geom);
    return ij ? s.data[ij[1] * s.header.nx + ij[0]] : undefined;
  };

  return (
    <div className="page-body qr-page">
      {/* ── Header: raw → flattened pipeline identity · one-liner ── */}
      <div className="qr-header">
        <div className="qr-roundtrip">
          <span className="qr-rt qr-rt--q">raw</span>
          <span className="qr-rt-arrow">→</span>
          <span className="qr-rt">flattened</span>
        </div>
        <span className="qr-eyebrow">{stages.length || 5} stages</span>
        <span className="qr-desc">Each stage strips one artifact, leaving the diffuse signal</span>
      </div>

      {/* ── Workspace header: click mode · plane · cut · layout, then the display bar ── */}
      <div className="ws-head">
        <div className="ws-row">
          <ClickModeControl />
          <span className="ws-sep" />
          <Segmented options={AXES} value={fixedAxis} onChange={(x) => setFixedAxis(x as FixedAxis)} />
          <div className="ws-cut">
            <Slider
              grow
              label={`Cut along ${fixedAxis}`}
              readout={axisInfo ? undefined : "—"}
              valueInput={
                axisInfo
                  ? { value, prefix: `${fixedAxis} =`, suffix: "r.l.u.", onCommit: commitCut }
                  : undefined
              }
              min={0}
              max={axisInfo ? axisInfo.n - 1 : 0}
              value={idx}
              disabled={!axisInfo}
              onChange={setCutIndex}
            />
          </div>
          <span className="ws-spacer" />
          <LayoutControl state={layout} dispatch={dispatchLayout} />
        </div>
        <div className="ws-row ws-display">
          <select aria-label="Colormap" value={colormap} onChange={(e) => setColormap(e.target.value)}>
            {SEQUENTIAL_NAMES.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <div className={perPanel ? "ws-dim" : undefined}>
            <LevelsBar lut={lut} levels={lv.levels} domain={lv.domain} hist={lv.hist} scale={scale} onChange={setLevels} />
          </div>
          <ScaleControl value={scale} onChange={setScale} />
          <AutoButton active={lv.isAuto} onClick={() => setManual(null)} />
          <div className={perPanel ? "ws-dim" : undefined}>
            <BrightnessKnob autoHi={lv.auto.hi} hi={lv.levels.hi} onChange={(hi) => setLevels({ lo: lv.levels.lo, hi })} />
          </div>
          <span className="ws-spacer" />
          <label className="ws-field">
            <span className="field-label">Scale from</span>
            <select value={perPanel ? "panel" : stageIds[refIdx] ?? scaleRef} onChange={(e) => setScaleRef(e.target.value)}>
              {stages.map((s) => (
                <option key={s.name} value={s.name}>{STAGE_LABELS[s.name] ?? s.name}</option>
              ))}
              <option value="panel">Each view</option>
            </select>
          </label>
        </div>
      </div>

      {datasetsQ.isLoading && <EmptyState title="Loading datasets…" />}
      {datasetsQ.isError && (
        <EmptyState
          error
          icon={<IconAlert />}
          title="Backend unreachable"
          hint="Start the API server (nebula3d-web or uvicorn on port 8000) and reload."
        />
      )}
      {dataset && stages.length === 0 && (
        <EmptyState
          title="No processed stages for this dataset"
          hint="Run the pipeline first — the Run pipeline tab will produce the cleanup stages shown here."
        />
      )}

      {/* ── Stage views — same cut, one shared scale, one linked view ── */}
      {stages.length > 0 && (
        <Workspace
          state={layout}
          dispatch={dispatchLayout}
          views={stages.map((s, i) => {
            const r = sliceResults[i];
            const own = perPanel ? panelAuto[i] : null;
            const lo = own ? own.lo : lv.levels.lo;
            const hi = own ? own.hi : lv.levels.hi;
            return {
              id: s.name,
              glow: litStage(lit, s.name),
              title: STAGE_LABELS[s.name] ?? s.name,
              badge: i + 1,
              badgeClass: i === stages.length - 1 ? "view-badge--out" : "",
              caption: own
                ? `${fmtLevel(own.lo)} – ${fmtLevel(own.hi)}`
                : i === refIdx
                  ? <span className="view-caption--ref" title="This stage sets the shared colour scale">ref</span>
                  : null,
              onResetView: () => setView(plane, null),
              children: r?.isError ? (
                <div className="panel-err">{(r.error as Error)?.message}</div>
              ) : r?.data ? (
                <ViewFrame
                  viewport={viewport}
                  onViewport={(v) => setView(plane, v)}
                  fit={fit}
                  limit={limit}
                  mode={clickMode}
                  axes={{ sx: geom.sx, sy: geom.sy, xLabel: xAxis, yLabel: yAxis, unit: "r.l.u.", fovUnit: "Å⁻¹" }}
                  cursor={cursor}
                  onCursor={setCursor}
                >
                  <SliceCanvas
                    slice={r.data}
                    lut={lut}
                    vmin={lo}
                    vmax={hi}
                    log={false}
                    scale={scale}
                    soft={own ? own.soft : lv.soft}
                    viewport={viewport}
                    reciprocalAxes
                    latX={latX}
                    latY={latY}
                    latCut={latCut}
                  />
                  {r.isFetching && <span className="spin vf-spin" />}
                </ViewFrame>
              ) : (
                <div className="skeleton" style={{ width: "100%", height: "100%" }} />
              ),
            };
          })}
        />
      )}

      {stages.length > 0 && (
        <div className="ws-readout">
          {cursor ? (
            <>
              <b>
                {xAxis} {(cursor[0] / geom.sx).toFixed(3)} · {yAxis} {(cursor[1] / geom.sy).toFixed(3)}
              </b>
              {stages.map((s, i) => {
                const v = valueAt(sliceResults[i]?.data, cursor);
                return (
                  <span key={s.name}>
                    <i>{STAGE_LABELS[s.name] ?? s.name}</i>{" "}
                    {v === undefined ? "—" : Number.isFinite(v) ? fmtLevel(v) : "hole"}
                  </span>
                );
              })}
            </>
          ) : (
            <span className="muted">Hover a slice to read the same ({xAxis}, {yAxis}) in every stage.</span>
          )}
        </div>
      )}

      {meta && (
        <MetaStrip
          items={[
            { key: "Source", value: dataset?.raw_name },
            { key: "Plane", value: plane },
            {
              key: "Colour scale",
              value: perPanel ? "per view (Auto)" : `${fmtLevel(lv.levels.lo)} … ${fmtLevel(lv.levels.hi)} · ${scale}`,
            },
            {
              key: "Lattice",
              value: `a=${meta.lattice.a?.toFixed(2)}  b=${meta.lattice.b?.toFixed(2)}  c=${meta.lattice.c?.toFixed(2)} Å`,
            },
            { key: "Grid", value: meta.shape.join(" × ") },
          ]}
        />
      )}
    </div>
  );
}
