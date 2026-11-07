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

export interface OverlayData {
  leftovers?: LeftoverPeak[];
  // Round 2 of the punch (the tail sweep): every voxel it added, H K L flat.
  round2?: number[];
  // The ring candidates the ring stage detected and could not confirm on its
  // grid (its record's unconfirmed_at_grid.q_centers, Å⁻¹).
  ringsAtGrid?: number[];
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
