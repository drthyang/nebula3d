# Changelog

## Unreleased

- **No more dashed streaks along the 3D-ΔPDF axes.** The transform windowed
  the volume, subtracted the plain mean from the whole box and zero-padded
  it, which left a step of the mean at the box faces; its transform drew a
  line of alternating sign along every axis, 13–27 % of the strongest
  correlation on Fe3Ge2 90 K and TbTi3Bi4 22 K. It now subtracts the
  window-weighted mean before windowing, and the Gaussian window is shifted
  to reach zero at the box edge (FWHM 3 % narrower in Q; ΔPDF amplitudes
  4–10 % lower). The streak drops
  35–45× on Fe3Ge2 and 13–30× on TbTi3Bi4; the back-FFT check stays exact
  (TbTi3Bi4 22 K r 0.99912 → 0.99988). See docs/algorithms/delta_pdf.md.
- **The flatten's magnetic ion defaults to none.** The model then subtracts a
  fitted constant only; choose the sample's ion (Tb3+ for TbTi3Bi4) to add the
  `c·F(Q)²` paramagnetic term. The Tb³⁺ default put a terbium form factor on
  every sample: on Fe3Ge2 90 K it fitted c = −2.5, a negative paramagnetic
  term, to follow a pedestal that rises with |Q|.
- **The slice viewers share one workspace, after the NeXus Viewer.**
  Reciprocal cleanup, 3D-ΔPDF and Q–R now lay out, zoom and set colours the
  same way, and the same way as the NeXus Viewer.
  - **Layouts.** *Grid*, *Focus* (one large view, the others as thumbnails;
    2 × 2 with four) and *Single* (Esc returns), with focus / maximize in each
    view's header. Remembered per page. Defaults: grid for Cleanup and
    3D-ΔPDF, focus with Data large for Q–R.
  - **Zoom and pan on the slice.** *Navigate · Zoom · Move* click modes,
    double-click to fit, pinch, axes in r.l.u. or Å, a field-of-view chip and a
    crosshair shared by linked views, with a readout of every stage's value
    under it. On 3D-ΔPDF a Navigate click moves the other two cuts. These
    replace the *Zoom* and *Window* sliders, which pointed opposite ways (Zoom
    ×2 zoomed in on Cleanup but out on the Bragg tiles; a larger Window zoomed
    out).
  - **Colour range instead of *Contrast*.** vmin and vmax around a colour bar
    with the data's histogram and a handle at each limit, *asinh / lin / log*,
    *Auto* (vmin 0, vmax at p97, softening at the median, as in the NeXus
    Viewer) and *Brightness* in stops, right brighter. *Contrast* multiplied
    vmax, so raising it darkened the image.
  - **The diffuse is visible by default.** Cleanup's shared scale now comes
    from the output stage. It came from the pooled stages, so raw's Bragg
    peaks set it: on TbTi3Bi4 100 K the flattened median sat at 0.4 % of the
    range (3.94) and needed *Contrast* at its ×0.1 minimum.
  - **Q–R fixes.** *Apply* sits next to each band and no longer snaps both
    cuts to the centre. The residual has its own ± range on a diverging map;
    it was drawn from 0 on the data's sequential scale, which hid every
    negative value. The Q scale is set from the centre cut, so it holds still
    while the cut moves. The ΔPDF plane follows the Q plane (H ↔ x, …) while
    *Link orientation* is on; the page opened with 0kl next to xy.
  - The Bragg tiles take *Brightness* and a *Zoom* that zooms in.

