// A check's slices asked for volume by volume (api/sliceBatch.ts): the batch's
// slices are the one-slice call's, a cut the batch could not give is asked
// for alone, and the native build makes the one-slice requests it always made.

import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ fetchSlice: vi.fn(), fetchDpdfSlice: vi.fn() }));
vi.mock("../client", () => client);

import { decodeSliceBatch, decodeSliceBytes } from "../pyodideEngine";
import { readDpdfSlices, readSlices, readTogether, type SliceBackend, type SliceCut } from "../sliceBatch";
import type { Slice } from "../types";

/** A slice's envelope as the backend packs it: [uint32 LE header_len][JSON header][float32 data]. */
function envelope(seed: number, n = 6): Uint8Array {
  const data = Float32Array.from({ length: n * n }, (_v, i) => (i % 7 === 0 ? NaN : Math.fround(seed + i / 3)));
  // -0 on an axis: the header is read from its text, sign kept.
  const header = `{"ny": ${n}, "nx": ${n}, "x_axis": [-0.0, 1.5], "y_axis": [0.0, 2.5], "x_label": "H", "y_label": "K", "cut_label": "L = ${seed}", "robust_max": ${seed + 0.25}}`;
  const text = new TextEncoder().encode(header);
  const out = new Uint8Array(4 + text.length + data.byteLength);
  new DataView(out.buffer).setUint32(0, text.length, true);
  out.set(text, 4);
  out.set(new Uint8Array(data.buffer), 4 + text.length);
  return out;
}

/** Several envelopes as webbridge._pack_slices packs them; a string is that cut's error. */
function packed(items: (Uint8Array | string)[]): Uint8Array {
  const header = new TextEncoder().encode(JSON.stringify({ items: items.map((x) => (typeof x === "string" ? { error: x } : { bytes: x.length })) }));
  const body = items.filter((x): x is Uint8Array => typeof x !== "string");
  const out = new Uint8Array(4 + header.length + body.reduce((n, b) => n + b.length, 0));
  new DataView(out.buffer).setUint32(0, header.length, true);
  out.set(header, 4);
  let at = 4 + header.length;
  for (const b of body) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}

const bytesOf = (s: Slice): Uint8Array => new Uint8Array(s.data.buffer, s.data.byteOffset, s.data.byteLength);

const cuts: SliceCut[] = [
  { plane: "hk0", value: 0 },
  { plane: "h0l", value: 0 },
  { plane: "0kl", value: 0 },
];

beforeEach(() => vi.resetAllMocks());

describe("several slices in one answer", () => {
  it("decodes each cut to what its own envelope decodes to, bit for bit", () => {
    const envelopes = [envelope(1), envelope(2, 9), envelope(3)];
    // Not at the start of its buffer, as a transferred payload can be.
    const whole = packed(envelopes);
    const shifted = new Uint8Array(whole.length + 3);
    shifted.set(whole, 3);
    const { items } = decodeSliceBatch(shifted.subarray(3));
    expect(items).toHaveLength(3);
    items.forEach((item, i) => {
      const got = decodeSliceBytes(item as Uint8Array);
      const alone = decodeSliceBytes(envelopes[i]);
      expect(got.header).toEqual(alone.header);
      expect(Object.is(got.header.x_axis[0], -0)).toBe(true);
      expect([...bytesOf(got)]).toEqual([...bytesOf(alone)]);
    });
  });

  it("gives a failed cut its error, in place, and refuses a batch that does not add up", () => {
    const { items } = decodeSliceBatch(packed([envelope(1), "ValueError: no such plane", envelope(3)]));
    expect(items[0]).toBeInstanceOf(Uint8Array);
    expect((items[1] as Error).message).toBe("ValueError: no such plane");
    expect(items[2]).toBeInstanceOf(Uint8Array);
    const whole = packed([envelope(1)]);
    expect(() => decodeSliceBatch(whole.subarray(0, whole.length - 4))).toThrow(/cut short/);
    const more = new Uint8Array(whole.length + 4);
    more.set(whole);
    expect(() => decodeSliceBatch(more)).toThrow(/more than its slices/);
  });
});

describe("readTogether", () => {
  const backend = (batch: SliceBackend<SliceCut>["batch"]) => {
    const b = { batch: vi.fn(batch), single: vi.fn(async (_id: string, cut: SliceCut) => decodeSliceBytes(envelope(cut.plane.length + 40))) };
    return b;
  };

  it("asks once for all the cuts and gives each its slice", async () => {
    const envelopes = [envelope(1), envelope(2), envelope(3)];
    const b = backend(async () => decodeSliceBatch(packed(envelopes)));
    const got = await Promise.all(readTogether(b, "demo.raw", cuts));
    expect(b.batch).toHaveBeenCalledTimes(1);
    expect(b.batch).toHaveBeenCalledWith("demo.raw", cuts);
    expect(b.single).not.toHaveBeenCalled();
    expect(got.map((s) => s.header.cut_label)).toEqual(["L = 1", "L = 2", "L = 3"]);
    got.forEach((s, i) => expect([...bytesOf(s)]).toEqual([...bytesOf(decodeSliceBytes(envelopes[i]))]));
  });

  it("asks alone for a cut the batch could not give: its slice or its own error", async () => {
    const b = backend(async () => decodeSliceBatch(packed([envelope(1), "ValueError: boom", envelope(3)])));
    b.single.mockRejectedValueOnce(new Error("the one-slice call's own words"));
    const settled = await Promise.allSettled(readTogether(b, "demo.raw", cuts));
    expect(settled.map((s) => s.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect((settled[1] as PromiseRejectedResult).reason).toEqual(new Error("the one-slice call's own words"));
    expect(b.single).toHaveBeenCalledTimes(1);
    expect(b.single).toHaveBeenCalledWith("demo.raw", cuts[1]);
  });

  it("leaves every cut to its own call when the batch fails as a whole", async () => {
    const b = backend(async () => {
      throw new Error("no such method");
    });
    const got = await Promise.all(readTogether(b, "demo.raw", cuts));
    expect(b.single.mock.calls).toEqual(cuts.map((c) => ["demo.raw", c]));
    expect(got).toHaveLength(3);
  });

  it("asks for nothing without cuts", () => {
    const b = backend(async () => ({ items: [] }));
    expect(readTogether(b, "demo.raw", [])).toEqual([]);
    expect(b.batch).not.toHaveBeenCalled();
  });
});

describe("the native build", () => {
  it("makes the one-slice requests, with the arguments the callers gave before", async () => {
    client.fetchSlice.mockImplementation(async (_id: string, plane: string) => decodeSliceBytes(envelope(plane.length)));
    client.fetchDpdfSlice.mockImplementation(async () => decodeSliceBytes(envelope(9)));
    await Promise.all(readSlices("demo.raw", [...cuts, { plane: "hk0", value: 0.5, interp: false }, { plane: "kl", value: 1, interp: true }]));
    expect(client.fetchSlice.mock.calls).toEqual([
      ["demo.raw", "hk0", 0],
      ["demo.raw", "h0l", 0],
      ["demo.raw", "0kl", 0],
      ["demo.raw", "hk0", 0.5, false],
      ["demo.raw", "kl", 1, true],
    ]);
    await Promise.all(readDpdfSlices("demo.delta_pdf", [{ plane: "xy", value: 0 }, { plane: "yz", value: 2 }]));
    expect(client.fetchDpdfSlice.mock.calls).toEqual([
      ["demo.delta_pdf", "xy", 0],
      ["demo.delta_pdf", "yz", 2],
    ]);
  });
});
