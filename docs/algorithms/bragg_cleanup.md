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

1. Enumerate integer `(h,k,l)` nodes in the volume: every node, or with
   `supercell=(n_h, n_k, n_l)` the parent lattice's only (see below).
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

     With the profile-matched punch (the default, see below) the fit still
     sets the centre, but the footprint follows the learned Bragg profile.
6. Punch a continuous-HKL ellipsoid at the fitted centre.

Useful guards:

- `integer_h_guard_hkl`: clips integer-node punches to a slab around the source
  integer-H plane. This prevents strong integer-H Bragg holes from extending into
  fractional-H diffuse planes such as `H=±1/3` or `H=±2/3`. The pipeline's
  0.12 r.l.u. is for TbTi3Bi4. Turn it off (`None`; web: H guard 0) where no
  fractional-H plane needs it.
- `integer_fit_max_radius_hkl`: caps fitted per-peak radii.

**A volume indexed on a supercell** (`supercell`; web: Supercell H/K/L). The
Fe3Ge2 TOPAZ volume is reduced on a 2×2×2 cell, so its Bragg nodes are the
all-even ones. The other integer nodes fall into two groups:

- with odd L and an odd in-plane index: short-range 2×2×2 order, the maxima
  of the diffuse L-rods (median excess 15 against 290 at the parent nodes).
  These peaks are 1.7× the Bragg width in-plane and 3.3× along L;
- the rest: empty (forbidden positions).

Without the supercell, `mode="both"` took 18 % of the superlattice nodes'
intensity and 9 % of the rods'. Two settings fix this, and both are needed:

- `supercell=(2, 2, 2)` restricts the integer nodes to the parent lattice;
- `mode="integer"` stops the search pass, which finds the superlattice maxima
  on its own.

The H guard must also be off: it stopped the brightest parent peaks one voxel
along H, which left a 2.5σ tail. With all three settings:

- the rods and superlattice nodes are untouched;
- the 298 brightest parent peaks leave less than 0.1σ in every direction.

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

## Significance Gate

Every detection, integer node or search summit, must also be significant
against its own error (`min_significance`, pipeline default 5):

```text
z = Σ (I − bg) / √Σ σ²
```

The sum runs over the voxels inside the resolution (punch-frame) ellipsoid
scaled by `significance_aperture` (0.5), centred on the brightest voxel. `bg`
is the median of the detection window and `σ` the volume's per-voxel error.
Voxels without a usable `σ` take the window's robust scatter (1.4826·MAD), and
`significance_noise="mad"` uses that scatter everywhere, for volumes whose
`sigma` is not a real error estimate. A peak with no error estimate at all is
kept.

Why it is needed: the search threshold (median + n·MAD per `|Q|` shell, plus
an absolute floor) is set by the whole shell. Where the noise is higher than
the shell's, single-voxel noise clears it. On CORELLI this happens at the
high-`|Q|` edge of the coverage. There, low exposure turns one or two counts
into a spike of order 1 after normalisation, at I/σ ≈ 1–2.

On TbTi3Bi4 22 K (cc chain), 4,349 of 8,572 search peaks and 128 of 4,549
integer peaks were below 5σ, all at `|Q|` ≈ 6.9–8.3 Å⁻¹ (|K| > 9.7). They merged
into two 139k-voxel holes, 11 % of everything punched. The gate removes them
and leaves the interior alone: 8 integer nodes are lost there, one
mmm-symmetric family at z ≈ 4.5.

The aperture is half the resolution ellipsoid because a full one can sum a
weak peak together with the structured background around it. (±2,0,±7) is a
13σ single-voxel excess: z = 16 at half the ellipsoid, 3.6 at the full one.

The intensity scaling's reference (`intensity_ref=None`, the median intensity
of the detections) counts the candidates the gate rejects, so the gate changes
which peaks are punched, not how large. With the gate the reference moves by
0.9 % (22 K) to 2.5 % (100 K).

The noise peaks had pulled that reference down. Measured on the kept
detections alone it would rise from 1.64 to 2.69 on 22 K. Even the
integer-node median shrinks every scaled punch: 4–16 % fewer interior voxels
punched (22–100 K), and the brightest peaks' tails left outside more often
(69 → 80 % of holes at 100 K). That is a punch-size question; it belongs with
the punch shape, not the gate.

