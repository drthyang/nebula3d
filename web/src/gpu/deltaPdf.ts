// ΔPDF-level GPU entry points: the `self.nebulaGpu` API Python awaits.
//
// Data crosses the FFI as PyProxy'd numpy arrays: the wasm-heap view is
// acquired per synchronous stretch via getBuffer("f32") and NEVER held across
// an await (heap growth can invalidate it) — input is copied out up front,
// and readback re-enters the wasm heap only after the GPU work resolves.
//
// Contract: capacity/feature refusals return false (Python silently falls
// back to the scipy core); genuine failures throw (Python surfaces them, then
// falls back and marks the GPU dead for the session).

import { acquireDevice, deviceIsDead } from "./device";
import { CentredFft3d } from "./fft";
import { fiveSmooth, padLo } from "./fftPlan";

interface PyBufferView {
  data: Float32Array | Float64Array | Uint8Array;
  release(): void;
}
export interface PyProxy {
  getBuffer(kind: "f32"): PyBufferView;
  destroy(): void;
}

let fft: CentredFft3d | null = null;

async function ensureFft(): Promise<CentredFft3d | null> {
  if (deviceIsDead()) return null;
  if (fft) return fft;
  const ctx = await acquireDevice();
  if (!ctx) return null;
  fft = new CentredFft3d(ctx);
  return fft;
}

function copyIn(proxy: PyProxy): Float32Array {
  const buf = proxy.getBuffer("f32");
  try {
    const out = new Float32Array(buf.data.length);
    out.set(buf.data as Float32Array);
    return out;
  } finally {
    buf.release();
  }
}

function copyOut(proxy: PyProxy, data: Float32Array): void {
  const buf = proxy.getBuffer("f32");
  try {
    (buf.data as Float32Array).set(data);
  } finally {
    buf.release();
  }
}

/** Padded shape the GPU path uses: strict 5-smooth per axis. */
export function gpuPaddedShape(
  shape: [number, number, number],
): [number, number, number] {
  return [fiveSmooth(shape[0]), fiveSmooth(shape[1]), fiveSmooth(shape[2])];
}

/**
 * Forward ΔPDF core: out(padded f32) = fftshift(Re(fftn(ifftshift(pad(in))))).
 * Returns false when the volume exceeds granted limits / no device.
 */
export async function forwardDpdf(
  dataProxy: PyProxy, outProxy: PyProxy,
  shape: [number, number, number],
  padded: [number, number, number],
  lo: [number, number, number],
): Promise<boolean> {
  const f = await ensureFft();
  if (!f) return false;
  const reason = f.supports(padded);
  if (reason) {
    console.info(`nebula3d gpu: falling back to CPU (${reason})`);
    return false;
  }
  const input = copyIn(dataProxy);
  const output = new Float32Array(padded[0] * padded[1] * padded[2]);
  await f.run({
    input, inShape: shape, padded, padLo: lo,
    outShape: padded, cropLo: [0, 0, 0], sign: -1, output,
  });
  copyOut(outProxy, output);
  return true;
}

/**
 * Inverse core: out(cropped f32) = (1/P)·Re(fftshift(ifftn(ifftshift(in))))
 * cropped to `cropLo`/`outShape` — the un-padded win·(I−bg) volume.
 */
export async function inverseDpdf(
  dataProxy: PyProxy, outProxy: PyProxy,
  padded: [number, number, number],
  cropLo: [number, number, number],
  outShape: [number, number, number],
): Promise<boolean> {
  const f = await ensureFft();
  if (!f) return false;
  const reason = f.supports(padded);
  if (reason) {
    console.info(`nebula3d gpu: falling back to CPU (${reason})`);
    return false;
  }
  const input = copyIn(dataProxy);
  const output = new Float32Array(outShape[0] * outShape[1] * outShape[2]);
  await f.run({
    input, inShape: padded, padded, padLo: [0, 0, 0],
    outShape, cropLo, sign: 1, output,
  });
  copyOut(outProxy, output);
  return true;
}

export function symmetricPadLo(
  shape: [number, number, number], padded: [number, number, number],
): [number, number, number] {
  return [padLo(shape[0], padded[0]), padLo(shape[1], padded[1]),
    padLo(shape[2], padded[2])];
}
