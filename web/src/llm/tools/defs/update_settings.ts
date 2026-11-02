// update_settings: changes settings on the Configure page, for the next run. It
// acts, and waits for the skill of each stage it changes (its facts' gate). A
// fact about the sample changes only when the user's latest message names it
// (tune/catalog.ts: namesSampleFact): a change to one it does not name is
// refused, and the rest of the call runs. A fact may hold more than one of the
// page's fields (the sample's modulation holds four): the model reads and
// writes it as one setting (SampleParam). The symmetry average's settings, the
// sample's Laue class above all, it never changes: it refuses them, and the
// model suggests a class to the user instead (SYMMETRY_AVERAGE_SETTINGS). The
// raw edge trim, a data choice no fact about the sample, changes the same way a
// fact does: only when the user's latest message names it (USER_CHOICE_PARAMS).

import { noteAgentEdit } from "../../../state/agentEdits";
import { usePipelineStore, type PipelineConfig } from "../../../state/pipelineStore";
import {
  allowedValues,
  displayValue,
  isSampleFact,
  isUserChoice,
  namesSampleFact,
  namesUserChoice,
  SAMPLE_PARAMS,
  sampleFactRefusal,
  SYMMETRY_AVERAGE_SETTINGS,
  symmetryAverageRefusal,
  toFormValue,
  TUNE_PARAMS,
  TUNE_STAGES,
  USER_CHOICE_PARAMS,
  userChoiceRefusal,
  type ParamValue,
  type TuneStage,
} from "../../tune/catalog";
import { keysOf } from "../facts";
import { checkIdle, unique } from "../shared/pipeline";
import { ToolArgError, type ChatTool } from "../types";

/** A setting update_settings changes: a method choice or threshold of the catalog, or a fact about the sample. */
interface Settable {
  key: string;
  stage: TuneStage;
  fields: readonly (keyof PipelineConfig)[];
  read: (s: PipelineConfig) => ParamValue;
  write: (value: unknown) => Partial<PipelineConfig>;
  appliesWhen?: (s: PipelineConfig) => boolean;
}

const SETTABLE: Settable[] = [
  ...TUNE_PARAMS.map(
    (p): Settable => ({
      key: p.key,
      stage: p.stage,
      fields: [p.key],
      read: (s) => displayValue(p, s[p.key]),
      write: (value) => ({ [p.key]: toFormValue(p.key, value, p.stage) }),
      appliesWhen: p.appliesWhen,
    }),
  ),
  ...SAMPLE_PARAMS,
  ...USER_CHOICE_PARAMS,
];
const findSettable = (key: string): Settable | undefined => SETTABLE.find((p) => p.key === key);
const userSets = (key: string): boolean => (SYMMETRY_AVERAGE_SETTINGS as readonly string[]).includes(key);

// The stage of each setting, for the skill gate (skills.ts).
const SETTING_STAGE = new Map(SETTABLE.map((p) => [p.key, p.stage]));

// What update_settings does and when (THY-63 R2: a contract of at most 500
// characters, the lint's cap), and the catalogue of what it changes, the
// model's one source of the settings' names, values and ranges, beside it.
const CONTRACT =
  "Change settings on the Configure page for the next run_pipeline: only those the user named or agreed to, when they " +
  "ask for a change or to improve or tune the result; when unsure which they mean, ask. A fact about the sample changes " +
  "only when the user's latest message names it, never to improve a result. The magnetic ion, the |Q| band and the " +
  "symmetry average (the symmetry* settings) stay with the user: suggest a Laue class with your evidence. " +
  "Returns each change and the stage to rerun from.";

// A fact about the sample in a few words: its catalog help is the Configure page's.
const BRIEF: Record<string, string> = {
  modulation: 'satellites G ± m·k left alone (form points) or the planes through them (planes); order m 1–6; several k by ";"',
  punchSupercellH: "the punch's indexing cell along H: 2 on a doubled cell, the nodes between not punched",
  punchSupercellK: "along K",
  punchSupercellL: "along L",
  edgeTrim: "voxel layers off the raw coverage edge at load, default 1",
};
const brief = (p: { key: string; allowed: string; help: string }): string => `${p.key} (${p.allowed}; ${BRIEF[p.key] ?? p.help})`;

