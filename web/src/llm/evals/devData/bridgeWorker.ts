// The Worker seam's second adapter: the CPython bridge.
//
// The engine (api/pyodideEngine.ts) reaches the pipeline through a Worker's
// interface: postMessage, the "message" and "error" events, terminate. In the
// app the adapter behind that seam is the pipeline worker
// (workers/pyodideWorker.ts), which runs nebula3d.webbridge in Pyodide. This
// module is the other adapter: a Worker whose messages travel as frames over
// the stdio of a CPython process (bridge.py) that answers them from the same
// webbridge, natively. The replay project installs it as the global Worker
// (setup.ts), so the engine, the stores and the Pilot's tools above the seam
// run unchanged, as the Pages build runs them; only the transport differs.
//
// A frame is [uint32 LE header length][uint32 LE body length][JSON header]
// [body]. The header is the message: a Worker request, or its reply or an
// event; the body carries a binary payload (load_file's volume, a
// result_binary envelope). Replies to the adapter's own control messages
// (ids "ctl-N": a dev case's workspace, its snapshot, the end) stay here; the
// engine sees only the Worker's messages.
//
// When the process dies the adapter fires "error" with the tail of its stderr,
// as a crashed worker fires one: the engine rejects its calls in flight with
// it and drops the worker, and its next call starts a new bridge.

import type { WorkerRequest } from "../../../workers/pyodideWorker";

/** What the replay project's globalSetup resolved and every test file reads (inject). */
export interface DevBridgeConfig {
  python: string; // the interpreter
  script: string; // bridge.py
  src: string; // the checkout's Python sources, put first on PYTHONPATH
  n: number; // grid points per axis of the dev cases (NEBULA_DEV_N)
  stack: string; // the interpreter and its numeric stack, as one line
}

declare module "vitest" {
  export interface ProvidedContext {
    devBridge: DevBridgeConfig;
  }
}

/**
 * The grids the dev cases are built on, in points per axis over ±4 r.l.u.:
 * the replays' default (NEBULA_DEV_N unset), then the validation's own, for a
 * nightly run (every node on a voxel at either).
 */
export const DEV_GRIDS = [81, 161] as const;

/**
 * The ring-worker pool's setting (api/ringPool.ts): "0" keeps it off, so the
 * engine creates the pipeline worker alone and the ring stage runs serially in
 * it. setup.ts sets it, and devCase keeps it set.
 */
export const RING_WORKERS_KEY = "nebula3d.ringWorkers";

// ---------------------------------------------------------------- Node, typed here

// The web build has no Node types: the little of Node this module and the
// setup files use, typed by hand and loaded by a dynamic import (as
// evals/backend.ts loads node:fs).
interface Readable {
  on(event: "data", fn: (chunk: Uint8Array) => void): void;
}
interface Writable {
  write(chunk: Uint8Array): boolean;
  on(event: "error", fn: (e: Error) => void): void;
}
interface ChildProcess {
  readonly pid?: number;
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  on(event: "close", fn: (code: number | null, signal: string | null) => void): void;
  on(event: "error", fn: (e: Error) => void): void;
  kill(signal?: string): boolean;
}
export interface NodeModules {
  env: Record<string, string | undefined>;
  spawn(cmd: string, args: string[], opts: { env: Record<string, string | undefined>; stdio: string[] }): ChildProcess;
  spawnSync(
    cmd: string,
    args: string[],
    opts: { env: Record<string, string | undefined>; encoding: "utf8" },
  ): { status: number | null; stdout: string; stderr: string; error?: Error };
  existsSync(path: string): boolean;
  realpathSync(path: string): string;
  mkdtempSync(prefix: string): string;
  rmSync(path: string, opts: { recursive: true; force: true }): void;
  tmpdir(): string;
  join(...parts: string[]): string;
  delimiter: string;
  fileURLToPath(url: URL): string;
}

