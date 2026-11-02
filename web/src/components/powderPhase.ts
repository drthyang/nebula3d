// Which phase the extra powder rings may be (THY-62), as the cleanup page says
// it: the ring removal's phase match (nebula3d.preprocessing.powder_phases)
// names the library phase whose lines best explain the rings the Al lines
// leave. One plain line, the result first, the evidence behind "?".

import type { PowderPhases } from "../api/types";

export interface PowderPhaseText {
  line: string; // "likely Bi (5 of 6 rings matched, scale −0.3 %)"
  detail: { label: string; text: string }[]; // behind "?", one row each
}

const q2 = (q: number) => q.toFixed(2);
// A signed per cent with a true minus, as the console writes signed numbers.
const pct = (x: number) => `${x < 0 ? "−" : x > 0 ? "+" : ""}${Math.abs(100 * x).toFixed(1)} %`;

/** The match's line and its evidence, or null where it named no phase. */
export function powderPhaseText(phases: PowderPhases | null | undefined): PowderPhaseText | null {
  const best = phases?.candidates?.[0];
  if (!phases || !best) return null;
  const word = best.status === "likely" && !best.or ? "likely" : "possibly";
  const name = best.or ? `${best.phase} or ${best.or}` : best.phase;
  const line = `${word} ${name} (${best.matched} of ${best.of} rings matched, scale ${pct(best.scale)})`;
  const detail: { label: string; text: string }[] = [
    {
      label: "Phase",
      text:
        `${best.name}${best.group === "flux" ? ", a flux metal" : best.group === "sample environment" ? ", sample environment" : ""}` +
        (best.in_composition ? "; in the sample's formula" : "") +
        (best.or ? `; the data do not tell it from ${best.or}` : ""),
    },
    { label: "Lines matched", text: best.lines.map((l) => `${l.hkl} at ${q2(l.ring)} Å⁻¹`).join(", ") || "none" },
  ];
  if (best.hidden.length) detail.push({ label: "Hidden", text: best.hidden.map((h) => `${h.hkl} under ${h.under}`).join(", ") });
  if (best.missing.length) detail.push({ label: "Missing", text: best.missing.map((m) => `${m.hkl} at ${q2(m.q)} Å⁻¹`).join(", ") });
  detail.push({ label: "Unmatched rings", text: best.unmatched.length ? `${best.unmatched.map(q2).join(", ")} Å⁻¹` : "none" });
  if (best.at_limit) detail.push({ label: "Scale", text: "at the edge of the ±1.5 % tried: the lattice it needs lies beyond" });
  if (best.amount_vs_al != null && best.amount_vs_al >= 1)
    detail.push({ label: "Amount", text: `${best.amount_vs_al}× the Al's volume, for rings this strong (neutrons barely see some metals, V among them)` });
  const others = phases.candidates.slice(1);
  if (others.length) detail.push({ label: "Also", text: others.map((o) => `${o.phase} (${o.status})`).join(", ") });
  detail.push({
    label: "Note",
    text:
      "A suggestion from the powder-phase library, by line positions" +
      (phases.radiation === "neutron" ? " and neutron intensities" : "") +
      ". The removal subtracts confirmed rings whatever their phase.",
  });
  return { line, detail };
}
