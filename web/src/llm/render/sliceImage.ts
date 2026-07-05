// Render a slice to a compact image data-URL for vision-capable models, so the
// assistant can literally look at what the user sees.  Colour mapping mirrors
// SliceCanvas (sequential [vmin,vmax], diverging symmetric about 0, optional
// log), but the output is a single downscaled JPEG kept small enough to send in
// a chat message.  Returns null off the main thread (no document/canvas).

import type { Slice } from "../../api/types";

export interface RenderOptions {
  lut: Uint8ClampedArray; // 256 * 4 RGBA
  vmax: number;
  vmin?: number;
  diverging?: boolean;
  log?: boolean;
  maxSize?: number; // longest edge in px of the emitted image
}

export const renderSliceToDataUrl = (slice: Slice, opts: RenderOptions): string | null => {
  if (typeof document === "undefined") return null;
  const { lut, vmax, vmin = 0, diverging = false, log = false, maxSize = 512 } = opts;
  const { nx, ny } = slice.header;
  if (nx <= 0 || ny <= 0) return null;

  const src = document.createElement("canvas");
  src.width = nx;
  src.height = ny;
  const sctx = src.getContext("2d");
  if (!sctx) return null;
  const img = sctx.createImageData(nx, ny);
  const out = img.data;
  const data = slice.data;
  const vmaxSafe = vmax > 0 ? vmax : 1;
  const span = vmaxSafe - vmin > 0 ? vmaxSafe - vmin : 1;
  const logMax = Math.log10(vmaxSafe + 1) || 1;

  for (let iy = 0; iy < ny; iy++) {
    // Flip vertically so +y points up, matching the on-screen slice.
    const srcRow = (ny - 1 - iy) * nx;
    const dstRow = iy * nx;
    for (let ix = 0; ix < nx; ix++) {
      const v = data[srcRow + ix];
      const o = (dstRow + ix) * 4;
      if (!Number.isFinite(v)) {
        out[o] = 128;
        out[o + 1] = 128;
        out[o + 2] = 128;
        out[o + 3] = 255;
        continue;
      }
      let t: number;
      if (diverging) t = 0.5 + 0.5 * Math.max(-1, Math.min(1, v / vmaxSafe));
      else if (log) t = Math.max(0, Math.min(1, Math.log10(Math.max(v, 0) + 1) / logMax));
      else t = Math.max(0, Math.min(1, (v - vmin) / span));
      const li = (t * 255) | 0;
      out[o] = lut[li * 4];
      out[o + 1] = lut[li * 4 + 1];
      out[o + 2] = lut[li * 4 + 2];
      out[o + 3] = 255;
    }
  }
  sctx.putImageData(img, 0, 0);

  const scale = Math.min(1, maxSize / Math.max(nx, ny));
  if (scale >= 1) return src.toDataURL("image/jpeg", 0.85);

  const dst = document.createElement("canvas");
  dst.width = Math.max(1, Math.round(nx * scale));
  dst.height = Math.max(1, Math.round(ny * scale));
  const dctx = dst.getContext("2d");
  if (!dctx) return src.toDataURL("image/jpeg", 0.85);
  dctx.imageSmoothingEnabled = true;
  dctx.drawImage(src, 0, 0, dst.width, dst.height);
  return dst.toDataURL("image/jpeg", 0.85);
};
