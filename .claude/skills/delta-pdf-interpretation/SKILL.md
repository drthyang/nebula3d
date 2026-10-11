---
name: delta-pdf-interpretation
description: >-
  Read a 3D-ΔPDF: what a positive or negative feature at an interatomic vector
  means, the symmetry it must keep, and the artifacts that imitate signal
  (Bragg residue, termination ripple, a window past the data, smooth background
  near the origin). Use it when asked what the ΔPDF shows, whether a feature is
  real, or how to describe a ΔPDF figure, and before changing or tuning the
  ΔPDF's settings.
---

# Interpreting a 3D-ΔPDF

**Status:** Draft: awaiting the user's interview (questions in
`docs/SKILL_INTERVIEWS.md`).

The 3D-ΔPDF is the Fourier transform of the diffuse scattering left once the
Bragg peaks are removed. Its features are the deviations of the pair
correlations from the average structure, at the interatomic vectors where they
occur. Interpret only a ΔPDF that the trust checks below pass.

## What the signs mean

- **Positive** at a vector: more pairs of scattering density at that vector
  than the average structure has. For occupational disorder on one site, like
  pairs are more common than random there (clustering).
- **Negative**: fewer pairs; for occupational disorder, unlike pairs are
  preferred (ordering).
- **A positive and a negative lobe straddling an average interatomic vector**:
  a displacement correlation. The pair's distance differs on average from the
  average structure's, toward the positive lobe.
- **Weight.** A feature's weight is the product of the two sites' scattering
  contrasts. For disorder on one site it is a square, so positive. For pairs
  of different sites, or for displacements of an atom with a negative neutron
  scattering length, the product can be negative and flips the reading. How to
  state the contrast for each probe (to confirm with the user).

A synthetic example (the demo volume, `nebula3d.demo`: rock-salt type,
a = 4.2 Å). Its planted Warren–Cowley correlations appear as alternating
shells: negative at the nearest-neighbour cation vector ⟨½ ½ 0⟩a (unlike pairs
preferred), positive at ⟨1 ½ ½⟩a and ⟨2 0 0⟩a. Its order inside each (001)
layer, rods along L in reciprocal space, is a checkerboard confined to the
z = 0 plane: rods in reciprocal space are planes in real space.

## Trust checks, before any interpretation

1. **The settings that made it.** `describe_dataset` and `configure_settings`:
   the window's shape and scale, the |Q| band, the symmetry used.
2. **Coverage.** `qmax_coverage`: the window's weight on unmeasured space up to
   about 1e-3, and the band inside the raw counts' edges (reduction-qc). Past
   them, features come from empty voxels.
3. **Symmetry.** On symmetrised data, `symmetry_check`: every operation the data
   were symmetrised with holds to about 1e-3 or better. A ΔPDF that lost a clear
   share of its symmetry while the raw data were exact was broken by
   processing: a stage computed on index-space neighbourhoods without orbit
   averaging, or a separable window on a hexagonal cell. Find which; do not
   interpret it.
4. **Round trip.** `assess_stage` for the ΔPDF, or `consistency_details`: a
   back-FFT r near 1 only shows the transform ran correctly. Without a band or
   a crop the round trip is the identity. It is not evidence that a feature is
   real.
5. **Colour range.** `dpdf_contrast`: the range is set from the sections, so
   the features carry the colour and the ripple stays near neutral. Never
   describe a figure whose features are saturated.

## Artifacts that imitate signal

- **Bragg residue.** A peak the punch missed adds a wave with the lattice's
  period. Residue at many nodes adds a pattern that repeats at every lattice
  translation and does not decay with r. Audit the nodes (bragg-node-audit)
  before calling such features pair correlations.
- **Copies of displaced Bragg peaks.** A UB slightly off, symmetrised, leaves
  residue beside the nodes: the same kind of artifact (reduction-qc,
  `ub_check`).
- **Termination ripple.** Truncation at the band or the box edge rings around
  every strong feature; the window (Gaussian, Hann, ellipsoid) trades the
  ringing against resolution. Ripple is regular and follows the strong
  features; signal does not.
- **A window past the data** (the coverage check above).
- **The origin.** The self-correlation and the smooth background terms (the
  flatten's constant and `b·Q²`) land near the origin. Do not interpret
  features closer to it than the shortest interatomic distance. A leftover
  pedestal shows as a broad feature there.
- **Ring residue.** A leftover powder ring is a sphere in reciprocal space and
  a spherical ripple in real space.
- **Backfill texture.** A lattice-periodic fill pattern (`texture_check`).

## Steps

1. The trust checks above, in order.
2. `dpdf_contrast`, then `show_in_viewer` or `measure_dpdf_cut` through the
   strongest features on the three sections.
3. For each feature: its vector in Å and in lattice units, its sign, its size
   against the section's robust σ, and whether it repeats under the symmetry.
4. Rule out the artifacts above, naming the check that rules out each.
5. Relate the features to the structure: which average interatomic vector each
   sits on (a CIF in the 3D-ΔPDF page's structure overlay marks them).
6. Report.

Judgment calls (to confirm with the user): the feature size below which nothing
is interpreted; how far out in r the ΔPDF is trusted; an occupational or a
displacive reading when both fit; when to compare with a model of the disorder.

## Firm rules (enforced in code)

- Changing a ΔPDF setting, or tuning the ΔPDF stage, is refused until this skill
  has been read in the conversation.
- A tuning trial whose window puts more than 1e-3 of its weight on unmeasured
  space cannot be chosen while the current settings stay inside that limit.

## Acceptance checklist

- [ ] the coverage verdict, and the band inside the counts;
- [ ] the symmetry check, on symmetrised data;
- [ ] the colour range set by `dpdf_contrast` before a figure is described;
- [ ] for each interpreted feature: vector, sign, size, symmetry, and the
  artifact checks that clear it;
- [ ] nothing interpreted near the origin, or from a saturated figure;
- [ ] what was not checked.

## Failure modes

- Interpreting a ΔPDF that broke its symmetry, or whose window reaches past the
  data.
- Taking a back-FFT r near 1 as proof that the features are real.
- Reading Bragg residue at lattice vectors as pair correlations.
- Describing ripple as structure because the colour range made it bright.
- Trading a clean window for SNR: a higher feature SNR with Qmax past the
  coverage, or with a lower back-FFT r, is ripple.

## What to report

Trust first (coverage, symmetry, round trip), then the features: vector, sign,
size, and the likely pair and kind of correlation, each with the checks behind
it; then what only the user can decide.

## References

- [delta_pdf](../../../docs/algorithms/delta_pdf.md) — the transform, the
  windows, symmetry, the support on the coverage and the background terms
