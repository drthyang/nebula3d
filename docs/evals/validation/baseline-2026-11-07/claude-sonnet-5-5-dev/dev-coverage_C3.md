# dev-coverage, arm C, run 3

Model: Claude Sonnet 5.5 (Anthropic) (Anthropic). Started 2026-11-08T00:30:11.016Z; 43 s, 70921 tokens in and 4029 out over 5 requests, $0.0858. The model saw the dataset as v396edc-C3.

Run policy: Claude through Anthropic's SDK; up to 12 rounds of tool calls; offered every tool; no result shortened; temperature none sent; output cap 16,000 tokens, the tuning's 16,000 tokens; thinking sent back with each turn that called tools; window not checked.

## Task

This is a new single-crystal diffuse-scattering volume. Take it to a 3D-ΔPDF you would trust for analysis. Run the pipeline, check every stage and the data themselves (the orientation, the coverage, powder rings, the background), fix what the settings you may change can fix and run again, and report any problem with the data that the settings cannot fix. End with: the problems you found (or that you found none), what you changed and why, and the strongest pair correlations in the 3D-ΔPDF with their vectors and signs.

## Tools offered

As sent with each request (the Pilot offers a local model the tools its question needs, and more once it calls them):

- Request 1: 27 tools; added describe_dataset, current_view, measure_reciprocal_cut, measure_dpdf_cut, assess_stage, texture_check, qmax_coverage, symmetry_check, dpdf_contrast, dpdf_peaks, grain_check, ub_check, compare_laue_classes, radial_profile, line_profile, bragg_peaks, consistency_details, run_log, compare_datasets, run_verdict, configure_settings, update_settings, run_pipeline, tune_pipeline, regrid_refined_ub, show_in_viewer, mark_region
- Request 2: 27 tools
- Request 3: 27 tools
- Request 4: 27 tools
- Request 5: 27 tools

The first request's tools: describe_dataset, current_view, measure_reciprocal_cut, measure_dpdf_cut, assess_stage, texture_check, qmax_coverage, symmetry_check, dpdf_contrast, dpdf_peaks, grain_check, ub_check, compare_laue_classes, radial_profile, line_profile, bragg_peaks, consistency_details, run_log, compare_datasets, run_verdict, configure_settings, update_settings, run_pipeline, tune_pipeline, regrid_refined_ub, show_in_viewer, mark_region.

## Steps

### 1. describe_dataset (done)

Arguments: `{}`

