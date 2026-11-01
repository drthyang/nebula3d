# Powder Ring Removal

## Purpose

Polycrystalline material in the beam path can add powder rings to a single-crystal
diffuse scattering volume. Common sources include the sample environment,
cryostat, sample holder, and capsule walls.

Whether a volume has any depends on the instrument and its sample environment.
The measured CORELLI volumes carry aluminium lines; TOPAZ data have no
aluminium powder-ring background. The stage subtracts only the shells its 3D
check confirms as rings (below), so a volume without rings passes through
unchanged. Rings confirmed on data that should have none are an anomaly to
report and trace (the mount, the sample environment, a second phase), not a
routine cleanup step.

The goal is to subtract the ring contribution while preserving real diffuse
structure. The current production path is subtractive: it estimates only the
azimuthally smooth ring intensity and subtracts that estimate. It does not mask
or replace voxels just because they have radial excess, because radial excess can
also be genuine diffuse scattering.

## Physical Basis

A powder ring is localized in `|Q|` (a thin spherical shell at the powder
d-spacing), but its amplitude is not uniform around the shell. Detector
solid-angle coverage, absorption path length, and normalization artifacts
modulate the ring intensity with azimuthal direction. In real data, rings are
therefore not isotropic.

A useful model for a voxel with `|Q|` and azimuthal angle `phi` is:

```
I_ring(Q, phi) = T(phi) x sum_i A_i G(|Q| - q_i, sigma_i)
```

- **G(|Q| - q_i, sigma_i)**: radial profile of ring *i*.
- **Aᵢ**: per-ring amplitude (structure factor × absorption).
- **T(phi)**: azimuthal texture from detector coverage, absorption, and
  normalization.

The measured signal is `I_measured(Q, φ) = I_diffuse(Q) + I_ring(Q, φ)`, where the
diffuse signal we want is direction-dependent and does **not** share the ring's radial
peak structure or azimuthal texture.

## Current Production Path

### Stack-pooled sector model (`pooled`, default)

`RingParams.ring_model="pooled"` (`nebula3d.preprocessing.fit_pooled_rings`), the
pipeline, web and `examples/remove_rings_3d.py` default since 2026-10. Select
`"patched"` for the previous default.

**What the rings actually look like.** On measured *mmm* CORELLI volumes a
powder ring is not a sphere whose only direction dependence is its amplitude. Its
radial position and width wander with direction. At H = 0 the 4.39 Å⁻¹ Al line
peaks at a |Q| that moves with the azimuth by more than its own FWHM. The *mmm*
symmetrisation overlays several such copies, so along some directions the ring
is a broad multi-peaked band. At a fixed |Q| the
ring intensity traces smooth curved loci over the sphere (an H × φ map at one
|Q| bin shows them directly). The direction-dependent shift is the
`delta_q_j(u)` term of the Ring Removal 2.0 target model below.

**Why the other models leave a residual.** `patched` smooths the azimuthal
pattern of every |Q| bin with a few damped harmonics, and `parametric` /
`global_v2` tie each ring to one radial line shape. All three subtract the ring
at the wrong |Q| over much of the sphere, leaving a bright arc beside a dark one
along every ring. The azimuthally averaged removal fraction cannot see this
because the two cancel. The per-patch profiles themselves (before the Fourier
fit) do follow the shifted, multi-peaked ring; the information is lost in the
smoothing.

**Algorithm.** No radial line shape is assumed; the volume's own stack of planes
supplies the statistics one plane lacks.

1. Per plane: the median radial profile of every azimuthal sector (72 × 5°) on
   0.02 Å⁻¹ |Q| bins (never finer than half the voxel |Q| spacing), and the
   all-azimuth profile.
