// A card's Edit (docs/pilot-auto-mode-design.md §1.3): the exact values the
// card would apply, one field each, for the user to change: a setting's one
// value, the modulation's four parts (k, order, form, half width), the |Q|
// band's two edges, a choice from its list where it has one. What the user
// leaves is applied as shown, and what they change is applied as typed, then
// checked by update_settings as any value is. Pure: a card in, the fields and
// the change they make out.

import { FLATTEN_IONS } from "../../state/flattenIons";
import type { PipelineConfig } from "../../state/pipelineStore";
import type { Proposal } from "./proposals";

export interface EditField {
  key: string; // the setting, by update_settings' name
  part?: "k" | "order" | "form" | "half_width"; // a part of the modulation
  label: string; // as the field is labelled: the key, or the part
  value: string; // as the card would apply it
  options?: readonly string[]; // a choice from these, where the setting has a list
}

const BOOLEAN = ["true", "false"] as const;
const CHOICES: Record<string, readonly string[]> = {
  edgeTrim: ["0", "1", "2", "3"],
  flattenIon: ["none", ...FLATTEN_IONS],
  symmetryAverageEnabled: BOOLEAN,
  symmetryReaverage: BOOLEAN,
  symmetryAllowMetricChange: BOOLEAN,
};

const MODULATION_PARTS = ["k", "order", "form", "half_width"] as const;
const MODULATION_DEFAULTS: Record<(typeof MODULATION_PARTS)[number], string> = { k: "", order: "1", form: "points", half_width: "0.08" };
const MODULATION_FIELD: Record<(typeof MODULATION_PARTS)[number], keyof PipelineConfig> = {
  k: "modulationK",
  order: "modulationOrder",
  form: "modulationForm",
  half_width: "modulationHalfWidth",
};

/**
 * The modulation a card declares, as one value update_settings takes: from
 * its canonical fields where the card has them (a card read back from a
 * session holds its declaration as text), else as the card holds it.
 */
export function modulationValue(p: Pick<Proposal, "change" | "fields">): unknown {
  const k = p.fields.modulationK;
  if (typeof k !== "string" || !k) return p.change.modulation;
  if (k === "none") return "none";
  const out: Record<string, string | number> = { k };
  for (const part of ["order", "form", "half_width"] as const) {
    const v = p.fields[MODULATION_FIELD[part]];
    if (typeof v === "string" && v) out[part] = part === "form" ? v : Number(v);
  }
  return out;
}

/** The changes a card applies as it stands: its own, the modulation from its fields. */
export function changeOf(p: Pick<Proposal, "change" | "fields">): Record<string, unknown> {
  return Object.fromEntries(Object.entries(p.change).map(([key, v]) => [key, key === "modulation" ? modulationValue(p) : v]));
}

/** The fields of a card's Edit, in the card's order; none for a run. */
export function editFields(p: Pick<Proposal, "kind" | "change" | "fields">): EditField[] {
  if (p.kind === "run" || p.kind === "trial") return [];
  const out: EditField[] = [];
  for (const [key, raw] of Object.entries(changeOf(p))) {
    if (key === "modulation") {
      const m = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : { k: typeof raw === "string" ? raw : "" };
      for (const part of MODULATION_PARTS) {
        const v = m[part];
        out.push({
          key,
          part,
          label: part,
          value: v === undefined || v === null || v === "" ? MODULATION_DEFAULTS[part] : String(v),
          ...(part === "form" ? { options: ["points", "planes"] } : {}),
        });
      }
      continue;
    }
    const value = raw === "" && key === "flattenIon" ? "none" : String(raw);
    out.push({ key, label: key, value, ...(CHOICES[key] ? { options: CHOICES[key] } : {}) });
  }
  return out;
}

// A value as typed, in the type the card's own had: a number stays a number where it reads as one.
const typed = (text: string, like: unknown): unknown => {
  const t = text.trim();
  if (typeof like === "boolean") return t === "true" ? true : t === "false" ? false : t;
  if (typeof like === "number") return t !== "" && Number.isFinite(Number(t)) ? Number(t) : t;
  return t;
};

/** The change the Edit's `values` (one per field, in editFields' order) make: the card's keys, each at its value as typed. */
export function editedChange(p: Pick<Proposal, "kind" | "change" | "fields">, values: readonly string[]): Record<string, unknown> {
  const fields = editFields(p);
  const own = changeOf(p);
  const out: Record<string, unknown> = {};
  fields.forEach((f, i) => {
    const text = values[i] ?? f.value;
    if (f.part) {
      const m = (out[f.key] as Record<string, unknown> | undefined) ?? {};
      const t = text.trim();
      if (f.part === "k") m.k = t;
      else if (t) m[f.part] = f.part === "form" ? t : Number.isFinite(Number(t)) ? Number(t) : t;
      out[f.key] = m;
      return;
    }
    out[f.key] = typed(text, own[f.key]);
  });
  // A modulation of none is "none" itself.
  if (out.modulation && typeof out.modulation === "object" && /^none$/i.test(String((out.modulation as Record<string, unknown>).k ?? ""))) out.modulation = "none";
  return out;
}
