// Batched centred 3-D FFT on WebGPU: fftshift(fftn(ifftshift(pad(x)))).
//
// One storage buffer holds the complex volume (vec2<f32>); each axis pass runs
// one workgroup per line, transforming the whole line in workgroup shared
// memory with a mixed radix-2/3/4/5 Stockham (twiddles precomputed on CPU in
// f64, rounded once to f32 — no driver sin/cos variance).  Radix DFT roots are
// hardcoded rational-angle constants with the direction folded in via a ±1
// uniform, so forward and inverse share every kernel.
//
// The index math (shift gathers, pad placement, factorisation) mirrors
// fftPlan.ts exactly, which is pinned to numpy fixtures in CI.

import {
  buildLinePlan,
  dispatchGrid,
  factorize,
} from "./fftPlan";
import type { GpuContext } from "./device";

const WG = 128;
const MAX_LINE = 1024; // 2 × 1024 complex in ≤16 KB workgroup storage

const FFT_LINE_WGSL = /* wgsl */ `
struct Params {
  n: u32, linesTotal: u32, numWgX: u32, stageCount: u32,
  stride: u32, countV: u32, strideU: u32, strideV: u32,
  sign: f32, pad0: f32, pad1: f32, pad2: f32,
}
@group(0) @binding(0) var<storage, read_write> buf: array<vec2f>;
@group(0) @binding(1) var<storage, read> twiddles: array<vec2f>;
@group(0) @binding(2) var<storage, read> stages: array<vec4u>;
@group(0) @binding(3) var<uniform> P: Params;

var<workgroup> shA: array<vec2f, ${MAX_LINE}>;
var<workgroup> shB: array<vec2f, ${MAX_LINE}>;

fn cmul(a: vec2f, b: vec2f) -> vec2f {
  return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

// W_r^m = exp(sign*2*pi*i*m/r) for r in 2..5 — rational-angle constants only.
fn wpow(r: u32, m: u32, sign: f32) -> vec2f {
  let mm = m % r;
  if (mm == 0u) { return vec2f(1.0, 0.0); }
  if (r == 2u) { return vec2f(-1.0, 0.0); }
  if (r == 3u) {
    if (mm == 1u) { return vec2f(-0.5, sign * 0.8660254037844387); }
    return vec2f(-0.5, -sign * 0.8660254037844387);
  }
  if (r == 4u) {
    if (mm == 1u) { return vec2f(0.0, sign); }
    if (mm == 2u) { return vec2f(-1.0, 0.0); }
    return vec2f(0.0, -sign);
  }
  // r == 5
  if (mm == 1u) { return vec2f(0.30901699437494745, sign * 0.9510565162951535); }
  if (mm == 2u) { return vec2f(-0.8090169943749473, sign * 0.5877852522924732); }
  if (mm == 3u) { return vec2f(-0.8090169943749473, -sign * 0.5877852522924732); }
  return vec2f(0.30901699437494745, -sign * 0.9510565162951535);
}

@compute @workgroup_size(${WG})
fn fft_line(@builtin(workgroup_id) wg: vec3u,
            @builtin(local_invocation_index) li: u32) {
  let line = wg.y * P.numWgX + wg.x;
  if (line >= P.linesTotal) { return; }
  let u = line / P.countV;
  let v = line % P.countV;
  let base = u * P.strideU + v * P.strideV;

  var t = li;
  loop {
    if (t >= P.n) { break; }
    shA[t] = buf[base + t * P.stride];
    t += ${WG}u;
  }
  workgroupBarrier();

  var srcIsA = true;
  for (var st = 0u; st < P.stageCount; st += 1u) {
    let radix = stages[st].x;
    let ns = stages[st].y;
    let two = stages[st].z;
    let cnt = P.n / radix;
    var i = li;
    loop {
      if (i >= cnt) { break; }
      let j = i % ns;
      let grp = i / ns;
      var vv: array<vec2f, 5>;
      for (var s = 0u; s < radix; s += 1u) {
        var x: vec2f;
        if (srcIsA) { x = shA[i + s * cnt]; } else { x = shB[i + s * cnt]; }
        if (s > 0u) {
          x = cmul(x, twiddles[two + j * (radix - 1u) + (s - 1u)]);
        }
        vv[s] = x;
      }
      let outBase = grp * ns * radix + j;
      for (var k = 0u; k < radix; k += 1u) {
        var acc = vv[0];
        for (var s = 1u; s < radix; s += 1u) {
          acc += cmul(vv[s], wpow(radix, (k * s) % radix, P.sign));
        }
        if (srcIsA) { shB[outBase + k * ns] = acc; }
        else { shA[outBase + k * ns] = acc; }
      }
      i += ${WG}u;
    }
    workgroupBarrier();
    srcIsA = !srcIsA;
  }

  t = li;
  loop {
    if (t >= P.n) { break; }
    if (srcIsA) { buf[base + t * P.stride] = shA[t]; }
    else { buf[base + t * P.stride] = shB[t]; }
    t += ${WG}u;
  }
}
`;

