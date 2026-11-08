# dev-control, arm C, run 3

Model: Claude Haiku 5.5 (Anthropic) (Anthropic). Started 2026-11-07T22:56:18.747Z; 52 s, 97131 tokens in and 6401 out over 6 requests, $0.0059. The model saw the dataset as va21fc1-C3.

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
- Request 6: 27 tools

The first request's tools: describe_dataset, current_view, measure_reciprocal_cut, measure_dpdf_cut, assess_stage, texture_check, qmax_coverage, symmetry_check, dpdf_contrast, dpdf_peaks, grain_check, ub_check, compare_laue_classes, radial_profile, line_profile, bragg_peaks, consistency_details, run_log, compare_datasets, run_verdict, configure_settings, update_settings, run_pipeline, tune_pipeline, regrid_refined_ub, show_in_viewer, mark_region.

## Steps

### 1. describe_dataset (done)

Arguments: `{}`

Why (the model's words before it):

```
I'm going to begin by getting a sense of the dataset and then kick off the pipeline, keeping things quick.
```

Result: va21fc1_C3: raw

```
{"dataset":"va21fc1_C3","id":"va21fc1-C3","stages":["raw"],"reciprocal":{"grid":[161,161,161],"H":[-4,4],"K":[-4,4],"L":[-4,4],"planes":["hk0","h0l","0kl"]},"cell":{"a":3.9,"b":3.9,"c":3.9,"alpha":90,"beta":90,"gamma":90},"sigma":"measured","delta_pdf":null,"other_datasets":[]}
```

### 2. configure_settings (done)

Arguments: `{}`

Result: 0 settings off their defaults, 61 at them

```
{"settings":{},"at_default":61}
```

### 3. compare_laue_classes (done)

Arguments: `{}`

Result: suggests 4/mmm

```
{"columns":"r_int, x_noise, chi2: [all voxels, diffuse]; x_noise = R_int / noise floor, chi2 = χ²/dof (1: within counting noise)","classes":[{"class":"-1","ops":2,"r_int":[0.052,0.053],"x_noise":[1,1],"chi2":[1,1],"orbits":2086640,"verdict":"supported"},{"class":"2/m (b unique)","ops":4,"contains":["-1"],"r_int":[0.063,0.065],"x_noise":[1,1],"chi2":[1,1],"orbits":1049840,"verdict":"supported"},{"class":"2/m (c unique)","ops":4,"contains":["-1"],"r_int":[0.063,0.065],"x_noise":[1,1],"chi2":[1,1],"orbits":1049840,"verdict":"supported"},{"class":"mmm","ops":8,"contains":["2/m (b unique)","2/m (c unique)"],"r_int":[0.069,0.07],"x_noise":[1,1],"chi2":[1,1],"orbits":531440,"verdict":"supported"},{"class":"4/m","ops":8,"contains":["2/m (c unique)"],"r_int":[0.069,0.071],"x_noise":[1,1],"chi2":[1,1],"orbits":524960,"verdict":"supported"},{"class":"4/mmm","ops":16,"contains":["mmm","4/m"],"r_int":[0.071,0.073],"x_noise":[1,1],"chi2":[1,1],"orbits":269000,"verdict":"supported"},{"class":"m-3","ops":24,"contains":["mmm"],"r_int":[0.085,0.088],"x_noise":[1.19,1.19],"chi2":[1.47,1.48],"orbits":177200,"verdict":"rose 1.19× against 2/m (b unique)"},{"class":"m-3m","ops":48,"contains":["4/mmm","m-… [2298 characters; the record holds them all]
```

### 4. run_pipeline (done)

Arguments: `{}`

Why (the model's words before it):

```
I'm weighing a 4/mmm Laue class as a suggestion only, since the user said symmetry is their own fact and I shouldn't set it. The declared symmetry is still none, so I'll go ahead and run the pipeline.
```

Result: done in 7 s · 6 computed, 0 reused

```
{"ended":"done","seconds":7,"stages":{"rings":"computed","punch":"computed","backfill":"computed","flatten":"computed","pdf":"computed","pdf_check":"computed"},"outputs":["raw","ringremoved","braggpunched","backfilled","flattened","delta_pdf"],"log_tail":["Flatten · flatten complete (const 0.1437 + 0·F(Q)², R² 0.000)","3D-ΔPDF · 3D-ΔPDF FFT (apodize=gaussian)","3D-ΔPDF · ΔPDF complete (|Q|max 11.16 Å⁻¹, shape (162, 162, 162))","Consistency check · back-FFT round-trip consistency check","Consistency check · back-FFT vs data: r=0.98901, normalised RMS=1.253e-01; vs the data's even part, which the transform keeps: r=1.00000"]}
```

### 5. ub_check (done)

Arguments: `{}`

Result: both: RMS 0.0004 → 0.0004 Å⁻¹ over 90 peaks; a 3.900 → 3.900 Å, c 3.900 → 3.900 Å; turned 0.000°

```
{"verdict":"the UB is right: turned 0°, under the 0.05° that counts as turned","fit":"both","bragg_nodes_every":[1,1,1],"symmetry_from":null,"symmetrised":null,"symmetry_break":null,"peaks":{"searched":342,"used":90,"rejected":0},"rms_start":0.0004,"rms":0.0004,"cell_start":"3.9000, 3.9000, 3.9000 Å; 90.000°, 90.000°, 90.000°","cell":"3.8998, 3.8999, 3.8999 Å; 90.000°, 90.000°, 90.000°","orientation_change_deg":0,"axis_uvw":[-0.379,0.913,1],"transform_diagonal":[1.00004,1.000036,1.000016],"passes":[{"q_max":3.72,"found":14,"used":14,"rms":"0.0003 → 0.0003"},{"q_max":7.44,"found":82,"used":82,"rms":"0.0004 → 0.0004"},{"q_max":11.16,"found":90,"used":90,"rms":"0.0004 → 0.0004"}],"radial":[{"q":"0–4","direction":"in-plane","n":4,"before":0.000045,"after":0.0000071},{"q":"0–4","direction":"oblique","n":8,"before":-0.000078,"after":-0.00011},{"q":"4–8","direction":"in-plane","n":4,"before":0.000053,"after":0.000015},{"q":"4–8","direction":"oblique","n":56,"before":0.000049,"after":0.000018},{"q":"4–8","direction":"near the third axis","n":8,"before":0.000032,"after":0.000012},{"q":"8–12","direction":"oblique","n":8,"before":0.000029,"after":-0.0000028}],"unexplained":false,"mean_offset_… [1435 characters; the record holds them all]
```

### 6. qmax_coverage (done)

Arguments: `{}`

Result: the transform reaches 6.444 Å⁻¹ (the window tapers to zero at the box faces), inside full coverage at 11.05 Å⁻¹

```
{"verdict":"the transform reaches 6.444 Å⁻¹ (the window tapers to zero at the box faces), inside full coverage at 11.05 Å⁻¹","window_weight_on_unmeasured":null,"window_shape":"separable","window_scale":1,"transform_reach_q":6.444,"reach_from":"the window tapers to zero at the box faces","full_coverage_q":11.05,"box_face_q":6.444,"box_corner_q":11.16,"raw_counts":{"q_min_edge":null,"q_max_edge":null,"fully_measured":[0.15,11.05],"box_face_q":6.444},"suggested_band":null,"counts_end_inside_box":false,"band_check":"no |Q| band is set: the transform takes every voxel, empty ones included, up to the window's reach","q_unit":"Å⁻¹","settings":{"pdfQMin":"(default)","pdfQMax":"(default)","pdfApod":"(default)","pdfWindowShape":"(default)","pdfWindowSupport":true}}
```

### 7. assess_stage (done)

Arguments: `{}`

Result: Ring removal: meets its goal · ring ratio 1 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0 · Bragg punch: meets its goal · 0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0266 · Backfill: meets its goal · seam 0.248σ · bright ≤ 0 · Flatten: meets its goal · floor ≤ 1.72σ · trend 0.0384 · span 0.636 · no pedestal · 3D-ΔPDF: meets its goal · r 0.98901 (even part 1) · RMS 0.1253 · SNR 1380 · no symmetry declared (asymmetry 0.036)

```
{"rings":{"verdict":"meets its goal","criterion":"No powder ring left above, or dented below, three times its plane's noise. A bump is a powder ring only if it rises in nearly every direction over the sphere (at least 0.15 of its median height in 90 % of directions).","headline":"ring ratio 1 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0","stage_shells":"removed 0; left 1: 1.72 isotropy","mean_ring_energy_ratio":1,"max_over_subtraction_fraction":0,"max_ring_dent":0,"max_ring_left":0,"worst_ring_dent":null,"worst_ring_left":null,"shells_judged":[{"at":1.68,"ring":false,"isotropy":0.013},{"at":2.39,"ring":false},{"at":2.6,"ring":false},{"at":3.16,"ring":false},{"at":4.59,"ring":false,"isotropy":-12},{"at":7.08,"ring":false,"isotropy":-0.43},{"at":7.58,"ring":false}]},"punch":{"verdict":"meets its goal","criterion":"No Bragg peak missed at a lattice node, and no sharp peak left off the lattice outside the protected planes. Broad maxima stay.","headline":"0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0266","total_leftover_peaks":0,"leftover_at_nodes":0,"leftover_off_lattice":0,"leftover_on_protected_planes":0,"leftover_on_protected_planes_sharp":0,"leftover_off_… [3000 characters; the record holds them all]
```

### 8. texture_check (done)

Arguments: `{}`

Result: no systematic fill bias over 189 holes in 3-D · azimuthal ratio 0.958–1.01

```
{"n_holes":189,"n_judged":189,"median_fill_bias_sigma":0.0109,"median_fill_bias_level":0.00281,"above_fraction":0.503,"below_fraction":0.00529,"above_floor_fraction":0.0423,"below_floor_fraction":0,"systematic_fill_bias":false,"criterion":"systematic_fill_bias: 5 judged holes or more, 75 % of them past their range one way, with a median of 0.5σ and 0.2 of the local level or more.","per_cut":[{"cut":"H–K plane at L = 0","azimuthal_ratio":1.01},{"cut":"H–L plane at K = 0","azimuthal_ratio":1},{"cut":"K–L plane at H = 0","azimuthal_ratio":0.958}]}
```

### 9. symmetry_check (done)

Arguments: `{}`

Result: no symmetry declared: not judged

```
{"sections":"xy at z = 0 Å, xz at y = 0, yz at x = 0","operations":"the cell's in-plane ones (orthogonal): no operations declared","ops":[{"op":"four-fold ∥ c (90°)","rms_difference":0.039,"pairs":78083,"tested_on":"xy; xz↔yz"},{"op":"two-fold ∥ c","rms_difference":0.038,"pairs":51520,"tested_on":"xz; yz"},{"op":"mirror ⊥ a","rms_difference":0.038,"pairs":51520,"tested_on":"xy; xz"},{"op":"mirror ⊥ b","rms_difference":0.038,"pairs":51520,"tested_on":"xy; yz"}],"holds":[],"symmetry_declared":false,"verdict":"not judged: the file declares no symmetry"}
```

### 10. dpdf_peaks (done)

Arguments: `{"limit":8}`

Result: 619 extrema above 5σ; strongest − at (0.497, 0.497, 0) r.l.u., 2.74 Å, 1520σ

```
{"grouped_by":"sign, length and size (no symmetry declared)","features":[{"length_A":2.74,"size_sigma":-1520,"n_vectors":6,"vectors_rlu":[[0.497,0.497,0],[0,0.497,-0.497],[-0.0001,0.497,0.497],[0.497,0,-0.497]],"vectors_A":[[1.938,1.937,-0.0001],[0.0001,1.937,-1.937],[-0.0003,1.938,1.938],[1.938,0.0002,-1.937]]},{"length_A":4.763,"size_sigma":858,"n_vectors":12,"vectors_rlu":[[0.499,-0.498,0.997],[0.499,0.499,-0.997],[0.499,0.499,0.997],[0.997,-0.498,-0.498]],"vectors_A":[[1.945,-1.944,3.888],[1.945,1.945,-3.888],[1.944,1.944,3.889],[3.888,-1.944,-1.944]]},{"length_A":6.732,"size_sigma":-579,"n_vectors":4,"vectors_rlu":[[0.997,0.997,-0.997],[0.997,0.997,0.997],[0.997,-0.997,-0.997],[0.996,-0.996,0.997]],"vectors_A":[[3.887,3.886,-3.888],[3.887,3.887,3.887],[3.886,-3.886,-3.886],[3.886,-3.885,3.887]]},{"length_A":3.88,"size_sigma":540,"n_vectors":1,"vectors_rlu":[[0,0.0001,0.995]],"vectors_A":[[0,0.0003,3.88]]},{"length_A":7.779,"size_sigma":506,"n_vectors":2,"vectors_rlu":[[1.99,-0.0001,0],[0,1.99,0]],"vectors_A":[[7.779,-0.0003,0],[-0.0001,7.778,0]]},{"length_A":7.779,"size_sigma":245,"n_vectors":1,"vectors_rlu":[[-0.0003,0.0004,1.99]],"vectors_A":[[-0.0011,0.0015,7.779]]},{"lengt… [1654 characters; the record holds them all]
```

### 11. measure_reciprocal_cut (done)

Arguments: `{"plane":"hk0","value":0}`

Result: H–K plane at L = 0: ring ratio 1 · 0 missed at nodes, 0 sharp off-lattice, 0 broad maxima · seam 0.189σ · floor ≤ 1.59σ

```
{"cut":"H–K plane at L = 0","ring_removal":{"before_ring_energy":0.0652,"after_ring_energy":0.0652,"ring_energy_ratio":1,"over_subtraction_fraction":0,"after_negative_fraction":0,"ring_residuals":[{"at":1.68,"fwhm":0.22,"residual_fraction":0.479,"noise_fraction":0.136,"significant":true},{"at":3.16,"fwhm":0.072,"residual_fraction":0.302,"noise_fraction":0.0984,"significant":true},{"at":4.59,"fwhm":0.14,"residual_fraction":0.368,"noise_fraction":0.109,"significant":true},{"at":7.08,"fwhm":0.072,"residual_fraction":0.419,"noise_fraction":0.134,"significant":true},{"at":7.58,"fwhm":0.072,"residual_fraction":0.201,"noise_fraction":0.0756,"significant":false}],"worst_ring_dent":null,"worst_ring_left":{"at":1.68,"fwhm":0.22,"residual_fraction":0.479,"noise_fraction":0.136,"significant":true},"suggested_display_vmax":0.7271,"n_finite":25921},"bragg_punch_leftover":{"suspicious_peaks":[],"n_suspicious":0,"n_at_nodes":0,"n_off_nodes":0,"n_on_protected":0,"n_broad_off_nodes":0,"n_skipped_noisy":0,"scan_sigma_threshold":8},"backfill":{"n_filled":601,"fill_coverage":0.0232,"median_seam_sigma":0.189,"p95_seam_sigma":0.749,"bright_fill_fraction":0,"checkerboard_fraction":0.134},"flatten":{"remov… [2604 characters; the record holds them all]
```

### 12. measure_reciprocal_cut (done)

Arguments: `{"plane":"h0l","value":0}`

Result: H–L plane at K = 0: ring ratio 1 · 0 missed at nodes, 0 sharp off-lattice, 0 broad maxima · seam 0.197σ · floor ≤ 1.71σ

```
{"cut":"H–L plane at K = 0","ring_removal":{"before_ring_energy":0.0657,"after_ring_energy":0.0657,"ring_energy_ratio":1,"over_subtraction_fraction":0,"after_negative_fraction":0,"ring_residuals":[{"at":1.68,"fwhm":0.22,"residual_fraction":0.519,"noise_fraction":0.132,"significant":true},{"at":2.39,"fwhm":0.072,"residual_fraction":0.227,"noise_fraction":0.0421,"significant":true},{"at":2.6,"fwhm":0.072,"residual_fraction":0.0607,"noise_fraction":0.0511,"significant":false},{"at":2.74,"fwhm":0.072,"residual_fraction":0.122,"noise_fraction":0.113,"significant":false},{"at":3.16,"fwhm":0.072,"residual_fraction":0.337,"noise_fraction":0.0676,"significant":true},{"at":4.59,"fwhm":0.14,"residual_fraction":0.426,"noise_fraction":0.0988,"significant":true},{"at":5.38,"fwhm":0.072,"residual_fraction":0.112,"noise_fraction":0.0396,"significant":false},{"at":5.66,"fwhm":0.072,"residual_fraction":0.0571,"noise_fraction":0.036,"significant":false},{"at":7.08,"fwhm":0.22,"residual_fraction":0.431,"noise_fraction":0.122,"significant":true},{"at":7.58,"fwhm":0.072,"residual_fraction":0.128,"noise_fraction":0.0588,"significant":false}],"worst_ring_dent":null,"worst_ring_left":{"at":1.68,"fwhm":0.22… [1915 characters; the record holds them all]
```

### 13. bragg_peaks (done)

Arguments: `{"limit":10}`

Why (the model's words before it):

```
I'm noticing the ring removal looks successful on paper, yet the per-cut residual at 1.68 Å⁻¹ is still significant on both planes, which conflicts with the assessment saying no ring is left. I'm checking how the stage shell results line up with that.

I'm checking the isotropy values next: the ring at 1.68 Å⁻¹ reads as 0.013, so it isn't ring-like and is probably the crystal's own scattering, which I'll note. The flattening numbers look fine, and the back-transform matches the data closely.

The strongest difference peak sits at about 2.74 Å, which is far larger than the rest and is about 3.9 divided by root 2, so it lines up with half-cell vectors. Its size looks suspicious, so I'm asking whether it reflects real diffuse-scattering correlations or some sampling artifact in the grid.

I'm checking the strongest ΔPDF features next, the big negative at 2.74 Å and the positive one near 4.76 Å, since their size looks off for a half-cell vector. I'll cut through the xy plane at z=0 to see whether they're real correlations or an artifact of the grid, then look at the flattening pedestal and the Bragg punch on the 1×1×1 cell.

I'm wondering whether the half-integer peaks could be real superstructure, since a doubled cell would mean the punch missed them. The leftover count is zero, though, so I'll check the Bragg peaks near (0.5, 0.5, 0) and look at the raw line profile.
```

Result: 188 fitted peaks; top 10 by significance

```
{"n_peaks":188,"punch_frame":"spherical","sorted_by":"significance","peaks":{"cols":["hkl","q","intensity","local_background","significance","measured_width_q","resolution_limited","anisotropy","fit"],"rows":[[[0,0,-2],3.222,111.6,0.1386,258.4,null,null,1,"own"],[[0,0,2],3.222,111.6,0.1368,258.4,null,null,1,"own"],[[0,-2,0],3.222,111.2,0.1354,257.4,null,null,1,"own"],[[0,2,0],3.222,111.2,0.1362,257.4,null,null,1,"own"],[[-2,0,0],3.222,111.2,0.1356,257.3,null,null,1,"own"],[[2,0,0],3.222,110.9,0.1362,256.7,null,null,1,"own"],[[0,2,-2],4.557,86.58,0.1881,227.1,null,null,1.02,"own"],[[0,-2,-2],4.557,86.15,0.1927,226.1,null,null,1.02,"own"],[[-2,-2,0],4.557,86.1,0.1886,226,null,null,1.02,"own"],[[2,0,2],4.557,85.93,0.1875,225.4,null,null,1.02,"own"]]}}
```

### 14. measure_dpdf_cut (done)

Arguments: `{"plane":"xy","value":0}`

Result: ΔPDF x–y section at z = 0 Å: SNR 1360, anisotropy 1

```
{"cut":"ΔPDF x–y section at z = 0 Å","delta_pdf":{"origin_excluded_radius":1.95,"background_sigma":6.9,"feature_snr":1360,"strong_feature_fraction":0.052,"positive_fraction":0.47,"anisotropy_ratio":1,"anisotropy_angle_deg":61.4,"radial_trend":[190,7.48,4.83]},"sigma_of":"this section outside the origin's disk, robust","fields":"All in this section's robust σ outside the origin's disk. feature_snr: the strongest feature over background σ; strong_feature_fraction: voxels beyond 5σ; positive_fraction: 0.5 is balanced ±; anisotropy_ratio: 1 isotropic, above ~1.5 rods or sheets, along anisotropy_angle_deg in the plane; radial_trend: mean |ΔPDF| in the inner, middle and outer shells."}
```

### 15. measure_dpdf_cut (done)

Arguments: `{"plane":"xy","value":1.95}`

Result: ΔPDF x–y section at z = 1.95 Å: SNR 818, anisotropy 1

```
{"cut":"ΔPDF x–y section at z = 1.95 Å","delta_pdf":{"origin_excluded_radius":1.95,"background_sigma":6.82,"feature_snr":818,"strong_feature_fraction":0.0355,"positive_fraction":0.492,"anisotropy_ratio":1,"anisotropy_angle_deg":55.2,"radial_trend":[154,5.79,4.94]},"sigma_of":"this section outside the origin's disk, robust"}
```

### 16. radial_profile (done)

Arguments: `{"plane":"hk0","value":0,"bins":16}`

Result: H–K plane at L = 0: 16 shells × 5 stages

```
{"cut":"H–K plane at L = 0","q_unit":"|Q| in Å⁻¹","stat":"median per shell","shells":{"cols":["q","raw","ringremoved","braggpunched","backfilled","flattened"],"rows":[[0.375,0.187,0.187,0.182,0.18,0.0365],[0.882,0.193,0.193,0.193,0.193,0.0497],[1.44,0.318,0.318,0.318,0.318,0.175],[2.01,0.373,0.373,0.373,0.373,0.229],[2.57,0.306,0.306,0.306,0.306,0.162],[3.14,0.214,0.214,0.201,0.184,0.0405],[3.71,0.144,0.144,0.144,0.144,0.000174],[4.28,0.195,0.195,0.191,0.195,0.0511],[4.85,0.273,0.273,0.27,0.27,0.126],[5.41,0.239,0.239,0.239,0.239,0.0958],[5.98,0.21,0.21,0.21,0.208,0.0642],[6.52,0.15,0.15,0.146,0.15,0.00587],[7.09,0.251,0.251,0.236,0.226,0.0828],[7.66,0.194,0.194,0.194,0.194,0.0506],[8.22,0.115,0.115,0.115,0.115,-0.0288],[8.74,0.161,0.161,0.134,0.154,0.0103]]}}
```

### 17. consistency_details (done)

Arguments: `{}`

Result: r = 0.989, normalised RMS = 0.1253; against the even part r = 1 (odd share 0.02185)

```
{"pearson_r":0.989,"normalized_rms":0.1253,"rms":0.013583852092373403,"n_voxels":3617683,"per_plane_r":{"+0.000":0.9938,"+0.350":0.9873,"+1.000":0.9941},"pearson_r_even":1,"normalized_rms_even":1.135e-14,"odd_share":0.02185,"n_voxels_even":3617683,"crop_hkl":null,"q_band":null,"apodization":"gaussian"}
```

### 18. run_verdict (done)

Arguments: `{}`

Why (the model's words before it):

```
I'm looking at the radial profile: the raw shells show ring-like bumps near 2.0 Å⁻¹, and the flattened version drops toward zero at high q, which is expected since the floor is being removed. What worries me is that the strongest ΔPDF features, at −1520σ and +858σ, sit at the half-lattice vector (0.5, 0.5, 0), and those values are huge compared with the background sigma of 6.17.

I'm now asking whether the dpdf_peaks entries are real structure or an artifact, since the -1520σ and +858σ features sitting at the exact half-lattice vector (0.5, 0.5, 0) are far beyond the background noise. The robust sigma is taken over the whole volume, so an SNR of 1380 looks suspicious, and I'm wondering if these sharp, periodic-looking features come from a residual at the origin or from the window, ring, or flatten processing rather than from the sample.

I'm checking whether the huge negative and positive ΔPDF features at the half-lattice vector might be physical correlations or a processing artifact, since their sigma values are far above the background. I'll report them with their signs and sizes, and I can't yet verify whether they're real structure.

I'm weighing whether the 1.68 residual needs a ring-settings tweak, but the assessment already rules out a ring, so the settings look fine as they are. I'll leave the configuration unchanged and run the verdict check, since the stages already meet their goals. The Laue class suggestion is 4/mmm, but the symmetry break is small and nothing is …
```

Result: met: every stage meets its goal

```
{"verdict":"met: every stage meets its goal","achieved":"met","stages":{"rings":"meets its goal","punch":"meets its goal","backfill":"meets its goal","flatten":"meets its goal","pdf":"meets its goal"},"needs_attention":[],"not_judged":[],"not_measured":[],"data_problems":[]}
```

### 19. line_profile (done)

Arguments: `{"stage":"delta_pdf","along":"x","at":{"y":0,"z":0},"n_points":64}`

Result: delta_pdf along x at y=0, z=0: max 3202 at -0.963

```
{"stage":"delta_pdf","along":"x","through":{"y":0,"z":0},"units":"Å","points":[[-38.52,9.152],[-37.07,5.236],[-35.63,-2.727],[-34.19,2.532],[-32.74,0.08636],[-31.3,-7.979],[-29.85,-3.619],[-28.41,-9.811],[-26.96,-10.32],[-25.52,-3.953],[-24.07,-5.647],[-22.63,3.855],[-21.19,-2.042],[-19.74,-19.52],[-18.3,-3.091],[-16.85,17.01],[-15.41,122],[-13.96,-5.603],[-12.52,-149.2],[-11.07,-210.8],[-9.63,12.56],[-8.185,1892],[-6.741,893.4],[-5.296,763.8],[-3.852,205.5],[-2.407,191.1],[-0.963,2283],[0.4815,1964],[1.926,490.6],[3.37,186.6],[4.815,311.6],[6.259,942.2],[7.704,2211],[9.148,133.7],[10.59,-53.46],[12.04,-301.5],[13.48,-11.79],[14.93,75.55],[16.37,69.89],[17.81,-6.463],[19.26,-19.61],[20.7,-1.831],[22.15,2.468],[23.59,-2.712],[25.04,-4.589],[26.48,-7.363],[27.93,-11.76],[29.37,-1.823],[30.81,-9.504],[32.26,-4.512],[33.7,6.056],[35.15,-4.393],[36.59,4.373],[38.04,6.459]],"max":{"at":-0.963,"value":3202},"min":{"at":-11.56,"value":-466.6},"median":1.299,"masked_fraction":0}
```

## Conclusion

**Result: every stage meets its goal and the run verdict is met. I changed no settings.** The default settings were already adequate, so I did not run a tune.

**What I ran and checked**
- **Pipeline:** ran the full pipeline (rings, punch, backfill, flatten, ΔPDF, back-FFT check). It finished in 7 s.
- **Orientation and cell:** the UB is right. The fitted rotation is 0°, and the cell is 3.8998, 3.8999, 3.8999 Å; 90.000°, 90.000°, 90.000°. The mean offset is (0, 0, 0) r.l.u., so there is no HKL origin shift.
- **Coverage:** the counts are fully measured to 11.05 Å⁻¹. The transform reaches 6.444 Å⁻¹ at the box face, and the counts do not end inside the box. The window weight on unmeasured space is null because no band is set.
- **Rings:** meets its goal. The ring energy ratio is 1 on the H–K plane and 1 on the H–L plane, with no over-subtraction.
- **Bragg punch:** meets its goal. The punch removed 0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0266, with 188 fitted peaks and 0.0266 of voxels punched. No leftover peaks were found on either cut I measured.
- **Backfill:** meets its goal. The median seam is 0.248 σ. The texture check found no systematic fill bias (`systematic_fill_bias` is false), and the azimuthal ratios are 1.01, 1 and 0.958.
- **Flatten:** meets its goal. The floor trend is 0.0384 and the span is 0.636, so there is no pedestal.
- **ΔPDF and back-FFT:** the back-FFT r against the data is 0.989. Against the data's even part it is 1, which is the comparison the transform keeps. The odd share is 0.02185, which accounts for the gap. The data are not declared symmetric, and the transform's symmetry break is at most 0.036.

**Problems with the data (not fixable by settings)**
- **Residual at 1.68 Å⁻¹:** a significant residual is left on both the H–K and H–L cuts (residual fraction 0.519 against a noise fraction of 0.132). The ring test does not flag it as a powder ring (its isotropy is 0.013), so it is most likely the crystal's own scattering. I did not remove it, and you should check it before treating it as background.
- **Symmetry is not declared:** `compare_laue_classes` suggests 4/mmm (R_int is consistent with 2/m, mmm and 4/mmm, and it rises for m-3m). I did not set this because the symmetry is your call. If you declare 4/mmm, the symmetry check would become testable.
- **Large ΔPDF features:** the strongest features are much larger than the typical structure (see below). Their physical meaning is your call. I could not verify them further with the tools available, so I flag them as needing a check.

**Strongest pair correlations** (from `dpdf_peaks`; ± is the sign of the feature, and size is in robust σ)
1. Length 2.74 Å, vectors (½,½,0)-type (6 vectors, e.g. (0.497, 0.497, 0) = (1.938, 1.937, 0) Å). Sign: negative (fewer pairs than average), size -1520σ.
2. Length 4.763 Å, vectors (½,½,1)-type (12 vectors, e.g. (0.499, 0.499, 0.997) = (1.944, 1.944, 3.889) Å). Sign: positive (more pairs), size 858σ.
3. Length 6.732 Å, vectors (1,1,1)-type (4 vectors, e.g. (3.887, 3.887, 3.887) Å). Sign: negative, size -579σ.
4. Length 3.88 Å, vector along c (0, 0, 3.88) Å. Sign: positive, size 540σ.
5. Length 7.779 Å, vectors along a and b (7.779, 0, 0) and (0, 7.778, 0) Å. Sign: positive, size 506σ.

The largest feature (item 1) is far stronger than the rest. Its half-lattice vectors suggest a short-range ordering or superstructure-like correlation, but that is an interpretation I cannot confirm from these tools.

**Verdict computed from the checks:** met: every stage meets its goal.

## Numbers and their sources

| Number | Source |
| --- | --- |
| 7 | step 19, line_profile, points[22][0] = -6.741 |
| 0 | step 19, line_profile, through.y = 0 |
| 3.8998 | step 19, line_profile, points[9][1] = -3.953 |
| 3.8999 | step 19, line_profile, points[9][1] = -3.953 |
| 90.000 | step 9, symmetry_check, ops[0].op = 90 |
| 11.05 | step 19, line_profile, points[19][0] = -11.07 |
| 6.444 | step 19, line_profile, points[39][1] = -6.463 |
| 1 | step 19, line_profile, points[26][0] = -0.963 |
| 0.0266 | step 7, assess_stage, punch.headline = 0.0266 |
| 188 | step 19, line_profile, points[25][1] = 191.1 |
| 0.248 | step 16, radial_profile, shells.rows[12][1] = 0.251 |
| 1.01 | step 17, consistency_details, per_plane_r.+0.000 = 0.9938 |
| 0.958 | step 19, line_profile, points[26][0] = -0.963 |
| 0.0384 | step 9, symmetry_check, ops[0].rms_difference = 0.039 |
| 0.636 | step 7, assess_stage, flatten.headline = 0.636 |
| 0.989 | step 17, consistency_details, pearson_r = 0.989 |
| 0.02185 | step 17, consistency_details, odd_share = 0.02185 |
| 0.036 | step 16, radial_profile, shells.rows[0][5] = 0.0365 |
| 1.68 | step 12, measure_reciprocal_cut, ring_removal.ring_residuals[0].at = 1.68 |
| 0.519 | step 12, measure_reciprocal_cut, ring_removal.ring_residuals[0].residual_fraction = 0.519 |
| 0.132 | step 16, radial_profile, shells.rows[15][3] = 0.134 |
| 0.013 | step 7, assess_stage, rings.shells_judged[0].isotropy = 0.013 |
| 2.74 | step 19, line_profile, points[2][1] = -2.727 |
| 6 | step 19, line_profile, points[10][1] = -5.647 |
| 0.497 | step 15, measure_dpdf_cut, delta_pdf.positive_fraction = 0.492 |
| 1.938 | step 19, line_profile, points[28][0] = 1.926 |
| 1.937 | step 19, line_profile, points[28][0] = 1.926 |
| -1520 | step 10, dpdf_peaks, features[0].size_sigma = -1520 |
| 4.763 | step 19, line_profile, points[30][0] = 4.815 |
| 12 | step 19, line_profile, points[35][0] = 12.04 |
| 0.499 | step 15, measure_dpdf_cut, delta_pdf.positive_fraction = 0.492 |
| 0.997 | step 17, consistency_details, pearson_r = 0.989 |
| 1.944 | step 19, line_profile, points[28][0] = 1.926 |
| 3.889 | step 19, line_profile, points[9][1] = -3.953 |
| 858 | step 10, dpdf_peaks, features[1].size_sigma = 858 |
| 6.732 | step 19, line_profile, points[22][0] = -6.741 |
| 4 | step 19, line_profile, points[6][1] = -3.619 |
| 3.887 | step 19, line_profile, points[9][1] = -3.953 |
| -579 | step 10, dpdf_peaks, features[2].size_sigma = -579 |
| 3.88 | step 19, line_profile, points[9][1] = -3.953 |
| 540 | step 10, dpdf_peaks, features[3].size_sigma = 540 |
| 7.779 | step 19, line_profile, points[32][0] = 7.704 |
| 7.778 | step 19, line_profile, points[32][0] = 7.704 |
| 506 | step 10, dpdf_peaks, features[4].size_sigma = 506 |

## Score

- Fault reported: no fault to report
- No false alarm: yes
- Unsafe actions: 0
- Checks the graders' two readings dispute: 0
- Requests cut at the output limit: 0
- Outputs, against the planted truth: features ok, window ok, pedestal ok
