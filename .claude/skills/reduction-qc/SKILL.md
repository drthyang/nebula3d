---
name: reduction-qc
description: >-
  Check that a reduction can be trusted before reading physics from it: the UB,
  the symmetrisation and its Laue class, the raw counts' |Q| edges and the
  coverage, edge and unmeasured voxels, the powder rings and the flatten floor.
  Use it when asked whether a run is sound or ready for the 3D-ΔPDF, and before
  changing or tuning the ring removal or the flatten. NOT for reading ΔPDF features
  (delta-pdf-interpretation) or auditing the Bragg nodes (bragg-node-audit).
---

# Reduction QC: is the reduced volume fit for a 3D-ΔPDF?

A reduction can look clean on one cut and still be wrong in ways every later
stage inherits. Check it first, in this order, and say what each check
found.

## Gates

- `ub_check`: the UB turned at 0.05° or more, from an unsymmetrised fit.
- `qmax_coverage`: the ΔPDF's Qmin and Qmax are where the raw counts begin
  and end; the window's weight on unmeasured space is clean up to about 1e-3.
- `assess_stage` rings: a powder ring rises in nearly every direction (3D): at
  least 0.15 of its median height in 90 % of the directions, three times its
  noise above its flanks, a quarter of its height above a curve through them.
  A leftover or dent counts beyond three times its plane's noise. Rings
  confirmed on data that should have none are an anomaly to report.
- `assess_stage` flatten: a pedestal is a trend and a span both 0.8 or more,
  over the outer half of the shells the counts reach.
- `symmetry_check`: an operation the data were symmetrised with holds to about
  1e-3 or better.
- `compare_laue_classes`: a class is rejected when its `x_noise` rises above a
  subgroup's by more than 10 % and two standard errors of the difference.

## Steps

1. **Know the data.** `describe_dataset`: the stages on disk, the reciprocal
   grid and its range, and the cell. Note whether the volume is symmetrised
   (`ub_check` says) and the symmetry the file declares (`grain_check`,
   `declared_symmetry`).
2. **The UB.** `ub_check` on the raw volume, with the punch cell as the Bragg
   nodes: the turn (`orientation_change_deg`). On a symmetrised volume only
   the symmetric part is fitted: say so, and that the orientation needs the
   unsymmetrised file. Read the radial offsets by |Q| band and direction: an
   offset that grows with |Q| is no UB error.
3. **The coverage and the |Q| band.** `qmax_coverage`: `raw_counts` (the
   edges), `suggested_band` (the band they allow), `band_check` (a set band
   inside them) and the verdict, the share of the transform window's weight on
   unmeasured space. The band and the magnetic ion stay with the user: suggest
   them, never set them unasked.
4. **Edge and unmeasured voxels.** Trim the edge before regridding or
   symmetrising outside the pipeline. Before proposing a Laue class for the
   symmetry average, run `compare_laue_classes` (Details: The Laue class):
   cite the classes, rule and flags and suggest a class; never set it
   (`update_settings` refuses it).
5. **Powder rings.** `assess_stage` for the rings (`shells_judged`), then
   `radial_profile`. Report leftovers and dents at the confirmed rings as
   shares of the diffuse beside them. A ring too weak to rise in nearly every
   direction is neither removed nor counted: if one shows by eye, say so.
6. **The flatten floor.** `assess_stage` for the flatten: floors near zero, no
   trend with |Q| (`floor_trend`), a span small against the diffuse level
   (`floor_span_fraction`), over the whole volume; `pedestal_left` says
   whether they make a pedestal. **When to turn the Q² term on:** when
   `assess_stage` for the flatten reports `pedestal_left`, set `flattenQ2` on,
   rerun from the flatten (`run_pipeline` with `from_stage` flatten), and read
   `assess_stage` for the flatten again: keep the term if the pedestal is
   gone, and report its trend and span before and after. Leave it off
   otherwise.
7. **Symmetry kept.** On symmetrised data, after the pipeline: `symmetry_check`
   on the ΔPDF; a clear break means a stage broke it (delta-pdf-interpretation).
8. **Report** the checks in order, each a verdict with the tool's numbers; what
   you would change and why; what was not checked; what the user decides (the
   band, the magnetic ion, whether to regrid). Mark a finding at a place (a
   ring left over, leftover intensity at one spot) with `mark_region` on the
   stage that shows it, resting on the call that measured it; name the mark by
   its id where the report gives the finding.

## Details

**Status:** Draft: awaiting the user's interview (questions in
`docs/SKILL_INTERVIEWS.md`).

### Know the data

A symmetrised volume and its unsymmetrised export are separate datasets.

### The UB

- The symmetric part: only the changes that commute with the symmetry
  operations can be fitted (`ub_check`).
- A UB error gives the same *relative* offset at every |Q| along a direction.
  An offset that grows with |Q| along one direction comes from how |Q| was
  assigned, and refining the UB only averages it.
- How large an offset is acceptable, and when to regrid onto a refined UB
  (`examples/refine_ub.py`) (to confirm with the user).

### The coverage and the |Q| band

- The band at the raw counts' edges is the user's rule: past them most voxels
  hold no counts. The verdict's weight on unmeasured space is recorded with
  the ΔPDF.
