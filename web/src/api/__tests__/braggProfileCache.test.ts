// The punch's record is read once per version of the file (api/client.ts,
// fetchBraggProfile): each read still asks the server, with the ETag of the
// copy kept, and a 304 reuses that copy; a new tag (the punch wrote it again)
// is read afresh; reads of one dataset go one at a time, so the second of two
// at once asks with the tag the first brought.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchBraggProfile, forgetBraggProfiles } from "../client";

interface Served {
  url: string;
  ifNoneMatch: string | null;
  cache: RequestCache | undefined;
}

/** A server holding one record per dataset, under a tag that changes when it is written. */
function server() {
  const records = new Map<string, { tag: string; body: unknown }>();
  const served: Served[] = [];
  let parked: (() => void) | null = null; // a request held until release()
  let hold = false;
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    served.push({ url, ifNoneMatch: headers.get("If-None-Match"), cache: init?.cache });
    if (hold) await new Promise<void>((r) => (parked = r));
    const id = decodeURIComponent(/\/api\/bragg\/(.+)\/profile$/.exec(url)![1]);
    const rec = records.get(id);
    if (!rec) return new Response("not found", { status: 404 });
    if (headers.get("If-None-Match") === rec.tag) return new Response(null, { status: 304, headers: { ETag: rec.tag } });
    return new Response(JSON.stringify(rec.body), { status: 200, headers: { ETag: rec.tag, "Content-Type": "application/json" } });
  });
  return {
    fetch,
    served,
    write: (id: string, tag: string, body: unknown) => records.set(id, { tag, body }),
    holdNext: () => (hold = true),
    release: () => {
      hold = false;
      parked?.();
      parked = null;
    },
  };
}

let s: ReturnType<typeof server>;
beforeEach(() => {
  s = server();
  vi.stubGlobal("fetch", s.fetch);
  forgetBraggProfiles();
});
afterEach(() => vi.unstubAllGlobals());

const record = (n: number) => ({ dataset_id: "ds", has_profile: true, n_peaks: n, peaks: [] });

describe("fetchBraggProfile", () => {
  it("reads the record once while it stands: later reads ask with its tag and reuse the parse", async () => {
    s.write("ds", '"v1"', record(1));
    const first = await fetchBraggProfile("ds");
    const second = await fetchBraggProfile("ds");
    expect(second).toBe(first);
    expect(first.n_peaks).toBe(1);
    expect(s.served.map((x) => x.ifNoneMatch)).toEqual([null, '"v1"']);
    // Never from the browser's own cache: every read reaches the server.
    expect(s.served.every((x) => x.cache === "no-store")).toBe(true);
  });

  it("reads the record afresh once the punch writes it again", async () => {
    s.write("ds", '"v1"', record(1));
    const first = await fetchBraggProfile("ds");
    s.write("ds", '"v2"', record(2));
    const second = await fetchBraggProfile("ds");
    expect(second).not.toBe(first);
    expect(second.n_peaks).toBe(2);
    expect(await fetchBraggProfile("ds")).toBe(second);
    expect(s.served.map((x) => x.ifNoneMatch)).toEqual([null, '"v1"', '"v2"']);
  });

  it("keeps one copy per dataset, and only the last two datasets read", async () => {
    for (const id of ["a", "b", "c"]) s.write(id, `"${id}"`, { ...record(1), dataset_id: id });
    await fetchBraggProfile("a");
    await fetchBraggProfile("b");
    await fetchBraggProfile("c"); // "a" goes: the oldest
    await fetchBraggProfile("a");
    expect(s.served.map((x) => x.ifNoneMatch)).toEqual([null, null, null, null]);
    await fetchBraggProfile("c");
    expect(s.served[s.served.length - 1].ifNoneMatch).toBe('"c"');
  });

  it("a tuning's trials (its views) never push out the dataset's own record", async () => {
    const ids = ["a", "b", "a~tune~r1~punch-1", "a~tune~r1~punch-2", "a~tune~r1~punch-3", "a~tune~r1"];
    for (const id of ids) s.write(id, `"${id}"`, { ...record(1), dataset_id: id });
    await fetchBraggProfile("a");
    await fetchBraggProfile("b");
    for (const id of ids.slice(2)) await fetchBraggProfile(id);
    // after the tuning, both datasets' records are still kept: each read is a 304
    const before = s.served.length;
    await fetchBraggProfile("a");
    await fetchBraggProfile("b");
    expect(s.served.slice(before).map((x) => x.ifNoneMatch)).toEqual(['"a"', '"b"']);
    // and the views keep their last two
    await fetchBraggProfile("a~tune~r1");
    await fetchBraggProfile("a~tune~r1~punch-1");
    expect(s.served.slice(-2).map((x) => x.ifNoneMatch)).toEqual(['"a~tune~r1"', null]);
  });

  it("reads at once go one at a time: the second asks with the first's tag", async () => {
    s.write("ds", '"v1"', record(1));
    s.holdNext();
    const a = fetchBraggProfile("ds");
    const b = fetchBraggProfile("ds");
    await vi.waitFor(() => expect(s.served).toHaveLength(1));
    s.release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(rb).toBe(ra);
    expect(s.served.map((x) => x.ifNoneMatch)).toEqual([null, '"v1"']);
  });

  it("a failed read keeps nothing, and does not hold up the next", async () => {
    await expect(fetchBraggProfile("missing")).rejects.toThrow(/404/);
    s.write("missing", '"v1"', record(3));
    expect((await fetchBraggProfile("missing")).n_peaks).toBe(3);
    expect(s.served.map((x) => x.ifNoneMatch)).toEqual([null, null]);
  });

  it("a record served with no tag is not kept", async () => {
    s.fetch.mockImplementationOnce(async () => new Response(JSON.stringify(record(4)), { status: 200 }));
    s.write("ds", '"v1"', record(5));
    expect((await fetchBraggProfile("ds")).n_peaks).toBe(4);
    expect((await fetchBraggProfile("ds")).n_peaks).toBe(5);
    // (the first answer was the stub's own, unrecorded): the second asked with no tag.
    expect(s.served.map((x) => x.ifNoneMatch)).toEqual([null]);
  });
});
