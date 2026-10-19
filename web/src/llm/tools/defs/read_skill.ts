// read_skill: reads one of the user's skills (skills.ts), or a document it
// cites. Offered with the skills on only (its facts' needsSkills).

import { allSkills, readSkill, REFERENCE_MAX_CHARS } from "../../skills";
import { ToolArgError, type ChatTool } from "../types";

// The user's methods (skills.ts): the system prompt lists their names, and
// this reads one, or a document it cites, when the task calls for it.
export const read_skill: ChatTool = {
  name: "read_skill",
  facts: { label: "Read a skill", acts: null, reachesBackend: false, needsSkills: true },
  description:
    "Read one of the user's skills: their method for a topic, with the steps, the checks and what to report. " +
    "Name it from the list in the system prompt. With reference, read one of the documents the skill cites (a long " +
    "one by section). Read a stage's skill before you change that stage's settings or tune it: those calls are " +
    "refused until it has been read in this conversation.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", enum: allSkills().map((s) => s.name), description: "The skill" },
      reference: { type: "string", description: "One of the skill's references, by the name the skill lists" },
      section: { type: "string", description: "With reference: one section of that document, by its heading" },
    },
    required: ["name"],
  },
  maxResultChars: REFERENCE_MAX_CHARS + 2000,
  run: async (args, ctx) => {
    const name = typeof args.name === "string" ? args.name.trim() : "";
    if (!name) throw new ToolArgError("name must be one of the skills listed in the system prompt");
    const reference = typeof args.reference === "string" && args.reference.trim() ? args.reference.trim() : undefined;
    const section = typeof args.section === "string" && args.section.trim() ? args.section.trim() : undefined;
    let text: string;
    try {
      text = readSkill(name, reference, section);
    } catch (e) {
      throw new ToolArgError((e as Error).message);
    }
    if (!reference) ctx.skillsRead?.add(name);
    return { result: text, summary: reference ? `${name}: ${reference}${section ? ` (${section})` : ""}` : `Read the ${name} skill` };
  },
};
