// A tool's description, written once as text tagged by class (inference.ts)
// and rendered whole or without its inference by the skills' switch.
//
// Each text registers its inference under a label that still names the file
// every tool was written in before they had a file each ("tools/index.ts:
// <tool>'s description"): 6-inference.md lists the spans under these labels,
// and the listing must not move with the code.

import { written, type Tagged } from "../../inference";
import type { AgentTool } from "../types";

/**
 * A tool's description from its text tagged by class (inference.ts): whole as
 * written, and, where it holds inference, its definitions for the skills off.
 * Both come from the one text, so each class is decided once.
 */
export const described = (text: Tagged): Pick<AgentTool, "description" | "descriptionWithoutSkills"> =>
  text.hasInference ? { description: text.whole, descriptionWithoutSkills: text.definitions } : { description: text.whole };

/** A tool's description, tagged: registered under the tool's name. */
export const description = (tool: string) => written(`tools/index.ts: ${tool}'s description`);
