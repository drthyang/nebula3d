# 3D-ΔPDF Transform

## Purpose

The three-dimensional difference pair distribution function (3D-ΔPDF) is the
Fourier transform of the diffuse scattering intensity:

```text
Δρ(r) = FT[ I_diffuse(Q) ] = FT[ I_total(Q) − I_Bragg(Q) ]
```

It maps reciprocal-space diffuse scattering to real-space pair correlations.
Positive ΔPDF at a vector **r** means more interatomic pairs separated by **r**
than in the average structure; negative means fewer. References: Weber &
Simonov, *Z. Kristallogr.* **227**, 238 (2012); Simonov, Weber & Steurer,
*J. Appl. Cryst.* **47**, 2011 (2014).

API: `nebula3d.analysis.compute_delta_pdf`. Drivers: `examples/delta_pdf.py`
(full 3D), `examples/delta_pdf_plane.py` (single reciprocal H-plane 2D),
`examples/explore_delta_pdf.py` (interactive y_K–z_L viewer with x_H slider).

## Correct transform recipe

The input volume stores `Q=0` at the **array centre** (index `s//2`), but
`fftn` treats index `[0,0,0]` as the origin. A correct, centred transform of a
real, centrosymmetric `I(Q)` must therefore be:

```python
Δρ = fftshift( fftn( ifftshift( I_windowed ) ) ).real
```

Step by step (as implemented in `src/nebula3d/analysis/delta_pdf.py`):

1. **Fill** masked voxels with 0 (the backfilled volume should already be
   NaN-free).
2. **Remove DC**: subtract the *window-weighted* mean `c = Σ w·I / Σ w`, so
   the windowed input `w·(I − c)` sums to zero exactly. This zeroes the `r=0`
   self-correlation spike, and the removed term `c·w` transforms into the
   window's own resolution peak at `r=0`. (The plain mean subtracted before
   windowing leaves a nonzero windowed sum → a spurious peak at `r=0`; the
   plain mean subtracted *after* windowing leaves a step at the box faces →
   dashed streaks along the axes. See "The dashed axis streaks" below.)
