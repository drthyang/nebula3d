// What a measuring tool found that its overlays draw (THY-66, Highlights) and
// its result leaves out: the punch's every leftover peak on each plane (the
// result names the strongest), the tail sweep's voxels (round 2), and the
// ring stage's own record of the shells it could not confirm on its grid.
// Kept beside the result, as a step's outcomes are (tools/types.ts), never in
// it: the model reads the result alone, and the transcript keeps none of it
// (chatStore.ts asRead). A leaf module, so the tools and the overlays import it
// without a cycle.

/** A leftover peak on the punched cut (metrics/punch.ts SuspiciousPeak), as an overlay draws it. */
export interface LeftoverPeak {
  plane: string; // "hk0" | "h0l" | "0kl"
  cut: number; // r.l.u. along the plane's fixed axis
  x: number; // r.l.u. along the slice's x and y
  y: number;
  sigma: number;
  at_node?: boolean;
  on_protected_plane?: boolean;
  broad: boolean;
  hkl?: [number, number, number];
}

type V3 = [number, number, number];

/** A fitted Bragg peak bragg_peaks listed, as the Bragg page draws its fit (api BraggPeakWidth). */
export interface BraggFootprint {
  hkl: V3;
  widths: V3; // width_hkl (r.l.u.)
  principal: V3 | null; // principal_width_hkl
  dirs: number[][] | null; // principal_directions_hkl
}

/** A hole of the fill (VolumeTexture's), filled outside its rim's range. */
export interface FillHole {
  hkl: V3; // its centre, r.l.u.
  bias: number; // the fill's signed distance outside the range
  biasSigma: number | null; // ... in the rim's σ
  voxels: number;
}

export interface OverlayData {
  leftovers?: LeftoverPeak[];
  // Round 2 of the punch (the tail sweep): every voxel it added, H K L flat.
  round2?: number[];
  // The ring candidates the ring stage detected and could not confirm on its
  // grid (its record's unconfirmed_at_grid.q_centers, Å⁻¹).
  ringsAtGrid?: number[];
  // Every shell the ring stage removed, its |Q| (Å⁻¹) and whether it sat on
  // an Al line (its record's removed_shells): the Al shells drawn exactly.
  ringsRemoved?: { q: number; al: boolean; code: string | null }[];
  // bragg_peaks: each peak it listed, in its order, with its fitted footprint.
  braggPeaks?: BraggFootprint[];
  // dpdf_peaks: every vector of each feature it listed (Å, x y z), its signed
  // size (σ), its length (Å) and its place in the list.
  dpdfVectors?: { v: V3; size: number; length: number; rank: number }[];
  // ub_check: the volume's UB and the fitted one (Q = UB · hkl), and the Bragg
  // nodes' spacing (the punch cell).
  ubTurn?: { ub: number[][]; fitted: number[][]; cell: V3 };
  // texture_check: the holes filled outside their range (the farthest first),
  // and how many the volume holds.
  fillHoles?: { holes: FillHole[]; nHoles: number };
  // grain_check: every image of the far orbits under the declared operations,
  // and, where the rotated copy explains them (a second grain, or the UB off),
  // the map from its nodes to H K L.
  grains?: { far: V3[]; rotated: number[][] | null };
}

/** Where an evaluation (tune/evaluate.ts) keeps its overlay data: a symbol, which JSON never writes. */
export const OVERLAY_DATA: unique symbol = Symbol("overlayData");

/**
 * `target` with its overlay data beside it: a property no copy, spread or JSON
 * of it carries (not enumerable), read back by overlayDataOf.
 */
export function withOverlayData<T extends object>(target: T, data: OverlayData | null | undefined): T {
  if (data) Object.defineProperty(target, OVERLAY_DATA, { value: data, enumerable: false, configurable: true });
  return target;
}

/** The overlay data kept beside `target` (withOverlayData), if any. */
export const overlayDataOf = (target: unknown): OverlayData | undefined =>
  target && typeof target === "object" ? ((target as { [OVERLAY_DATA]?: OverlayData })[OVERLAY_DATA] ?? undefined) : undefined;
