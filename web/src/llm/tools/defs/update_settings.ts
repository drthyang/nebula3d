// update_settings: changes settings on the Configure page, for the next run. It
// acts, and waits for the skill of each stage it changes (its facts' gate). A
// fact about the sample changes only when the user's latest message names it
// (tune/catalog.ts: namesSampleFact): a change to one it does not name is
// refused, and the rest of the call runs.

import { usePipelineStore, type PipelineConfig } from "../../../state/pipelineStore";
import {
  displayValue,
  isSampleFact,
  namesSampleFact,
  SAMPLE_PARAMS,
  sampleFactRefusal,
  toFormValue,
  TUNE_PARAMS,
  TUNE_STAGES,
  type TuneParam,
} from "../../tune/catalog";
import { keysOf } from "../facts";
import { checkIdle, unique } from "../shared/pipeline";
import { ToolArgError, type ChatTool } from "../types";

const SETTABLE = [...TUNE_PARAMS, ...SAMPLE_PARAMS];
const findParam = (key: string): TuneParam | undefined => SETTABLE.find((p) => p.key === key);

// The stage of each setting, for the skill gate (skills.ts).
const SETTING_STAGE = new Map([...TUNE_PARAMS, ...SAMPLE_PARAMS].map((p) => [p.key as string, p.stage]));

const allowedValues = (p: TuneParam): string =>
  p.kind === "enum"
    ? p.options!.map((o) => o.name).join("|")
    : p.kind === "boolean"
      ? "true|false"
      : p.kind === "fractions"
        ? 'H fractions like "1/3, 2/3", or none'
        : `${p.kind} ${p.min}–${p.max}`;

export const update_settings: ChatTool = {
  name: "update_settings",
  facts: {
    label: "Changed settings",
    acts: "settings",
    reachesBackend: false,
    invalidates: ["settings"],
    // The stages of the method choices and thresholds it changes.
    highlights: (args) => {
      const changes = args.changes && typeof args.changes === "object" ? Object.keys(args.changes) : [];
      return keysOf(changes.map((key) => TUNE_PARAMS.find((p) => p.key === key)?.stage));
    },
    // The stages of the settings it changes, the sample's facts included.
    gate: {
      doing: "change",
      stages: (args) => {
        const changes = args.changes;
        if (!changes || typeof changes !== "object" || Array.isArray(changes)) return [];
        return unique(Object.keys(changes).flatMap((k) => (SETTING_STAGE.has(k) ? [SETTING_STAGE.get(k)!] : [])));
      },
    },
  },
  description:
    "Change settings on the Configure page; the next run_pipeline uses them and the user sees the fields change. " +
    `These method choices and thresholds can be changed: ${TUNE_PARAMS.map((p) => `${p.key} (${allowedValues(p)})`).join(", ")}. ` +
    `These facts about the sample only when the user asks for that change, never to improve a result: ${SAMPLE_PARAMS.map((p) => `${p.key} (${allowedValues(p)}; ${p.help})`).join(" ")} ` +
    "A change to one of them is refused unless the user's latest message names it. " +
    "The magnetic ion and |Q| band stay with the user. " +
    "Change them when the user asks for a change, or asks you to improve or tune the result, and only the settings " +
    "the user named or agreed to; when unsure which setting the user means, ask instead of guessing. Settings " +
    "already at the value are left as they are. Returns each change and the stage to rerun from.",
  parameters: {
    type: "object",
    properties: {
      changes: { type: "object", description: 'Setting → new value, e.g. {"punchMinSig": 6}' },
    },
    required: ["changes"],
  },
  run: async (args, ctx) => {
    checkIdle();
    const changes = args.changes;
    if (!changes || typeof changes !== "object" || Array.isArray(changes) || !Object.keys(changes).length) {
      throw new ToolArgError("changes must be an object of setting → value");
    }
    for (const key of Object.keys(changes)) {
      if (!findParam(key)) throw new ToolArgError(`${key} cannot be changed; these can: ${SETTABLE.map((q) => q.key).join(", ")}`);
    }
    // A fact about the sample the user's latest message does not name is
    // refused, whatever its value; the other changes go ahead. A call whose
    // every change is refused fails, so the model reads the refusal as one.
    const refused = Object.keys(changes).filter((key) => isSampleFact(key) && !namesSampleFact(ctx.userMessage ?? "", key));
    const asked = Object.entries(changes).filter(([key]) => !refused.includes(key));
    if (!asked.length) throw new Error(refused.map(sampleFactRefusal).join(" "));
    const patch: Record<string, string | boolean> = {};
    for (const [key, value] of asked) {
      try {
        patch[key] = toFormValue(key, value, findParam(key)!.stage, { sample: true });
      } catch (e) {
        throw new ToolArgError((e as Error).message);
      }
    }
    const before = usePipelineStore.getState();
    // A setting already at the value is no change: leave it out of the patch.
    const unchanged = Object.keys(patch).filter((key) => before[key as keyof PipelineConfig] === patch[key]);
    for (const key of unchanged) delete patch[key];
    before.patch(patch as Partial<PipelineConfig>);
    const after = usePipelineStore.getState();
    const changed = Object.keys(patch).map((key) => {
      const p = findParam(key)!;
      return {
        setting: key,
        from: displayValue(p, before[p.key]),
        to: displayValue(p, after[p.key]),
        ...(p.appliesWhen && !p.appliesWhen(after) ? { note: "no effect with the current model" } : {}),
      };
    });
    const rerunFrom = TUNE_STAGES.find((st) => changed.some((c) => findParam(c.setting)!.stage === st));
    const done = changed.length
      ? changed.map((c) => `${c.setting} ${c.from} → ${c.to}`).join(", ")
      : `no change: ${unchanged.join(", ")} already set`;
    return {
      result: {
        changed,
        ...(unchanged.length ? { already_set: unchanged } : {}),
        ...(refused.length ? { refused: refused.map((key) => ({ setting: key, why: sampleFactRefusal(key) })) } : {}),
        rerun_from: rerunFrom ?? null,
      },
      summary: refused.length ? `${done}; refused, a fact about the sample: ${refused.join(", ")}` : done,
    };
  },
};
