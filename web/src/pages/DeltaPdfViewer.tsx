// Single-temperature 3D-ΔPDF orthoslice viewer — replaces
// examples/explore_delta_pdf_ortho.py.  Three linked orthogonal real-space cuts
// in a workspace (grid · focus · single), each with its own cut slider, one
// shared ± colour scale, a unit-cell gridline toggle and an optional overlay of
// a crystal structure's pair vectors.  In Navigate mode a click on one view
// moves the other two cuts through that point.

import { useCallback, useEffect, useMemo, useState } from "react";

import { useDatasets, useDpdfMeta, useDpdfSlice } from "../api/hooks";
import type { Slice } from "../api/types";
import { COLORMAPS, DIVERGING_NAMES, DIVERGING_NAME } from "../colormaps/luts";
import { fmtLevel } from "../components/colorScale";
import { AutoButton, BrightnessKnob, ClickModeControl, LevelsBar } from "../components/DisplayBar";
import { latticeLabel } from "../components/oblique";
import { SliceCanvas } from "../components/SliceCanvas";
import { StructureHits, StructureOverlay } from "../components/StructureOverlay";
import { StructureLegend, StructurePanel } from "../components/StructurePanel";
import {
  EmptyState,
  MetaStrip,
  Slider,
  Switch,
  type ValueInputConfig,
} from "../components/ui";
import { UnitCellGrid } from "../components/UnitCellGrid";
import { useLevels } from "../components/useLevels";
import { ViewFrame } from "../components/ViewFrame";
import { clampHalf, displayToSlice, sampleIndex, type Viewport } from "../components/viewport";
import { useWorkspaceLayout } from "../components/useWorkspaceLayout";
import { LayoutControl, Workspace } from "../components/Workspace";
import { useDatasetStore, useInitializeDataset } from "../state/datasetStore";
import { defaultDpdfView, useDpdfStore } from "../state/dpdfStore";
import { useStructureStore } from "../state/structureStore";
import { useWorkspaceStore } from "../state/workspaceStore";
import type { Marker } from "../structure/pairs";
import { markersNear, usePlaneMarkers, useStructureModel } from "../structure/useStructure";

function axisValue(
  range: [number, number] | undefined,
  n: number | undefined,
  idx: number,
): number {
  if (!range || !n || n < 2) return 0;
  return range[0] + Math.min(idx, n - 1) * ((range[1] - range[0]) / (n - 1));
}

// Snap an Å value back to the nearest grid index along an axis.
function commitAngstrom(
  range: [number, number],
  n: number,
  setIdx: (i: number) => void,
): (v: number) => void {
  return (v) => {
    if (n < 2) return;
    const step = (range[1] - range[0]) / (n - 1);
    const i = Math.round((v - range[0]) / step);
    setIdx(Math.max(0, Math.min(n - 1, i)));
  };
}

type Ax = "x" | "y" | "z";
// Each orthoslice: its plane, in-plane axes (h, v) and the axis it is cut along.
const PLANES: { plane: "xy" | "xz" | "yz"; h: Ax; v: Ax; cut: Ax; badge: string; badgeClass: string; title: string }[] = [
  { plane: "xy", h: "x", v: "y", cut: "z", badge: "z_L", badgeClass: "qr-rt--qp", title: "x_H – y_K" },
  { plane: "xz", h: "x", v: "z", cut: "y", badge: "y_K", badgeClass: "qr-rt--r", title: "x_H – z_L" },
  { plane: "yz", h: "y", v: "z", cut: "x", badge: "x_H", badgeClass: "qr-rt--q", title: "y_K – z_L" },
];
const AX_LABEL: Record<Ax, string> = { x: "x_H", y: "y_K", z: "z_L" };
const AX_HUE: Record<Ax, string> = { x: "dpdf-cut--x", y: "dpdf-cut--y", z: "dpdf-cut--z" };
const AX_LAT: Record<Ax, string> = { x: "a", y: "b", z: "c" };

