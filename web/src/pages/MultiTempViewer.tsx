// Multi-volume 3D-ΔPDF comparison — replaces
// examples/explore_delta_pdf_multi.py.  Rows = files × columns = the
// three orthoslice planes, with shared cut sliders and a per-plane colour scale
// pooled across files (so related files are comparable within a column).
// Every cell is a ViewFrame, zoomed and panned like the other slice views, and
// each plane has ONE viewport shared by every row: the temperatures are always
// compared at the same scale and over the same window (THY-38).

import { Fragment, useEffect, useMemo, useState } from "react";

import { keepPreviousData, useQueries } from "@tanstack/react-query";

import { fetchDpdfSlice } from "../api/client";
import { useDatasets, useDpdfMeta } from "../api/hooks";
import { COLORMAPS, DIVERGING_NAMES, DIVERGING_NAME } from "../colormaps/luts";
import { ClickModeControl } from "../components/DisplayBar";
import { SliceCanvas } from "../components/SliceCanvas";
import { UnitCellGrid } from "../components/UnitCellGrid";
import { ViewFrame } from "../components/ViewFrame";
import { extentBounds, zoomLimit, type Viewport } from "../components/viewport";
import {
  ColormapBar,
  EmptyState,
  Field,
  MetaStrip,
  Slider,
  Switch,
} from "../components/ui";
import { latticeLabel } from "../components/oblique";
import { useDatasetStore, useInitializeDataset } from "../state/datasetStore";
import { defaultDpdfView, useDpdfStore } from "../state/dpdfStore";
import { datasetName } from "../api/datasetName";

const PLANES = [
  { key: "xy", label: "x_H – y_K", h: "x_H", v: "y_K" },
  { key: "xz", label: "x_H – z_L", h: "x_H", v: "z_L" },
  { key: "yz", label: "y_K – z_L", h: "y_K", v: "z_L" },
];

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
  const setDataset = useDatasetStore((s) => s.setDataset);
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
  // Hidden page (not routed): keeps its own contrast and views, outside the
  // shared real-space store the routed viewers use.  One viewport per plane,
  // shared by every temperature; it opens at ±40 Å, the old 80 Å window.
  const [contrast, setContrast] = useState(1);
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
  const setGridlines = useDpdfStore((s) => s.setGridlines);
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

  // pooled robust scale per plane (column), across temperatures
  const pooled: Record<string, number> = {};
  PLANES.forEach((p, ci) => {
    let m = 0;
    temps.forEach((_, ri) => {
      const rm = results[ri * PLANES.length + ci]?.data?.header.robust_max;
      if (rm && Number.isFinite(rm)) m = Math.max(m, rm);
    });
    pooled[p.key] = m || 1;
  });

  const lut = COLORMAPS[colormap] ?? COLORMAPS[DIVERGING_NAME];
  const fit = defaultDpdfView();
  const fullHalf = meta
    ? Math.max(...[meta.x_range, meta.y_range, meta.z_range].map((r) => Math.max(Math.abs(r[0]), Math.abs(r[1]))))
    : WIDEST_HALF;
  const voxel = meta && meta.shape[0] > 1 ? (meta.x_range[1] - meta.x_range[0]) / (meta.shape[0] - 1) : 0.5;
  const limit = zoomLimit(fullHalf, voxel, WIDEST_HALF);

  return (
    <div className="page-body">
      <div className="toolbar">
        <ClickModeControl />
        <Field label="Dataset">
          <select
            value={datasetId ?? ""}
            onChange={(e) => setDataset(e.target.value)}
          >
            {datasets.map((d) => (
              <option key={d.id} value={d.id} title={d.raw_name}>
                {datasetName(d, datasets)}
              </option>
            ))}
          </select>
        </Field>
        <Slider
          grow
          label="x_H"
          readout={meta ? `${xVal.toFixed(1)} Å` : "—"}
          min={0}
          max={meta ? meta.shape[0] - 1 : 0}
          value={cutX}
          disabled={!meta}
          onChange={setCutX}
        />
        <Slider
          grow
          label="y_K"
          readout={meta ? `${yVal.toFixed(1)} Å` : "—"}
          min={0}
          max={meta ? meta.shape[1] - 1 : 0}
          value={cutY}
          disabled={!meta}
          onChange={setCutY}
        />
        <Slider
          grow
          label="z_L"
          readout={meta ? `${zVal.toFixed(1)} Å` : "—"}
          min={0}
          max={meta ? meta.shape[2] - 1 : 0}
          value={cutZ}
          disabled={!meta}
          onChange={setCutZ}
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          title="Every plane back to ±40 Å (or double-click a view, or 0)"
          onClick={() => setViews({})}
        >
          Reset views
        </button>
        <Slider
          label="Contrast"
          readout={`× ${contrast.toFixed(1)}`}
          min={0.1}
          max={20}
          step={0.1}
          value={contrast}
          onChange={setContrast}
        />
        <Switch label="Unit cells" checked={gridlines} onChange={setGridlines} />
        <Field label="Colormap">
          <select value={colormap} onChange={(e) => setColormap(e.target.value)}>
            {DIVERGING_NAMES.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <ColormapBar lut={lut} />
        </Field>
      </div>

      {datasetsQ.isSuccess && temps.length === 0 && (
        <EmptyState
          title="No ΔPDF outputs found"
          hint="Run the pipeline through the ΔPDF stage for at least one temperature to compare them here."
        />
      )}

      {temps.length > 0 && (
        <div
          className="multi-grid"
          style={{ gridTemplateColumns: `64px repeat(${PLANES.length}, 1fr)` }}
        >
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
                          vmax={contrast * pooled[p.key]}
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