3. **Apodize**: multiply by a window (`gaussian` in the pipeline, `hann`, or
   `none`) to suppress termination ripples from the finite `|Q|` range. Both
   tapers reach zero at the box edge: the Gaussian is shifted down by its
   edge value, `(g − g_edge)/(1 − g_edge)`. The window is separable (a product
   of tapers along H, K and L) unless the lattice has a symmetry that no
   separable window respects — a hexagonal cell — where it is a taper in an
   ellipsoidal radius instead (`window_shape`; see "The window respects the
   lattice symmetry" below).
4. **Zero-pad symmetrically** to the next fast FFT length (5-smooth,
   `scipy.fft.next_fast_len` — just as fast as a power of two but a far
   smaller pad), keeping `Q=0` on the new centre. One-sided padding shifts
   the origin and breaks step 5.
5. **`ifftshift` → `fftn` → `fftshift`**: move `Q=0` to the corner, transform,
   then recentre `r=0`.
6. **Take the real part**: valid because the symmetrised (`mmm`) data is
   centrosymmetric, `I(Q)=I(−Q)`, so the transform is real. The imaginary part
   is numerical noise (a useful diagnostic — if it is not negligible, the input
   is not properly centred or symmetrised).

Real-space axes come from `fftshift(fftfreq(n, d=ΔHKL))`, converted to Å with
the direct-lattice vector lengths `2π·inv(UB)ᵀ`.

### Non-orthogonal cells (hexagonal, monoclinic, triclinic)

The FFT pairs `(h, k, l)` with fractional `(u, v, w)` for any cell, because
`Q·r = 2π(hu + kv + lw)` holds whatever the angles. The ΔPDF therefore stays on
its native grid, and `x_H, y_K, z_L = u·|a|, v·|b|, w·|c|` are coordinates
**along** a, b, c. For a cell with an angle other than 90° these axes are
oblique, and the point `(x, y, z)` sits at `r = x·â + y·b̂ + z·ĉ`:

    |r|² = x² + y² + z² + 2(xy·cos γ + xz·cos β + yz·cos α)

Nothing is resampled; the cell angles travel with the result instead
(`DeltaPDF.cell_angles`, and the unit cell in the `.h5` file's oriented lattice,
`MDHistoWorkspace/experiment0/sample/oriented_lattice`; older files carry
`lat_a/b/c` and `lat_alpha/beta/gamma` attributes):

- **True distances.** `real_space_radius(x, y, z, cell_angles)` gives the
  metric above. The consistency round trip's r band and `r_data_max` use it.
- **Drawing sections.** x_H–y_K is drawn at γ, x_H–z_L at β and y_K–z_L at α.
  A point at in-plane `(h, v)` is drawn at `X = h + v·cos θ`, `Y = v·sin θ`, so
  on-screen distances are true Å. For example, a hexagonal a–b section shows its
  120°, with ±a, ±b and ±(a+b) on a regular hexagon.
  `section_geometry(cell_angles, horizontal, vertical, cut)` returns θ plus the
  display position of the section point nearest the origin and the plane's
  distance from it. From those, a true-|r| sphere becomes the right circle on
  any section (`|r|² = (X − cx)² + (Y − cy)² + d²`).
- **Cut coordinates** stay along the fixed axis. `z_L = 5 Å` means `w·|c| = 5`,
  not a perpendicular height of 5 Å when c is inclined to the a–b plane.

The web viewers get θ with each slice (`axes_angle`, plus `r_center`/`r_perp` for
the band circles). The matplotlib viewers read the `.h5` attrs and apply the same
skew (`nebula3d.visualization.slices.oblique_transform` / `draw_unit_cell`).
Files written before the angles were stored are drawn at 90°.

## Inverse transform & consistency check (`invert_delta_pdf`)

The recipe is exactly invertible, so the ΔPDF can be transformed **back** to the
reciprocal-space diffuse volume it came from — a round-trip consistency check.
`compute_delta_pdf` records the inverse metadata (pad width, the window — three
1-D factors or the ellipsoid's 3×3 form — the subtracted mean, the cropped
axes) on its result, and
`invert_delta_pdf` undoes each step:

```python
I_recon = fftshift( ifftn( ifftshift( Δρ ) ) ).real    # inverse of the recipe
I_recon = unpad(I_recon)                                # strip symmetric padding
I_recon = (I_recon + mean) / window                     # restore DC, deapodize
```

The deapodization (divide by the window) is well-posed for the **gaussian**
window because it never reaches zero; for **hann** the edge planes (window → 0)
are clamped by `window_floor` and are unreliable. The recovered volume's `mask`
marks the reliably-recovered region.

`pdf_consistency_check` (pipeline stage `pdf_check`, default ON; standalone
`examples/delta_pdf_consistency.py`) runs this inverse and compares it to the
diffuse data the ΔPDF was built from (cropped to the transform window), writing a
metric JSON (Pearson r + normalised RMS residual) and a `data | back-FFT |
residual` figure. Because the gaussian window is invertible, a faithful ΔPDF
round-trips to **r ≈ 1**. The check is therefore a regression/validation gate: a wrong axis,
sign flip, or normalisation bug, or an over-aggressive `crop_hkl` / apodization,
would surface here as a visible residual. (On an **even** grid the `Q=0` centre
leaves one index unpaired, so the real-part projection drops a small asymmetric
part — a known, tiny round-trip error; odd grids are exact.)

## The centring bug (fixed 2026-06-05)

Earlier code did `fftshift(fftn(data))` with **no `ifftshift`** and **one-sided**
zero-padding. With `Q=0` at the array centre, the missing `ifftshift` introduces
a linear phase ramp `e^{−iπk} = (−1)^k` across the output. Taking the real part
then **flips the sign of real-space features by pixel parity**, so each
correlation peak splits into mixed positive/negative lobes (a derivative-like
appearance), and slices such as `x_H=0` look scrambled.

Verification: for `I(Q)=1+cos(2π·3·(i−c)/N)` (a single positive correlation,
even about the centre) the buggy transform returned a peak of **−2048** where
the correct transform returns **+2048**. Regression guard:
`tests/test_bragg.py::test_delta_pdf_centring_positive_peak`.

This bug only affected sign/phase; the real-space axes and magnitudes were
already correct. Zero-padding is sinc-interpolation only — it gives a finer
display grid, not more intrinsic resolution (that is fixed by the `|Q|` range
and the apodization window).

Because the real-space pixel size is set by the `|Q|` extent kept, the pipeline
transforms the **full `|Q|` range by default** (`crop_hkl=None`) so the saved
ΔPDF is as fine as the data supports and matches the back-FFT consistency view
(which always uses the full range). Pass a `crop_hkl=(h, k, l)` to band-limit —
a smaller, faster transform that trims the noisier outer `|Q|` shells at the cost
of a coarser real-space grid.

## Near-origin spike (expected, not the bug)

A strong feature at `r < ~3 Å` remains after the fix. It comes from residual
high-`|Q|` Bragg leakage, the backfill discontinuities at punch boundaries, and
the direct-beam punch. Plot colour scales are set from the `p99` of `|ΔPDF|` at
`r > 3 Å` so this near-origin spike does not dominate the display.

## The dashed axis streaks were the DC subtraction (fixed 2026-10-07)

A thin line of **alternating sign, flipping every pixel**, ran along every grid
axis (`x`, `y`, `z` through the origin). It came from the order of two steps:
the transform windowed the volume, subtracted the plain mean `μ` from every
voxel of the box, then zero-padded it to a fast FFT length. That left a step
of height `μ` at the box faces, against the zero padding. The transform of a
box is a product of three sincs, and on the padded grid (e.g. 401 → 405) they
are sampled off their zeros: along each axis the step gives ≈ ±4·μ·N² with the
sign alternating per pixel, and ~400× less off the axes. A constant in `I(Q)`
may only change the ΔPDF at `r = 0`, so the streak is purely an artifact.

Evidence:

- A **constant volume** (`I = 7` on 31³, padded to 32³) transformed to
  1.5·10⁴ on the axis and ~1 off it (Gaussian window); after the fix to
  < 10⁻¹¹. Regression guard: `tests/test_delta_pdf_dc.py`.
- **Hexagonal symmetry** (a hexagonal (6/m) dataset, 6/m-symmetrised, so the
  raw volume is exactly 6-fold symmetric): a, b and a+b are equivalent
  directions, but only a and b are grid axes. The coherent `(−1)^m` part of
  the axis lines, relative to the strongest correlation at 1.5–15 Å, was about
  an order of magnitude larger along a, b and c than along a+b.
- Subtracting the weighted mean first removed most of it, on the hexagonal
  data and on an orthorhombic (mmm) dataset alike. The rest was the Gaussian
  window still at 4.4 % (σ = 0.4) on the box faces, where the data are cut;
  shifting it to zero there leaves it below the a+b level on both. Hann (zero
  at the edge) gives the same picture.
- The back-FFT check stays near-exact on both datasets (float32); on the
  orthorhombic data `r` even rose slightly. The deapodized region shrinks
  because the window is below 10⁻³ of its peak in a thicker shell at the
  faces; those voxels carry almost no weight in the ΔPDF.

The Gaussian change narrows the window's FWHM in `Q` by 3 % (real-space peaks
~3 % broader) and lowers its integral by ~10 % (3.4 % per axis), so ΔPDF
amplitudes drop by up to that much; the measured drop on both datasets stayed
within it.

