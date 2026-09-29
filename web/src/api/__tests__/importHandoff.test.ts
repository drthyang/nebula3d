// The NeXus Viewer handoff: which requests are accepted, and the ready ->
// file -> loaded/error exchange with window.opener.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  IMPORT_SCHEMA,
  isTrustedOrigin,
  parseImport,
  receiveImport,
  reportImport,
  type ImportHost,
} from "../importHandoff";

const OWN = "https://drthyang.github.io";
const VIEWER = "https://drthyang.github.io";

class FakeHost implements ImportHost {
  sent: { message: unknown; origin: string }[] = [];
  listeners: ((e: MessageEvent) => void)[] = [];
  opener = { postMessage: (message: unknown, origin: string) => void this.sent.push({ message, origin }) };

  addEventListener(_type: "message", fn: (e: MessageEvent) => void): void {
    this.listeners.push(fn);
  }

  removeEventListener(_type: "message", fn: (e: MessageEvent) => void): void {
    this.listeners = this.listeners.filter((f) => f !== fn);
  }

  emit(data: unknown, origin = VIEWER, source: unknown = this.opener): void {
    for (const fn of [...this.listeners]) fn({ data, origin, source } as unknown as MessageEvent);
  }
}

const file = () => new File([new Uint8Array([1, 2, 3])], "demo_300K_sym6mmm.nxs");

describe("parseImport", () => {
  it("accepts a request from a trusted origin", () => {
    expect(parseImport("?import=nexus-viewer&id=abc&from=https%3A%2F%2Fdrthyang.github.io", OWN, false))
      .toEqual({ id: "abc", origin: VIEWER });
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
  const req = { id: "abc", origin: VIEWER };

  it("announces readiness until the file arrives, then resolves with it", async () => {
    const host = new FakeHost();
    const pending = receiveImport(req, { host, interval: 1000 });
    expect(host.sent).toEqual([{ message: { type: "nebula3d-import-ready", id: "abc" }, origin: VIEWER }]);
    vi.advanceTimersByTime(2500);
    expect(host.sent).toHaveLength(3);

    // Wrong origin, wrong sender and wrong id are ignored.
    const message = { type: "nebula3d-import", id: "abc", schema: IMPORT_SCHEMA, file: file(), meta: { symmetry: "6/mmm", n: 3 } };
    host.emit(message, "https://evil.example");
    host.emit(message, VIEWER, {});
    host.emit({ ...message, id: "other" });
    expect(host.listeners).toHaveLength(1);

    host.emit(message);
    const { file: got, meta } = await pending;
    expect(got.name).toBe("demo_300K_sym6mmm.nxs");
    expect(meta).toEqual({ symmetry: "6/mmm" });
    expect(host.listeners).toHaveLength(0);
    vi.advanceTimersByTime(5000);
    expect(host.sent).toHaveLength(3);
  });

  it("rejects without an opener, on a malformed reply, on timeout and on abort", async () => {
    const orphan = new FakeHost();
    (orphan as { opener: unknown }).opener = null;
    await expect(receiveImport(req, { host: orphan })).rejects.toThrow(/not opened/);

    const host = new FakeHost();
    const bad = receiveImport(req, { host });
    host.emit({ type: "nebula3d-import", id: "abc", schema: "nexus-viewer/99", file: file() });
    await expect(bad).rejects.toThrow(/unsupported/);

    const cancelled = new FakeHost();
    const pendingCancel = receiveImport(req, { host: cancelled });
    cancelled.emit({ type: "nebula3d-import-cancel", id: "abc", message: "the viewer could not build the volume: no cell" });
    await expect(pendingCancel).rejects.toThrow(/no cell/);

    const slow = receiveImport(req, { host: new FakeHost(), timeout: 3000 });
    vi.advanceTimersByTime(3000);
    await expect(slow).rejects.toThrow(/did not send/);

    const controller = new AbortController();
    const aborted = receiveImport(req, { host: new FakeHost(), signal: controller.signal });
    controller.abort();
    await expect(aborted).rejects.toThrow(/aborted/);
  });
});

describe("reportImport", () => {
  it("reports the outcome to the viewer's origin", () => {
    const host = new FakeHost();
    reportImport({ id: "abc", origin: VIEWER }, { datasetId: "demo_300k" }, host);
    reportImport({ id: "abc", origin: VIEWER }, { error: "too large" }, host);
    expect(host.sent).toEqual([
      { message: { type: "nebula3d-import-loaded", id: "abc", datasetId: "demo_300k" }, origin: VIEWER },
      { message: { type: "nebula3d-import-error", id: "abc", message: "too large" }, origin: VIEWER },
    ]);
  });
});
