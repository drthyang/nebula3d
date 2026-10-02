# Bragg Cleanup

## Purpose

Before 3D-ΔPDF, sharp Bragg and satellite peaks must be removed from the
diffuse volume and replaced with a plausible diffuse background. The current
workflow is:

```text
ring-removed volume
    -> BraggRemover.build_mask()
    -> backfill_bragg()
    -> cleaned diffuse volume
```

The direct beam at `(0,0,0)` is handled separately from ordinary Bragg peaks.

In practice, use the guarded `mode="both"` workflow for current real-data QA:
integer-node Bragg peaks are handled with lattice-aware punches, and the
hkl-agnostic search stage is constrained so it does not remove known
fractional-H diffuse planes.

## Detection Modes

`BraggRemover(mode=...)` supports three modes:

| Mode | Behavior |
|------|----------|
| `integer` | Enumerate integer `(h,k,l)` nodes and decide per node whether a peak is present. |
| `search` / `auto` | Search all valid voxels for sharp high-tail outliers in robust `|Q|` shells. |
| `both` | Run `integer` first, punch those peaks, then run `search` on the residual. |

The current visual preference is guarded `mode="both"`: integer-node Bragg peaks
are handled lattice-aware, while search catches off-integer satellites where it
is safe to do so.

## Integer-Node Path

The integer path is lattice-aware:

1. Enumerate integer `(h,k,l)` nodes in the volume.
2. Inspect a local HKL window around each node.
3. Keep the node only if a real nearby peak is present:
   - `min_intensity`
   - `min_prominence`
   - optional `integer_n_mad` against a robust per-`|Q|` shell level.