export function DeltaPdfViewer() {
  const datasetsQ = useDatasets();
  const datasets = useMemo(() => datasetsQ.data ?? [], [datasetsQ.data]);
  useInitializeDataset(datasets);

  const datasetId = useDatasetStore((s) => s.datasetId);
  const cutX = useDpdfStore((s) => s.cutX);
  const cutY = useDpdfStore((s) => s.cutY);
  const cutZ = useDpdfStore((s) => s.cutZ);
  const manual = useDpdfStore((s) => s.limit);
  const gridlines = useDpdfStore((s) => s.gridlines);
  const colormap = useDpdfStore((s) => s.colormap);
  const views = useDpdfStore((s) => s.views);
  const setColormap = useDpdfStore((s) => s.setColormap);
  const centered = useDpdfStore((s) => s.centered);
  const setCutX = useDpdfStore((s) => s.setCutX);
  const setCutY = useDpdfStore((s) => s.setCutY);
  const setCutZ = useDpdfStore((s) => s.setCutZ);
  const setManual = useDpdfStore((s) => s.setLimit);
  const setGridlines = useDpdfStore((s) => s.setGridlines);
  const setView = useDpdfStore((s) => s.setView);
  const center = useDpdfStore((s) => s.center);
  const clickMode = useWorkspaceStore((s) => s.clickMode);
  const [cursor, setCursor] = useState<{ plane: string; p: [number, number] } | null>(null);

  const [layout, dispatchLayout] = useWorkspaceLayout("dpdf", ["xy", "xz", "yz"], {
    mode: "grid",
    primary: "xy",
    lastMulti: "grid",
  });

  const dataset = datasets.find((d) => d.id === datasetId);
  const volumeId = dataset?.stages.find((s) => s.name === "delta_pdf")?.volume_id;
  const meta = useDpdfMeta(volumeId).data;

  const recenter = useCallback(() => {
    if (!meta) return;
    center(
      Math.floor(meta.shape[0] / 2),
      Math.floor(meta.shape[1] / 2),
      Math.floor(meta.shape[2] / 2),
    );
  }, [meta, center]);

  useEffect(() => {
    if (meta && !centered) recenter();
  }, [meta, centered, recenter]);

  const lut = COLORMAPS[colormap] ?? COLORMAPS[DIVERGING_NAME];
  const lat: Record<Ax, number | null> = {
    x: meta?.lattice.a ?? null,
    y: meta?.lattice.b ?? null,
    z: meta?.lattice.c ?? null,
  };
  const range: Record<Ax, [number, number] | undefined> = { x: meta?.x_range, y: meta?.y_range, z: meta?.z_range };
  const shape: Record<Ax, number | undefined> = { x: meta?.shape[0], y: meta?.shape[1], z: meta?.shape[2] };
  const idx: Record<Ax, number> = { x: cutX, y: cutY, z: cutZ };
  const setIdx: Record<Ax, (i: number) => void> = { x: setCutX, y: setCutY, z: setCutZ };
  const val = (a: Ax) => axisValue(range[a], shape[a], idx[a]);
  const centreVal = (a: Ax) => axisValue(range[a], shape[a], shape[a] ? Math.floor(shape[a]! / 2) : 0);

  // Current slices, and the centre-cut slices that set Auto (so the scale holds
  // still while the cuts move).  Fixed hook count: one per plane.
  const sXY = useDpdfSlice(volumeId, "xy", val("z"));
  const sXZ = useDpdfSlice(volumeId, "xz", val("y"));
  const sYZ = useDpdfSlice(volumeId, "yz", val("x"));
  const cXY = useDpdfSlice(volumeId, "xy", centreVal("z")).data;
  const cXZ = useDpdfSlice(volumeId, "xz", centreVal("y")).data;
  const cYZ = useDpdfSlice(volumeId, "yz", centreVal("x")).data;
  const results = { xy: sXY, xz: sXZ, yz: sYZ };
  const samples = useMemo(
    () => (cXY && cXZ && cYZ ? [cXY.data, cXZ.data, cYZ.data] : null),
    [cXY, cXZ, cYZ],
  );
  const lv = useLevels({
    samples,
    histData: sXY.data?.data,
    signed: true,
    manual: manual && manual.dataset === datasetId ? { lo: -manual.value, hi: manual.value } : null,
  });
  const setLimit = (hi: number) => datasetId && setManual({ value: Math.abs(hi), dataset: datasetId });

  // Two editable boxes per axis: the cut in Å, and the cut divided by the lattice
  // parameter along that direction (a/b/c).  Editing either snaps the cut.
  const axisInputs = (a: Ax): ValueInputConfig[] | undefined => {
    const r = range[a], n = shape[a];
    if (!r || !n) return undefined;
    const commit = commitAngstrom(r, n, setIdx[a]);
    const inputs: ValueInputConfig[] = [{ value: val(a), suffix: "Å", onCommit: commit }];
    const l = lat[a];
    if (l != null && l !== 0) {
      inputs.push({ value: val(a) / l, prefix: `/${AX_LAT[a]}`, onCommit: (u) => commit(u * l) });
    }
    return inputs;
  };

  const fullHalf = meta
    ? Math.max(...[meta.x_range, meta.y_range, meta.z_range].map((r) => Math.max(Math.abs(r[0]), Math.abs(r[1]))))
    : 100;
  const voxel = meta && meta.shape[0] > 1 ? (meta.x_range[1] - meta.x_range[0]) / (meta.shape[0] - 1) : 0.5;
  const limit = (h: number) => clampHalf(h, fullHalf, voxel);
  const fit = defaultDpdfView();

  // Structure overlay: pair vectors within ± depth of each cut (default half a
  // voxel along the cut axis, i.e. the vectors this slice holds).
  const structure = useStructureModel(meta?.lattice);
  const showStructure = useStructureStore((s) => s.show) && structure !== null;
  const setShowStructure = useStructureStore((s) => s.setShow);
  const storedDepth = useStructureStore((s) => s.depth);
  const [structurePanel, setStructurePanel] = useState(false);
  const depthFor = (a: Ax) => {
    const r = range[a], n = shape[a];
    return storedDepth ?? (r && n && n > 1 ? (r[1] - r[0]) / (n - 1) / 2 : 0);
  };
  const planeMarkers = (p: (typeof PLANES)[number]) => ({
    h: p.h, v: p.v, cut: p.cut, value: val(p.cut), hRange: range[p.h] ?? null, vRange: range[p.v] ?? null,
  });
  const markers: Record<string, Marker[]> = {
    xy: usePlaneMarkers(structure, meta?.lattice, planeMarkers(PLANES[0]), depthFor("z")),
    xz: usePlaneMarkers(structure, meta?.lattice, planeMarkers(PLANES[1]), depthFor("y")),
    yz: usePlaneMarkers(structure, meta?.lattice, planeMarkers(PLANES[2]), depthFor("x")),
  };
  const cellAngles: [number, number, number] = [
    meta?.lattice.alpha ?? 90,
    meta?.lattice.beta ?? 90,
    meta?.lattice.gamma ?? 90,
  ];

  // Navigate: a click on one view moves the other two cuts through the point.
  const navigate = (p: (typeof PLANES)[number], slice: Slice | undefined) => (X: number, Y: number) => {
    const angle = slice?.header.axes_angle ?? 90;
    const [h, v] = displayToSlice(X, Y, { sx: 1, sy: 1, angle });
    for (const [a, value] of [[p.h, h], [p.v, v]] as [Ax, number][]) {
      const r = range[a], n = shape[a];
      if (r && n) commitAngstrom(r, n, setIdx[a])(value);
    }
  };

  const valueAt = (s: Slice | undefined, pt: [number, number]) => {
    if (!s) return undefined;
    const ij = sampleIndex(s.header, pt[0], pt[1], { sx: 1, sy: 1, angle: s.header.axes_angle ?? 90 });
    return ij ? s.data[ij[1] * s.header.nx + ij[0]] : undefined;
  };

  return (
    <div className="page-body qr-page">
      {/* ── Header: x·y·z orthoslice identity · recenter ───────── */}
      <div className="qr-header">
        <div className="qr-roundtrip">
          <span className="qr-rt qr-rt--q">x</span>
          <span className="qr-rt-arrow">·</span>
          <span className="qr-rt qr-rt--r">y</span>
          <span className="qr-rt-arrow">·</span>
          <span className="qr-rt qr-rt--qp">z</span>
        </div>
        <span className="qr-eyebrow">Orthoslices</span>
        <span className="qr-desc">Three linked real-space cuts about the origin</span>
        <div className="qr-header-actions">
          <button type="button" className="btn btn-ghost" disabled={!meta} onClick={recenter}>
            Recenter cuts
          </button>
        </div>
      </div>

      {/* ── Workspace header: click mode · unit cells · layout, then the display bar ── */}
      <div className="ws-head">
        <div className="ws-row">
          <ClickModeControl />
          <span className="ws-sep" />
          <Switch label="Unit cells" checked={gridlines} onChange={setGridlines} />
          <Switch label="Structure" checked={showStructure} disabled={!structure} onChange={setShowStructure} />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-expanded={structurePanel}
            onClick={() => setStructurePanel((o) => !o)}
          >
            {structure ? "Edit structure…" : "Add structure…"}
          </button>
          <span className="ws-spacer" />
          <LayoutControl state={layout} dispatch={dispatchLayout} />
        </div>
        {showStructure && structure && (
          <div className="ws-row">
            <StructureLegend model={structure} />
          </div>
        )}
        <div className="ws-row ws-display">
          <select aria-label="Colormap" value={colormap} onChange={(e) => setColormap(e.target.value)}>
            {DIVERGING_NAMES.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <LevelsBar lut={lut} levels={lv.levels} domain={lv.domain} hist={lv.hist} symmetric onChange={(l) => setLimit(l.hi)} />
          <AutoButton active={lv.isAuto} onClick={() => setManual(null)} />
          <BrightnessKnob autoHi={lv.auto.hi} hi={lv.levels.hi} onChange={setLimit} />
        </div>
      </div>

      {structurePanel && (
        <StructurePanel
          model={structure}
          lattice={meta?.lattice}
          halfVoxel={voxel / 2}
          onClose={() => setStructurePanel(false)}
        />
      )}

      {datasetsQ.isSuccess && !volumeId && (
        <EmptyState
          title="No ΔPDF volume available for this dataset"
          hint="Run this dataset through the ΔPDF stage — the Run pipeline tab produces the real-space volume shown here."
        />
      )}

      {volumeId && (
        <Workspace
          state={layout}
          dispatch={dispatchLayout}
          views={PLANES.map((p) => {
            const r = results[p.plane];
            const viewport: Viewport = views[p.plane] ?? fit;
            return {
              id: p.plane,
              title: p.title,
              badge: p.badge,
              badgeClass: `qr-rt-badge ${p.badgeClass}`,
              caption: `fixed ${p.cut} · ${val(p.cut).toFixed(2)} Å`,
              onResetView: () => setView(p.plane, null),
              footer: (
                <div className={`qr-foot-cut dpdf-cut ${AX_HUE[p.cut]}`}>
                  <Slider
                    label={`Cut ${AX_LABEL[p.cut]}`}
                    readout={meta ? undefined : "—"}
                    valueInputs={axisInputs(p.cut)}
                    min={0}
                    max={shape[p.cut] ? shape[p.cut]! - 1 : 0}
                    value={idx[p.cut]}
                    disabled={!meta}
                    onChange={setIdx[p.cut]}
                  />
                </div>
              ),
              children: r.isError ? (
                <div className="panel-err">{(r.error as Error).message}</div>
              ) : r.data ? (
                <ViewFrame
                  viewport={viewport}
                  onViewport={(v) => setView(p.plane, v)}
                  fit={fit}
                  limit={limit}
                  mode={clickMode}
                  axes={{ sx: 1, sy: 1, xLabel: AX_LABEL[p.h], yLabel: AX_LABEL[p.v], unit: "Å", fovUnit: "Å" }}
                  cursor={cursor?.plane === p.plane ? cursor.p : null}
                  onCursor={(pt) => setCursor(pt ? { plane: p.plane, p: pt } : null)}
                  onNavigate={navigate(p, r.data)}
                >
                  <SliceCanvas
                    slice={r.data}
                    lut={lut}
                    vmax={lv.levels.hi}
                    log={false}
                    diverging
                    viewport={viewport}
                  />
                  {gridlines && (
                    <UnitCellGrid
                      half={viewport.half}
                      viewport={viewport}
                      latX={lat[p.h]}
                      latY={lat[p.v]}
                      angle={r.data.header.axes_angle}
                    />
                  )}
                  {showStructure && structure && (
                    <StructureOverlay
                      markers={markers[p.plane]}
                      elements={structure.elements}
                      angle={r.data.header.axes_angle ?? 90}
                      viewport={viewport}
                      depth={depthFor(p.cut)}
                    />
                  )}
                  {r.isFetching && <span className="spin vf-spin" />}
                </ViewFrame>
              ) : (
                <div className="skeleton" style={{ width: "100%", height: "100%" }} />
              ),
            };
          })}
        />
      )}

      {volumeId && (
        <div className="ws-readout">
          {cursor ? (
            (() => {
              const p = PLANES.find((q) => q.plane === cursor.plane)!;
              const s = results[p.plane].data;
              const [h, v] = displayToSlice(cursor.p[0], cursor.p[1], { sx: 1, sy: 1, angle: s?.header.axes_angle ?? 90 });
              const value = valueAt(s, cursor.p);
              const vp = views[p.plane] ?? fit;
              const hits = showStructure && structure
                ? markersNear(markers[p.plane], cursor.p[0], cursor.p[1], s?.header.axes_angle ?? 90, vp.half * 0.035)
                : [];
              return (
                <>
                  <b>
                    {AX_LABEL[p.h]} {h.toFixed(2)} · {AX_LABEL[p.v]} {v.toFixed(2)} · {AX_LABEL[p.cut]} {val(p.cut).toFixed(2)} Å
                  </b>
                  <span>
                    <i>ΔPDF</i> {value === undefined ? "—" : fmtLevel(value)}
                  </span>
                  {structure && (
                    <StructureHits
                      hits={hits}
                      elements={structure.elements}
                      lat={[lat.x ?? 1, lat.y ?? 1, lat.z ?? 1]}
                      angles={cellAngles}
                    />
                  )}
                  {clickMode === "navigate" && hits.length === 0 && (
                    <span className="muted">click to move the other two cuts here</span>
                  )}
                </>
              );
            })()
          ) : (
            <span className="muted">Hover a slice to read the ΔPDF{showStructure ? " and the pair vectors under the pointer" : ""}; in Navigate mode a click moves the other two cuts through the point.</span>
          )}
        </div>
      )}

      {meta && (
        <MetaStrip
          items={[
            { key: "Source", value: dataset?.raw_name },
            { key: "Colour scale", value: `±${fmtLevel(lv.levels.hi)}${lv.isAuto ? " (Auto)" : ""}` },
            { key: "Lattice", value: latticeLabel(meta.lattice) },
            { key: "|Q| max", value: `${meta.q_max?.toFixed(1)} Å⁻¹` },
            ...(structure
              ? [{ key: "Structure", value: `${structure.def.name} · ${structure.atoms.length} atoms per cell` }]
              : []),
          ]}
        />
      )}
    </div>
  );
}
