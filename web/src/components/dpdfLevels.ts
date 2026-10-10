// The 3D-ΔPDF page's Auto.  A ΔPDF section is mostly FFT ripple around a few
// compact features (the truncation of the data at Qmax rings around every
// pair-correlation peak).  The 97th percentile of |v| that Auto takes on the
// other pages therefore measures the ripple: every feature saturates and the
// ripple fills the colour range.  Here Auto takes the 99.9th percentile of |v|
// over the centre sections, the origin's self-correlation peak left out, so
// the features carry the colour range and the ripple stays near the neutral
// colour.  On a measured hexagonal volume that limit sat at 180–220 × the
// sections' robust σ, where the 97th percentile gave 8–17 ×.

import type { Slice } from "../api/types";
import { toDisplay } from "./oblique";

export const DPDF_AUTO_PERCENTILE = 0.999;

// The disk around the origin left out, as a share of the section's half-width
// (as in the ΔPDF metrics): the self-correlation peak is not a pair correlation.
export const ORIGIN_EXCLUDED = 0.05;

/** The section's values, NaN inside the origin's disk (true Å, oblique axes mapped). */
export function withoutOrigin(slice: Slice): Float32Array {
  const { nx, ny, x_axis, y_axis } = slice.header;
  const angle = slice.header.axes_angle ?? 90;
  const half = Math.max(
    Math.abs(x_axis[0] ?? 0),
    Math.abs(x_axis[nx - 1] ?? 0),
    Math.abs(y_axis[0] ?? 0),
    Math.abs(y_axis[ny - 1] ?? 0),
  );
  const r2 = (ORIGIN_EXCLUDED * half) ** 2;
  const out = Float32Array.from(slice.data);
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const [x, y] = toDisplay(x_axis[ix] ?? 0, y_axis[iy] ?? 0, angle);
      if (x * x + y * y < r2) out[iy * nx + ix] = NaN;
    }
  }
  return out;
}
