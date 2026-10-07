# Powder Ring Removal

## Purpose

Polycrystalline material in the beam path can add powder rings to a single-crystal
diffuse scattering volume. Common sources include the sample environment,
cryostat, sample holder, and capsule walls.

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
   confirmed shells through an envelope 1.5 × FWHM wide (room for the
   direction-dependent position) and capped at 8 × the shell's across-stack
   amplitude.
5. Subtract the excess, interpolated bilinearly over (φ, |Q|) at every voxel.
   The sampling-mask spokes are masked as in the per-plane models.

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
`pool_target_count` (12) and `al_prior` (on). The diagnostics sidecar
(`*_ringremoved_diagnostics.json`) lists each shell with its detection route.

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
`PatchedRingModel`, but the current real-data driver uses
`PatchedRadialRingModel` through `examples/remove_rings_3d.py`.

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
comparison. It assumes a shared azimuthal texture across all rings and then
optionally backfills masked shells.

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
| Biased fill values | Interpolation can't capture sharp diffuse | TV fallback; tune λ |

## References

- Weber & Simonov, *Z. Kristallogr.* 227, 238–247 (2012) — 3D-ΔPDF.
- Simonov, Weber & Steurer, *J. Appl. Cryst.* 47, 2011–2018 (2014) —
  3D-ΔPDF and punch-and-fill.