`detect_window_q` (Å⁻¹, off by default) sizes the detection window like the
rest of the punch, capped at 0.3 r.l.u. per axis. It is not the default: on
22 K it adds ~1,200 integer nodes (864 in the interior) that have not been
validated.

## Profile-Matched Punch

The pipeline default (`punch_footprint="profile"`, `profile_n_sigma=0.5`)
punches each peak as far as its own tail is measurable. The tail shape comes
from the dataset itself.

**Why.** On TbTi3Bi4 the brightest interior integer peaks, stacked
(normalised to their peak excess) along each peak's local axes, have:

- a compact core, falling to 10 % within 0.07–0.09 Å⁻¹ in every direction;
- no tail along ρ̂ (radial, |Q|): at noise by ~0.12 Å⁻¹;
- an exponential tail along θ̂ (polar, toward c*): 0.3–0.47 Å⁻¹ to 3× the
  noise, longest for in-plane Q, and a shorter one along φ̂ (azimuthal);
- a tail that scales with peak intensity, grows with |Q|, and barely changes
  from 22 to 100 K.

For Q nearly along c* the tail stays along θ̂ rather than ρ̂, so it is not a
streak along c*. It is the spread in tilt of the crystal's c axis (mosaic).
That is Bragg intensity, and it should be punched. The ellipsoid punch fitted
the core, which is the same width in every direction, so it could not see the
tail; its base radii even had θ̂ as the *shortest* axis. On 22 K, 36–43 % of a
bright peak's ellipsoid was background, yet 59 % of the brightest holes had a
tail leaking on one side.

**How.**

1. *Learn the profile* (`BraggRemover._learn_profile`):
   - take up to `profile_calibration_peaks` (400) of the most significant
     integer peaks: more than 1 Å⁻¹ from the origin, window ≥ 90 % measured;
   - for each, sample the excess over its own background (the median beyond
     0.4 Å⁻¹), divided by its centre excess, in thin cylinders along ρ̂, θ̂ and
     φ̂; voxels nearer another detected peak are dropped;
   - take the medians in up to `profile_q_bins` (3) |Q| ranges, each with at
     least 20 peaks.
2. *Make the template* (`_bragg_template`). Per axis this is the Gaussian
   fitted to the core, or the measured profile where it reaches further. A
   halo common to every direction is kept (see *The halo* below).
3. *Size each peak* (`_with_profile_shape`). Along each of its ρ̂, θ̂, φ̂ the
   radius is where its predicted tail, the peak excess × the profile
   (interpolated in |Q|), falls to `profile_n_sigma` × the local noise. That
   noise is the median `sigma` in the detection window.
   - The punch-frame radii are the floor and `profile_max_radius_q` (0.5 Å⁻¹)
     the ceiling, then `margin` is added.
   - There is no intensity scaling. The integer peak's covariance fit still
     sets its centre but not its shape.
   - The H guard still applies.
   - With fewer than 20 calibration peaks every peak keeps the ellipsoid; the
     run log says which was used.

**Effect** (old = before the gate; gate = ellipsoid with the 5σ gate; new =
profile, k = 0.5):

| | 22 K | 45 K | 100 K |
|---|---|---|---|
| brightest holes with a one-sided leak, old → gate → new | 59 → 59 → 29 % | 59 → 60 → 38 % | 69 → 70 → 53 % |
| all holes with a one-sided leak | 30 → 31 → 17 % | 27 → 28 → 22 % | 30 → 29 → 22 % |
| punched voxels within 1σ of their surroundings | 38 → 34 → 35 % | 40 → 35 → 36 % | 38 → 37 → 37 % |
| voxels punched (M) | 2.52 → 2.26 → 2.74 | 2.49 → 2.23 → 2.63 | 2.13 → 2.05 → 2.51 |
| back-FFT r, whole volume | 0.9987 → 0.9990 → 0.9986 | 0.9990 → 0.9990 → 0.9995 | 0.9984 → 0.9984 → 0.9991 |
| back-FFT r, H = 0 plane | 0.9973 → 0.9984 → 0.99995 | 0.9933 → 0.9972 → 0.9967 | 0.9875 → 0.9938 → 0.9934 |

The ΔPDF changes most beyond 5 Å. Against the gate's ellipsoid on 45 K
(r = 0.91), its RMS is 11–21 % lower from 5 to 40 Å. At the lattice vectors
it is 25 % lower at 5–10 Å and 12–17 % lower beyond 20 Å. Less
lattice-periodic signal is what removing leftover Bragg tails gives; the
nearest-neighbour range (2–5 Å) moves by 2.5 %.

