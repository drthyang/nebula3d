// Installs `self.nebulaGpu` — the WebGPU ΔPDF backend the Python bridge
// awaits from inside the pipeline worker.  Absence of WebGPU (or any capacity
// refusal) is a silent CPU fallback; the pipeline must never fail because of
// the GPU.

import { acquireDevice, deviceIsDead, disposeDevice } from "./device";
import {
  forwardDpdf,
  gpuPaddedShape,
  inverseDpdf,
  symmetricPadLo,
} from "./deltaPdf";
import type { PyProxy } from "./deltaPdf";

export interface NebulaGpu {
  init(): Promise<{ available: boolean; adapter: string;
    maxBufferMB: number } | null>;
  available(): boolean;
  paddedShape(n0: number, n1: number, n2: number): number[];
  padLo(c0: number, c1: number, c2: number,
    p0: number, p1: number, p2: number): number[];
  forwardDpdf(dataProxy: PyProxy, outProxy: PyProxy,
    shape: number[], padded: number[], lo: number[]): Promise<boolean>;
  inverseDpdf(dataProxy: PyProxy, outProxy: PyProxy,
    padded: number[], cropLo: number[], outShape: number[]): Promise<boolean>;
  dispose(): void;
}

type StatusPoster = (status: {
  available: boolean; adapter: string; maxBufferMB: number;
}) => void;

export function installGpuGlobal(postStatus?: StatusPoster): void {
  let inited = false;
  let available = false;

  const gpu: NebulaGpu = {
    async init() {
      const ctx = await acquireDevice();
      inited = true;
      available = ctx !== null;
      const status = {
        available,
        adapter: ctx?.caps.adapterInfo ?? "none",
        maxBufferMB: Math.floor((ctx?.caps.maxBufferSize ?? 0) / 1e6),
      };
      postStatus?.(status);
      return status;
    },

    available(): boolean {
      return inited && available && !deviceIsDead();
    },

    paddedShape(n0, n1, n2) {
      return gpuPaddedShape([n0, n1, n2]);
    },

    padLo(c0, c1, c2, p0, p1, p2) {
      return symmetricPadLo([c0, c1, c2], [p0, p1, p2]);
    },

    forwardDpdf(dataProxy, outProxy, shape, padded, lo) {
      return forwardDpdf(
        dataProxy, outProxy,
        shape as [number, number, number],
        padded as [number, number, number],
        lo as [number, number, number]);
    },

    inverseDpdf(dataProxy, outProxy, padded, cropLo, outShape) {
      return inverseDpdf(
        dataProxy, outProxy,
        padded as [number, number, number],
        cropLo as [number, number, number],
        outShape as [number, number, number]);
    },

    dispose() {
      disposeDevice();
    },
  };

  (self as unknown as { nebulaGpu: NebulaGpu }).nebulaGpu = gpu;
}
