// A check's slices asked for volume by volume (api/sliceBatch.ts): the batch's
// slices are the one-slice call's, a cut the batch could not give is asked
// for alone, and the native build makes the one-slice requests it always made.

import { beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({ fetchSlice: vi.fn(), fetchDpdfSlice: vi.fn() }));
vi.mock("../client", () => client);

import { resetVolumeState } from "../../state/volumeReset";
import { decodeSliceBatch, decodeSliceBytes } from "../pyodideEngine";
import { readDpdfSlices, readSlices, readTogether, type SliceBackend, type SliceCut } from "../sliceBatch";
import { forgetSlices, keepSlice, keptSlice, resetSliceStoreCounts, SLICE_BYTES_KEPT, sliceKey, SLICES_KEPT, sliceStoreCounts } from "../sliceStore";
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
function packed(items: (Uint8Array | string)[], version: string | null = null): Uint8Array {
  const header = new TextEncoder().encode(JSON.stringify({ version, items: items.map((x) => (typeof x === "string" ? { error: x } : { bytes: x.length })) }));
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

beforeEach(() => {
  vi.resetAllMocks();
  forgetSlices();
  resetSliceStoreCounts();
});

describe("several slices in one answer", () => {
  it("decodes each cut to what its own envelope decodes to, bit for bit", () => {
    const envelopes = [envelope(1), envelope(2, 9), envelope(3)];
    // Not at the start of its buffer, as a transferred payload can be.
    const whole = packed(envelopes);
    const shifted = new Uint8Array(whole.length + 3);
    shifted.set(whole, 3);
    const { items, version } = decodeSliceBatch(shifted.subarray(3));
    expect(version).toBeNull();
    expect(decodeSliceBatch(packed(envelopes, "w:3:/work/a.nxs:10:20:30")).version).toBe("w:3:/work/a.nxs:10:20:30");
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
    const b = backend(async () => ({ version: null, items: [] }));
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

// ---------------------------------------------------------------- slices kept under the file's version

/** A worker's volume: what its file holds now, under the version the worker gives it, and what was asked of it. */
function worker() {
  const files = new Map<string, { version: string; seed: number }>();
  const asked = { versions: 0, batches: [] as [string, SliceCut[]][], singles: 0 };
  const seedOf = (id: string, cut: SliceCut) => (files.get(id)?.seed ?? 0) * 100 + cut.plane.length + cut.value;
  const backend: Required<SliceBackend<SliceCut>> = {
    version: async (id) => {
      asked.versions += 1;
      return files.get(id)?.version ?? null;
    },
    key: (id, c) => sliceKey("hkl", id, [c.plane, c.value, c.interp ?? false]),
    batch: async (id, cs) => {
      asked.batches.push([id, [...cs]]);
      const f = files.get(id);
      if (!f) throw new Error("unknown volume");
      return decodeSliceBatch(
        packed(
          cs.map((c) => envelope(seedOf(id, c))),
          f.version,
        ),
      );
    },
    single: async (id, c) => {
      asked.singles += 1;
      return decodeSliceBytes(envelope(seedOf(id, c)));
    },
  };
  return { files, asked, backend, fresh: (id: string, c: SliceCut) => decodeSliceBytes(envelope(seedOf(id, c))) };
}

const same = (a: Slice, b: Slice): void => {
  expect(a.header).toEqual(b.header);
  expect(Object.is(a.header.x_axis[0], b.header.x_axis[0])).toBe(true);
  expect([...bytesOf(a)]).toEqual([...bytesOf(b)]);
};

describe("slices kept under the file's version", () => {
  it("uses a kept slice while the worker gives the same version, and asks the worker each time", async () => {
    const w = worker();
    w.files.set("demo.raw", { version: "w:4:/work/raw.nxs:10:20:30", seed: 1 });
    const first = await Promise.all(readTogether(w.backend, "demo.raw", cuts, true));
    expect(w.asked.batches).toHaveLength(1);
    const again = await Promise.all(readTogether(w.backend, "demo.raw", cuts, true));
    expect(w.asked.batches).toHaveLength(1); // not read again
    expect(w.asked.versions).toBe(2); // asked at each read
    expect(w.asked.singles).toBe(0);
    again.forEach((s, i) => {
      same(s, first[i]);
      same(s, w.fresh("demo.raw", cuts[i]));
      // Arrays of its own: what one reader does to its slice reaches no other.
      expect(s.data).not.toBe(first[i].data);
      expect(s.data.buffer).not.toBe(first[i].data.buffer);
    });
    again[0].data.fill(7);
    again[0].header.x_axis[0] = 99;
    same((await Promise.all(readTogether(w.backend, "demo.raw", cuts, true)))[0], w.fresh("demo.raw", cuts[0]));
    expect(sliceStoreCounts()).toMatchObject({ slices: 3, kept: 3, reused: 6 });
  });

  it("reads again when the version changed, whatever else stayed the same", async () => {
    const w = worker();
    w.files.set("demo.raw", { version: "w:4:/work/raw.nxs:10:20:30", seed: 1 });
    await Promise.all(readTogether(w.backend, "demo.raw", cuts, true));
    // Rewritten: another count of writes, the same path, size, date and inode.
    w.files.set("demo.raw", { version: "w:6:/work/raw.nxs:10:20:30", seed: 2 });
    const got = await Promise.all(readTogether(w.backend, "demo.raw", cuts, true));
    expect(w.asked.batches).toHaveLength(2);
    got.forEach((s, i) => same(s, w.fresh("demo.raw", cuts[i])));
    expect(got[0].header.cut_label).not.toBe("L = 105");
    // The old version back (it never is): nothing kept answers to it.
    w.files.set("demo.raw", { version: "w:4:/work/raw.nxs:10:20:30", seed: 1 });
    await Promise.all(readTogether(w.backend, "demo.raw", cuts, true));
    expect(w.asked.batches).toHaveLength(3);
  });

  it("reads only the cuts it does not hold, in one call", async () => {
    const w = worker();
    w.files.set("demo.raw", { version: "v1", seed: 1 });
    await Promise.all(readTogether(w.backend, "demo.raw", cuts.slice(0, 2), true));
    const got = await Promise.all(readTogether(w.backend, "demo.raw", cuts, true));
    expect(w.asked.batches[1]).toEqual(["demo.raw", [cuts[2]]]);
    got.forEach((s, i) => same(s, w.fresh("demo.raw", cuts[i])));
  });

  it("uses nothing kept when the file changed between the version and the read", async () => {
    const w = worker();
    w.files.set("demo.raw", { version: "v1", seed: 1 });
    await Promise.all(readTogether(w.backend, "demo.raw", cuts.slice(0, 2), true));
    // A run lands after the version is given and before the batch is read.
    const version = w.backend.version;
    w.backend.version = async (id) => {
      const v = await version(id);
      w.files.set("demo.raw", { version: "v2", seed: 2 });
      return v;
    };
    const got = await Promise.all(readTogether(w.backend, "demo.raw", cuts, true));
    // The missing cut, then all three again: every slice from the file as it is now.
    expect(w.asked.batches.slice(1)).toEqual([
      ["demo.raw", [cuts[2]]],
      ["demo.raw", cuts],
    ]);
    got.forEach((s, i) => same(s, w.fresh("demo.raw", cuts[i])));
    w.backend.version = version;
    await Promise.all(readTogether(w.backend, "demo.raw", cuts, true));
    expect(w.asked.batches).toHaveLength(3); // kept under v2, the version they were read at
  });

  it("keeps nothing without a version, and nothing for a cut that failed", async () => {
    const w = worker();
    w.files.set("demo.raw", { version: "v1", seed: 1 });
    w.backend.version = async () => {
      throw new Error("no such call");
    };
    await Promise.all(readTogether(w.backend, "demo.raw", cuts, true));
    await Promise.all(readTogether(w.backend, "demo.raw", cuts, true));
    expect(w.asked.batches).toHaveLength(2);
    forgetSlices();
    w.backend.version = async () => "v1";
    w.backend.batch = async () => decodeSliceBatch(packed([envelope(1), "ValueError: boom", envelope(3)], "v1"));
    await Promise.allSettled(readTogether(w.backend, "demo.raw", cuts, true));
    expect(sliceStoreCounts().slices).toBe(2);
    expect(keptSlice(w.backend.key("demo.raw", cuts[1]), "v1")).toBeNull();
    // A batch that names no version keeps nothing.
    forgetSlices();
    w.backend.batch = async () => decodeSliceBatch(packed([envelope(1), envelope(2), envelope(3)]));
    await Promise.all(readTogether(w.backend, "demo.raw", cuts, true));
    expect(sliceStoreCounts().slices).toBe(0);
  });

  it("tells datasets, volumes, kinds of volume and cuts apart", async () => {
    const w = worker();
    for (const [i, id] of ["a.raw", "a.flattened", "b.raw", "a~tune~r1.raw"].entries()) w.files.set(id, { version: `v-${id}`, seed: i + 1 });
    for (const id of w.files.keys()) await Promise.all(readTogether(w.backend, id, cuts, true));
    expect(w.asked.batches).toHaveLength(4);
    for (const id of w.files.keys()) {
      const got = await Promise.all(readTogether(w.backend, id, cuts, true));
      got.forEach((s, i) => same(s, w.fresh(id, cuts[i])));
    }
    expect(w.asked.batches).toHaveLength(4);
    // Another cut of a volume held: −0 is not +0, and interpolated is not nearest.
    await Promise.all(readTogether(w.backend, "a.raw", [{ plane: "hk0", value: -0 }, { plane: "hk0", value: 0, interp: true }], true));
    expect(w.asked.batches[4][1]).toHaveLength(2);
    // The same id and cut of another kind of volume is another slice.
    expect(sliceKey("dpdf", "a.raw", ["xy", 0])).not.toBe(sliceKey("hkl", "a.raw", ["xy", 0]));
    expect(sliceKey("hkl", "a.raw", ["hk0", 0, false])).not.toBe(sliceKey("hkl", "a.raw", ["hk0", 0, true]));
    expect(sliceKey("hkl", "a.raw", ["hk0", 0, false])).not.toBe(sliceKey("hkl", "a.raw", ["hk0", -0, false]));
    expect(sliceKey("hkl", "a", ["b,c", 0])).not.toBe(sliceKey("hkl", "a,b", ["c", 0]));
  });

  it("is bounded in slices and in bytes, the ones asked for longest ago out first", () => {
    for (let i = 0; i < SLICES_KEPT + 5; i++) keepSlice(`k${i}`, "v", envelope(i));
    expect(sliceStoreCounts().slices).toBe(SLICES_KEPT);
    expect(keptSlice("k0", "v")).toBeNull();
    expect(keptSlice("k5", "v")).not.toBeNull(); // asked for now: kept longest
    keepSlice("one more", "v", envelope(1));
    expect(keptSlice("k6", "v")).toBeNull();
    expect(keptSlice("k5", "v")).not.toBeNull();
    forgetSlices();
    const big = new Uint8Array(SLICE_BYTES_KEPT / 5);
    for (let i = 0; i < 7; i++) keepSlice(`big${i}`, "v", big);
    expect(sliceStoreCounts().bytes).toBeLessThanOrEqual(SLICE_BYTES_KEPT);
    expect(sliceStoreCounts().slices).toBe(5);
    // One slice too large to keep several of is not kept at all.
    forgetSlices();
    keepSlice("huge", "v", new Uint8Array(SLICE_BYTES_KEPT / 4 + 1));
    expect(sliceStoreCounts()).toMatchObject({ slices: 0, bytes: 0 });
    // A kept envelope is a copy: the caller's buffer is its own.
    const mine = envelope(3);
    keepSlice("copy", "v", mine);
    mine.fill(0);
    expect([...keptSlice("copy", "v")!]).toEqual([...envelope(3)]);
  });

  it("lets go of everything when the volume closes", async () => {
    const w = worker();
    w.files.set("demo.raw", { version: "v1", seed: 1 });
    await Promise.all(readTogether(w.backend, "demo.raw", cuts, true));
    expect(sliceStoreCounts().slices).toBe(3);
    resetVolumeState();
    expect(sliceStoreCounts()).toMatchObject({ slices: 0, bytes: 0 });
    await Promise.all(readTogether(w.backend, "demo.raw", cuts, true));
    expect(w.asked.batches).toHaveLength(2);
  });

  it("keeps nothing on a phone or a tablet, and asks for no version", async () => {
    const w = worker();
    w.files.set("demo.raw", { version: "v1", seed: 1 });
    for (const nav of [{ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }, { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5 }, { userAgent: "Mozilla/5.0 (Linux; Android 15)" }]) {
      vi.stubGlobal("navigator", nav);
      try {
        await Promise.all(readTogether(w.backend, "demo.raw", cuts));
        await Promise.all(readTogether(w.backend, "demo.raw", cuts));
      } finally {
        vi.unstubAllGlobals();
      }
    }
    expect(w.asked).toMatchObject({ versions: 0, singles: 0 });
    expect(w.asked.batches).toHaveLength(6); // read each time, one call per volume all the same
    expect(sliceStoreCounts().slices).toBe(0);
    // A desktop keeps them.
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 0 });
    try {
      await Promise.all(readTogether(w.backend, "demo.raw", cuts));
      await Promise.all(readTogether(w.backend, "demo.raw", cuts));
    } finally {
      vi.unstubAllGlobals();
    }
    expect(w.asked.batches).toHaveLength(7);
  });
});