**Caveats.**

- The punch is ~20 % larger, and more of it is in merged holes: tails join
  neighbouring L nodes, 0.25 Å⁻¹ apart.
- It removes anything that rises around a node, thermal diffuse included. On
  the synthetic demo volume, whose thermal diffuse streaks transversely, the
  demo benchmark scores 2–3× its collateral. On TbTi3Bi4 the tail does not
  change with temperature, so it is mosaic. Check the stacked profile
  (`footprint_profile` in the Bragg profile JSON) on a new sample or at
  higher temperature.
- The H guard stops integer punches at |ΔH| = 0.12 r.l.u., but the brightest
  peaks' tails reach the H = ±1/3 planes (0.36 Å⁻¹). About a third of the
  remaining leak voxels sit at the guard faces.

**The halo.** Until 2026-10 the template kept only the core along ρ̂, and
across Q only the excess over the radial profile. The reasoning was that a
halo common to every direction is thermal diffuse. TbTi3Bi4 has no such halo,
so this made no difference there.

The Fe3Ge2 TOPAZ volume (90 K, 0.1 r.l.u. voxels) has a halo on every axis.
The stacked profile is still 0.4 % of the peak 0.17 Å⁻¹ out; for (0,−6,0),
with an excess of ~9,900 on a background of 33, that is 40 counts. The halo is
the peak's own:

- it falls off exponentially, over ~0.04 Å⁻¹, where thermal diffuse falls as
  1/q²;
- relative to the peak it is the same in all three |Q| bins (5.9, 8.4 and
  11.4 Å⁻¹), where thermal diffuse would grow as Q², 3.7×.

Left outside the punch, the halo was a bright rim around each bright node.
The fill took its boundary a voxel further out and skipped it, so these holes
looked like coffee beans. The template now keeps the halo; for the combined
effect with the fill change, see *The gap band is filled too* under Backfill
Modes.

`punch_footprint="ellipsoid"` restores the fitted ellipsoid scaled by the cube
root of the intensity (driver: `PUNCH_FOOTPRINT=ellipsoid`; run request:
`punch_footprint`, `punch_profile_n_sigma`).

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

## Symmetrised Volumes

A volume symmetrised over a Laue group holds the same value at every
equivalent voxel, so the punch must treat those voxels alike. On a hexagonal
grid it did not. The Fe3Ge2 90 K volume is symmetrised over 6/m, and its raw
data are exactly invariant. Yet 22 % of the punched voxels had an unpunched,
measured 60° partner. Three things broke the symmetry (measured on the raw
volume):

- **The H-only rules.** `integer_h_guard_hkl` clips punches to an H slab, and
  `search_exclude_h_fractions` protects H planes, but the 6-fold maps H planes
  onto K and H+K planes. With both off, 3 % of the punched voxels stayed
  asymmetric instead of 22 %.
- **Boxes on the HKL grid.** The detection windows and the 3×3×3 neighbourhoods
  are not mapped onto themselves by the 6-fold, which sends the (1, 1) corner
  of a 3×3 square to (−1, 2). Partners got different window backgrounds:
  180 integer nodes passed the 5σ gate while a partner failed it (z ≈ 5.15
  against 4.86). Search summits failed the local-maximum test at their partner.
- **The refined UB.** It is 0.4 % off hexagonal: |a*| and |b*| differ by
  0.12 %, and γ* = 60.02°. Partners then fall in different |Q| shells.

No footprint built in Q can remove the last cause. The data were symmetrised
on the grid, so the punch is made invariant there.
`PipelineParams.symmetry="auto"` (the default) reads the operations the input
declares; the NeXus Viewer writes them as `/entry@symmetry_ops`.
`BraggRemover.symmetry_ops` then shares every punch decision across the orbit:

- A voxel punched at one equivalent position is punched at all of them. In
  `mode="both"` this also applies to the integer pass, before the search runs
  on its residual.
- `integer_h_guard_hkl` and the search exclusions hold on every plane
  equivalent to the H planes they name. With 6/m the guard becomes a hexagonal
  prism: |ΔH|, |ΔK|, |Δ(H+K)| ≤ 0.12.

The punch takes the union, not the intersection: a Bragg tail left in the data
does more harm than a voxel of diffuse that the backfill fills. The coverage-edge
trim is shared the same way. On Fe3Ge2 (float32, rings + punch):

