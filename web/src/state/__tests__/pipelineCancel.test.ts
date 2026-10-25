// Cancelling an in-browser run: the engine's worker is stopped, which rejects
// the run's pending call; that rejection is the cancel, so the run ends
// "cancelled", not "error", and logs no error line; the outputs the worker
// held went with it, so the dataset listing is read afresh.

import { describe, expect, it, vi } from "vitest";

const engine = vi.hoisted(() => {
  let reject: ((e: Error) => void) | null = null;
  return {
    PYODIDE_MODE: true,
    engine: {
      runPipeline: vi.fn(
        () =>
          new Promise<void>((_resolve, r) => {
            reject = r;
          }),
      ),
    },
    // As the real one: terminate the worker, reject what was pending.
    cancelPipeline: vi.fn(() => reject?.(new Error("Pipeline cancelled"))),
  };
});
vi.mock("../../api/pyodideEngine", () => engine);

import { queryClient } from "../../api/queryClient";
import { usePipelineStore } from "../pipelineStore";

describe("cancelling an in-browser run", () => {
  it("ends it cancelled, with no error logged", async () => {
    const run = usePipelineStore.getState().runStages(["rings", "punch"], { datasetId: "demo" });
    await vi.waitFor(() => expect(engine.engine.runPipeline).toHaveBeenCalled());
    await usePipelineStore.getState().cancel();
    expect(await run).toBe("cancelled");
    const s = usePipelineStore.getState();
    expect([s.terminal, s.running]).toEqual(["cancelled", false]);
    expect(s.events.some((e) => e.status === "error")).toBe(false);
  });

  it("reads the dataset listing afresh after a Cancel of a run started from the page", async () => {
    engine.engine.runPipeline.mockClear();
    void usePipelineStore.getState().run();
    await vi.waitFor(() => expect(engine.engine.runPipeline).toHaveBeenCalled());
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await usePipelineStore.getState().cancel();
    expect(invalidate).toHaveBeenCalled();
    expect(usePipelineStore.getState().terminal).toBe("cancelled");
  });
});