Still open, found in the same diagnosis (hexagonal data):

- The **separable index-space window is not 6-fold invariant** for a hexagonal
  cell, so a/b and a+b get different resolution. Fixed by the ellipsoid
  window; see the next section.
- The **punch mask is not 6-fold symmetric**: a sizeable fraction of punched
  voxels (and of the coverage-edge trim) have an unpunched 60° partner. It
  puts a long-wavelength stripe pattern across the a–b section.
- The **Laplace backfill fills the unmeasured part of the box** (a large
  fraction of it on the hexagonal data, far beyond the `|Q|` where the data
  end). With the Gaussian window this barely changes the ΔPDF, but it is
  invented intensity.

Whether a smooth cross from the residual envelope (two sections down)
remains after this fix has not been re-measured: subtracting the separable
marginals, the evidence there, would also have removed the box step, which
is separable.

## The window respects the lattice symmetry (2026-10-07)

The window's Fourier transform is the ΔPDF's resolution function, so
symmetry-equivalent directions get the same resolution only if the window is
invariant under the Laue group. A separable window `w_H(h)·w_K(k)·w_L(l)` on
a symmetric box is invariant under sign flips and under swaps of equal axes.
That covers every orthogonal Laue group, and also monoclinic `2/m` and
triclinic `−1`. It does not cover the hexagonal 6-fold
`(h, k, l) → (−k, h + k, l)`, which mixes H and K. On the hexagonal data the
separable window gave a+b a markedly finer resolution than a and b (FWHM,
Gaussian σ = 0.4), although the three directions are equivalent.