| run | punched | with an unpunched partner | added by the orbit |
|-----|--------:|--------------------------:|-------------------:|
| before | 1,399,376 | 308,989 (22 %) | — |
| symmetry, default guards | 1,368,518 | 0 | 77,625 |
| symmetry, H guard and thirds off | 1,545,632 | 0 | 80,191 |

The edge trim went from 1,302,270 voxels (15 % with a kept partner) to
1,632,010, none of them with a kept partner. Mirror and inversion partners
agree too.

`symmetry=None` ignores a declaration and reproduces the earlier punch bit for
bit. Under `"auto"`, operations that do not map the grid onto itself are
reported and ignored; the 6-fold, for example, needs equal H and K steps. The
H guard and the thirds exclusion are TbTi3Bi4 settings; turn them off for
Fe3Ge2 (see the supercell notes above). The ring stage still breaks the
symmetry where it subtracts: after it, 3.6 % of the voxels differ from their
partner. The punch mask no longer depends on that. Tests:
`tests/test_symmetry.py`.

## Backfill Modes

`backfill_bragg` supports:

| Method | Use |
|--------|-----|
| `laplace` (default) | Harmonic (Laplace) interpolation of the surrounding diffuse into each hole; boundary taken `laplace_gap` (default 1) voxels outside the punch so leaked Bragg tails do not bias it, and the voxels in between filled too. Solved in memory-bounded batches; a masked region over `laplace_max_unknowns` (2 M, i.e. unmeasured coverage) gets the `local` fill. |
| `local` | Fill each connected component from a local dilated shell median: flat, a step below the rim, one value per merged hole. |
| `q_shell` | Robust radial background at the same `|Q|` — comparison only, see below. |