export async function nodeModules(): Promise<NodeModules> {
  const load = (spec: string) => import(/* @vite-ignore */ spec) as Promise<Record<string, never>>;
  const [cp, fs, os, path, url] = await Promise.all(
    ["node:child_process", "node:fs", "node:os", "node:path", "node:url"].map(load),
  );
  const proc = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process;
  return {
    env: proc.env,
    spawn: cp.spawn,
    spawnSync: cp.spawnSync,
    existsSync: fs.existsSync,
    realpathSync: fs.realpathSync,
    mkdtempSync: fs.mkdtempSync,
    rmSync: fs.rmSync,
    tmpdir: os.tmpdir,
    join: path.join,
    delimiter: path.delimiter,
    fileURLToPath: url.fileURLToPath,
  };
}

// ---------------------------------------------------------------- the frames

export interface Frame {
  header: Record<string, unknown>;
  body?: Uint8Array;
}

/**
 * Each of the pipeline worker's messages as the bridge's frame. Typed over
 * WorkerRequest's every `type`, so a message the worker gains is a type error
 * here until the bridge carries it (devData.replay.test.ts pins it; the
 * Python side's test pins bridge.py to the same union).
 */
export const WORKER_MESSAGES: { [K in WorkerRequest["type"]]: (req: Extract<WorkerRequest, { type: K }>) => Frame } = {
  boot: (req) => ({ header: { ...req } }),
  load_file: ({ buffer, ...rest }) => ({ header: rest, body: new Uint8Array(buffer) }),
  load_demo: (req) => ({ header: { ...req } }),
  run_pipeline: (req) => ({ header: { ...req } }),
  json_call: (req) => ({ header: { ...req } }),
  slice_call: (req) => ({ header: { ...req } }),
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const STDERR_KEPT = 8000; // characters of stderr kept for the death notice
const STDERR_SHOWN = 12; // lines of it the notice quotes

// ---------------------------------------------------------------- the adapter

/** A Worker reply the engine received as an error: what the bridge's Python raised. */
export interface RelayedError {
  request: string; // the message type, and the method for a call
  message: string;
}

type Listener = ((ev: never) => void) | { handleEvent(ev: never): void };

let node: NodeModules | null = null;
let config: (DevBridgeConfig & { root: string }) | null = null;
let current: BridgeWorker | null = null;
let started = 0;
const live = new Set<BridgeWorker>();
const relayed: RelayedError[] = [];

/** Installs what every bridge runs with: Node, the interpreter, and a root folder of this test file's own. */
export function configureBridge(modules: NodeModules, cfg: DevBridgeConfig & { root: string }): void {
  node = modules;
  config = cfg;
}

export function bridgeConfig(): DevBridgeConfig & { root: string } {
  if (!config) throw new Error("the dev-data bridge is not installed: the replay project's setup.ts installs it (npx vitest --project replay)");
  return config;
}

/** The bridge the engine's worker is now, or null before it boots and after it ends. */
export const currentBridge = (): BridgeWorker | null => current;

/** How many bridge processes this test file started. */
export const bridgesStarted = (): number => started;

/** The error replies the engine received since the last clear. Tools read through `safe()` and hide them; tests look here. */
export const relayedErrors = (): readonly RelayedError[] => [...relayed];
export const clearRelayedErrors = (): void => {
  relayed.length = 0;
};

/** Ends every bridge of this test file, each asked first to end itself. */
export async function closeBridges(): Promise<void> {
  await Promise.all([...live].map((b) => b.close()));
}

/** A bridge just started: the engine's worker now, and live until it ends. */
function adopt(bridge: BridgeWorker): void {
  started += 1;
  current = bridge;
  live.add(bridge);
}

export class BridgeWorker {
  readonly pid: number | undefined;
  private readonly child: ChildProcess;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly controls = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly inFlight = new Map<number, string>(); // the engine's requests without a reply yet
  private readonly ended: Promise<void>;
  private chunks: Uint8Array[] = [];
  private buffered = 0;
  private need = 8; // bytes the next step reads: the lengths, then the header, then the body
  private lengths: [number, number] | null = null;
  private header: Record<string, unknown> | null = null;
  private stderr = "";
  private controlIds = 0;
  private alive = true;
  private terminated = false; // ended on purpose: no error event

  constructor(url: string | URL, _options?: unknown) {
    void _options;
    const cfg = bridgeConfig();
    if (!node) throw new Error("the dev-data bridge has no Node modules: setup.ts installs them");
    // The engine creates the pipeline worker; ring workers are off (setup.ts).
    if (!String(url).endsWith("/workers/pyodideWorker.ts")) {
      throw new Error(`the CPython bridge stands in for the pipeline worker only, not ${String(url)}: ring workers are off (nebula3d.ringWorkers = "0")`);
    }
    const env = {
      ...node.env,
      PYTHONPATH: [cfg.src, node.env.PYTHONPATH].filter(Boolean).join(node.delimiter),
      PYTHONUNBUFFERED: "1",
    };
    this.child = node.spawn(cfg.python, [cfg.script, "serve", "--root", cfg.root], { env, stdio: ["pipe", "pipe", "pipe"] });
    this.pid = this.child.pid;
    adopt(this);
    this.child.stdout.on("data", (chunk) => this.receive(chunk));
    this.child.stderr.on("data", (chunk) => {
      this.stderr = (this.stderr + decoder.decode(chunk)).slice(-STDERR_KEPT);
    });
    // A write to a process that died fails here; the close below reports the death.
    this.child.stdin.on("error", () => undefined);
    this.ended = new Promise<void>((resolve) => {
      this.child.on("close", (code, signal) => {
        this.died(signal ? `signal ${signal}` : `code ${code}`);
        resolve();
      });
      this.child.on("error", (e) => {
        this.died(e.message);
        resolve();
      });
    });
  }

  // -- the Worker's interface, as the engine uses it ---------------------------

  postMessage(message: unknown, _transfer?: unknown): void {
    void _transfer;
    const req = message as WorkerRequest;
    const encode = (WORKER_MESSAGES as Record<string, ((r: WorkerRequest) => Frame) | undefined>)[req?.type];
    if (!encode) throw new Error(`the CPython bridge carries no Worker message ${JSON.stringify(req?.type)}`);
    this.inFlight.set(req.id, req.type === "json_call" || req.type === "slice_call" ? `${req.type} ${req.method}` : req.type);
    this.write(encode(req));
  }

  addEventListener(type: string, fn: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }

  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }

  /** Stops the process at once, as Worker.terminate stops a worker mid-run: no reply, no error event. */
  terminate(): void {
    this.terminated = true;
    if (current === this) current = null;
    if (this.alive) this.child.kill("SIGKILL");
  }

  // -- the adapter's own ---------------------------------------------------------

  /** Sends one of the bridge's control messages (bridge.py, CONTROL_TYPES); resolves with its payload. */
  control<T>(header: Record<string, unknown>): Promise<T> {
    if (!this.alive) return Promise.reject(new Error(`the CPython bridge (pid ${this.pid}) has ended`));
    const id = `ctl-${++this.controlIds}`;
    return new Promise<T>((resolve, reject) => {
      this.controls.set(id, { resolve: (v) => resolve(v as T), reject });
      this.write({ header: { ...header, id } });
    });
  }

  /** The engine's requests that have no reply yet. */
  requestsInFlight(): number {
    return this.inFlight.size;
  }

  /** The last lines the process wrote to stderr, as its death notice quotes them. */
  stderrTail(): string {
    return this.stderr.trim().split("\n").slice(-STDERR_SHOWN).join("\n");
  }

  /** Kills the process as a crash would: the error event fires, with the tail of its stderr. */
  kill(): void {
    if (this.alive) this.child.kill("SIGKILL");
  }

  /** Asks the process to end, and waits for it (killed after 10 s). */
  async close(): Promise<void> {
    this.terminated = true;
    if (current === this) current = null;
    if (this.alive) {
      const asked = this.control({ type: "terminate" }).catch(() => undefined);
      const timeout = new Promise((resolve) => setTimeout(resolve, 10_000));
      await Promise.race([asked.then(() => this.ended), timeout]);
      if (this.alive) this.child.kill("SIGKILL");
    }
    await this.ended;
  }

  // -- implementation -------------------------------------------------------------

  private write({ header, body }: Frame): void {
    if (!this.alive) return; // its death is reported, or about to be
    const head = encoder.encode(JSON.stringify(header));
    const lengths = new Uint8Array(8);
    const view = new DataView(lengths.buffer);
    view.setUint32(0, head.length, true);
    view.setUint32(4, body?.length ?? 0, true);
    this.child.stdin.write(lengths);
    this.child.stdin.write(head);
    if (body?.length) this.child.stdin.write(body);
  }

  // Frames arrive in chunks of any size: each step takes the bytes it needs
  // into a buffer of its own once they are all here.
  private receive(chunk: Uint8Array): void {
    this.chunks.push(chunk);
    this.buffered += chunk.length;
    while (this.buffered >= this.need) {
      const bytes = this.take(this.need);
      if (!this.lengths) {
        const view = new DataView(bytes.buffer);
        this.lengths = [view.getUint32(0, true), view.getUint32(4, true)];
        this.need = this.lengths[0];
      } else if (!this.header) {
        this.header = JSON.parse(decoder.decode(bytes)) as Record<string, unknown>;
        this.need = this.lengths[1];
      } else {
        const header = this.header;
        [this.lengths, this.header, this.need] = [null, null, 8];
        this.deliver(header, bytes);
      }
    }
  }

  private take(n: number): Uint8Array {
    const out = new Uint8Array(n);
    let filled = 0;
    while (filled < n) {
      const c = this.chunks[0];
      const k = Math.min(c.length, n - filled);
      out.set(c.subarray(0, k), filled);
      filled += k;
      if (k === c.length) this.chunks.shift();
      else this.chunks[0] = c.subarray(k);
    }
    this.buffered -= n;
    return out;
  }

  private deliver(header: Record<string, unknown>, body: Uint8Array): void {
    const id = header.id;
    if (typeof id === "string") {
      const pending = this.controls.get(id);
      this.controls.delete(id);
      if (header.type === "error") pending?.reject(new Error(String(header.message)));
      else pending?.resolve(header.payload);
      return;
    }
    if (typeof id === "number") {
      const request = this.inFlight.get(id);
      this.inFlight.delete(id);
      if (header.type === "error") relayed.push({ request: request ?? "unknown", message: String(header.message) });
    }
    // The engine reads a binary reply's payload as the ArrayBuffer a worker transfers.
    const data = header.type === "result_binary" ? { ...header, payload: body.buffer } : header;
    this.dispatch("message", { type: "message", data });
  }

  private dispatch(type: string, ev: Record<string, unknown>): void {
    for (const fn of this.listeners.get(type) ?? []) {
      if (typeof fn === "function") (fn as (e: unknown) => void)(ev);
      else (fn.handleEvent as (e: unknown) => void)(ev);
    }
  }

  private died(how: string): void {
    if (!this.alive) return;
    this.alive = false;
    live.delete(this);
    if (current === this) current = null;
    const tail = this.stderrTail();
    const message = `the CPython bridge (pid ${this.pid}) exited (${how})${tail ? `; its stderr ends:\n${tail}` : ", with nothing on stderr"}`;
    for (const pending of this.controls.values()) pending.reject(new Error(message));
    this.controls.clear();
    this.inFlight.clear();
    if (!this.terminated) this.dispatch("error", { type: "error", message });
  }
}
