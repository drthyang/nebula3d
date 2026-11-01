// configure_settings: the Configure page's settings, what the next run would
// use. A fact about the sample that the page holds in several fields (the
// sample's modulation: tune/catalog.ts, SampleParam) is one setting here, by
// the name update_settings takes, where its first field stands.

import { usePipelineStore } from "../../../state/pipelineStore";
import { SAMPLE_PARAMS } from "../../tune/catalog";
import type { ChatTool } from "../types";

// Settings that only steer the Configure page's previews, not the run.
const UI_ONLY = /^punch(Slice|Cut)/;

// A blank that is no default: the symmetry average's Laue class is the
// sample's, and none is chosen until the user chooses one.
const BLANK: Record<string, string> = { symmetryLaue: "(none chosen: the user's to set)", edgeTrim: "1 (default)" };

// The facts held in several fields, and those fields.
const COMPOSITE = SAMPLE_PARAMS.filter((p) => p.fields.length > 1);
const HELD = new Set<string>(COMPOSITE.flatMap((p) => p.fields));

export const configure_settings: ChatTool = {
  name: "configure_settings",
  facts: { label: "Read the run settings", acts: null, reachesBackend: false, measures: false },
  description:
    "The Configure page's current settings — what the next run would use (blank = the backend default). They may differ from the settings that produced the files on disk. Name settings exactly as returned here when you suggest a change.",
  parameters: { type: "object", properties: {} },
  run: async () => {
    const state = usePipelineStore.getState();
    const s = state as unknown as Record<string, unknown>;
    const settings: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s)) {
      if (typeof v === "function" || UI_ONLY.test(k)) continue;
      if (["jobId", "running", "reconnecting", "events", "times", "terminal", "lastRun"].includes(k)) continue;
      if (HELD.has(k)) {
        const p = COMPOSITE.find((q) => q.fields[0] === k);
        // Read as one: "default" (nothing it needs is set) shows as a blank field does.
        const value = p?.read(state);
        if (p) settings[p.key] = value === "default" ? "(default)" : value;
        continue;
      }
      settings[k] = v === "" ? (BLANK[k] ?? "(default)") : v;
    }
    return { result: { settings }, summary: `${Object.keys(settings).length} settings` };
  },
};
