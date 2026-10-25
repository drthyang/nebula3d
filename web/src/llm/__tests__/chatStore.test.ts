// The transcript survives a reload of the page: it is restored from
// sessionStorage when the module loads, a question whose reply the reload cut
// off is marked, and only the newest turns that fit the budget are kept.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();

// A fresh copy of the store, as a reload of the page would load it.
const load = async () => {
  vi.resetModules();
  return import("../chatStore");
};

beforeEach(() => {
  storage.clear();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("chat transcript across reloads", () => {
  it("keeps a step's result as the model read it, and drops the outcomes and the whole result beside it, which served the reply", async () => {
    const store = await load();
    const outcome = { check: "coverage" as const, kind: "pass" as const, reasons: [], dataProblems: [], words: "clean" };
    const whole = JSON.stringify({ verdict: "clean", per_cut: "x".repeat(9000) });
    const step = { id: "1", name: "qmax_coverage", args: {}, status: "done" as const, result: '{"verdict":"clean","left_out":["per_cut"]}', full: whole, outcomes: [outcome] };
    store.useChatStore.getState().addTurn({ role: "assistant", content: "Clean.", steps: [step] });
    const kept = store.useChatStore.getState().turns[0].steps![0];
    expect(kept).toEqual({ id: "1", name: "qmax_coverage", args: {}, status: "done", result: '{"verdict":"clean","left_out":["per_cut"]}' });
    expect(storage.get("nebula3d.chat.turns.v1")).not.toMatch(/outcomes|"full"|xxxx/);
  });

  it("loads a transcript saved before the steps carried their whole results, as it was", async () => {
    const saved = [
      { id: 1, role: "user", content: "Is the UB right?" },
      { id: 2, role: "assistant", content: "Yes.", steps: [{ id: "0:c1", name: "ub_check", args: {}, status: "done", summary: "ok", result: '{"angle_deg":0.01}' }] },
    ];
    storage.set("nebula3d.chat.turns.v1", JSON.stringify(saved));
    expect((await load()).useChatStore.getState().turns).toEqual(saved);
  });

  it("loads a step a saved transcript left running as stopped (its reply is gone)", async () => {
    storage.set("nebula3d.chat.turns.v1", JSON.stringify([
      { id: 1, role: "user", content: "Run it" },
      { id: 2, role: "assistant", content: "", steps: [{ id: "0:c1", name: "run_pipeline", args: {}, status: "running", progress: "1/6 Ring removal" }] },
    ]));
    const step = (await load()).useChatStore.getState().turns[1].steps![0];
    expect(step.status).toBe("stopped");
    expect(step.progress).toBeUndefined();
  });

  it("brings back the turns and the draft, and keeps numbering after them", async () => {
    const first = await load();
    first.useChatStore.getState().addTurn({ role: "user", content: "Assess the run" });
    first.useChatStore.getState().addTurn({ role: "assistant", content: "Ring removal is clean." });
    first.useChatStore.getState().setDraft("and the punch?");

    const second = await load();
    const { turns, draft } = second.useChatStore.getState();
    expect(turns.map((t) => t.content)).toEqual(["Assess the run", "Ring removal is clean."]);
    expect(draft).toBe("and the punch?");
    second.useChatStore.getState().addTurn({ role: "user", content: "next" });
    const ids = second.useChatStore.getState().turns.map((t) => t.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("marks a question whose reply the reload cut off", async () => {
    const first = await load();
    first.useChatStore.getState().addTurn({ role: "user", content: "Run the pipeline" });
    const { turns } = (await load()).useChatStore.getState();
    expect(turns).toHaveLength(2);
    expect(turns[1]).toMatchObject({ role: "assistant", note: expect.stringMatching(/cut off by a reload/) });
  });

  it("forgets the transcript on Clear, and keeps only the newest turns that fit", async () => {
    const { useChatStore, fitTranscript } = await load();
    useChatStore.getState().addTurn({ role: "user", content: "x" });
    useChatStore.getState().clear();
    expect((await load()).useChatStore.getState().turns).toEqual([]);

    const turns = Array.from({ length: 10 }, (_v, i) => ({ id: i + 1, role: "user" as const, content: "y".repeat(100) }));
    const kept = JSON.parse(fitTranscript(turns, 600)) as { id: number }[];
    expect(kept.length).toBeLessThan(10);
    expect(kept[kept.length - 1].id).toBe(10); // the newest stay
  });

  it("keeps exactly the newest turns whose JSON fits, as writing the transcript out once per dropped turn did", async () => {
    const { fitTranscript } = await load();
    // The rule written plainly (the former code, quadratic in the turns).
    const reference = (turns: unknown[], budget: number): string => {
      let from = 0;
      let json = JSON.stringify(turns);
      while (json.length > budget && from < turns.length) json = JSON.stringify(turns.slice(++from));
      return json;
    };
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let trial = 0; trial < 200; trial++) {
      const turns = Array.from({ length: Math.floor(rnd() * 12) }, (_v, i) => ({
        id: i + 1,
        role: (i % 2 ? "assistant" : "user") as "assistant" | "user",
        content: "é\"\\\n".repeat(Math.floor(rnd() * 40)),
        ...(rnd() < 0.5 ? { steps: [{ id: `${i}`, name: "assess_stage", args: { stage: "rings" }, status: "done" as const, result: "r".repeat(Math.floor(rnd() * 300)) }] } : {}),
      }));
      const budget = Math.floor(rnd() * 1500);
      expect(fitTranscript(turns, budget)).toBe(reference(turns, budget));
    }
  });

  it("starts empty when storage is unavailable", async () => {
    vi.stubGlobal("sessionStorage", undefined);
    const { useChatStore } = await load();
    expect(useChatStore.getState().turns).toEqual([]);
    useChatStore.getState().addTurn({ role: "user", content: "still works" });
    expect(useChatStore.getState().turns).toHaveLength(1);
  });
});
