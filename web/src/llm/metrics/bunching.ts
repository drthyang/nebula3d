// The punch's sharp peaks off the lattice bunched at one commensurate
// fraction, as its record keeps them (the punch record's modulation.bunching:
// nebula3d.modulation.detect_commensurate, docs/modulation.md), put to the
// model as the facts and a question only the user can answer
// (off_lattice_bunching). An undeclared modulation leaves its satellites so,
// and a run measures it; whether the sample has one, and in which form, is
// the user's to say (the user's decision, 2026-10-19): the console asks and
// never assumes. The punch's assessment (tune/evaluate.ts) and run_pipeline
// carry it when the run's record has it; the answer checks hold the answer to
// asking it (answerChecks.ts).
//
// The question is definition only, the same with the skills on and off; the
// facts end with a span of inference, the remedy, which arm C does not read
// (inference.ts: a quoted span, left out wherever the text stands).

import type { Bunching, ModulationRecord } from "../../api/types";
import { quotedInference } from "../inference";
import { roundSig } from "./sliceStats";

/** What a run's record says of its sharp peaks off the lattice that bunch, and the question for the user. */
export interface OffLatticeBunching {
  facts: string; // the measurement, and (arm B) whose the answer is
  ask_user: string; // the question, as the model is to put it to the user
}

/** Whose the answer is, after the facts: arm B's alone. */
export const BUNCHING_REMEDY = quotedInference(
  "metrics/bunching.ts: off_lattice_bunching's facts",
  "remedy",
  " Whether the sample has that modulation, and in which form, is the user's to say: ask them (ask_user), and do not assume the answer either way.",
);

/** "H ≡ ±1/3 (mod 1)" read as its coordinate, centres and period; null for anything else. */
function parseWhere(where: string): { coordinate: string; centres: string[]; period: string } | null {
  const m = /^(\S+) ≡ (.+) \(mod (\d+)\)$/.exec(where);
  return m ? { coordinate: m[1], centres: m[2].split(", "), period: m[3] } : null;
}

/** "H = n ± 1/3" (period 1), "H = 2n ± 2/3" (period 2), a lone centre as "+ 1/2". */
function positions(where: string): string {
  const w = parseWhere(where);
  if (!w) return where;
  const n = w.period === "1" ? "n" : `${w.period}n`;
  return `${w.coordinate} = ${w.centres.map((c) => (c.startsWith("±") ? `${n} ± ${c.slice(1)}` : `${n} + ${c}`)).join(" or ")}`;
}

/** The wave vector the bunching points to: its first fraction on the coordinate's axis; null off the axes. */
function waveVector(b: Bunching): string | null {
  const w = parseWhere(b.where);
  const axis = ["H", "K", "L"].indexOf(b.coordinate);
  if (!w || axis < 0) return null;
  const k = ["0", "0", "0"];
  k[axis] = w.centres[0].replace(/^±/, "");
  return `(${k.join(", ")})`;
}

/** About how many hits chance gives, as the question says it. */
const aboutChance = (expected: number): string => (expected >= 1 ? String(Math.round(expected)) : String(roundSig(expected, 1)));

/**
 * The facts and the question for the user when the run's punch record says
 * its sharp peaks off the lattice bunch at one commensurate fraction; null when
 * they do not, or the record does not say.
 */
export function offLatticeBunching(record: ModulationRecord | null | undefined): OffLatticeBunching | null {
  const b = record?.bunching;
  if (!b) return null;
  const others = b.others.length ? `; the grid also fits ${b.others.join(", ")}` : "";
  const facts =
    `${b.hits} of the ${b.peaks} sharp peaks the search punched off the lattice (each symmetry orbit once) lie within ${b.half_width} r.l.u. of ${b.where}, ` +
    `where chance puts ${roundSig(b.expected, 2)} (binomial tail ${b.p_value.toPrecision(2)}, under ${b.alpha} over ${b.tests} tests)${others}. ` +
    `No modulation is declared there, so the search punched them.${BUNCHING_REMEDY.text}`;
  const k = waveVector(b);
  const ask =
    `${b.hits} of the ${b.peaks} sharp peaks off the lattice sit at ${positions(b.where)}, where about ${aboutChance(b.expected)} would by chance. ` +
    (k ? `Does the sample have a modulation with k = ${k}?` : `Does the sample have a modulation there?`);
  return { facts, ask_user: ask };
}
