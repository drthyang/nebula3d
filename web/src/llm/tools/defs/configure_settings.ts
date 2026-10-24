// configure_settings: the Configure page's settings, what the next run would
// use.

import { usePipelineStore } from "../../../state/pipelineStore";
import type { ChatTool } from "../types";

// Settings that only steer the Configure page's previews, not the run.
const UI_ONLY = /^punch(Slice|Cut)/;

export const configure_settings: ChatTool = {
  name: "configure_settings",
  facts: { label: "Read the run settings", acts: null, reachesBackend: false },
  description:
    "The Configure page's current settings — what the next run would use (blank = the backend default). They may differ from the settings that produced the files on disk. Name settings exactly as returned here when you suggest a change.",
  parameters: { type: "object", properties: {} },
  run: async () => {
    const s = usePipelineStore.getState() as unknown as Record<string, unknown>;
    const settings: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s)) {
      if (typeof v === "function" || UI_ONLY.test(k)) continue;
      if (["jobId", "running", "reconnecting", "events", "times", "terminal", "lastRun"].includes(k)) continue;
      settings[k] = v === "" ? "(default)" : v;
    }
    return { result: { settings }, summary: `${Object.keys(settings).length} settings` };
  },
};
