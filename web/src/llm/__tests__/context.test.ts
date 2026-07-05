import { describe, expect, it } from "vitest";

import { buildPipelineContext, contextToJson } from "../context/pipelineContext";
import type { VolumeMeta } from "../../api/types";
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