const PLACE_WGSL = /* wgsl */ `
struct Dims {
  c0: u32, c1: u32, c2: u32, total: u32,
  p0: u32, p1: u32, p2: u32, numWgX: u32,
  l0: u32, l1: u32, l2: u32, pad0: u32,
}
@group(0) @binding(0) var<storage, read> src: array<f32>;
@group(0) @binding(1) var<storage, read_write> dst: array<vec2f>;
@group(0) @binding(2) var<uniform> D: Dims;

// dst[t] = (ifftshift(pad(src)))[t] as complex.  ifftshift gather per axis:
// prepared[i] = padded[(i + floor(p/2)) % p]  (pinned to numpy in fftPlan.ts).
@compute @workgroup_size(256)
fn place(@builtin(workgroup_id) wg: vec3u,
         @builtin(local_invocation_index) li: u32) {
  let t = (wg.y * D.numWgX + wg.x) * 256u + li;
  if (t >= D.total) { return; }
  let k = t % D.p2;
  let j = (t / D.p2) % D.p1;
  let i = t / (D.p2 * D.p1);
  let ui = (i + D.p0 / 2u) % D.p0;
  let uj = (j + D.p1 / 2u) % D.p1;
  let uk = (k + D.p2 / 2u) % D.p2;
  var val = 0.0;
  if (ui >= D.l0 && ui < D.l0 + D.c0
      && uj >= D.l1 && uj < D.l1 + D.c1
      && uk >= D.l2 && uk < D.l2 + D.c2) {
    let s = ((ui - D.l0) * D.c1 + (uj - D.l1)) * D.c2 + (uk - D.l2);
    val = src[s];
  }
  dst[t] = vec2f(val, 0.0);
}
`;

const EXTRACT_WGSL = /* wgsl */ `
struct Dims {
  o0: u32, o1: u32, o2: u32, total: u32,
  p0: u32, p1: u32, p2: u32, numWgX: u32,
  l0: u32, l1: u32, l2: u32, pad0: u32,
  scale: f32, pad1: f32, pad2: f32, pad3: f32,
}
@group(0) @binding(0) var<storage, read> src: array<vec2f>;
@group(0) @binding(1) var<storage, read_write> dst: array<f32>;
@group(0) @binding(2) var<uniform> D: Dims;

// dst (o-shaped, possibly a crop starting at l) = scale * Re(fftshift(src)).
// fftshift gather per axis: shifted[i] = unshifted[(i + ceil(p/2)) % p]
// (pinned to numpy in fftPlan.ts).
@compute @workgroup_size(256)
fn extract(@builtin(workgroup_id) wg: vec3u,
           @builtin(local_invocation_index) li: u32) {
  let t = (wg.y * D.numWgX + wg.x) * 256u + li;
  if (t >= D.total) { return; }
  let k = t % D.o2;
  let j = (t / D.o2) % D.o1;
  let i = t / (D.o2 * D.o1);
  let pi = i + D.l0;
  let pj = j + D.l1;
  let pk = k + D.l2;
  let si = (pi + (D.p0 + 1u) / 2u) % D.p0;
  let sj = (pj + (D.p1 + 1u) / 2u) % D.p1;
  let sk = (pk + (D.p2 + 1u) / 2u) % D.p2;
  dst[t] = src[(si * D.p1 + sj) * D.p2 + sk].x * D.scale;
}
`;

export interface FftBuffers {
  complex: GPUBuffer; // vec2f padded volume (8P bytes)
  scalarIn: GPUBuffer; // f32 input (compact or padded)
  scalarOut: GPUBuffer; // f32 output (padded or cropped)
}

export class CentredFft3d {
  private pipelines: { line: GPUComputePipeline; place: GPUComputePipeline;
    extract: GPUComputePipeline };

