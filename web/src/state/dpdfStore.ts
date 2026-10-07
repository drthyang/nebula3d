// Shared view state for the real-space views: the 3D-ΔPDF page and the ΔPDF
// view of the Q–R page.  Cut positions are indices along x_H / y_K / z_L; all
// temperatures share the same grid shape, so the indices are reused across the
// multi-temp comparison.

import { create } from "zustand";

import type { Viewport } from "../components/viewport";

/** Half-width (Å) a real-space view opens at; double-click returns to it. */
export const DEFAULT_DPDF_HALF = 40;

export function defaultDpdfView(): Viewport {
  return { cx: 0, cy: 0, half: DEFAULT_DPDF_HALF };
}

/** A ± colour limit the user set, tagged with the dataset it was set on. */
export interface ManualLimit {
  value: number;
  dataset: string;
}

interface DpdfState {
  cutX: number;
  cutY: number;
  cutZ: number;
  limit: ManualLimit | null; // null → Auto
  gridlines: boolean;
  colormap: string;
  views: Record<string, Viewport>; // per plane (xy, xz, yz, zx), in Å
  centered: boolean;
  setCutX: (i: number) => void;
  setCutY: (i: number) => void;
  setCutZ: (i: number) => void;
  setLimit: (l: ManualLimit | null) => void;
  setGridlines: (b: boolean) => void;
  setColormap: (c: string) => void;
  setView: (plane: string, v: Viewport | null) => void;
  setCentered: (c: boolean) => void;
  center: (x: number, y: number, z: number) => void;
}

export const useDpdfStore = create<DpdfState>((set) => ({
  cutX: 0,
  cutY: 0,
  cutZ: 0,
  limit: null,
  gridlines: false,
  colormap: "RdBu_r",
  views: {},
  centered: false,
  setCutX: (cutX) => set({ cutX }),
  setCutY: (cutY) => set({ cutY }),
  setCutZ: (cutZ) => set({ cutZ }),
  setLimit: (limit) => set({ limit }),
  setGridlines: (gridlines) => set({ gridlines }),
  setColormap: (colormap) => set({ colormap }),
  setView: (plane, v) =>
    set((s) => {
      const views = { ...s.views };
      if (v) views[plane] = v;
      else delete views[plane];
      return { views };
    }),
  setCentered: (centered) => set({ centered }),
  center: (cutX, cutY, cutZ) => set({ cutX, cutY, cutZ, centered: true }),
}));