`compute_delta_pdf(window_shape=…)` (pipeline `DeltaPdfParams.window_shape`,
server `pdf_window_shape`, the *Window shape* select in the web app):

- `"separable"`: the product of 1-D tapers, as before.
- `"ellipsoid"`: the same taper profile as a function of one radius `ρ`,
  `w = f(ρ)`. `ρ = 1` on the largest ellipsoid that fits in the box and that
  every symmetry of the lattice maps onto itself. The window is zero for
  `ρ ≥ 1`, so it vanishes on the box faces as the DC fix requires.
- `"auto"` (default): `"ellipsoid"` when a lattice symmetry mixes the axes,
  i.e. is not a signed permutation of H, K, L. This is the case for
  hexagonal cells in hexagonal axes, which no separable window can follow.
  Otherwise `"separable"`. Orthogonal, monoclinic and triclinic cells
  therefore keep the old window bit-for-bit. `apodization="none"` stays no
  window.

**Finding the ellipsoid.** The lattice point group is read off the UB: the
integer matrices `R` with entries in {−1, 0, 1} and `Rᵀ G* R = G*`
(`G* = UBᵀ·UB`), to 5 % of `√(G*_ii G*_jj)`. Refined cells are not exactly
symmetric. On the hexagonal data, whose refined UB is slightly off ideal
90/90/120, the 24 operations of 6/mmm pass well inside the tolerance and the
next candidate fails it by far. Among invariant ellipsoids `xᵀMx ≤ 1` inside the box
`|x_i| ≤ X_i`, the largest is unique. Its optimality condition makes `M` a
weighted sum of the box faces averaged over the group,
`ρ² = Σ_i λ_i ⟨(R·x)_i²⟩_R / X_i²`. The weights are D-optimal-design weights,
found in a few multiplicative updates. A last rescale makes the ellipsoid
touch the nearest face. For a hexagonal box this gives

    ρ² = (4/3)(h² + hk + k²)/X² + l²/X_L² = (Q⊥/d_ab)² + (Q∥/d_c)²

with `d = 2π·X/|a_i|` the distances of the box faces from `Q = 0`. Without
axis-mixing symmetry it is the index-space
sphere `Σ (x_i/X_i)²`. Axes with a single plane take no part.

