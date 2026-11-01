# Tool definitions with the skills off (validation arm C)

`toolSpecs(toolsWithSkills(CHAT_TOOLS, false))`: what arm C's model is offered with every request (27 tools, 21039 characters as JSON). A tool whose description holds inference (inference.ts; 6-inference.md lists each span) has its definitions only (`descriptionWithoutSkills`, from the same tagged text), shown in full; every other definition is arm B's.

Update from web/: `npx vitest run src/llm/__tests__/modelVisible.test.ts -u`, then read the diff.

## Not offered

read_skill: it works only with the skills on (its facts' `needsSkills`).

## As in arm B (2-tools.md)

16 tools, their definitions as 2-tools.md has them: describe_dataset, current_view, assess_stage, texture_check, qmax_coverage, grain_check, bragg_peaks, run_log, compare_datasets, run_verdict, configure_settings, update_settings, run_pipeline, tune_pipeline, regrid_refined_ub, show_in_viewer.

## measure_reciprocal_cut: its description with the skills off

```text
Compute the stage-quality metrics (ring removal, leftover Bragg peaks, backfill seams, flatten floors) on any reciprocal-space cut: one cut, not the volume.
Fields. ring_removal: ring_energy_ratio, after/before share of the radial profile in ring bumps (diffuse keeps it above 0: 0.4–0.5 can be ring-free); over_subtraction_fraction, after_negative_fraction: voxels driven negative (a few percent is noise); ring_residuals per raw ring: residual_fraction against the diffuse beside it (negative a dent, positive a ring left), significant beyond 3 × noise_fraction. bragg_punch_leftover: sharp peaks the punch missed on this cut, not what its search found: n_at_nodes, missed Bragg peaks; n_off_nodes, off the lattice (on_protected_plane: kept by design); n_broad_off_nodes, FWHM ≥ 5 voxels. backfill: median_seam_sigma, |fill − rim| in σ (≲ 1 seamless); checkerboard_fraction, 0.5 random. flatten: floor_before, floor_after: shell floors by third of |Q|; after_negative_fraction ≈ 0.25 by construction; floor_trend, floor_span_fraction over the outer half of the |Q| shells the counts reach (floor_judged_q): both 0.8 or more is a pedestal (the verdict reads the volume's floors); after_floor_max_sigma is reported, not judged.
```

Its parameters are as in 2-tools.md.

## measure_dpdf_cut: its description with the skills off

```text
The 3D-ΔPDF feature metrics on any real-space section, in its own robust σ outside the origin's disk: feature_snr, the strongest feature over background σ; strong_feature_fraction, voxels beyond 5σ; positive_fraction (0.5: balanced ±); anisotropy_ratio (1 isotropic, above ~1.5 rods or sheets) and anisotropy_angle_deg in the plane; radial_trend, mean |ΔPDF| in inner, middle and outer shells.
```

Its parameters are as in 2-tools.md.

## symmetry_check: its description with the skills off

```text
Does the 3D-ΔPDF keep the symmetry its data were declared symmetrised with? Each operation of the declared point group (none: the cell's in-plane ones): the RMS difference from the ΔPDF's image over its RMS, on the worst section it maps (x–y at ±z, default 0; x–z, y–z), else voxel by voxel (tested_on, not_tested). Returns ops, holds, verdict; a kept symmetry holds to about 1e-3. Which operations the sample has is the user's to say.
```

Its parameters are as in 2-tools.md.

## dpdf_contrast: its description with the skills off

```text
Set the 3D-ΔPDF viewer's colour range so pair-correlation features carry the colour and the FFT ripple stays dim. Call it once without arguments: the limit is the 99.9th percentile of |ΔPDF| on the three centre sections (origin disk left out), the page's Auto. Returns the applied limit, and what the 99.5th and 99.97th percentiles would give. Pass percentile or limit_sigma only for a range the user asks for; reset returns to Auto.
```

Its parameters are as in 2-tools.md.

## dpdf_peaks: its description with the skills off

```text
The 3D-ΔPDF's strongest features in the whole volume: extrema above min_sigma (default 5) robust σ outside the origin's disk, each ± pair once. Returns features: length_A, size_sigma (signed: + more pairs than the average structure, − fewer), n_vectors of one sign, length and size, up to 4 vectors_rlu (x/a, y/b, z/c) and vectors_A (Å along a, b, c). What a feature means is the user's call.
```

Its parameters are as in 2-tools.md.

## ub_check: its description with the skills off

```text
Is the volume's UB right? Fits the UB to the raw volume's Bragg-peak centres (the punch cell's nodes, low |Q| first). Returns verdict, rms_start → rms, cell_start and cell, orientation_change_deg, radial (offset along Q per |Q| band and direction), mean_offset_rlu, origin_shift_rlu. On a symmetrised volume only the changes that commute with its operations are fitted (fit 'symmetric'): the orientation needs the unsymmetrised file. About 10 s.
```

Its parameters are as in 2-tools.md.

## compare_laue_classes: its description with the skills off

```text
Which Laue class does the sample have? Compares by R_int every Laue class the cell's metric allows (within 2%) and whose operations map the grid, on the raw volume as the average reads it, on all measured voxels and the diffuse, each over its noise floor (x_noise). Returns classes, rule, suggestion (or none), flag. Refused on a symmetrised volume. Seconds to minutes.
```

Its parameters are as in 2-tools.md.

## radial_profile: its description with the skills off

```text
The median intensity in |Q| shells of one reciprocal cut, for each cleanup stage side by side (raw, ringremoved, braggpunched, backfilled, flattened). Shell medians ignore Bragg peaks but follow powder rings.
```

Its parameters are as in 2-tools.md.

## line_profile: its description with the skills off

```text
Intensity along a straight line parallel to one axis through any stage volume. Reciprocal stages take H/K/L (r.l.u.); delta_pdf takes x/y/z (Å). Returns sampled points plus the exact maximum, minimum and median.
```

Its parameters are as in 2-tools.md.

## consistency_details: its description with the skills off

```text
The run's saved back-FFT check in full: Pearson r and normalised RMS of the inverse-FFT ΔPDF against the cleaned data, r per principal plane, the |Q| and r bands, crop and apodization. pearson_r_even compares the round trip with the data's even part under Q → −Q, what the transform keeps: 1 when it is sound; r against the data is lower by the odd part (odd_share). Neither says a feature is real.
```

Its parameters are as in 2-tools.md.

## mark_region: its description with the skills off

```text
Mark a region in the slice views and move them to it, so the user sees a finding. where: raw, rings, punch, backfill, flatten (h, k, l in r.l.u.) or pdf (x, y, z in Å along a, b, c). shape: box or ellipsoid (center, half_size), or points (up to 12). evidence: the calls showing it, as tool or tool.field (dpdf_peaks.features.0); none, or a region empty or outside the volume, marks nothing. Returns where it is drawn. Cite it by its id (M1, …).
```

Its parameters are as in 2-tools.md.
