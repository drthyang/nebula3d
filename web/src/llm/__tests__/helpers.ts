import type { Slice } from "../../api/types";

// Build a synthetic Slice from a value function f(x, y).  Axes are centred on 0
// with unit spacing unless a range is given; NaN return marks a masked voxel.
export function makeSlice(
  nx: number,
  ny: number,
  f: (x: number, y: number, ix: number, iy: number) => number,
  { half = null as number | null }: { half?: number | null } = {},
): Slice {
  const hx = half ?? (nx - 1) / 2;
  const hy = half ?? (ny - 1) / 2;
  const x_axis = Array.from({ length: nx }, (_v, i) => -hx + (2 * hx * i) / (nx - 1));
  const y_axis = Array.from({ length: ny }, (_v, i) => -hy + (2 * hy * i) / (ny - 1));
  const data = new Float32Array(nx * ny);
  let robust = 0;
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const v = f(x_axis[ix], y_axis[iy], ix, iy);
      data[iy * nx + ix] = v;
      if (Number.isFinite(v) && v > robust) robust = v;
    }
  }
  return {
    header: {
      nx,
      ny,
      x_axis,
      y_axis,
      x_label: "H",
      y_label: "K",
      cut_label: "L=0",
      robust_max: robust,
    },
    data,
  };
}
