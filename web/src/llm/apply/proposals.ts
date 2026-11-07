// The Apply cards' proposals (docs/pilot-auto-mode-design.md §1.1), built by
// the app from what a reply's tools already returned, and from the settings
// its answer names with a value: the model writes nothing for them, and reads
// nothing of them. Pure: the reply's steps (with their whole results), its
// answer, the Configure settings and the tuning run in, the proposals out.
//
//  - update_settings refused a change (a sample fact, the edge trim, a
//    symmetry* setting, a ring change the ring gate held): a card with the
//    call's own values, `held`: only the user's own click applies it, under a
//    click grant for exactly its values (llm/consent.ts), or, for a ring
//    change, a 3D verdict of a ring left (actions.ts).
//  - update_settings changed settings and no run followed: Run from its
//    rerun_from.
//  - a run's punch record found its sharp peaks off the lattice bunching
//    (off_lattice_bunching): the modulation its question names (held).
//  - compare_laue_classes suggested a class, qmax_coverage a |Q| band its
//    band_check flags: the user's (held).
//  - the answer names a setting by its exact key with a value no call set:
//    a setting card "suggested in the answer", checked by the catalog.
//  - a tuning run's trials: Apply on each trial row (TuneProgress).

import type { AgentStep } from "../agent";
import { found } from "../readings";
import { factsOf } from "../tools";
import { RING_SETTINGS } from "../tools/shared/ringGate";
import {
  displayValue,
  isSampleFact,
  isUserChoice,
  ProposalError,
  proposalToPatch,
  SAMPLE_PARAMS,
  SYMMETRY_AVERAGE_SETTINGS,
  toFormValue,
  TUNE_PARAMS,
  TUNE_STAGES,
  USER_CHOICE_PARAMS,
  type ParamValue,
  type RunStage,
  type TuneStage,
} from "../tune/catalog";
import type { StageRun } from "../tune/tuner";
import { USER_SETTINGS } from "../tune/userSettings";
import { settingLabel } from "../../pages/configSections";
import type { PipelineConfig } from "../../state/pipelineStore";

export type ProposalKind = "setting" | "fact" | "run" | "trial";
// "auto": a change or a run auto mode made (auto/controller.ts), logged as its own.
// "qr": no reply's; the Q–R page's "Use in pipeline" (qrBand.ts).
export type ProposalVia = "refused" | "rerun" | "ask_user" | "suggestion" | "answer" | "trial" | "apply" | "undo" | "auto" | "qr";
export type ProposalStatus = "open" | "applied" | "dismissed" | "undone";

/** Why a card needs the user's own click (a click grant) to apply: theirs to set (a fact, the edge trim, the symmetry average, the |Q| band, the ion), or held by the ring gate. */
export type Held = "fact" | "choice" | "symmetry" | "ring" | "user-only";

export interface Evidence {
  step: string; // the step's id
  n: number; // its number in the reply, from 1
  label: string; // the tool's label (tools/facts.ts)
  text: string; // the tool's own line (its summary)
}

export interface Proposal {
  id: string; // "P3"
  turn: number; // the reply it came from (chatStore turn id)
  kind: ProposalKind;
  title: string; // what it changes, as the card names it
  change: Record<string, ParamValue>; // as the model named it, or the tool returned it
  fields: Partial<PipelineConfig>; // canonical, from the catalog's write()
  from: Partial<PipelineConfig>; // the values when the card was made
  shown: { from: string; to: string }; // the change as the card reads
  runFrom?: RunStage; // the stage a run after it starts from (runStageFor)
  source: { step?: string; via: ProposalVia };
  evidence: Evidence[];
  dataset: string;
  status: ProposalStatus;
  held?: Held;
  trial?: { stage: TuneStage; n: number };
}

// --------------------------------------------------------------- settings

/** A setting the cards change: one of update_settings' (the catalog's method choices and thresholds, the sample's facts, the edge trim). */
interface CardSetting {
  key: string;
  stage: TuneStage | null; // null: the symmetry average's, which a whole run recomputes (no Run card)
  title: string;
  read: (s: PipelineConfig) => ParamValue;
  write: (value: unknown) => Partial<PipelineConfig>;
}

