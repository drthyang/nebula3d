// The token budget's dpdf_peaks result, recorded from the dev-data bridge.
//
// tokenBudget.test.ts measures NEBULA Pilot's worst turn with one result of
// each tool the system prompt's method asks for. Every result there comes from
// the synthetic crystal (syntheticCrystal.ts) but dpdf_peaks', whose length
// grows with its list: the crystal has a handful of features, while a real
// ΔPDF fills the list to the tool's default limit. So the worst turn carries
// the dev control's own list instead, as the server returns it for the tool's
// default call: the validation's dev control (a synthetic case) on its own
// grid (161 points per axis), through its default run, here.
//
// The fixture is committed (web/src/llm/__tests__/__fixtures__/
// dpdf-peaks-dev-control.json), so the budget test needs no Python. This test
// writes it when it is missing, and is skipped while it is there. To record it
// again (a change to the tool's defaults, to dpdf_features or to the pipeline's
// defaults), delete the file and run
//
//   npx vitest run --project replay src/llm/evals/devData/budgetFixture.replay.test.ts
//
// from web/. The numbers are the bridge's Python's (its numpy and scipy): on
// another numeric stack they may differ in their last digits, which the
// budget's ±5 % band takes.

import { describe, expect, it } from "vitest";

import { fetchDpdfFeatures } from "../../../api/client";
import type { DpdfFeatures } from "../../../api/types";
import { dpdfVolumeId } from "../../context/loadContext";
import { exists, makeDir, writeText } from "../backend";
import { devCase } from "./index";

const DIR = new URL("../../__tests__/__fixtures__/", import.meta.url);
const FIXTURE = new URL("dpdf-peaks-dev-control.json", DIR);
// The call dpdf_peaks makes with its defaults (min_sigma 5, limit 12): this test
// holds the tool to it, and the budget test holds the fixture to the call.
const CALL = { min_sigma: 5, limit: 12 };
const GRID = 161;

/** The fixture as text: what it is and how it was made, then the response, one group a line. */
function fixtureText(response: DpdfFeatures): string {
  const { groups, ...rest } = response;
  const meta = {
    about:
      "The dev control's dpdf_peaks list, as the server returns it for the tool's default call, for the token budget's worst turn " +
      "(web/src/llm/__tests__/tokenBudget.test.ts). Written by web/src/llm/evals/devData/budgetFixture.replay.test.ts; " +
      "to record it again, delete this file and run that test.",
    case: "dev-control",
    n: GRID,
    ...CALL,
  };
  const entry = (indent: string) => ([k, v]: [string, unknown]) => `${indent}${JSON.stringify(k)}: ${JSON.stringify(v)},`;
  return [
    "{",
    ...Object.entries(meta).map(entry(" ")),
    ' "response": {',
    ...Object.entries(rest).map(entry("  ")),
    '  "groups": [',
    groups.map((g) => `   ${JSON.stringify(g)}`).join(",\n"),
    "  ]",
    " }",
    "}",
    "",
  ].join("\n");
}

const present = await exists(FIXTURE);

describe("the token budget's dpdf_peaks fixture", () => {
  it.skipIf(present)("is the dev control's list at the tool's defaults, written when it is missing", async () => {
    const c = devCase("dev-control", { n: GRID });
    const volume = dpdfVolumeId(await c.dataset())!;
    const served = await fetchDpdfFeatures(volume, CALL.min_sigma, CALL.limit);
    // The tool's own default call asks for the same list.
    const tool = await c.tool("dpdf_peaks");
    expect(tool.ok, tool.summary).toBe(true);
    expect(tool.result.threshold_sigma).toBe(CALL.min_sigma);
    expect((tool.result.features as unknown[]).length).toBe(Math.min(CALL.limit, served.groups.length));
    expect(served.groups).toHaveLength(CALL.limit);
    // The volume's name is the case's opaque label: the fixture names the case instead.
    const response: DpdfFeatures = { ...served, id: "dev-control.delta_pdf" };
    const text = fixtureText(response);
    expect(JSON.parse(text).response).toEqual(response);
    await makeDir(DIR);
    await writeText(FIXTURE, text);
  });
});
