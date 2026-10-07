// Shared view state for the reciprocal-space views (zustand).  The cleanup page
// and the Q–R page both read it, so their plane, cut, colour scale and zoom
// stay in step.

import { create } from "zustand";

import type { ScaleKind } from "../components/colorScale";
import type { Viewport } from "../components/viewport";

export type FixedAxis = "H" | "K" | "L";
export type RealAxis = "X" | "Y" | "Z";

// Which fixed axis maps to which Mantid plane alias (cut perpendicular to it).
export const AXIS_TO_PLANE: Record<FixedAxis, string> = {
  H: "0kl",
  K: "h0l",
  L: "hk0",
};

export const REAL_AXIS_TO_PLANE: Record<RealAxis, string> = {
  X: "yz",
  Y: "zx",
  Z: "xy",
};

export const AXIS_INDEX: Record<FixedAxis, 0 | 1 | 2> = { H: 0, K: 1, L: 2 };
export const REAL_AXIS_INDEX: Record<RealAxis, 0 | 1 | 2> = { X: 0, Y: 1, Z: 2 };

// The real-space axis along the same direction as a reciprocal one (a* ∥ x, …),
// so a Q plane and an R plane with these fixed axes have the same orientation.
export const Q_TO_R_AXIS: Record<FixedAxis, RealAxis> = { H: "X", K: "Y", L: "Z" };
export const R_TO_Q_AXIS: Record<RealAxis, FixedAxis> = { X: "H", Y: "K", Z: "L" };

/** Colour limits the user set, tagged with the dataset they were set on. */
export interface ManualLevels {
  lo: number;
  hi: number;
  dataset: string;
}

interface ViewerState {
  fixedAxis: FixedAxis;
  cutIndex: number; // index along the fixed axis
  scale: ScaleKind;
  levels: ManualLevels | null; // null → Auto
  scaleRef: string; // cleanup: the stage that sets the shared scale, or "panel"
  views: Record<string, Viewport>; // per plane, in Å⁻¹; absent → the whole slice
  colormap: string;
  divColormap: string;
  setFixedAxis: (a: FixedAxis) => void;
  setCutIndex: (i: number) => void;
  setScale: (s: ScaleKind) => void;
  setLevels: (l: ManualLevels | null) => void;
  setScaleRef: (r: string) => void;
  setView: (plane: string, v: Viewport | null) => void;
  setColormap: (c: string) => void;
  setDivColormap: (c: string) => void;
}

export const useViewerStore = create<ViewerState>((set) => ({
  fixedAxis: "H",
  cutIndex: 0,
  scale: "lin",
  levels: null,
  scaleRef: "flattened",
  views: {},
  colormap: "inferno",
  divColormap: "RdBu_r",
  setFixedAxis: (fixedAxis) => set({ fixedAxis }),
  setCutIndex: (cutIndex) => set({ cutIndex }),
  setScale: (scale) => set({ scale }),
  setLevels: (levels) => set({ levels }),
  setScaleRef: (scaleRef) => set({ scaleRef }),
  setView: (plane, v) =>
    set((s) => {
      const views = { ...s.views };
      if (v) views[plane] = v;
      else delete views[plane];
      return { views };
    }),
  setColormap: (colormap) => set({ colormap }),
  setDivColormap: (divColormap) => set({ divColormap }),
}));
