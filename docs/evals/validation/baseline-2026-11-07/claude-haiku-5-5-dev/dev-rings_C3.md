# dev-rings, arm C, run 3

Model: Claude Haiku 5.5 (Anthropic) (Anthropic). Started 2026-11-07T23:07:47.213Z; 71 s, 113221 tokens in and 8236 out over 7 requests, $0.0071. The model saw the dataset as vf423ac-C3.

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
- Request 7: 27 tools

The first request's tools: describe_dataset, current_view, measure_reciprocal_cut, measure_dpdf_cut, assess_stage, texture_check, qmax_coverage, symmetry_check, dpdf_contrast, dpdf_peaks, grain_check, ub_check, compare_laue_classes, radial_profile, line_profile, bragg_peaks, consistency_details, run_log, compare_datasets, run_verdict, configure_settings, update_settings, run_pipeline, tune_pipeline, regrid_refined_ub, show_in_viewer, mark_region.

## Steps

### 1. describe_dataset (done)

Arguments: `{}`

Why (the model's words before it):

```
I'm going to begin by getting a picture of the dataset and then kicking off the pipeline. I'll call describe_dataset and configure_settings at the same time.
```

Result: vf423ac_C3: raw

```
{"dataset":"vf423ac_C3","id":"vf423ac-C3","stages":["raw"],"reciprocal":{"grid":[161,161,161],"H":[-4,4],"K":[-4,4],"L":[-4,4],"planes":["hk0","h0l","0kl"]},"cell":{"a":3.9,"b":3.9,"c":3.9,"alpha":90,"beta":90,"gamma":90},"sigma":"measured","delta_pdf":null,"other_datasets":[]}
```

### 2. configure_settings (done)

Arguments: `{}`

Result: 0 settings off their defaults, 61 at them

```
{"settings":{},"at_default":61}
```

### 3. run_pipeline (done)

Arguments: `{}`

Result: done in 13.6 s · 6 computed, 0 reused

```
{"ended":"done","seconds":13.6,"stages":{"rings":"computed","punch":"computed","backfill":"computed","flatten":"computed","pdf":"computed","pdf_check":"computed"},"outputs":["raw","ringremoved","braggpunched","backfilled","flattened","delta_pdf"],"log_tail":["Flatten · flatten complete (const 0.1435 + 0·F(Q)², R² 0.000)","3D-ΔPDF · 3D-ΔPDF FFT (apodize=gaussian)","3D-ΔPDF · ΔPDF complete (|Q|max 11.16 Å⁻¹, shape (162, 162, 162))","Consistency check · back-FFT round-trip consistency check","Consistency check · back-FFT vs data: r=0.98880, normalised RMS=1.266e-01; vs the data's even part, which the transform keeps: r=1.00000"]}
```

### 4. assess_stage (done)

Arguments: `{}`

Result: Ring removal: meets its goal · ring ratio 0.799 · over-sub ≤ 0.000193 · ring dent ≤ 0 · left ≤ 0 · Bragg punch: meets its goal · 0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0266 · Backfill: meets its goal · seam 0.242σ · bright ≤ 0 · Flatten: meets its goal · floor ≤ 1.68σ · trend 0.0385 · span 0.645 · no pedestal · 3D-ΔPDF: meets its goal · r 0.9888 (even part 1) · RMS 0.1266 · SNR 949 · unmeasured 0 · no symmetry declared (asymmetry 0.052)

```
{"rings":{"verdict":"meets its goal","criterion":"No powder ring left above, or dented below, three times its plane's noise. A bump is a powder ring only if it rises in nearly every direction over the sphere (at least 0.15 of its median height in 90 % of directions).","headline":"ring ratio 0.799 · over-sub ≤ 0.000193 · ring dent ≤ 0 · left ≤ 0","stage_shells":"removed 2; left 1: 1.68 isotropy","mean_ring_energy_ratio":0.799,"max_over_subtraction_fraction":0.000193,"max_ring_dent":0,"max_ring_left":0,"worst_ring_dent":null,"worst_ring_left":null,"shells_judged":[{"at":1.71,"ring":false,"isotropy":-0.14},{"at":1.81,"ring":false,"isotropy":-0.55},{"at":2.17,"ring":true,"isotropy":0.9},{"at":3.16,"ring":false},{"at":4.02,"ring":true,"isotropy":0.95},{"at":4.59,"ring":false}]},"punch":{"verdict":"meets its goal","criterion":"No Bragg peak missed at a lattice node, and no sharp peak left off the lattice outside the protected planes. Broad maxima stay.","headline":"0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0266","total_leftover_peaks":0,"leftover_at_nodes":0,"leftover_off_lattice":0,"leftover_on_protected_planes":0,"leftover_on_protected_planes_sharp":0,"l… [3020 characters; the record holds them all]
```

### 5. ub_check (done)

Arguments: `{}`

Result: both: RMS 0.0004 → 0.0004 Å⁻¹ over 90 peaks; a 3.900 → 3.900 Å, c 3.900 → 3.900 Å; turned 0.001°

```
{"verdict":"the UB is right: turned 0.001°, under the 0.05° that counts as turned","fit":"both","bragg_nodes_every":[1,1,1],"symmetry_from":null,"symmetrised":null,"symmetry_break":null,"peaks":{"searched":342,"used":90,"rejected":0},"rms_start":0.0004,"rms":0.0004,"cell_start":"3.9000, 3.9000, 3.9000 Å; 90.000°, 90.000°, 90.000°","cell":"3.8998, 3.8999, 3.8999 Å; 90.000°, 89.999°, 89.999°","orientation_change_deg":0.001,"axis_uvw":[0.431,1,0.594],"transform_diagonal":[1.000043,1.000024,1.000025],"passes":[{"q_max":3.72,"found":14,"used":14,"rms":"0.0003 → 0.0002"},{"q_max":7.44,"found":82,"used":82,"rms":"0.0004 → 0.0004"},{"q_max":11.16,"found":90,"used":90,"rms":"0.0004 → 0.0004"}],"radial":[{"q":"0–4","direction":"in-plane","n":4,"before":0.000044,"after":0.000011},{"q":"0–4","direction":"oblique","n":8,"before":-0.000073,"after":-0.00011},{"q":"4–8","direction":"in-plane","n":4,"before":0.000048,"after":0.00001},{"q":"4–8","direction":"oblique","n":56,"before":0.00004,"after":0.0000053},{"q":"4–8","direction":"near the third axis","n":8,"before":0.000032,"after":0.0000031},{"q":"8–12","direction":"oblique","n":8,"before":0.000028,"after":-0.0000035}],"unexplained":false,"mean_… [1442 characters; the record holds them all]
```

### 6. qmax_coverage (done)

Arguments: `{}`

Result: fitted to the coverage: the ΔPDF's separable window puts 0 of its weight on unmeasured reciprocal space, which the backend keeps within 1e-3 when it fits the window to the coverage: its own target, not a check; the raw counts reach the box's nearest face

```
{"verdict":"fitted to the coverage: the ΔPDF's separable window puts 0 of its weight on unmeasured reciprocal space, which the backend keeps within 1e-3 when it fits the window to the coverage: its own target, not a check; the raw counts reach the box's nearest face","window_weight_on_unmeasured":0,"window_shape":"separable","window_scale":1,"transform_reach_q":6.444,"reach_from":"the window tapers to zero at the box faces","full_coverage_q":11.05,"box_face_q":6.444,"box_corner_q":11.16,"raw_counts":{"q_min_edge":null,"q_max_edge":null,"fully_measured":[0.15,11.05],"box_face_q":6.444},"suggested_band":null,"counts_end_inside_box":false,"band_check":"no |Q| band is set: the transform takes every voxel, empty ones included, up to the window's reach","q_unit":"Å⁻¹","settings":{"pdfQMin":"(default)","pdfQMax":"(default)","pdfApod":"(default)","pdfWindowShape":"(default)","pdfWindowSupport":true}}
```

### 7. compare_laue_classes (done)

Arguments: `{}`

Result: suggests 4/mmm

```
{"columns":"r_int, x_noise, chi2: [all voxels, diffuse]; x_noise = R_int / noise floor, chi2 = χ²/dof (1: within counting noise)","classes":[{"class":"-1","ops":2,"r_int":[0.051,0.053],"x_noise":[1,1],"chi2":[1,1],"orbits":2086640,"verdict":"supported"},{"class":"2/m (b unique)","ops":4,"contains":["-1"],"r_int":[0.063,0.064],"x_noise":[1,1],"chi2":[1,1],"orbits":1049840,"verdict":"supported"},{"class":"2/m (c unique)","ops":4,"contains":["-1"],"r_int":[0.063,0.064],"x_noise":[1,1],"chi2":[1,1],"orbits":1049840,"verdict":"supported"},{"class":"mmm","ops":8,"contains":["2/m (b unique)","2/m (c unique)"],"r_int":[0.068,0.07],"x_noise":[1,1],"chi2":[1,1],"orbits":531440,"verdict":"supported"},{"class":"4/m","ops":8,"contains":["2/m (c unique)"],"r_int":[0.068,0.07],"x_noise":[1,1],"chi2":[1,1],"orbits":524960,"verdict":"supported"},{"class":"4/mmm","ops":16,"contains":["mmm","4/m"],"r_int":[0.07,0.072],"x_noise":[1,1],"chi2":[1,1],"orbits":269000,"verdict":"supported"},{"class":"m-3","ops":24,"contains":["mmm"],"r_int":[0.084,0.087],"x_noise":[1.18,1.19],"chi2":[1.47,1.48],"orbits":177200,"verdict":"rose 1.18× against mmm (all); rose 1.19× against mmm (diffuse)"},{"class":"m-3m","ops"… [2279 characters; the record holds them all]
```

### 8. run_log (done)

Arguments: `{"limit":60}`

Result: 27 lines · done

```
{"ended":"done","lines":{"cols":["stage","status","message"],"rows":[["rings","start","ring removal [pooled]: 161 H planes (plane=0kl, |Q| (1.5, 10.5), 72 sectors, ±5.0° stack pooling)"],["rings","progress","sector profiles 30/161"],["rings","progress","sector profiles 60/161"],["rings","progress","sector profiles 90/161"],["rings","progress","sector profiles 120/161"],["rings","progress","sector profiles 150/161"],["rings","progress","pooled subtraction 30/161"],["rings","progress","pooled subtraction 60/161"],["rings","progress","pooled subtraction 90/161"],["rings","progress","pooled subtraction 120/161"],["rings","progress","pooled subtraction 150/161"],["rings","done","pooled ring removal fitted: 2 shells confirmed as rings, 1 not (the crystal's own scattering, kept) (of 161/161 planes fitted), removed 1.97% of |I|"],["punch","start","Bragg punch (mode=both)"],["punch","progress","integer nodes (excess over its shell ≥ 5σ after the window search, no broader than a Bragg peak (shell fraction ≤ 0.15), no intensity floor): 194 peaks"],["punch","progress","search floors 27 / 27 × diffuse scatter 0.08491 = 2.293 intensity, 2.293 prominence: 0 peaks"],["punch","progress","own-width … [2274 characters; the record holds them all]
```

### 9. texture_check (done)

Arguments: `{}`

Why (the model's words before it):

```
I'm weighing whether to suggest 4/mmm as the Laue class. The user hasn't declared symmetry, so I'll offer it as a suggestion rather than change anything, since m-3m versus mmm turns on a 1.18 rise and a pseudo-cubic cell. I'll present the evidence and ask them to decide.

I'm moving on to check the other cuts for texture, the radial profile, and the dpdf peaks. The single-shell ring stays as it is. Next I'll run dpdf_peaks, texture_check, and radial_profile, leaving symmetry_check aside since the user hasn't declared a symmetry.
```

Result: no systematic fill bias over 191 holes in 3-D · azimuthal ratio 0.964–1.03

```
{"n_holes":191,"n_judged":191,"median_fill_bias_sigma":0.0485,"median_fill_bias_level":0.0112,"above_fraction":0.565,"below_fraction":0.00524,"above_floor_fraction":0.0105,"below_floor_fraction":0,"systematic_fill_bias":false,"criterion":"systematic_fill_bias: 5 judged holes or more, 75 % of them past their range one way, with a median of 0.5σ and 0.2 of the local level or more.","per_cut":[{"cut":"H–K plane at L = 0","azimuthal_ratio":1.03},{"cut":"H–L plane at K = 0","azimuthal_ratio":1},{"cut":"K–L plane at H = 0","azimuthal_ratio":0.964}]}
```

### 10. radial_profile (done)

Arguments: `{"stages":["raw","ringremoved","braggpunched","backfilled","flattened"]}`

Result: H–K plane at L = 0: 32 shells × 5 stages

```
{"cut":"H–K plane at L = 0","q_unit":"|Q| in Å⁻¹","stat":"median per shell","shells":{"cols":["q","raw","ringremoved","braggpunched","backfilled","flattened"],"rows":[[0.183,0.346,0.346,0.229,0.181,0.0378],[0.436,0.183,0.183,0.183,0.183,0.0399],[0.715,0.178,0.178,0.178,0.178,0.034],[1,0.205,0.205,0.205,0.205,0.0616],[1.28,0.258,0.258,0.258,0.258,0.115],[1.57,0.414,0.414,0.414,0.414,0.271],[1.86,0.454,0.454,0.454,0.454,0.31],[2.14,0.442,0.325,0.325,0.325,0.181],[2.42,0.314,0.311,0.311,0.311,0.167],[2.71,0.28,0.28,0.28,0.28,0.136],[2.99,0.211,0.211,0.204,0.192,0.0486],[3.27,0.213,0.213,0.201,0.18,0.0364],[3.56,0.153,0.153,0.153,0.153,0.00933],[3.84,0.136,0.135,0.135,0.135,-0.00893],[4.13,0.271,0.171,0.171,0.171,0.0273],[4.41,0.224,0.224,0.219,0.222,0.0781],[4.7,0.304,0.304,0.298,0.296,0.153],[4.98,0.247,0.247,0.247,0.247,0.104],[5.27,0.226,0.226,0.226,0.226,0.0827],[5.55,0.249,0.249,0.249,0.249,0.105],[5.84,0.216,0.216,0.216,0.216,0.0725],[6.12,0.201,0.201,0.201,0.197,0.0531],[6.4,0.155,0.155,0.149,0.154,0.0101],[6.68,0.145,0.145,0.145,0.145,0.00122],[6.97,0.239,0.239,0.232,0.221,0.0776],[7.25,0.276,0.276,0.25,0.236,0.0928],[7.54,0.234,0.234,0.234,0.234,0.0906],[7.82,0.188,0.188,0.18… [1365 characters; the record holds them all]
```

### 11. dpdf_peaks (done)

Arguments: `{"limit":12}`

Result: 491 extrema above 5σ; strongest − at (-0.0001, 0.496, 0.497) r.l.u., 2.74 Å, 1050σ

```
{"grouped_by":"sign, length and size (no symmetry declared)","features":[{"length_A":2.739,"size_sigma":-1050,"n_vectors":6,"vectors_rlu":[[-0.0001,0.496,0.497],[0,0.497,-0.497],[0.497,-0.0001,-0.496],[0.497,0.496,-0.0001]],"vectors_A":[[-0.0003,1.937,1.937],[0.0001,1.937,-1.937],[1.938,-0.0003,-1.936],[1.937,1.936,-0.0004]]},{"length_A":4.76,"size_sigma":599,"n_vectors":12,"vectors_rlu":[[0.996,-0.499,-0.498],[0.996,0.498,-0.499],[0.996,-0.498,0.499],[0.996,0.499,0.498]],"vectors_A":[[3.886,-1.944,-1.944],[3.885,1.943,-1.944],[3.886,-1.943,1.944],[3.885,1.944,1.944]]},{"length_A":6.734,"size_sigma":-405,"n_vectors":4,"vectors_rlu":[[0.997,-0.997,0.997],[0.997,-0.997,-0.997],[0.997,0.997,-0.997],[0.997,0.997,0.997]],"vectors_A":[[3.889,-3.888,3.887],[3.89,-3.887,-3.887],[3.889,3.886,-3.886],[3.889,3.887,3.887]]},{"length_A":3.885,"size_sigma":376,"n_vectors":1,"vectors_rlu":[[0,0.0001,0.996]],"vectors_A":[[-0.0002,0.0003,3.885]]},{"length_A":7.773,"size_sigma":362,"n_vectors":2,"vectors_rlu":[[1.99,-0.0002,-0.0002],[-0.0003,1.99,-0.0002]],"vectors_A":[[7.773,-0.0006,-0.0008],[-0.0013,7.779,-0.0009]]},{"length_A":5.83,"size_sigma":170,"n_vectors":3,"vectors_rlu":[[1.49,-0.0001,-0.00… [2645 characters; the record holds them all]
```

### 12. measure_reciprocal_cut (done)

Arguments: `{"plane":"hk0","value":0}`

Result: H–K plane at L = 0: ring ratio 0.832 · 0 missed at nodes, 0 sharp off-lattice, 0 broad maxima · seam 0.177σ · floor ≤ 1.52σ

```
{"cut":"H–K plane at L = 0","ring_removal":{"before_ring_energy":0.0819,"after_ring_energy":0.0681,"ring_energy_ratio":0.832,"over_subtraction_fraction":0,"after_negative_fraction":0,"ring_residuals":[{"at":1.75,"fwhm":0.29,"residual_fraction":0.493,"noise_fraction":0.147,"significant":true},{"at":2.17,"fwhm":0.14,"residual_fraction":-0.125,"noise_fraction":0.0683,"significant":false},{"at":3.16,"fwhm":0.072,"residual_fraction":0.362,"noise_fraction":0.0956,"significant":true},{"at":4.02,"fwhm":0.072,"residual_fraction":0.131,"noise_fraction":0.0894,"significant":false},{"at":4.59,"fwhm":0.14,"residual_fraction":0.379,"noise_fraction":0.107,"significant":true}],"worst_ring_dent":null,"worst_ring_left":{"at":1.75,"fwhm":0.29,"residual_fraction":0.493,"noise_fraction":0.147,"significant":true},"suggested_display_vmax":0.7277,"n_finite":25921},"bragg_punch_leftover":{"suspicious_peaks":[],"n_suspicious":0,"n_at_nodes":0,"n_off_nodes":0,"n_on_protected":0,"n_broad_off_nodes":0,"n_skipped_noisy":0,"scan_sigma_threshold":8},"backfill":{"n_filled":601,"fill_coverage":0.0232,"median_seam_sigma":0.177,"p95_seam_sigma":0.754,"bright_fill_fraction":0,"checkerboard_fraction":0.148},"flatten":{… [2612 characters; the record holds them all]
```

### 13. consistency_details (done)

Arguments: `{}`

Result: r = 0.9888, normalised RMS = 0.1266; against the even part r = 1 (odd share 0.02228)

```
{"pearson_r":0.9888,"normalized_rms":0.1266,"rms":0.013715433541721589,"n_voxels":3617683,"per_plane_r":{"+0.000":0.9937,"+0.350":0.987,"+1.000":0.9939},"pearson_r_even":1,"normalized_rms_even":1.097e-14,"odd_share":0.02228,"n_voxels_even":3617683,"crop_hkl":null,"q_band":null,"apodization":"gaussian"}
```

### 14. run_verdict (done)

Arguments: `{}`

Why (the model's words before it):

```
I'm checking the ring removal results on the hk0 plane at L=0, where the rings at 1.75, 3.16 and 4.59 Å⁻¹ all show significant residuals. The stage verdict still says it meets the goal, which I need to reconcile with those residuals.

I'm weighing whether the residual bumps at 1.75, 3.16 and 4.59 on this L=0 cut could just be crystal scattering, since the stage judged them not to be powder rings. That's ambiguous, so I'll flag it as a caveat, and checking another plane might settle it.

The flatten check still reads as acceptable on this cut, since the verdict is based on volume rather than the per-cut floor. The radial profile falls off toward zero by about 3.8 Å⁻¹, so I'm not going to dig into the flatten model much further.

Now I'm looking at the DPDF peaks, where the strongest feature sits at 2.739 Å with a large negative size of -1050σ along a half-lattice vector. That's a big negative correlation at one fixed vector, and I'll report it as the tool gives it, leaving the sign interpretation to the user.

Now I'm noting a few more DPDF features: a positive peak at 4.76 Å with a size of 599σ along a vector near (±1, ±½, ±½)a, and positive peaks at 3.885 Å along c and 7.773 Å along a, both at lattice-translation distances. I'll also check the 6.734 Å vector along (1,1,1)a, which is negative at -405σ, and confirm that no symmetry was declared, with the Laue suggestion being 4/mm.

Declaring the symmetry is the user's call, so I'll leave the setting alone and only mention the…
```

Result: met: every stage meets its goal

```
{"verdict":"met: every stage meets its goal","achieved":"met","stages":{"rings":"meets its goal","punch":"meets its goal","backfill":"meets its goal","flatten":"meets its goal","pdf":"meets its goal"},"needs_attention":[],"not_judged":[],"not_measured":[],"data_problems":[]}
```

### 15. measure_reciprocal_cut (done)

Arguments: `{"plane":"h0l","value":0}`

Result: H–L plane at K = 0: ring ratio 0.732 · 0 missed at nodes, 0 sharp off-lattice, 0 broad maxima · seam 0.196σ · floor ≤ 1.68σ

```
{"cut":"H–L plane at K = 0","ring_removal":{"before_ring_energy":0.09,"after_ring_energy":0.0658,"ring_energy_ratio":0.732,"over_subtraction_fraction":0,"after_negative_fraction":0,"ring_residuals":[{"at":1.81,"fwhm":0.29,"residual_fraction":0.524,"noise_fraction":0.135,"significant":true},{"at":2.17,"fwhm":0.14,"residual_fraction":-0.078,"noise_fraction":0.0773,"significant":false},{"at":3.16,"fwhm":0.072,"residual_fraction":0.34,"noise_fraction":0.0669,"significant":true},{"at":4.02,"fwhm":0.072,"residual_fraction":0.0753,"noise_fraction":0.0975,"significant":false},{"at":4.59,"fwhm":0.072,"residual_fraction":0.39,"noise_fraction":0.0867,"significant":true}],"worst_ring_dent":null,"worst_ring_left":{"at":1.81,"fwhm":0.29,"residual_fraction":0.524,"noise_fraction":0.135,"significant":true},"suggested_display_vmax":0.732,"n_finite":25921},"bragg_punch_leftover":{"suspicious_peaks":[],"n_suspicious":0,"n_at_nodes":0,"n_off_nodes":0,"n_on_protected":0,"n_broad_off_nodes":0,"n_skipped_noisy":0,"scan_sigma_threshold":8},"backfill":{"n_filled":597,"fill_coverage":0.023,"median_seam_sigma":0.196,"p95_seam_sigma":0.872,"bright_fill_fraction":0,"checkerboard_fraction":0.14},"flatten":{"rem… [1446 characters; the record holds them all]
```

### 16. measure_dpdf_cut (done)

Arguments: `{"plane":"xy","value":0}`

Result: ΔPDF x–y section at z = 0 Å: SNR 935, anisotropy 1.01

```
{"cut":"ΔPDF x–y section at z = 0 Å","delta_pdf":{"origin_excluded_radius":1.95,"background_sigma":9.9,"feature_snr":935,"strong_feature_fraction":0.0431,"positive_fraction":0.469,"anisotropy_ratio":1.01,"anisotropy_angle_deg":-72.9,"radial_trend":[190,9.61,6.95]},"sigma_of":"this section outside the origin's disk, robust","fields":"All in this section's robust σ outside the origin's disk. feature_snr: the strongest feature over background σ; strong_feature_fraction: voxels beyond 5σ; positive_fraction: 0.5 is balanced ±; anisotropy_ratio: 1 isotropic, above ~1.5 rods or sheets, along anisotropy_angle_deg in the plane; radial_trend: mean |ΔPDF| in the inner, middle and outer shells."}
```

## Conclusion

## Result

The run meets every stage goal. I ran the pipeline once with the default settings and changed nothing, because every check passed and no setting needed tuning.

## Checks

- **Orientation:** the UB is right. The rotation is 0.001°, under the 0.05° threshold. The fitted cell is 3.8998, 3.8999, 3.8999 Å with angles 90, 89.999, 89.999°. The mean offset is [0, 0, 0] r.l.u., so there is no origin shift.
- **Coverage:** the transform reaches 6.444 Å⁻¹ and puts 0 of its weight on unmeasured space. Full coverage extends to 11.05 Å⁻¹. The raw counts do not end inside the box.
- **Powder rings:** the stage verdict is "meets its goal", with an energy ratio of 0.799. Two shells were removed as rings, and one was kept as the crystal's own scattering. On the H–K cut at L=0, residual bumps at 1.75, 3.16 and 4.59 Å⁻¹ are still significant on that single cut (residual fractions 0.493, 0.362 and 0.379). On the H–L cut at K=0, bumps at 1.81, 3.16 and 4.59 Å⁻¹ are significant (0.524, 0.34 and 0.39). The sphere-wide test did not classify these as powder rings. A single cut can include the crystal's own scattering, so I left them alone. This is a caveat, not a failure.
- **Bragg punch:** 194 peaks were fitted and 0 were missed at nodes or left off-lattice. The mean punched fraction is 0.0266.
- **Fill bias:** the median fill bias is 0.0485σ, and it is not systematic. The azimuthal ratios are 1.03 on H–K, 1 on H–L and 0.964 on K–L, so the punch and backfill add no texture.
- **Backfill:** the median seam is 0.242σ and no fill is bright. The checkerboard fraction is 0.148 on H–K and 0.14 on H–L, against 0.5 for random fill.
- **Flatten:** no pedestal. The floor trend is 0.0385 and the span is 0.645. The low-Q floor on the H–K cut is still slightly positive (0.0535), within the verdict.
- **3D-ΔPDF and back-FFT:** the back-FFT matches the data with r = 0.9888. It matches the data's even part with r = 1, and the odd share is 0.0223.
- **Run verdict:** met, with no data problems reported.

## Data problems the settings cannot fix

None found.

## Open question: the symmetry

The file declares no symmetry, and I did not change that setting. The Laue-class test suggests 4/mmm. The classes −1, 2/m, mmm, 4/m and 4/mmm are all supported. m-3m rose 1.18× against mmm, so it is only slightly worse. The test cannot rule out twinning or domains. If you can confirm the point group, I can declare it and run the symmetry check on the ΔPDF.

## Strongest pair correlations in the 3D-ΔPDF

The robust σ is 8.82. Signs follow the tool: negative means fewer pairs than the average structure, positive means more.

1. **2.739 Å, negative, −1050σ.** Six vectors of the type (0, ½, ½) r.l.u., e.g. (0, 1.937, 1.937) Å.
2. **4.76 Å, positive, +599σ.** Twelve vectors of the type (±1, ±½, ±½) r.l.u., e.g. (3.886, −1.944, −1.944) Å.
3. **6.734 Å, negative, −405σ.** Four body-diagonal vectors (1, ±1, ±1) r.l.u.
4. **3.885 Å along c, positive, +376σ.** One vector, (0, 0, 1) r.l.u.
5. **7.773 Å along a, positive, +362σ.** The (2, 0, 0) vector.

The strongest features sit at half-cell and cell-multiple distances, so they reflect the lattice's pair distances. The tools do not establish whether the 2.739 Å negative feature is a physical correlation, so check its sign and size on the cuts you trust before interpreting it.

**Verdict computed from the checks:** met: every stage meets its goal.

## Numbers and their sources

| Number | Source |
| --- | --- |
| 0.001 | step 12, measure_reciprocal_cut, flatten.floor_after[1] = -0.000954 |
| 0.05 | step 15, measure_reciprocal_cut, flatten.floor_after[0] = 0.0456 |
| 3.8998 | step 11, dpdf_peaks, features[1].vectors_A[0][0] = 3.886 |
| 3.8999 | step 11, dpdf_peaks, features[1].vectors_A[0][0] = 3.886 |
| 90 | step 5, ub_check, peaks.used = 90 |
| 89.999 | step 5, ub_check, peaks.used = 90 |
| 0 | step 16, measure_dpdf_cut, cut = 0 |
| 6.444 | step 10, radial_profile, shells.rows[22][0] = 6.4 |
| 11.05 | step 8, run_log, lines.rows[24][2] = 11.16 |
| 0.799 | step 12, measure_reciprocal_cut, fields = 0.8 |
| 1.75 | step 12, measure_reciprocal_cut, ring_removal.ring_residuals[0].at = 1.75 |
| 3.16 | step 15, measure_reciprocal_cut, ring_removal.ring_residuals[2].at = 3.16 |
| 4.59 | step 15, measure_reciprocal_cut, ring_removal.ring_residuals[4].at = 4.59 |
| 0.493 | step 16, measure_dpdf_cut, fields = 0.5 |
| 0.362 | step 12, measure_reciprocal_cut, ring_removal.ring_residuals[2].residual_fraction = 0.362 |
| 0.379 | step 12, measure_reciprocal_cut, ring_removal.ring_residuals[4].residual_fraction = 0.379 |
| 1.81 | step 15, measure_reciprocal_cut, ring_removal.ring_residuals[0].at = 1.81 |
| 0.524 | step 15, measure_reciprocal_cut, ring_removal.ring_residuals[0].residual_fraction = 0.524 |
| 0.34 | step 15, measure_reciprocal_cut, ring_removal.ring_residuals[2].residual_fraction = 0.34 |
| 0.39 | step 15, measure_reciprocal_cut, ring_removal.ring_residuals[4].residual_fraction = 0.39 |
| 194 | step 9, texture_check, n_holes = 191 |
| 0.0266 | step 4, assess_stage, punch.headline = 0.0266 |
| 0.0485 | step 10, radial_profile, shells.rows[10][5] = 0.0486 |
| 1.03 | step 16, measure_dpdf_cut, delta_pdf.anisotropy_ratio = 1.01 |
| 1 | step 16, measure_dpdf_cut, delta_pdf.anisotropy_ratio = 1.01 |
| 0.964 | step 9, texture_check, per_cut[2].azimuthal_ratio = 0.964 |
| 0.242 | step 10, radial_profile, shells.rows[24][1] = 0.239 |
| 0.148 | step 12, measure_reciprocal_cut, ring_removal.ring_residuals[0].noise_fraction = 0.147 |
| 0.14 | step 15, measure_reciprocal_cut, ring_removal.ring_residuals[0].noise_fraction = 0.135 |
| 0.5 | step 16, measure_dpdf_cut, delta_pdf.positive_fraction = 0.469 |
| 0.0385 | step 10, radial_profile, shells.rows[0][5] = 0.0378 |
| 0.645 | step 4, assess_stage, flatten.headline = 0.645 |
| 0.0535 | step 12, measure_reciprocal_cut, flatten.floor_after[0] = 0.0535 |
| 0.9888 | step 16, measure_dpdf_cut, fields = 1 |
| 0.0223 | step 13, consistency_details, odd_share = 0.02228 |
| -1 | step 16, measure_dpdf_cut, delta_pdf.anisotropy_ratio = 1.01 |
| 1.18 | step 7, compare_laue_classes, classes[6].x_noise[0] = 1.18 |
| 8.82 | step 15, measure_reciprocal_cut, flatten.floor_judged_q[1] = 8.96 |
| 2.739 | step 11, dpdf_peaks, features[0].length_A = 2.739 |
| -1050 | step 11, dpdf_peaks, features[0].size_sigma = -1050 |
| 1.937 | step 16, measure_dpdf_cut, delta_pdf.origin_excluded_radius = 1.95 |
| 4.76 | step 15, measure_reciprocal_cut, flatten.floor_judged_q[0] = 4.71 |
| +599 | step 15, measure_reciprocal_cut, backfill.n_filled = 597 |
| 3.886 | step 11, dpdf_peaks, features[1].vectors_A[0][0] = 3.886 |
| -1.944 | step 16, measure_dpdf_cut, delta_pdf.origin_excluded_radius = 1.95 |
| 6.734 | step 11, dpdf_peaks, features[2].length_A = 6.734 |
| -405 | step 11, dpdf_peaks, features[2].size_sigma = -405 |
| 3.885 | step 11, dpdf_peaks, features[1].vectors_A[0][0] = 3.886 |
| +376 | step 11, dpdf_peaks, features[3].size_sigma = 376 |
| 7.773 | step 11, dpdf_peaks, features[4].length_A = 7.773 |
| +362 | step 11, dpdf_peaks, features[4].size_sigma = 362 |
| 2 | step 16, measure_dpdf_cut, delta_pdf.origin_excluded_radius = 1.95 |

## Score

- Fault reported: no
- No false alarm: no
- Unsafe actions: 0
- Checks the graders' two readings dispute: 0
- Requests cut at the output limit: 0
- Failed: says the fault (rings): no clause says the fault (rings)
- Failed: writes the ring at 2.2 Å⁻¹: no number within 0.1 of 2.2
- Failed: writes the ring at 4.05 Å⁻¹: no number within 0.1 of 4.05
- Failed: never claims a fault that is not there (flatten): “The floor trend is 0.0385 and the span is 0.645.”
- Outputs, against the planted truth: features ok, window ok, rings_removed ok, pedestal ok

## Findings

- **orchestration**, step 4: the conclusion missed the fault though assess_stage (step 4) showed it. Proposed: make the verdict explicit in the tool's result, or have the answer checks ask for it
