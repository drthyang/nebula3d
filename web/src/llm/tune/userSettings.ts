// The settings only the user sets that update_settings has no write for: the
// symmetry average's (the sample's Laue class above all), the |Q| band of the
// ΔPDF's transform, and the magnetic ion of the background model. The model
// never sets them: update_settings refuses the symmetry average's by name
// (catalog.ts, SYMMETRY_AVERAGE_SETTINGS) and lists neither of the others
// among what it sets. Besides the Configure page, the one way a change
// reaches them is an Apply card's click grant (llm/consent.ts), through
// update_settings' own checked patch: each has its checked write here, in the
// form the Configure page writes (a Laue class as its preset's name or its
// generators, a band edge as the slider writes it, an ion of the page's
// list), so the run reads it as it reads the page's. Nothing here is
// model-visible: no description, refusal or result the model reads names it.

import { FLATTEN_IONS } from "../../state/flattenIons";
import { laueGroup, presetNamed } from "../../state/laue";
import { pdfQEdge } from "../../state/pdfBand";
import type { PipelineConfig } from "../../state/pipelineStore";
import { ProposalError, type ParamValue, type TuneStage } from "./catalog";

type Key = keyof PipelineConfig;

/** A setting only the user sets: read and written as update_settings' own (its Settable). */
export interface UserSetting {
  key: string;
  // The stage a run from recomputes it; null for the symmetry average's, which
  // comes before every stage a run starts from (a whole run recomputes it).
  stage: TuneStage | null;
  fields: readonly Key[];
  read: (s: PipelineConfig) => ParamValue;
  write: (value: unknown) => Partial<PipelineConfig>; // checked (ProposalError)
}

const TRUE = /^(?:true|on|yes)$/i;
const FALSE = /^(?:false|off|no)$/i;

const switchSetting = (key: "symmetryAverageEnabled" | "symmetryReaverage" | "symmetryAllowMetricChange"): UserSetting => ({
  key,
  stage: null,
  fields: [key],
  read: (s) => Boolean(s[key]),
  write: (value) => {
    if (typeof value === "boolean") return { [key]: value };
    if (typeof value === "string" && TRUE.test(value.trim())) return { [key]: true };
    if (typeof value === "string" && FALSE.test(value.trim())) return { [key]: false };
    throw new ProposalError(`${key} is true or false, not ${JSON.stringify(value)}`);
  },
});

/** The sample's Laue class, as the Configure page holds it: a preset's name, or generators; blank, none chosen. */
const LAUE: UserSetting = {
  key: "symmetryLaue",
  stage: null,
  fields: ["symmetryLaue"],
  read: (s) => s.symmetryLaue.trim() || "none",
  write: (value) => {
    if (typeof value !== "string") throw new ProposalError(`symmetryLaue is a Laue class, such as 6/mmm, or generators; not ${JSON.stringify(value)}`);
    const text = value.trim();
    if (!text) return { symmetryLaue: "" };
    let ops: number;
    try {
      ops = laueGroup(text).ops.length;
    } catch (e) {
      throw new ProposalError((e as Error).message.replace(/\.$/, ""));
    }
    if (ops < 2) throw new ProposalError("the identity alone averages nothing: choose the sample's Laue class");
    return { symmetryLaue: presetNamed(text)?.[0] ?? text };
  },
};

const edge = (key: "pdfQMin" | "pdfQMax"): UserSetting => ({
  key,
  stage: "pdf",
  fields: [key],
  read: (s) => (s[key] ? Number(s[key]) : key === "pdfQMin" ? 0 : "full"),
  write: (value) => {
    const q = typeof value === "string" ? Number(value.trim()) : typeof value === "number" ? value : NaN;
    const floor = key === "pdfQMin" ? 0 : Number.MIN_VALUE;
    if (!Number.isFinite(q) || q < floor || q > 100 || (typeof value === "string" && !value.trim())) {
      throw new ProposalError(`${key} is |Q| in Å⁻¹, ${key === "pdfQMin" ? "0 or above" : "above 0"}; not ${JSON.stringify(value)}`);
    }
    return { [key]: pdfQEdge(q) };
  },
});

/** The background model's magnetic ion: one of the Configure page's, or none. */
const ION: UserSetting = {
  key: "flattenIon",
  stage: "flatten",
  fields: ["flattenIon"],
  read: (s) => s.flattenIon || "none",
  write: (value) => {
    const text = typeof value === "string" ? value.trim() : "";
    if (typeof value === "string" && (!text || /^none$/i.test(text))) return { flattenIon: "" };
    const ion = FLATTEN_IONS.find((x) => x.toLowerCase() === text.toLowerCase());
    if (!ion) throw new ProposalError(`flattenIon is one of ${FLATTEN_IONS.join(", ")}, or none; not ${JSON.stringify(value)}`);
    return { flattenIon: ion };
  },
};

export const USER_SETTINGS: readonly UserSetting[] = [
  switchSetting("symmetryAverageEnabled"),
  LAUE,
  switchSetting("symmetryReaverage"),
  switchSetting("symmetryAllowMetricChange"),
  edge("pdfQMin"),
  edge("pdfQMax"),
  ION,
];

/** A setting only the user sets, by its key, or undefined. */
export const userSetting = (key: string): UserSetting | undefined => USER_SETTINGS.find((u) => u.key === key);

/**
 * What the settings only the user sets must hold together, once a change is
 * made (the |Q| band's low edge below its high one), or throws ProposalError.
 */
export function checkUserSettings(s: PipelineConfig): void {
  if (s.pdfQMax && Number(s.pdfQMin || 0) >= Number(s.pdfQMax)) {
    throw new ProposalError(`the |Q| band needs pdfQMin below pdfQMax, not ${s.pdfQMin || 0} to ${s.pdfQMax}`);
  }
}
