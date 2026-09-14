// Ring-pool client: lives INSIDE the pipeline worker and exposes the plane
// fan-out primitive (`self.nebulaRingPool`) that Python's
// `webbridge._JsPlaneExecutor` awaits.
//
// The main thread creates the ring workers and hands this side one MessagePort
// per worker ({type:"ring_port"} messages, adopted via addRingPort); plane
// buffers then flow pipeline-worker ↔ ring-worker directly over those ports —
// the main thread never touches plane data.
//
// Scheduling: FIFO task queue, at most one in-flight plane per port (the
// Python side keeps ~2× workers submitted, so the queue stays fed while a
// result round-trips).  A dead port fails its in-flight plane with
// { ok:false } — the Python driver recomputes such planes in-process, so
// worker death never changes the output, only the speed.
//
// Stage epochs: the pool is reused across runs and plane indices restart at 0
// every run, so every plane/plane_result message carries the stage epoch
// (incremented by beginStage).  A result echoing a stale epoch — e.g. from a
// worker that was still crunching when a previous stage was aborted — is
// dropped instead of being matched by bare ip to the current stage's plane,
// which would silently corrupt the output with the previous run's data.
//
// Late boots: the stage context is retained for the whole stage, so a worker
// whose Pyodide boot finishes after beginStage receives the context the moment
// it becomes ready (instead of entering the rotation context-less and failing
// every plane it is handed).

export interface PlaneOutcome {
  ip: number;
  ok: boolean;
  skipped?: boolean;
  err?: string | null;
  data?: Float64Array | null;
  mask?: Uint8Array | null;
  message?: string;
}

interface StageContext {
  ctxJson: string;
  axisA: Uint8Array;
  axisB: Uint8Array;
  ub: Uint8Array;
  centers: Uint8Array | null;
  halfwidths: Uint8Array | null;
  ceilings: Uint8Array | null;
}

interface RingPool {
  readyCount(): number;
  beginStage(
    ctxJson: string,
    axisA: Uint8Array, axisB: Uint8Array, ub: Uint8Array,
    centers: Uint8Array | null, halfwidths: Uint8Array | null,
    ceilings: Uint8Array | null,
  ): void;
  submitPlane(
    ip: number, stackValue: number, n0: number, n1: number,
    data: Uint8Array, mask: Uint8Array,
  ): Promise<PlaneOutcome>;
  endStage(): void;
}

interface PortState {
  port: MessagePort;
  ready: boolean;
  alive: boolean;
  inFlightIp: number | null;
  contextEpoch: number; // last stage epoch whose context reached this port
}

interface PlaneTask {
  ip: number;
  stackValue: number;
  n0: number;
  n1: number;
  data: Uint8Array;
  mask: Uint8Array;
  resolve: (o: PlaneOutcome) => void;
}

const ports: PortState[] = [];
const queue: PlaneTask[] = [];
const inFlight = new Map<number, { task: PlaneTask; state: PortState }>();
let stageActive = false;
let stageEpoch = 0;
let stageContext: StageContext | null = null;

function failPlane(ip: number, message: string): void {
  const entry = inFlight.get(ip);
  if (!entry) return;
  inFlight.delete(ip);
  entry.state.inFlightIp = null;
  entry.task.resolve({ ip, ok: false, message });
}

function handleResult(
  outcome: PlaneOutcome & { epoch?: number },
): void {
  if (outcome.epoch !== stageEpoch) return; // stale result from an aborted stage
  const entry = inFlight.get(outcome.ip);
  if (!entry) return; // duplicate — the driver already moved on
  inFlight.delete(outcome.ip);
  entry.state.inFlightIp = null;
  entry.task.resolve(outcome);
  pump();
}

function markDead(state: PortState): void {
  state.alive = false;
  state.ready = false;
  if (state.inFlightIp !== null) {
    failPlane(state.inFlightIp, "ring worker port closed");
  }
  pump();
}

function sendContext(state: PortState): void {
  if (stageContext === null || state.contextEpoch === stageEpoch) return;
  state.port.postMessage({ type: "context", epoch: stageEpoch, ...stageContext });
  state.contextEpoch = stageEpoch;
}

export function addRingPort(port: MessagePort): void {
  const state: PortState = {
    port, ready: false, alive: true, inFlightIp: null, contextEpoch: -1,
  };
  ports.push(state);
  port.addEventListener("message", ((ev: MessageEvent) => {
    const msg = ev.data as { type: string; [k: string]: unknown };
    if (msg.type === "ready") {
      state.ready = true;
      if (stageActive) sendContext(state); // booted mid-stage: catch it up
      pump();
    } else if (msg.type === "plane_result") {
      handleResult(msg as unknown as PlaneOutcome & { epoch?: number });
    } else if (msg.type === "context_error") {
      // The worker cannot run this stage (bad context / dead interpreter);
      // stop scheduling onto it entirely.
      markDead(state);
    }
  }) as EventListener);
  port.addEventListener("messageerror", () => markDead(state));
  port.start();
}

function availablePorts(): PortState[] {
  return ports.filter((s) => s.alive && s.ready);
}

function pump(): void {
  if (!stageActive) return;
  for (const state of availablePorts()) {
    if (state.inFlightIp !== null) continue;
    if (state.contextEpoch !== stageEpoch) sendContext(state);
    const task = queue.shift();
    if (!task) return;
    state.inFlightIp = task.ip;
    inFlight.set(task.ip, { task, state });
    try {
      state.port.postMessage(
        {
          type: "plane", epoch: stageEpoch, ip: task.ip,
          stackValue: task.stackValue,
          n0: task.n0, n1: task.n1, data: task.data, mask: task.mask,
        },
        [task.data.buffer, task.mask.buffer],
      );
    } catch (e) {
      markDead(state);
      failPlane(task.ip, `postMessage failed: ${(e as Error).message}`);
    }
  }
}

export function installRingPoolGlobal(): void {
  const pool: RingPool = {
    readyCount(): number {
      return availablePorts().length;
    },

    beginStage(ctxJson, axisA, axisB, ub, centers, halfwidths, ceilings): void {
      stageActive = true;
      stageEpoch += 1;
      // Retained for the whole stage so late-booting workers catch up; sent
      // with the structured clone (no transfer list), so every worker gets its
      // own copy of these small arrays.
      stageContext = { ctxJson, axisA, axisB, ub, centers, halfwidths, ceilings };
      for (const state of availablePorts()) sendContext(state);
    },

    submitPlane(ip, stackValue, n0, n1, data, mask): Promise<PlaneOutcome> {
      return new Promise<PlaneOutcome>((resolve) => {
        if (!stageActive || availablePorts().length === 0) {
          resolve({ ip, ok: false, message: "no ring workers available" });
          return;
        }
        queue.push({ ip, stackValue, n0, n1, data, mask, resolve });
        pump();
      });
    },

    endStage(): void {
      stageActive = false;
      stageContext = null;
      for (const task of queue.splice(0)) {
        task.resolve({ ip: task.ip, ok: false, message: "stage ended" });
      }
      for (const ip of [...inFlight.keys()]) {
        failPlane(ip, "stage ended");
      }
    },
  };
  (self as unknown as { nebulaRingPool: RingPool }).nebulaRingPool = pool;
}