2. Shells: rings confirmed across the stack, as `confirm_ring_shells_across_h`
   does: above 6 % of the strongest ring, and here also ≥ 6σ of the profile
   noise (the relative cut alone finds "rings" in pure noise). A weaker ring
   (≥ 6σ) is added only if it sits on an FCC-Al line, the lattice parameter
   fitted from the strong rings. On measured data the relative cut lost the
   weak Al 440 and 533 lines, though they stood well above the noise. Without
   the Al condition a pure noise cut also admits sharp diffuse maxima: on the
   demo volume, the (1 ½ 0) SRO at 1.67 Å⁻¹ (7σ).
3. Pooling: each plane's sector profile becomes the weighted median over a small
   solid angle of the ring sphere: ±1 sector and the planes whose direction at
   that |Q| lies within ±5°. The plane window therefore widens with |Q|, from
   ±6 planes at 2.7 Å⁻¹ to ±25 at 10.5 Å⁻¹ on a CORELLI grid. Weights are voxel
   count × triangle kernels. Where the grid is too coarse for that solid angle
   to hold 12 voxels (by geometry), it widens in both directions until it does;
   empty cells are filled along φ, never along |Q| across a ring. On the
   CORELLI grid nothing widens; on the coarse demo grid (0.094 Å⁻¹ voxels,
   rings narrower than a voxel) it must, or the starved cells erase the ring.
4. Ring excess: SNIP under each pooled profile with one window per ring
   *cluster*, the same on every plane. A close doublet (Al 331/420,
   ≈ 6.8/6.9 Å⁻¹) shares a window instead of each member being capped at
   0.9 × the separation, which
   left half the broad member in the baseline. The excess is kept inside the
   confirmed shells through an envelope flat to ±1.5 × FWHM, tapering to zero
   over a further 1.5 × FWHM (room for the direction-dependent position), and
   capped at 8 × the shell's across-stack amplitude.
5. Subtract the excess, interpolated bilinearly over (φ, |Q|) at every voxel.
   The sampling-mask spokes are masked as in the per-plane models.

**Only confirmed rings are subtracted** (`PooledRingConfig.confirm_rings`,
on by default since 2026-10-11). A shell the detection finds is a powder ring
only if it rises at its |Q| in nearly every direction over the sphere
(`nebula3d.preprocessing.ring_isotropy.judge_shells`): texture can vary a
ring's height, but not take it away anywhere. The crystal's own scattering at
one |Q| (short-range-order maxima, the thermal diffuse round its Bragg nodes,
the nodes) rises in some directions only. Before this rule the removal
subtracted every detected shell, and on a crystal with no rings it took broad
shells of its diffuse: on a held-out synthetic volume 3 % of the intensity,
up to a third of the diffuse near 4.1 Å⁻¹ (docs/evals.md). Comparing the three
principal planes cannot replace the test: symmetry makes them equivalent (all
three on a cubic cell, h0l and 0kl on a hexagonal or tetragonal one), so the
crystal's own scattering shows on each.

The sphere is cut into 8 × 16 cells of equal solid angle (bands in cos θ by
sectors in φ, Cartesian Q). In each cell the radial profile is the median of
each |Q| bin, robust to a Bragg peak in the cell, and the shell's height there
is that profile's mean over its core (± 0.75 × FWHM, the FWHM capped at 0.16
Å⁻¹) above a line through flanks on either side. The mean over the core, not
its peak, so a ring whose |Q| wanders with direction (within the FWHM of the
all-direction profile, which the wandering widens) still counts. A flank skips
the core of every other shell found above the noise (a close doublet's weak
member included) and reaches further out for clean bins; with no clean flank
on one side the shell is judged again clear of the confirmed rings only, and
else not judged. The rule: at least 0.15 of the median height in 90 % of
the cells; in the typical cell the height stands at least 3 times the flanks'
scatter above them; and at least a quarter of it stays above a quadratic
through the same flanks, since a smooth hump under the shell reads as a height
in every direction above a line but not above the curve (*all to confirm with
the user*). On the synthetic volumes the 10th percentile of the cells' heights
over the median (the isotropy) reads:

