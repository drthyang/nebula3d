# Tool definitions with the skills off (validation arm C)

`toolSpecs(toolsWithSkills(CHAT_TOOLS, false))`: what arm C's model is offered with every request (23 tools, 20261 characters as JSON). A tool whose description holds inference (inference.ts; 6-inference.md lists each span) has its definitions only (`descriptionWithoutSkills`, from the same tagged text), shown in full; every other definition is arm B's.

Update from web/: `npx vitest run src/llm/__tests__/modelVisible.test.ts -u`, then read the diff.

## Not offered

read_skill: it works only with the skills on (its facts' `needsSkills`).

## As in arm B (2-tools.md)

14 tools, their definitions as 2-tools.md has them: describe_dataset, current_view, measure_dpdf_cut, assess_stage, qmax_coverage, dpdf_contrast, bragg_peaks, run_log, compare_datasets, configure_settings, update_settings, run_pipeline, tune_pipeline, show_in_viewer.

## measure_reciprocal_cut: its description with the skills off

```text
Compute the stage-quality metrics (ring removal, leftover Bragg peaks, backfill seams, flatten floors) on any reciprocal-space cut — the same metrics as the opening context, which used only the L=0 H–K plane.
```

Its parameters are as in 2-tools.md.

## texture_check: its description with the skills off

```text
Check whether the punch and backfill printed a pattern of their own into reciprocal space, on a cut (default: the three principal planes through the origin). Fill bias: each filled hole against the range its measured rim allows, from the diffuse at the hole's edge carried in to its rise toward the node continued linearly; the part outside that range, signed, in the rim's σ and in units of the local diffuse level. Holes filled systematically outside it (systematic_fill_bias: 75 % of them one way, a median of 0.5σ and a fifth of the level or more) add a lattice-periodic texture. Azimuthal texture: per |Q| shell, how much the sector means vary around the shell before the punch (unpunched voxels) and after the backfill.
```

Its parameters are as in 2-tools.md.

## symmetry_check: its description with the skills off

```text
Check that the 3D-ΔPDF keeps the in-plane symmetry of the cell, when the file declares that its data were symmetrised: an x–y section (default z = 0) compared with its image under each in-plane operation (hexagonal: six-, three-, two-fold and the a ↔ b mirror; orthogonal: the mirrors ⊥ a and ⊥ b, the two-fold, and the four-fold when a = b), as the RMS of the difference over the section's RMS. A symmetry the data were symmetrised with holds to about 1e-3 or better when the pipeline kept it. Which operations the sample has is the user's to say.
```

Its parameters are as in 2-tools.md.

## dpdf_peaks: its description with the skills off

```text
The 3D-ΔPDF's strongest features, read from the whole volume rather than one section: its local extrema above min_sigma (default 5) robust σ of the volume outside the origin's disk, each with its vector in Å along a, b, c and in lattice units, its sign (+: more pairs at that vector than the average structure has, −: fewer) and its size in σ. The ΔPDF is centrosymmetric, so each ± pair is listed once. Extrema of one sign, length and size are one entry (n_vectors), though the grouping does not use the symmetry and two correlations can share a length. What size is worth interpreting, and what a feature means, is the user's call. Quote the vectors, signs and sizes it returns.
```

Its parameters are as in 2-tools.md.

## grain_check: its description with the skills off

```text
Is there a second grain, and what are the sharp off-lattice peaks the punch's search found? It takes the punch's peak record, groups the off-lattice peaks into symmetry orbits (the declared point group), and tests the strongest two ways. Against the Bragg nodes: an orbit within a quarter of the node spacing of one is that peak displaced, and its offset over |Q| is a rotation angle (the angle is a lower bound). As a rotated copy of the Bragg lattice: a second grain is one rotation that indexes most strong orbits, judged against the same search at random directions; a rotation under 2° is the UB, not a grain. Run the punch first. Quote its verdict and numbers.
```

Its parameters are as in 2-tools.md.

## ub_check: its description with the skills off

```text
Is the volume's UB right? On the raw volume it finds each Bragg node's peak (the punch cell gives the Bragg nodes: (2, 2, 2) on a doubled cell), measures its centre, and fits the UB that puts the centres back on their nodes, from low |Q| outward. A volume symmetrised under the operations it declares hides a misorientation as rings around the nodes, not shifts, so there it fits only the changes that commute with the operations (fit 'symmetric': for 6/mmm the scales of the hk plane and of l); otherwise the rotation and the cell together ('both'). radial is the peaks' median offset along Q from their nodes, relative to |Q|, per |Q| band and direction, before and after the fit. mean_offset_rlu is the peaks' mean offset from their nodes in r.l.u., before and after the fit (origin_shift_rlu, when its value after the fit makes most of the offset the fit leaves). About ten seconds on a full volume. Quote rms_start → rms, the cell before and after, the angle, what radial shows, and an origin shift when it gives one.
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
The run's saved back-FFT check in full: Pearson r and normalised RMS of the inverse-FFT ΔPDF against the cleaned data, r per principal plane, the |Q| and r bands, crop and apodization. The transform keeps the real part, which is the data's even part under Q → −Q: pearson_r_even compares the round trip with that part and is 1 when the transform is sound, while r against the data is limited by the odd part (odd_share: counting noise on unsymmetrised data). Neither says a feature is real.
```

Its parameters are as in 2-tools.md.
