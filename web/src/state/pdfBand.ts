// The |Q| band of the 3D-ΔPDF's transform (pdfQMin, pdfQMax), as the
// Configure page writes it: each edge in Å⁻¹ to two decimals, both blank for
// the whole span (the default). Its slider writes through pdfQBandPatch, and
// an Apply card's band (llm/tune/userSettings.ts) through pdfQEdge, so the
// run reads either the same way (formToParams).

/** A band edge as the page writes it. */
export const pdfQEdge = (q: number): string => q.toFixed(2);

/** The band the slider sets: clamped to [0, the volume's span], both blank when it is the whole span. */
export function pdfQBandPatch(lo: number, hi: number, spanMax: number): { pdfQMin: string; pdfQMax: string } {
  const nextLo = Math.max(0, Math.min(lo, spanMax));
  const nextHi = Math.max(nextLo, Math.min(hi, spanMax));
  const isFull = nextLo <= 0 && Math.abs(nextHi - spanMax) < 0.025;
  return { pdfQMin: isFull ? "" : pdfQEdge(nextLo), pdfQMax: isFull ? "" : pdfQEdge(nextHi) };
}