| Shell | Isotropy |
| --- | ---: |
| Injected isotropic rings (held-out) | 0.96 |
| Demo aluminium lines, textured (`ring_p2` 0.45, `ring_p4` 0.15) | 0.35 (weakest) to 0.90 |
| Test ring three times stronger one way, its |Q| wandering ± 0.07 Å⁻¹ (`tests/test_pooled_rings.py`) | 0.33 |
| The crystals' own diffuse shells (eight volumes, one with its HKL origin shifted) | −0.14 or less |
| An empty shell on a broad hump, or maxima along ⟨100⟩ on it | 0.90 to 0.96, but only 0.15 or less of the height above the curve |

Past a budget of voxels in the shells' windows (6 M, or an eighth of the
volume's voxels in the browser's low-memory mode) a fixed random subset is
read, but each shell keeps about 32 voxels per cell and |Q| bin, all of them
when it has fewer (`IsotropyConfig.sample_per_bin`). A budget shared by every
shell alike thinned the small shells near |Q| = 0 to a few cells: in the
browser the demo's two lowest Al lines went unjudged and stayed in, where the
native run removed them. The two modes now confirm the same rings.

The cells must stay small, and the core narrow: on 4 × 8 cells the diffuse
shells read up to 0.9, and with a 0.29 Å⁻¹ core one read 0.21, because both
average maxima in different directions, or at neighbouring |Q|, into what
reads as a ring. The Al lattice of the weak-line prior is fitted from
confirmed rings alone, so a crystal whose own lattice is close to aluminium's
cannot pass its shells off as Al lines. With nothing confirmed the stage
returns the volume unchanged, mask included; otherwise it is the stage it was
(on the demo volume, bit for bit). A shell measured in too few directions (a
box corner) is not judged, and not subtracted. A ring too weak to rise above the noise in
nearly every cell is neither removed nor counted by the ring check. The
diagnostics list each subtracted shell with its verdict, and the rest under
`rejected_shells`.

**Al lines: judged again, doublets together, in each cell's Al frame**
(2026-11). On a measured *mmm* volume (local, unpublished) the removal left
two kinds of Al ring. The 331 line at 6.79 Å⁻¹, 0.18 Å⁻¹ from the broad 420
(FWHM 0.15), had no clean flank on that side and was never judged. And every
line from 8.8 Å⁻¹ up (440, 531, 600, 620, 533, 622), measured in 34 to 71 of
the 128 direction cells, read an isotropy of −1.2 to 0.01 and was rejected.
That was not noise. In each direction cell the Al lines sit at
q_line × (1 + s), one scale s per cell for every line: the line's place moves
with direction in proportion to its |Q|, as for Al that is not where the
sample is. On that volume s reaches ±1 % (95th percentile 0.0102), ±0.1 Å⁻¹ at
9 Å⁻¹, more than the lines' width. The core cut at the all-direction
profile's |Q| missed the line in a minority of cells and the flank caught it,
so those cells read negative heights. The scale a cell reads from the lines
at 2.7 to 8.1 Å⁻¹ predicts its lines at 9 to 10 Å⁻¹ to within 0.017 Å⁻¹ (the
per-cell scatter is 0.0017 of q). Aligned by it, the stacked lines sharpen,
and the same high-|Q| lines read an isotropy of 0.48 to 0.90.

So, after the strict verdicts and the lattice fit, the candidates left on a
fitted Al line are judged again (`ring_isotropy.judge_al_lines`):

- **Only on a confirmed lattice.** At least three confirmed rings must sit on
  distinct Al lines. The lattice match takes 0.12 Å⁻¹ either side of each
  line, so one ring always sits near some Al line, but three at one lattice
  parameter do not by chance.
- **On a line, as wide as one.** A candidate is admitted when its centre is
  within half its FWHM of a fitted line (or 0.04 Å⁻¹), and it is no wider than
  twice the Al width there. The Al width is the confirmed Al rings' FWHM, a
  line through them over |Q|, kept within their range.
