// The words a measurement opens its reason with when the grid is too coarse
// for it to judge anything: the ring check's 3D test (too few voxels across a
// ring's width, or in its directions: nebula3d.preprocessing.ring_isotropy)
// and the fills' texture (no room for a hole's rim before the next node:
// texture.ts). The check is then not judged, for this reason
// (verdicts/rules.ts): no evidence never passes, applied to resolution.

export const GRID_TOO_COARSE = "grid too coarse";

/** Whether a measurement's reason (or a "not judged: …" that quotes it) says the grid is too coarse for it. */
export const isTooCoarse = (said: unknown): boolean =>
  typeof said === "string" && said.replace(/^not judged: /, "").startsWith(GRID_TOO_COARSE);