**Memory and inversion.** The window is stored as its 3×3 form and evaluated
one H plane at a time (`EllipsoidWindow.planes()`, ~5 float64 planes of
temporaries). The forward multiply, the weighted mean and the deapodization
all stream the same planes, and no 3-D window is ever built. The WebGPU path
swaps only the FFT core (`webbridge._gpu_forward` / `_gpu_inverse`; the
window never reaches the GPU), so it inherits the ellipsoid unchanged.
`invert_delta_pdf` divides out exactly the same `w`, so the round trip stays
exact.

**Evidence** (a hexagonal (6/m) dataset, float32, Gaussian σ = 0.4;
mismatches relative to the strongest correlation at 1.5–15 Å, on the a–b
section through the origin; `a/b vs a+b` compares the profiles at equal grid
steps):

| input | window | a/b vs a+b, 2–6 Å and 6–12 Å | 6-fold residual, 1.5–15 Å |
|---|---|---|---|
| raw, 6/m-symmetrised | separable | several % RMS, tens of % at the peaks | a few % RMS, tens of % at the peaks |
| raw, 6/m-symmetrised | ellipsoid | float32 round-off | float32 round-off |
| pipeline input (flattened) | separable | several % RMS, tens of % at the peaks | a few % RMS, tens of % at the peaks |
| pipeline input (flattened) | ellipsoid | reduced severalfold | reduced, not removed |

On the exactly symmetric raw volume the ellipsoid leaves only float32
round-off. The worst separable mismatch sits on the sharp lattice-vector
peaks (a strong peak at the lattice vector along a has almost no counterpart
at the same distance along a+b), which fall between grid points and so sample
the anisotropic resolution function. What remains on the pipeline input is
the input's own asymmetry: the punch mask and the edge trim are not 6-fold
symmetric (see the list above).

**Cost.** The ellipsoid leaves out the box corners. Its support is 45 % of
the box against 98.5 %, and its weight `Σw` is 0.78 of the separable
Gaussian's (0.71 for Hann). On the hexagonal data the resolution becomes the
same in all three in-plane directions, slightly coarser than the separable
window's along a and b, and it is slightly coarser along c too. ΔPDF
amplitudes drop modestly, on the raw volume and on the pipeline input alike.

**Alternative rejected.** A product of tapers along h, k and h+k,
`f(h/X)·f(k/X)·f((h+k)/X)·f(l/X_L)`, is also 6-fold invariant and keeps the
whole hexagon. But three in-plane factors taper faster than one, so on the
hexagonal data its in-plane resolution is worse than the ellipsoid's, for the
Gaussian and for Hann.

### The window and the measured coverage (`support`)

A backfill that leaves unmeasured space masked, rather than inventing
intensity there, hands the transform a volume whose data end inside the box.
Read as `I = 0`, that region does two things: it pulls the weighted mean `c`
down, and the box-sized window still weights it. On the hexagonal data the
separable window puts a few percent of its weight on unmeasured space, so the
coverage edge becomes a step with a truncation ripple (period ≈ 2π/Q_edge,
with Q_edge the `|Q|` where the coverage ends).

`compute_delta_pdf(support=mask)` (pipeline `DeltaPdfParams.window_support`,
default on, passes the input volume's `mask`; server `pdf_window_support`;
*Taper to the measured coverage* in the web app):

- **ΔI = 0 off the data.** The mean is weighted over the support only, and
  voxels outside it are zeroed after it is subtracted. They then add no
  step of `−c`, and the input still sums to zero.
- **The window fits the coverage.** Unsupported space that reaches the box
  faces is where the coverage ends. It is found by `binary_fill_holes`
  (26-connected; bool arrays only), so holes enclosed by data do not count.
  The ellipsoid is shrunk until at most `support_tol` (default 10⁻³) of its
  weight lies there. With `"auto"`, an orthogonal box switches to the
  ellipsoid when the separable window puts more than that on it. A shrunk
  ellipsoid is the same ellipsoid scaled, so it stays invariant. The scale
  is logged as `window_scale`.