/** The settings update_settings changes: the method choices and thresholds, then the facts about the sample. */
const CATALOGUE =
  `Method choices and thresholds: ${TUNE_PARAMS.map((p) => `${p.key} (${allowedValues(p)})`).join(", ")}. ` +
  `Facts about the sample: ${[...SAMPLE_PARAMS, ...USER_CHOICE_PARAMS].map(brief).join(", ")}.`;

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
  description: `${CONTRACT}\n${CATALOGUE}`,
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
      if (!findSettable(key) && !userSets(key)) throw new ToolArgError(`${key} cannot be changed; these can: ${SETTABLE.map((q) => q.key).join(", ")}`);
    }
    // A fact about the sample the user's latest message does not name is
    // refused, whatever its value, and the symmetry average's settings always;
    // the other changes go ahead. A call whose every change is refused fails,
    // so the model reads the refusal as one.
    const message = ctx.userMessage ?? "";
    const refused = Object.keys(changes).filter(
      (key) => userSets(key) || (isSampleFact(key) && !namesSampleFact(message, key)) || (isUserChoice(key) && !namesUserChoice(message, key)),
    );
    const why = (key: string): string => (userSets(key) ? symmetryAverageRefusal(key) : isUserChoice(key) ? userChoiceRefusal(key) : sampleFactRefusal(key));
    const asked = Object.entries(changes).filter(([key]) => !refused.includes(key));
    if (!asked.length) throw new Error(refused.map(why).join(" "));
    // Each setting's fields as the change asks for them, checked.
    const wanted = new Map<string, Partial<PipelineConfig>>();
    for (const [key, value] of asked) {
      try {
        wanted.set(key, findSettable(key)!.write(value));
      } catch (e) {
        throw new ToolArgError((e as Error).message);
      }
    }
    const before = usePipelineStore.getState();
    // A setting already at the value, every field of it, is no change: leave it out of the patch.
    const unchanged = [...wanted.keys()].filter((key) => {
      const fields = wanted.get(key)!;
      return (Object.keys(fields) as (keyof PipelineConfig)[]).every((f) => before[f] === fields[f]);
    });
    const patch = Object.assign({}, ...[...wanted].filter(([key]) => !unchanged.includes(key)).map(([, fields]) => fields)) as Partial<PipelineConfig>;
    before.patch(patch);
    // The page shows the fields the agent changed (state/agentEdits.ts): UI only.
    noteAgentEdit(Object.keys(patch) as (keyof PipelineConfig)[]);
    const after = usePipelineStore.getState();
    const changed = [...wanted.keys()]
      .filter((key) => !unchanged.includes(key))
      .map((key) => {
        const p = findSettable(key)!;
        return {
          setting: key,
          from: p.read(before),
          to: p.read(after),
          ...(p.appliesWhen && !p.appliesWhen(after) ? { note: "no effect with the current model" } : {}),
        };
      });
    const rerunFrom = TUNE_STAGES.find((st) => changed.some((c) => findSettable(c.setting)!.stage === st));
    const done = changed.length
      ? changed.map((c) => `${c.setting} ${c.from} → ${c.to}`).join(", ")
      : `no change: ${unchanged.join(", ")} already set`;
    return {
      result: {
        changed,
        ...(unchanged.length ? { already_set: unchanged } : {}),
        ...(refused.length ? { refused: refused.map((key) => ({ setting: key, why: why(key) })) } : {}),
        rerun_from: rerunFrom ?? null,
      },
      summary: refused.length
        ? [
            done,
            ...(refused.some((k) => isSampleFact(k)) ? [`refused, a fact about the sample: ${refused.filter((k) => isSampleFact(k)).join(", ")}`] : []),
            ...(refused.some((k) => isUserChoice(k)) ? [`refused, the user's to choose: ${refused.filter((k) => isUserChoice(k)).join(", ")}`] : []),
            ...(refused.some(userSets) ? [`refused, the user's to set: ${refused.filter(userSets).join(", ")}`] : []),
          ].join("; ")
        : done,
    };
  },
};