- **Volumes indexed on a supercell.** New punch setting `supercell` (default
  1×1×1). With a supercell, integer mode punches only the parent lattice's
  nodes, those whose h, k, l are multiples of the factors. The Fe3Ge2 TOPAZ
  volume is indexed 2×2×2. Its odd nodes hold short-range 2×2×2 order (2–3×
  the Bragg width) or nothing, and `mode="both"` was taking 18 % of that
  intensity. Run it with `mode="integer"`, `supercell=(2, 2, 2)` and the H
  guard off: the rods and superlattice nodes then stay intact. The H guard
  (`integer_h_guard_hkl`, 0.12 r.l.u., set for TbTi3Bi4's H = ±1/3 planes) is
  now a setting too. On Fe3Ge2 it left a 2.5σ Bragg tail along H. Both are on
  the server (`punch_supercell_h/k/l`, `punch_h_guard`, 0 = off) and on the web
  Configure page, whose punch preview marks only the parent nodes. TbTi3Bi4
  defaults are unchanged.
- **The flatten subtracts a fitted const + c·F(Q)² pedestal.**
  - **What it does.** It still takes each |Q| shell's floor (p25). It then
    fits `const + c·F(Q)²` to those floors over 0.8–10 Å⁻¹ and subtracts the
    fitted curve, instead of the smoothed floor itself.
  - **The two terms.** `const` is nuclear incoherent scattering (Ti dominates).
    `c·F²` is the paramagnetic scattering of each ion by itself, with `F` its
    magnetic form factor. Both are self scattering, so they change the ΔPDF
    only at r ≈ 0.
  - **Why the floor had to go.** The old floor, smoothed at 0.1 Å⁻¹, also
    followed the isotropic `sin(Qr)/(Qr)` terms of real pair correlations and
    subtracted them.

  On TbTi3Bi4, each ΔPDF compared with no flatten:

  | | 22 K | 45 K | 100 K |
  |---|---|---|---|
  | shell-mean change at 2.75 / 3.75 Å, old floor | −125 / −238 | −49 / −267 | −234 / −112 |
  | shell-mean change at 2.75 / 3.75 Å, model | +47 / +35 | +46 / +35 | +30 / +19 |
  | axis-cross ratio: none → old floor → model | 35.4 → 15.6 → 16.5 | 76.5 → 11.4 → 16.7 | 37.4 → 6.0 → 8.2 |
  | fitted pedestal | 0.032 + 0.120·F² | 0.027 + 0.126·F² | 0.016 + 0.130·F² |

  On the demo ground truth, the old floor's ΔPDF error at 2–5 Å was 42 %,
  against 13 % with no flatten.

  The model keeps most of the cross suppression. What it leaves is a smooth
  isotropic part that is not F²-shaped. That part may be real isotropic
  correlation or a background the model lacks (multiple scattering, the
  sample environment, the Debye–Waller fall-off of the incoherent constant).

  - **Form factor.** `F` is the dipole form, ⟨j0⟩ + (2/g − 1)⟨j2⟩. It fits the
    TbTi3Bi4 floors better than ⟨j0⟩ alone: R² 0.88 / 0.90 / 0.94 against
    0.84 / 0.87 / 0.91 at 22 / 45 / 100 K (measured before the backfill-band
    fix; with it the dipole R² is 0.877 / 0.902 / 0.935).
  - **New module.** `nebula3d.preprocessing.form_factor` has the coefficients
    for 22 3d and rare-earth ions (International Tables C §4.4.5,
    cross-checked against Mantid).
  - **Settings.** `ion` (default `"Tb3+"`; `None`/`"none"` fits a constant
    only) and `fit_q_range` are new options on `flatten_radial_background` and
    `FlattenParams`. On the server the ion is `flatten_ion`.
  - **Where the default changed.** The stage driver, the flatten example, the
    QA script and the web Configure page now default to the model. The web
    page gains a Magnetic-ion select. `estimator="floor"` and `"snip"` remain
    for comparison.
  - **Limit.** For Ising-like moments the self term is `F²(1 − (Q̂·ê)²)`, and
    only its shell average is removed.
- **No bright rim around a filled hole.** On the Fe3Ge2 TOPAZ volume, bright
  nodes came out as "coffee beans": a ring brighter than the fill inside it.
  There were two causes.
  - The Laplace fill takes its boundary `laplace_gap` voxels outside the
    punch, past the Bragg tail left at its edge, but then kept that band's
    measured values. Every hole was therefore ringed by the tail its fill had
    skipped: median step 0.27σ on TbTi3Bi4 22 K, 0.63σ on Fe3Ge2. The fill now
    writes the band too, and meets the kept data only at its boundary.
  - The profile punch's template dropped a halo common to every direction as
    thermal diffuse. Fe3Ge2 has one, and it is the peak's own: it falls off
    exponentially (~0.04 Å⁻¹), and relative to the peak it does not grow with
    |Q|. The template now follows the measured profile on every axis. On
    TbTi3Bi4, which has no such halo, the punch grows 2 %.

  | | 22 K | Fe3Ge2 90 K |
  |---|---|---|
  | step from the fill to the first kept voxel, median | −0.27 → +0.01σ | −0.63 → +0.04σ |
  | measured voxels the fill replaces | 0 → 1.41 M | 0 → 1.26 M |
  | punched voxels | 2.74 → 2.80 M | 1.00 → 1.40 M |
  | back-FFT r, whole volume | 0.99876 → 0.99912 | 0.99995 → 0.99999 |
  | ΔPDF r, old vs new, 2–5 / 40–80 Å | 0.999 / 0.934 | 0.988 / 0.976 |

  On the moved-hole test the written band is unbiased (+0.004σ on 22 K) with
  the scatter of a 3³ box mean. `laplace_gap=0` still changes only the
  punched voxels. See `docs/algorithms/bragg_cleanup.md`.
- **Laplace is the default backfill, judged on real data.** A new test,
  `bragg_qa.refill_test` (also `REFILL=laplace,local` in
  `examples/qa_punch_fill.py`), measures fill error where the truth is known.
  It moves the punch's own holes half a node step along K, into measured
  diffuse, fills them, and compares with the data there. The moved holes keep
  the real shapes and stay lattice-periodic.

  On TbTi3Bi4 (profile punch):

  | | 22 K | 45 K | 100 K |
  |---|---|---|---|
  | per-hole mean error, `local` → `laplace` | +0.036 → +0.015σ | +0.024 → +0.015σ | +0.024 → +0.018σ |
  | ΔPDF error at the lattice vectors, % of the real ΔPDF there | 1–4 % | 1–7 % | 2–5 % |

  The two fills are equal in the ΔPDF within the test's scatter. `laplace`
  leaves no step at the hole rim (−0.01σ against −0.18σ) and follows gradients
  across the long merged holes of the profile punch. Fills that continue the
  rise toward each node are not used: that rise is mostly the residual Bragg
  tail the punch leaves at 0.5σ.

  Defaults changed in `backfill_bragg`, `BackfillParams`, the stage driver and
  presets, the preview, the benchmark and the web Configure page;
  `method="local"` restores the shell median.
- **The Bragg punch follows each peak's own tail.** Stacked along their local
  axes, the brightest TbTi3Bi4 peaks have:
  - a compact core, the same width in every direction;
  - no radial tail;
  - an exponential tail along θ̂ (toward c*), out to 0.3–0.47 Å⁻¹ above the
    noise, and a shorter one along φ̂.

  The tail scales with intensity, grows with |Q| and barely changes from 22 to
  100 K: the c-axis tilt spread (mosaic). The old punch fitted the core, which
  cannot see the tail, then grew it by the cube root of the intensity. Its base
  radii even had θ̂ as the shortest axis. On 22 K, 36–43 % of a bright punch was
  background, yet 59 % of the brightest holes had a tail leaking on one side.

  `punch_footprint="profile"`, now the default with `profile_n_sigma=0.5`:
  - learns the dataset's Bragg profile along each peak's (ρ̂, θ̂, φ̂) from its
    ≤ 400 brightest integer peaks, per |Q| range, with neighbouring peaks
    masked out;
  - keeps the Gaussian core plus the excess of the transverse profiles over
    the radial one, so a halo common to every direction (thermal diffuse) is
    not learned;
  - punches each peak along each axis to where its predicted tail falls to
    0.5 × the local noise, between the resolution radii and 0.5 Å⁻¹. There is
    no intensity scaling.

  Old → gate → new:

  | | 22 K | 45 K | 100 K |
  |---|---|---|---|
  | brightest holes leaking a tail | 59 → 59 → 29 % | 59 → 60 → 38 % | 69 → 70 → 53 % |
  | all holes leaking a tail | 30 → 31 → 17 % | 27 → 28 → 22 % | 30 → 29 → 22 % |
  | background share of the punch | 34 → 35 % (gate → new) | 35 → 36 % | 37 → 37 % |
  | punched voxels | +21 % | +18 % | +22 % |
  | back-FFT r, whole volume | 0.9990 → 0.9986 | 0.9990 → 0.9995 | 0.9984 → 0.9991 |
  | back-FFT r, H = 0 | 0.9984 → 0.99995 | 0.9972 → 0.9967 | 0.9938 → 0.9934 |

  (Background share, punched voxels and back-FFT r are gate → new.)

  The 45 K ΔPDF (r = 0.91 against the gate's) loses 11–21 % of its RMS from
  5 to 40 Å and up to 25 % at the lattice vectors; 2–5 Å moves by 2.5 %.

  Caveats:
  - more of the punch sits in merged holes, as tails join neighbouring L
    nodes;
  - it also removes thermal diffuse that streaks across Q around nodes, like
    the demo volume's, so the demo benchmark scores 2–3× the collateral. The
    learned profile is in the Bragg profile JSON (`footprint_profile`) for
    checking a new sample.

  With too few bright peaks it falls back to the ellipsoid and says so in the
  run log. `punch_footprint="ellipsoid"` restores the old punch
  (`PUNCH_FOOTPRINT` / `PROFILE_N_SIGMA` in the driver; `punch_footprint` /
  `punch_profile_n_sigma` in the run request). `bragg_qa` also reports each
  hole's background share.
- **The Bragg punch judges every detection against its own error.** Before,
  the search pass flagged a voxel when it beat its |Q| shell's median + 4·MAD
  and an absolute floor of 0.8. Both are set by the whole shell. At the
  high-|Q| edge of the CORELLI coverage (|K| > 9.7 on TbTi3Bi4), low exposure
  turns one or two counts into a spike of order 1, with noise three times
  the interior's.
  - Half the search peaks were such spikes: 4,349 of 8,572 at 22 K, all
    below 5σ, median I/σ 1.7. 86 % were single voxels.
  - Their punches merged into two 139k-voxel holes, 11 % of everything
    punched, which the `local` fill then filled with one value each.

  Now a detection, integer node or search summit, needs an integrated
  excess of at least `min_significance` = 5 standard errors (`PunchParams`;
  `MIN_SIGNIFICANCE=5` in the `cc_on`/`cc_off` presets):
  - `z = Σ(I − bg)/√Σσ²` over half the resolution ellipsoid, with `bg` the
    detection window's median and `σ` the volume's errors;
  - `significance_noise="mad"` uses the window's robust scatter instead,
    for volumes without real errors;
  - a voxel without a usable `σ` falls back to the window's robust scatter.

  The scaling reference still counts the candidates the gate rejects, so
  the punches that stay keep their size.

  On 22 K (shipped code against main, full pipeline):
  - edge punch 629k → 367k voxels; interior 1.887 M → 1.892 M;
  - 8 interior integer nodes lost: one mmm-symmetric family at z ≈ 4.5;
  - back-FFT r 0.99872 → 0.99902, nrms 0.0463 → 0.0414, H = 0 plane
    0.99730 → 0.99843;
  - the ΔPDF moves by 2.3 % RMS at the lattice vectors and 5 % within 20 Å,
    all of it from the restored edge.

  45 K (shipped code): back-FFT r 0.99898 → 0.99904, nrms 0.0415 → 0.0410,
  H = 0 plane 0.99330 → 0.99721.

  100 K (shipped code): back-FFT r 0.99835 → 0.99839, nrms 0.0536 → 0.0533,
  H = 0 plane 0.98754 → 0.99375.

  No change in the tails left past the brightest holes at any of the three.

  The profile JSON gains each peak's `significance`; the run request gains
  `punch_min_significance` (0 = off). `detect_window_q` sizes the detection
  window in Å⁻¹ but stays off: on 22 K it adds ~1,200 integer nodes, not yet
  validated.
- **Punch / backfill QA**, `nebula3d.analysis.bragg_qa`, two examples:
  - `examples/qa_punch_fill.py` (real data) reports:
    - how significant each detection is;
    - hole sizes and merging;
    - excess in shells outside each hole by distance in Å⁻¹ (a tail leaking
      on one side shows in the first shell's 90th percentile);
    - the fill against those shells.
  - `examples/benchmark_punch_fill.py` (ground truth) scores the punch and
    fill on the demo volume, whose components are known: Bragg left, diffuse
    removed, false detections, fill bias, and 3D-ΔPDF error at the lattice
    vectors. It has a clean scenario and a low-exposure-edge one. On the
    edge one the gate cuts false detections 1,284 → 12 and collateral
    81 % → 59 % (clean: 46 %).
  - Both already show the next targets on TbTi3Bi4: the `local` fill sits
    ~0.2σ below each hole's rim, and on the demo it under-fills the thermal
    diffuse under the nodes by ~75 %.
- **Every HDF5 output is now a Mantid MDHistoWorkspace NeXus file.** The stage
  volumes (`*_ringremoved.h5`, `*_braggpunched.h5`, `*_backfilled.h5`,
  `*_flattened.h5`, the web demo) and the 3D-ΔPDF (`*_delta_pdf.h5`,
  `examples/_delta_pdf.h5`, `*_3dpdf.h5`, the consistency viewer's saved
  band) were written in two ad-hoc layouts that only NEBULA3D read. They now
  use the layout Mantid Workbench's `SaveMD` writes (version 2, copied from a
  CORELLI file), so `LoadMD` and other NeXus tools open them, and the unit cell
  sits in `experiment0/sample/oriented_lattice` (UB/2π and a, b, c, α, β, γ).
  File names and extensions are unchanged. Also:
  - arrays keep their stored order: a volume `(nh, nk, nl)` is D2 = `[H,0,0]`,
    D1 = `[0,K,0]`, D0 = `[0,0,L]`; a ΔPDF `(na, nb, nc)` is D2 = x, D1 = y,
    D0 = z in Å (frame General Frame), with the bin edges LoadMD expects;
  - signal, σ² and `num_events` are float64 and the mask int8 (1 = masked), as
    LoadMD requires. A float32 run converts slab by slab (no float64 copy of
    the volume) and records its precision, which `dtype=None` restores. Files
    of a float32 run grow by ~1 B/voxel (~7 against ~6 compressed); float64
    files are about the same size;
  - the ΔPDF provenance (`q_max`, `apodization`, `source_file`,
    `transform_config`, …) is stored as run logs, so it shows in Workbench's
    Sample Logs;
  - what Mantid does not know goes in `MDHistoWorkspace/nebula3d`: the exact
    bin centres and UB, the precision, the instrument text and the punch
    record (`punched`, int8). A file NEBULA3D wrote loads back losslessly,
    values under the mask included, so a pipeline resumed from disk equals one
    run in memory; a raw Mantid file still has its masked voxels zeroed;
  - one reader for ΔPDF files, `nebula3d.io.load_delta_pdf`, used by the
    server, the stale-ΔPDF guard and every viewer; the writer is
    `nebula3d.io.save_delta_pdf` (and `nebula3d.io.save_mantid_nxs` for
    volumes). `pipeline.write_cell_attrs` is gone;
  - older files still load: `/entry/...` volumes (also the NeXus Viewer's
    hand-off), `/entry/punched`, and root-layout ΔPDFs with `lat_*` attributes.
  An identity UB (unknown) writes no oriented lattice, and neither does a
  left-handed one, which Mantid refuses; NEBULA3D keeps it in its own group.

- **New default ring model, `pooled`: stack-pooled sector profiles.** The
  per-plane `patched` model left a visible residual along every powder ring.
  On the TbTi3Bi4 CORELLI volumes a ring's |Q| position and width wander with
  direction (the 4.39 Å⁻¹ Al line peaks anywhere from 4.30 to 4.51 Å⁻¹ at
  H = 0), and `patched` smooths each |Q| bin's azimuthal pattern with six
  damped harmonics, so it subtracts at the wrong |Q|: a bright arc beside a
  dark one, invisible to the azimuthally averaged removal fraction.
  `fit_pooled_rings` (`ring_model="pooled"`) assumes no radial line shape.
  It reads each plane's median radial profile in 72 azimuthal sectors, pools
  each one with its ±1 neighbouring sectors and the planes within ±5° on the
  ring sphere by weighted median (Bragg peaks, which fill one sector over a
  few planes, are outvoted), and subtracts the SNIP excess inside the
  confirmed shells. Also:
  - a close doublet (6.79/6.97 Å⁻¹) shares one SNIP window, instead of the
    broad member being half left in the baseline;
  - rings must clear the profile noise (≥ 6σ) as well as 6 % of the strongest
    ring, and a weaker ring is admitted when it sits on an FCC-Al line (22 K:
    the Al 440 and 533 lines at 8.81 and 10.21 Å⁻¹ were never subtracted);
  - the shell envelope is 1.5 × FWHM wide and the amplitude cap 8×, both of
    which clipped real ring before;
  - on a coarse grid the pooling solid angle widens until it holds 12 voxels.

  On 22 K, held-out ring residual (RMS, fraction of the raw ring) drops from
  0.22 to 0.12 at 2.69 Å⁻¹, 0.41 → 0.23 at 5.17, 0.54 → 0.35 at the 6.9
  doublet, 0.55 → 0.34 at 9.3, 0.88 → 0.61 at 9.87. Through the whole
  pipeline the ΔPDF loses the concentric ring ripples: RMS at 3–10 Å is 0.91×
  (22 K), 0.76× (45 K) and 0.76× (100 K) of before, with the back-FFT
  consistency unchanged. Bragg-on-ring inflation is +17 % of the local ring
  (`patched` +15 %); the subtraction is continuous along the stack axis; the
  stage takes ~52 s serial on the 48 M-voxel volumes (`patched` ~45 s) and,
  in low-memory mode, writes in place (~5 B/voxel peak). `ring_model="patched"`
  restores the previous behaviour. The web Configure page gains "Pooled 3D
  sectors" (sectors, stack window) as the default; the run request gains
  `rings_pooled_sectors` and `rings_pooled_window_deg`.
- **Side-by-side ring-model viewer**, `examples/compare_ring_modes.py`: one
  column per model (default `pooled`, `patched`, `parametric`, `global_v2`),
  the cleaned slice above what each removed, a leftover radial profile per
  plane, linked zoom and an H/K/L plane slider. Each model runs once through
  the pipeline path and is cached in `data/processed/ring_modes/`.

- **The Bragg punch now fits each peak's tilt, in Q.** Before this, the
  default pipeline fitted three radii along H, K, L, so no integer peak was
  tilted. The opt-in covariance fit did not follow the data either: it took
  eigenvectors in HKL, floored them at an HKL bounding box, read the core from
  a ±0.2 r.l.u. window (±1 voxel along c* here), and used the width of the 35 %
  core, which is 0.61σ for a Gaussian. On the TbTi3Bi4 100K volume, 44 % of
  peaks were floored on all three axes, and 0.7 % were set by the data on all
  three. `integer_optimize_shape` is now the covariance fit, in Q (the
  pipeline default):
  - takes the core's covariance in Q (`Σ_Q = UB·C·UBᵀ`), from a window sized
    in Å⁻¹, using only voxels connected to the peak;
  - divides by the Gaussian core-cut factor, so the widths are σ;
  - clips the ellipsoid to contain the punch frame's resolution ellipsoid and
    lie inside `max_radius_scale`× it;
  - leaves peaks whose cut is within `integer_fit_noise_n_mad` (3) noise
    sigmas of the background at the resolution ellipsoid;
  - adds the Å⁻¹ `margin` to the principal radii in Q.

  On synthetic tilted peaks on the real UB, the punch's long axis is now
  3–16° from the truth, where it was 26–31°. On 100K, 99 % of fitted peaks
  have at least one axis set by the data, and the measured long axes sit a
  median 38° off the spherical frame's φ̂. The default pipeline punches 4.45 %
  of voxels, up from 3.75 %; in integer mode it leaves 6.4 % of the
  strong-peak excess outside the punch, down from 7.1 %. `measure_peak_sigmas`
  and `measure_peak_covariance` (the profile's measured widths) use the same
  cut-corrected core, so the width histogram reads 1.65× wider than
  before. The position-only fit takes the same core's centroid. The
  default-punch golden master was regenerated (612 → 489 voxels). Profile
  JSONs from earlier runs predate this change.
- **Removed the diagonal Bragg-shape fit**: three radii along H, K, L, so no
  tilt, floored at an HKL bounding box; the same class of r.l.u. punch as the
  removed HKL frame. `integer_fit_covariance` is gone from `BraggRemover` and
  `PunchParams`, `punch_fit_covariance` from the run request, and the
  Configure page's "Fit tilted ellipsoid" switch with it; "Drop fit
  constraints" stays. Peak records no longer carry `radii_hkl`. A peak where
  the punch frame is undefined (at the origin) still gets the base
  ellipsoid's HKL bounding box. The profile JSON keeps `fit_covariance` (true
  when the shape fit ran) for readers of older profiles.
- **Removed methods with no physical basis.**
  - Generic image inpainting as a backfill: `method="tv"`, `"symmetry"`,
    `"symmetry+tv"` and the `nebula3d.inpainting` package (TV, Laue-symmetry
    copying, RBF, biharmonic). TV assumes a piecewise-constant image and leaves
    staircase artefacts in structured diffuse scattering, and every symmetry
    copy of a punched Bragg node is itself punched. The older ring workflow that
    used it went too: `backfill_ring_shells` (`preprocessing/backfill.py`) and
    `preprocessing/residual_rings.py`. The production ring stage subtracts its
    model, and anything it masks is filled by the Bragg backfill from its own
    surroundings. `backfill_bragg` now takes `local`, `laplace` or `q_shell`, and
    raises on anything else; `BackfillParams` lost `laue_class`, `tv_lam`,
    `tv_iter`.
  - The flatten's `median` and `mode` estimators. A |Q| shell's median or mode
    includes the diffuse signal itself, so subtracting it removes real diffuse
    scattering (the flatten validation found both over-subtract). `floor`
    (default) and `snip` remain.
  - Morphological grey opening as the ring-model baseline
    (`baseline_method="opening"`). It is a shape filter, not a background
    model, and dips below a diffuse background that falls with |Q|. SNIP is now
    the only baseline, so `baseline_method` is gone from `PatchedRadialRingModel`
    and `ParametricRingModel`.
  - Bragg punch radii in fractional HKL (`punch_frame="hkl"`, `punch_radii`,
    `punch_radius_hkl`; `punch_radius_h/k/l` in the run request). The
    resolution is set in Q, so r.l.u. radii depend on the cell and shear on
    oblique axes. The punch is sized in Å⁻¹ only: per peak in the spherical
    frame (the default, now also for `BraggRemover()` and `bragg_mask`) or
    along a*, b*, c* (`"q"`). `punch_frame="hkl"` raises. The `margin` guard
    band is Å⁻¹ everywhere, including the covariance-fit path, which inflated
    by r.l.u. outside the `"q"` frame. The default direct-beam punch, when no
    beam radii are set, is twice the Bragg punch's HKL bounding box. The
    default pipeline punch is unchanged: the same mask on the TbTi3Bi4 22K
    volume. `examples/compare_punch_frames.py` and `plot_punch_slices.py`
    (HKL vs Q comparisons) were removed, and the punch examples take
    `SPHERICAL_R` (Å⁻¹) instead of `R_HKL`.

  The Configure page no longer offers the removed options. Docs, examples and
  the manual source follow.
- **The edge of the measured coverage is trimmed at load, on by default.** A
  measured voxel next to unmeasured space is barely normalised. On the 401³
  Fe3Ge2 TOPAZ volume those voxels reach p99 ≈ 4,000 and a maximum of
  5.5·10⁷, while one voxel further in they match the interior (p99 ≈ 38
  against 34). They went straight into the ΔPDF, and as Laplace boundary
  values they lit up the holes next to them. The pipeline now takes
  `PipelineParams.edge_trim` layers (default 1; 0 keeps them) off the measured
  coverage when it loads the raw input: those voxels become unmeasured, masked
  and zeroed as the loader leaves unmeasured voxels, and the run log says how
  many. The volume's own faces are not an edge. A fully measured volume such
  as TbTi3Bi4 22K loses ~7,000 of 48.4 M voxels; Fe3Ge2 loses 2.8 M, and its
  default punch then finds 52,281 peaks instead of 120,104 (most of the rest
  were edge voxels), punching 1.59 M voxels instead of 2.97 M. Existing
  outputs are not recomputed by themselves: re-run from the ring stage.
  `nebula3d.preprocessing.trim_coverage_edge`, `nebula3d.pipeline.load_input`,
  `edge_trim` in the run request (+ tests).
- **Backfill: each punched hole is filled from its own surroundings.** The
  backfill took every masked voxel for a hole, so a punched hole that touched
  unmeasured coverage merged with it, and the whole region (coverage and every
  hole touching it) got one fill value set by the coverage's rim. On the
  401³ Fe3Ge2 TOPAZ volume (73 % unmeasured) that was 82 % of the punched
  voxels, which showed as flat discs that did not match the data around them.
  The punch stage now records which voxels it punched, in memory and as
  `/entry/punched` in `*_braggpunched.h5`, and `backfill_bragg(punched=…)`
  fills each hole only from the measured voxels around it. The coverage is
  filled separately afterwards, with its own shell median. For `laplace`,
  unmeasured neighbours are a free (Neumann) boundary. On Fe3Ge2, the holes
  whose mean fill is more than 3 MAD from the median of the measured voxels
  within 2 voxels of them drop from 6.6 % to 0.0 % (`local`), and the median
  offset halves. A punch artifact written before this change has no record:
  the backfill says so in the run log and fills as before. Re-run the punch to
  fix it. `src/nebula3d/analysis/bragg_fill.py`, `src/nebula3d/pipeline.py`
  (+ tests).
- **Desktop browsers: large volumes no longer run out of memory in the
  backfill.** A 401³ TOPAZ volume (64.5 M voxels, inside the ~80 M-voxel
  limit) failed in the browser with a `MemoryError` in the backfill. Four steps
  each built a full float64 |Q| grid with its temporaries, ~25–40 B/voxel on
  top of the volume: the cross-plane ring confirmation, the punch's per-|Q|-shell
  thresholds, the radial flatten and, on that volume, the direct-beam fill. Its
  unmeasured coverage (73 % of the cube) reaches the origin, so the direct-beam
  fill took all of it for the beam. The first three now compute |Q| one plane
  or one 16-plane slab at a time, with identical values. The direct-beam fill
  leaves an origin region whose bounding box is over 2 M voxels (a real beam's
  is ~2,000) to the generic fill. On the TOPAZ volume the old beam fill found
  no clean shell there and filled nothing, so every stage output is
  byte-identical, as it is on the 48.4 M-voxel TbTi3Bi4 volume. The Laplace
  fill also frees its unknown lists for an oversized region before filling it
  locally (same output). Under Pyodide 0.27.7 the WASM heap now peaks at
  2.8 GiB on the TOPAZ volume (it failed at 3.8 GiB; 2.9 GiB with
  `method="laplace"`), 2.1 GiB on the TbTi3Bi4 volume (was 2.5 GiB) and
  2.9 GiB on a fully measured 79.5 M-voxel volume at the limit (the old code
  hit the 4 GiB ceiling there), out of 4 GiB.
  `src/nebula3d/preprocessing/radial_background.py`,
  `src/nebula3d/analysis/bragg.py`, `src/nebula3d/analysis/bragg_fill.py`,
  `src/nebula3d/preprocessing/radial_flatten.py`, `tests/test_memory_peaks.py`.
- **Phones and tablets: a size limit that fits the device.** Loaded volumes
  (**Load volume…** and the NeXus Viewer import) were checked only against
  the desktop budget of ~80 M voxels, so a phone accepted volumes that the OS
  would kill the tab over mid-run. On a phone or tablet the gate now budgets
  the whole tab: ~0.55 GB of runtime + packages plus 150 B/voxel (measured
  ~125 B/voxel on a full demo run, plus room for a Mantid input's float64
  signal and errors) against 1.3 GB, i.e. up to ~5 M voxels (≈ 171³; the demo
  is 4.2 M). A larger file is refused before it loads, with a message that
  points to a desktop browser (up to ~80 M voxels) or the native build.
  Desktops are unchanged. The page detects the device (`web/src/api/device.ts`,
  now shared with the ring pool) and sends it in the pipeline worker's boot
  message to `webbridge.setup(mobile=…)`, because only the main thread can tell
  iPadOS from a Mac. `inspect_input` reports `device`.
  `src/nebula3d/webbridge.py`, `web/src/api/pyodideEngine.ts`,
  `web/src/workers/pyodideWorker.ts` (+ tests).
- **iPhone / iPad: the in-browser run no longer reloads the page mid-run.**
  On iOS every browser is WebKit, which runs all of a page's workers inside one
  content process. The OS kills that process at a memory limit far below a
  desktop's, and Safari then silently reloads the page. The ring-worker pool
  sized itself as `min(4, hardwareConcurrency − 2)`, and WebKit reports 4 on an
  iPhone, so it added two extra Pyodide + numpy/scipy instances (~0.45 GB
  resident each, measured) to the pipeline worker. With the 161³ demo that
  took a run past the limit. Phones and tablets (iOS, iPadOS — which sends a
  desktop-Mac user agent, so it is caught by its touch points — and Android)
  now get no ring workers. The ring stage runs serially in the pipeline worker
  instead, with bit-identical output. The `nebula3d.ringWorkers` localStorage
  setting still overrides. `web/src/api/ringPool.ts`, `web/src/api/device.ts`
  (`isMobileDevice`, + tests).
- **The demo volume is labelled synthetic and costs less memory.** The file
  and dataset are now `synthetic_rocksalt` (was `demo_rocksalt`), and the
  Configure page says it is simulated, not measured data. It is stored float32,
  which is what the browser computes in, so its in-memory file halves
  (52 → 23 MB). `demo_volume` draws the counting noise one H plane at a time, in
  place (`dtype=` sets the storage precision). Generating 161³ then peaks at
  ~76 MB of arrays instead of ~220 MB, below the ring stage's ~195 MB, so the
  demo no longer sets the WASM heap's high-water mark (measured under Pyodide
  0.27.7: 179 MB after generation, was 325 MB). Measured under Node, a full
  demo run's pipeline worker is ~1.07 GB resident (was ~1.27 GB). On a phone it
  no longer carries two ring workers of ~0.45 GB each, so the total is roughly
  half.
  `src/nebula3d/demo.py`, `src/nebula3d/webbridge.py`, `tests/test_webbridge.py`.
- **New demo volume: finer grid, physical diffuse scattering.** **Use demo**
  loads a 161³ volume (was 33³) over ±4 r.l.u., step 0.05 r.l.u. (0.075 Å⁻¹).
  That is fine enough for resolution-limited Bragg peaks and a 0.5 Å ΔPDF
  grid, and the full chain still runs in about 5 s in the browser. The crystal
  is rock-salt-type (cubic, a = 4.2 Å, FCC lattice), on the intensity scale of
  a normalised Mantid volume (Bragg up to ~150, diffuse ~0.1–0.5), with three
  kinds of diffuse scattering, each with a known 3D-ΔPDF signature:
  - chemical short-range order (Krivoglaz–Clapp–Moss, V2/V1 = 0.3): maxima at
    (1 ½ 0); in the ΔPDF, negative at ⟨½ ½ 0⟩a and positive at ⟨1 ½ ½⟩a and
    ⟨2 0 0⟩a;
  - one-phonon thermal diffuse scattering of a nearest-neighbour FCC lattice
    (Q·D⁻¹·Q): halos at every node, growing as |Q|², streaking along ⟨110⟩;
  - 2-D order in the (001) layers: rods along L at (h+½, k+½), a checkerboard
    confined to the z = 0 plane in the ΔPDF.

  Also in the volume: FCC Bragg peaks with a |Q|-dependent resolution ellipsoid
  and Debye–Waller falloff, a radial background, a compact incident-beam spot,
  aluminium-can powder rings at the Al d-spacings with texture about c*,
  Poisson counting noise, and a matching per-voxel `sigma`. On the old demo,
  whose Bragg peaks were ~10× the diffuse and smaller than a voxel, the default
  punch reported 114 peaks and only 34 of them were at FCC nodes; the rest were
  noise at high |Q|. On the new one it finds only FCC nodes, and every diffuse
  maximum sits off the integer nodes so none is punched. The ΔPDF reproduces
  the ground truth of the planted diffuse (r = 0.91). The generator is `nebula3d.demo.demo_volume`,
  built in slabs so its temporaries stay small in the WASM heap. It can return
  any single component without noise, and `webbridge.make_demo_input` writes
  it as `synthetic_rocksalt`. `tests/test_demo.py` pins the physics and the
  end-to-end result. The absolute consistency-r floor in
  `tests/test_float32_equivalence.py` drops from 0.999 to 0.98, because the
  demo's counting noise caps r at ~0.992. The float32/float64 gates are
  unchanged. See `docs/web.md` ("Demo volume").
- **Layouts for iPhone, iPad, MacBook and 4K screens.** Below 1100 px (iPad
  Pro portrait and all iPhones) the sidebar becomes a compact top bar with a
  scrolling row of view pills. On phones this bar is a single row in landscape.
  Viewer panels no longer squeeze into one row there: they wrap into a grid, or
  stack one per row on a phone. Stat strips, headers, clusters and the Bragg
  peak table reflow instead of overflowing. On 4K at 150 %, Configure shows the
  workflow controls and the live preview side by side. On a 4K panel at 100 %,
  the console is scaled up. Touch screens get finger-sized controls, the shell
  uses the dynamic viewport height and safe-area insets, and phones get 16 px
  form text (no zoom on focus). Configure fields no longer spill out of their
  boxes on iPad widths. Long file names, run IDs and slider readouts wrap
  instead of being cut off. The AI Assistant page grows when its settings
  drawer is open, instead of running under the page footer. Checked at every
  target size (with iPhone safe areas emulated) for overlapping components
  and cut-off text. `web/src/index.css` ("Device layouts"),
  `web/src/App.tsx`, `web/index.html`; see `docs/web.md`.
- **NeXus Viewer import shows its progress.** While NEBULA3D waits for the
  volume, the viewer sends `nebula3d-import-progress` (stage label + overall
  fraction), and the import banner shows it as text and a progress bar instead
  of only "Waiting for the NeXus Viewer…". Once the file arrives, the banner
  shows the in-browser engine's start-up step and bar while it boots, instead of
  a bare "Loading…". The message is optional: older versions of either app
  ignore it or never send it. The Configure page's boot panel and the banner now
  share `bootPercent` (`api/pyodideEngine.ts`) and `useBootStatus`
  (`api/hooks.ts`). `web/src/api/importHandoff.ts` (`onProgress`, + test),
  `web/src/components/ViewerImportBanner.tsx`; see `docs/web.md`.
- **NeXus Viewer import: the two tabs no longer share a browser process.** The
  viewer opened this app with a window reference. Same-site tabs linked that way
  share one renderer process and main thread, so reloading, closing or crashing
  the viewer could also end a pipeline run here. A viewer on this app's origin
  now opens the tab with `noopener` and exchanges the same messages over the
  `BroadcastChannel` `nebula3d-import:<id>`. This app listens on the channel and
  on `window.opener`, so an older viewer and cross-origin dev servers still
  work. `web/src/api/importHandoff.ts` (+ tests); needs the matching
  neutron-nexus-viewer change; see `docs/web.md`.
- **Bragg backfill now fills from the diffuse around each hole.** The pipeline,
  `run_pipeline.py` and web default changes from `q_shell` to `local`.
  `q_shell` filled every hole with the median of its whole |Q| shell. That is
  biased at the lattice nodes, where correlations at lattice-vector separations
  peak or dip, and the node-periodic bias Fourier-transforms into spurious ΔPDF
  features at the lattice vectors. The standard punch-and-fill practice
  (NXRefine, Mantid `DeltaPDF3D`, KAREN) interpolates the surrounding diffuse.
  **Re-run backfill → ΔPDF on existing datasets: results change.**
  - **New `method="laplace"`:** a harmonic (Laplace) fill of all holes in one
    sparse system (Jacobi-preconditioned CG, no per-hole loop), continuing the
    local diffuse smoothly with no edge step. Its boundary sits `laplace_gap`
    (default 1) voxels outside the punch, so Bragg tails leaking past the punch
    do not pull the fill up; measured voxels in that band are kept. Exposed in
    `BackfillParams.laplace_gap`, the web method menu and `LAPLACE_GAP` in
    `examples/backfill_bragg_3d.py`.
  - **Synthetic check** (short-range order + node-peaked diffuse + Bragg):
    worst lattice-vector ΔPDF artefact ~2.3 % of the signal for `q_shell`,
    ~1 % for `local`, ~0.8 % for `laplace`. Backfill transient memory on a
    25 M-voxel volume: `q_shell` 41, `local` 25, `laplace` 35 B/voxel.
  - `q_shell` stays available for comparison. The web help text no longer
    claims it "interpolates".

- **3D-ΔPDF on non-orthogonal cells: true distances and real section angles.**
  The ΔPDF grid is unchanged (native FFT grid, `x_H/y_K/z_L` in Å along a, b,
  c), but the cell angles now travel with it. They are stored as
  `DeltaPDF.cell_angles` and as `lat_alpha/beta/gamma` in the `.h5` attrs (via a
  shared `pipeline.write_cell_attrs`). They are exposed as `alpha/beta/gamma` in
  the volume, ΔPDF and consistency lattice metadata, and sent with every ΔPDF
  slice (`axes_angle`, `r_center`, `r_perp`).
  - **True distances:** new `real_space_radius` and `section_geometry` in
    `nebula3d.analysis.delta_pdf`. The consistency r band and `r_data_max`
    now use the true metric; this is bit-identical for 90° cells.
  - **Web viewers** (3D-ΔPDF, multi-temperature, Q–R band) draw each section at
    γ/β/α. Unit-cell lines follow the lattice, and r-band circles are placed by
    true distance. The assistant's ΔPDF metrics and context use Cartesian
    positions and include the angles.
  - **matplotlib viewers** (`explore_delta_pdf_ortho.py`,
    `explore_delta_pdf.py`, `explore_delta_pdf_multi.py`) apply the same skew.
    This also fixes the ortho and multi viewers, which had crashed since the
    June rename on leftover `TEMP` / `central[t]` names.
  - **Older files** without angle attrs are drawn at 90° as before.
  - **`ub_from_lattice` fixed.** It returned a singular matrix for every cell;
    it now builds the Busing–Levy B matrix, and new `direct_cell(ub)` inverts it.
  - **Tests:** `tests/test_nonorthogonal_cells.py`, `tests/test_server.py` and
    `web/src/components/__tests__/oblique.test.ts` pin this on orthorhombic,
    hexagonal, monoclinic and triclinic cells.

- **Import from the NeXus Viewer.** The viewer's *Open in NEBULA3D* button
  opens this app with `?import=nexus-viewer&id=…&from=…` and posts its
  symmetrized, masked volume (nebula3d HDF5, padded symmetric about Q = 0)
  once the page reports ready; the in-browser build loads it like *Load
  volume…*, selects it as the dataset and reports back. Messages are exchanged
  only with `window.opener` at an allowed origin (own, drthyang.github.io,
  localhost in dev). `web/src/api/importHandoff.ts` (+ vitest suite),
  `web/src/components/ViewerImportBanner.tsx`; see `docs/web.md`.
- **Mantid loader: projection guard for non-orthogonal cells.** Each dim's
  `long_name` is now read as an (h, k, l) direction (`[-K,2K,0]` → (−1, 2, 0))
  and cross-checked against the `W_MATRIX` log. Only plain H, K, L axes (in any
  order) load; a projected grid such as the orthogonal hexagonal cut
  `[H,0,0]/[-K,2K,0]/[0,0,L]` is rejected with a rebinning hint instead of
  loading with silently wrong |Q| (the old parser took the first H/K/L letter
  in the label). Loads of the existing TbTi3Bi4 files are bit-identical.
  `tests/test_nonorthogonal_cells.py` pins the guard plus metric-correct ring
  removal and ΔPDF peak placement on hexagonal (γ = 120°) and monoclinic
  (β = 110°) cells.
- **Build & CI hardening.** The packaged wheel no longer nests a stale copy of
  the Pyodide wheel inside itself (`vite build` copied `web/public/wheels`
  into `server/static/`, and `package-data` shipped it: 1.35 MB of
  Russian-doll wheels vs ~230 KB clean); `exclude-package-data` now drops
  `static/data` + `static/wheels` from every wheel, the native build no
  longer copies `web/public`, and one shared `scripts/build_web_wheel.py`
  (Makefile + Pages workflow) inspects the wheel and publishes it
  content-addressed under `wheels/<sha256>/` so a redeploy can never serve a
  Pages-cached stale wheel. The browser boot drops matplotlib (~9 MB of
  wheels it loaded only to render a `pdf_check` PNG nothing reads). Pages now
  deploys only after the CI workflow passes on `main`; CI type-checks once
  against pinned numpy/mypy stubs (per-Python stub drift had kept `main` red
  since July), runs the suite under the exact numpy/scipy/h5py/matplotlib
  Pyodide 0.27.7 ships, builds both frontend modes, and reports every matrix
  leg. Also: the package version is read from `_version.py` only, coverage
  moved from pytest `addopts` to the CI command (~40 % faster local runs),
  `httpx2` replaces `httpx` for the Starlette test client, matplotlib
  `set_bad` → `with_extremes`, and a CSS comment containing `*/` that had
  silently disabled the `.bragg-page` flex rule is fixed.
- **Browser engine: parallel ring removal, float32 compute, WebGPU ΔPDF.** The
  static (Pages/Pyodide) build now fans the ring stage out over a pool of slim
  Pyodide ring workers (bit-identical to serial by construction — the pure
  per-plane core in `nebula3d._ringplane` is shared by every backend; pinned by
  `tests/test_ring_parallel.py`), computes with float32 volume storage
  (`PipelineParams.precision`; axes/UB, |Q|-bin decisions, 1-D fits, and large
  reductions stay float64 — validated on all three real TbTi3Bi4 volumes at
  ΔPDF nrms ≤ 1e-5 with ≤ 2 punch-mask flips of 48.4 M voxels, ~15–25 %
  faster), and runs the ΔPDF forward/inverse FFT cores on WebGPU when available
  (`web/src/gpu/` mixed-radix Stockham with numpy-pinned index math; scipy
  fallback at every rung; `fft=webgpu-f32-p5` cache token). The admission gate
  rises from ~50 M to **~80 M voxels** (401³ volumes now run in-browser).
  Plus: streaming consistency metrics and per-plane deapodization (bit-exact,
  ~30 B/voxel off the old peak stage), wheel-manifest boot (no hardcoded
  version), lazy `nebula3d.visualization` import, MEMFS upload-leak fix, and
  workers moved to ES modules (`pyodide.mjs`). Native float64 runs are
  hash-verified bit-identical to the previous release.
  See `docs/reports/2026-08-07_browser_parallel_f32_webgpu.md`.
- **Ring Removal 2.0 — sample-only global 3D powder-shell inference.** Added the
  opt-in `ring_model="global_v2"` path for datasets where an empty-environment
  scan omits the Al holder or over-subtracts. It detects narrow shells in the
  unsubtracted 3D sample volume, weakly identifies the FCC Al family and fitted
  lattice parameter, fits a Bragg-robust real-spherical-harmonic angular field,
  propagates model uncertainty, and defaults to lower-confidence-bound
  subtraction. `auto`, `aluminum`, and material-agnostic modes plus
  conservative/mean/diagnose-only policies are exposed in Python, API, Pyodide,
  and Configure UI. Pipeline runs write a JSON diagnostic sidecar. Legacy
  patched/parametric models remain available and the default pending full
  real-data qualification.
- **The backfill no longer invents data outside the measured coverage.** It
  filled every masked voxel, so on Fe3Ge2 90 K the 41 % of the box past the
  coverage sphere (|Q| 17–34 Å⁻¹) got its rim's shell median, which then entered
  the flatten fit, the ΔPDF, the back-FFT check and the viewers. The fill now
  interpolates and never extrapolates: punch holes, and unmeasured pockets that
  measured data enclose (the direct-beam shadow, dead voxels), are filled as
  before; unmeasured regions that reach a face of the box stay masked.
  `BackfillParams.unmeasured="all"` restores the old fill. See
  docs/algorithms/inpainting.md.
- **The 3D-ΔPDF window respects the lattice symmetry and the measured
  coverage.** The separable window (a product of 1-D tapers along H, K, L) is
  not invariant under the hexagonal 6-fold, so on Fe3Ge2 (6/m) the ΔPDF along a
  and b differed from a + b by 0.03–0.05 of the main peak. New `window_shape`
  (`auto` | `separable` | `ellipsoid`; server `pdf_window_shape`, and a web
  control): `auto` tapers hexagonal cells on the largest symmetric ellipsoid
  inside the box, and keeps the separable window bit for bit for orthogonal,
  monoclinic and triclinic cells. New `support=` (pipeline `window_support`,
  default on; web "Taper to the measured coverage"): masked voxels enter as
  ΔI = 0 and the mean is taken over the data only; where the coverage ends
  inside the box, the ellipsoid shrinks until at most 10⁻³ of its weight lies on
  unmeasured space. With the backfill now leaving that space masked, Fe3Ge2 90 K
  changes by at most 0.08 % at 2–15 Å. Cached ΔPDFs are recomputed once. See
  docs/algorithms/delta_pdf.md.
- **The Bragg punch and the edge trim follow the declared Laue symmetry.** On a
  symmetrised volume (e.g. 6/m from the NeXus Viewer), the punch mask and the
  coverage-edge trim are now invariant under the operations the file declares
  (`PipelineParams.symmetry="auto"`): a voxel punched at one equivalent position
  is punched at all of them. On Fe3Ge2, 22 % of punched voxels had an unpunched
  partner; now none. The H guard and the thirds exclusion hold on every
  equivalent plane, so with 6/m the guard is a hexagonal prism.
  `symmetry=None` restores the old behaviour. See
  docs/algorithms/bragg_cleanup.md.

## 0.3.0 (beta) — 2026-07-05

First beta. Adds an in-browser AI Assistant, a sidebar UI refresh, and the
low-memory + performance work below.

- **AI Assistant — grade the reduction from computed metrics.** A new browser
  view (`web/src/llm/`) connects to a local (Ollama / LM Studio) or cloud
  (OpenAI / Gemini) model and assesses the reduction, grounded in numeric
  metrics computed **in the browser** from the stage volumes — ring-removal
  residual energy, a leftover-Bragg-peak scan plus fitted peak-profile summary,
  backfill seam / checkerboard diagnostics, and ΔPDF feature SNR / anisotropy /
  radial trend. Four one-click stage reviews plus free chat; a ChatGPT-style
  transcript with markdown + LaTeX-Greek rendering, a rotating "sun" avatar, and
  collapsible model reasoning; an optional vision toggle that attaches the
  rendered slice for image-capable models. Everything is client-side — nothing
  leaves the machine except the chat call to the user's configured model server.
  The metrics layer is unit-tested (Vitest). Fixed a stack-overflow in the ΔPDF
  metrics on full-resolution slices along the way.
- **Sidebar UI refresh.** A single global dataset switcher lives in the sidebar
  (per-page dataset pickers removed; Configure shows it read-only); the chat
  session persists across page navigation; the brand is set full-caps; and the
  Multi-volume view is hidden for now. The browser build keeps full feature
  parity with the native backend.
- **In-browser low-memory mode — smaller peak, bit-identical results.** A new
  `NEBULA3D_LOW_MEMORY` mode (`nebula3d.core.low_memory`, always on in the
  Pyodide bridge) trades a little recompute for a smaller peak so full-resolution
  reductions fit the 4 GB WASM heap (Pyodide is 32-bit; there is no wasm64
  build). The ring stage drops its full-3-D |Q|/φ coordinate caches (per-plane
  2-D recompute), the flatten stage subtracts in place, and the unused per-voxel
  `sigma` is freed before the ΔPDF / back-FFT stages. **Verified byte-for-byte
  identical to the exact path on real data** — a 401×501×151 (30.3 M-voxel)
  neutron dataset gives identical backfilled / flattened / ΔPDF volumes and
  identical consistency metrics either way; the whole reduction peaks at ~2.3 GB
  (binding stage: the back-FFT consistency check, ~75 B/voxel). Separately, the
  ring-workflow `backfill_ring_shells` (not the default `q_shell` Bragg backfill)
  now bounds its all-valid-voxel KD-tree to a per-H-slab local tree in
  low-memory mode — within ~1e-5 relative of the exact fill, tested in
  `tests/test_backfill_blocked.py`. 222 tests, ruff, and mypy clean.
- **Pipeline ~22–31 % faster with bit-identical outputs.** Browser audit +
  performance pass (see
  [docs/reports/2026-07-02_browser_audit_perf.md](docs/reports/2026-07-02_browser_audit_perf.md)):
  HDF5 stage outputs now use gzip-1 + byte-shuffle (lossless, ~8 % smaller,
  ~2.6× faster writes), consecutive pipeline stages hand volumes over in
  memory instead of re-reading compressed HDF5 (artifacts and resume
  behaviour unchanged), and the ring-removal texture fit solves its per-|Q|
  ridge systems in one stacked LAPACK call. Every stage artifact verified
  SHA-256-identical before/after at two volume sizes, serial and parallel;
  219 tests, ruff, and mypy clean; in-browser end-to-end run verified
  (6/6 stages, consistency r = 0.99963, no console errors).
- **Milestone: fully static, GitHub Pages-hosted app with feature parity.** The
  browser console now runs the **complete** `nebula3d` reduction — every pipeline
  stage, cleanup, 3D-ΔPDF, multi-volume, and consistency view — entirely
  client-side via Pyodide, at **full-resolution float64** (up to ~50 M voxels;
  a 301×401×401 volume fits). No server, no upload, no install: the app is a
  static bundle served from **https://drthyang.github.io/nebula3d/**, deployed by
  `.github/workflows/pages.yml` on push to `main`. The in-browser build is now a
  first-class path alongside the native `nebula3d-web` backend, not a reduced
  demo. Under Pyodide (no OS threads) ring removal falls back to serial slice
  processing; native CPython still parallelises.
- **Spherical-frame Bragg punch.** The default punch ellipsoid axes now follow
  the local spherical frame at each peak — `(rρ, rθ, rφ)` in Å⁻¹ with rρ radial
  (along Q̂), rφ azimuthal (a*–b* ring tangent, c* pole), rθ polar — so every
  reflection is oriented correctly with no tilt angle. Added
  `punch_frame="spherical"` (now the `PunchParams` / web default) alongside the
  existing `"q"` (a*/b*/c*) and `"hkl"` frames; the legacy frames are unchanged.
  Configure and Bragg-profile pages gain a frame selector and rρ/rθ/rφ controls,
  and the punch preview renders the per-peak oriented ellipse.

## 0.2.0 - 2026-06-18

- Promoted the consistency check to the endpoint of the recommended 3D-ΔPDF
  workflow.
- Added the FastAPI/React consistency viewer and `/api/consistency` endpoints
  for reciprocal-space back-FFT comparison with optional `|Q|` and real-space
  bands.
- Updated `examples/run_pipeline.py` to run the back-FFT consistency check by
  default after the ΔPDF stage.
- Updated documentation around the full workflow, web UI, reproducibility
  commands, and output artifacts.
- Aligned package, API, and web app version metadata at `0.2.0`.

## 0.1.0 - Initial alpha

- Initial alpha toolkit for reciprocal-space diffuse-scattering cleanup and
  3D-ΔPDF exploration.
