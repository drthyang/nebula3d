// The sample's modulation as the Configure page holds it: four raw fields
// (modulationK, modulationOrder, modulationForm, modulationHalfWidth), what a
// run's request carries for them (`modulation`), how NEBULA Pilot reads and
// writes them as one setting, and the one-time migration of the protected H
// planes the page held before declarations (punchProtectH and
// punchProtectHalfWidth).
//
// What a declaration protects is the backend's to say (nebula3d.modulation,
// docs/modulation.md): nothing here computes a position, and a run's marks
// come from its own record (GET /api/modulation/{id}/labels). A declaration's
// syntax is checked as Modulation.parse reads it, so a malformed one is
// refused before a run; POST /api/modulation/check says what one protects.

import type { StageParamsIn } from "../api/types";

/** The store's fields of a declaration, as raw strings (blank: the default, none). */
export const MODULATION_FIELDS = ["modulationK", "modulationOrder", "modulationForm", "modulationHalfWidth"] as const;
export type ModulationField = (typeof MODULATION_FIELDS)[number];
export type ModulationFields = Record<ModulationField, string>;

/**
 * A blank field's value, as the package's Modulation holds it
 * (nebula3d.modulation: order 1, form "points", HALF_WIDTH 0.08 r.l.u.;
 * sharedLimits.replay.test.ts pins the three). A blank k is no field of the
 * declaration: it leaves the run to the backend's default, which declares
 * none (nebula3d.pipeline.default_modulation; plan 4.15, P3).
 */
export const MODULATION_DEFAULTS = { order: 1, form: "points", halfWidth: 0.08 } as const;
/** The highest order a declaration may name (nebula3d.modulation.MAX_ORDER). */
export const MAX_ORDER = 6;
export const FORMS = ["points", "planes"] as const;

/** Every field blank: the backend's default, which declares none. */
export const BLANK_MODULATION: ModulationFields = { modulationK: "", modulationOrder: "", modulationForm: "", modulationHalfWidth: "" };

const NONE = /^(none|off)$/i;
/** A k component as Modulation.parse reads one: an integer, a fraction p/q, or a decimal. */
const COMPONENT = /^[-+−]?(?:\d+\/[-+−]?\d+|(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)$/i;

/** Whether k declares no modulation ("none", "off"). */
export const declaresNone = (k: string): boolean => NONE.test(k.trim());

const componentValue = (c: string): number => {
  const t = c.replace("−", "-");
  if (!t.includes("/")) return Number(t);
  const [num, den] = t.split("/").map(Number);
  return num / den;
};

/**
 * The k vectors of a declaration's text, as Modulation.parse splits them: at
 * ";", each stripped of brackets and split at commas or spaces into three
 * components. Null when one is malformed, a denominator is 0, or a vector is
 * all zero ("k = (0, 0, 0) is no modulation").
 */
export function kVectors(text: string): string[][] | null {
  const vectors = text
    .split(";")
    .map((part) => part.trim().replace(/^[()[\]⟨⟩\s]+|[()[\]⟨⟩\s]+$/g, ""))
    .filter(Boolean)
    .map((t) => t.split(/[\s,]+/).filter(Boolean));
  if (!vectors.length) return null;
  for (const v of vectors) {
    if (v.length !== 3 || !v.every((c) => COMPONENT.test(c))) return null;
    const values = v.map(componentValue);
    if (!values.every(Number.isFinite) || values.every((x) => x === 0)) return null;
  }
  return vectors;
}

/**
 * What a run's request carries for the fields (StageParamsIn.modulation): a
 * blank k carries nothing (the backend's default, none), "none" declares none, and
 * a declaration its fields as typed, blank ones left out. The backend reads
 * the strings (Modulation.parse) and refuses a malformed one, saying why.
 */
export function modulationRequest(f: ModulationFields): StageParamsIn["modulation"] {
  const k = f.modulationK.trim();
  if (!k) return undefined;
  if (declaresNone(k)) return "none";
  const out: Record<string, string> = { k };
  const order = f.modulationOrder.trim();
  const form = f.modulationForm.trim().toLowerCase();
  const half = f.modulationHalfWidth.trim();
  if (order) out.order = order;
  if (form) out.form = form;
  if (half) out.half_width = half;
  return out;
}

/**
 * The declaration in one line, as the Pilot reads it and the report shows it:
 * "default" (a blank k: the backend's own, which declares none), "none", or
 * "k = (1/3, 0, 0), order 1, planes, ± 0.08 r.l.u.", a blank field as its
 * default. update_settings reads this form back (modulationFieldsOf).
 */
export function modulationText(f: ModulationFields): string {
  const k = f.modulationK.trim();
  if (!k) return "default";
  if (declaresNone(k)) return "none";
  const vectors = kVectors(k);
  const ks = vectors ? vectors.map((v) => `(${v.join(", ")})`).join(" and ") : k;
  const order = f.modulationOrder.trim() || String(MODULATION_DEFAULTS.order);
  const form = f.modulationForm.trim().toLowerCase() || MODULATION_DEFAULTS.form;
  const half = f.modulationHalfWidth.trim() || String(MODULATION_DEFAULTS.halfWidth);
  return `k = ${ks}, order ${order}, ${form}, ± ${half} r.l.u.`;
}

/** Why a value is no declaration, as the model reads it back. */
export class DeclarationError extends Error {}

const K_HELP = 'k is one or more vectors of three components in r.l.u., such as "1/3, 0, 0" (several separated by ;)';

function checkedK(text: string): string {
  const vectors = kVectors(text);
  if (!vectors) throw new DeclarationError(`modulation: ${K_HELP}; got ${JSON.stringify(text)}`);
  return vectors.map((v) => v.join(", ")).join("; ");
}

function checkedOrder(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  const n = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > MAX_ORDER) {
    throw new DeclarationError(`modulation: order is a whole number from 1 to ${MAX_ORDER}; got ${JSON.stringify(value)}`);
  }
  return String(n);
}