`local`, `q_shell` and `laplace` take the punch record (`punched=`, which the
pipeline's punch stage stores in its artifact), so a hole that touches
unmeasured coverage is still filled from its own surroundings instead of merging
with the coverage; see [inpainting.md](inpainting.md).

All three fill only inside the measured support: punch holes, and unmeasured
pockets that measured data enclose (the direct-beam shadow, dead voxels).
Unmeasured space that reaches the box edge (past the coverage, or a gap where
the coverage edge meets a box face) stays masked, and the ΔPDF reads it as
zero (`unmeasured="enclosed"`, the default since 2026-10-07; `"all"` restores
the old fill of everything). See *What is filled* in
[inpainting.md](inpainting.md).

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

**Judged on real data: the moved-hole test** (`bragg_qa.refill_test`). The
punch's own holes are shifted by half a node step along K (8 voxels), into
measured diffuse between the nodes. They are filled together with the real
holes and compared with the data actually there. The holes keep the real
shapes: long θ̂ holes and merged columns. Each sits at the same offset from its
node, so their fill errors are lattice-periodic, as real ones are.

On TbTi3Bi4 (profile punch, 2,200–3,600 moved holes per temperature):

| | 22 K | 45 K | 100 K |
|---|---|---|---|
| per-hole mean error, `local` → `laplace` | +0.036 → +0.015 σ | +0.024 → +0.015 σ | +0.024 → +0.018 σ |
| ΔPDF error at the lattice vectors, % of the real ΔPDF there (`local` / `laplace`) | 0.6–3.8 / 1.0–3.7 % | 1.2–6.4 / 2.2–6.6 % | 2.9–5.0 / 1.6–5.2 % |

So the fill of ordinary diffuse texture is a minor error source, and the two
fills are equal in the ΔPDF within the test's scatter. `laplace` is the
default because:

- its per-voxel bias is smaller at every temperature;
- it leaves no step at its boundary (−0.01σ against `local`'s −0.18σ);
- it follows gradients across the long merged holes of the profile-matched
  punch, where `local` puts one flat value.

The strong ΔPDF features *at* the lattice vectors are not fill errors.
Correlations between the same site in different cells sit exactly there.

**Why not a fill that follows the rise toward the node** (biharmonic, a
curvature fit)? The first shell outside a hole is 0.2–0.4σ above its
surroundings, barely more at 100 K than at 22 K, while thermal diffuse would grow
several-fold. The profile-matched punch stops where the predicted tail falls
to 0.5σ, so that rise is mostly residual Bragg tail; continuing it would put
Bragg intensity back under the nodes. The stacked profiles also show no radial
halo even around the brightest peaks, so the thermal diffuse under the nodes is
weak here. On a sample with strong thermal diffuse this changes: see the
demo-volume benchmark, where both fills under-fill node-centred thermal
diffuse by ~70–75 %.

**The gap band is filled too (2026-10).** The boundary sits `laplace_gap`
voxels outside the punch, past the tail left at its edge. That band used to be
solved and then discarded, so its measured values stayed in the output. They
hold exactly the tail the boundary skips, so every hole had a rim brighter than
its fill: a step the fill never saw. On 22 K the first kept voxel sat 0.27σ
above the fill (median over holes). On the Fe3Ge2 volume, whose punch also
left the halo outside (see *The halo*), it sat 0.63σ above, and 61 % of the
holes stepped by more than 0.5σ: its bright nodes looked like coffee beans.

The fill now writes the band too and meets the kept data only at its
boundary. The hole values do not change (the band was always solved), so the
moved-hole test above is unchanged. On the moved holes' own bands, the written
values are unbiased (+0.004σ on 22 K, +0.08σ on Fe3Ge2). Their scatter about
the data is that of a 3³ box mean of the data.

Old → new, with the halo template (float32 runs, `floor` flatten):

| | 22 K | Fe3Ge2 90 K |
|---|---|---|
| punched voxels | 2.74 → 2.80 M | 1.00 → 1.40 M |
| measured voxels the fill replaces | 0 → 1.41 M | 0 → 1.26 M |
| step from the fill to the first kept voxel, median | −0.27 → +0.01σ | −0.63 → +0.04σ |
| holes stepping down by more than 0.5σ | 23 → 0.06 % | 61 → 0.06 % |
| back-FFT r, whole volume | 0.99876 → 0.99912 | 0.99995 → 0.99999 |
| back-FFT r, H = 0 plane | 0.99994 → 0.99940 | 0.99991 → 0.99999 |
| ΔPDF r, old vs new: 2–5 / 10–20 / 40–80 Å | 0.999 / 0.994 / 0.934 | 0.988 / 0.968 / 0.976 |
| ΔPDF RMS at the lattice vectors: 5–10 / 20–40 / 40–80 Å | +15 / −4 / −6 % | −14 / +13 / −8 % |

The lattice-vector changes have mixed sign, and no truth-free metric yet says
which is better. Where the search pass chops a diffuse rod (the Fe3Ge2 L-rods),
the band widens the chop by a voxel. A Laplace fill cannot carry a rod through
a hole, so the rod dims there.

The direct beam keeps its special just-outside-`|Q|` fill.

## Checking A Punch

Two diagnostics measure a punch + fill without changing it:

- `examples/qa_punch_fill.py` (real data). It reports:
  - how significant each detection is, and where the ones under 5σ sit in `|Q|`;
  - hole sizes and how much of the punch is in merged holes;
  - per hole, the excess in shells outside it by distance in Å⁻¹. A tail
    leaking on one side shows in the first shell's 90th percentile, not its
    median;
  - the share of punched voxels within 1σ of their surroundings (background
    punched for nothing);
  - the fill against those shells;
  - with `REFILL=laplace,local`, the moved-hole test for each fill (above).
- `examples/benchmark_punch_fill.py` (ground truth). It runs on the synthetic
  demo volume, whose Bragg, diffuse and noise are known, and scores:
  - the Bragg left behind and the diffuse removed;
  - false detections;
  - the fill bias in the holes;
  - the 3D-ΔPDF error at the lattice vectors.

  It has a clean scenario and a low-exposure-edge one.

The metrics are in `nebula3d.analysis.bragg_qa`.

## Recommended QA Settings

```bash
PUNCH_PRESET=cc_on MODE=both MIN_I=0.8 MIN_PROM=0.8 \
INTEGER_FIT_POSITION=1 INTEGER_FIT_SHAPE=1 INTEGER_H_GUARD=0.12 \
MIN_SIGNIFICANCE=5 PUNCH_FOOTPRINT=profile PROFILE_N_SIGMA=0.5 \
SEARCH_EXCLUDE_H_FRACTIONS=0.3333,0.6667 SEARCH_EXCLUDE_H_WIDTH=0.08 \
BACKFILL_METHOD=laplace
```

Inspect `H=0` for residual Bragg peaks and `H=±1/3`, `±2/3` for diffuse
preservation.