  constructor(private ctx: GpuContext) {
    const d = ctx.device;
    const mk = (code: string, entry: string): GPUComputePipeline =>
      d.createComputePipeline({
        layout: "auto",
        compute: { module: d.createShaderModule({ code }), entryPoint: entry },
      });
    this.pipelines = {
      line: mk(FFT_LINE_WGSL, "fft_line"),
      place: mk(PLACE_WGSL, "place"),
      extract: mk(EXTRACT_WGSL, "extract"),
    };
  }

  /** Whether the padded shape fits the granted limits and kernel bounds. */
  supports(padded: [number, number, number]): string | null {
    const P = padded[0] * padded[1] * padded[2];
    const bytes = 8 * P;
    if (Math.max(...padded) > MAX_LINE) {
      return `axis ${Math.max(...padded)} exceeds the ${MAX_LINE}-point line kernel`;
    }
    if (bytes > this.ctx.caps.maxStorageBufferBindingSize
        || bytes > this.ctx.caps.maxBufferSize) {
      return `complex volume ${(bytes / 1e6).toFixed(0)} MB exceeds granted GPU limits`;
    }
    for (const n of padded) {
      try {
        factorize(n);
      } catch {
        return `${n} is not 5-smooth`;
      }
    }
    return null;
  }

  private uniform(data: ArrayBuffer): GPUBuffer {
    const b = this.ctx.device.createBuffer({
      size: Math.max(16, data.byteLength),
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.ctx.device.queue.writeBuffer(b, 0, data);
    return b;
  }

  private storage(data: ArrayBuffer): GPUBuffer {
    const b = this.ctx.device.createBuffer({
      size: Math.max(16, data.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.ctx.device.queue.writeBuffer(b, 0, data);
    return b;
  }

  /**
   * Run the full centred transform over `complex` (already placed):
   * per-axis batched Stockham line passes, in place.
   */
  private encodeAxisPasses(
    padded: [number, number, number], sign: -1 | 1, complex: GPUBuffer,
    scratch: GPUBuffer[],
  ): void {
    const d = this.ctx.device;
    const [n0, n1, n2] = padded;
    // (len, stride, countV, strideU, strideV) per axis — matches the CI-tested
    // pass structure in fftPlan.test.ts.
    const axes: [number, number, number, number, number][] = [
      [n2, 1, n0 * n1, 0, n2], // axis 2: lines enumerate (i,j) → base=line*n2
      [n1, n2, n2, n1 * n2, 1], // axis 1: u=i (stride n1*n2), v=k (stride 1)
      [n0, n1 * n2, n1 * n2, 0, 1], // axis 0: lines enumerate (j,k) → base=line
    ];
    for (const [len, stride, countV, strideU, strideV] of axes) {
      const plan = buildLinePlan(len, sign);
      const lines = (n0 * n1 * n2) / len;
      const grid = dispatchGrid(lines);
      const stagesArr = new Uint32Array(plan.stages.length * 4);
      plan.stages.forEach((st, i) => {
        stagesArr[4 * i] = st.radix;
        stagesArr[4 * i + 1] = st.ns;
        stagesArr[4 * i + 2] = st.twiddleOffset;
      });
      const params = new ArrayBuffer(48);
      const u32 = new Uint32Array(params);
      const f32 = new Float32Array(params);
      u32[0] = len;
      u32[1] = lines;
      u32[2] = grid.x;
      u32[3] = plan.stages.length;
      u32[4] = stride;
      u32[5] = countV;
      u32[6] = strideU;
      u32[7] = strideV;
      f32[8] = sign;

      const twiddleBuf = this.storage(plan.twiddles.buffer as ArrayBuffer);
      const stageBuf = this.storage(stagesArr.buffer as ArrayBuffer);
      const paramBuf = this.uniform(params);
      scratch.push(twiddleBuf, stageBuf, paramBuf);

      const bind = d.createBindGroup({
        layout: this.pipelines.line.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: complex } },
          { binding: 1, resource: { buffer: twiddleBuf } },
          { binding: 2, resource: { buffer: stageBuf } },
          { binding: 3, resource: { buffer: paramBuf } },
        ],
      });
      const enc = d.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(this.pipelines.line);
      pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(grid.x, grid.y);
      pass.end();
      d.queue.submit([enc.finish()]);
    }
  }

  /**
   * Centred 3-D transform: input f32 (compact) → output f32.
   * Forward: out = padded fftshift(Re(fftn(ifftshift(pad(in))))).
   * Inverse (sign=+1): in is padded, out is the crop at `cropLo`/`outShape`,
   * scaled by 1/P (numpy ifftn normalisation).
   */
  async run(opts: {
    input: Float32Array;
    inShape: [number, number, number];
    padded: [number, number, number];
    padLo: [number, number, number];
    outShape: [number, number, number];
    cropLo: [number, number, number];
    sign: -1 | 1;
    output: Float32Array;
    onChunk?: () => void;
  }): Promise<void> {
    const d = this.ctx.device;
    const [p0, p1, p2] = opts.padded;
    const P = p0 * p1 * p2;
    const inSize = opts.inShape[0] * opts.inShape[1] * opts.inShape[2];
    const outSize = opts.outShape[0] * opts.outShape[1] * opts.outShape[2];
    if (opts.input.length !== inSize || opts.output.length !== outSize) {
      throw new Error("gpu fft: shape/buffer mismatch");
    }
    const scratch: GPUBuffer[] = [];
    const complex = d.createBuffer({
      size: 8 * P, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const scalarIn = d.createBuffer({
      size: 4 * inSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const scalarOut = d.createBuffer({
      size: 4 * outSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    try {
      // Upload in ≤64 MB slices (writeBuffer copies synchronously at call time).
      const CH = (64 << 20) / 4;
      for (let o = 0; o < inSize; o += CH) {
        d.queue.writeBuffer(scalarIn, 4 * o,
          opts.input.subarray(
            o, Math.min(inSize, o + CH)) as Float32Array<ArrayBuffer>);
      }

      // place (pad + ifftshift + real→complex)
      {
        const dims = new Uint32Array(12);
        dims.set([opts.inShape[0], opts.inShape[1], opts.inShape[2], P,
          p0, p1, p2, 0, opts.padLo[0], opts.padLo[1], opts.padLo[2], 0]);
        const grid = dispatchGrid(Math.ceil(P / 256));
        dims[7] = grid.x;
        const paramBuf = this.uniform(dims.buffer as ArrayBuffer);
        scratch.push(paramBuf);
        const bind = d.createBindGroup({
          layout: this.pipelines.place.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: scalarIn } },
            { binding: 1, resource: { buffer: complex } },
            { binding: 2, resource: { buffer: paramBuf } },
          ],
        });
        const enc = d.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(this.pipelines.place);
        pass.setBindGroup(0, bind);
        pass.dispatchWorkgroups(grid.x, grid.y);
        pass.end();
        d.queue.submit([enc.finish()]);
      }

      this.encodeAxisPasses(opts.padded, opts.sign, complex, scratch);

      // extract (fftshift + real part [+ crop] [+ 1/P scale])
      {
        const params = new ArrayBuffer(64);
        const u32 = new Uint32Array(params);
        const f32 = new Float32Array(params);
        const grid = dispatchGrid(Math.ceil(outSize / 256));
        u32.set([opts.outShape[0], opts.outShape[1], opts.outShape[2], outSize,
          p0, p1, p2, grid.x,
          opts.cropLo[0], opts.cropLo[1], opts.cropLo[2], 0]);
        f32[12] = opts.sign === 1 ? 1 / P : 1;
        const paramBuf = this.uniform(params);
        scratch.push(paramBuf);
        const bind = d.createBindGroup({
          layout: this.pipelines.extract.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: complex } },
            { binding: 1, resource: { buffer: scalarOut } },
            { binding: 2, resource: { buffer: paramBuf } },
          ],
        });
        const enc = d.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(this.pipelines.extract);
        pass.setBindGroup(0, bind);
        pass.dispatchWorkgroups(grid.x, grid.y);
        pass.end();
        d.queue.submit([enc.finish()]);
      }

      // Readback in ≤64 MB mapped chunks.
      const CHB = 64 << 20;
      const staging = d.createBuffer({
        size: Math.min(CHB, 4 * outSize),
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      scratch.push(staging);
      for (let byteOff = 0; byteOff < 4 * outSize; byteOff += CHB) {
        const nBytes = Math.min(CHB, 4 * outSize - byteOff);
        const enc = d.createCommandEncoder();
        enc.copyBufferToBuffer(scalarOut, byteOff, staging, 0, nBytes);
        d.queue.submit([enc.finish()]);
        await staging.mapAsync(GPUMapMode.READ, 0, nBytes);
        const view = new Float32Array(staging.getMappedRange(0, nBytes));
        opts.output.set(view, byteOff / 4);
        staging.unmap();
        opts.onChunk?.();
      }
    } finally {
      complex.destroy();
      scalarIn.destroy();
      scalarOut.destroy();
      for (const b of scratch) b.destroy();
    }
  }
}
