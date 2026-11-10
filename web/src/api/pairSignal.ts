// The ΔPDF at a structure's pair vectors, as the server and the in-browser
// engine both send it (POST /api/deltapdf/{id}/pair-signal, bridge method
// dpdf_pair_signal): [uint32 LE header length][JSON header, padded so the
// numbers start on a multiple of 4 bytes][int32 LE table][float32 LE values].

/** The decoded answer: one block of values per pair difference, in the request's order. */
export interface PairSignal {
  /** The volume's robust σ (1.4826 × MAD outside the origin's disk); null when it has no spread. */
  sigma: number | null;
  /** Å: a vector shorter than this lies in the origin's disk and has no value. */
  originRadius: number;
  /** "too_many": more values than the server reads at once, so none were read. */
  skipped: "too_many" | null;
  nValues: number;
  maxValues: number;
  /** Six per difference: its first lattice translation inside the volume along a, b, c, then how many along each. */
  table: Int32Array;
  /** Where each difference's block starts in `values`. */
  offsets: Float64Array;
  /** ΔPDF/σ; NaN inside the origin's disk. */
  values: Float32Array;
}

interface Header {
  sigma: number | null;
  origin_radius: number;
  n_vectors: number;
  n_values: number;
  max_values: number;
  skipped: "too_many" | null;
}

export function decodePairSignal(u8: Uint8Array): PairSignal {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const headerLen = dv.getUint32(0, true);
  const h = JSON.parse(new TextDecoder().decode(u8.subarray(4, 4 + headerLen))) as Header;
  const base = {
    sigma: h.sigma,
    originRadius: h.origin_radius,
    skipped: h.skipped,
    nValues: h.n_values,
    maxValues: h.max_values,
  };
  if (h.skipped) {
    return { ...base, table: new Int32Array(0), offsets: new Float64Array(0), values: new Float32Array(0) };
  }
  const n = h.n_vectors;
  const start = 4 + headerLen;
  const need = start + 24 * n + 4 * h.n_values;
  if (u8.byteLength < need) throw new Error(`pair-signal answer cut short: ${u8.byteLength} of ${need} bytes`);
  // Copies on 0-offset buffers: the typed views need 4-byte alignment, which
  // the bytes' place in a larger buffer does not guarantee.
  const table = new Int32Array(u8.slice(start, start + 24 * n).buffer);
  const values = new Float32Array(u8.slice(start + 24 * n, need).buffer);
  const offsets = new Float64Array(n);
  let at = 0;
  for (let k = 0; k < n; k++) {
    offsets[k] = at;
    at += table[6 * k + 3] * table[6 * k + 4] * table[6 * k + 5];
  }
  if (at !== h.n_values) throw new Error(`pair-signal table holds ${at} values, the header says ${h.n_values}`);
  return { ...base, table, offsets, values };
}
