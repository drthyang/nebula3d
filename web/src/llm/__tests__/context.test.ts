import { describe, expect, it } from "vitest";

import { buildPipelineContext, contextToJson, qRadius } from "../context/pipelineContext";
import { FLATTEN_UNRECORDED_NOTE, flattenMetrics } from "../metrics/flatten";
import type { FlattenSettings, VolumeMeta } from "../../api/types";
import { makeSlice } from "./helpers";

const meta = {
  lattice: { a: 5, b: 5, c: 5 },
  shape: [41, 41, 41],
} as unknown as VolumeMeta;

describe("buildPipelineContext", () => {
  it("assembles the stage sections it has data for and notes the gaps", () => {
    const raw = makeSlice(41, 41, (x, y) => 1 + 5 * Math.exp(-((Math.sqrt(x * x + y * y) - 6) ** 2) / 0.5));
    const ringremoved = makeSlice(41, 41, () => 1);
    const ctx = buildPipelineContext({
      datasetLabel: "300K",
      plane: "hk0",
      cutValue: 0,
      hklMeta: meta,
      slices: { raw, ringremoved },
    });
    expect(ctx.dataset).toBe("300K");
    expect(ctx.ring_removal).toBeDefined();
    expect(ctx.lattice_A).toEqual({ a: 5, b: 5, c: 5 });
    // Backfill needs punched + backfilled, which are absent → a note, no section.
    expect(ctx.backfill).toBeUndefined();
    expect(ctx.notes?.some((n) => n.includes("backfill"))).toBe(true);
  });

  it("judges the flatten over the run's recorded fit range and percentile, and says when the file records none (4.11)", () => {
    // A floor rising with |Q| over a level of 4, on the H–K plane of a 5 Å cubic cell.
    const backfilled = makeSlice(41, 41, (x, y) => 4 + 0.02 * (x * x + y * y) + Math.sin(3 * x) * Math.cos(2 * y));
    const flattened = makeSlice(41, 41, (x, y) => 0.02 * (x * x + y * y) + Math.sin(3 * x) * Math.cos(2 * y));
    const radius = qRadius("hk0", 0, meta)!;
    const build = (flattenSettings?: FlattenSettings | null) =>
      buildPipelineContext({ datasetLabel: "d", plane: "hk0", cutValue: 0, hklMeta: meta, slices: { backfilled, flattened }, flattenSettings });
    const run = build({ fit_q_range: [9, 30], floor_percentile: 10 });
    expect(run.flatten).toEqual(flattenMetrics(backfilled, flattened, radius, [9, 30], 10));
    expect(run.flatten).not.toEqual(flattenMetrics(backfilled, flattened, radius, [0.8, 10], 25));
    expect(run.flatten!.floor_judged_q![0]).toBeGreaterThanOrEqual(9);
    // Not read: the defaults, silently, as before. Read, and the file records none: the defaults, said so.
    const defaults = flattenMetrics(backfilled, flattened, radius, [0.8, 10], 25);
    expect(build(undefined).flatten).toEqual(defaults);
    expect(build(undefined).notes ?? []).not.toContain(`flatten: ${FLATTEN_UNRECORDED_NOTE}`);
    expect(build(null).flatten).toEqual(defaults);
    expect(build(null).notes).toContain(`flatten: ${FLATTEN_UNRECORDED_NOTE}`);
  });

  it("serializes to valid JSON within the budget", () => {
    const ctx = buildPipelineContext({
      datasetLabel: "d",
      plane: "hk0",
      cutValue: 0,
      slices: {},
    });
    const json = contextToJson(ctx);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json.length).toBeLessThan(6000);
  });
});
