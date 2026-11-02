// The tools' descriptions as contracts (THY-63 R2, docs/pilot-context-design.md
// §5.3): what a tool answers, its inputs, what it returns and when to call it,
// in at most DESCRIPTION_MAX characters, with the method in the skills and
// docs. Each parameter's description is at most PARAMETER_MAX characters. A
// tool whose description carries a catalogue (update_settings: the settings
// it changes, the model's one source of their names and ranges) keeps its
// contract to the cap in the first paragraph and the catalogue in the second.
// Both arms are held: arm B's text, and arm C's without its inference.

import { describe, expect, it } from "vitest";

import { SYMMETRY_AVERAGE_SETTINGS } from "../tune/catalog";
import { CHAT_TOOLS } from "../tools";

const DESCRIPTION_MAX = 500;
const PARAMETER_MAX = 80;
// The tools whose description has a second paragraph, and what it is.
const CATALOGUES: Record<string, string> = { update_settings: "the settings it changes, with their values and ranges" };

type Schema = { description?: string; properties?: Record<string, Schema>; items?: Schema };
/** Every parameter description in a schema, by its path. */
function parameterTexts(schema: Schema, path = ""): [string, string][] {
  return Object.entries(schema.properties ?? {}).flatMap(([k, p]) => [
    ...(p.description ? ([[`${path}${k}`, p.description]] as [string, string][]) : []),
    ...parameterTexts(p, `${path}${k}.`),
    ...(p.items ? parameterTexts(p.items, `${path}${k}[].`) : []),
  ]);
}

describe("each tool's description is a contract of at most 500 characters", () => {
  for (const tool of CHAT_TOOLS) {
    it(tool.name, () => {
      for (const [arm, text] of [["B", tool.description], ["C", tool.descriptionWithoutSkills ?? tool.description]] as const) {
        const [contract, ...rest] = text.split("\n");
        expect(contract.length, `${tool.name} (arm ${arm}): ${contract.length} characters, over ${DESCRIPTION_MAX}`).toBeLessThanOrEqual(DESCRIPTION_MAX);
        expect(rest.length, `${tool.name} (arm ${arm}): a second paragraph is a catalogue, listed in CATALOGUES`).toBe(tool.name in CATALOGUES ? 1 : 0);
      }
      for (const [path, text] of parameterTexts(tool.parameters as Schema)) {
        expect(text.length, `${tool.name}.${path}: ${text.length} characters, over ${PARAMETER_MAX}`).toBeLessThanOrEqual(PARAMETER_MAX);
      }
    });
  }

  it("names the user's settings as update_settings' contract does (the symmetry* settings)", () => {
    for (const key of SYMMETRY_AVERAGE_SETTINGS) expect(key.startsWith("symmetry"), key).toBe(true);
  });

  it("lists no catalogue for a tool that has none", () => {
    for (const name of Object.keys(CATALOGUES)) expect(CHAT_TOOLS.some((t) => t.name === name), name).toBe(true);
  });
});
