// What the cut tools' fields mean (THY-63 R3): measure_reciprocal_cut and
// measure_dpdf_cut return `fields` in a reply's first result, as assess_stage
// sends a stage's whole criterion once, and not on their later results there.
// The meanings were the system prompt's glossary; with tools the context holds
// no cut, so they travel with the numbers they explain, costing nothing until
// called. With the skills off (arm C) they are their definitions only.
//
// Hermetic and synthetic: the synthetic crystal behind a mocked API.

import { beforeAll, describe, expect, it, vi } from "vitest";

import type { AgentStep } from "../agent";
import { callTool } from "../tools";
import { DPDF_FIELDS, RECIP_FIELDS } from "../tools/shared/fields";
import { DATASET, DATASETS, freshConsole, installBackend } from "./syntheticCrystal";

const api = vi.hoisted(() => ({
  fetchBraggProfile: vi.fn(),
  fetchConsistencyCheck: vi.fn(),
  fetchDataset: vi.fn(),
  fetchDpdfFeatures: vi.fn(),
  fetchDpdfMeta: vi.fn(),
  fetchDpdfSlice: vi.fn(),
  fetchMeta: vi.fn(),
  fetchProtectedLabels: vi.fn(),
  fetchRingDiagnostics: vi.fn(),
  fetchRingIsotropy: vi.fn(),
  fetchShellFloors: vi.fn(),
  fetchSlice: vi.fn(),
  fetchUbCheck: vi.fn(),
  compareLaueClasses: vi.fn(),
  fetchVolumeCoverage: vi.fn(),
  fetchVolumeTexture: vi.fn(),
}));
vi.mock("../../api/client", () => api);

beforeAll(() => {
  installBackend(api);
  freshConsole();
});

const CASES = [
  { tool: "measure_reciprocal_cut", args: { plane: "hk0", value: 0 }, fields: RECIP_FIELDS },
  { tool: "measure_dpdf_cut", args: { plane: "xy", value: 0 }, fields: DPDF_FIELDS },
] as const;

describe("the cut tools say what their fields mean once in a reply", () => {
  for (const { tool, args, fields } of CASES) {
    it(tool, async () => {
      const call = (replySteps: AgentStep[], skills = true) => callTool({ dataset: DATASET, datasets: DATASETS, replySteps, skills }, tool, { ...args });
      const first = await call([]);
      expect(first.ok, first.text).toBe(true);
      expect(JSON.parse(first.text).fields).toBe(fields.whole);
      // A later call in the same reply leaves them out; a call in a new reply has them again.
      const earlier: AgentStep[] = [{ id: "0:call_0", name: tool, args: { ...args }, status: "done", result: first.text }];
      const later = await call(earlier);
      expect(JSON.parse(later.text)).not.toHaveProperty("fields");
      const rest = JSON.parse(first.text) as Record<string, unknown>;
      delete rest.fields;
      expect(JSON.parse(later.text)).toEqual(rest);
      // An earlier call that failed sent none.
      expect(JSON.parse((await call([{ ...earlier[0], status: "error", result: "Error: no such cut" }])).text).fields).toBe(fields.whole);
      // With the skills off, the definitions only.
      expect(fields.hasInference).toBe(true);
      expect(JSON.parse((await call([], false)).text).fields).toBe(fields.definitions);
    });
  }
});