- `invert_delta_pdf` leaves unsupported voxels out of the reliable `mask`.
- An all-True support (main's Laplace backfill fills the whole box) changes
  nothing, bit for bit.

The tolerance is not cosmetic. Coverage edges are ragged, and thin channels
of unmeasured voxels reach far in. On the raw hexagonal data the nearest open
voxel sits well inside the ellipsoid, although only a tiny fraction of the
window's weight (below the default tolerance) is open. Even on orthorhombic
data with full coverage, a thin channel of open voxels reaches inside the
ellipsoid, with a negligible share of the weight. Shrinking to the
nearest open voxel (`support_tol=0`) would shrink the hexagonal window
substantially (real-space peaks markedly broader) and cut its main peak
sharply; the weight criterion ignores such channels.

Measured on the hexagonal data (the pipeline's flattened input with the
unmeasured space that reaches the box edge masked, as the unmeasured-aware
backfill leaves it; Gaussian σ = 0.4; differences at 2–15 Å relative to the
strongest 1.5–15 Å correlation):

| window | `c` | effect of the support | scale |
|---|---|---|---|
| separable | rises | a few % max, well below 1 % RMS (the mean's share of the ripple) | — (cannot shrink) |
| ellipsoid (`auto`) | essentially unchanged | negligible (≪ 1 %) | 1.0 (already inside the coverage) |
| ellipsoid, `support_tol=0` | much lower | main peak sharply reduced | shrunk substantially |

So for this hexagonal cell the ellipsoid already keeps clear of the coverage
edge, and the support only fixes the mean's handling of the empty region. It
matters most for an orthogonal cell whose coverage ends inside the box, where
`"auto"` now moves to a fitted ellipsoid. `_open_space` takes 2–3 s on 401³
natively and runs only when the support has unsupported voxels.

**Still not symmetric:** `subtract_smooth_bg` blurs isotropically in index
space, and `h² + k²` is not `h² + hk + k²`, so it too breaks the 6-fold on a
hexagonal cell. It is off by default.

Tests: `tests/test_delta_pdf_window.py`. On a synthetic 6/m volume they check
that a, b and a+b agree and that the 6-fold residual is below 10⁻⁹, while the
separable window shows it above 10⁻³. They also cover the point groups from
the UB, the hexagonal form against `(Q⊥/d_ab)² + (Q∥/d_c)²`, `auto` on five
cells, bit-identity on orthorhombic cells, the exact inverse for
hann/gaussian/none, the plane-sized memory peak in float32, and the WebGPU
glue with a numpy stand-in for `nebulaGpu`. The support tests cover the
all-True no-op, ΔI = 0 and the support-weighted mean for an enclosed hole, the
shrink to a coverage sphere at three tolerances (still 6-fold symmetric), a
thin channel that does not collapse the window, the inverse's mask, the
pipeline and server wiring, and the WebGPU glue with a support.

## The axis cross is the residual diffuse background (diagnosed 2026-06-05)

A bright **cross** along the `y_K=0` and `z_L=0` axes appears in the real-space
map. It is **not** a Bragg/punch/masking artifact: it is present even on planes
with no Bragg peaks (e.g. `H=1/3`), the input has **no masked voxels** along
the axis lines, and replacing the exact `K=0`/`L=0` input lines with neighbour
averages changes nothing.

**Root cause.** Ring removal, Bragg punching, and backfill remove rings
(azimuthal), sharp local peaks, and holes — but **none of them removes the
broad, slowly-varying diffuse *envelope***: a smooth positive hump centred near
`K=L=0` that decays toward the edges, with ridges along the principal axes.
`subtract_mean` only removes the scalar DC term (killing the `r=0` spike); it
leaves the shape of the envelope untouched. That envelope is approximately
**separable** (`≈ f(K) + g(L)`), and the FT of a separable function concentrates
its energy *on the two axes* → a cross at `y_K=0` / `z_L=0`. The Hann window,
itself a centred separable hump, multiplies in and sharpens the cross.
Directionally: the horizontal arm (`z_L=0`) is the FT of the L-averaged
K-profile; the vertical arm (`y_K=0`) is the FT of the K-averaged L-profile.

Why `apodize="none"` *looks* like it has a smaller cross: hard truncation
sprays termination ripple everywhere, raising the off-axis floor, so the cross
ratio drops — the window does not *create* the cross, it cleans everything
*except* the cross (which is real low-frequency signal).

**Fix.** Subtract a smooth background **before** windowing so only the
oscillatory modulation transforms. A Gaussian blur (`σ ≈ 1.5 r.l.u.`) collapses
the cross while preserving the off-axis correlation lattice and the genuine
correlation peaks that happen to sit on the axes. Trade-off (standard for
ΔPDF): this also removes genuine very-long-period / low-`r` correlations — but
those live at the same scale as the un-subtractable background, so they cannot
be cleanly separated from it anyway. Subtracting the exact separable marginals
(`per-row + per-col means`) removes the artifact slightly more completely but is
cruder than a smooth blur.

### Methods compared (smooth-bg wins)

`examples/compare_delta_pdf_methods.py` puts three background-removal methods
side by side on a shared colour scale for H=0, 1/3, 2/3:

| method | what it does | effect on the cross |
| --- | --- | --- |
| **baseline** | subtract scalar mean only | cross present |
| **threshold-clip** | `I_new = max(I − c, 0)`, `c` = a percentile | **cross remains ≈ baseline** |
| **smooth-bg** | `I_new = I − GaussianBlur(I, σ≈1.5 rlu)` | **cross removed, lattice clean** |

Threshold-clip *sparsifies the input* (looks cleaner) but barely changes the
transform: on H=1/3 even keeping only 10 % of voxels leaves the cross ratio
well above what smooth-bg reaches. It targets the wrong component — it removes
the dim background tails, but the cross is made by the **bright central
envelope**, which is the highest-intensity region and so survives any threshold.
It also adds hard-edge termination ripple and discards the negative excursions
of `I_diffuse` (regions with *fewer* pairs than average), which a ΔPDF needs.

Of the in-FFT options, **smooth-bg subtraction** (`subtract_smooth_bg` in
`compute_delta_pdf`; `SUBTRACT_BG=<σ rlu>` in `examples/delta_pdf_plane.py` /
`examples/delta_pdf.py`) is the one that removes the cross most completely.

### Background removal in the pipeline: the radial flatten (step 4)

The smooth-bg blur above removes the axis cross most completely, but the
per-H-plane form (`σ_H=0`, e.g. `0,1.5,1.5`) does so by subtracting each H
plane's integrated K–L intensity — which **is** the on-axis x_H Fourier
component. So it also **destroys the H-direction signal** (real lattice-`a`
peaks almost vanish, for any σ; see the `radial_flatten` module and
`flatten-vs-subtractbg`).

The production pipeline (`examples/run_pipeline.py`) therefore removes the
background with an **explicit step 4**, the isotropic radial flatten
(`nebula3d.preprocessing.flatten_radial_background`,
`examples/flatten_background_3d.py`), and leaves the in-FFT `SUBTRACT_BG` **off**
by default. The flatten subtracts a smooth `bg(|Q|)` per spherical shell without
touching per-plane DC, so it **preserves the on-axis H signal** while still
roughly halving the L=0 axis cross. By default `bg(|Q|)` is the fitted pedestal
`const + c·F(Q)²` — nuclear incoherent plus single-ion paramagnetic
scattering, `F` the magnetic ion's form factor — which is pure self
scattering and so changes the ΔPDF only at r ≈ 0. A free-form per-shell floor
(`estimator="floor"`) also removes the isotropic part of real pair
correlations at short r. The two are alternatives — never run both
(double subtraction, and the blur re-introduces the H-axis loss). Validate the
flatten on your own inputs with `examples/validate_flatten.py`.
Judge the effect on the L=0 (H–K) plane, where the methods diverge.