- **In each cell's Al frame.** Each cell's |Q| is divided by 1 + s
  (`ring_isotropy.al_cell_scales`). Each confirmed Al ring that is clear of
  other lines is placed in every cell by a matched peak within ±2 % of its
  |Q|, counting where it stands 3σ. A cell with three rings placed or more
  takes their weighted median over q. That scale is then shrunk towards 0 by
  its error, as far as the scales' spread over the cells is error and not the
  cells' own, so a frame read from noise aligns nothing. On the measured
  volume: 6 rings, 128 cells, reliability 0.98. On a synthetic volume whose
  lines do not move: no frame.
- **Doublets as one.** Lines too close for a clean flank between them (closer
  than two Al widths and two bins) are judged as one cluster. Its core is
  every line's ±0.75 × the Al width and its flanks lie outside the cluster;
  a confirmed Al ring among them joins it. The cluster's candidates are
  confirmed or rejected together, and each line must rise on its own: one
  peak per line, fitted by least squares in every cell, with the same
  isotropy asked of its amplitude.
- **The same rule, a lower noise floor.** The isotropy is the strict rule's:
  0.15 of the median height in 90 % of the measured cells. So are the
  curvature test and the retry clear of the confirmed rings when no clean
  flank is found. The noise floor is 2 against 3. On pure noise (independent
  bins, cells paired by inversion, 20 000 draws) a shell is falsely confirmed
  with probability 6e-4 on 16 measured cells (the minimum), 2.5e-4 on 24, and
  never on 34 or more (at 3: 1e-4, 5e-5, never). Each candidate has already
  risen 6σ above the across-stack noise to be detected. For a textured ring
  at a peak signal-to-noise of 1.5 per bin on 34 cells, the lower floor
  raises the confirmation rate from 0.24 to 0.39. On the measured volume it
  decided no line (all read 6.4 or more).
- A confirmed candidate is subtracted with the Al width where it is wider
  than its own, as for the 9.23 Å⁻¹ shell, detected at 0.05 Å⁻¹.

**Why the direction share stays at 90 %.** The Al prior locates a line; it
does not show that what rises there is the line. A diffuse feature of the
crystal's at an Al |Q| is told apart by the same evidence as anywhere else:
it rises in some directions only. It is also told apart by its width, and by
the frame, where a feature fixed in |Q| sits off the core wherever the lines
move. A lower share gives that up. Take synthetic diffuse at the Al 400 |Q|,
present where |cos θ| < 0.6: in the Al frame it reads 0.39 at a 75 % share
and is confirmed, and 0.007 at 90 %. Simulated features present in 70 % and
80 % of the directions pass a 75 % share 43 % and 87 % of the time, and the
90 % share 1.5 % and 11 %.

**Shells judged not rings are spared.** A confirmed ring's envelope reaches
3 × its FWHM. It took 57 % of the synthetic diffuse at the Al 620 |Q| as
excess, beside a confirmed 533/622 doublet, after the test had rejected that
diffuse. The cores of the shells judged and rejected (±0.75 × FWHM, tapered
over as much again) are now taken out of every envelope. The exceptions: a
confirmed ring's own core, and the shells left unjudged, which may be rings.

