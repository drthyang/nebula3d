---
name: reduction-qc
description: >-
  Check that a reduction can be trusted before reading physics from it: the UB,
  the symmetrisation, the raw counts' |Q| edges and the coverage, edge and
  unmeasured voxels, the powder rings and the flatten floor. Use it when asked
  whether a run is sound or ready for the 3D-ΔPDF, and before changing or tuning
  the ring removal or the flatten. NOT for reading ΔPDF features
  (delta-pdf-interpretation) or auditing the Bragg nodes (bragg-node-audit).
---

# Reduction QC: is the reduced volume fit for a 3D-ΔPDF?

**Status:** Draft: awaiting the user's interview (questions in
`docs/SKILL_INTERVIEWS.md`).

A reduction can look clean on one cut and still be wrong in ways that every
later stage inherits: an orientation slightly off, a symmetrisation that hides
it, a transform that reaches past the counts, bright edge voxels carried
inward. Check these first, in this order, and say what each check found.

## Steps

1. **Know the data.** `describe_dataset`: the stages on disk, the reciprocal
   grid and its range, the cell, and the symmetry the file declares. Note
   whether the volume is symmetrised; a symmetrised volume and its
   unsymmetrised export are separate datasets.
2. **The UB.** `ub_check` on the raw volume, with the punch cell as the Bragg
   nodes.
   - On a symmetrised volume only the changes that commute with the symmetry
     operations can be fitted. Say so, and that the orientation needs the
     unsymmetrised file.
   - Read the radial offsets by |Q| band and direction. A UB error gives the
     same *relative* offset at every |Q| along a direction. An offset that
     grows with |Q| along one direction is not a UB error: it comes from how
     |Q| was assigned, and refining the UB only averages it.
   - How large an offset is acceptable, and when to regrid onto a refined UB
     (`examples/refine_ub.py`) (to confirm with the user).
3. **The coverage and the |Q| band.** `qmax_coverage`.
   - The user's rule: the ΔPDF's Qmin and Qmax are where the raw counts begin
     and end. Past those edges most voxels hold no counts. `raw_counts` gives
     the edges, `suggested_band` the band they allow, and `band_check` whether
     a band that is set stays inside them.
   - The verdict is the share of the transform window's weight on unmeasured
     space, recorded with the ΔPDF: up to about 1e-3 is clean.
   - The |Q| band and the magnetic ion stay with the user: suggest them, never
     set them unasked.
4. **Edge and unmeasured voxels.** Voxels on the edge of the coverage are
   barely covered and can sit orders of magnitude above the interior; the
   pipeline trims them at load (`edge_trim`). A volume that is regridded or
   symmetrised outside the pipeline must be trimmed first. Unmeasured voxels
   stay masked. The backfill fills punched holes and gaps the measured data
   enclose, not the open coverage.
5. **Powder rings.** `assess_stage` for the rings, then `radial_profile`. A bump
   is a powder ring only if it rises in nearly every direction over the sphere,
   judged in 3D (`shells_judged`; the rule: at least 0.15 of its median height
   in 90 % of the directions, *to confirm with the user*). The crystal's own
   scattering at one |Q| rises in some directions only, and must stay. Planes
   cannot tell them apart: symmetry makes them equivalent (all three on a cubic
   cell, h0l and 0kl on a hexagonal or tetragonal one). The removal subtracts
   only confirmed rings, so a crystal with none keeps all its diffuse. Report
   leftovers and dents at the confirmed rings as shares of the diffuse beside
   them. A ring too weak to rise in nearly every direction is neither removed
   nor counted: if one shows by eye, say so.
6. **The flatten floor.** `assess_stage` for the flatten: the floors near zero
   across the whole coverage, no trend with |Q| (`floor_trend`), and a span
   small against the diffuse level. A floor that rises with |Q| is inelastic
   background (thermal diffuse scattering, and Compton scattering for X-rays).
   The `+ b·Q²` term (`flattenQ2`) and *Fit to |Q|* (`flattenFitQMax`)
   address it. X-ray data carry no magnetic scattering, so the magnetic ion
   stays none for them.
7. **Symmetry kept.** On symmetrised data, after the pipeline: `symmetry_check`
   on the ΔPDF. An operation the data were symmetrised with holds to about 1e-3
   or better; a clear break means a stage broke it (see
   delta-pdf-interpretation).
8. **Report** (below).

## Firm rules (enforced in code)

- Changing a ring-removal or flatten setting, or tuning those stages, is
  refused until this skill has been read in the conversation.
- `ub_check` fits only the symmetric part of the UB on a symmetrised volume.
- A tuning trial whose ΔPDF window puts more than 1e-3 of its weight on
  unmeasured space cannot be chosen while the current settings stay inside that
  limit.
- Tuning trials never write to `processed/`.

## Acceptance checklist

A QC answer is complete when it states, each with the tool's numbers:

- [ ] the UB check's offsets before and after, and what kind of offset they are;
- [ ] whether the volume is symmetrised, and what that hides;
- [ ] the raw counts' |Q| edges, and whether the band stays inside them;
- [ ] the window's weight on unmeasured space;
- [ ] the ring verdict, with the shells confirmed as rings and those that are not;
- [ ] the flatten floor, trend and span;
- [ ] what was not checked, and why.

## Failure modes

- Judging the orientation from a symmetrised volume, whose rings around the
  nodes look like broadened peaks, not shifted ones.
- Calling an offset that grows with |Q| a UB error, and "fixing" it with a
  refined UB.
- Letting the band run past the counts, so empty voxels enter the transform.
- Reading a bump the planes share as a ring: on a cubic crystal its own
  diffuse shows on all three planes. Only the test in 3D confirms a ring, and
  only confirmed rings are subtracted.
- Regridding or symmetrising before trimming the edge, so its bright voxels
  spread inward.
- Judging the whole volume from the opening cut at L = 0: measure another plane
  before a verdict.

## What to report

The checks above in order, each as a verdict with the numbers the tool
returned; what you would change and why; and what the user must decide (the
band, the magnetic ion, whether to regrid).

## References

- [ub_refinement](../../../docs/algorithms/ub_refinement.md) — how the UB is
  refined and checked, symmetrised volumes, regridding, reading the offsets
- [delta_pdf](../../../docs/algorithms/delta_pdf.md) — the transform window, its
  support on the coverage, and the flatten's background terms
