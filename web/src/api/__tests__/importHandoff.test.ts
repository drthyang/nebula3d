// The NeXus Viewer handoff: which requests are accepted, and the ready ->
// file -> loaded/error exchange over window.opener or a BroadcastChannel.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  IMPORT_SCHEMA,
  importChannelName,
  isTrustedOrigin,
  parseImport,
  receiveImport,
  reportImport,
  type ImportChannel,
  type ImportHost,
} from "../importHandoff";

const OWN = "https://drthyang.github.io";
const DEV = "http://localhost:8766";

class FakeChannel implements ImportChannel {
  sent: unknown[] = [];
  listeners: ((e: MessageEvent) => void)[] = [];
  closed = false;

  constructor(readonly name: string) {}

  postMessage(message: unknown): void {
    if (this.closed) throw new Error("InvalidStateError: channel closed");
    this.sent.push(message);
  }

  addEventListener(_type: "message", fn: (e: MessageEvent) => void): void {
    this.listeners.push(fn);
  }

  close(): void {
    this.closed = true;
  }

  emit(data: unknown): void {
    if (!this.closed) for (const fn of [...this.listeners]) fn({ data } as MessageEvent);
  }
}

class FakeHost implements ImportHost {
  origin = OWN;
  sent: { message: unknown; origin: string }[] = [];
  listeners: ((e: MessageEvent) => void)[] = [];
  channels: FakeChannel[] = [];
  opener: ImportHost["opener"] = { postMessage: (message: unknown, origin: string) => void this.sent.push({ message, origin }) };

  constructor({ opener = true, broadcast = true }: { opener?: boolean; broadcast?: boolean } = {}) {
    if (!opener) this.opener = null;
    if (!broadcast) this.channel = () => null;
  }

  addEventListener(_type: "message", fn: (e: MessageEvent) => void): void {
    this.listeners.push(fn);
  }

  removeEventListener(_type: "message", fn: (e: MessageEvent) => void): void {
    this.listeners = this.listeners.filter((f) => f !== fn);
  }

  channel(name: string): ImportChannel | null {
    const channel = new FakeChannel(name);
    this.channels.push(channel);
    return channel;
  }

  emit(data: unknown, origin: string, source: unknown = this.opener): void {
    for (const fn of [...this.listeners]) fn({ data, origin, source } as unknown as MessageEvent);
  }
}

const file = () => new File([new Uint8Array([1, 2, 3])], "demo_300K_sym6mmm.nxs");
const volume = { type: "nebula3d-import", id: "abc", schema: IMPORT_SCHEMA, file: file(), meta: { symmetry: "6/mmm", n: 3 } };

describe("parseImport", () => {
  it("accepts a request from a trusted origin", () => {
    expect(parseImport("?import=nexus-viewer&id=abc&from=https%3A%2F%2Fdrthyang.github.io", OWN, false))
      .toEqual({ id: "abc", origin: OWN });
    expect(parseImport("?import=nexus-viewer&id=abc", OWN, false)).toEqual({ id: "abc", origin: OWN });
  });

  it("ignores other or incomplete requests", () => {
    expect(parseImport("", OWN, false)).toBeNull();
    expect(parseImport("?import=other&id=abc", OWN, false)).toBeNull();
    expect(parseImport("?import=nexus-viewer", OWN, false)).toBeNull();
    expect(parseImport("?import=nexus-viewer&id=abc&from=https%3A%2F%2Fevil.example", OWN, false)).toBeNull();
  });

  it("trusts localhost only in development", () => {
    expect(isTrustedOrigin("http://localhost:8766", OWN, true)).toBe(true);
    expect(isTrustedOrigin("http://127.0.0.1:8766", OWN, true)).toBe(true);
    expect(isTrustedOrigin("http://localhost:8766", OWN, false)).toBe(false);
    expect(isTrustedOrigin("not a url", OWN, true)).toBe(false);
  });
});

