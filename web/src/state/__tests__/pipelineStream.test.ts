// A native run's progress stream: the page follows the job to its own end.
// When the stream drops, the job's status says what became of it: still
// running (follow it again, without logging its events twice), ended (take
// that end), or unknown to the server or unreachable (the run is reported
// lost, never left "running").

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { queryClient } from "../../api/queryClient";
import { usePipelineStore } from "../pipelineStore";

class FakeSource {
  static all: FakeSource[] = [];
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeSource.all.push(this);
  }
  close() {
    this.closed = true;
  }
  send(ev: object) {
    this.onmessage?.({ data: JSON.stringify(ev) });
  }
  drop() {
    this.onerror?.();
  }
}

const last = <T,>(xs: readonly T[]): T | undefined => xs[xs.length - 1];
const progress = (stage: string, status: string) => ({ type: "progress", stage, status, message: `${stage} ${status}` });
let job: { status: number; body?: object } | "unreachable";

beforeEach(() => {
  FakeSource.all = [];
  job = { status: 200, body: { id: "j1", input: "s.nxs", status: "running", error: null, n_events: 0 } };
  vi.stubGlobal("EventSource", FakeSource);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "/api/pipeline/run") return new Response(JSON.stringify({ id: "j1", input: "s.nxs", status: "running", error: null, n_events: 0 }));
      if (url === "/api/pipeline/jobs/j1") {
        if (job === "unreachable") throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify(job.body ?? {}), { status: job.status });
      }
      throw new Error(`unexpected ${url}`);
    }),
  );
  usePipelineStore.setState(usePipelineStore.getInitialState(), true);
});
afterEach(() => vi.unstubAllGlobals());

const started = async () => {
  void usePipelineStore.getState().run();
  await vi.waitFor(() => expect(FakeSource.all).toHaveLength(1));
  return FakeSource.all[0];
};

describe("following a native run", () => {
  it("follows a job whose stream dropped while it runs, without logging its events twice", async () => {
    const first = await started();
    first.send(progress("rings", "start"));
    first.send(progress("rings", "done"));
    first.drop();
    await vi.waitFor(() => expect(FakeSource.all).toHaveLength(2));
    const again = FakeSource.all[1];
    // The server replays the job's events from its first.
    again.send(progress("rings", "start"));
    again.send(progress("rings", "done"));
    again.send(progress("punch", "start"));
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    again.send({ type: "done" });
    const s = usePipelineStore.getState();
    expect(s.events.map((e) => e.message)).toEqual(["rings start", "rings done", "punch start"]);
    expect([s.terminal, s.running]).toEqual(["done", false]);
    expect(invalidate).toHaveBeenCalled(); // the outputs it wrote are read afresh
  });

  it("ends the run as the job ended when the stream dropped after it finished", async () => {
    const first = await started();
    job = { status: 200, body: { id: "j1", input: "s.nxs", status: "error", error: "MemoryError: out of memory", n_events: 3 } };
    first.drop();
    await vi.waitFor(() => expect(usePipelineStore.getState().running).toBe(false));
    const s = usePipelineStore.getState();
    expect(s.terminal).toBe("error");
    expect(last(s.events)?.message).toBe("MemoryError: out of memory");
  });

  it("reports the run lost when the server no longer knows the job (it restarted)", async () => {
    const first = await started();
    first.send(progress("rings", "start"));
    job = { status: 404 };
    first.drop();
    await vi.waitFor(() => expect(usePipelineStore.getState().running).toBe(false));
    const s = usePipelineStore.getState();
    expect(s.terminal).toBe("error");
    expect(last(s.events)?.message).toMatch(/no longer knows this run \(it restarted\)/);
  });

  it("reports the run lost when the server cannot be reached", async () => {
    const first = await started();
    job = "unreachable";
    first.drop();
    await vi.waitFor(() => expect(usePipelineStore.getState().running).toBe(false));
    expect(usePipelineStore.getState().terminal).toBe("error");
    expect(last(usePipelineStore.getState().events)?.message).toMatch(/Lost the connection to the server/);
  });

  it("logs the reason a job failed, which its end event carries", async () => {
    const first = await started();
    first.send({ type: "error", message: "the pipeline process was killed (signal 9) before the run finished" });
    const s = usePipelineStore.getState();
    expect(s.terminal).toBe("error");
    expect(last(s.events)).toMatchObject({ status: "error", message: expect.stringMatching(/killed \(signal 9\)/) });
    expect(first.closed).toBe(true);
  });
});