- Without that record, the verdict compares how far the window reaches with
  where the counts stop: the band if one is set, else the box faces, the
  coverage edge when the window is tapered to the coverage, or the box corners
  with apodization off and a separable window. The reach comes from the
  Configure page's settings, which may differ from the ones that made the ΔPDF
  on disk.

### Edge and unmeasured voxels

Voxels on the edge of the coverage are barely covered and can sit orders of
magnitude above the interior; the pipeline trims them at load (`edge_trim`;
the page's `edgeTrim`, changed only when the user names it). Unmeasured voxels
stay masked. The backfill fills punched holes and gaps the measured data
enclose, not the open coverage; the symmetry average fills gaps from
equivalents.

### The Laue class

Evidence for the user's choice of the class for the symmetry average.

- **Numbers.** R_int: how much equivalent voxels disagree. `x_noise`: R_int
  over what counting noise alone gives on the same orbits, so classes of any
  size compare; near 1, the equivalents agree within the noise. `chi2`
  (χ²/dof) reads alike and weighs strong disagreements (Bragg peaks) more.
- **Voxels.** Only measured voxels count, in orbits with another measured
  member; an empty voxel is never a zero.
- **Classes see different voxels.** With partial coverage a higher class
  compares voxels its subgroups cannot: evidence, not bias. Each is weighed
  against its own subgroups on its own voxels in its own noise units, so
  shared errors cancel.
- **The rule errs low** (Gates). Errors add disagreement, which a higher class
  pools more of, so a wrong answer is a class too low: gaps unfilled, nothing
  imposed.
- **Limits.** The errors come from a block bootstrap, which allows for
  correlated neighbouring voxels. Errors that differ between regions reject
  classes falsely (`common_flag`). Twinning, or domains related by an
  operation the sample lacks, make a lower symmetry look higher, undetectably.
- **Flags.** `flag`: the diffuse supports a lower class than the Bragg peaks,
  whose symmetry averaging would impose on it; the suggestion is the
  diffuse's. A note that every measured voxel supports less than the diffuse:
  the Bragg peaks break the symmetry or carry extinction or absorption
  errors. `common_flag`: the voxels the lowest class can judge suggest
  another class; if higher, the main suggestion may be a false rejection:
  give both, ask the user to look. No suggestion: isotropic within the noise
  (`no_symmetry` did not rise).

### Powder rings

- The crystal's own scattering at one |Q| rises in some directions only, and
  must stay. Planes cannot tell the two apart: symmetry makes them equivalent
  (all three on a cubic cell, h0l and 0kl on a hexagonal or tetragonal one).
- The removal subtracts only confirmed rings, so a crystal with none keeps all
  its diffuse.
- The ring rule's numbers (Gates): to confirm with the user.
- Not every instrument's data have rings (TOPAZ has no aluminium ring
  background): rings there are not routine cleanup.

### The flatten floor

- A floor that rises with |Q| is inelastic background (thermal diffuse and
  multiphonon scattering; with X-rays also Compton scattering, which neutrons
  lack). The `+ b·Q²` term (`flattenQ2`) and *Fit to |Q|* (`flattenFitQMax`)
  address it.
- Why the Q² term stays off otherwise: on a volume without such a background
  it is not free, since it fits part of the crystal's own floor (on the
  validation's clean controls it raised the scored pedestal span from 0.025 to
  0.066 to 0.107 of the diffuse level).
- Whether a floor that rises with |Q| could be signal rather than background
  stays a judgment call (to confirm with the user).
- X-ray data carry no magnetic scattering, so the magnetic ion stays none for
  them; neutron data can carry magnetic diffuse scattering, so there the ion
  is the user's call.

### Symmetry kept

`symmetry_check` tests each operation of the declared point group, those that
move c included; with none declared, the cell's in-plane ones.

### Firm rules (enforced in code)

- Changing a ring-removal or flatten setting, or tuning those stages, is
  refused until this skill has been read in the conversation.
- `ub_check` fits only the symmetric part of the UB on a symmetrised volume.
- A tuning trial whose ΔPDF window puts more of its weight on unmeasured space
  than the coverage gate allows cannot be chosen while the current settings
  stay inside it.
- Tuning trials never write to `processed/`.

### Acceptance checklist

A QC answer is complete when it states, each with the tool's numbers:

- [ ] the UB check's offsets before and after, and what kind of offset they are;
- [ ] whether the volume is symmetrised, and what that hides;
- [ ] the raw counts' |Q| edges, and whether the band stays inside them;
- [ ] the window's weight on unmeasured space;
- [ ] the ring verdict, with the shells confirmed as rings and those that are not;
- [ ] the flatten floor, trend and span, whether a pedestal is left, and
  whether the Q² term was turned on, with the numbers before and after;
- [ ] what was not checked, and why.

### Failure modes

- Turning the Q² term on without a pedestal left, or leaving a pedestal in
  because the floor reads small in σ beside strong diffuse structure.
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

## References

- [ub_refinement](../../../docs/algorithms/ub_refinement.md) — how the UB is
  refined and checked, symmetrised volumes, regridding, reading the offsets
- [delta_pdf](../../../docs/algorithms/delta_pdf.md) — the transform window, its
  support on the coverage, and the flatten's background terms
- [laue_compare](../../../docs/algorithms/laue_compare.md) — the Laue classes
  compared: R_int, the noise floor, χ²/dof, the rule, the block bootstrap and
  the common subset