// A stage's word before a setting's label on a card: "Punch min σ" (the
// Configure page shows the label inside its stage's section).
const STAGE_WORD: Record<TuneStage, string> = { rings: "Ring", punch: "Punch", backfill: "Backfill", flatten: "Background", pdf: "ΔPDF" };
const lowerFirst = (s: string): string => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/** A method setting's name on a card: its stage's word and its Configure label (pages/configSections.ts). */
export const methodTitle = (key: string, stage: TuneStage): string => `${STAGE_WORD[stage]} ${lowerFirst(settingLabel(key))}`;

/** A fact's or a user-only setting's name on a card: its Configure label; the modulation, four fields there, as one. */
const factTitle = (key: string): string => (key === "modulation" ? "Modulation" : settingLabel(key));

// The same table update_settings checks its changes by (tools/defs/update_settings.ts, SETTABLE).
const SETTINGS: CardSetting[] = [
  ...TUNE_PARAMS.map((p): CardSetting => ({
    key: p.key,
    stage: p.stage,
    title: methodTitle(p.key, p.stage),
    read: (s) => displayValue(p, s[p.key]),
    write: (value) => ({ [p.key]: toFormValue(p.key, value, p.stage) }),
  })),
  ...[...SAMPLE_PARAMS, ...USER_CHOICE_PARAMS].map((p): CardSetting => ({
    key: p.key,
    stage: p.stage,
    title: factTitle(p.key),
    read: p.read,
    write: p.write,
  })),
];

// The settings only the user sets, which update_settings writes under a click
// grant alone (tune/userSettings.ts): a card reads and checks them the same way.
const USER_CARD_SETTINGS: CardSetting[] = USER_SETTINGS.map((u) => ({ key: u.key, stage: u.stage, title: factTitle(u.key), read: u.read, write: u.write }));

/** A setting the cards may change, by the name update_settings takes. */
export const cardSetting = (key: string): CardSetting | undefined => SETTINGS.find((s) => s.key === key) ?? USER_CARD_SETTINGS.find((s) => s.key === key);

/** The keys the answer parser reads: update_settings' names, exactly (none of the settings only the user sets). */
export const SETTING_KEYS: readonly string[] = SETTINGS.map((s) => s.key);

const isSymmetry = (key: string): boolean => (SYMMETRY_AVERAGE_SETTINGS as readonly string[]).includes(key);

// What the symmetry average reads: the raw input's edge trim, which the load
// takes before the average, and the average's own settings. With the average
// on, a change to one leaves its output stale (its record names the edge trim
// and the Laue class it was made with), and every output after it.
const AVERAGE_READS: ReadonlySet<string> = new Set(["edgeTrim", ...SYMMETRY_AVERAGE_SETTINGS]);

/**
 * The stage a run after a change to the settings `keys` starts from, with the
 * settings as they are after it (`s`): the earliest stage the change reaches.
 * The symmetry average, while it is on, for a change to what it reads
 * (AVERAGE_READS), as a whole run would recompute it; the ring removal for
 * switching the average off, which then reads the raw input; else `stage`,
 * the setting's own (the edge trim's is the ring removal), and none for a
 * setting of the average while it is off, which changes no output.
 */
export function runStageFor(keys: readonly string[], stage: RunStage | null | undefined, s: Pick<PipelineConfig, "symmetryAverageEnabled">): RunStage | undefined {
  if (keys.some((k) => AVERAGE_READS.has(k))) {
    if (s.symmetryAverageEnabled) return "symmetry_average";
    if (keys.includes("symmetryAverageEnabled")) return "rings";
  }
  return stage ?? undefined;
}
// The user-only settings update_settings has no write for, beside the symmetry average's.
const USER_ONLY = new Set(["flattenIon", "pdfQMin", "pdfQMax"]);

/** Why a card for `key` cannot be applied in this build, or undefined. */
export function heldFor(key: string): Held | undefined {
  if (isSampleFact(key)) return "fact";
  if (isUserChoice(key)) return "choice";
  if (isSymmetry(key)) return "symmetry";
  if (USER_ONLY.has(key)) return "user-only";
  return undefined;
}

const pick = (s: PipelineConfig, keys: readonly string[]): Partial<PipelineConfig> =>
  Object.fromEntries(keys.map((k) => [k, s[k as keyof PipelineConfig]])) as Partial<PipelineConfig>;

const sameFields = (a: Partial<PipelineConfig>, s: PipelineConfig): boolean =>
  Object.entries(a).every(([k, v]) => s[k as keyof PipelineConfig] === v);

