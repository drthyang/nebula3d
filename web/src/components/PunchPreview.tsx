// The Configure page's preview: the input volume (raw, else ring-removed) on
// one plane at a time, a*–b*, a*–c* or b*–c* in tabs, with the punch drawn
// over it: the footprint at each Bragg node, the direct beam at the origin, an
// example search punch (a "satellite") and the ΔPDF's |Q| band.
//
// It is a slice view like those of the viewer pages, on their frame and header:
// zoom, pan and reset as on every view (ViewFrame: Ctrl/⌘ + wheel or a pinch,
// a Shift / middle / two-finger drag, a double-click), Box zoom and the gesture
// card, the HKL grid (the other pages' Unit cell switch, one setting: dashed
// lines at integer h, k, l), and the display bar for the
// colour range (WorkspaceHeader, DisplayBar). Each plane keeps its own zoom.
// The three share one colour scale: Auto pools their cuts through the origin,
// so it holds still while a cut moves and when the tab changes. The colormap
// and scale are the viewer pages' (one setting across the console); the
// limits are the preview's own (state/configViewStore.ts).
//
// The overlay maps display units (Å⁻¹) to the view's pixels with the
// viewport the canvas draws by, so the footprints stay on the peaks at any
// zoom (punchGeometry.ts).

import { useId, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";

import { fetchSlice } from "../api/client";
import type { Slice, VolumeMeta } from "../api/types";
import { COLORMAPS, SEQUENTIAL_NAMES } from "../colormaps/luts";
import { useConfigViewStore, previewView } from "../state/configViewStore";
import { useDpdfStore } from "../state/dpdfStore";
import type { PunchPlane } from "../state/pipelineStore";
import { useViewerStore } from "../state/viewerStore";
import { fmtLevel } from "./colorScale";
import {
  axisIndex,
  axisLattice,
  axisRange,
  ellipseForNode,
  ellipseToPixels,
  originCut,
  planeHklAxes,
  PUNCH_PLANES,
  qEllipseForPlane,
  qShellEllipseForPlane,
  visibleNodes,
  type DisplayEllipse,
  type HklAxis,
  type PunchGeom,
} from "./punchGeometry";
import { SliceCanvas } from "./SliceCanvas";
import { TabList } from "./Tabs";
import { tabId, tabPanelId } from "./tabKeys";
import { HelpTip, Slider } from "./ui";
import { HklGrid } from "./UnitCellGrid";
import { useLevels } from "./useLevels";
import { ViewFrame } from "./ViewFrame";
import { useViewSize } from "./viewSize";
import { clampHalf, displayToPixel, extentBounds, fitViewport, sampleIndex, type SliceGeom, type Viewport } from "./viewport";
import { HKL_GRID_LABEL, RESET_ZOOM_TITLE } from "./viewerText";
import { UnitCellsSwitch, WorkspaceHeader } from "./WorkspaceHeader";

const TABS = PUNCH_PLANES.map((p) => ({ id: p.id, label: p.title, title: `The ${p.title} plane, cut along ${p.cutLabel}` }));

// Where the example search punch is drawn (r.l.u.): off every lattice node.
const SATELLITE: [number, number] = [1.5, -0.5];

const rangeOf = (meta: VolumeMeta, axis: HklAxis): [number, number] =>
  axis === "H" ? meta.h_range : axis === "K" ? meta.k_range : meta.l_range;

const sliceKey = (inputId: string | undefined, plane: PunchPlane, cut: number) => ["slice", inputId, plane, cut, false, "config-punch"];

/** The punch over the view, in its pixels; clipped to the slice's extent. */
function PunchOverlay({
  plane,
  geom,
  meta,
  viewport,
  bands,
  cut,
}: {
  plane: PunchPlane;
  geom: PunchGeom;
  meta: VolumeMeta;
  viewport: Viewport;
  bands: [number, number];
  cut: number;
}) {
  const { w, h } = useViewSize();
  const clip = useId();
  if (w <= 1 || h <= 1) return null;
  const { lattice, ub_matrix: ub } = meta;
  const [axisX, axisY] = planeHklAxes(plane);
  const qScaleX = (2 * Math.PI) / (axisLattice(axisX, lattice) ?? 1);
  const qScaleY = (2 * Math.PI) / (axisLattice(axisY, lattice) ?? 1);
  const extentX = rangeOf(meta, axisX);
  const extentY = rangeOf(meta, axisY);
  const inExtent = (x: number, y: number) =>
    x >= Math.min(...extentX) && x <= Math.max(...extentX) && y >= Math.min(...extentY) && y <= Math.max(...extentY);

  // The resolution footprint grows by the margin on every axis; the direct
  // beam by its own.
  const m = geom.margin;
  const bragg = qEllipseForPlane(plane, { ...geom, r0: geom.r0 + m, r1: geom.r1 + m, r2: geom.r2 + m }, lattice, ub);
  const db = geom.directBeamRadiiQ;
  const dm = geom.directBeamMargin;
  const beam = qEllipseForPlane(plane, { ...geom, r0: db[0] + dm, r1: db[1] + dm, r2: db[2] + dm }, lattice, ub);
  const nodes =
    visibleNodes({
      viewport,
      w,
      h,
      qScaleX,
      qScaleY,
      extentX,
      extentY,
      cell: [geom.supercell[axisIndex(axisX)], geom.supercell[axisIndex(axisY)]],
    }) ?? [];
  const band = bands.flatMap((R) => {
    const e = R > 0 ? qShellEllipseForPlane(plane, R, lattice, ub, cut) : null;
    return e ? [e] : [];
  });

  const shape = (e: DisplayEllipse, className: string, key: string) => {
    const p = ellipseToPixels(e, viewport, w, h);
    return (
      <ellipse
        key={key}
        cx={p.cx}
        cy={p.cy}
        rx={Math.max(0.5, p.rx)}
        ry={Math.max(0.5, p.ry)}
        transform={p.angle ? `rotate(${p.angle.toFixed(2)} ${p.cx.toFixed(1)} ${p.cy.toFixed(1)})` : undefined}
        className={className}
      />
    );
  };
  const at = (x: number, y: number, e: { rx: number; ry: number; angle: number }): DisplayEllipse => ({ cx: x * qScaleX, cy: y * qScaleY, ...e });

  // The slice's extent in pixels (a right-angled r.l.u. view).
  const [x0, y0] = displayToPixel(viewport, Math.min(...extentX) * qScaleX, Math.max(...extentY) * qScaleY, w, h);
  const [x1, y1] = displayToPixel(viewport, Math.max(...extentX) * qScaleX, Math.min(...extentY) * qScaleY, w, h);

  return (
    <svg className="punch-overlay" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <defs>
        <clipPath id={clip}>
          <rect x={x0} y={y0} width={Math.max(0, x1 - x0)} height={Math.max(0, y1 - y0)} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        {band.map((e, i) => shape(e, "punch-qband", `band${i}`))}
        {geom.mode !== "integer" && inExtent(...SATELLITE) &&
          shape(at(...SATELLITE, ellipseForNode(plane, geom, bragg, lattice, ub, SATELLITE[0], SATELLITE[1], cut)), "punch-sat", "sat")}
        {nodes.map(({ x, y }) =>
          x === 0 && y === 0
            ? shape(at(0, 0, beam), "punch-ib", "beam")
            : shape(at(x, y, ellipseForNode(plane, geom, bragg, lattice, ub, x, y, cut)), "punch-fp", `${x},${y}`),
        )}
      </g>
    </svg>
  );
}

const RESET_ICON = (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M2.75 8a5.25 5.25 0 1 0 1.6-3.8" />
    <path d="M2.5 2.5v3h3" />
  </svg>
);

export interface PunchPreviewProps {
  datasetId: string | null | undefined;
  inputId: string | undefined; // the volume shown: raw, else ring-removed
  sourceName: string | undefined;
  meta: VolumeMeta | undefined;
  geom: PunchGeom;
  cuts: Record<HklAxis, number>;
  onCut: (axis: HklAxis, value: number) => void;
  bands: [number, number]; // the ΔPDF's |Q| band (Å⁻¹; 0 = no edge)
  bandText: string; // the band as the caption says it ("full", "0.50–8.00 Å⁻¹")
  footprintText: string; // the footprint's radii as the caption says them
}

export function PunchPreview({ datasetId, inputId, sourceName, meta, geom, cuts, onCut, bands, bandText, footprintText }: PunchPreviewProps) {
  const tab = useConfigViewStore((s) => s.previewTab);
  const setTab = useConfigViewStore((s) => s.setPreviewTab);
  const views = useConfigViewStore((s) => s.views);
  const setView = useConfigViewStore((s) => s.setView);
  const manual = useConfigViewStore((s) => s.levels);
  const setManual = useConfigViewStore((s) => s.setLevels);
  const colormap = useViewerStore((s) => s.colormap);
  const setColormap = useViewerStore((s) => s.setColormap);
  const scale = useViewerStore((s) => s.scale);
  const setScale = useViewerStore((s) => s.setScale);
  // "HKL grid" here, "Unit cell" on the other pages: one setting, the lines of integer h, k, l.
  const gridlines = useDpdfStore((s) => s.gridlines);
  const [cursor, setCursor] = useState<[number, number] | null>(null);
  const idBase = useId();

  const spec = PUNCH_PLANES.find((p) => p.id === tab) ?? PUNCH_PLANES[0];
  const plane = spec.id;
  const [axisX, axisY] = planeHklAxes(plane);
  const latX = axisLattice(axisX, meta?.lattice) ?? 1;
  const latY = axisLattice(axisY, meta?.lattice) ?? 1;
  const latCut = axisLattice(spec.cutAxis, meta?.lattice) ?? 1;
  const sliceGeom: SliceGeom = useMemo(() => ({ sx: (2 * Math.PI) / latX, sy: (2 * Math.PI) / latY, angle: 90 }), [latX, latY]);
  const cutRange = axisRange(meta, spec.cutAxis);
  const cut = Math.max(cutRange.min, Math.min(cutRange.max, cuts[spec.cutAxis] ?? 0));

  // The plane on show at its cut; while another cut loads, the last one stays
  // (never another plane's or another volume's: their axes differ).
  const sliceQ = useQuery({
    queryKey: sliceKey(inputId, plane, cut),
    queryFn: () => fetchSlice(inputId as string, plane, cut, false),
    enabled: Boolean(inputId && meta),
    placeholderData: (prev, prevQuery) =>
      prevQuery?.queryKey[1] === inputId && prevQuery?.queryKey[2] === plane ? prev : undefined,
  });
  const slice: Slice | undefined = sliceQ.data;

  // Auto from the three planes through the origin: one scale for the tabs.
  const refQs = useQueries({
    queries: PUNCH_PLANES.map((p) => {
      const c = originCut(axisRange(meta, p.cutAxis));
      return {
        queryKey: sliceKey(inputId, p.id, c),
        queryFn: () => fetchSlice(inputId as string, p.id, c, false),
        enabled: Boolean(inputId && meta),
        staleTime: Infinity,
      };
    }),
  });
  const [r0, r1, r2] = refQs.map((q) => q.data?.data);
  const samples = useMemo(() => {
    const got = [r0, r1, r2].filter((d): d is Float32Array => Boolean(d));
    return got.length ? got : null;
  }, [r0, r1, r2]);
  const lv = useLevels({
    samples,
    histData: slice?.data,
    scale,
    manual: manual && manual.dataset === datasetId ? manual : null,
  });
  const lut = COLORMAPS[colormap] ?? COLORMAPS.inferno;

  // The whole slice is the full view; panning keeps the view's centre on it.
  const fit = useMemo(
    () => (meta ? fitViewport({ x_axis: rangeOf(meta, axisX), y_axis: rangeOf(meta, axisY) }, sliceGeom) : { cx: 0, cy: 0, half: 1 }),
    [meta, axisX, axisY, sliceGeom],
  );
  const bounds = useMemo(
    () => (meta ? extentBounds({ x_axis: rangeOf(meta, axisX), y_axis: rangeOf(meta, axisY) }, sliceGeom) : undefined),
    [meta, axisX, axisY, sliceGeom],
  );
  const viewport = previewView(views, datasetId, plane) ?? fit;
  const voxel = Math.min(axisRange(meta, axisX).step * sliceGeom.sx, axisRange(meta, axisY).step * sliceGeom.sy);
  const limit = (half: number) => clampHalf(half, fit.half, voxel);
  const onViewport = (v: Viewport | null) => datasetId && setView(datasetId, plane, v);

  const valueAt = (p: [number, number]) => {
    if (!slice) return undefined;
    const ij = sampleIndex(slice.header, p[0], p[1], sliceGeom);
    return ij ? slice.data[ij[1] * slice.header.nx + ij[0]] : undefined;
  };
  const hovered = cursor ? valueAt(cursor) : undefined;
  const fmtCut = (v: number) => Number(v.toFixed(3)).toString();

  let body;
  if (!inputId) {
    body = <div className="cfg-preview-empty">No raw or ring-removed volume to preview: choose a dataset.</div>;
  } else if (sliceQ.isError) {
    body = <div className="panel-err">{(sliceQ.error as Error)?.message ?? "Slice unavailable"}</div>;
  } else if (slice && meta) {
    body = (
      <ViewFrame
        viewport={viewport}
        onViewport={onViewport}
        fit={fit}
        bounds={bounds}
        limit={limit}
        onReset={() => onViewport(null)}
        axes={{ sx: sliceGeom.sx, sy: sliceGeom.sy, xLabel: axisX, yLabel: axisY, unit: "r.l.u.", fovUnit: "Å⁻¹" }}
        cursor={cursor}
        onCursor={setCursor}
      >
        <SliceCanvas
          slice={slice}
          lut={lut}
          vmin={lv.levels.lo}
          vmax={lv.levels.hi}
          log={false}
          scale={scale}
          soft={lv.soft}
          viewport={viewport}
          reciprocalAxes
          latX={latX}
          latY={latY}
          latCut={latCut}
        />
        {gridlines && <HklGrid viewport={viewport} geom={sliceGeom} lut={lut} />}
        <PunchOverlay plane={plane} geom={geom} meta={meta} viewport={viewport} bands={bands} cut={cut} />
        {sliceQ.isFetching && <span className="spin vf-spin" />}
      </ViewFrame>
    );
  } else {
    body = <div className="skeleton" style={{ width: "100%", height: "100%" }} />;
  }

  return (
    <section className="card cfg-preview" aria-labelledby={`${idBase}-title`}>
      <div className="card-title-row">
        <h3 id={`${idBase}-title`}>Preview</h3>
        <span className="cfg-card-summary">The input volume with the punch and the |Q| band drawn over it</span>
        <span className="card-title-rule" />
        <HelpTip>
          The raw volume (the ring-removed one when there is no raw file). Bragg: the footprint&apos;s resolution floor,
          the smallest punch, with its margin, at each Bragg node of the punch cell; beam: the direct beam at the
          origin; satellite: an example search punch off the lattice; |Q| band: the band the 3D-ΔPDF keeps. Each
          plane keeps its own zoom; the three share one colour scale, Auto taken from their cuts through the origin.
        </HelpTip>
      </div>

      <WorkspaceHeader
        overlays={<UnitCellsSwitch kind="hkl" label={HKL_GRID_LABEL} />}
        nav={
          <div className="ws-cut">
            <Slider
              grow
              label={`Cut ${spec.cutAxis}`}
              readout={meta ? undefined : "—"}
              valueInput={
                meta
                  ? { value: cut, prefix: `${spec.cutAxis} =`, suffix: "r.l.u.", onCommit: (v) => onCut(spec.cutAxis, Number(Math.max(cutRange.min, Math.min(cutRange.max, v)).toFixed(4))) }
                  : undefined
              }
              min={cutRange.min}
              max={cutRange.max}
              step={cutRange.step}
              value={cut}
              disabled={!meta}
              onChange={(v) => onCut(spec.cutAxis, Number(v.toFixed(4)))}
            />
          </div>
        }
        displays={[
          {
            colormap,
            colormaps: SEQUENTIAL_NAMES,
            onColormap: setColormap,
            lut,
            lv,
            onLevels: (l) => datasetId && setManual({ ...l, dataset: datasetId }),
            onAuto: () => setManual(null),
            scale,
            onScale: setScale,
          },
        ]}
      />

      <div className="view cfg-preview-view">
        <header className="view-head">
          <TabList tabs={TABS} value={plane} onChange={(id) => setTab(id as PunchPlane)} label="Preview plane" idBase={idBase} />
          <span className="view-caption">
            {sourceName ?? "—"} · {spec.cutAxis} = {fmtCut(cut)}
          </span>
          <span className="view-actions">
            <button type="button" className="icon-btn view-reset" title={RESET_ZOOM_TITLE} aria-label="Reset zoom" onClick={() => onViewport(null)}>
              {RESET_ICON}
            </button>
          </span>
        </header>
        <div className="view-body" role="tabpanel" id={tabPanelId(idBase)} aria-labelledby={tabId(idBase, plane)}>
          <div className="view-fill">{body}</div>
        </div>
        <footer className="view-foot cfg-preview-foot">
          <div className="punch-legend">
            <span>
              <span className="sw fp" />
              Bragg
            </span>
            <span>
              <span className="sw ib" />
              beam
            </span>
            {geom.mode !== "integer" && (
              <span>
                <span className="sw sat" />
                satellite
              </span>
            )}
            {(bands[0] > 0 || bands[1] > 0) && (
              <span>
                <span className="sw qband" />
                |Q| band
              </span>
            )}
          </div>
          <span className="cfg-preview-cap">
            footprint <b>{footprintText}</b> · |Q| band <b>{bandText}</b>
          </span>
        </footer>
      </div>

      <div className="ws-readout cfg-preview-readout">
        {cursor ? (
          <>
            <b>
              {axisX} {(cursor[0] / sliceGeom.sx).toFixed(3)} · {axisY} {(cursor[1] / sliceGeom.sy).toFixed(3)} · {spec.cutAxis} {fmtCut(cut)}
            </b>
            <span>{hovered === undefined ? "—" : Number.isFinite(hovered) ? fmtLevel(hovered) : "masked"}</span>
          </>
        ) : (
          <span className="muted">Hover the slice to read its intensity at ({axisX}, {axisY}).</span>
        )}
      </div>
    </section>
  );
}