function checkedForm(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  const form = String(value).trim().toLowerCase();
  if (!(FORMS as readonly string[]).includes(form)) throw new DeclarationError(`modulation: form is points or planes; got ${JSON.stringify(value)}`);
  return form;
}

function checkedHalfWidth(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  const n = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || !(n > 0 && n < 0.5)) {
    throw new DeclarationError(`modulation: half_width is above 0 and below 0.5 r.l.u.; got ${JSON.stringify(value)}`);
  }
  return String(n);
}

/** k given as text, as one vector of three components, or as a list of vectors. */
function kText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const vectors = value.length === 3 && !value.some(Array.isArray) ? [value] : value;
    return vectors.map((v) => (Array.isArray(v) ? v.map(String).join(", ") : String(v))).join("; ");
  }
  throw new DeclarationError(`modulation: ${K_HELP}`);
}

/** The declaration modulationText writes ("k = (1/3, 0, 0), order 1, planes, ± 0.08 r.l.u."), read back. */
function fromText(text: string): ModulationFields {
  const vectors = [...text.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
  if (!vectors.length) throw new DeclarationError(`modulation: ${K_HELP}; got ${JSON.stringify(text)}`);
  const rest = text.replace(/\(([^)]*)\)/g, " ");
  return {
    modulationK: checkedK(vectors.join("; ")),
    modulationOrder: checkedOrder(/\border\s*[=:]?\s*(\S+?)(?:,|$|\s)/i.exec(rest)?.[1]),
    modulationForm: checkedForm(/\b(points|planes)\b/i.exec(rest)?.[1]),
    modulationHalfWidth: checkedHalfWidth(/(?:±|half[ _-]?width\s*[=:]?)\s*([0-9.eE+-]+)/i.exec(rest)?.[1]),
  };
}

/**
 * The fields a value the Pilot proposes declares, or throws DeclarationError
 * saying what is wrong:
 * - "default" (or blank): the backend's default, which declares none;
 * - "none" (or "off"): none;
 * - k alone, as text ("1/3, 0, 0", several separated by ;) or as numbers
 *   ([1/3, 0, 0]): in the default form, as Modulation.parse reads it;
 * - {"k", "order", "form", "half_width"}, k required, the rest blank by default;
 * - the line modulationText writes.
 */
