// A native run's progress stream: the page follows the job to its own end.
// When the stream drops, the job's status says what became of it: still
// running (follow it again, without logging its events twice, however often it
// drops), ended (take that end), or unknown to the server (it restarted: the
// run stopped). A server that cannot be reached is asked again: the run stays
// running, and after a while is shown as lost (its end unknown, never as a
// failure), holding the pipeline until the server answers with the job's end.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { queryClient } from "../../api/queryClient";
import { LOST_AFTER_MS, pipelineBusy, usePipelineStore } from "../pipelineStore";

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
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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

  it("keeps a run whose server cannot be reached for a moment running, and follows it again when it answers", async () => {
    vi.useFakeTimers();
    const first = await started();
    first.send(progress("rings", "start"));
    job = "unreachable";
    first.drop();
    await vi.advanceTimersByTimeAsync(10_000);
    let s = usePipelineStore.getState();
    expect([s.running, s.terminal, s.reconnecting]).toEqual([true, null, true]);
    expect(s.events.some((e) => e.status === "error")).toBe(false);
    expect(FakeSource.all).toHaveLength(1);
    job = { status: 200, body: { id: "j1", input: "s.nxs", status: "running", error: null, n_events: 2 } };
    await vi.advanceTimersByTimeAsync(16_000);
    expect(FakeSource.all).toHaveLength(2);
    const again = FakeSource.all[1];
    again.send(progress("rings", "start"));
    again.send(progress("rings", "done"));
    expect(usePipelineStore.getState().reconnecting).toBe(false);
    again.send({ type: "done" });
    s = usePipelineStore.getState();
    expect(s.events.map((e) => e.message)).toEqual(["rings start", "rings done"]);
    expect([s.terminal, s.running]).toEqual(["done", false]);
  });

  it("shows a run lost, not failed, when the server stays out of reach; holds the pipeline; then takes the job's real end", async () => {
    vi.useFakeTimers();
    const first = await started();
    first.send(progress("rings", "start"));
    job = "unreachable";
    first.drop();
    await vi.advanceTimersByTimeAsync(LOST_AFTER_MS + 16_000);
    let s = usePipelineStore.getState();
    expect([s.running, s.terminal, s.reconnecting]).toEqual([false, "lost", false]);
    expect(s.events.some((e) => e.status === "error")).toBe(false); // no stage marked failed
    expect(pipelineBusy(s)).toBe(true);
    // Another run does not start while this job may still be writing.
    await usePipelineStore.getState().run();
    const posts = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/pipeline/run");
    expect(posts).toHaveLength(1);
    expect(usePipelineStore.getState().terminal).toBe("lost");
    // The server answers: the job finished meanwhile.
    job = { status: 200, body: { id: "j1", input: "s.nxs", status: "done", error: null, n_events: 9 } };
    await vi.advanceTimersByTimeAsync(16_000);
    s = usePipelineStore.getState();
    expect([s.terminal, s.running, pipelineBusy(s)]).toEqual(["done", false, false]);
  });

  it("takes up a lost run again when the server answers that its job still runs", async () => {
    vi.useFakeTimers();
    const first = await started();
    job = "unreachable";
    first.drop();
    await vi.advanceTimersByTimeAsync(LOST_AFTER_MS + 16_000);
    expect(usePipelineStore.getState().terminal).toBe("lost");
    job = { status: 200, body: { id: "j1", input: "s.nxs", status: "running", error: null, n_events: 0 } };
    await vi.advanceTimersByTimeAsync(16_000);
    const s = usePipelineStore.getState();
    expect([s.running, s.terminal]).toEqual([true, null]);
    expect(FakeSource.all).toHaveLength(2);
  });

  it("follows a long run through any number of drops while its stream brings events", async () => {
    const first = await started();
    const sent: string[] = [];
    let source = first;
    for (let i = 0; i < 6; i++) {
      // The server replays what was sent, then the next event.
      sent.forEach((m) => source.send({ type: "progress", stage: "rings", status: "progress", message: m }));
      sent.push(`step ${i}`);
      source.send({ type: "progress", stage: "rings", status: "progress", message: `step ${i}` });
      source.drop();
      await vi.waitFor(() => expect(FakeSource.all).toHaveLength(i + 2));
      source = FakeSource.all[i + 1];
      expect(usePipelineStore.getState().running).toBe(true);
    }
    source.send({ type: "done" });
    const s = usePipelineStore.getState();
    expect(s.events.map((e) => e.message)).toEqual(sent);
    expect(s.terminal).toBe("done");
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
