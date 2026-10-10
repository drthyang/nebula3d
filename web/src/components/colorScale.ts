// Colour scale shared by every slice view: the vmin/vmax mapping, the asinh /
// lin / log scales, Auto, and the Brightness knob.  Mirrors the NeXus Viewer's
// display bar (js/app.js `scaler` / `autoRange`) so the two apps read the same:
//
//   t = (f(v) − f(vmin)) / (f(vmax) − f(vmin)),  f = asinh(v/soft) | log10 | identity
//
// Auto sets vmin 0 (log: vmax/1000; signed data: −vmax), vmax at the 97th
// percentile of the positive values (|v| for signed data) and the softening at
// their median.  The 3D-ΔPDF page asks for the 99.9th instead (dpdfLevels.ts).
// Brightness is vmax in stops about Auto: +1 halves vmax.

export type ScaleKind = "asinh" | "lin" | "log";

export interface Levels {
  lo: number;
  hi: number;
}

export interface AutoLevels extends Levels {
  soft: number; // asinh softening
}

/** A colour mapping value → t ∈ [0, 1] (NaN for non-finite input). */
export function makeScaler(
  { lo, hi }: Levels,
  scale: ScaleKind,
  soft: number,
  diverging = false,
): (v: number) => number {
  if (diverging) {
    // Signed data: symmetric about 0 over ±hi, whatever the scale.
    const lim = hi > 0 ? hi : 1;
    return (v) => (Number.isFinite(v) ? 0.5 + 0.5 * Math.max(-1, Math.min(1, v / lim)) : NaN);
  }
  const s = soft > 0 ? soft : Math.max(Math.abs(hi - lo), 1e-12) / 20;
  const f =
    scale === "asinh" ? (v: number) => Math.asinh(v / s)
      : scale === "log" ? Math.log10
        : (v: number) => v;
  const loSafe = scale === "log" ? (lo > 0 ? lo : hi / 1000) : lo;
  const f0 = f(loSafe);
  const span = f(hi) - f0 || 1;
  return (v) => {
    if (!Number.isFinite(v)) return NaN;
    if (scale === "log" && v <= 0) return 0;
    const t = (f(v) - f0) / span;
    return t < 0 ? 0 : t > 1 ? 1 : t;
  };
}

/** Sorted finite magnitudes of a sample (|v| when `signed`, else v > 0 only). */
function positives(data: ArrayLike<number>, signed: boolean, maxSamples = 60000): number[] {
  const n = data.length;
  const stride = Math.max(1, Math.floor(n / maxSamples));
  const out: number[] = [];
  for (let i = 0; i < n; i += stride) {
    const v = data[i];
    if (!Number.isFinite(v)) continue;
    if (v > 0) out.push(v);
    else if (signed && v < 0) out.push(-v);
  }
  return out.sort((a, b) => a - b);
}

const quantile = (sorted: number[], q: number) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))];

/** NeXus-style Auto over one or more slices' values; vmax at `percentile`. */
export function autoLevels(
  samples: ArrayLike<number>[],
  { signed = false, scale = "lin" as ScaleKind, percentile = 0.97 } = {},
): AutoLevels {
  const pos: number[] = [];
  for (const s of samples) for (const v of positives(s, signed)) pos.push(v);
  pos.sort((a, b) => a - b);
  const hi = pos.length ? quantile(pos, percentile) : 1;
  const soft = pos.length ? quantile(pos, 0.5) : hi / 20;
  const lo = signed ? -hi : scale === "log" ? hi / 1000 : 0;
  return { lo, hi: hi > 0 ? hi : 1, soft: soft > 0 ? soft : hi / 20 };
}

/** Brightness in stops for a given vmax: +1 is twice as bright (vmax halved). */
export function brightnessOf(autoHi: number, hi: number): number {
  if (!(autoHi > 0) || !(hi > 0)) return 0;
  return Math.log2(autoHi / hi);
}

/** vmax for a brightness in stops about Auto. */
export function hiForBrightness(autoHi: number, stops: number): number {
  return autoHi * Math.pow(2, -stops);
}

/**
 * The histogram behind the colour bar: log-counted bins of the finite values
 * over [domain[0], domain[1]], normalised to a peak of 1.
 */
export function histogram(
  data: ArrayLike<number>,
  domain: [number, number],
  bins = 160,
  maxSamples = 60000,
): Float32Array {
  const out = new Float32Array(bins);
  const [a, b] = domain;
  if (!(b > a)) return out;
  const stride = Math.max(1, Math.floor(data.length / maxSamples));
  for (let i = 0; i < data.length; i += stride) {
    const v = data[i];
    if (!Number.isFinite(v)) continue;
    const k = Math.floor(((v - a) / (b - a)) * bins);
    if (k >= 0 && k < bins) out[k]++;
  }
  let peak = 0;
  for (let i = 0; i < bins; i++) {
    out[i] = Math.log1p(out[i]);
    peak = Math.max(peak, out[i]);
  }
  if (peak > 0) for (let i = 0; i < bins; i++) out[i] /= peak;
  return out;
}

/** A colour-bar domain that holds the Auto range and the current limits. */
export function barDomain(auto: Levels, cur: Levels, signed: boolean): [number, number] {
  if (signed) {
    const m = Math.max(auto.hi, Math.abs(cur.hi), Math.abs(cur.lo)) * 1.6;
    return [-m, m];
  }
  return [Math.min(0, auto.lo, cur.lo), Math.max(auto.hi * 1.6, cur.hi * 1.05)];
}

/** Compact number for limit fields and readouts. */
export function fmtLevel(x: number): string {
  if (!Number.isFinite(x)) return "—";
  const a = Math.abs(x);
  if (a === 0) return "0";
  if (a >= 1000 || a < 1e-3) return x.toExponential(2);
  return Number(x.toPrecision(3)).toString();
}
