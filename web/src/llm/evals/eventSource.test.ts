// The EventSource the validation runs install in Node, against a local server.

import { afterEach, describe, expect, it } from "vitest";

import { FetchEventSource, installEventSource } from "./eventSource";

type Server = { listen(p: number, cb: () => void): void; close(): void; address(): { port: number } };
let server: Server | null = null;

async function serve(chunks: string[]): Promise<string> {
  const spec = "node:http";
  const http = (await import(/* @vite-ignore */ spec)) as {
    createServer(h: (q: unknown, r: { writeHead(c: number, h: Record<string, string>): void; write(s: string): void; end(): void }) => void): Server;
  };
  server = http.createServer((_q, r) => {
    r.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const c of chunks) r.write(c);
    r.end();
  });
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  return `http://127.0.0.1:${server.address().port}/events`;
}

afterEach(() => {
  server?.close();
  server = null;
});

const collect = (url: string) =>
  new Promise<{ data: string[]; ended: boolean }>((resolve) => {
    const es = new FetchEventSource(url);
    const data: string[] = [];
    es.onmessage = (e) => data.push(e.data);
    es.onerror = () => resolve({ data, ended: true }); // the stream ended
  });

describe("the EventSource for Node", () => {
  it("delivers each event's data, whatever way the stream is cut into chunks", async () => {
    const url = await serve(['data: {"type":"progress","n":1}\n\nda', 'ta: {"type":"progress","n":2}\n', "\n", 'data: {"type":"done"}\n\n']);
    const got = await collect(url);
    expect(got.data.map((d) => JSON.parse(d))).toEqual([{ type: "progress", n: 1 }, { type: "progress", n: 2 }, { type: "done" }]);
    expect(got.ended).toBe(true);
  });

  it("joins an event's lines and ignores comments and other fields", async () => {
    const url = await serve([": keep-alive\n\n", "event: x\ndata: a\ndata: b\n\n"]);
    expect((await collect(url)).data).toEqual(["a\nb"]);
  });

  it("stays quiet after close()", async () => {
    const url = await serve(['data: {"type":"done"}\n\n']);
    const es = new FetchEventSource(url);
    let errors = 0;
    es.onerror = () => (errors += 1);
    es.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(errors).toBe(0);
  });

  it("is installed only where there is none", () => {
    const g = globalThis as unknown as { EventSource?: unknown };
    const had = g.EventSource;
    try {
      delete g.EventSource;
      installEventSource();
      expect(g.EventSource).toBe(FetchEventSource);
      const other = class {};
      g.EventSource = other;
      installEventSource();
      expect(g.EventSource).toBe(other);
    } finally {
      g.EventSource = had;
    }
  });
});