describe("receiveImport", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("over window.opener (a viewer on another origin): announces readiness until the file arrives", async () => {
    const host = new FakeHost();
    const pending = receiveImport({ id: "abc", origin: DEV }, { host, interval: 1000 });
    expect(host.channels).toHaveLength(0);
    expect(host.sent).toEqual([{ message: { type: "nebula3d-import-ready", id: "abc" }, origin: DEV }]);
    vi.advanceTimersByTime(2500);
    expect(host.sent).toHaveLength(3);

    // Wrong origin, wrong sender and wrong id are ignored.
    host.emit(volume, "https://evil.example");
    host.emit(volume, DEV, {});
    host.emit({ ...volume, id: "other" }, DEV);
    expect(host.listeners).toHaveLength(1);

    host.emit(volume, DEV);
    const { file: got, meta } = await pending;
    expect(got.name).toBe("demo_300K_sym6mmm.nxs");
    expect(meta).toEqual({ symmetry: "6/mmm" });
    expect(host.listeners).toHaveLength(0);
    vi.advanceTimersByTime(5000);
    expect(host.sent).toHaveLength(3);
  });

  it("over a BroadcastChannel (a viewer on this origin that opened the tab with noopener)", async () => {
    const host = new FakeHost({ opener: false });
    const pending = receiveImport({ id: "abc", origin: OWN }, { host, interval: 1000 });
    const [channel] = host.channels;
    expect(channel.name).toBe(importChannelName("abc"));
    expect(channel.sent).toEqual([{ type: "nebula3d-import-ready", id: "abc" }]);
    vi.advanceTimersByTime(1500);
    expect(channel.sent).toHaveLength(2);

    channel.emit({ ...volume, id: "other" });
    expect(channel.closed).toBe(false);
    channel.emit(volume);
    expect((await pending).file.name).toBe("demo_300K_sym6mmm.nxs");
    expect(channel.closed).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(channel.sent).toHaveLength(2);
  });

  it("listens on both when a viewer on this origin also left an opener", async () => {
    const host = new FakeHost();
    const pending = receiveImport({ id: "abc", origin: OWN }, { host });
    const [channel] = host.channels;
    expect(channel.sent).toHaveLength(1);
    expect(host.sent).toHaveLength(1);

    host.emit(volume, OWN);
    await pending;
    expect(channel.closed).toBe(true);
    expect(host.listeners).toHaveLength(0);
  });

  it("passes on the viewer's build progress, clamped, until the file arrives", async () => {
    const host = new FakeHost({ opener: false });
    const progress: unknown[] = [];
    const pending = receiveImport({ id: "abc", origin: OWN }, { host, onProgress: (p) => progress.push(p) });
    const [channel] = host.channels;
    channel.emit({ type: "nebula3d-import-progress", id: "abc", label: "Symmetrizing", fraction: 0.3 });
    channel.emit({ type: "nebula3d-import-progress", id: "abc", label: "Writing HDF5", fraction: 1.5 });
    // Malformed or for another import: ignored.
    channel.emit({ type: "nebula3d-import-progress", id: "abc", label: "Symmetrizing", fraction: Number.NaN });
    channel.emit({ type: "nebula3d-import-progress", id: "abc", fraction: 0.5 });
    channel.emit({ type: "nebula3d-import-progress", id: "other", label: "Symmetrizing", fraction: 0.5 });
    expect(progress).toEqual([
      { label: "Symmetrizing", fraction: 0.3 },
      { label: "Writing HDF5", fraction: 1 },
    ]);
    expect(channel.closed).toBe(false);

    channel.emit(volume);
    await pending;
    channel.emit({ type: "nebula3d-import-progress", id: "abc", label: "Symmetrizing", fraction: 0.9 });
    expect(progress).toHaveLength(2);
  });

  it("rejects with no link to the viewer, on a malformed reply, on cancel, on timeout and on abort", async () => {
    const req = { id: "abc", origin: DEV };
    await expect(receiveImport(req, { host: new FakeHost({ opener: false }) })).rejects.toThrow(/not opened/);
    const noBroadcast = new FakeHost({ opener: false, broadcast: false });
    await expect(receiveImport({ id: "abc", origin: OWN }, { host: noBroadcast })).rejects.toThrow(/not opened/);

    const host = new FakeHost();
    const bad = receiveImport(req, { host });
    host.emit({ ...volume, schema: "nexus-viewer/99" }, DEV);
    await expect(bad).rejects.toThrow(/unsupported/);

    const cancelled = new FakeHost({ opener: false });
    const pendingCancel = receiveImport({ id: "abc", origin: OWN }, { host: cancelled });
    cancelled.channels[0].emit({ type: "nebula3d-import-cancel", id: "abc", message: "the viewer could not build the volume: no cell" });
    await expect(pendingCancel).rejects.toThrow(/no cell/);

    const slow = new FakeHost({ opener: false });
    const pendingSlow = receiveImport({ id: "abc", origin: OWN }, { host: slow, timeout: 3000 });
    vi.advanceTimersByTime(3000);
    await expect(pendingSlow).rejects.toThrow(/did not send/);
    expect(slow.channels[0].closed).toBe(true);

    const controller = new AbortController();
    const aborted = receiveImport(req, { host: new FakeHost(), signal: controller.signal });
    controller.abort();
    await expect(aborted).rejects.toThrow(/aborted/);
  });
});

describe("reportImport", () => {
  it("reports the outcome to the viewer's origin", () => {
    const host = new FakeHost();
    reportImport({ id: "abc", origin: DEV }, { datasetId: "demo_300k" }, host);
    reportImport({ id: "abc", origin: DEV }, { error: "too large" }, host);
    expect(host.sent).toEqual([
      { message: { type: "nebula3d-import-loaded", id: "abc", datasetId: "demo_300k" }, origin: DEV },
      { message: { type: "nebula3d-import-error", id: "abc", message: "too large" }, origin: DEV },
    ]);
    expect(host.channels).toHaveLength(0);
  });

  it("posts on the channel too for a viewer on this origin, and closes it", () => {
    const host = new FakeHost({ opener: false });
    reportImport({ id: "abc", origin: OWN }, { datasetId: "demo_300k" }, host);
    const [channel] = host.channels;
    expect(channel.name).toBe(importChannelName("abc"));
    expect(channel.sent).toEqual([{ type: "nebula3d-import-loaded", id: "abc", datasetId: "demo_300k" }]);
    expect(channel.closed).toBe(true);
  });
});
