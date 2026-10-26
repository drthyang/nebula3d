// Multi-volume 3D-ΔPDF comparison — replaces
// examples/explore_delta_pdf_multi.py.  Rows = files × columns = the
// three orthoslice planes, with shared cut sliders and ONE ± colour range for
// every cell (so related files are comparable), under the workspace header the
// other viewer pages share (WorkspaceHeader, DisplayBar).  Auto is the
// 3D-ΔPDF page's: the 99.9th percentile of |ΔPDF| over the centre sections,
// the origin's disk left out (dpdfLevels.ts), pooled over every file.
// Every cell is a ViewFrame, zoomed and panned like the other slice views, and
// each plane has ONE viewport shared by every row: the temperatures are always
// compared at the same scale and over the same window (THY-38).

import { Fragment, useEffect, useMemo, useState } from "react";

import { keepPreviousData, useQueries } from "@tanstack/react-query";

import { fetchDpdfSlice } from "../api/client";
import { useDatasets, useDpdfMeta } from "../api/hooks";
import type { Slice } from "../api/types";
import { COLORMAPS, DIVERGING_NAMES, DIVERGING_NAME } from "../colormaps/luts";
import { DisplayBar } from "../components/DisplayBar";
import { DPDF_AUTO_PERCENTILE, withoutOrigin } from "../components/dpdfLevels";
import { SliceCanvas } from "../components/SliceCanvas";
import { UnitCellGrid } from "../components/UnitCellGrid";
import { useLevels } from "../components/useLevels";
import { ViewFrame } from "../components/ViewFrame";
import { AUTO_TITLES } from "../components/viewerText";
import { extentBounds, zoomLimit, type Viewport } from "../components/viewport";
import { UnitCellsSwitch, WorkspaceHeader } from "../components/WorkspaceHeader";
import { EmptyState, MetaStrip, Slider } from "../components/ui";
import { latticeLabel } from "../components/oblique";
import { useDatasetStore, useInitializeDataset } from "../state/datasetStore";
import { defaultDpdfView, useDpdfStore } from "../state/dpdfStore";

const PLANES = [
  { key: "xy", label: "x_H – y_K", h: "x_H", v: "y_K" },
  { key: "xz", label: "x_H – z_L", h: "x_H", v: "z_L" },
  { key: "yz", label: "y_K – z_L", h: "y_K", v: "z_L" },
];

/** The slices of a set of queries (useQueries' `combine`: stable while they are unchanged). */
const sliceData = (rs: { data?: Slice }[]) => rs.map((r) => r.data);

/** Half-width (Å) zooming out reaches at least: the old Window slider's widest, 160 Å. */
const WIDEST_HALF = 80;

function tempNum(t: string | null): number {
  const m = t?.match(/(\d+)/);
  return m ? Number(m[1]) : 1e9;
}

function tempLabel(t: string | null, fallback: string): string {
  return t ? t.replace(/K$/i, " K") : fallback;
}

function axisValue(
  range: [number, number] | undefined,
  n: number | undefined,
  idx: number,
): number {
  if (!range || !n || n < 2) return 0;
  return range[0] + Math.min(idx, n - 1) * ((range[1] - range[0]) / (n - 1));
}

