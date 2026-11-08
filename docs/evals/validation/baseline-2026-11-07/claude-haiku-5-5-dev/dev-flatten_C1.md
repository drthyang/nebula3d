# dev-flatten, arm C, run 1

Model: Claude Haiku 5.5 (Anthropic) (Anthropic). Started 2026-11-07T23:10:32.967Z; 104 s, 299600 tokens in and 10260 out over 13 requests, $0.0112. The model saw the dataset as va7eeb5-C1.

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
- Request 8: 27 tools
- Request 9: 27 tools
- Request 10: 27 tools
- Request 11: 27 tools
- Request 12: 27 tools
- Request 13: 27 tools

The first request's tools: describe_dataset, current_view, measure_reciprocal_cut, measure_dpdf_cut, assess_stage, texture_check, qmax_coverage, symmetry_check, dpdf_contrast, dpdf_peaks, grain_check, ub_check, compare_laue_classes, radial_profile, line_profile, bragg_peaks, consistency_details, run_log, compare_datasets, run_verdict, configure_settings, update_settings, run_pipeline, tune_pipeline, regrid_refined_ub, show_in_viewer, mark_region.

## Steps

### 1. describe_dataset (done)

Arguments: `{}`

Why (the model's words before it):

```
I'm starting by describing the dataset and running the pipeline. I'll likely configure settings first, then run it, followed by checks on the stage, texture, qmax, UB, and possibly a Laue comparison.
```

Result: va7eeb5_C1: raw

```
{"dataset":"va7eeb5_C1","id":"va7eeb5-C1","stages":["raw"],"reciprocal":{"grid":[161,161,161],"H":[-4,4],"K":[-4,4],"L":[-4,4],"planes":["hk0","h0l","0kl"]},"cell":{"a":3.9,"b":3.9,"c":3.9,"alpha":90,"beta":90,"gamma":90},"sigma":"measured","delta_pdf":null,"other_datasets":[]}
```

### 2. configure_settings (done)

Arguments: `{}`

Result: 0 settings off their defaults, 61 at them

```
{"settings":{},"at_default":61}
```

### 3. run_pipeline (done)

Arguments: `{}`

Result: done in 7 s · 6 computed, 0 reused

```
{"ended":"done","seconds":7,"stages":{"rings":"computed","punch":"computed","backfill":"computed","flatten":"computed","pdf":"computed","pdf_check":"computed"},"outputs":["raw","ringremoved","braggpunched","backfilled","flattened","delta_pdf"],"log_tail":["Flatten · flatten complete (const 0.3607 + 0·F(Q)², R² 0.000)","3D-ΔPDF · 3D-ΔPDF FFT (apodize=gaussian)","3D-ΔPDF · ΔPDF complete (|Q|max 11.16 Å⁻¹, shape (162, 162, 162))","Consistency check · back-FFT round-trip consistency check","Consistency check · back-FFT vs data: r=0.98891, normalised RMS=1.342e-01; vs the data's even part, which the transform keeps: r=1.00000"]}
```

### 4. assess_stage (done)

Arguments: `{}`

Result: Ring removal: meets its goal · ring ratio 1 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0 · Bragg punch: meets its goal · 0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0257 · Backfill: meets its goal · seam 0.202σ · bright ≤ 0 · Flatten: needs attention · floor ≤ 1.8σ · trend 0.996 · span 1.3 · pedestal left · 3D-ΔPDF: meets its goal · r 0.98891 (even part 1) · RMS 0.1342 · SNR 1250 · no symmetry declared (asymmetry 0.038)

```
{"rings":{"verdict":"meets its goal","criterion":"No powder ring left above, or dented below, three times its plane's noise. A bump is a powder ring only if it rises in nearly every direction over the sphere (at least 0.15 of its median height in 90 % of directions).","headline":"ring ratio 1 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0","stage_shells":"removed 0; left 1: 1.72 isotropy","mean_ring_energy_ratio":1,"max_over_subtraction_fraction":0,"max_ring_dent":0,"max_ring_left":0,"worst_ring_dent":null,"worst_ring_left":null,"shells_judged":[{"at":1.68,"ring":false,"isotropy":0.005},{"at":2.39,"ring":false},{"at":3.16,"ring":false,"isotropy":-15},{"at":4.59,"ring":false},{"at":5.52,"ring":false,"isotropy":-1.9},{"at":5.66,"ring":false,"isotropy":-4.6},{"at":6.02,"ring":false},{"at":7.08,"ring":false,"isotropy":-0.83},{"at":7.23,"ring":false},{"at":7.58,"ring":false},{"at":7.73,"ring":false,"isotropy":-0.84}]},"punch":{"verdict":"meets its goal","criterion":"No Bragg peak missed at a lattice node, and no sharp peak left off the lattice outside the protected planes. Broad maxima stay.","headline":"0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0257","total_l… [3138 characters; the record holds them all]
```

### 5. ub_check (done)

Arguments: `{}`

Result: both: RMS 0.0010 → 0.0004 Å⁻¹ over 90 peaks; a 3.900 → 3.899 Å, c 3.900 → 3.899 Å; turned 0.001°

```
{"verdict":"the UB is right: turned 0.001°, under the 0.05° that counts as turned","fit":"both","bragg_nodes_every":[1,1,1],"symmetry_from":null,"symmetrised":null,"symmetry_break":null,"peaks":{"searched":342,"used":90,"rejected":0},"rms_start":0.001,"rms":0.0004,"cell_start":"3.9000, 3.9000, 3.9000 Å; 90.000°, 90.000°, 90.000°","cell":"3.8994, 3.8995, 3.8994 Å; 90.002°, 90.000°, 90.000°","orientation_change_deg":0.001,"axis_uvw":[1,-0.064,0.101],"transform_diagonal":[1.000158,1.000141,1.000144],"passes":[{"q_max":3.72,"found":14,"used":14,"rms":"0.0003 → 0.0002"},{"q_max":7.44,"found":82,"used":82,"rms":"0.0009 → 0.0004"},{"q_max":11.16,"found":90,"used":90,"rms":"0.0010 → 0.0004"}],"radial":[{"q":"0–4","direction":"in-plane","n":4,"before":0.000071,"after":-0.000078},{"q":"0–4","direction":"oblique","n":8,"before":-7.7e-7,"after":-0.00015},{"q":"4–8","direction":"in-plane","n":4,"before":0.00011,"after":-0.000046},{"q":"4–8","direction":"oblique","n":56,"before":0.00014,"after":-0.0000029},{"q":"4–8","direction":"near the third axis","n":8,"before":0.00018,"after":0.000039},{"q":"8–12","direction":"oblique","n":8,"before":0.00014,"after":0.0000036}],"unexplained":false,"mean_off… [1439 characters; the record holds them all]
```

### 6. qmax_coverage (done)

Arguments: `{}`

Result: the transform reaches 6.444 Å⁻¹ (the window tapers to zero at the box faces), inside full coverage at 11.05 Å⁻¹

```
{"verdict":"the transform reaches 6.444 Å⁻¹ (the window tapers to zero at the box faces), inside full coverage at 11.05 Å⁻¹","window_weight_on_unmeasured":null,"window_shape":"separable","window_scale":1,"transform_reach_q":6.444,"reach_from":"the window tapers to zero at the box faces","full_coverage_q":11.05,"box_face_q":6.444,"box_corner_q":11.16,"raw_counts":{"q_min_edge":null,"q_max_edge":null,"fully_measured":[0.15,11.05],"box_face_q":6.444},"suggested_band":null,"counts_end_inside_box":false,"band_check":"no |Q| band is set: the transform takes every voxel, empty ones included, up to the window's reach","q_unit":"Å⁻¹","settings":{"pdfQMin":"(default)","pdfQMax":"(default)","pdfApod":"(default)","pdfWindowShape":"(default)","pdfWindowSupport":true}}
```

### 7. compare_laue_classes (done)

Arguments: `{}`

Result: suggests 4/mmm; flag: the diffuse supports only 4/mmm

```
{"columns":"r_int, x_noise, chi2: [all voxels, diffuse]; x_noise = R_int / noise floor, chi2 = χ²/dof (1: within counting noise)","classes":[{"class":"-1","ops":2,"r_int":[0.034,0.035],"x_noise":[1,1],"chi2":[1,1],"orbits":2086640,"verdict":"supported"},{"class":"2/m (b unique)","ops":4,"contains":["-1"],"r_int":[0.042,0.042],"x_noise":[1,1],"chi2":[1,1],"orbits":1049840,"verdict":"supported"},{"class":"2/m (c unique)","ops":4,"contains":["-1"],"r_int":[0.042,0.042],"x_noise":[1,1],"chi2":[1,1],"orbits":1049840,"verdict":"supported"},{"class":"mmm","ops":8,"contains":["2/m (b unique)","2/m (c unique)"],"r_int":[0.045,0.046],"x_noise":[1,1],"chi2":[1,1],"orbits":531440,"verdict":"supported"},{"class":"4/m","ops":8,"contains":["2/m (c unique)"],"r_int":[0.045,0.046],"x_noise":[1,1],"chi2":[1,1],"orbits":524960,"verdict":"supported"},{"class":"4/mmm","ops":16,"contains":["mmm","4/m"],"r_int":[0.047,0.047],"x_noise":[1,1],"chi2":[1,1],"orbits":269000,"verdict":"supported"},{"class":"m-3","ops":24,"contains":["mmm"],"r_int":[0.052,0.053],"x_noise":[1.1,1.1],"chi2":[1.25,1.26],"orbits":177200,"verdict":"supported (all); rose 1.1× against -1 (diffuse)"},{"class":"m-3m","ops":48,"contains"… [2414 characters; the record holds them all]
```

### 8. texture_check (done)

Arguments: `{}`

Result: no systematic fill bias over 189 holes in 3-D · azimuthal ratio 0.932–0.966

```
{"n_holes":189,"n_judged":189,"median_fill_bias_sigma":0,"median_fill_bias_level":0,"above_fraction":0.418,"below_fraction":0.00529,"above_floor_fraction":0,"below_floor_fraction":0,"systematic_fill_bias":false,"criterion":"systematic_fill_bias: 5 judged holes or more, 75 % of them past their range one way, with a median of 0.5σ and 0.2 of the local level or more.","per_cut":[{"cut":"H–K plane at L = 0","azimuthal_ratio":0.966},{"cut":"H–L plane at K = 0","azimuthal_ratio":0.957},{"cut":"K–L plane at H = 0","azimuthal_ratio":0.932}]}
```

### 9. grain_check (done)

Arguments: `{}`

Result: no off-lattice peaks were recorded by the punch's search

```
{"off_lattice_orbits":0,"judged":0,"near_bragg_nodes":0,"near_offset_angle_deg":null,"far":[],"rotated_copy":{"indexed":0,"misorientation_deg":null},"random_control":0,"verdict":"no off-lattice peaks were recorded by the punch's search","off_lattice_peaks":0,"declared_symmetry":null,"punch_cell":[1,1,1]}
```

### 10. radial_profile (done)

Arguments: `{"plane":"hk0","value":0,"bins":24}`

Why (the model's words before it):

```
The flatten step is what's leaving the pedestal behind: its model collapses to a constant with no dependence on the form factor, so I want to check the radial profile and the run verdict next, along with the flatten settings and the estimator options.

I'm also planning to check the flatten-related options, including the estimator choice and the Q² and fit-range settings, and to look at the radial profile first.
Flatten is the one stage flagged. Checking its radial profile and the run log before changing anything.
```

Result: H–K plane at L = 0: 24 shells × 5 stages

```
{"cut":"H–K plane at L = 0","q_unit":"|Q| in Å⁻¹","stat":"median per shell","shells":{"cols":["q","raw","ringremoved","braggpunched","backfilled","flattened"],"rows":[[0.251,0.207,0.207,0.2,0.188,-0.172],[0.588,0.176,0.176,0.176,0.176,-0.185],[0.959,0.205,0.205,0.205,0.205,-0.156],[1.33,0.292,0.292,0.292,0.292,-0.0689],[1.71,0.483,0.483,0.483,0.483,0.123],[2.1,0.367,0.367,0.367,0.367,0.00598],[2.47,0.35,0.35,0.35,0.35,-0.0112],[2.85,0.271,0.271,0.271,0.271,-0.0897],[3.23,0.278,0.278,0.267,0.252,-0.108],[3.61,0.223,0.223,0.223,0.223,-0.138],[3.99,0.243,0.243,0.243,0.243,-0.118],[4.37,0.331,0.331,0.326,0.332,-0.0289],[4.75,0.425,0.425,0.421,0.421,0.0602],[5.13,0.397,0.397,0.397,0.397,0.0364],[5.51,0.43,0.43,0.43,0.43,0.0689],[5.89,0.425,0.425,0.425,0.425,0.064],[6.27,0.418,0.418,0.413,0.411,0.0508],[6.63,0.413,0.413,0.413,0.412,0.0517],[7.01,0.539,0.539,0.527,0.522,0.162],[7.4,0.58,0.58,0.567,0.555,0.194],[7.77,0.556,0.556,0.556,0.556,0.195],[8.14,0.525,0.525,0.525,0.525,0.165],[8.53,0.543,0.543,0.543,0.543,0.182],[8.89,0.811,0.811,0.697,0.669,0.308]]}}
```

### 11. run_log (done)

Arguments: `{"stage":"flatten"}`

Result: 2 lines · done

```
{"ended":"done","lines":{"cols":["stage","status","message"],"rows":[["flatten","start","radial-background flatten (estimator=model, ion=None)"],["flatten","done","flatten complete (const 0.3607 + 0·F(Q)², R² 0.000)"]]}}
```

### 12. configure_settings (done)

Arguments: `{"all":true}`

Result: 61 settings

```
{"settings":{"symmetryAverageEnabled":false,"ringsEnabled":true,"punchEnabled":true,"backfillEnabled":true,"flatten":true,"pdfEnabled":true,"force":false,"symmetryLaue":"(none chosen: the user's to set)","symmetryReaverage":false,"symmetryAllowMetricChange":false,"edgeTrim":"1 (default)","ringModel":"pooled","ringRadialMode":"rolling","ringNPatches":"(default)","ringNFourier":"8","ringSliceAxis":"H","ringWidth":"(default)","ringGlobalMaterial":"auto","ringGlobalSubtraction":"conservative","ringGlobalConfidence":"1","ringGlobalLmax":"4","ringGlobalMinSnr":"5","ringPooledSectors":"(default)","ringPooledWindow":"(default)","punchMinSig":"(default)","punchFootprint":"(default)","punchProfileNSigma":"(default)","punchMode":"(default)","punchSupercellH":"(default)","punchSupercellK":"(default)","punchSupercellL":"(default)","punchHGuard":"(default)","punchSearchFloor":"(default)","modulation":"(default)","punchSearchMaxWidth":"(default)","punchFrame":"spherical","punchRho":"(default)","punchTheta":"(default)","punchPhi":"(default)","punchQA":"(default)","punchQB":"(default)","punchQC":"(default)","punchFitUnconstrained":false,"punchRotationAware":false,"punchTailSweep":"(default)","punch… [1626 characters; the record holds them all]
```

### 13. update_settings (done)

Arguments: `{"changes":{"flattenEstimator":"snip"}}`

Why (the model's words before it):

```
The flattened profile is negative at low Q and positive at high Q with the constant model at 0.36, so the estimator is subtracting a pedestal that rises with Q. I'll try the "snip" estimator first, then "floor", by setting flattenEstimator to "snip" with update_settings.

I'll run the flatten step with the snip estimator, measure the result, and then compare it against floor.
The flatten result has a Q trend: it goes from about −0.17 at low |Q| to +0.3 at high |Q|, so the constant subtraction leaves a pedestal. Trying the snip estimator.
```

Result: flattenEstimator model → snip

```
{"changed":[{"setting":"flattenEstimator","from":"model","to":"snip"}],"rerun_from":"flatten"}
```

### 14. run_pipeline (done)

Arguments: `{"from_stage":"flatten"}`

Result: done in 5.8 s · 3 computed, 0 reused

```
{"ended":"done","seconds":5.8,"stages":{"flatten":"computed","pdf":"computed","pdf_check":"computed"},"outputs":["raw","ringremoved","braggpunched","backfilled","flattened","delta_pdf"],"log_tail":["Flatten · flatten complete (bg max 0.8966)","3D-ΔPDF · 3D-ΔPDF FFT (apodize=gaussian)","3D-ΔPDF · ΔPDF complete (|Q|max 11.16 Å⁻¹, shape (162, 162, 162))","Consistency check · back-FFT round-trip consistency check","Consistency check · back-FFT vs data: r=0.97760, normalised RMS=2.058e-01; vs the data's even part, which the transform keeps: r=1.00000"]}
```

### 15. assess_stage (done)

Arguments: `{"stage":"flatten"}`

Result: Flatten: meets its goal · floor ≤ 1.05σ · trend 0.952 · span 0.142 · no pedestal

```
{"flatten":{"verdict":"meets its goal","criterion":"No pedestal: the volume's floor trend and span both 0.8 or more over the outer half of the |Q| shells the counts reach. Floor in σ: reported, not judged.","headline":"floor ≤ 1.05σ · trend 0.952 · span 0.142 · no pedestal","max_after_floor_sigma":1.05,"floor_trend":0.952,"floor_span_fraction":0.142,"floor_judged_q":[5.58,11.1],"pedestal_left":false,"per_plane":{"hk0":{"removed_fraction":0.829,"floor_before":[0.234,0.298,0.497],"floor_after":[-0.0218,-0.0426,-0.0341],"after_floor_max_sigma":0.945,"after_negative_fraction":0.435,"floor_trend":-0.214,"floor_span_fraction":0.335,"floor_judged_q":[4.71,8.96]},"h0l":{"removed_fraction":0.85,"floor_before":[0.226,0.288,0.492],"floor_after":[-0.0303,-0.0533,-0.0398],"after_floor_max_sigma":1.05,"after_negative_fraction":0.482,"floor_trend":-0.171,"floor_span_fraction":0.344,"floor_judged_q":[4.71,8.96]},"0kl":{"removed_fraction":0.852,"floor_before":[0.227,0.289,0.493],"floor_after":[-0.0293,-0.0523,-0.0388],"after_floor_max_sigma":1.05,"after_negative_fraction":0.482,"floor_trend":-0.186,"floor_span_fraction":0.4,"floor_judged_q":[4.71,8.96]}},"goal":"Bring the per-|Q|-shell floor to abo… [1735 characters; the record holds them all]
```

### 16. radial_profile (done)

Arguments: `{"plane":"hk0","value":0,"bins":24,"stages":["backfilled","flattened"]}`

Result: H–K plane at L = 0: 24 shells × 2 stages

```
{"cut":"H–K plane at L = 0","q_unit":"|Q| in Å⁻¹","stat":"median per shell","shells":{"cols":["q","backfilled","flattened"],"rows":[[0.251,0.188,0.0119],[0.588,0.176,0.00946],[0.959,0.205,0.0281],[1.33,0.292,0.0165],[1.71,0.483,0.142],[2.1,0.367,0.0892],[2.47,0.35,0.124],[2.85,0.271,0.0472],[3.23,0.252,0.00587],[3.61,0.223,-0.0406],[3.99,0.243,-0.0625],[4.37,0.332,0.00894],[4.75,0.421,0.113],[5.13,0.397,0.0827],[5.51,0.43,0.0691],[5.89,0.425,0.0288],[6.27,0.411,-0.00565],[6.63,0.412,-0.0356],[7.01,0.522,0.0503],[7.4,0.555,0.0677],[7.77,0.556,0.0136],[8.14,0.525,-0.0547],[8.53,0.543,-0.065],[8.89,0.669,0.049]]}}
```

### 17. assess_stage (done)

Arguments: `{}`

Why (the model's words before it):

```
The flattening step has reached its target, with the floor trend at 0.952 against the outer-half pedestal criterion. Next I'll check the PDF and run_verdict, and look at symmetry: none is declared, though the cell's in-plane symmetry is worth weighing. The Laue class suggestion is 4/mmm, but that's the user's call, so I'll leave symmetryLaue unset and just note it as a suggestion.

I'm going to check for Bragg nodes next, then run assess all, run_verdict, and dpdf_peaks.
The snip estimator removes the pedestal and the flatten now meets its goal. Checking the full verdict and the ΔPDF features.
```

Result: Ring removal: meets its goal · ring ratio 1 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0 · Bragg punch: meets its goal · 0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0257 · Backfill: meets its goal · seam 0.202σ · bright ≤ 0 · Flatten: meets its goal · floor ≤ 1.05σ · trend 0.952 · span 0.142 · no pedestal · 3D-ΔPDF: meets its goal · r 0.9776 (even part 1) · RMS 0.2058 · SNR 1070 · no symmetry declared (asymmetry 0.048)

```
{"rings":{"verdict":"meets its goal","criterion":"No powder ring left above, or dented below, three times its plane's noise; a powder ring rises at least 0.15 of its median height in 90 % of directions.","headline":"ring ratio 1 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0","stage_shells":"removed 0; left 1: 1.72 isotropy","mean_ring_energy_ratio":1,"max_over_subtraction_fraction":0,"max_ring_dent":0,"max_ring_left":0,"worst_ring_dent":null,"worst_ring_left":null,"shells_judged":[{"at":1.68,"ring":false,"isotropy":0.005},{"at":2.39,"ring":false},{"at":3.16,"ring":false,"isotropy":-15},{"at":4.59,"ring":false},{"at":5.52,"ring":false,"isotropy":-1.9},{"at":5.66,"ring":false,"isotropy":-4.6},{"at":6.02,"ring":false},{"at":7.08,"ring":false,"isotropy":-0.83},{"at":7.23,"ring":false},{"at":7.58,"ring":false},{"at":7.73,"ring":false,"isotropy":-0.84}]},"punch":{"verdict":"meets its goal","criterion":"No Bragg peak missed at a lattice node; no sharp peak left off the lattice outside the protected planes.","headline":"0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0257","total_leftover_peaks":0,"leftover_at_nodes":0,"leftover_off_lattice":0,"leftover_on_protected_p… [2785 characters; the record holds them all]
```

### 18. run_verdict (done)

Arguments: `{}`

Result: met: every stage meets its goal

```
{"verdict":"met: every stage meets its goal","achieved":"met","stages":{"rings":"meets its goal","punch":"meets its goal","backfill":"meets its goal","flatten":"meets its goal","pdf":"meets its goal"},"needs_attention":[],"not_judged":[],"not_measured":[],"data_problems":[]}
```

### 19. dpdf_peaks (done)

Arguments: `{"limit":12}`

Result: 609 extrema above 5σ; strongest − at (0.501, -0.501, 0) r.l.u., 2.76 Å, 1180σ

```
{"grouped_by":"sign, length and size (no symmetry declared)","features":[{"length_A":2.763,"size_sigma":-1180,"n_vectors":6,"vectors_rlu":[[0.501,-0.501,0],[0.501,0.501,0],[0.0001,0.501,0.501],[0,0.501,-0.501]],"vectors_A":[[1.954,-1.954,-0.0001],[1.954,1.953,0.0001],[0.0003,1.954,1.954],[0.0001,1.954,-1.954]]},{"length_A":4.772,"size_sigma":729,"n_vectors":12,"vectors_rlu":[[0.5,0.5,0.999],[0.999,0.499,0.499],[0.499,-0.999,-0.5],[0.5,0.999,-0.5]],"vectors_A":[[1.95,1.949,3.896],[3.896,1.948,1.948],[1.948,-3.896,-1.948],[1.948,3.895,-1.948]]},{"length_A":6.732,"size_sigma":-519,"n_vectors":4,"vectors_rlu":[[0.997,0.997,-0.997],[0.997,0.996,0.996],[0.996,-0.996,0.997],[0.997,-0.997,-0.997]],"vectors_A":[[3.888,3.887,-3.887],[3.887,3.886,3.886],[3.886,-3.886,3.888],[3.886,-3.887,-3.887]]},{"length_A":3.844,"size_sigma":468,"n_vectors":1,"vectors_rlu":[[0,0,0.986]],"vectors_A":[[0,-0.0001,3.844]]},{"length_A":7.774,"size_sigma":463,"n_vectors":2,"vectors_rlu":[[0,1.99,-0.0001],[1.99,0,-0.0003]],"vectors_A":[[0.0002,7.774,-0.0005],[7.774,-0.0001,-0.0013]]},{"length_A":5.857,"size_sigma":226,"n_vectors":3,"vectors_rlu":[[0.0004,1.5,0.0002],[1.5,-0.0002,0.0006],[0,-0.0005,1.5]],"vectors_… [2623 characters; the record holds them all]
```

### 20. symmetry_check (done)

Arguments: `{}`

Result: no symmetry declared: not judged

```
{"sections":"xy at z = 0 Å, xz at y = 0, yz at x = 0","operations":"the cell's in-plane ones (orthogonal): no operations declared","ops":[{"op":"four-fold ∥ c (90°)","rms_difference":0.051,"pairs":78083,"tested_on":"xy; xz↔yz"},{"op":"two-fold ∥ c","rms_difference":0.051,"pairs":51520,"tested_on":"xz; yz"},{"op":"mirror ⊥ a","rms_difference":0.051,"pairs":51520,"tested_on":"xy; xz"},{"op":"mirror ⊥ b","rms_difference":0.05,"pairs":51520,"tested_on":"xy; yz"}],"holds":[],"symmetry_declared":false,"verdict":"not judged: the file declares no symmetry"}
```

### 21. update_settings (done)

Arguments: `{"changes":{"flattenEstimator":"floor"}}`

Why (the model's words before it):

```
I'm checking the back-FFT correlation, which fell from 0.989 to 0.978 after the snip, and comparing it to the r≥0.999 target against the even part. The odd share is about 4%, and since Friedel's law makes the diffraction centrosymmetric, that odd component is just what the transform drops, so it's fine. Next I'm looking at the strongest features in the ΔPDF.

Next I'm looking at the strongest ΔPDF features, starting with a large negative peak at ±2.76 Å, which matches a/√2 along the face diagonals and suggests fewer pairs than average there. I'm not sure yet what its size of about -1180σ physically means, so I'll treat that cautiously. There's also a positive peak near 4.77 Å and a negative one near 6.73 Å, roughly a√3 along the body diagonal.

I'm checking whether the 3.84 Å vector along c, with its +468σ peak, matches the same kind of positive correlation as the other features. I also want to be careful about how I read the sign: positive means more pairs than average at that separation. The 6.44 Å⁻¹ reach and full coverage at 11.05 Å⁻¹ look fine, so the window isn't truncating anything. Next, the Laue class question: the diffuse data points to 4/mmm, the all-voxel reading points to m-3m, and the metric is cubic, so I'll raise that with the user rather than decide it myself.

The 4/mmm reading from the diffuse data suggests the diffuse volume lacks cubic symmetry, even though the cell metric is cubic. That's worth flagging to the user: any symmetry they declare should be th…
```

Result: flattenEstimator snip → floor

```
{"changed":[{"setting":"flattenEstimator","from":"snip","to":"floor"}],"rerun_from":"flatten"}
```

### 22. run_pipeline (done)

Arguments: `{"from_stage":"flatten"}`

Result: done in 5.5 s · 3 computed, 0 reused

```
{"ended":"done","seconds":5.5,"stages":{"flatten":"computed","pdf":"computed","pdf_check":"computed"},"outputs":["raw","ringremoved","braggpunched","backfilled","flattened","delta_pdf"],"log_tail":["Flatten · flatten complete (bg max 0.8923)","3D-ΔPDF · 3D-ΔPDF FFT (apodize=gaussian)","3D-ΔPDF · ΔPDF complete (|Q|max 11.16 Å⁻¹, shape (162, 162, 162))","Consistency check · back-FFT round-trip consistency check","Consistency check · back-FFT vs data: r=0.97798, normalised RMS=1.660e-01; vs the data's even part, which the transform keeps: r=1.00000"]}
```

### 23. assess_stage (done)

Arguments: `{}`

Result: Ring removal: meets its goal · ring ratio 1 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0 · Bragg punch: meets its goal · 0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0257 · Backfill: meets its goal · seam 0.202σ · bright ≤ 0 · Flatten: meets its goal · floor ≤ 0.921σ · trend 0.019 · span 0.0298 · no pedestal · 3D-ΔPDF: meets its goal · r 0.97798 (even part 1) · RMS 0.166 · SNR 1090 · no symmetry declared (asymmetry 0.047)

```
{"rings":{"verdict":"meets its goal","criterion":"No powder ring left above, or dented below, three times its plane's noise; a powder ring rises at least 0.15 of its median height in 90 % of directions.","headline":"ring ratio 1 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0","stage_shells":"removed 0; left 1: 1.72 isotropy","mean_ring_energy_ratio":1,"max_over_subtraction_fraction":0,"max_ring_dent":0,"max_ring_left":0,"worst_ring_dent":null,"worst_ring_left":null,"shells_judged":[{"at":1.68,"ring":false,"isotropy":0.005},{"at":2.39,"ring":false},{"at":3.16,"ring":false,"isotropy":-15},{"at":4.59,"ring":false},{"at":5.52,"ring":false,"isotropy":-1.9},{"at":5.66,"ring":false,"isotropy":-4.6},{"at":6.02,"ring":false},{"at":7.08,"ring":false,"isotropy":-0.83},{"at":7.23,"ring":false},{"at":7.58,"ring":false},{"at":7.73,"ring":false,"isotropy":-0.84}]},"punch":{"verdict":"meets its goal","criterion":"No Bragg peak missed at a lattice node; no sharp peak left off the lattice outside the protected planes.","headline":"0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0257","total_leftover_peaks":0,"leftover_at_nodes":0,"leftover_off_lattice":0,"leftover_on_protected_p… [2789 characters; the record holds them all]
```

### 24. measure_reciprocal_cut (done)

Arguments: `{"plane":"hk0","value":0}`

Result: H–K plane at L = 0: ring ratio 1 · 0 missed at nodes, 0 sharp off-lattice, 0 broad maxima · seam 0.177σ · floor ≤ 0.731σ

```
{"cut":"H–K plane at L = 0","ring_removal":{"before_ring_energy":0.033,"after_ring_energy":0.033,"ring_energy_ratio":1,"over_subtraction_fraction":0,"after_negative_fraction":0,"ring_residuals":[{"at":1.68,"fwhm":0.29,"residual_fraction":0.499,"noise_fraction":0.144,"significant":true},{"at":3.16,"fwhm":0.072,"residual_fraction":0.256,"noise_fraction":0.0626,"significant":true},{"at":4.59,"fwhm":0.14,"residual_fraction":0.24,"noise_fraction":0.0591,"significant":true},{"at":7.23,"fwhm":0.072,"residual_fraction":0.0884,"noise_fraction":0.0433,"significant":false},{"at":7.73,"fwhm":0.072,"residual_fraction":0.0427,"noise_fraction":0.0324,"significant":false}],"worst_ring_dent":null,"worst_ring_left":{"at":1.68,"fwhm":0.29,"residual_fraction":0.499,"noise_fraction":0.144,"significant":true},"suggested_display_vmax":1.051,"n_finite":25921},"bragg_punch_leftover":{"suspicious_peaks":[],"n_suspicious":0,"n_at_nodes":0,"n_off_nodes":0,"n_on_protected":0,"n_broad_off_nodes":0,"n_skipped_noisy":0,"scan_sigma_threshold":8},"backfill":{"n_filled":587,"fill_coverage":0.0226,"median_seam_sigma":0.177,"p95_seam_sigma":0.574,"bright_fill_fraction":0,"checkerboard_fraction":0.152},"flatten":{"remo… [2603 characters; the record holds them all]
```

### 25. run_verdict (done)

Arguments: `{}`

Why (the model's words before it):

```
The floor estimator came out best overall: its back-FFT rms is 0.166, against 0.206 for snip and 0.134 for the model, and it avoids the pedestal the model introduced, with the floor trend staying near zero. I'm going with it. Next I'm turning to the ring at 1.68 Å⁻¹, where the residual fraction of 0.499 looks significant.

I'm checking the ring at 1.68 Å⁻¹ against the assessment, which says the rings meet the goal and that the bumps there partly come from the crystal's own scattering. The shell's isotropy is low and no ring is flagged, so this reads as diffuse signal rather than a powder ring. Next I'll pull the final peaks and run the full verdict.

I'm checking that the back-FFT's leftover mismatch of 0.978 comes from the transform keeping only the even part of the data, and that the odd share of about 0.044 is what accounts for it. Since the intensities should be centrosymmetric under Friedel's law, that small odd part is worth noting carefully as a possible data issue. Next I'll pull the final verdict, the ΔPDF peaks, and a texture check on the final configuration, and compare the strongest feature after the floor correction.
The floor estimator removes the pedestal (trend 0.019, span 0.030) and keeps the back-FFT closer to the data than snip does. I'm keeping it. Now the final checks on this run.
```

Result: met: every stage meets its goal

```
{"verdict":"met: every stage meets its goal","achieved":"met","stages":{"rings":"meets its goal","punch":"meets its goal","backfill":"meets its goal","flatten":"meets its goal","pdf":"meets its goal"},"needs_attention":[],"not_judged":[],"not_measured":[],"data_problems":[]}
```

### 26. dpdf_peaks (done)

Arguments: `{"limit":8}`

Result: 626 extrema above 5σ; strongest − at (0.499, -0.498, 0) r.l.u., 2.75 Å, 1200σ

```
{"grouped_by":"sign, length and size (no symmetry declared)","features":[{"length_A":2.75,"size_sigma":-1200,"n_vectors":6,"vectors_rlu":[[0.499,-0.498,0],[0.499,0.498,0],[0.0001,0.499,0.499],[0,0.499,-0.499]],"vectors_A":[[1.945,-1.944,-0.0001],[1.944,1.944,0.0001],[0.0003,1.945,1.944],[0.0001,1.945,-1.944]]},{"length_A":4.762,"size_sigma":730,"n_vectors":12,"vectors_rlu":[[0.499,0.499,0.997],[0.997,0.498,0.498],[0.498,-0.997,-0.498],[0.498,0.997,-0.498]],"vectors_A":[[1.945,1.944,3.888],[3.887,1.944,1.944],[1.943,-3.887,-1.944],[1.944,3.887,-1.944]]},{"length_A":6.731,"size_sigma":-515,"n_vectors":4,"vectors_rlu":[[0.997,0.997,-0.996],[0.996,0.996,0.996],[0.996,-0.996,0.997],[0.996,-0.996,-0.996]],"vectors_A":[[3.887,3.886,-3.886],[3.886,3.885,3.885],[3.885,-3.885,3.887],[3.886,-3.886,-3.886]]},{"length_A":3.835,"size_sigma":490,"n_vectors":1,"vectors_rlu":[[0,0,0.983]],"vectors_A":[[0,-0.0001,3.835]]},{"length_A":7.771,"size_sigma":466,"n_vectors":2,"vectors_rlu":[[0,1.99,-0.0001],[1.99,0,-0.0003]],"vectors_A":[[0.0002,7.771,-0.0005],[7.772,-0.0001,-0.0013]]},{"length_A":7.765,"size_sigma":228,"n_vectors":1,"vectors_rlu":[[-0.0002,-0.0003,1.99]],"vectors_A":[[-0.0008,-0.0011,7.7… [1662 characters; the record holds them all]
```

### 27. texture_check (done)

Arguments: `{}`

Result: no systematic fill bias over 189 holes in 3-D · azimuthal ratio 0.932–0.966

```
{"n_holes":189,"n_judged":189,"median_fill_bias_sigma":0,"median_fill_bias_level":0,"above_fraction":0.418,"below_fraction":0.00529,"above_floor_fraction":0,"below_floor_fraction":0,"systematic_fill_bias":false,"criterion":"systematic_fill_bias: 5 judged holes or more, 75 % of them past their range one way, with a median of 0.5σ and 0.2 of the local level or more.","per_cut":[{"cut":"H–K plane at L = 0","azimuthal_ratio":0.966},{"cut":"H–L plane at K = 0","azimuthal_ratio":0.957},{"cut":"K–L plane at H = 0","azimuthal_ratio":0.932}]}
```

### 28. bragg_peaks (done)

Arguments: `{"limit":5}`

Result: 188 fitted peaks; top 5 by significance

```
{"n_peaks":188,"punch_frame":"spherical","sorted_by":"significance","peaks":{"cols":["hkl","q","intensity","local_background","significance","measured_width_q","resolution_limited","anisotropy","fit"],"rows":[[[0,2,0],3.222,112.1,0.1995,259.2,null,null,1,"own"],[[-2,0,0],3.222,111.8,0.2015,258.6,null,null,1,"own"],[[0,-2,0],3.222,111.7,0.2003,258.5,null,null,1,"own"],[[2,0,0],3.222,111.5,0.1984,257.9,null,null,1,"own"],[[0,0,2],3.222,111.3,0.2006,257.5,null,null,1,"own"]]}}
```

### 29. qmax_coverage (done)

Arguments: `{}`

Why (the model's words before it):

```
I'm moving on to the strongest pair correlations, noting the PDF vectors are strong and less affected. I'll write the final answer concisely, quoting the feature values exactly as returned, sign included.

I'm checking the remaining data points: the meets and flatten fixes are sound, the UB orientation and coverage look fine, and the Laue suggestion is the user's call with only diffuse support for 4/mmm.

I'm going over the four largest features next: a −1200σ feature at 2.75 Å, a +730σ one at 4.76 Å, a −515σ one along the body diagonal, and a +490σ one along c. The first is unusually large, so I'll quote its value as returned and flag that it should be checked before reading anything into it.

I'm finishing the list of large features and noting that 626 extrema sit above 5σ, so there are many of them. Signs are the key reading: positive means more pairs than average, negative means fewer. The grid rounds the vector lengths, so I won't read anything into the small differences; I'll report the values as returned and state the verdict that the target is met.

I need to rerun qmax_coverage, since the last run recomputed flatten/pdf after the floor run. I also have to cite the pdf check values from this reply's tool results: the back_fft_pearson_r figure came from the earlier snip-run assess_stage, so I'll use the final floor run's headline numbers instead, and I'm about to re-call assess_stage on pdf.

I'll call qmax_coverage, assess_stage on pdf, and symmetry_check together in …
```

Result: the transform reaches 6.444 Å⁻¹ (the window tapers to zero at the box faces), inside full coverage at 11.05 Å⁻¹

```
{"verdict":"the transform reaches 6.444 Å⁻¹ (the window tapers to zero at the box faces), inside full coverage at 11.05 Å⁻¹","window_weight_on_unmeasured":null,"window_shape":"separable","window_scale":1,"transform_reach_q":6.444,"reach_from":"the window tapers to zero at the box faces","full_coverage_q":11.05,"box_face_q":6.444,"box_corner_q":11.16,"raw_counts":{"q_min_edge":null,"q_max_edge":null,"fully_measured":[0.15,11.05],"box_face_q":6.444},"suggested_band":null,"counts_end_inside_box":false,"band_check":"no |Q| band is set: the transform takes every voxel, empty ones included, up to the window's reach","q_unit":"Å⁻¹","settings":{"pdfQMin":"(default)","pdfQMax":"(default)","pdfApod":"(default)","pdfWindowShape":"(default)","pdfWindowSupport":true}}
```

### 30. assess_stage (done)

Arguments: `{"stage":"pdf"}`

Result: 3D-ΔPDF: meets its goal · r 0.97798 (even part 1) · RMS 0.166 · SNR 1090 · no symmetry declared (asymmetry 0.047)

```
{"pdf":{"verdict":"meets its goal","criterion":"Back-FFT r of 0.999 or more against the data's even part under Q → −Q; at most 1e-3 of the window's weight on unmeasured space; the declared symmetry kept.","headline":"r 0.97798 (even part 1) · RMS 0.166 · SNR 1090 · no symmetry declared (asymmetry 0.047)","back_fft_pearson_r":0.97798,"back_fft_normalized_rms":0.166,"back_fft_pearson_r_even":1,"back_fft_odd_share":0.0436,"back_fft_per_plane_r":{"+0.000":0.9893738647168953,"+0.350":0.9753686528357495,"+1.000":0.9888973554501816},"mean_feature_snr":1090,"window_weight_on_unmeasured":null,"window_shape":"separable","max_symmetry_break":0.047,"worst_symmetry_op":"four-fold (90°)","symmetry_declared":false,"per_plane":{"xy":{"feature_snr":1090,"strong_feature_fraction":0.0561,"positive_fraction":0.456,"anisotropy_ratio":1.01},"xz":{"feature_snr":1090,"strong_feature_fraction":0.0429,"positive_fraction":0.491,"anisotropy_ratio":1.1},"yz":{"feature_snr":1090,"strong_feature_fraction":0.0428,"positive_fraction":0.504,"anisotropy_ratio":1.1}},"sigma_of":"each section outside the origin's disk, its own, robust","goal":"The ΔPDF must show features above noise (feature_snr) with the transform's … [2274 characters; the record holds them all]
```

### 31. symmetry_check (done)

Arguments: `{}`

Result: no symmetry declared: not judged

```
{"sections":"xy at z = 0 Å, xz at y = 0, yz at x = 0","operations":"the cell's in-plane ones (orthogonal): no operations declared","ops":[{"op":"four-fold ∥ c (90°)","rms_difference":0.049,"pairs":78083,"tested_on":"xy; xz↔yz"},{"op":"two-fold ∥ c","rms_difference":0.049,"pairs":51520,"tested_on":"xz; yz"},{"op":"mirror ⊥ a","rms_difference":0.049,"pairs":51520,"tested_on":"xy; xz"},{"op":"mirror ⊥ b","rms_difference":0.049,"pairs":51520,"tested_on":"xy; yz"}],"holds":[],"symmetry_declared":false,"verdict":"not judged: the file declares no symmetry"}
```

### 32. run_verdict (done)

Arguments: `{}`

Result: met: every stage meets its goal

```
{"verdict":"met: every stage meets its goal","achieved":"met","stages":{"rings":"meets its goal","punch":"meets its goal","backfill":"meets its goal","flatten":"meets its goal","pdf":"meets its goal"},"needs_attention":[],"not_judged":[],"not_measured":[],"data_problems":[]}
```

### 33. texture_check (done)

Arguments: `{}`

Why (the model's words before it):

```
I'm about to write the full answer and need to decide how to cite the numbers. The earlier draft used a `pdf.` path, so I'm checking whether the `assess_stage` result path should be used instead.

I'm checking which fields to quote directly, including the Pearson r value and the coverage figures, and I'll name the tool for each. For verdicts I'll use the run verdict field. The rings, punch, backfill, and flatten results come from the final floor-run assessment. I'm unsure whether the texture check still reflects the current stage, so I'm going to rerun it before writing the answer.
```

Result: same call as step 27: not run again

```
{"already_called":"Called with these arguments earlier in this reply (step 27); its result is above. Use it, or call with other arguments."}
```

## Conclusion

Flatten is the one stage flagged. Checking its radial profile and the run log before changing anything.

The flatten result has a Q trend: it goes from about −0.17 at low |Q| to +0.3 at high |Q|, so the constant subtraction leaves a pedestal. Trying the snip estimator.

The snip estimator removes the pedestal and the flatten now meets its goal. Checking the full verdict and the ΔPDF features.

Snip clears the pedestal but lowered the back-FFT agreement with the data (r 0.989 → 0.978, RMS 0.134 → 0.206). I'll test the floor estimator to see whether it removes the pedestal without that cost.

The floor estimator removes the pedestal (trend 0.019, span 0.030) and keeps the back-FFT closer to the data than snip does. I'm keeping it. Now the final checks on this run.

The coverage verdict needs a fresh check after the last run, and the back-FFT and symmetry numbers need to come from this reply's results. I'm re-running those checks now.

**Result: met.** Every stage meets its goal on the final run. The run's verdict lists no data problems and nothing that needs attention.

**What I found and changed**

- **Flatten (fixed).** The default `model` estimator left a pedestal. Its floor trend was 0.996 and its span 1.3, and the flattened profile ran from about −0.17 at low |Q| to +0.3 at high |Q|. I tried `snip`. It removed the pedestal but lowered the back-FFT agreement (RMS 0.134 → 0.206). I then tried `floor` and kept it. Final flatten: floor trend 0.019, span 0.0298, floors near zero, and the flatten verdict is "meets its goal." Setting changed: `flattenEstimator` = `floor`.
- **Rings.** Meets its goal. Ring energy ratio 1, with no over-subtraction and no ring left. The shell flagged at 1.68 Å⁻¹ has isotropy 0.005 and is not a powder ring, so it is the crystal's own diffuse scattering.
- **Bragg punch.** Meets its goal. 188 peaks fitted, none missed at nodes, none off-lattice, 2.6 % of voxels punched.
- **Backfill.** Meets its goal. Median seam 0.202σ, no bright fills. The texture check shows no systematic fill bias (median 0σ; above-range fraction 0.418, below 0.005, not systematic). Azimuthal ratios are 0.966, 0.957 and 0.932 on the three planes, so no texture is added.
- **Orientation (UB).** Right. The tool gives an orientation change of 0.001° and a cell of 3.8994–3.8995 Å with γ within 0.002° of 90°. This is not a data problem.
- **Second grain.** None. The off-lattice peak count is zero.
- **Coverage.** Clean on this run. `qmax_coverage` measured full coverage to 11.05 Å⁻¹ and a transform reach of 6.444 Å⁻¹. The counts do not end inside the box (counts_end_inside_box false), and the window weight on unmeasured space is null.
- **Back-FFT.** The round trip reproduces the data's even part exactly (r 1.0). Against the full data, r is 0.97798, RMS 0.166. The gap is the odd share, 0.0436, which the transform drops. I cannot attribute that odd part further from these checks.

**Data problems the settings cannot fix**

- **Laue class is not set.** The metric is cubic. Across all voxels the data support m-3m, but the diffuse alone supports only 4/mmm, and the tool suggests 4/mmm. The symmetry is your decision, and I did not set it. Declaring m-3m would impose the Bragg peaks' symmetry on the diffuse, so I would avoid it.
- **No symmetry is declared, and the diffuse does not respect the in-plane operations.** The symmetry check's four operations (four-fold, two-fold and both mirrors about c, a and b) each break by an RMS of 0.049. The worst is the four-fold, at 0.047 on the ΔPDF's own x–y section. The check is not judged, since nothing is declared.

**Strongest pair correlations (final run)**

Positive means more pairs than the average structure; negative means fewer. Sizes are the tool's signed robust-σ values.

1. **−1200σ at 2.75 Å**, six vectors along the face diagonals, e.g. (½, −½, 0) → (1.945, −1.944, 0) Å. Fewer pairs than average.
2. **+730σ at 4.76 Å**, twelve vectors, e.g. (½, ½, 1) → (1.945, 1.944, 3.888) Å. More pairs than average.
3. **−515σ at 6.73 Å**, four vectors along the body diagonals, e.g. (1, 1, −1) → (3.887, 3.886, −3.886) Å. Fewer pairs than average.
4. **+490σ at 3.835 Å**, along c, (0, 0, 1) → (0, 0, 3.835) Å. More pairs than average.
5. **+466σ at 7.77 Å**, along a and b, (0, 2, 0) → (0, 7.771, 0) Å. More pairs than average.

The −1200σ feature is far larger than the others, so check it before reading anything into it. These tools cannot say what these correlations mean physically, and the vector lengths are as the FFT grid returns them, not refined.

**Verdict computed from the checks:** met: every stage meets its goal.

## Numbers and their sources

| Number | Source |
| --- | --- |
| -0.17 | step 30, assess_stage, pdf.headline = 0.166 |
| +0.3 | step 24, measure_reciprocal_cut, ring_removal.ring_residuals[0].fwhm = 0.29 |
| 0.989 | step 30, assess_stage, pdf.criterion = 0.999 |
| 0.978 | step 30, assess_stage, pdf.headline = 0.97798 |
| 0.134 | step 4, assess_stage, pdf.headline = 0.1342 |
| 0.206 | step 24, measure_reciprocal_cut, flatten.after_negative_fraction = 0.203 |
| 0.019 | step 23, assess_stage, flatten.headline = 0.019 |
| 0.030 | step 23, assess_stage, flatten.headline = 0.0298 |
| 0.996 | step 30, assess_stage, pdf.criterion = 0.999 |
| 1.3 | step 16, radial_profile, shells.rows[3][0] = 1.33 |
| 0.0298 | step 23, assess_stage, flatten.headline = 0.0298 |
| 1 | step 30, assess_stage, pdf.criterion = 0.999 |
| 1.68 | step 24, measure_reciprocal_cut, ring_removal.ring_residuals[0].at = 1.68 |
| 0.005 | step 27, texture_check, below_fraction = 0.00529 |
| 188 | step 28, bragg_peaks, n_peaks = 188 |
| 2.6 % | step 31, symmetry_check, sections = 0 |
| 0.202 | step 28, bragg_peaks, peaks.rows[0][3] = 0.1995 |
| 0 | step 31, symmetry_check, sections = 0 |
| 0.418 | step 27, texture_check, above_fraction = 0.418 |
| 0.966 | step 30, assess_stage, pdf.headline = 0.97798 |
| 0.957 | step 30, assess_stage, pdf.back_fft_per_plane_r.+0.350 = 0.9753686528357495 |
| 0.932 | step 27, texture_check, per_cut[2].azimuthal_ratio = 0.932 |
| 0.001 | step 30, assess_stage, pdf.criterion = 0.001 |
| 3.8994 | step 26, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| 3.8995 | step 26, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| 0.002 | step 26, dpdf_peaks, features[6].vectors_A[0][0] = 0.0015 |
| 90 | step 31, symmetry_check, ops[0].op = 90 |
| 11.05 | step 29, qmax_coverage, verdict = 11.05 |
| 6.444 | step 29, qmax_coverage, verdict = 6.444 |
| 1.0 | step 30, assess_stage, pdf.criterion = 0.999 |
| 0.97798 | step 30, assess_stage, pdf.headline = 0.97798 |
| 0.166 | step 30, assess_stage, pdf.headline = 0.166 |
| 0.0436 | step 30, assess_stage, pdf.back_fft_odd_share = 0.0436 |
| 0.049 | step 31, symmetry_check, ops[0].rms_difference = 0.049 |
| 0.047 | step 30, assess_stage, pdf.headline = 0.047 |
| -1200 | step 26, dpdf_peaks, features[0].size_sigma = -1200 |
| 2.75 | step 26, dpdf_peaks, features[0].length_A = 2.75 |
| 1.945 | step 26, dpdf_peaks, features[0].vectors_A[0][0] = 1.945 |
| -1.944 | step 26, dpdf_peaks, features[0].vectors_A[0][0] = 1.945 |
| +730 | step 26, dpdf_peaks, features[1].size_sigma = 730 |
| 4.76 | step 26, dpdf_peaks, features[1].length_A = 4.762 |
| 1.944 | step 26, dpdf_peaks, features[0].vectors_A[0][0] = 1.945 |
| 3.888 | step 26, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| -515 | step 26, dpdf_peaks, features[2].size_sigma = -515 |
| 6.73 | step 26, dpdf_peaks, features[2].length_A = 6.731 |
| -1 | step 30, assess_stage, pdf.criterion = 0.999 |
| 3.887 | step 26, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| 3.886 | step 26, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| -3.886 | step 26, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| +490 | step 26, dpdf_peaks, features[3].size_sigma = 490 |
| 3.835 | step 26, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| +466 | step 26, dpdf_peaks, features[4].size_sigma = 466 |
| 7.77 | step 26, dpdf_peaks, features[4].length_A = 7.771 |
| 2 | step 28, bragg_peaks, peaks.rows[0][0][1] = 2 |
| 7.771 | step 26, dpdf_peaks, features[4].length_A = 7.771 |

## Score

- Fault reported: yes
- No false alarm: yes
- Unsafe actions: 0
- Checks the graders' two readings dispute: 0
- Requests cut at the output limit: 0
- Outputs, against the planted truth: features FAILED, window ok, pedestal ok

## Findings

- **science-error** (needs the user): the scored outputs fail features. Proposed: the settings the run chose or left lost or moved a planted correlation: find the stage and the setting
