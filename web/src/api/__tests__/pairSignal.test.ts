// The ΔPDF at a structure's pair vectors is read once per volume and
// structure (api/client.ts, fetchPairSignal): a later read asks the server
// with the ETag of the table kept, and a 304 reuses it.  The numbers here are
// made up.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchPairSignal, forgetPairSignals } from "../client";
import { decodePairSignal } from "../pairSignal";

/** The server's envelope for a table of [first, count] rows and its values. */
function envelope(header: Record<string, unknown>, table: number[][] = [], values: number[] = []): Uint8Array<ArrayBuffer> {
  let text = JSON.stringify(header);
  while ((4 + new TextEncoder().encode(text).length) % 4) text += " ";
  const hb = new TextEncoder().encode(text);
  const out = new Uint8Array(4 + hb.length + 24 * table.length + 4 * values.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, hb.length, true);
  out.set(hb, 4);
  let at = 4 + hb.length;
  for (const v of table.flat()) {
    dv.setInt32(at, v, true);
    at += 4;
  }
  for (const v of values) {
    dv.setFloat32(at, v, true);
    at += 4;
  }
  return out;
}

const HEADER = { sigma: 0.25, origin_radius: 1.5, n_vectors: 2, n_values: 5, max_values: 8_000_000, skipped: null };
const TABLE = [
  [-1, 0, 0, 2, 1, 1],
  [0, -1, 0, 1, 3, 1],
];
const VALUES = [4.5, -6.25, NaN, 0.5, 1.5];

describe("decodePairSignal", () => {
  it("reads the header, the table and each difference's block of values", () => {
    const s = decodePairSignal(envelope(HEADER, TABLE, VALUES));
    expect([s.sigma, s.originRadius, s.skipped, s.nValues]).toEqual([0.25, 1.5, null, 5]);
    expect([...s.table]).toEqual(TABLE.flat());
    expect([...s.offsets]).toEqual([0, 2]);
    expect([...s.values]).toEqual(VALUES);
  });

  it("reads the same from the middle of a larger buffer (unaligned bytes)", () => {
    const bytes = envelope(HEADER, TABLE, VALUES);
    const wide = new Uint8Array(bytes.length + 3);
    wide.set(bytes, 3);
    expect([...decodePairSignal(wide.subarray(3)).values]).toEqual(VALUES);
  });

  it("keeps no table when the server skipped the read", () => {
    const s = decodePairSignal(envelope({ ...HEADER, n_values: 9_000_000, skipped: "too_many" }));
    expect([s.skipped, s.nValues, s.maxValues, s.values.length, s.table.length]).toEqual(["too_many", 9_000_000, 8_000_000, 0, 0]);
  });

  it("refuses an answer cut short", () => {
    const bytes = envelope(HEADER, TABLE, VALUES);
    expect(() => decodePairSignal(bytes.subarray(0, bytes.length - 8))).toThrow(/cut short/);
  });
});

interface Served {
  url: string;
  method: string | undefined;
  ifNoneMatch: string | null;
  cache: RequestCache | undefined;
  body: unknown;
}

let served: Served[];
let tag: string;
beforeEach(() => {
  served = [];
  tag = '"v1"';
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      served.push({ url, method: init?.method, ifNoneMatch: headers.get("If-None-Match"), cache: init?.cache, body: JSON.parse(String(init?.body)) });
      if (url.includes("missing")) return new Response("not found", { status: 404, statusText: "Not Found" });
      if (headers.get("If-None-Match") === tag) return new Response(null, { status: 304, headers: { ETag: tag } });
      return new Response(envelope(HEADER, TABLE, VALUES), { status: 200, headers: { ETag: tag } });
    }),
  );
  forgetPairSignals();
});
afterEach(() => vi.unstubAllGlobals());

const DIFFS = new Float64Array([0.5, 0, 0, 0, 0.25, 0]);
const LAT = [4, 4, 6] as const;

describe("fetchPairSignal", () => {
  it("posts the differences and lengths, and reuses the table while the tag stands", async () => {
    const first = await fetchPairSignal("vol.delta_pdf", DIFFS, LAT, "k");
    const second = await fetchPairSignal("vol.delta_pdf", DIFFS, LAT, "k");
    expect(second).toBe(first);
    expect(served.map((x) => x.ifNoneMatch)).toEqual([null, '"v1"']);
    expect(served[0]).toMatchObject({
      url: "/api/deltapdf/vol.delta_pdf/pair-signal",
      method: "POST",
      cache: "no-store",
      body: { diffs: [[0.5, 0, 0], [0, 0.25, 0]], lat: [4, 4, 6] },
    });
  });

  it("reads afresh when the volume was written again", async () => {
    const first = await fetchPairSignal("vol.delta_pdf", DIFFS, LAT, "k");
    tag = '"v2"';
    const second = await fetchPairSignal("vol.delta_pdf", DIFFS, LAT, "k");
    expect(second).not.toBe(first);
    expect(await fetchPairSignal("vol.delta_pdf", DIFFS, LAT, "k")).toBe(second);
    expect(served.map((x) => x.ifNoneMatch)).toEqual([null, '"v1"', '"v2"']);
  });

  it("keeps a table per structure, the last two", async () => {
    await fetchPairSignal("vol.delta_pdf", DIFFS, LAT, "a");
    await fetchPairSignal("vol.delta_pdf", DIFFS, LAT, "b");
    await fetchPairSignal("vol.delta_pdf", DIFFS, LAT, "c");
    await fetchPairSignal("vol.delta_pdf", DIFFS, LAT, "b");
    await fetchPairSignal("vol.delta_pdf", DIFFS, LAT, "a");
    expect(served.map((x) => x.ifNoneMatch)).toEqual([null, null, null, '"v1"', null]);
  });

  it("throws on a failed request and keeps nothing of it", async () => {
    await expect(fetchPairSignal("missing", DIFFS, LAT, "k")).rejects.toThrow(/404/);
    await expect(fetchPairSignal("missing", DIFFS, LAT, "k")).rejects.toThrow(/404/);
    expect(served.map((x) => x.ifNoneMatch)).toEqual([null, null]);
  });
});
