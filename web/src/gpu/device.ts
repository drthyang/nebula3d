// WebGPU adapter/device acquisition with limit negotiation.
//
// The default WebGPU limits (128 MB storage binding / 256 MB buffer) are far
// below the padded complex volume (8 bytes/voxel ≈ 400 MB at 50 M voxels), so
// requesting elevated limits at requestDevice is mandatory — clamped to what
// the adapter exposes, then re-checked per run against the actual volume
// (refusal → the caller falls back to the scipy path, never fails the run).

export interface GpuCaps {
  adapterInfo: string;
  maxBufferSize: number;
  maxStorageBufferBindingSize: number;
  maxComputeWorkgroupStorageSize: number;
  maxComputeInvocationsPerWorkgroup: number;
}

export interface GpuContext {
  device: GPUDevice;
  caps: GpuCaps;
}

let ctx: GpuContext | null = null;
let dead = false;

export function markDeviceDead(): void {
  dead = true;
  ctx = null;
}

export function deviceIsDead(): boolean {
  return dead;
}

export async function acquireDevice(): Promise<GpuContext | null> {
  if (dead) return null;
  if (ctx) return ctx;
  const gpu = (navigator as unknown as { gpu?: GPU }).gpu;
  if (!gpu) return null;
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return null;
    const want = {
      maxBufferSize: Math.min(adapter.limits.maxBufferSize, 4 * 1024 ** 3 - 4),
      maxStorageBufferBindingSize: Math.min(
        adapter.limits.maxStorageBufferBindingSize, 4 * 1024 ** 3 - 4),
      maxComputeWorkgroupStorageSize: Math.min(
        adapter.limits.maxComputeWorkgroupStorageSize, 32768),
    };
    const device = await adapter.requestDevice({ requiredLimits: want });
    device.lost.then((info) => {
      // Session-wide disable: the pipeline reruns the stage on CPU instead.
      console.warn("nebula3d: WebGPU device lost:", info.message);
      markDeviceDead();
    });
    const info = (adapter as unknown as { info?: { vendor?: string; architecture?: string } }).info;
    ctx = {
      device,
      caps: {
        adapterInfo: [info?.vendor, info?.architecture].filter(Boolean).join(" ")
          || "unknown adapter",
        maxBufferSize: device.limits.maxBufferSize,
        maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize,
        maxComputeWorkgroupStorageSize: device.limits.maxComputeWorkgroupStorageSize,
        maxComputeInvocationsPerWorkgroup:
          device.limits.maxComputeInvocationsPerWorkgroup,
      },
    };
    return ctx;
  } catch (e) {
    console.warn("nebula3d: WebGPU unavailable:", (e as Error).message);
    return null;
  }
}

export function disposeDevice(): void {
  ctx?.device.destroy();
  ctx = null;
}