export function MultiTempViewer() {
  const datasetsQ = useDatasets();
  const datasets = useMemo(() => datasetsQ.data ?? [], [datasetsQ.data]);
  useInitializeDataset(datasets);
  const datasetId = useDatasetStore((s) => s.datasetId);
  const temps = useMemo(
    () =>
      datasets
        .filter((d) => d.stages.some((s) => s.name === "delta_pdf" && s.exists))
        .sort((a, b) => tempNum(a.temperature) - tempNum(b.temperature)),
    [datasets],
  );

  const cutX = useDpdfStore((s) => s.cutX);
  const cutY = useDpdfStore((s) => s.cutY);
  const cutZ = useDpdfStore((s) => s.cutZ);
  // Hidden page (not routed): keeps its own ± limit and views, outside the
  // shared real-space store the routed viewers use (its limit is tagged with
  // one dataset; this page shows several).  One viewport per plane, shared by
  // every temperature; it opens at ±40 Å, the old 80 Å window.
  const [manualLimit, setManualLimit] = useState<number | null>(null);
  const [views, setViews] = useState<Record<string, Viewport>>({});
  const setView = (plane: string, v: Viewport | null) =>
    setViews((all) => {
      const next = { ...all };
      if (v) next[plane] = v;
      else delete next[plane];
      return next;
    });
  const [cursor, setCursor] = useState<{ plane: string; p: [number, number] } | null>(null);
  const gridlines = useDpdfStore((s) => s.gridlines);
  const colormap = useDpdfStore((s) => s.colormap);
  const setColormap = useDpdfStore((s) => s.setColormap);
  const centered = useDpdfStore((s) => s.centered);
  const setCutX = useDpdfStore((s) => s.setCutX);
  const setCutY = useDpdfStore((s) => s.setCutY);
  const setCutZ = useDpdfStore((s) => s.setCutZ);
  const center = useDpdfStore((s) => s.center);

  const selectedDpdfDataset = temps.find((d) => d.id === datasetId);
  const metaDataset = selectedDpdfDataset ?? temps[0];
  const metaVolId = metaDataset?.stages.find((s) => s.name === "delta_pdf")?.volume_id;
  const meta = useDpdfMeta(metaVolId).data;
  const a = meta?.lattice.a ?? null;
  const b = meta?.lattice.b ?? null;
  const c = meta?.lattice.c ?? null;
  // Direct-lattice spacings shown on each plane's two axes (a≈b≈c across temps).
  const planeLat: Record<string, [number | null, number | null]> = {
    xy: [a, b],
    xz: [a, c],
    yz: [b, c],
  };

  useEffect(() => {
    if (meta && !centered) {
      center(
        Math.floor(meta.shape[0] / 2),
        Math.floor(meta.shape[1] / 2),
        Math.floor(meta.shape[2] / 2),
      );
    }
  }, [meta, centered, center]);

  const xVal = axisValue(meta?.x_range, meta?.shape[0], cutX);
  const yVal = axisValue(meta?.y_range, meta?.shape[1], cutY);
  const zVal = axisValue(meta?.z_range, meta?.shape[2], cutZ);
  const planeValue: Record<string, number> = { xy: zVal, xz: yVal, yz: xVal };

  const combos = temps.flatMap((t) => {
    const vid = t.stages.find((s) => s.name === "delta_pdf")?.volume_id ?? "";
    return PLANES.map((p) => ({ vid, plane: p.key, value: planeValue[p.key] }));
  });

  const results = useQueries({
    queries: combos.map((c) => ({
      queryKey: ["dpdfSlice", c.vid, c.plane, c.value],
      queryFn: () => fetchDpdfSlice(c.vid, c.plane, c.value),
      enabled: Boolean(meta) && Boolean(c.vid),
      placeholderData: keepPreviousData,
    })),
  });

  // Auto from the centre sections of every file (the scale holds still while
  // the cuts move), as on the 3D-ΔPDF page.
  const centreValue: Record<string, number> = {
    xy: axisValue(meta?.z_range, meta?.shape[2], meta ? Math.floor(meta.shape[2] / 2) : 0),
    xz: axisValue(meta?.y_range, meta?.shape[1], meta ? Math.floor(meta.shape[1] / 2) : 0),
    yz: axisValue(meta?.x_range, meta?.shape[0], meta ? Math.floor(meta.shape[0] / 2) : 0),
  };
  const centreSlices = useQueries({
    queries: combos.map((c) => ({
      queryKey: ["dpdfSlice", c.vid, c.plane, centreValue[c.plane]],
      queryFn: () => fetchDpdfSlice(c.vid, c.plane, centreValue[c.plane]),
      enabled: Boolean(meta) && Boolean(c.vid),
      staleTime: Infinity,
    })),
    combine: sliceData, // a stable array while the slices are unchanged
  });
  const samples = useMemo(
    () => (centreSlices.length > 0 && centreSlices.every(Boolean) ? centreSlices.map((d) => withoutOrigin(d!)) : null),
    [centreSlices],
  );
  const lv = useLevels({
    samples,
    histData: results[0]?.data?.data,
    signed: true,
    percentile: DPDF_AUTO_PERCENTILE,
    manual: manualLimit != null ? { lo: -manualLimit, hi: manualLimit } : null,
  });

  const lut = COLORMAPS[colormap] ?? COLORMAPS[DIVERGING_NAME];
  const fit = defaultDpdfView();
  const fullHalf = meta
    ? Math.max(...[meta.x_range, meta.y_range, meta.z_range].map((r) => Math.max(Math.abs(r[0]), Math.abs(r[1]))))
    : WIDEST_HALF;
  const voxel = meta && meta.shape[0] > 1 ? (meta.x_range[1] - meta.x_range[0]) / (meta.shape[0] - 1) : 0.5;
  const limit = zoomLimit(fullHalf, voxel, WIDEST_HALF);

  return (
    <div className="page-body qr-page">
      {/* ── Workspace header (shared order): click mode · unit cells │ cuts ··· reset, then the display bar ── */}
      <WorkspaceHeader
        overlays={<UnitCellsSwitch kind="cell" />}
        nav={
          <div className="ws-cuts">
            {([
              ["x_H", xVal, cutX, setCutX, 0],
              ["y_K", yVal, cutY, setCutY, 1],
              ["z_L", zVal, cutZ, setCutZ, 2],
            ] as const).map(([label, v, i, set, ax]) => (
              <div key={label} className="ws-cut ws-cut--sm">
                <Slider
                  grow
                  label={`Cut ${label}`}
                  readout={meta ? `${v.toFixed(1)} Å` : "—"}
                  min={0}
                  max={meta ? meta.shape[ax] - 1 : 0}
                  value={i}
                  disabled={!meta}
                  onChange={set}
                />
              </div>
            ))}
          </div>
        }
        end={
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            title="Every plane back to ±40 Å (double-click a view, or 0, resets one)"
            onClick={() => setViews({})}
          >
            Reset zoom
          </button>
        }
        display={
          <DisplayBar
            colormap={colormap}
            colormaps={DIVERGING_NAMES}
            onColormap={setColormap}
            lut={lut}
            lv={lv}
            onLevels={(l) => setManualLimit(Math.abs(l.hi))}
            onAuto={() => setManualLimit(null)}
            symmetric
            autoTitle={AUTO_TITLES.dpdf}
          />
        }
      />

      {datasetsQ.isSuccess && temps.length === 0 && (
        <EmptyState
          title="No ΔPDF outputs found"
          hint="Run the pipeline through the ΔPDF stage for at least one temperature to compare them here."
        />
      )}

      {temps.length > 0 && (
        <div className="multi-grid">
          <div className="corner" />
          {PLANES.map((p) => (
            <div key={p.key} className="col-head">
              {p.label}
            </div>
          ))}
          {temps.map((t, ri) => (
            <Fragment key={t.id}>
              <div className={`row-head${t.id === datasetId ? " selected" : ""}`}>
                <span className="temp-badge">{tempLabel(t.temperature, t.stem)}</span>
              </div>
              {PLANES.map((p, ci) => {
                const data = results[ri * PLANES.length + ci]?.data;
                const viewport = views[p.key] ?? fit;
                const angle = data?.header.axes_angle ?? 90;
                return (
                  <div key={p.key} className="cell">
                    {data ? (
                      <ViewFrame
                        viewport={viewport}
                        onViewport={(v) => setView(p.key, v)}
                        fit={fit}
                        bounds={extentBounds(data.header, { sx: 1, sy: 1, angle })}
                        limit={limit}
                        axes={{ sx: 1, sy: 1, xLabel: p.h, yLabel: p.v, unit: "Å", fovUnit: "Å" }}
                        cursor={cursor?.plane === p.key ? cursor.p : null}
                        onCursor={(pt) => setCursor(pt ? { plane: p.key, p: pt } : null)}
                      >
                        <SliceCanvas
                          slice={data}
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
                            latX={planeLat[p.key][0]}
                            latY={planeLat[p.key][1]}
                            angle={data.header.axes_angle}
                          />
                        )}
                      </ViewFrame>
                    ) : (
                      <div className="cell-skeleton skeleton" />
                    )}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      )}

      {meta && temps.length > 0 && (
        <MetaStrip
          items={[
            { key: "Temperatures", value: `${temps.length}` },
            {
              key: "Reference",
              value: selectedDpdfDataset
                ? tempLabel(selectedDpdfDataset.temperature, selectedDpdfDataset.stem)
                : "first available ΔPDF",
            },
            {
              key: "View",
              value: PLANES.map((p) => `${p.key} ±${(views[p.key] ?? fit).half.toFixed(0)} Å`).join(" · "),
            },
            { key: "Lattice", value: latticeLabel(meta.lattice) },
          ]}
        />
      )}
    </div>
  );
}
