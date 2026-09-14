// Pure index math for the WebGPU centred FFT — no GPU objects, fully CI-tested
// against numpy fixtures (fftPlan.test.ts).
//
// The transform computed by the GPU path is exactly the pipeline's centred
// FFT: fftshift(fftn(ifftshift(pad(x)))) — decomposed into batched 1-D
// mixed-radix (2/3/5) Stockham passes along each axis.  Everything here is
// deterministic double-precision math rounded once to f32 for the shaders
// (twiddle tables are precomputed on the CPU so no driver sin/cos variance
// can creep into results).

export interface StageSpec {
  radix: number;
  ns: number; // sub-transform length BEFORE this stage (product of prior radices)
  twiddleOffset: number; // start of this stage's table in the twiddle buffer
}

export interface LinePlan {
  n: number;
  stages: StageSpec[];
  twiddles: Float32Array; // interleaved re,im — per stage: ns*(radix-1) entries
}

/** Smallest 5-smooth (2^a·3^b·5^c) integer ≥ n. */
export function fiveSmooth(n: number): number {
  for (let m = Math.max(1, n); ; m += 1) {
    let k = m;
    for (const p of [2, 3, 5]) {
      while (k % p === 0) k /= p;
    }
    if (k === 1) return m;
  }
}

/** Factorise a 5-smooth n into radices, largest first (fewer stages). */
export function factorize(n: number): number[] {
  const out: number[] = [];
  let k = n;
  for (const p of [5, 4, 3, 2]) {
    while (k % p === 0) {
      out.push(p);
      k /= p;
    }
  }
  if (k !== 1) throw new Error(`${n} is not 5-smooth`);
  return out;
}

/**
 * Stockham stage twiddles: for stage (radix r, ns), entry (j, s) with
 * j∈[0,ns), s∈[1,r) is exp(sign·2πi·j·s/(ns·r)).  sign=-1 forward (numpy
 * convention), +1 inverse.  Tables are sign-specific (precomputed f64→f32).
 */
export function buildLinePlan(n: number, sign: -1 | 1): LinePlan {
  const radices = factorize(n);
  const stages: StageSpec[] = [];
  let ns = 1;
  let count = 0;
  for (const r of radices) {
    stages.push({ radix: r, ns, twiddleOffset: count });
    count += ns * (r - 1);
    ns *= r;
  }
  const twiddles = new Float32Array(2 * count);
  for (const st of stages) {
    for (let j = 0; j < st.ns; j += 1) {
      for (let s = 1; s < st.radix; s += 1) {
        const ang = (sign * 2 * Math.PI * j * s) / (st.ns * st.radix);
        const at = st.twiddleOffset + j * (st.radix - 1) + (s - 1);
        twiddles[2 * at] = Math.cos(ang);
        twiddles[2 * at + 1] = Math.sin(ang);
      }
    }
  }
  return { n, stages, twiddles };
}

/** ifftshift gather map: ifftshift(x)[i] === x[map[i]] (pinned to numpy). */
export function ifftshiftGather(n: number): Int32Array {
  const map = new Int32Array(n);
  const half = Math.floor(n / 2); // numpy ifftshift = roll left by n//2
  for (let i = 0; i < n; i += 1) map[i] = (i + half) % n;
  return map;
}

/** fftshift gather map: fftshift(x)[i] === x[map[i]] (pinned to numpy). */
export function fftshiftGather(n: number): Int32Array {
  const map = new Int32Array(n);
  const half = Math.ceil(n / 2); // numpy fftshift = roll right by n//2
  for (let i = 0; i < n; i += 1) map[i] = (i + half) % n;
  return map;
}

/**
 * Reference CPU implementation of one Stockham line transform — the exact
 * algorithm the WGSL kernel runs (same stage order, same twiddles, same
 * butterflies), in f64 so the vitest suite can pin correctness without a GPU.
 * Input/output: interleaved complex (re,im), length 2n.  No normalisation
 * (the inverse caller scales by 1/n, as the extraction kernel does).
 */
export function stockhamLineReference(
  input: Float64Array, n: number, sign: -1 | 1,
): Float64Array {
  const plan = buildLinePlan(n, sign);
  let src = Float64Array.from(input);
  let dst = new Float64Array(2 * n);
  for (const st of plan.stages) {
    const r = st.radix;
    const ns = st.ns;
    const m = n / (ns * r); // number of butterfly groups
    for (let t = 0; t < n / r; t += 1) {
      const j = t % ns;
      const group = Math.floor(t / ns);
      // gather + twiddle the r inputs (input stride n/r)
      const vr: number[] = [];
      const vi: number[] = [];
      for (let s = 0; s < r; s += 1) {
        const xi = t + (s * n) / r;
        let re = src[2 * xi];
        let im = src[2 * xi + 1];
        if (s > 0) {
          // twiddle exp(sign·2πi·j·s/(ns·r)) — recompute in f64 (the GPU uses
          // the f32-rounded table; the reference stays full precision)
          const ang = (sign * 2 * Math.PI * j * s) / (ns * r);
          const wr = Math.cos(ang);
          const wi = Math.sin(ang);
          const nr = re * wr - im * wi;
          im = re * wi + im * wr;
          re = nr;
        }
        vr.push(re);
        vi.push(im);
      }
      // radix-r DFT: y_k = Σ_s v_s · exp(sign·2πi·k·s/r)
      const base = group * ns * r + j;
      for (let k = 0; k < r; k += 1) {
        let are = 0;
        let aim = 0;
        for (let s = 0; s < r; s += 1) {
          const ang = (sign * 2 * Math.PI * k * s) / r;
          const wr = Math.cos(ang);
          const wi = Math.sin(ang);
          are += vr[s] * wr - vi[s] * wi;
          aim += vr[s] * wi + vi[s] * wr;
        }
        dst[2 * (base + k * ns)] = are;
        dst[2 * (base + k * ns) + 1] = aim;
      }
    }
    [src, dst] = [dst, src];
    void m;
  }
  return src;
}

/** Centred 1-D reference: fftshift(fft(ifftshift(x_real))) via Stockham. */
export function centredLineReference(
  x: Float64Array, sign: -1 | 1,
): { re: Float64Array; im: Float64Array } {
  const n = x.length;
  const ish = ifftshiftGather(n);
  const buf = new Float64Array(2 * n);
  for (let i = 0; i < n; i += 1) buf[2 * i] = x[ish[i]];
  const y = stockhamLineReference(buf, n, sign);
  const fsh = fftshiftGather(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const scale = sign === 1 ? 1 / n : 1; // numpy ifft normalises by 1/n
  for (let i = 0; i < n; i += 1) {
    re[i] = y[2 * fsh[i]] * scale;
    im[i] = y[2 * fsh[i] + 1] * scale;
  }
  return { re, im };
}

/** Symmetric pad offsets (origin lands on the padded centre, as np.pad use). */
export function padLo(n: number, padded: number): number {
  return Math.floor(padded / 2) - Math.floor(n / 2);
}

/** Split `lines` into a 2-D dispatch grid under the 65535 per-dim limit. */
export function dispatchGrid(lines: number): { x: number; y: number } {
  const MAX = 32768;
  if (lines <= MAX) return { x: lines, y: 1 };
  const y = Math.ceil(lines / MAX);
  return { x: MAX, y };
}