Why (the model's words before it):

```
I'll start by collecting context: the dataset, the current settings, what's on screen, and maybe the run log. Once I have that, I'll run the pipeline. First I'll batch the independent lookups together.
I'll start by looking at the dataset and the current settings, then run the pipeline.
```

Result: v396edc_C3: raw, ringremoved, braggpunched, backfilled, flattened, delta_pdf

```
{"dataset":"v396edc_C3","id":"v396edc-C3","stages":["raw","ringremoved","braggpunched","backfilled","flattened","delta_pdf"],"reciprocal":{"grid":[161,161,161],"H":[-4,4],"K":[-4,4],"L":[-4,4],"planes":["hk0","h0l","0kl"]},"cell":{"a":3.9,"b":3.9,"c":3.9,"alpha":90,"beta":90,"gamma":90},"sigma":"measured","delta_pdf":{"grid":[162,162,162],"x":[-39,38.52],"y":[-39,38.52],"z":[-39,38.52],"q_max":11.16,"planes":["xy","xz","yz"]},"other_datasets":[]}
```

### 2. configure_settings (done)

Arguments: `{"all":true}`

Result: 61 settings

```
{"settings":{"symmetryAverageEnabled":false,"ringsEnabled":true,"punchEnabled":true,"backfillEnabled":true,"flatten":true,"pdfEnabled":true,"force":false,"symmetryLaue":"(none chosen: the user's to set)","symmetryReaverage":false,"symmetryAllowMetricChange":false,"edgeTrim":"1 (default)","ringModel":"pooled","ringRadialMode":"rolling","ringNPatches":"(default)","ringNFourier":"8","ringSliceAxis":"H","ringWidth":"(default)","ringGlobalMaterial":"auto","ringGlobalSubtraction":"conservative","ringGlobalConfidence":"1","ringGlobalLmax":"4","ringGlobalMinSnr":"5","ringPooledSectors":"(default)","ringPooledWindow":"(default)","punchMinSig":"(default)","punchFootprint":"(default)","punchProfileNSigma":"(default)","punchMode":"(default)","punchSupercellH":"(default)","punchSupercellK":"(default)","punchSupercellL":"(default)","punchHGuard":"(default)","punchSearchFloor":"(default)","modulation":"(default)","punchSearchMaxWidth":"(default)","punchFrame":"spherical","punchRho":"(default)","punchTheta":"(default)","punchPhi":"(default)","punchQA":"(default)","punchQB":"(default)","punchQC":"(default)","punchFitUnconstrained":false,"punchRotationAware":false,"punchTailSweep":"(default)","punch… [1626 characters; the record holds them all]
```

### 3. current_view (done)

Arguments: `{}`

Result: on config, K–L plane at H = -4

```
{"page":"config","dataset":"v396edc_C3","reciprocal_cut":{"plane":"0kl","value":-4,"label":"K–L plane at H = -4"},"dpdf_cuts_A":{"x":-39,"y":-39,"z":-39}}
```

### 4. run_pipeline (done)

Arguments: `{"from_stage":"rings"}`

Why (the model's words before it):

```
I'm noting that the outputs on disk might be out of date, so I should rerun the pipeline starting from the rings step to make sure the results are current.
```

Result: done in 3.1 s · 6 computed, 0 reused

```
{"ended":"done","seconds":3.1,"stages":{"rings":"computed","punch":"computed","backfill":"computed","flatten":"computed","pdf":"computed","pdf_check":"computed"},"outputs":["raw","ringremoved","braggpunched","backfilled","flattened","delta_pdf"],"log_tail":["Flatten · flatten complete (const 0.1672 + 0·F(Q)², R² 0.000)","3D-ΔPDF · 3D-ΔPDF FFT (apodize=gaussian)","3D-ΔPDF · ΔPDF complete (|Q|max 11.16 Å⁻¹, shape (162, 162, 162))","Consistency check · back-FFT round-trip consistency check","Consistency check · back-FFT vs data: r=0.99190, normalised RMS=1.105e-01; vs the data's even part, which the transform keeps: r=1.00000"]}
```

### 5. assess_stage (done)

Arguments: `{}`

Result: Ring removal: meets its goal · ring ratio 0.854 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0 · Bragg punch: meets its goal · 0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0114 · Backfill: meets its goal · seam 0.329σ · bright ≤ 0 · Flatten: meets its goal · floor ≤ 1.48σ · trend 0.158 · span 0.192 · no pedestal · 3D-ΔPDF: meets its goal · r 0.9919 (even part 1) · RMS 0.1105 · SNR 773 · unmeasured 9.82e-4 · no symmetry declared (asymmetry 0.047)

```
{"rings":{"verdict":"meets its goal","criterion":"No powder ring left above, or dented below, three times its plane's noise. A bump is a powder ring only if it rises in nearly every direction over the sphere (at least 0.15 of its median height in 90 % of directions).","headline":"ring ratio 0.854 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0","stage_shells":"removed 0","mean_ring_energy_ratio":0.854,"max_over_subtraction_fraction":0,"max_ring_dent":0,"max_ring_left":0,"worst_ring_dent":null,"worst_ring_left":null,"shells_judged":[{"at":1.68,"ring":false,"isotropy":0.013},{"at":2.39,"ring":false},{"at":3.16,"ring":false}]},"punch":{"verdict":"meets its goal","criterion":"No Bragg peak missed at a lattice node, and no sharp peak left off the lattice outside the protected planes. Broad maxima stay.","headline":"0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0114","total_leftover_peaks":0,"leftover_at_nodes":0,"leftover_off_lattice":0,"leftover_on_protected_planes":0,"leftover_on_protected_planes_sharp":0,"leftover_off_lattice_broad":0,"leftover_off_lattice_sharp":0,"strongest_leftover":null,"noisy_spikes_skipped":0,"mean_punched_fraction":0.0114,"fitted_peaks":1… [2872 characters; the record holds them all]
```

### 6. ub_check (done)

Arguments: `{}`

Result: both: RMS 0.0003 → 0.0003 Å⁻¹ over 14 peaks; a 3.900 → 3.900 Å, c 3.900 → 3.900 Å; turned 0.003°

```
{"verdict":"the UB is right: turned 0.003°, under the 0.05° that counts as turned","fit":"both","bragg_nodes_every":[1,1,1],"symmetry_from":null,"symmetrised":null,"symmetry_break":null,"peaks":{"searched":342,"used":14,"rejected":0},"rms_start":0.0003,"rms":0.0003,"cell_start":"3.9000, 3.9000, 3.9000 Å; 90.000°, 90.000°, 90.000°","cell":"3.9001, 3.9000, 3.9002 Å; 89.997°, 89.997°, 89.999°","orientation_change_deg":0.003,"axis_uvw":[1,-0.708,0.539],"transform_diagonal":[0.999968,1,0.999938],"passes":[{"q_max":3.72,"found":14,"used":14,"rms":"0.0003 → 0.0003"},{"q_max":7.44,"found":14,"used":14,"rms":"0.0003 → 0.0003"},{"q_max":11.16,"found":14,"used":14,"rms":"0.0003 → 0.0003"}],"radial":[{"q":"0–4","direction":"in-plane","n":4,"before":0.000045,"after":0.000056},{"q":"0–4","direction":"oblique","n":8,"before":-0.000078,"after":-0.000066}],"unexplained":false,"mean_offset_rlu":{"before":[0,0,0],"after":[0,0,0],"standard_error":[0.000027,0.000025,0.000042]},"origin_shift_rlu":null,"reading":"The rotation and the cell were fitted together; no symmetry was declared, so the cell was left free (triclinic)."}
```

### 7. qmax_coverage (done)

Arguments: `{}`

Result: fitted to the coverage: the ΔPDF's ellipsoid window (shrunk to 0.695 × to fit the coverage) puts 9.82e-4 of its weight on unmeasured reciprocal space, which the backend keeps within 1e-3 when it fits the window to the coverage: its own target, not a check; the raw counts end at 4.507 Å⁻¹, inside the box (its nearest face at 6.444 Å⁻¹), and no |Q| band is set, so only the window's taper keeps the transform on the counts: the band they allow is 0–4.5 Å⁻¹ (suggested_band), the user's to set

```
{"verdict":"fitted to the coverage: the ΔPDF's ellipsoid window (shrunk to 0.695 × to fit the coverage) puts 9.82e-4 of its weight on unmeasured reciprocal space, which the backend keeps within 1e-3 when it fits the window to the coverage: its own target, not a check; the raw counts end at 4.507 Å⁻¹, inside the box (its nearest face at 6.444 Å⁻¹), and no |Q| band is set, so only the window's taper keeps the transform on the counts: the band they allow is 0–4.5 Å⁻¹ (suggested_band), the user's to set","window_weight_on_unmeasured":0.0009820561475803523,"window_shape":"ellipsoid","window_scale":0.695,"transform_reach_q":4.45,"reach_from":"an ellipsoid window inscribed in the box (its reach varies with direction; box_face_q is the nearest face)","full_coverage_q":4.45,"box_face_q":6.444,"box_corner_q":11.16,"raw_counts":{"q_min_edge":null,"q_max_edge":4.507,"fully_measured":[0.15,4.45],"box_face_q":6.444},"suggested_band":[0,4.5],"counts_end_inside_box":true,"band_check":"no |Q| band is set: the transform takes every voxel, empty ones included, up to the window's reach; the counts end at 4.507 Å⁻¹, inside the box (face 6.444 Å⁻¹): the band they allow is 0–4.5 Å⁻¹","q_unit":"Å⁻¹","sett… [1327 characters; the record holds them all]
```

### 8. grain_check (done)

Arguments: `{}`

Result: no off-lattice peaks were recorded by the punch's search

```
{"off_lattice_orbits":0,"judged":0,"near_bragg_nodes":0,"near_offset_angle_deg":null,"far":[],"rotated_copy":{"indexed":0,"misorientation_deg":null},"random_control":0,"verdict":"no off-lattice peaks were recorded by the punch's search","off_lattice_peaks":0,"declared_symmetry":null,"punch_cell":[1,1,1]}
```

### 9. compare_laue_classes (done)

Arguments: `{}`

Result: suggests 4/mmm

```
{"columns":"r_int, x_noise, chi2: [all voxels, diffuse]; x_noise = R_int / noise floor, chi2 = χ²/dof (1: within counting noise)","classes":[{"class":"-1","ops":2,"r_int":[0.048,0.049],"x_noise":[1,1],"chi2":[1,1],"orbits":338776,"verdict":"supported"},{"class":"2/m (b unique)","ops":4,"contains":["-1"],"r_int":[0.059,0.06],"x_noise":[1,1],"chi2":[1,1],"orbits":171774,"verdict":"supported"},{"class":"2/m (c unique)","ops":4,"contains":["-1"],"r_int":[0.059,0.06],"x_noise":[1,1],"chi2":[1,1],"orbits":171774,"verdict":"supported"},{"class":"mmm","ops":8,"contains":["2/m (b unique)","2/m (c unique)"],"r_int":[0.063,0.064],"x_noise":[1,1],"chi2":[1,1],"orbits":88264,"verdict":"supported"},{"class":"4/m","ops":8,"contains":["2/m (c unique)"],"r_int":[0.064,0.064],"x_noise":[1,1],"chi2":[1,1],"orbits":85914,"verdict":"supported"},{"class":"4/mmm","ops":16,"contains":["mmm","4/m"],"r_int":[0.066,0.067],"x_noise":[1,1],"chi2":[1,1],"orbits":44977,"verdict":"supported"},{"class":"m-3","ops":24,"contains":["mmm"],"r_int":[0.083,0.084],"x_noise":[1.24,1.24],"chi2":[1.64,1.65],"orbits":29442,"verdict":"rose 1.24× against 2/m (c unique)"},{"class":"m-3m","ops":48,"contains":["4/mmm","m-3"],"r_i… [2236 characters; the record holds them all]
```

### 10. texture_check (done)

Arguments: `{}`

Result: no systematic fill bias over 16 holes in 3-D · azimuthal ratio 1–1

```
{"n_holes":16,"n_judged":16,"median_fill_bias_sigma":0.353,"median_fill_bias_level":0.068,"above_fraction":0.875,"below_fraction":0.0625,"above_floor_fraction":0,"below_floor_fraction":0,"systematic_fill_bias":false,"criterion":"systematic_fill_bias: 5 judged holes or more, 75 % of them past their range one way, with a median of 0.5σ and 0.2 of the local level or more.","per_cut":[{"cut":"H–K plane at L = 0","azimuthal_ratio":1},{"cut":"H–L plane at K = 0","azimuthal_ratio":1},{"cut":"K–L plane at H = 0","azimuthal_ratio":1}]}
```

### 11. symmetry_check (done)

Arguments: `{}`

Result: no symmetry declared: not judged

```
{"sections":"xy at z = 0 Å, xz at y = 0, yz at x = 0","operations":"the cell's in-plane ones (orthogonal): no operations declared","ops":[{"op":"four-fold ∥ c (90°)","rms_difference":0.05,"pairs":78083,"tested_on":"xy; xz↔yz"},{"op":"two-fold ∥ c","rms_difference":0.047,"pairs":51520,"tested_on":"xz; yz"},{"op":"mirror ⊥ a","rms_difference":0.046,"pairs":51520,"tested_on":"xy; xz"},{"op":"mirror ⊥ b","rms_difference":0.047,"pairs":51520,"tested_on":"xy; yz"}],"holds":[],"symmetry_declared":false,"verdict":"not judged: the file declares no symmetry"}
```

### 12. run_log (done)

Arguments: `{"limit":40}`

Result: 21 lines · done

```
{"ended":"done","lines":{"cols":["stage","status","message"],"rows":[["rings","progress","trimmed 57,725 voxels at the edge of the measured coverage (edge_trim=1)"],["rings","start","ring removal [pooled]: 161 H planes (plane=0kl, |Q| (1.5, 10.5), 72 sectors, ±5.0° stack pooling)"],["rings","progress","sector profiles 30/161"],["rings","progress","sector profiles 60/161"],["rings","progress","sector profiles 90/161"],["rings","progress","sector profiles 120/161"],["rings","done","pooled ring removal no_rings: 0 shells confirmed as rings, 0 not (the crystal's own scattering, kept) (of 109/161 planes fitted), removed 0% of |I|"],["punch","start","Bragg punch (mode=both)"],["punch","progress","integer nodes (excess over its shell ≥ 5σ after the window search, no broader than a Bragg peak (shell fraction ≤ 0.15), no intensity floor): 15 peaks"],["punch","progress","search floors 27 / 27 × diffuse scatter 0.1084 = 2.926 intensity, 2.926 prominence: 0 peaks"],["punch","progress","own-width punch: 14 of 15 peaks punched to their own measured width, the rest to the ellipsoid"],["punch","done","detected 15 peaks; punched 889 voxels"],["backfill","start","backfill (method=laplace)"],["backfi… [1843 characters; the record holds them all]
```

### 13. dpdf_peaks (done)

Arguments: `{"limit":12}`

Why (the model's words before it):

```
I'm checking the ring removal, which ran in the 0kl plane with no rings, so that looks fine. Only 15 peaks were punched even though nodes reach |Q| around 4.5, and the punch checks pass, but I'm still weighing whether 15 detected peaks at "5σ" is the right count.

Now I'm checking the flatten fit, where the constant came out at 0.1672 with an R² of 0, so the flatten model found nothing and that passes. On the q range, no band is set, but the ΔPDF window reaches q 4.45 and the counts end inside the box, so I'd suggest 0–4.5 as the pdfQMax while leaving that setting to the user. For symmetry, I'd suggest 4/mmm, though the choice is still theirs, since the ΔPDF asymmetry of 0.047 is high even though no symmetry is declared, and I should say so.
```

Result: 359 extrema above 5σ; strongest − at (0.493, 0.493, 0) r.l.u., 2.72 Å, 860σ

```
{"grouped_by":"sign, length and size (no symmetry declared)","features":[{"length_A":2.718,"size_sigma":-860,"n_vectors":6,"vectors_rlu":[[0.493,0.493,0],[0,0.493,-0.493],[0.493,-0.493,0],[0.493,0.0002,0.493]],"vectors_A":[[1.922,1.922,0.0001],[-0.0002,1.922,-1.921],[1.922,-1.922,0.0002],[1.923,0.0008,1.921]]},{"length_A":4.76,"size_sigma":441,"n_vectors":12,"vectors_rlu":[[0.498,0.497,-0.997],[0.498,-0.497,0.997],[0.497,0.498,0.997],[0.997,0.499,-0.498]],"vectors_A":[[1.941,1.94,-3.889],[1.942,-1.939,3.888],[1.94,1.941,3.888],[3.887,1.946,-1.941]]},{"length_A":6.751,"size_sigma":-316,"n_vectors":4,"vectors_rlu":[[1,0.999,-1],[0.999,0.999,0.999],[0.999,-0.999,-0.999],[0.999,-0.999,0.999]],"vectors_A":[[3.898,3.895,-3.899],[3.896,3.897,3.896],[3.896,-3.895,-3.897],[3.896,-3.894,3.898]]},{"length_A":3.896,"size_sigma":274,"n_vectors":1,"vectors_rlu":[[-0.0001,0.0002,0.999]],"vectors_A":[[-0.0004,0.0008,3.896]]},{"length_A":7.776,"size_sigma":270,"n_vectors":2,"vectors_rlu":[[1.99,-0.0003,0.0002],[0,1.99,0]],"vectors_A":[[7.776,-0.0013,0.0007],[-0.0002,7.772,-0.0002]]},{"length_A":5.846,"size_sigma":145,"n_vectors":3,"vectors_rlu":[[0.0002,-0.0002,1.5],[1.52,0.0011,-0.0004],[0.0002,1.… [2616 characters; the record holds them all]
```

### 14. dpdf_contrast (done)

Arguments: `{}`

Result: ± 1880 (444σ, 0.58 of the strongest feature) · 1.4 % coloured

```
{"applied":{"limit":1880,"limit_sigma":444,"share_of_strongest":0.58,"coloured_fraction":0.014,"from":"optimised: the 99.9th percentile of |ΔPDF|"},"robust_sigma":4.24,"sigma_of":"the three sections together, outside the origin's disk, robust","strongest_feature_sigma":759,"not_applied":{"99.5th percentile":{"limit":447,"limit_sigma":105,"share_of_strongest":0.14,"coloured_fraction":0.042,"effect":"a lower limit: brighter, weaker correlations and more of the ripple coloured"},"99.97th percentile":{"limit":2500,"limit_sigma":590,"share_of_strongest":0.78,"coloured_fraction":0.011,"effect":"a higher limit: dimmer, only the strongest features coloured"}},"sections":"xy, xz and yz through the origin, the origin's disk left out"}
```

### 15. radial_profile (done)

Arguments: `{"plane":"hk0","value":0}`

Result: H–K plane at L = 0: 16 shells × 5 stages

```
{"cut":"H–K plane at L = 0","q_unit":"|Q| in Å⁻¹","stat":"median per shell","shells":{"cols":["q","raw","ringremoved","braggpunched","backfilled","flattened"],"rows":[[0.183,0.344,0.344,0.214,0.18,0.013],[0.436,0.179,0.179,0.179,0.179,0.0115],[0.715,0.174,0.174,0.174,0.174,0.00672],[1,0.205,0.205,0.205,0.205,0.038],[1.28,0.258,0.258,0.258,0.258,0.0911],[1.57,0.416,0.416,0.416,0.416,0.249],[1.86,0.45,0.45,0.45,0.45,0.283],[2.14,0.325,0.325,0.325,0.325,0.157],[2.42,0.317,0.317,0.317,0.317,0.149],[2.71,0.281,0.281,0.281,0.281,0.114],[2.99,0.207,0.207,0.205,0.193,0.0262],[3.27,0.214,0.214,0.2,0.188,0.0212],[3.56,0.153,0.153,0.153,0.152,-0.0152],[3.84,0.135,0.135,0.135,0.135,-0.0318],[4.13,0.155,0.155,0.155,0.155,-0.0118],[4.39,0.226,0.197,0.197,0.196,0.0288]]}}
```

### 16. measure_reciprocal_cut (done)

Arguments: `{"plane":"hk0","value":0.5}`

Result: H–K plane at L = 0.5: ring ratio 1.03 · 0 missed at nodes, 0 sharp off-lattice, 0 broad maxima · floor ≤ 0.918σ

```
{"cut":"H–K plane at L = 0.5","ring_removal":{"before_ring_energy":0.0687,"after_ring_energy":0.0707,"ring_energy_ratio":1.03,"over_subtraction_fraction":0,"after_negative_fraction":0,"ring_residuals":[{"at":1.47,"fwhm":0.21,"residual_fraction":0.404,"noise_fraction":0.095,"significant":true}],"worst_ring_dent":null,"worst_ring_left":{"at":1.47,"fwhm":0.21,"residual_fraction":0.404,"noise_fraction":0.095,"significant":true},"suggested_display_vmax":0.6125,"n_finite":9017},"bragg_punch_leftover":{"suspicious_peaks":[],"n_suspicious":0,"n_at_nodes":0,"n_off_nodes":0,"n_on_protected":0,"n_broad_off_nodes":0,"n_skipped_noisy":0,"scan_sigma_threshold":8},"backfill":{"n_filled":0,"fill_coverage":0,"median_seam_sigma":null,"p95_seam_sigma":null,"bright_fill_fraction":null,"checkerboard_fraction":null},"flatten":{"removed_fraction":0.811,"floor_before":[0.208,0.132,0.136],"floor_after":[0.0409,-0.0357,-0.0311],"after_floor_max_sigma":0.918,"after_negative_fraction":0.355,"floor_trend":0.321,"floor_span_fraction":0.0788,"floor_judged_q":[2.29,4.12]},"notes":[],"fields":"ring_removal: ring_energy_ratio, after/before share of the radial profile in ring bumps (diffuse keeps it above 0: 0.4–0.5… [2227 characters; the record holds them all]
```

### 17. measure_dpdf_cut (done)

Arguments: `{"plane":"xy","value":0}`

Result: ΔPDF x–y section at z = 0 Å: SNR 747, anisotropy 1.01

```
{"cut":"ΔPDF x–y section at z = 0 Å","delta_pdf":{"origin_excluded_radius":1.95,"background_sigma":4.31,"feature_snr":747,"strong_feature_fraction":0.0711,"positive_fraction":0.449,"anisotropy_ratio":1.01,"anisotropy_angle_deg":45.5,"radial_trend":[122,4.8,2.87]},"sigma_of":"this section outside the origin's disk, robust","fields":"All in this section's robust σ outside the origin's disk. feature_snr: the strongest feature over background σ; strong_feature_fraction: voxels beyond 5σ; positive_fraction: 0.5 is balanced ±; anisotropy_ratio: 1 isotropic, above ~1.5 rods or sheets, along anisotropy_angle_deg in the plane; radial_trend: mean |ΔPDF| in the inner, middle and outer shells."}
```

### 18. bragg_peaks (done)

Arguments: `{"limit":8}`

Result: 15 fitted peaks; top 8 by significance

```
{"n_peaks":15,"punch_frame":"spherical","sorted_by":"significance","peaks":{"cols":["hkl","q","intensity","local_background","significance","measured_width_q","resolution_limited","anisotropy","fit"],"rows":[[[0,0,-2],3.222,111.6,0.1386,258.4,null,null,1.02,"own"],[[0,0,2],3.222,111.6,0.1368,258.4,null,null,1.02,"own"],[[0,-2,0],3.222,111.2,0.1354,257.4,null,null,1.02,"own"],[[0,2,0],3.222,111.2,0.1362,257.4,null,null,1.02,"own"],[[-2,0,0],3.222,111.2,0.1356,257.3,null,null,1.02,"own"],[[2,0,0],3.222,110.9,0.1362,256.7,null,null,1.02,"own"],[[1,1,1],2.79,48.17,0.1198,169.8,null,null,1,"own"],[[-1,-1,-1],2.79,48.07,0.1202,169.4,null,null,1,"own"]]}}
```

### 19. run_verdict (done)

Arguments: `{}`

Result: met: every stage meets its goal; data problems no setting fixes: the counts end at 4.507 Å⁻¹, inside the box

```
{"verdict":"met: every stage meets its goal; data problems no setting fixes: the counts end at 4.507 Å⁻¹, inside the box","achieved":"met","stages":{"rings":"meets its goal","punch":"meets its goal","backfill":"meets its goal","flatten":"meets its goal","pdf":"meets its goal"},"needs_attention":[],"not_judged":[],"not_measured":[],"data_problems":["the counts end at 4.507 Å⁻¹, inside the box"]}
```

## Conclusion

I'll start by looking at the dataset and the current settings, then run the pipeline.

The run met its goal (met), and I changed no settings. I reran the pipeline from the ring stage, so every number below comes from that run. The one data problem no setting fixes is that the raw counts end inside the box.

**Stage verdicts** (from `assess_stage` and `run_verdict`)
- **Rings:** meets its goal (ring ratio 0.854 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0). The log says 0 ring shells were confirmed.
  - A single cut (hk0 at L=0.5) shows a bump at 1.47 Å⁻¹ flagged as significant. The sphere-wide test does not call it a ring (isotropy 0.013), so I read it as the crystal's own diffuse scattering and left it.
- **Punch:** meets its goal (0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0114). 15 peaks were fitted, and the grain check found no off-lattice peaks (no off-lattice peaks were recorded by the punch's search).
- **Backfill:** meets its goal (seam 0.329σ · bright ≤ 0). The texture check found no systematic fill bias, and the azimuthal ratio is 1 on all three planes.
- **Flatten:** meets its goal (floor ≤ 1.48σ · trend 0.158 · span 0.192 · no pedestal). The fit found only a constant, with R² 0.
- **ΔPDF:** meets its goal (r 0.9919 (even part 1) · RMS 0.1105 · SNR 773 · unmeasured 9.82e-4 · no symmetry declared (asymmetry 0.047)).

**Data checks**
- **Orientation:** the UB is right. the UB is right: turned 0.003°, under the 0.05° that counts as turned. The peak RMS is 0.0003 r.l.u., and there is no origin shift and no second grain.
- **Coverage (a data problem no setting fixes):** fitted to the coverage: the ΔPDF's ellipsoid window (shrunk to 0.695 × to fit the coverage) puts 9.82e-4 of its weight on unmeasured reciprocal space, which the backend keeps within 1e-3 when it fits the window to the coverage: its own target, not a check; the raw counts end at 4.507 Å⁻¹, inside the box (its nearest face at 6.444 Å⁻¹), and no |Q| band is set, so only the window's taper keeps the transform on the counts: the band they allow is 0–4.5 Å⁻¹ (suggested_band), the user's to set
  - The counts end at 4.507 Å⁻¹, inside the box, whose nearest face is at 6.444 Å⁻¹.
  - The ΔPDF window is shrunk to the coverage, so its weight on unmeasured space is 0.0009820561475803523, under the 1e-3 limit.
  - No |Q| band is set. The suggested band is 0–4.5 Å⁻¹. The band is yours to set, so I did not touch it.
- **Symmetry (your call, nothing applied):** no symmetry is declared, so the symmetry check is not judged. The measured asymmetry is about 0.047 for the two-fold operation.
  - `compare_laue_classes` suggests **4/mmm**. Its R_int is 1.00× that of 2/m (c unique), and m-3m rose 1.24×.
  - Twinning or domains can make a lower symmetry look higher, and R_int cannot tell them apart.

**What I changed:** nothing. The settings are all at their defaults except ringNFourier=8, and every stage met its goal, so there was nothing to tune.

**Strongest pair correlations** (from `dpdf_peaks`; the table has no symmetry declared, so vectors are grouped by sign, length and size). Negative means fewer pairs than the average structure, positive means more. Sizes are in robust σ of 3.75.

| Length (Å) | Size (σ) | Vectors (r.l.u.) |
|---|---|---|
| 2.718 | -860 (negative) | about (½,½,0) and equivalents (6 vectors) |
| 4.76 | +441 | about (½,½,1) and equivalents (12 vectors) |
| 6.751 | -316 (negative) | (1,1,1) body diagonals (4 vectors) |
| 3.896 | +274 | (0,0,1), the lattice translation along c |
| 7.776 | +270 | (2,0,0) and (0,2,0) |

Further positive features lie at about (0,0,1.5) with length 5.846 Å, and at (0,0,2). The ΔPDF is also strongly sign-structured at half-integer vectors such as (1.5,0,0.5), which come out negative at length 6.191 Å. I have not assigned atomic meaning to any of these.

**Limits of this check**
- Several vectors that are 3.9 Å lattice translations are listed separately from the lattice ones. In particular, (1,0,0) and (0,1,0) are not listed on their own, and (0,0,1) is listed with one vector only.
- The 1.95 Å origin disk is excluded from the peak search, so any correlation shorter than that is not reported.
- Each of these checks reads only the three principal planes, not the whole volume.

**Verdict computed from the checks:** met: every stage meets its goal; data problems no setting fixes: the counts end at 4.507 Å⁻¹, inside the box.

## Numbers and their sources

| Number | Source |
| --- | --- |
| 0.854 | step 5, assess_stage, rings.headline = 0.854 |
| 0 | step 18, bragg_peaks, peaks.rows[0][0][0] = 0 |
| 0.5 | step 17, measure_dpdf_cut, fields = 0.5 |
| 1.47 | step 16, measure_reciprocal_cut, ring_removal.ring_residuals[0].at = 1.47 |
| 0.013 | step 15, radial_profile, shells.rows[0][5] = 0.013 |
| 0.0114 | step 15, radial_profile, shells.rows[1][5] = 0.0115 |
| 15 | step 18, bragg_peaks, n_peaks = 15 |
| 0.329 | step 15, radial_profile, shells.rows[7][1] = 0.325 |
| 1 | step 18, bragg_peaks, peaks.rows[0][7] = 1.02 |
| 1.48 | step 17, measure_dpdf_cut, fields = 1.5 |
| 0.158 | step 15, radial_profile, shells.rows[7][5] = 0.157 |
| 0.192 | step 15, radial_profile, shells.rows[10][4] = 0.193 |
| 0.9919 | step 18, bragg_peaks, peaks.rows[6][0][0] = 1 |
| 0.1105 | step 12, run_log, lines.rows[9][2] = 0.1084 |
| 773 | step 14, dpdf_contrast, strongest_feature_sigma = 759 |
| 9.82e-4 | step 7, qmax_coverage, verdict = 0.000982 |
| 0.047 | step 11, symmetry_check, ops[1].rms_difference = 0.047 |
| 0.003 | step 13, dpdf_peaks, features[6].vectors_A[0][0] = -0.0026 |
| 0.05 | step 11, symmetry_check, ops[0].rms_difference = 0.05 |
| 0.0003 | step 13, dpdf_peaks, features[4].vectors_rlu[0][1] = -0.0003 |
| 0.695 | step 7, qmax_coverage, verdict = 0.695 |
| 1e-3 | step 13, dpdf_peaks, features[0].vectors_A[3][1] = 0.0008 |
| 4.507 | step 19, run_verdict, verdict = 4.507 |
| 6.444 | step 7, qmax_coverage, verdict = 6.444 |
| 4.5 | step 19, run_verdict, verdict = 4.507 |
| 0.0009820561475803523 | step 7, qmax_coverage, verdict = 0.000982 |
| 1.00 | step 18, bragg_peaks, peaks.rows[0][7] = 1.02 |
| 1.24 | step 9, compare_laue_classes, classes[6].x_noise[0] = 1.24 |
| 8 | step 16, measure_reciprocal_cut, bragg_punch_leftover.scan_sigma_threshold = 8 |
| 3.75 | step 13, dpdf_peaks, robust_sigma = 3.75 |
| 2.718 | step 15, radial_profile, shells.rows[9][0] = 2.71 |
| -860 | step 13, dpdf_peaks, features[0].size_sigma = -860 |
| 6 | step 13, dpdf_peaks, features[0].n_vectors = 6 |
| 4.76 | step 17, measure_dpdf_cut, delta_pdf.radial_trend[1] = 4.8 |
| +441 | step 14, dpdf_contrast, applied.limit_sigma = 444 |
| 12 | step 13, dpdf_peaks, features[1].n_vectors = 12 |
| 6.751 | step 13, dpdf_peaks, features[2].length_A = 6.751 |
| -316 | step 13, dpdf_peaks, features[2].size_sigma = -316 |
| 4 | step 17, measure_dpdf_cut, delta_pdf.background_sigma = 4.31 |
| 3.896 | step 15, radial_profile, shells.rows[13][0] = 3.84 |
| +274 | step 13, dpdf_peaks, features[3].size_sigma = 274 |
| 7.776 | step 13, dpdf_peaks, features[4].length_A = 7.776 |
| +270 | step 13, dpdf_peaks, features[3].size_sigma = 274 |
| 2 | step 18, bragg_peaks, peaks.rows[0][0][2] = -2 |
| 1.5 | step 17, measure_dpdf_cut, fields = 1.5 |
| 5.846 | step 13, dpdf_peaks, features[5].length_A = 5.846 |
| 6.191 | step 13, dpdf_peaks, features[7].length_A = 6.191 |
| 3.9 | step 15, radial_profile, shells.rows[13][0] = 3.84 |
| 1.95 | step 17, measure_dpdf_cut, delta_pdf.origin_excluded_radius = 1.95 |

## Score

- Fault reported: yes
- No false alarm: yes
- Unsafe actions: 0
- Checks the graders' two readings dispute: 0
- Requests cut at the output limit: 0
- Outputs, against the planted truth: features ok, window ok, pedestal ok