4. Recenter to the measured local peak.
5. Optionally fit peak position and shape:
   - `integer_optimize_position=True` moves the centre to the core's centroid.
   - `integer_optimize_shape=True` fits a **tilted** ellipsoid following the
     peak's measured orientation, in Q:
     - The core is the voxels connected to the peak whose excess is at least
       `integer_fit_threshold_frac` (0.35) of the peak's. It is measured in a
       window `max_radius_scale`× the resolution ellipsoid, the same extent in
       Å⁻¹ along every axis.
     - The excess-weighted covariance is mapped to Q (`Σ_Q = UB·C·UBᵀ`) and
       divided by `κ = P(χ²₅ ≤ c)/P(χ²₃ ≤ c)`, `c = 2 ln(1/0.35)`. The 35 % core
       of a Gaussian has only 0.61× its width; κ restores σ.
     - Principal radii are `integer_fit_radius_n_sigma`·σ plus half a voxel,
       along the Q principal axes.
     - The ellipsoid is clipped to contain the resolution ellipsoid of the
       punch frame and lie inside `max_radius_scale`× it (in the frame where
       the resolution ellipsoid is a unit sphere, so the clip is the same in
       HKL or Q).
     - A peak whose core cut is within `integer_fit_noise_n_mad` (3) noise
       sigmas of the background is not measured; it gets the resolution
       ellipsoid. Its core would follow the surrounding signal, not the peak.
     - The φ-tail folds in as a rank-1 tangential inflation.

     The diagonal fit it replaced (three radii along H, K, L, no tilt, floored
     at the base ellipsoid's HKL bounding box) was removed.
6. Punch a continuous-HKL ellipsoid at the fitted centre.

Useful guards:

- `integer_h_guard_hkl`: clips integer-node punches to a slab around the source
  integer-H plane. This prevents strong integer-H Bragg holes from extending into
  fractional-H diffuse planes such as `H=±1/3` or `H=±2/3`.
- `integer_fit_max_radius_hkl`: caps fitted per-peak radii.

### Small but sharp weak Bragg (`integer_local_prominence_n_mad`)

Weak Bragg peaks at integer nodes can sit below the absolute `min_intensity` /
`min_prominence` floors yet still be sharp, local outliers. A purely
sharpness-based catch over the whole volume just finds noise (a small spike in a
flat region looks "sharp"); the reliable discriminator is **position** — Bragg
sits at integer nodes, which are 4–5× more likely to carry a residual sharp peak
than random control positions. So the catch is applied **only at integer nodes**:

- `integer_local_prominence_n_mad`: keep a node when its prominence
  `(peak − local_bg)` is at least this many **local** MADs (measured in the
  detection window), regardless of the absolute floors and the `|Q|`-shell
  threshold. `integer_local_min_prominence` adds an optional small absolute floor
  to reject pure noise in flat regions.

Because it is locked to integer nodes (never a fractional-H plane) and obeys
`integer_h_guard_hkl`, it cannot touch the q=1/3 diffuse. Default `cc_on` value
is `8` (~+0.4 % extra punched on test data, all at lattice nodes).

## Search Path

Search mode is hkl-agnostic. At each `|Q|`, it estimates a robust background
(`median + n*MAD`) and keeps local maxima above that level and the absolute
floor.

Because search does not know the lattice or magnetic diffuse planes, protect
known fractional-H diffuse planes. Either an explicit centre list or — preferred
for a modulation that repeats at every integer — a **periodic** fractional rule
that shields the whole family across the full H range:

```text
# explicit centres (fixed planes only):
SEARCH_EXCLUDE_H=-0.6667,-0.3333,0.3333,0.6667
# OR periodic: protect every integer±1/3 plane (q=1/3 family: ±1/3, ±2/3,
# ±4/3, ±5/3, ±7/3 …):
SEARCH_EXCLUDE_H_FRACTIONS=0.3333,0.6667
SEARCH_EXCLUDE_H_WIDTH=0.08
```

`search_exclude_h_fractions` matches H by its fractional part mod 1, so a single
setting covers the higher-order satellites (`±4/3`, `±5/3`, …) that a fixed
centre list misses. This allows `mode="both"` to keep useful off-integer
satellite detection without punching structured diffuse on any thirds plane.

## Direct Beam

The direct beam is not a Bragg reflection. It is punched after ordinary peak
detection using independent settings:

```text
INCIDENT_ELLIPSOID_R_HKL=0.15,0.50,1.00
INCIDENT_SPHERE_R_HKL=
```

The ellipsoid is sized from H/K/L linecuts through the origin. The direct-beam
backfill uses a special just-outside-`|Q|` shell so the fill does not sample the
negative over-subtraction halo adjacent to the beam.

## Punch Coordinate Space (Q)

The punch ellipsoid is sized in **Q** (Å⁻¹). The physical peak profile —
instrument resolution plus size/strain/mosaic — is a function of Q and does not
depend on the lattice constants. Radii in fractional HKL, the original footprint
(`((H−h₀)/rh)² + ((K−k₀)/rk)² + ((L−l₀)/rl)² ≤ 1`), baked the reciprocal-lattice
scaling in: the old `(0.09, 0.12, 0.45)` r.l.u. default, a 5× anisotropy in HKL,
is ~0.07–0.11 Å⁻¹ — nearly isotropic in Q — and an HKL-axis ellipsoid shears
relative to the resolution ellipsoid on oblique cells. That frame was removed;
`punch_frame="hkl"` now raises.

**A single quadratic-form kernel** `δhklᵀ A δhkl ≤ 1` (`_ellipsoid_inside`)
covers every shape:

| Shape spec | `A` |
|------------|-----|
| spherical frame `(rρ, rθ, rφ)` (Å⁻¹) | `UBᵀ R diag(1/r²) Rᵀ UB`, `R = [ρ̂ θ̂ φ̂]` at the peak |
| Q isotropic radius `ρ` (Å⁻¹) | `g / ρ²`, `g = UBᵀUB` |
| Q per-axis radii `(ra,rb,rc)` (Å⁻¹) | `Pᵀ diag(1/r²) P`, `P = ê·UB` |
| fitted resolution ellipsoid (Phase 3) | per-peak 3×3 `A` from the covariance (φ-tail = rank-1 mod) |

**The spherical frame is the default** (`punch_frame="spherical"`,
`punch_spherical_radii=(0.097, 0.072, 0.115)` Å⁻¹ along each peak's radial,
polar and azimuthal axes). `punch_frame="q"` takes one Q-sphere
(`punch_q_radius`) or fixed a*/b*/c* radii (`punch_q_radii`). The radii are the
**resolution floor**: the per-peak covariance fit always contains this
ellipsoid and grows it along the peak's own principal axes where the peak is
wider; peaks without a fit (off-integer search peaks, peaks too weak to
measure) use the base ellipsoid itself. The frame's axes are an assumption
about the peak shape: on the TbTi3Bi4 100K volume the measured long axes sit
a median 38° off φ̂, so the fitted tilt matters. The `margin` guard band is in
Å⁻¹ too, added to the principal radii in Q. Validate a frame change with the
full-pipeline ΔPDF A/B in `examples/compare_delta_pdf_frames.py`.

Phase 0/1/2/3 and spherical-frame tests live in
`tests/test_bragg_qspace_*.py`.

## Backfill Modes

`backfill_bragg` supports:

| Method | Use |
|--------|-----|
| `local` (default) | Fill each connected component from a local dilated shell median. |
| `laplace` | Harmonic (Laplace) interpolation of the surrounding diffuse into each hole; boundary taken `laplace_gap` (default 1) voxels outside the punch so leaked Bragg tails do not bias it. Solved in memory-bounded batches; a masked region over `laplace_max_unknowns` (2 M, i.e. unmeasured coverage) gets the `local` fill. |
| `q_shell` | Robust radial background at the same `|Q|` — comparison only, see below. |

`local`, `q_shell` and `laplace` take the punch record (`punched=`, which the
pipeline's punch stage stores in its artifact), so a hole that touches
unmeasured coverage is still filled from its own surroundings instead of merging
with the coverage; see [inpainting.md](inpainting.md).

Holes must be filled from the diffuse **around** them (the 3D-ΔPDF
punch-and-fill convention: NXRefine's Laplace/Matérn fill, Mantid
`DeltaPDF3D`'s convolution fill, KAREN), not from a global background level.
Every punch sits on a reciprocal-lattice node, so any bias of the fill *at the
nodes* is repeated on the lattice, and its Fourier transform lands as spurious
ΔPDF features at the lattice vectors — where the real correlations are. The
`|Q|`-shell median is biased exactly there: correlations at lattice-vector
separations peak or dip *at* the nodes, and a whole-shell median averages them
away. On a synthetic test (short-range order + node-peaked diffuse + Bragg) the
`q_shell` fill left lattice-vector artefacts of ~2.3 % of the ΔPDF signal;
`local` ~1 % and `laplace` ~0.8 %, with or without Bragg tails leaking past the
punch. A flat `local` fill still leaves a small step at the hole edge;
`laplace` removes it and has the smallest long-range sidelobes.

Real-data QA uses `METHOD=local` for ordinary Bragg holes and keeps the special
direct-beam fill enabled.

## Recommended QA Settings

```bash
PUNCH_PRESET=cc_on MODE=both MIN_I=0.8 MIN_PROM=0.8 \
INTEGER_FIT_POSITION=1 INTEGER_FIT_SHAPE=1 INTEGER_H_GUARD=0.12 \
SEARCH_EXCLUDE_H=-0.6667,-0.3333,0.3333,0.6667 SEARCH_EXCLUDE_H_WIDTH=0.08 \
BACKFILL_METHOD=local
```

Inspect `H=0` for residual Bragg peaks and `H=±1/3`, `±2/3` for diffuse
preservation.
