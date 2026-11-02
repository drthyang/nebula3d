// The Configure page's preview: the input volume (raw, else ring-removed) on
// its three planes, a*–b*, a*–c* and b*–c*, with the punch drawn over them:
// the footprint at each Bragg node, the direct beam at the origin, an example
// search punch (a "satellite") and the ΔPDF's |Q| band. On a wide card the
// three planes sit side by side, each with its cut slider under it; on a
// narrower one they fold into one view with tabs, the cut in the header and
// the tab remembered per browser (previewLayout.ts: where the line falls, and
// why there).
//
// It is a slice view like those of the viewer pages, on their frame and header:
// zoom, pan and reset as on every view (ViewFrame: Ctrl/⌘ + wheel or a pinch,
// a Shift / middle / two-finger drag, a double-click), Box zoom and the gesture
// card, the HKL grid (the other pages' Unit cell switch, one setting: dashed
// lines at integer h, k, l), and the display bar for the colour range
// (WorkspaceHeader, DisplayBar). Each plane keeps its own zoom. The three
// share one colour scale: Auto pools their cuts through the origin, so it
// holds still while a cut moves, when the tab changes and between the
// layouts. The colormap and scale are the viewer pages' (one setting across
// the console); the limits are the preview's own (state/configViewStore.ts).
//
// The overlay maps display units (Å⁻¹) to the view's pixels with the
// viewport the canvas draws by, so the footprints stay on the peaks at any
// zoom (punchGeometry.ts). Over them, in their own colour, the voxels the last
// run's tail sweep added (round 2 of the punch, THY-60), from its record.

import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";

import { fetchSlice } from "../api/client";
import { useBraggProfile } from "../api/hooks";
import type { Slice, TailSweepRecord, VolumeMeta } from "../api/types";
import { COLORMAPS, SEQUENTIAL_NAMES } from "../colormaps/luts";
import { useConfigViewStore, previewView } from "../state/configViewStore";
import { useDpdfStore } from "../state/dpdfStore";
import type { PunchPlane } from "../state/pipelineStore";
import { useViewerStore } from "../state/viewerStore";
import { fmtLevel, type ScaleKind } from "./colorScale";
import { useSideBySide } from "./previewLayout";
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
import { sweptOnPlane } from "./ubTurn";
import { HelpTip, Slider } from "./ui";
import { HklGrid } from "./UnitCellGrid";
import { useLevels } from "./useLevels";
import { ViewFrame } from "./ViewFrame";
import { useViewSize } from "./viewSize";
import {
  clampHalf,
  displayToPixel,
  extentBounds,
  fitViewport,
  sampleIndex,
  type Bounds,
  type SliceGeom,
  type Viewport,
} from "./viewport";
import { useTouchOnly } from "./usePlatform";
import { HKL_GRID_LABEL, readVerb, RESET_ZOOM_TITLE } from "./viewerText";
import { UnitCellsSwitch, WorkspaceHeader } from "./WorkspaceHeader";

const planeTitle = (p: (typeof PUNCH_PLANES)[number]) => `The ${p.title} plane, cut along ${p.cutLabel}`;

