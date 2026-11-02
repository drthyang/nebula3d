import { describe, expect, it } from "vitest";

import type { PowderPhaseCandidate, PowderPhases } from "../../api/types";
import { powderPhaseText } from "../powderPhase";

// As the synthetic Al + Bi volume of the browser check gives it, made possible.
const bi: PowderPhaseCandidate = {
  phase: "Bi",
  name: "bismuth",
  group: "flux",
  status: "possible",
  scale: -0.0031,
  matched: 2,
  of: 3,
  significance: 3.9,
  score: 2.97,
  in_composition: true,
  amount_vs_al: 0.103,
  lines: [
    { hkl: "012", q: 1.922, ring: 1.9223 },
    { hkl: "024", q: 3.8439, ring: 3.8504 },
  ],
  hidden: [
    { hkl: "104", q: 2.6609, under: "Al111" },
    { hkl: "110", q: 2.7725, under: "Al111" },
  ],
  missing: [],
  unmatched: [3.5972],
};

const record = (candidates: PowderPhaseCandidate[]): PowderPhases => ({
  version: 1,
  library: "2026.11-1",
  radiation: "neutron",
  rings: [],
  candidates,
  unmatched: candidates[0]?.unmatched ?? [],
});

describe("the powder-phase line (THY-62)", () => {
  it("says the phase as a possibility, its rings matched and its scale, the evidence behind ?", () => {
    const t = powderPhaseText(record([bi]))!;
    expect(t.line).toBe("possibly Bi (2 of 3 rings matched, scale −0.3 %)");
    const rows = Object.fromEntries(t.detail.map((d) => [d.label, d.text]));
    expect(rows.Phase).toBe("bismuth, a flux metal; in the sample's formula");
    expect(rows["Lines matched"]).toBe("012 at 1.92 Å⁻¹, 024 at 3.85 Å⁻¹");
    expect(rows.Hidden).toBe("104 under Al111, 110 under Al111");
    expect(rows["Unmatched rings"]).toBe("3.60 Å⁻¹");
    expect(rows).not.toHaveProperty("Missing");
    expect(rows).not.toHaveProperty("Amount");
    expect(rows.Note).toContain("subtracts confirmed rings whatever their phase");
  });

  it("names two phases the data do not tell apart, and a likely one plainly", () => {
    const te = { ...bi, phase: "Te", name: "tellurium", in_composition: undefined, status: "likely" as const, or: "Bi", scale: 0.0012 };
    expect(powderPhaseText(record([te, bi]))!.line).toBe("possibly Te or Bi (2 of 3 rings matched, scale +0.1 %)");
    const sure = { ...bi, status: "likely" as const };
    expect(powderPhaseText(record([sure]))!.line).toMatch(/^likely Bi /);
  });

  it("says what a vanadium match would need, and nothing where no phase was named", () => {
    const v = { ...bi, phase: "V", name: "vanadium", group: "sample environment", amount_vs_al: 68, missing: [{ hkl: "200", q: 4.15 }] };
    const rows = Object.fromEntries(powderPhaseText(record([v]))!.detail.map((d) => [d.label, d.text]));
    expect(rows.Amount).toMatch(/^68× the Al's volume/);
    expect(rows.Missing).toBe("200 at 4.15 Å⁻¹");
    expect(powderPhaseText(record([]))).toBeNull();
    expect(powderPhaseText(null)).toBeNull();
  });
});