export function modulationFieldsOf(value: unknown): ModulationFields {
  if (value === undefined || value === null) return BLANK_MODULATION;
  if (typeof value === "string") {
    const t = value.trim();
    if (!t || /^default$/i.test(t)) return BLANK_MODULATION;
    if (declaresNone(t)) return { ...BLANK_MODULATION, modulationK: "none" };
    if (/^k\s*=/i.test(t)) return fromText(t.replace(/^k\s*=\s*/i, ""));
    return { ...BLANK_MODULATION, modulationK: checkedK(t) };
  }
  if (Array.isArray(value)) return { ...BLANK_MODULATION, modulationK: checkedK(kText(value)) };
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const unknown = Object.keys(o).filter((key) => !["k", "order", "form", "half_width"].includes(key));
    if (unknown.length) throw new DeclarationError(`modulation takes k, order, form and half_width; not ${unknown.join(", ")}`);
    if (o.k === undefined || o.k === null || (typeof o.k === "string" && !o.k.trim())) {
      throw new DeclarationError(`modulation needs k: ${K_HELP}; or give "none" or "default"`);
    }
    if (typeof o.k === "string" && declaresNone(o.k)) return { ...BLANK_MODULATION, modulationK: "none" };
    return {
      modulationK: checkedK(kText(o.k)),
      modulationOrder: checkedOrder(o.order),
      modulationForm: checkedForm(o.form),
      modulationHalfWidth: checkedHalfWidth(o.half_width),
    };
  }
  throw new DeclarationError(`modulation: give {"k": "1/3, 0, 0", "form": "planes"}, "none" or "default"`);
}

// ---------------------------------------------------------------- the migration

/** The legacy page's default H fractions, which a blank punchProtectH meant. */
const LEGACY_FRACTIONS = ["1/3", "2/3"];

/** A legacy H fraction's value mod 1, as the old page read it (parseFractions), or NaN. */
const fractionValue = (token: string): number => {
  const [a, b] = token.split("/");
  const v = b === undefined ? Number(a) : Number(a) / Number(b);
  return ((v % 1) + 1) % 1;
};

/**
 * The declaration a remembered form's legacy protected H planes
 * (punchProtectH, punchProtectHalfWidth) migrate to, once; null when it holds
 * neither, or nothing the old page would have sent. An explicit value becomes
 * k = (f, 0, 0) in plane form, which protects H ≡ ±f (mod 1): one vector per
 * fraction, a fraction's twin 1 − f folded into it ("1/3, 2/3" is k = (1/3, 0,
 * 0)), a fraction on the lattice (0) left out. "none", or a half width of 0,
 * declares none. A half width alone keeps the planes the old default
 * protected, at that width. The half width carries over as it was.
 */
export function migratedProtection(config: Record<string, unknown>): ModulationFields | null {
  const raw = (key: string): string => (typeof config[key] === "string" ? (config[key] as string).trim() : "");
  const h = raw("punchProtectH");
  const w = raw("punchProtectHalfWidth");
  const width = Number(w);
  if (w && Number.isFinite(width) && width === 0) return { ...BLANK_MODULATION, modulationK: "none" };
  let tokens: string[];
  if (!h) {
    if (!w || !Number.isFinite(width) || width < 0) return null;
    tokens = LEGACY_FRACTIONS;
  } else if (declaresNone(h)) {
    return { ...BLANK_MODULATION, modulationK: "none" };
  } else {
    tokens = h.split(/[\s,;]+/).filter(Boolean);
    // What the old page could not read it never sent: the backend's default stood.
    if (!tokens.every((t) => Number.isFinite(fractionValue(t)))) return w && Number.isFinite(width) && width > 0 ? migratedProtection({ punchProtectHalfWidth: w }) : null;
  }
  const kept: { token: string; value: number }[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-4 || Math.abs(Math.abs(a - b) - 1) < 1e-4;
  for (const token of tokens) {
    const value = fractionValue(token);
    if (near(value, 0)) continue; // on the lattice: the node test's
    if (kept.some((k) => near(k.value, value) || near(k.value, 1 - value))) continue;
    kept.push({ token, value });
  }
  if (!kept.length) return { ...BLANK_MODULATION, modulationK: "none" };
  return {
    modulationK: kept.map((k) => `${k.token}, 0, 0`).join("; "),
    modulationOrder: "",
    modulationForm: "planes",
    modulationHalfWidth: w && Number.isFinite(width) && width > 0 ? w : "",
  };
}

/** The keys of the legacy protected H planes, which a remembered form may still hold. */
export const LEGACY_PROTECTION_KEYS = ["punchProtectH", "punchProtectHalfWidth"] as const;
