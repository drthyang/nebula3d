// The report's measurement pass (report/collect.ts) over the synthetic crystal
// of modelVisible.test.ts behind a mocked API: it runs ub_check, and its goal
// names a turned UB as {{achieved}} does; a reply that ran ub_check gets a
// report (Q11, 2.4.11). Hermetic and synthetic: no backend, no model, no
// measured data.

import { beforeAll, describe, expect, it, vi } from "vitest";

import type { ChatTurn } from "../chatStore";
import { collectReport, reportable } from "../report/collect";
import { DEFAULT_SETTINGS } from "../settings";
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
  fetchVolumeCoverage: vi.fn(),
  fetchVolumeTexture: vi.fn(),
}));
vi.mock("../../api/client", () => api);

beforeAll(() => installBackend(api));

const turn = (...names: string[]): ChatTurn => ({
  id: 1,
  role: "assistant",
  content: "The answer.",
  steps: names.map((name, i) => ({ id: `s${i}`, name, args: {}, status: "done", result: "{}" })),
});

describe("the report's measurement pass", () => {
  it("runs ub_check, and names the turn it finds in the goal", async () => {
    freshConsole();
    // The synthetic crystal's UB check, its fit turning the UB by 0.6°.
    const base = await api.fetchUbCheck("synthetic_a.raw");
    api.fetchUbCheck.mockImplementation(async (id: string) => ({ ...base, id, angle_deg: 0.6 }));
    const r = await collectReport({ dataset: DATASET, datasets: DATASETS, turn: turn("ub_check"), question: "Is the UB right?", llm: DEFAULT_SETTINGS });
    expect(api.fetchUbCheck).toHaveBeenCalled();
    expect(r.achieved.text).toMatch(/; data problems no setting fixes: (.*; )?the UB is turned by 0\.6°/);
  });

  it("makes a reply that ran only ub_check reportable, as the other checks on the result are", () => {
    expect(reportable(turn("ub_check"))).toBe(true);
    expect(reportable(turn("describe_dataset"))).toBe(false);
  });
});
