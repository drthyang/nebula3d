// What the memory bar shows (memoryView.ts): the thresholds, the formatting,
// and what each build's bar measures against which ceiling.

import { describe, expect, it } from "vitest";

import type { EngineMemory } from "../../api/engineMemory";
import type { ServerMemory } from "../../api/types";
import {
  engineMemoryView,
  formatAmount,
  formatBytes,
  HIGH_AT,
  memoryLevel,
  serverMemoryView,
  WARN_AT,
} from "../memoryView";

const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const DESKTOP = { device: "desktop" as const, heap_budget_bytes: 3_200_000_000, tab_budget_bytes: null };
const MOBILE = { device: "mobile" as const, heap_budget_bytes: 3_200_000_000, tab_budget_bytes: 1_300_000_000 };

describe("memoryLevel", () => {
  it("is amber from 75% and red from 90%", () => {
    expect([WARN_AT, HIGH_AT]).toEqual([0.75, 0.9]);
    expect(memoryLevel(0)).toBe("ok");
    expect(memoryLevel(0.7499)).toBe("ok");
    expect(memoryLevel(0.75)).toBe("warn");
    expect(memoryLevel(0.8999)).toBe("warn");
    expect(memoryLevel(0.9)).toBe("high");
    expect(memoryLevel(1.3)).toBe("high"); // natively, past the RAM (swapping)
  });

  it("puts amber where the size gate's budget for a run ends on a desktop", () => {
    // 75% of the 4 GiB heap is within 1% of the gate's 3.2 GB budget.
    expect(Math.abs(WARN_AT * 4 * GiB - DESKTOP.heap_budget_bytes) / DESKTOP.heap_budget_bytes).toBeLessThan(0.01);
  });
});

describe("formatting", () => {
  it("writes bytes in binary units", () => {
    expect(formatBytes(0)).toBe("0 MiB");
    expect(formatBytes(-5)).toBe("0 MiB");
    expect(formatBytes(850 * MiB)).toBe("850 MiB");
    expect(formatBytes(GiB)).toBe("1 GiB");
    expect(formatBytes(2.874 * GiB)).toBe("2.87 GiB");
    expect(formatBytes(4 * GiB)).toBe("4 GiB");
    expect(formatBytes(15.62 * GiB)).toBe("15.6 GiB");
    expect(formatBytes(128.4 * GiB)).toBe("128 GiB");
  });

  it("writes used over ceiling in the ceiling's unit", () => {
    expect(formatAmount(1.234 * GiB, 4 * GiB)).toBe("1.23 / 4 GiB");
    expect(formatAmount(300 * MiB, 4 * GiB)).toBe("0.29 / 4 GiB");
    expect(formatAmount(3.21 * GiB, 64 * GiB)).toBe("3.2 / 64 GiB");
    expect(formatAmount(800 * MiB, 1_300_000_000)).toBe("0.78 / 1.21 GiB");
    expect(formatAmount(512 * MiB, 900 * MiB)).toBe("512 / 900 MiB");
  });
});

const engine = (m: Partial<EngineMemory>): EngineMemory => ({ main: null, ring: [], budget: null, ...m });

describe("engineMemoryView (in-browser build)", () => {
  it("shows nothing before the pipeline worker reports a heap", () => {
    expect(engineMemoryView(engine({}))).toBeNull();
    expect(engineMemoryView(engine({ ring: [200 * MiB] }))).toBeNull();
  });

  it("is the pipeline worker's heap against the 4 GiB ceiling on a desktop", () => {
    const v = engineMemoryView(engine({ main: 1.25 * GiB, ring: [200 * MiB, 220 * MiB], budget: DESKTOP }))!;
    expect(v.used).toBe(1.25 * GiB); // a ring worker's heap is its own, not this one
    expect(v.ceiling).toBe(4 * GiB);
    expect(v.percent).toBe(31);
    expect(v.level).toBe("ok");
    expect(v.amount).toBe("1.25 / 4 GiB");
    expect(v.note).toBe("high-water");
    expect(v.tooltip).toContain("never shrinks");
    expect(v.tooltip).toContain("Ring workers: 2, 420 MiB in all");
    expect(v.tooltip).toContain("up to 2.98 GiB");
  });

  it("turns amber and red as the heap nears its ceiling", () => {
    expect(engineMemoryView(engine({ main: 3.2 * GiB, budget: DESKTOP }))!.level).toBe("warn");
    const red = engineMemoryView(engine({ main: 3.7 * GiB, budget: DESKTOP }))!;
    expect(red.level).toBe("high");
    expect(red.fraction).toBeCloseTo(0.925, 3);
  });

  it("falls back to the heap's ceiling without a budget (an older wheel)", () => {
    const v = engineMemoryView(engine({ main: GiB }))!;
    expect(v.ceiling).toBe(4 * GiB);
    expect(v.tooltip).not.toContain("load check");
  });

  it("is every worker's heap against the tab-wide budget on a phone", () => {
    const v = engineMemoryView(engine({ main: 700 * MiB, ring: [300 * MiB], budget: MOBILE }))!;
    expect(v.used).toBe(1000 * MiB);
    expect(v.ceiling).toBe(1_300_000_000);
    expect(v.percent).toBe(81);
    expect(v.level).toBe("warn");
    expect(v.tooltip).toContain("phone or tablet");
    expect(v.tooltip).toContain("not that limit");
  });
});

const server = (m: Partial<ServerMemory>): ServerMemory => ({
  measured: true,
  kind: "rss",
  used_bytes: 3 * GiB,
  ceiling_bytes: 16 * GiB,
  ceiling_source: "ram",
  processes: [
    { role: "server", pid: 1, bytes: 0.5 * GiB, peak_bytes: 0.75 * GiB },
    { role: "run", pid: 2, bytes: 2.5 * GiB, peak_bytes: 2.5 * GiB },
  ],
  ...m,
});

describe("serverMemoryView (native server)", () => {
  it("shows nothing where the server measures nothing", () => {
    expect(serverMemoryView(server({ measured: false, kind: null, used_bytes: null, processes: [] }))).toBeNull();
    expect(serverMemoryView(server({ ceiling_bytes: null }))).toBeNull();
  });

  it("is nebula3d's processes against the machine's RAM", () => {
    const v = serverMemoryView(server({}))!;
    expect(v.amount).toBe("3.0 / 16 GiB"); // one decimal against a ceiling of 10 GiB or more
    expect(v.percent).toBe(19);
    expect(v.note).toBe("RSS");
    expect(v.tooltip).toContain("this machine's RAM");
    // a peak above the current value is worth a word; an equal one is not
    expect(v.tooltip).toContain("Server: 512 MiB (peak 768 MiB) · Run: 2.5 GiB");
    expect(v.tooltip).toContain("helper processes are not counted");
  });

  it("names macOS's footprint and a container's limit", () => {
    const v = serverMemoryView(server({ kind: "footprint", ceiling_source: "container" }))!;
    expect(v.note).toBe("footprint");
    expect(v.tooltip).toContain("Activity Monitor");
    expect(v.tooltip).toContain("the container's memory limit");
  });

  it("can pass 100% (swap) while the bar stays full", () => {
    const v = serverMemoryView(server({ used_bytes: 20 * GiB }))!;
    expect(v.percent).toBe(125);
    expect(v.fraction).toBe(1);
    expect(v.level).toBe("high");
  });
});