// Whether the settings read the same with `fields` applied (a blank field reads as its default).
const readsSame = (keys: readonly string[], fields: Partial<PipelineConfig>, s: PipelineConfig): boolean => {
  const after = { ...s, ...fields } as PipelineConfig;
  return keys.every((k) => {
    const c = cardSetting(k);
    return !!c && text(c.read(s)) === text(c.read(after));
  });
};

const text = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));

// A setting's fields at `value`, checked by its write; null when the check fails.
const checked = (key: string, value: unknown): Partial<PipelineConfig> | null => {
  try {
    return cardSetting(key)?.write(value) ?? null;
  } catch (e) {
    if (e instanceof ProposalError) return null;
    throw e;
  }
};

// --------------------------------------------------------------- the builder

export interface BuildInput {
  turn: number;
  steps: readonly AgentStep[]; // the reply's steps, with their whole results
  answer: string; // the model's own words
  config: PipelineConfig; // the Configure settings as the reply ended
  dataset: string;
  tune?: readonly StageRun[]; // the tuning run, when the reply ran one
  firstId: number; // the number the first new proposal takes ("P<n>")
}

type Draft = Omit<Proposal, "id" | "turn" | "dataset" | "status">;

/** The proposals a reply leads to, in the order the reply met them; none twice. */
export function buildProposals(input: BuildInput): Proposal[] {
  const { steps, config } = input;
  const drafts: Draft[] = [];
  const done = steps.filter((s) => s.status === "done");
  const numberOf = (s: AgentStep): number => steps.indexOf(s) + 1;
  const evidenceOf = (s: AgentStep): Evidence => ({ step: s.id, n: numberOf(s), label: factsOf(s.name).label, text: s.summary ?? "" });

  // The latest measuring step before `at` that lights the stage, as the card's evidence.
  const measuredBefore = (at: AgentStep, stage: string): Evidence[] => {
    const i = steps.indexOf(at);
    for (let j = i - 1; j >= 0; j -= 1) {
      const s = steps[j];
      const f = factsOf(s.name);
      if (s.status === "done" && f.measures && f.highlights(s.args).includes(stage as never)) return [evidenceOf(s)];
    }
    return [];
  };

  // A card for one change a call asked for, checked by the catalog; none when it fails the check or changes nothing.
  const settingDraft = (key: string, value: unknown, via: ProposalVia, step: AgentStep | null): Draft | null => {
    const setting = cardSetting(key);
    if (!setting) return null;
    let fields: Partial<PipelineConfig>;
    try {
      fields = setting.write(value);
    } catch (e) {
      if (e instanceof ProposalError) return null;
      throw e;
    }
    const after = { ...config, ...fields } as PipelineConfig;
    // No change as the setting reads (a blank field is its default): no card.
    if (sameFields(fields, config) || text(setting.read(config)) === text(setting.read(after))) return null;
    const held = heldFor(key);
    const runFrom = runStageFor([key], setting.stage, after);
    return {
      kind: held ? "fact" : "setting",
      title: setting.title,
      change: { [key]: value as ParamValue },
      fields,
      from: pick(config, Object.keys(fields)),
      shown: { from: text(setting.read(config)), to: text(setting.read(after)) },
      ...(runFrom ? { runFrom } : {}),
      source: { ...(step ? { step: step.id } : {}), via },
      evidence: step && setting.stage ? measuredBefore(step, setting.stage) : [],
      ...(held ? { held } : RING_SETTINGS.includes(key) && via === "refused" ? { held: "ring" as const } : {}),
    };
  };

  const setByCall = new Set<string>();
  for (const s of steps) {
    if (s.name !== "update_settings") continue;
    const changes = s.args.changes;
    if (changes && typeof changes === "object" && !Array.isArray(changes)) for (const k of Object.keys(changes)) setByCall.add(k);
  }

  for (const s of steps) {
    // update_settings: its refusals, and a run its changes call for.
    if (s.name === "update_settings") {
      const changes = s.args.changes && typeof s.args.changes === "object" && !Array.isArray(s.args.changes) ? (s.args.changes as Record<string, unknown>) : {};
      const r = found(s);
      if (s.status === "done" && r) {
        const refused = Array.isArray(r.refused) ? (r.refused as { setting?: unknown }[]).map((x) => String(x.setting)) : [];
        for (const key of refused) {
          const d = settingDraft(key, changes[key], "refused", s);
          if (d) drafts.push(d);
        }
        const rerun = typeof r.rerun_from === "string" && (TUNE_STAGES as readonly string[]).includes(r.rerun_from) ? (r.rerun_from as TuneStage) : null;
        const changed = Array.isArray(r.changed) ? (r.changed as { setting?: unknown; from?: unknown; to?: unknown }[]) : [];
        const ranAfter = steps.slice(steps.indexOf(s) + 1).some((x) => x.name === "run_pipeline" && x.status === "done");
        // The run the changes call for: from their rerun_from, or before it the
        // symmetry average, when a change reaches what it reads (runStageFor).
        const runAt = rerun && runStageFor(changed.map((c) => String(c.setting)), rerun, config);
        if (runAt && changed.length && !ranAfter) {
          drafts.push(runDraft(runAt, changed.map((c) => `${cardSetting(String(c.setting))?.title ?? String(c.setting)} ${text(c.from)} → ${text(c.to)}`).join(", "), "rerun", s.id));
        }
      } else if (s.status === "error") {
        // Every change refused (the call fails then), or a key it cannot set at all.
        for (const [key, value] of Object.entries(changes)) {
          if (!heldFor(key) && !(RING_SETTINGS.includes(key) && /3D verdict/.test(s.result ?? s.summary ?? ""))) continue;
          const d = settingDraft(key, value, "refused", s);
          if (d) drafts.push(d);
        }
      }
      continue;
    }
    if (s.status !== "done") continue;
    const r = found(s);
    if (!r) continue;
    // The punch record's question: its sharp peaks off the lattice bunching at a fraction.
    const bunching = r.off_lattice_bunching as { facts?: unknown; ask_user?: unknown } | undefined;
    if (bunching && typeof bunching.ask_user === "string") {
      const k = /k = \(([^)]+)\)/.exec(bunching.ask_user)?.[1];
      if (k) {
        const d = settingDraft("modulation", { k, order: 1, form: "points" }, "ask_user", s);
        if (d) drafts.push({ ...d, evidence: [{ ...evidenceOf(s), text: bunching.ask_user.replace(/\s*Does the sample.*$/, "") }] });
      }
    }
    // The Laue class compare_laue_classes suggests.
    const laue = typeof r.suggestion === "string" && r.suggestion ? checked("symmetryLaue", r.suggestion) : null;
    if (s.name === "compare_laue_classes" && laue && !sameFields(laue, config)) {
      drafts.push({
        kind: "fact",
        title: settingLabel("symmetryLaue"),
        change: { symmetryLaue: r.suggestion as string },
        fields: laue,
        from: pick(config, ["symmetryLaue"]),
        shown: { from: config.symmetryLaue || "none", to: r.suggestion as string },
        source: { step: s.id, via: "suggestion" },
        evidence: [evidenceOf(s)],
        held: "symmetry",
      });
    }
    // The |Q| band qmax_coverage suggests, when its band check flags the band in use.
    const band = r.suggested_band;
    if (s.name === "qmax_coverage" && Array.isArray(band) && band.length === 2 && band.every((x) => typeof x === "number") && typeof r.band_check === "string" && !/stays inside the counts/.test(r.band_check)) {
      const [lo, hi] = band as number[];
      const min = checked("pdfQMin", lo);
      const max = checked("pdfQMax", hi);
      const fields = min && max && lo < hi ? { ...min, ...max } : null;
      if (fields && !sameFields(fields, config)) {
        drafts.push({
          kind: "fact",
          title: "|Q| band",
          change: { pdfQMin: lo, pdfQMax: hi },
          fields,
          from: pick(config, ["pdfQMin", "pdfQMax"]),
          shown: { from: config.pdfQMax ? `${config.pdfQMin || "0"}–${config.pdfQMax} Å⁻¹` : "full", to: `${lo}–${hi} Å⁻¹` },
          runFrom: "pdf",
          source: { step: s.id, via: "suggestion" },
          evidence: [evidenceOf(s)],
          held: "user-only",
        });
      }
    }
  }

  // The settings the answer names with a value that no call set.
  const named = new Set<string>();
  for (const { key, value } of settingsInAnswer(input.answer)) {
    if (setByCall.has(key) || named.has(key)) continue;
    const d = settingDraft(key, value, "answer", null);
    if (d) {
      drafts.push(d);
      named.add(key);
    }
  }

  // A tuning run's trials: each one that ran, but the one it kept.
  if (done.some((s) => s.name === "tune_pipeline")) {
    for (const run of input.tune ?? []) {
      if (!run.tuned) continue;
      for (const t of run.trials) {
        if (t.status !== "done" || t.n === run.best) continue;
        let fields: Partial<PipelineConfig>;
        try {
          fields = proposalToPatch(run.stage, t.settings);
        } catch {
          continue;
        }
        if (sameFields(fields, config) || readsSame(Object.keys(t.settings), fields, config)) continue;
        const changed = Object.entries(t.n === 1 ? t.settings : t.changes);
        drafts.push({
          kind: "trial",
          title: `Trial #${t.n}`,
          change: { ...t.settings },
          fields,
          from: pick(config, Object.keys(fields)),
          shown: { from: "", to: t.n === 1 ? "your settings" : changed.map(([k, v]) => `${k}=${String(v)}`).join(", ") },
          runFrom: run.stage,
          source: { via: "trial" },
          evidence: [],
          trial: { stage: run.stage, n: t.n },
        });
      }
    }
  }

  // None twice: the first of the same change.
  const seen = new Set<string>();
  const kept = drafts.filter((d) => {
    const key = `${d.kind}|${d.trial ? `${d.trial.stage}#${d.trial.n}` : ""}|${d.kind === "run" ? d.runFrom : JSON.stringify(d.fields) + JSON.stringify(d.change)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return kept.map((d, i) => ({ ...d, id: `P${input.firstId + i}`, turn: input.turn, dataset: input.dataset, status: "open" as const }));
}

/** A Run card: run from `stage`, the outputs predating `because`. */
export function runDraft(stage: RunStage, because: string, via: ProposalVia, step?: string): Draft {
  return {
    kind: "run",
    title: `Run from ${STAGE_TITLE[stage]}`,
    change: {},
    fields: {},
    from: {},
    shown: { from: "", to: because },
    runFrom: stage,
    source: { ...(step ? { step } : {}), via },
    evidence: [],
  };
}

/** A Run card as a whole proposal, for one made after a decision (Apply, Undo). */
export function runProposal(id: string, turn: number, dataset: string, stage: RunStage, because: string, via: ProposalVia): Proposal {
  return { ...runDraft(stage, because, via), id, turn, dataset, status: "open" };
}

// The stages as the console names them (TUNE_STAGE_TITLES' words, here without the model's).
const STAGE_TITLE: Record<RunStage, string> = {
  symmetry_average: "Symmetry average",
  rings: "Ring removal",
  punch: "Bragg punch",
  backfill: "Backfill",
  flatten: "Background correction",
  pdf: "3D-ΔPDF",
};
export const stageTitle = (stage: RunStage): string => STAGE_TITLE[stage];

// --------------------------------------------------------------- the answer

// A value as an answer writes it: a number, true/false, or an enum's name.
const VALUE = String.raw`(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|[A-Za-z_][\w-]*)`;
const Q = "[`*_]*"; // code and emphasis marks around a name or value
const SEP = String.raw`\s*(?:=|:|\bto\b|\bfrom\b|\bof\b|\bat\b)?\s*`;
const ARROW = String.raw`\s*(?:→|->|\bto\b)\s*`;

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The settings an answer names by their exact key (update_settings' names)
 * with a value: "punchMinSig 6", "set `punchMinSig` to 6", "punchMinSig: 8 → 6"
 * (the value after the arrow). Every mention, in order: the catalog checks
 * each value afterwards, and the first that passes is the card
 * (buildProposals); here only the words are read.
 */
export function settingsInAnswer(answer: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  if (!answer) return out;
  for (const key of SETTING_KEYS) {
    if (key === "modulation") continue; // a declaration, never one word
    const re = new RegExp(String.raw`(?<![\w.])` + Q + escape(key) + Q + String.raw`(?![\w])` + SEP + Q + VALUE + Q + `(?:${ARROW}${Q}${VALUE}${Q})?`, "g");
    for (const m of answer.matchAll(re)) {
      const value = m[2] ?? m[1];
      if (!value) continue;
      out.push({ key, value });
    }
  }
  return out;
}