*On the measured volume* (the stage's defaults, edge trimmed by one voxel),
the removed share went from 13.2 % to 15.6 % of |I|. The table gives each
line's integrated excess over the all-direction median profile that is
left, as a share of the raw:

| Lines | Left before | Left now |
| --- | ---: | ---: |
| 331 + 420 (6.78, 6.95 Å⁻¹; the 420's envelope took most of the 331 before) | 0.02 | 0.01 |
| 440 (8.80) | 1.00 | 0.00 |
| 531 + 600 (9.20, 9.33) | 1.00 | 0.02 |
| 620 (9.83) | 0.99 | 0.00 |
| 533 + 622 (10.20, 10.31) | 0.98 | not removed |

The 533/622 doublet, in 34 cells at the coverage edge, is rejected: the weak
533 line's own amplitude has its 10th percentile at −0.35 of its median, so
the pair stays. Five rings of another phase come out as before, to the digit
of the profile: the strict rule removes the strongest of them, and the Al
rule touches none.

Limits: an Al line the detection misses is not judged, and its neighbour may
then fail on a filled flank. Rings of any other phase are judged by the
strict rule alone. The diagnostics (schema 3) record, for each shell, its Al
match (`match`: phase, hkl, |Q|) and, in its verdict, the rule that judged it
(`rule: "al"`), the criteria it failed (`fails`: height, isotropy, snr,
curve, line) and a cluster's lines. A rejected shell's first verdict is kept
as `strict`. The top level records the frame (`al_frame`: rings, cells,
95th-percentile |s|, reliability) and the Al rule (`confirmation.al_rule`).

**Bragg peaks.** A Bragg peak covers one sector over a few planes, a minority of
the pooling neighbourhood, so the median rejects it. Pooling over the stack
alone is not enough at integer H, where the peak spans most of the plane window:
the ring estimate at Bragg-on-ring voxels rose far above the Bragg-free
counterfactual, leaving holes. With the ±1-sector pooling it is about as close
to it as `patched`.

**Continuity.** Neighbouring planes share most of their pooled data, so the
subtracted ring is continuous along the stack axis. The per-plane models' plane
to plane jitter showed up in the ΔPDF as a streak along x_H.

#### Validation (2026-10-05, three measured mmm volumes, `*_mmm_cc.nxs`)

*Held-out ring residual* (fit on one checkerboard half of each plane, score on
the other; per (10° sector, 0.02 Å⁻¹) median minus a linear baseline between the
ring's flanks, noise subtracted; residual RMS / raw-ring RMS; six blocks of seven
planes at H = 0, ⅓, 1, 2, −1⅓, 3; lower is better). The scores include
non-ring structure (Bragg, coverage edges) common to both, so they rank rather
than measure absolutely. Against `patched` (cc_on defaults), `pooled` scored
lower on every scored ring of every volume, most on the strong low-|Q| Al
lines.

On one volume the doublet score is dominated by its zone's flank baseline near
the edge of the K coverage: the all-azimuth radial profile there is flat after
`pooled` on H = 0, ⅓ and 1, while `patched` leaves both peaks.

*Full pipeline* (rings → punch → backfill → flatten → ΔPDF, everything else at
defaults). The patched ΔPDFs carry concentric ripples across every section, the
real-space image of the leftover rings; the pooled ones largely do not. The
ΔPDF RMS by radial shell is lower for pooled than for patched in every shell
out to 85 Å, on all three volumes.

The pooled − patched difference is concentric ripples (the removed rings) plus
a streak along x_H (the per-plane fits' plane-to-plane jitter). The back-FFT
consistency check is unchanged on all three volumes.

*Demo volume* (`nebula3d.demo`, ground truth known; 97³ over ±3 r.l.u.):
ring-zone residual RMS against the ring-free truth is 0.056 (`patched` 0.049;
raw 0.226), and the full default pipeline still punches only FCC nodes and
recovers the planted SRO. The ring stage takes 50–55 s serial on the 48 M-voxel
volumes (M-series laptop), against 43–47 s for `patched` including its
confirmation pre-pass. In low-memory (browser) mode the output overwrites the
input and the stage peaks at ~5 B/voxel.

Knobs (`RingParams`): `pooled_sectors` (72), `pooled_window_deg` (5),
`pooled_neighbor_sectors` (1), `pooled_envelope_scale` (1.5),
`pooled_amp_cap` (8), `pooled_min_snr` (6); `ring_width` is the maximum ring
FWHM and `slice_axis` the stack axis. `PooledRingConfig` also has
`pool_target_count` (12) and `al_prior` (on). `pooled_confirm_rings` (on)
subtracts only confirmed rings, by `pooled_ring_direction_share` (0.9) and
`pooled_ring_height_share` (0.15); `IsotropyConfig.al_min_snr` (2) and
`al_width_ratio` (2) set the Al lines' noise floor and widest candidate. The diagnostics sidecar
(`*_ringremoved_diagnostics.json`) lists each shell with its detection route
and its verdict.

### Ring Removal 2.0: sample-only global 3D model

`RingParams.ring_model="global_v2"` enables the sample-only global fitter. It is
designed for experiments where the empty-environment scan does not reproduce the
Al sample holder and direct subtraction leaves the holder rings while creating
negative residuals elsewhere.

The measured sample volume is treated as

```text
I_sample(Q) = I_crystal(Q) + I_powder(Q) + I_other-background(Q)
```

and only `I_powder` is inferred and removed. This is **powder-component removal**,
not a claim of complete or absolute background correction. Smooth incoherent,
instrumental, and other non-shell backgrounds remain for separately disclosed
processing.

The implementation:

1. Builds one Bragg-robust radial median over the full 3D volume.
2. Detects only narrow radial peaks; broad features remain possible sample
   diffuse scattering.
3. Optionally identifies FCC Al families and fits their common lattice parameter.
   In `material="auto"`, unmatched statistically supported powder shells are kept
   as generic rather than forced into the Al hypothesis.
4. Fits each shell's non-negative angular amplitude over the full unit sphere with
   regularized real spherical harmonics. Equal-solid-angle cell medians reject
   sparse crystal Bragg peaks.
5. Estimates model uncertainty from angular-cell residuals and propagates it into
   the cleaned volume's `sigma`.
6. Defaults to conservative subtraction
   `max(ring_mean - z * ring_sigma, 0)`. `mean` and `diagnose_only` policies are
   available explicitly.
7. Writes `<stem>_ringremoved_diagnostics.json` with material matches, shell
   centers/widths, angular coverage, uncertainty, removed energy, negative flips,
   warnings, and fit status.

The global path is selectable but not the default: it ties each shell to one
pseudo-Voigt line shape, so it cannot follow the direction-dependent ring
position the `pooled` model handles, and it has not passed the real-data
qualification gates in `docs/reports/2026-07-10_al_ring_removal_2_0_plan.md`.

#### Initial real-data check (2026-07-10)

A stride-4 read of an unsubtracted measured `*_mmm_cc.nxs` sample volume
(76 × 101 × 101 grid) exercised the sample-only path without an
empty-environment scan. With `material="auto"`, `min_snr=5`, and conservative
subtraction, it found:

- a strong non-Al shell;
- the FCC Al sequence from the 111 line out past 10 Å⁻¹;
- a fitted Al lattice parameter close to the nominal room-temperature prior
  (4.0494 Å);
- a few per cent of total `|I|` removed and a small positive-to-negative flip
  fraction.

This is a smoke/geometry check, not the release qualification: full-resolution
before/model/after figures, injected-truth retention metrics, and downstream
DeltaPDF comparison remain required before changing the default.

The original factored Gaussian/SVD model remains in the package as
`PatchedRingModel`. The per-plane `PatchedRadialRingModel` path runs with
`ring_model="patched"` (`RING_MODEL=patched` in `examples/remove_rings_3d.py`,
whose default is the pooled model).

That path is non-parametric:

1. Fit each H plane independently in the displayed `0kl` frame.
2. Build robust radial profiles in azimuthal patches.
3. Estimate a smooth baseline with SNIP-like clipping.
4. Subtract only azimuthally smooth ring intensity.
5. Carry cross-H confirmed ring shells and amplitude ceilings into each plane so
   integer-H Bragg artifacts do not become fake powder rings.

The key design rule is: **ring removal is subtractive only**. Do not replace
masked/excess regions unless the mask is based on azimuthal smoothness, not
radial excess.

## Selectable Models: Patched vs Parametric

Two interchangeable removers expose the same `fit` / `subtract` interface and the
same cross-stack confirmed-shell guards; select with `RingParams.ring_model`
(`"patched"` | `"parametric"`; the default is now `"pooled"`, above).

- **`PatchedRadialRingModel`** (`"patched"`, the default until 2026-10) — the
  non-parametric per-(azimuthal-patch × |Q|-bin) estimator described above.
- **`ParametricRingModel`** (`"parametric"`) — separable and binning-free:
  `I_ring(|Q|,φ) = Σᵢ Tᵢ(φ)·PVᵢ(|Q|)`, a unit-peak pseudo-Voigt radial line shape
  per ring × that ring's own non-negative Fourier azimuthal texture
  `Tᵢ(φ) = c₀ + Σₖ (cₖ cos kφ + sₖ sin kφ)`. Two radial modes (`ring_radial_mode`):
  **rolling** (default — a continuous `Ring(|Q|)·T(|Q|,φ)` swept over thick
  overlapping |Q| windows, no peak detection) and **peaks** (discrete
  pseudo-Voigt rings). Motivation: the patched grid's per-cell voxel count scales
  with arc length ∝ |Q|, starving the low-|Q| patches; the parametric fit pools
  all azimuths per radial shell for uniform statistics.

### A/B status (2026-06-16)

Compared with `examples/compare_ring_models.py` (representative H planes, same
confirmed shells). The two are **close** but fail in *opposite* directions:
**patched over-subtracts** (digs shallow negative troughs at the ring centres,
worst at the first, non-Al ring) while **parametric rolling under-subtracts**
(leaves ring behind, most on the H=1/3 plane). Judged on the slice
figures below, **patched hugs the diffuse baseline better overall and was kept as
the default** (until `pooled`, 2026-10); parametric rolling is a validated,
selectable alternative.

### The dominant residual error is texture-contrast compression

The main arc-by-arc error in **both** models is that the fitted azimuthal texture
`T(φ)` is **flattened toward its φ-mean**. At the Al 111 line (|Q|≈2.69 Å⁻¹,
H=0) every model reaches only roughly half the azimuthal contrast of the
data-truth ring excess. So `T(φ)` sits *below* truth at the bright arcs
(→ under-subtraction / leftover) and *above* it at the dim arcs
(→ over-subtraction / digs a hole). Cause: the harmonic ridge (`texture_ridge`,
penalty ∝ order², with the mean `c₀` left free) + Fourier truncation
(`n_fourier`) + the amplitude ceiling. A constant/background offset **cannot** fix
this — it shifts every azimuth equally, whereas the error is *differential*; the
lever is texture **contrast** (lower `texture_ridge`, higher `n_fourier`).

> **Metric caveat.** The mean per-shell "ring removed %" is *blind* to this,
> because the bright-under and dim-over errors cancel in the azimuthal average
> (parametric scores almost perfectly at H=0 with a visibly wrong texture). Judge ring
> quality on the azimuthal **texture overlay** and the **per-φ / diverging
> residual** figures, not on the mean %.

### A/B tooling

- `examples/compare_ring_models.py` — per-plane metrics + three figures: (a) the
  magma `data | patched | parametric` residuals; (b) a **diverging
  deviation-from-baseline** map (red = ring leftover, blue = over-subtraction)
  that makes over-subtraction visible — the magma view hides it; (c) a 1-D
  azimuthally-averaged **ring-residual profile** vs |Q| measured against one
  common diffuse baseline.
- `examples/tune_parametric_ring.py` — the azimuthal **texture overlay**
  (data-truth `median_on(φ) − median_off(φ)` vs each model's `T(φ)` at a shell);
  the diagnostic that exposes the contrast compression.

## Legacy Factored Ring Algorithm

The older algorithm is still useful background and remains available for
comparison. It assumes a shared azimuthal texture across all rings.

### Step 1 — Empty-scan subtraction  (`EmptySubtractor`)

```
I_residual(Q) = I_sample(Q) − s × I_empty(Q)
```

The empty-environment scan removes the cryostat/furnace ring. The scale `s` is estimated
analytically by minimising the residual in a ring-dominated |Q| window
(`s = Σ I_sample·I_empty / Σ I_empty²`). A residual ring from the **sample holder**
remains, because the holder is present only during the sample scan.

### Step 2 — Factored ring model  (`PatchedRingModel`)

Detect ring |Q| positions, then fit the factored model:

1. **Detect rings** (`detect_ring_shells`): bin voxels into a 1D radial profile, estimate a
   baseline with a rolling median (robust to peaks wider than the ring), subtract it, and
   pick peaks above a noise threshold. Returns ring |Q| ranges `(q_lo, q_center, q_hi)`.
2. **Azimuthal patches**: divide φ ∈ [0, 2π) (in a reference plane, default hk0,
   φ = atan2(k_Q, h_Q)) into N overlapping Hann-weighted patches.
3. **Per-patch NNLS**: with ring positions qᵢ and widths σᵢ fixed from the global fit,
   solve a non-negative least-squares problem for the per-patch amplitudes →
   amplitude matrix `A[n_rings × n_patches]`.
4. **Rank-1 SVD** of `A`: `A[i, P] ≈ Aᵢ × T[P]` → per-ring amplitudes and per-patch
   texture values.
5. **Fourier series** fit to `(φ_P, T[P])`: `T(φ) = c₀ + Σₖ (aₖ cos kφ + bₖ sin kφ)`.
   Smooth, periodic, C∞ → C¹ continuity across patch boundaries is automatic.

Subtract the full model from **every voxel**. Voxels where the ring dominates
(`I_ring / σ_data > threshold`) are masked for backfill downstream.

> **Note on aluminium**: Al (FCC, Fm-3m, a ≈ 4.046 Å) is the most common source.
> Its peak positions can be pre-computed with `al_ring_q_positions()` and passed as
> `ring_hints` to seed the fit. But the algorithm is material-agnostic and works
> without this prior.

### Step 3 — (removed) ring-shell backfill

This workflow used to mask the ring shell and refill it by interpolating across
it (`backfill_ring_shells`, with a TV-inpainting fallback). Both were removed:
the production ring stage subtracts the ring model instead, and any voxel it
masks is filled by the Bragg backfill from its own surroundings (see
[inpainting.md](inpainting.md)).

## Diagnostics

The factored model assumes all rings share one T(φ). Check this after fitting:

- `rank1_variance` — fraction of amplitude-matrix variance explained by the rank-1
  (shared-texture) approximation. Values ≥ 0.90 confirm the assumption. Lower values
  indicate that higher-|Q| rings have a different azimuthal texture and may need per-ring
  T_i(φ) fits.
- `per_ring_texture_residual()` — per-ring RMS deviation from the shared T(φ); identifies
  which ring drives a rank-1 failure.

## Artifact considerations

| Artifact | Cause | Mitigation |
|----------|-------|-----------|
| Residual ring after subtraction | Gaussian width too narrow | Widen σᵢ; check detection |
| Texture mismatch | Shared T(φ) too restrictive | Inspect `rank1_variance` |
| Over-subtraction of diffuse | Ring model absorbs diffuse | Reduce detection sensitivity |
| Gibbs ringing in ΔPDF | Hard mask boundary | Sigmoid taper (`taper_width > 0`) |

## References

- Weber & Simonov, *Z. Kristallogr.* 227, 238–247 (2012) — 3D-ΔPDF.
- Simonov, Weber & Steurer, *J. Appl. Cryst.* 47, 2011–2018 (2014) —
  3D-ΔPDF and punch-and-fill.
