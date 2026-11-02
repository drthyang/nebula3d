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

The 3D-ΔPDF is the Fourier transform of the diffuse scattering left once the
Bragg peaks are removed: its features are the pair correlations' deviations
from the average structure, at the interatomic vectors where they occur.
Interpret only a ΔPDF that passes the trust checks.

## Gates

- `qmax_coverage`: the window's weight on unmeasured space up to about 1e-3,
  and the band inside the raw counts' edges (reduction-qc); past them,
  features come from empty voxels.
- `symmetry_check`, on symmetrised data: each operation the data were
  symmetrised with holds to about 1e-3 or better. A clear break while the raw
  data were exact was made by processing: do not interpret that ΔPDF.
- `assess_stage` for the ΔPDF, or `consistency_details`: a back-FFT r of 0.999
  or more only shows the transform ran correctly, never that a feature is real.
- `dpdf_contrast`: never describe a figure whose features are saturated.
- Nothing nearer the origin than the shortest interatomic distance is
  interpreted.

## Steps

1. **The settings that made it.** `qmax_coverage`: the window's shape and
   scale; `consistency_details`: the |Q| band; `grain_check`: the symmetry
   used.
2. **The trust checks**, each a gate above, in order: the coverage
   (`qmax_coverage`); the symmetry on symmetrised data (`symmetry_check`); the
   round trip (`assess_stage` pdf); the colour range (`dpdf_contrast`: the
   range is set from the sections, so the features carry the colour and the
   ripple stays near neutral).
3. **The features.** `dpdf_peaks` for the strongest features of the whole
   volume, then `dpdf_contrast` and `show_in_viewer` or `measure_dpdf_cut`
   through them.
4. For each feature: its vector in Å and in lattice units, its sign, its size
   against the volume's robust σ (`dpdf_peaks` gives all three), and whether
   it repeats under the symmetry.
5. **Rule out the artifacts** (Details), naming the check that rules out each:
   Bragg residue, copies of displaced Bragg peaks, termination ripple, a window
   past the data, the origin, ring residue, backfill texture.
6. **Read the signs**, and relate each feature to the structure: which average
   interatomic vector it sits on (a CIF in the 3D-ΔPDF page's structure
   overlay marks them).
   - **Positive:** more pairs of scattering density at that vector than the
     average structure has; for occupational disorder on one site, like pairs
     are more common than random there (clustering).
   - **Negative:** fewer pairs; for occupational disorder, unlike pairs are
     preferred (ordering).
   - **A positive and a negative lobe straddling an average interatomic
     vector:** a displacement correlation. The pair's distance differs on
     average from the average structure's, toward the positive lobe.
   - The weight can flip the reading (Details).
7. **Show it.** For a feature the user should look at, `mark_region` on the
   ΔPDF: an ellipsoid about the feature, in Å along a, b, c, resting on the
   `dpdf_peaks` entry or the cut that measured it.
8. **Report** trust first (coverage, symmetry, round trip), then the features:
   vector, sign, size, and the likely pair and kind of correlation, each with
   the checks behind it and the mark that shows it (by its id); then what was
   not checked, and what only the user can decide.

## Details

**Status:** Draft: awaiting the user's interview (questions in
`docs/SKILL_INTERVIEWS.md`).

### The trust checks

- **Symmetry.** `symmetry_check` tests each operation of the declared point
  group, those that move c included; an operation and its product with the
  inversion are one entry, equal on the centrosymmetric ΔPDF. With none
  declared it tests the cell's in-plane ones, and judges nothing: the
  asymmetry is the data's own. A ΔPDF that lost a clear share of its symmetry
  while the raw data were exact was broken by a stage computed on index-space
  neighbourhoods without orbit averaging, or by a separable window on a
  hexagonal cell. Find which.
- **Round trip.** Without a band or a crop the round trip is the identity. The
  transform keeps only the data's even part under Q → −Q, so r is judged
  against that part (`back_fft_pearson_r_even`, `pearson_r_even`); r against
  unsymmetrised data is lower by their odd part, counting noise
  (`odd_share`), which is no fault.

### What the signs mean

- **Weight.** A feature's weight is the product of the two sites' scattering
  contrasts. For disorder on one site it is a square, so positive. For pairs
  of different sites, or for displacements of an atom with a negative neutron
  scattering length, the product can be negative and flips the reading. How to
  state the contrast for each probe (to confirm with the user).
- **An example.** The synthetic demo volume (`nebula3d.demo`: rock-salt type,
  a = 4.2 Å). Its planted Warren–Cowley correlations appear as alternating
  shells: negative at the nearest-neighbour cation vector ⟨½ ½ 0⟩a (unlike
  pairs preferred), positive at ⟨1 ½ ½⟩a and ⟨2 0 0⟩a. Its order inside each
  (001) layer, rods along L in reciprocal space, is a checkerboard confined to
  the z = 0 plane: rods in reciprocal space are planes in real space.

### Artifacts that imitate signal

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
- **A window past the data** (the coverage gate).
- **The origin.** The self-correlation and the smooth background terms (the
  flatten's constant and `b·Q²`) land near the origin, hence its gate. A
  leftover pedestal shows as a broad feature there.
- **Ring residue.** A leftover powder ring is a sphere in reciprocal space and
  a spherical ripple in real space.
- **Backfill texture.** A lattice-periodic fill pattern (`texture_check`).

### Judgment calls

To confirm with the user: the feature size below which nothing is
interpreted; how far out in r the ΔPDF is trusted; an occupational or a
displacive reading when both fit; when to compare with a model of the
disorder.

### Firm rules (enforced in code)

- Changing a ΔPDF setting, or tuning the ΔPDF stage, is refused until this
  skill has been read in the conversation.
- A tuning trial whose window puts more of its weight on unmeasured space than
  the coverage gate allows cannot be chosen while the current settings stay
  inside that limit.

### Acceptance checklist

- [ ] the coverage verdict, and the band inside the counts;
- [ ] the symmetry check, on symmetrised data;
- [ ] the colour range set by `dpdf_contrast` before a figure is described;
- [ ] for each interpreted feature: vector, sign, size, symmetry, and the
  artifact checks that clear it;
- [ ] nothing interpreted near the origin, or from a saturated figure;
- [ ] what was not checked.

### Failure modes

- Interpreting a ΔPDF that broke its symmetry, or whose window reaches past the
  data.
- Taking a back-FFT r near 1 as proof that the features are real.
- Reading Bragg residue at lattice vectors as pair correlations.
- Describing ripple as structure because the colour range made it bright.
- Trading a clean window for SNR: a higher feature SNR with Qmax past the
  coverage, or with a lower back-FFT r, is ripple.

## References

- [delta_pdf](../../../docs/algorithms/delta_pdf.md) — the transform, the
  windows, symmetry, the support on the coverage and the background terms
