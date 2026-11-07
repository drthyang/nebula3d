// 3×3 matrices for the Highlights (examine/): the inverse and the product. A
// leaf module, so the tools and the overlays import it without a cycle.

export type M3 = number[][]; // rows

/** The product a · b. */
export const mm = (a: M3, b: M3): M3 => [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]));

/** The inverse, or null for a singular matrix. */
export function inv3(m: M3): M3 | null {
  const [a, b, c] = m;
  const r0 = [b[1] * c[2] - b[2] * c[1], b[2] * c[0] - b[0] * c[2], b[0] * c[1] - b[1] * c[0]];
  const det = a[0] * r0[0] + a[1] * r0[1] + a[2] * r0[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const r1 = [c[1] * a[2] - c[2] * a[1], c[2] * a[0] - c[0] * a[2], c[0] * a[1] - c[1] * a[0]];
  const r2 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // The inverse's columns are r0, r1, r2 over det.
  return [0, 1, 2].map((i) => [r0[i] / det, r1[i] / det, r2[i] / det]);
}