const TABS = PUNCH_PLANES.map((p) => ({ id: p.id, label: p.title, title: planeTitle(p) }));

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
  sweep,
}: {
  plane: PunchPlane;
  geom: PunchGeom;
  meta: VolumeMeta;
  viewport: Viewport;
  bands: [number, number];
  cut: number;
  sweep?: TailSweepRecord | null;
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
  // The last run's tail-sweep voxels on this plane, as squares a voxel wide.
  const cutAxis = PUNCH_PLANES.find((p) => p.id === plane)!.cutAxis;
  const [ix, iy, ic] = [axisIndex(axisX), axisIndex(axisY), axisIndex(cutAxis)] as (0 | 1 | 2)[];
  const sx = axisRange(meta, axisX).step;
  const sy = axisRange(meta, axisY).step;
  const swept = sweptOnPlane(sweep, ic, cut, axisRange(meta, cutAxis).step, ix, iy);
  const voxel = ([x, y]: [number, number], i: number) => {
    const [x0, y0] = displayToPixel(viewport, (x - sx / 2) * qScaleX, (y + sy / 2) * qScaleY, w, h);
    const [x1, y1] = displayToPixel(viewport, (x + sx / 2) * qScaleX, (y - sy / 2) * qScaleY, w, h);
    return <rect key={`r2-${i}`} x={x0} y={y0} width={Math.max(1, x1 - x0)} height={Math.max(1, y1 - y0)} className="punch-r2" />;
  };
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
        {swept.map(voxel)}
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

type PlaneSpec = (typeof PUNCH_PLANES)[number];

/** A plane's axes, its r.l.u. → Å⁻¹ mapping, its whole view and how far it zooms. */
interface PlaneFrame {
  spec: PlaneSpec;
  axisX: HklAxis;
  axisY: HklAxis;
  latX: number;
  latY: number;
  latCut: number;
  geom: SliceGeom;
  fit: Viewport; // the whole slice
  bounds: Bounds | undefined; // the slice's extent: panning keeps the view's centre on it
  voxel: number; // the finest voxel side (Å⁻¹)
}

function planeFrame(meta: VolumeMeta | undefined, spec: PlaneSpec): PlaneFrame {
  const [axisX, axisY] = planeHklAxes(spec.id);
  const latX = axisLattice(axisX, meta?.lattice) ?? 1;
  const latY = axisLattice(axisY, meta?.lattice) ?? 1;
  const latCut = axisLattice(spec.cutAxis, meta?.lattice) ?? 1;
  const geom: SliceGeom = { sx: (2 * Math.PI) / latX, sy: (2 * Math.PI) / latY, angle: 90 };
  const extent = meta ? { x_axis: rangeOf(meta, axisX), y_axis: rangeOf(meta, axisY) } : null;
  return {
    spec,
    axisX,
    axisY,
    latX,
    latY,
    latCut,
    geom,
    fit: extent ? fitViewport(extent, geom) : { cx: 0, cy: 0, half: 1 },
    bounds: extent ? extentBounds(extent, geom) : undefined,
    voxel: Math.min(axisRange(meta, axisX).step * geom.sx, axisRange(meta, axisY).step * geom.sy),
  };
}

/**
 * One plane's slice at its cut, fetched while the plane is on show. While
 * another cut loads, the last one stays (never another volume's).
 */
function usePlaneSlice(inputId: string | undefined, meta: VolumeMeta | undefined, plane: PunchPlane, cut: number, shown: boolean) {
  return useQuery({
    queryKey: sliceKey(inputId, plane, cut),
    queryFn: () => fetchSlice(inputId as string, plane, cut, false),
    enabled: shown && Boolean(inputId && meta),
    placeholderData: (prev, prevQuery) =>
      prevQuery?.queryKey[1] === inputId && prevQuery?.queryKey[2] === plane ? prev : undefined,
  });
}

type PlaneQuery = ReturnType<typeof usePlaneSlice>;

/** What a plane's view draws: its slice with the HKL grid and the punch over it, else a placeholder or the error. */
function PlaneBody({
  frame,
  query,
  meta,
  viewport,
  onViewport,
  cursor,
  onCursor,
  punch,
  bands,
  cut,
  gridlines,
  lut,
  vmin,
  vmax,
  scale,
  soft,
  sweep,
}: {
  frame: PlaneFrame;
  query: PlaneQuery;
  meta: VolumeMeta | undefined;
  viewport: Viewport;
  onViewport: (v: Viewport | null) => void;
  cursor: [number, number] | null;
  onCursor: (p: [number, number] | null) => void;
  punch: PunchGeom;
  bands: [number, number];
  cut: number;
  gridlines: boolean;
  lut: Uint8ClampedArray;
  vmin: number;
  vmax: number;
  scale: ScaleKind;
  soft: number;
  sweep?: TailSweepRecord | null;
}) {
  const slice: Slice | undefined = query.data;
  if (query.isError) return <div className="panel-err">{(query.error as Error)?.message ?? "Slice unavailable"}</div>;
  if (!slice || !meta) return <div className="skeleton" style={{ width: "100%", height: "100%" }} />;
  const { geom } = frame;
  return (
    <ViewFrame
      viewport={viewport}
      onViewport={onViewport}
      fit={frame.fit}
      bounds={frame.bounds}
      limit={(half) => clampHalf(half, frame.fit.half, frame.voxel)}
      onReset={() => onViewport(null)}
      axes={{ sx: geom.sx, sy: geom.sy, xLabel: frame.axisX, yLabel: frame.axisY, unit: "r.l.u.", fovUnit: "Å⁻¹" }}
      cursor={cursor}
      onCursor={onCursor}
    >
      <SliceCanvas
        slice={slice}
        lut={lut}
        vmin={vmin}
        vmax={vmax}
        log={false}
        scale={scale}
        soft={soft}
        viewport={viewport}
        reciprocalAxes
        latX={frame.latX}
        latY={frame.latY}
        latCut={frame.latCut}
      />
      {gridlines && <HklGrid viewport={viewport} geom={geom} lut={lut} />}
      <PunchOverlay plane={frame.spec.id} geom={punch} meta={meta} viewport={viewport} bands={bands} cut={cut} sweep={sweep} />
      {query.isFetching && <span className="spin vf-spin" />}
    </ViewFrame>
  );
}

/** The slices on show, pooled for the colour bar's histogram (one array as it is). */
function pooled(parts: (Float32Array | undefined)[]): Float32Array | null {
  const got = parts.filter((d): d is Float32Array => Boolean(d));
  if (got.length < 2) return got[0] ?? null;
  const out = new Float32Array(got.reduce((n, d) => n + d.length, 0));
  let at = 0;
  for (const d of got) {
    out.set(d, at);
    at += d.length;
  }
  return out;
}

export function PunchPreview({ datasetId, inputId, sourceName, meta, geom, cuts, onCut, bands, bandText, footprintText }: PunchPreviewProps) {
  const touch = useTouchOnly();
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
  const [cursor, setCursor] = useState<{ plane: PunchPlane; p: [number, number] } | null>(null);
  const idBase = useId();
  // Wide enough, the three planes side by side; else the tab's plane alone
  // (and with no volume to show, one view says so rather than three).
  const cardRef = useRef<HTMLElement>(null);
  const wide = useSideBySide(cardRef) && Boolean(inputId);

  const frames = useMemo(() => PUNCH_PLANES.map((spec) => planeFrame(meta, spec)), [meta]);
  // The last run's tail sweep (its punch record), drawn over the planes.
  const sweep = useBraggProfile(datasetId ?? undefined).data?.tail_sweep;
  const tabFrame = frames.find((f) => f.spec.id === tab) ?? frames[0];
  const shown = (plane: PunchPlane) => wide || plane === tabFrame.spec.id;
  const cutOf = (spec: PlaneSpec) => {
    const range = axisRange(meta, spec.cutAxis);
    return Math.max(range.min, Math.min(range.max, cuts[spec.cutAxis] ?? 0));
  };
  const [hk, hl, kl] = frames;

  // Each plane on show at its cut (the three side by side, else the tab's).
  const qHK = usePlaneSlice(inputId, meta, "hk", cutOf(hk.spec), shown("hk"));
  const qHL = usePlaneSlice(inputId, meta, "hl", cutOf(hl.spec), shown("hl"));
  const qKL = usePlaneSlice(inputId, meta, "kl", cutOf(kl.spec), shown("kl"));
  const queries: Record<PunchPlane, PlaneQuery> = { hk: qHK, hl: qHL, kl: qKL };

  // Auto from the three planes through the origin: one scale for every plane,
  // in either layout.
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
  // The colour bar's histogram: the slices on show.
  const [dHK, dHL, dKL] = [qHK.data?.data, qHL.data?.data, qKL.data?.data];
  const tabData = queries[tabFrame.spec.id].data?.data;
  const histData = useMemo(() => (wide ? pooled([dHK, dHL, dKL]) : tabData), [wide, dHK, dHL, dKL, tabData]);
  const lv = useLevels({
    samples,
    histData,
    scale,
    manual: manual && manual.dataset === datasetId ? manual : null,
  });
  const lut = COLORMAPS[colormap] ?? COLORMAPS.inferno;

  const onViewportOf = (plane: PunchPlane) => (v: Viewport | null) => datasetId && setView(datasetId, plane, v);
  const fmtCut = (v: number) => Number(v.toFixed(3)).toString();
  const caption = (f: PlaneFrame) => `${sourceName ?? "—"} · ${f.spec.cutAxis} = ${fmtCut(cutOf(f.spec))}`;

  const cutSlider = (f: PlaneFrame, grow: boolean) => {
    const { cutAxis } = f.spec;
    const range = axisRange(meta, cutAxis);
    const clamp = (v: number) => Math.max(range.min, Math.min(range.max, v));
    return (
      <Slider
        grow={grow}
        label={`Cut ${cutAxis}`}
        readout={meta ? undefined : "—"}
        valueInput={
          meta
            ? { value: cutOf(f.spec), prefix: `${cutAxis} =`, suffix: "r.l.u.", onCommit: (v) => onCut(cutAxis, Number(clamp(v).toFixed(4))) }
            : undefined
        }
        min={range.min}
        max={range.max}
        step={range.step}
        value={cutOf(f.spec)}
        disabled={!meta}
        onChange={(v) => onCut(cutAxis, Number(v.toFixed(4)))}
      />
    );
  };

  const resetButton = (plane: PunchPlane) => (
    <button type="button" className="icon-btn view-reset" title={RESET_ZOOM_TITLE} aria-label="Reset zoom" onClick={() => onViewportOf(plane)(null)}>
      {RESET_ICON}
    </button>
  );

  const body = (f: PlaneFrame): ReactNode => {
    if (!inputId) return <div className="cfg-preview-empty">No raw or ring-removed volume to preview: choose a dataset.</div>;
    const plane = f.spec.id;
    return (
      <PlaneBody
        frame={f}
        query={queries[plane]}
        meta={meta}
        viewport={previewView(views, datasetId, plane) ?? f.fit}
        onViewport={onViewportOf(plane)}
        cursor={cursor?.plane === plane ? cursor.p : null}
        onCursor={(p) => setCursor(p ? { plane, p } : null)}
        punch={geom}
        bands={bands}
        cut={cutOf(f.spec)}
        gridlines={gridlines}
        lut={lut}
        vmin={lv.levels.lo}
        vmax={lv.levels.hi}
        scale={scale}
        soft={lv.soft}
        sweep={sweep}
      />
    );
  };

  const legend = (
    <>
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
        {(sweep?.n_voxels ?? 0) > 0 && (
          <span title="Voxels the last run's tail sweep (round 2 of the punch) added beside the Bragg holes, along ω × q̂">
            <span className="sw r2" />
            tail sweep
          </span>
        )}
      </div>
      <span className="cfg-preview-cap">
        footprint <b>{footprintText}</b> · |Q| band <b>{bandText}</b>
      </span>
    </>
  );

  // The hover readout, for the plane under the pointer (one on show).
  const hover = cursor && shown(cursor.plane) ? cursor : null;
  const hoverFrame = hover ? frames.find((f) => f.spec.id === hover.plane) : undefined;
  const hoverSlice = hover ? queries[hover.plane].data : undefined;
  const hoverIj = hover && hoverFrame && hoverSlice ? sampleIndex(hoverSlice.header, hover.p[0], hover.p[1], hoverFrame.geom) : null;
  const hovered = hoverIj && hoverSlice ? hoverSlice.data[hoverIj[1] * hoverSlice.header.nx + hoverIj[0]] : undefined;

  return (
    <section ref={cardRef} className={`card cfg-preview${wide ? " cfg-preview--wide" : ""}`} aria-labelledby={`${idBase}-title`}>
      <div className="card-title-row">
        <h3 id={`${idBase}-title`}>Preview</h3>
        <span className="cfg-card-summary">The input volume with the punch and the |Q| band drawn over it</span>
        <span className="card-title-rule" />
        <HelpTip>
          The raw volume (the ring-removed one when there is no raw file). Bragg: the footprint&apos;s resolution floor,
          the smallest punch, with its margin, at each Bragg node of the punch cell; beam: the direct beam at the
          origin; satellite: an example search punch off the lattice; |Q| band: the band the 3D-ΔPDF keeps. On a wide
          page the three planes sit side by side, each with its cut under it; on a narrower one they are tabs. Each
          plane keeps its own zoom; the three share one colour scale, Auto taken from their cuts through the origin.
        </HelpTip>
      </div>

      <WorkspaceHeader
        overlays={<UnitCellsSwitch kind="hkl" label={HKL_GRID_LABEL} />}
        nav={wide ? undefined : <div className="ws-cut">{cutSlider(tabFrame, true)}</div>}
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

      {wide ? (
        <>
          <div className="cfg-preview-planes">
            {frames.map((f) => (
              <section key={f.spec.id} className="view cfg-preview-plane" aria-label={planeTitle(f.spec)}>
                <header className="view-head">
                  <span className="view-title cfg-plane-title" title={planeTitle(f.spec)}>
                    {f.spec.title}
                  </span>
                  <span className="view-caption">{caption(f)}</span>
                  <span className="view-actions">{resetButton(f.spec.id)}</span>
                </header>
                <div className="view-body">
                  <div className="view-fill">{body(f)}</div>
                </div>
                <footer className="view-foot">{cutSlider(f, false)}</footer>
              </section>
            ))}
          </div>
          <div className="cfg-preview-key">{legend}</div>
        </>
      ) : (
        <div className="view cfg-preview-view">
          <header className="view-head">
            <TabList
              tabs={TABS}
              value={tabFrame.spec.id}
              onChange={(id) => {
                setTab(id as PunchPlane);
                setCursor(null);
              }}
              label="Preview plane"
              idBase={idBase}
            />
            <span className="view-caption">{caption(tabFrame)}</span>
            <span className="view-actions">{resetButton(tabFrame.spec.id)}</span>
          </header>
          <div className="view-body" role="tabpanel" id={tabPanelId(idBase)} aria-labelledby={tabId(idBase, tabFrame.spec.id)}>
            <div className="view-fill">{body(tabFrame)}</div>
          </div>
          <footer className="view-foot cfg-preview-foot">{legend}</footer>
        </div>
      )}

      <div className="ws-readout cfg-preview-readout">
        {hover && hoverFrame ? (
          <>
            <b>
              {hoverFrame.axisX} {(hover.p[0] / hoverFrame.geom.sx).toFixed(3)} · {hoverFrame.axisY}{" "}
              {(hover.p[1] / hoverFrame.geom.sy).toFixed(3)} · {hoverFrame.spec.cutAxis} {fmtCut(cutOf(hoverFrame.spec))}
            </b>
            <span>
              <i>I</i> {hovered === undefined ? "—" : Number.isFinite(hovered) ? fmtLevel(hovered) : "masked"}
            </span>
          </>
        ) : wide ? (
          <span className="muted">{readVerb(touch)} a slice to read its intensity at (H, K, L).</span>
        ) : (
          <span className="muted">
            {readVerb(touch)} the slice to read its intensity at ({tabFrame.axisX}, {tabFrame.axisY}).
          </span>
        )}
      </div>
    </section>
  );
}
