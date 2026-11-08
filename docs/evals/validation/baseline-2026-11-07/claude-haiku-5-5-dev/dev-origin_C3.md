# dev-origin, arm C, run 3

Model: Claude Haiku 5.5 (Anthropic) (Anthropic). Started 2026-11-07T22:58:20.888Z; 84 s, 297573 tokens in and 9000 out over 13 requests, $0.0102. The model saw the dataset as ve78bc4-C3.

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
I'll start by getting a picture of the dataset and checking the current view and settings, since those don't depend on each other. Once that's sorted, I'll kick off the pipeline.
```

Result: ve78bc4_C3: raw

```
{"dataset":"ve78bc4_C3","id":"ve78bc4-C3","stages":["raw"],"reciprocal":{"grid":[161,161,161],"H":[-4,4],"K":[-4,4],"L":[-4,4],"planes":["hk0","h0l","0kl"]},"cell":{"a":3.9,"b":3.9,"c":3.9,"alpha":90,"beta":90,"gamma":90},"sigma":"measured","delta_pdf":null,"other_datasets":[]}
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
{"columns":"r_int, x_noise, chi2: [all voxels, diffuse]; x_noise = R_int / noise floor, chi2 = χ²/dof (1: within counting noise)","classes":[{"class":"-1","ops":2,"r_int":[0.069,0.059],"x_noise":[1.32,1.11],"chi2":[3.61,1.17],"orbits":1984244,"verdict":"supported"},{"class":"2/m (b unique)","ops":4,"contains":["-1"],"r_int":[0.074,0.062],"x_noise":[1.16,0.96],"chi2":[2.63,0.88],"orbits":1048872,"verdict":"supported"},{"class":"2/m (c unique)","ops":4,"contains":["-1"],"r_int":[0.071,0.062],"x_noise":[1.12,0.95],"chi2":[2.46,0.86],"orbits":1048884,"verdict":"supported"},{"class":"mmm","ops":8,"contains":["2/m (b unique)","2/m (c unique)"],"r_int":[0.076,0.064],"x_noise":[1.1,0.91],"chi2":[2.29,0.79],"orbits":531432,"verdict":"supported"},{"class":"4/m","ops":8,"contains":["2/m (c unique)"],"r_int":[0.076,0.064],"x_noise":[1.1,0.91],"chi2":[2.28,0.79],"orbits":524956,"verdict":"supported"},{"class":"4/mmm","ops":16,"contains":["mmm","4/m"],"r_int":[0.076,0.065],"x_noise":[1.07,0.89],"chi2":[2.15,0.75],"orbits":268998,"verdict":"supported"},{"class":"m-3","ops":24,"contains":["mmm"],"r_int":[0.092,0.079],"x_noise":[1.28,1.08],"chi2":[2.57,1.18],"orbits":177200,"verdict":"rose 1.16× ag… [2693 characters; the record holds them all]
```

### 4. run_pipeline (done)

Arguments: `{}`

Why (the model's words before it):

```
I'm weighing a suggestion for the Laue class in the 4/mmm point group, but I'll leave the user's stated classification as it is and only offer alternatives. Next I'm running the pipeline.
```

Result: done in 7.6 s · 6 computed, 0 reused

```
{"ended":"done","seconds":7.6,"stages":{"rings":"computed","punch":"computed","backfill":"computed","flatten":"computed","pdf":"computed","pdf_check":"computed"},"outputs":["raw","ringremoved","braggpunched","backfilled","flattened","delta_pdf"],"log_tail":["Flatten · flatten complete (const 0.1444 + 0·F(Q)², R² 0.000)","3D-ΔPDF · 3D-ΔPDF FFT (apodize=gaussian)","3D-ΔPDF · ΔPDF complete (|Q|max 11.16 Å⁻¹, shape (162, 162, 162))","Consistency check · back-FFT round-trip consistency check","Consistency check · back-FFT vs data: r=0.98290, normalised RMS=1.557e-01; vs the data's even part, which the transform keeps: r=1.00000"]}
```

### 5. assess_stage (done)

Arguments: `{}`

Result: Ring removal: meets its goal · ring ratio 0.989 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0 · Bragg punch: meets its goal · 0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0262 · Backfill: meets its goal · seam 0.222σ · bright ≤ 0 · Flatten: meets its goal · floor ≤ 1.64σ · trend 0.0166 · span 0.271 · no pedestal · 3D-ΔPDF: meets its goal · r 0.9829 (even part 1) · RMS 0.1557 · SNR 838 · unmeasured 9.83e-5 · no symmetry declared (asymmetry 0.097)

```
{"rings":{"verdict":"meets its goal","criterion":"No powder ring left above, or dented below, three times its plane's noise. A bump is a powder ring only if it rises in nearly every direction over the sphere (at least 0.15 of its median height in 90 % of directions).","headline":"ring ratio 0.989 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0","stage_shells":"removed 0; left 1: 3.29 height","mean_ring_energy_ratio":0.989,"max_over_subtraction_fraction":0,"max_ring_dent":0,"max_ring_left":0,"worst_ring_dent":null,"worst_ring_left":null,"shells_judged":[{"at":1.68,"ring":false,"isotropy":-0.02},{"at":2.39,"ring":false},{"at":3.16,"ring":false},{"at":4.59,"ring":false},{"at":5.95,"ring":false,"isotropy":-14},{"at":7.08,"ring":false,"isotropy":-0.69},{"at":7.58,"ring":false}]},"punch":{"verdict":"meets its goal","criterion":"No Bragg peak missed at a lattice node, and no sharp peak left off the lattice outside the protected planes. Broad maxima stay.","headline":"0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0262","total_leftover_peaks":0,"leftover_at_nodes":0,"leftover_off_lattice":0,"leftover_on_protected_planes":0,"leftover_on_protected_planes_sharp":0,"leftov… [3029 characters; the record holds them all]
```

### 6. ub_check (done)

Arguments: `{}`

Result: both: RMS 0.0583 → 0.0583 Å⁻¹ over 90 peaks; a 3.900 → 3.900 Å, c 3.900 → 3.900 Å; turned 0.000°; origin shifted (0.0305, 0.0195, 0.0000) r.l.u.

```
{"verdict":"the UB is right: turned 0°, under the 0.05° that counts as turned; the HKL origin is shifted by (0.0305, 0.0195, 0) r.l.u., which no UB explains","fit":"both","bragg_nodes_every":[1,1,1],"symmetry_from":null,"symmetrised":null,"symmetry_break":null,"peaks":{"searched":342,"used":90,"rejected":0},"rms_start":0.0583,"rms":0.0583,"cell_start":"3.9000, 3.9000, 3.9000 Å; 90.000°, 90.000°, 90.000°","cell":"3.8998, 3.8998, 3.8999 Å; 90.000°, 90.000°, 90.000°","orientation_change_deg":0,"axis_uvw":[-0.356,1,0.945],"transform_diagonal":[1.000043,1.000039,1.000017],"passes":[{"q_max":3.72,"found":14,"used":14,"rms":"0.0583 → 0.0583"},{"q_max":7.44,"found":82,"used":82,"rms":"0.0583 → 0.0583"},{"q_max":11.16,"found":90,"used":90,"rms":"0.0583 → 0.0583"}],"radial":[{"q":"0–4","direction":"in-plane","n":4,"before":0.000056,"after":0.000017},{"q":"0–4","direction":"oblique","n":8,"before":-0.000049,"after":-0.000083},{"q":"4–8","direction":"in-plane","n":4,"before":0.000037,"after":-0.0000057},{"q":"4–8","direction":"oblique","n":56,"before":0.000036,"after":0.0000072},{"q":"4–8","direction":"near the third axis","n":8,"before":0.000036,"after":0.000013},{"q":"8–12","direction":"obli… [1798 characters; the record holds them all]
```

### 7. qmax_coverage (done)

Arguments: `{}`

Result: fitted to the coverage: the ΔPDF's separable window puts 9.83e-5 of its weight on unmeasured reciprocal space, which the backend keeps within 1e-3 when it fits the window to the coverage: its own target, not a check; the raw counts reach the box's nearest face

```
{"verdict":"fitted to the coverage: the ΔPDF's separable window puts 9.83e-5 of its weight on unmeasured reciprocal space, which the backend keeps within 1e-3 when it fits the window to the coverage: its own target, not a check; the raw counts reach the box's nearest face","window_weight_on_unmeasured":0.00009827301528275553,"window_shape":"separable","window_scale":1,"transform_reach_q":6.444,"reach_from":"the window tapers to zero at the box faces","full_coverage_q":8.85,"box_face_q":6.444,"box_corner_q":11.16,"raw_counts":{"q_min_edge":null,"q_max_edge":null,"fully_measured":[0.15,8.85],"box_face_q":6.444},"suggested_band":null,"counts_end_inside_box":false,"band_check":"no |Q| band is set: the transform takes every voxel, empty ones included, up to the window's reach","q_unit":"Å⁻¹","settings":{"pdfQMin":"(default)","pdfQMax":"(default)","pdfApod":"(default)","pdfWindowShape":"(default)","pdfWindowSupport":true}}
```

### 8. run_log (done)

Arguments: `{}`

Result: 23 lines · done

```
{"ended":"done","lines":{"cols":["stage","status","message"],"rows":[["rings","progress","trimmed 51,359 voxels at the edge of the measured coverage (edge_trim=1)"],["rings","start","ring removal [pooled]: 161 H planes (plane=0kl, |Q| (1.5, 10.5), 72 sectors, ±5.0° stack pooling)"],["rings","progress","sector profiles 30/161"],["rings","progress","sector profiles 60/161"],["rings","progress","sector profiles 90/161"],["rings","progress","sector profiles 120/161"],["rings","progress","sector profiles 150/161"],["rings","done","pooled ring removal no_confirmed_rings: 0 shells confirmed as rings, 1 not (the crystal's own scattering, kept) (of 159/161 planes fitted), removed 0% of |I|"],["punch","start","Bragg punch (mode=both)"],["punch","progress","integer nodes (excess over its shell ≥ 5σ after the window search, no broader than a Bragg peak (shell fraction ≤ 0.15), no intensity floor): 185 peaks"],["punch","progress","search floors 27 / 27 × diffuse scatter 0.08557 = 2.31 intensity, 2.31 prominence: 0 peaks"],["punch","progress","own-width punch: 90 of 185 peaks punched to their own measured width, the rest to the shared Bragg profile"],["punch","progress","UB turned 0.008° ± 0.035… [2125 characters; the record holds them all]
```

### 9. texture_check (done)

Arguments: `{}`

Why (the model's words before it):

```
I'm noting that the origin shift is a data issue that settings won't fix, and that the Laue symmetry suggestion of 4/mmm conflicts with the user's stated symmetry, so I'll leave that alone. The rings look fine since none were removed, and next I want to check the texture, the measured cuts, and the dpdf peaks, plus the ring shell reading at 1.68 that I'm still unsure about.

I'm skipping the symmetry check since none was declared, and I'm noting that the punch's "UB turned 0.008°" line still explains the 0%. Next I'll measure the reciprocal cut at hk0, the radial profile, texture_check, and the dpdf peaks and cut.
```

Result: no systematic fill bias over 186 holes in 3-D · azimuthal ratio 0.957–0.996

```
{"n_holes":186,"n_judged":186,"median_fill_bias_sigma":0,"median_fill_bias_level":0,"above_fraction":0.446,"below_fraction":0.00538,"above_floor_fraction":0.102,"below_floor_fraction":0.00538,"systematic_fill_bias":false,"criterion":"systematic_fill_bias: 5 judged holes or more, 75 % of them past their range one way, with a median of 0.5σ and 0.2 of the local level or more.","per_cut":[{"cut":"H–K plane at L = 0","azimuthal_ratio":0.996},{"cut":"H–L plane at K = 0","azimuthal_ratio":0.994},{"cut":"K–L plane at H = 0","azimuthal_ratio":0.957}]}
```

### 10. radial_profile (done)

Arguments: `{"stages":["raw","ringremoved","braggpunched","backfilled","flattened"]}`

Result: H–K plane at L = 0: 32 shells × 5 stages

```
{"cut":"H–K plane at L = 0","q_unit":"|Q| in Å⁻¹","stat":"median per shell","shells":{"cols":["q","raw","ringremoved","braggpunched","backfilled","flattened"],"rows":[[0.183,0.406,0.406,0.306,0.18,0.0358],[0.436,0.182,0.182,0.182,0.182,0.0372],[0.715,0.174,0.174,0.174,0.174,0.0301],[1,0.206,0.206,0.206,0.206,0.0615],[1.28,0.257,0.257,0.257,0.257,0.113],[1.57,0.409,0.409,0.409,0.409,0.264],[1.86,0.45,0.45,0.45,0.45,0.306],[2.14,0.332,0.332,0.332,0.332,0.188],[2.42,0.316,0.316,0.316,0.316,0.172],[2.71,0.282,0.282,0.282,0.282,0.138],[2.99,0.206,0.206,0.21,0.195,0.0501],[3.27,0.214,0.214,0.199,0.174,0.0301],[3.56,0.154,0.154,0.155,0.153,0.00856],[3.84,0.14,0.14,0.14,0.14,-0.00485],[4.13,0.157,0.157,0.157,0.157,0.0122],[4.41,0.23,0.23,0.223,0.211,0.067],[4.7,0.305,0.305,0.298,0.281,0.137],[4.98,0.249,0.249,0.249,0.249,0.104],[5.27,0.238,0.238,0.238,0.238,0.0939],[5.55,0.251,0.251,0.251,0.251,0.106],[5.84,0.216,0.216,0.216,0.216,0.0716],[6.12,0.2,0.2,0.199,0.196,0.0516],[6.4,0.155,0.155,0.15,0.154,0.00939],[6.68,0.143,0.144,0.143,0.144,-0.000714],[6.97,0.241,0.241,0.234,0.224,0.08],[7.25,0.267,0.265,0.254,0.245,0.101],[7.54,0.245,0.258,0.258,0.258,0.114],[7.82,0.191,0.194,0.194,0.194,0.0… [1358 characters; the record holds them all]
```

### 11. dpdf_peaks (done)

Arguments: `{"limit":12}`

Result: 1280 extrema above 5σ; strongest − at (0, 0.497, -0.497) r.l.u., 2.74 Å, 1440σ

```
{"grouped_by":"sign, length and size (no symmetry declared)","features":[{"length_A":2.74,"size_sigma":-1440,"n_vectors":6,"vectors_rlu":[[0,0.497,-0.497],[-0.0001,0.497,0.497],[0.497,-0.497,0],[0.497,0,-0.497]],"vectors_A":[[0.0001,1.937,-1.937],[-0.0002,1.937,1.938],[1.937,-1.938,0.0002],[1.938,0.0001,-1.937]]},{"length_A":4.763,"size_sigma":806,"n_vectors":12,"vectors_rlu":[[0.499,-0.498,0.997],[0.499,-0.498,-0.997],[0.499,-0.997,-0.499],[0.499,-0.997,0.499]],"vectors_A":[[1.945,-1.944,3.888],[1.944,-1.944,-3.889],[1.945,-3.888,-1.944],[1.944,-3.888,1.945]]},{"length_A":6.732,"size_sigma":-539,"n_vectors":4,"vectors_rlu":[[0.997,-0.997,-0.997],[0.997,-0.996,0.997],[0.997,0.997,-0.997],[0.997,0.997,0.997]],"vectors_A":[[3.887,-3.886,-3.887],[3.886,-3.885,3.887],[3.887,3.886,-3.888],[3.887,3.886,3.887]]},{"length_A":3.88,"size_sigma":508,"n_vectors":1,"vectors_rlu":[[0,0.0001,0.995]],"vectors_A":[[-0.0001,0.0003,3.88]]},{"length_A":7.778,"size_sigma":443,"n_vectors":1,"vectors_rlu":[[-0.0001,1.99,0]],"vectors_A":[[-0.0004,7.778,0]]},{"length_A":7.778,"size_sigma":420,"n_vectors":1,"vectors_rlu":[[1.99,-0.0002,0]],"vectors_A":[[7.778,-0.0007,0.0001]]},{"length_A":7.779,"size_sigma"… [2147 characters; the record holds them all]
```

### 12. bragg_peaks (done)

Arguments: `{"limit":5}`

Result: 185 fitted peaks; top 5 by significance

```
{"n_peaks":185,"punch_frame":"spherical","sorted_by":"significance","peaks":{"cols":["hkl","q","intensity","local_background","significance","measured_width_q","resolution_limited","anisotropy","fit"],"rows":[[[0.02883,0.02122,-2],3.223,47.81,0.1363,195,[0.00294,0.164,0.164],[true,false,false],1.59,"own"],[[0.0288,0.02119,2],3.223,47.66,0.1355,194.5,[0.00293,0.164,0.164],[true,false,false],1.59,"own"],[[0.0288,2.021,0],3.256,47.14,0.1332,194.5,[0.164,0,0.164],[false,true,false],1.59,"own"],[[0.02878,-1.979,0],3.189,47.15,0.1339,194.3,[0.164,0,0.164],[false,true,false],1.59,"own"],[[-1.971,0.02118,0],3.176,47.06,0.1334,194.2,[0.164,0,0.164],[false,true,false],1.59,"own"]]}}
```

### 13. measure_dpdf_cut (done)

Arguments: `{"plane":"xy","value":0}`

Result: ΔPDF x–y section at z = 0 Å: SNR 829, anisotropy 1.05

```
{"cut":"ΔPDF x–y section at z = 0 Å","delta_pdf":{"origin_excluded_radius":1.95,"background_sigma":11.2,"feature_snr":829,"strong_feature_fraction":0.0392,"positive_fraction":0.543,"anisotropy_ratio":1.05,"anisotropy_angle_deg":-53,"radial_trend":[181,17.7,7.22]},"sigma_of":"this section outside the origin's disk, robust","fields":"All in this section's robust σ outside the origin's disk. feature_snr: the strongest feature over background σ; strong_feature_fraction: voxels beyond 5σ; positive_fraction: 0.5 is balanced ±; anisotropy_ratio: 1 isotropic, above ~1.5 rods or sheets, along anisotropy_angle_deg in the plane; radial_trend: mean |ΔPDF| in the inner, middle and outer shells."}
```

### 14. run_verdict (done)

Arguments: `{}`

Why (the model's words before it):

```
I'm checking the flattened radial profile, which dips below zero at high q, and noting that the flatten assessment rules out a pedestal. The values drop with q, from about 0.036 at low q to slightly negative near q of 8.4, and I'm trying to work out what is driving that trend.

I'm reading the flatten step as a plain constant subtraction of about 0.144, which is why the high-q values end up slightly negative. The background is clearly q-dependent, and the flatten model doesn't capture that, so I'm weighing whether a different flatten estimator or a q² variant would handle it better.

The origin shift of about (0.0305, 0.0195, 0) r.l.u. is a data problem that the settings can't fix. The dpdf peak at 2.74 Å stands out with a size of -1440, a strong negative feature at the nearest-neighbour vector a/√2, which could be an ordering signal.

I'm checking whether the origin shift and the dpdf peaks are still worth reporting, and noting that the symmetry was never declared, so I'd leave the 4/mmm suggestion for the user to decide. The odd-part share is small, about 0.033, so the asymmetry doesn't change the picture much. I'm also wondering whether to try a different flatten estimator before reporting.

I'm weighing whether the flattened profile's downward drift with |Q| is worth a trial with a different flatten estimator, such as "snip", even though the current verdicts already pass. I'm also thinking about checking the 0kl and h0l planes for ring or texture features, since the azimu…
```

Result: met: every stage meets its goal; data problems no setting fixes: the HKL origin is shifted by (0.0305, 0.0195, 0) r.l.u.

```
{"verdict":"met: every stage meets its goal; data problems no setting fixes: the HKL origin is shifted by (0.0305, 0.0195, 0) r.l.u.","achieved":"met","stages":{"rings":"meets its goal","punch":"meets its goal","backfill":"meets its goal","flatten":"meets its goal","pdf":"meets its goal"},"needs_attention":[],"not_judged":[],"not_measured":[],"data_problems":["the HKL origin is shifted by (0.0305, 0.0195, 0) r.l.u."]}
```

### 15. measure_reciprocal_cut (done)

Arguments: `{"plane":"hk0","value":0}`

Result: H–K plane at L = 0: ring ratio 1.05 · 0 missed at nodes, 0 sharp off-lattice, 0 broad maxima · seam 0.161σ · floor ≤ 1.52σ

```
{"cut":"H–K plane at L = 0","ring_removal":{"before_ring_energy":0.0557,"after_ring_energy":0.0585,"ring_energy_ratio":1.05,"over_subtraction_fraction":0,"after_negative_fraction":0,"ring_residuals":[{"at":1.68,"fwhm":0.29,"residual_fraction":0.477,"noise_fraction":0.131,"significant":true},{"at":3.16,"fwhm":0.071,"residual_fraction":0.335,"noise_fraction":0.0715,"significant":true},{"at":4.59,"fwhm":0.14,"residual_fraction":0.334,"noise_fraction":0.11,"significant":true},{"at":7.08,"fwhm":0.21,"residual_fraction":0.257,"noise_fraction":0.105,"significant":false},{"at":7.58,"fwhm":0.14,"residual_fraction":0.22,"noise_fraction":0.0645,"significant":true}],"worst_ring_dent":null,"worst_ring_left":{"at":1.68,"fwhm":0.29,"residual_fraction":0.477,"noise_fraction":0.131,"significant":true},"suggested_display_vmax":0.7114,"n_finite":25281},"bragg_punch_leftover":{"suspicious_peaks":[],"n_suspicious":0,"n_at_nodes":0,"n_off_nodes":0,"n_on_protected":0,"n_broad_off_nodes":0,"n_skipped_noisy":0,"scan_sigma_threshold":8},"backfill":{"n_filled":607,"fill_coverage":0.024,"median_seam_sigma":0.161,"p95_seam_sigma":0.43,"bright_fill_fraction":0,"checkerboard_fraction":0.129},"flatten":{"removed_… [2600 characters; the record holds them all]
```

### 16. measure_reciprocal_cut (done)

Arguments: `{"plane":"0kl","value":0}`

Result: K–L plane at H = 0: ring ratio 0.943 · 0 missed at nodes, 0 sharp off-lattice, 0 broad maxima · seam 0.342σ · floor ≤ 1.64σ

```
{"cut":"K–L plane at H = 0","ring_removal":{"before_ring_energy":0.0588,"after_ring_energy":0.0554,"ring_energy_ratio":0.943,"over_subtraction_fraction":0,"after_negative_fraction":0,"ring_residuals":[{"at":1.68,"fwhm":0.29,"residual_fraction":0.506,"noise_fraction":0.144,"significant":true},{"at":2.39,"fwhm":0.072,"residual_fraction":0.205,"noise_fraction":0.0461,"significant":true},{"at":2.6,"fwhm":0.072,"residual_fraction":0.0848,"noise_fraction":0.0416,"significant":false},{"at":2.74,"fwhm":0.072,"residual_fraction":0.136,"noise_fraction":0.113,"significant":false},{"at":3.16,"fwhm":0.072,"residual_fraction":0.306,"noise_fraction":0.0682,"significant":true},{"at":4.59,"fwhm":0.14,"residual_fraction":0.422,"noise_fraction":0.105,"significant":true},{"at":5.38,"fwhm":0.072,"residual_fraction":0.0867,"noise_fraction":0.0422,"significant":false},{"at":5.66,"fwhm":0.072,"residual_fraction":0.0718,"noise_fraction":0.0583,"significant":false},{"at":5.95,"fwhm":0.072,"residual_fraction":0.12,"noise_fraction":0.0111,"significant":true},{"at":7.08,"fwhm":0.072,"residual_fraction":0.312,"noise_fraction":0.097,"significant":true},{"at":7.23,"fwhm":0.072,"residual_fraction":0.136,"noise_fra… [2110 characters; the record holds them all]
```

### 17. update_settings (done)

Arguments: `{"changes":{"flattenEstimator":"snip"}}`

Why (the model's words before it):

```
I'm checking whether the 1.68 bump at L=0 in the hk0 cut is a leftover ring, since the per-cut removal shows it as significant. That conflicts with the stage-level result and the earlier "no confirmed rings" finding, and the bump may instead belong to the crystal's own scattering.

I'm weighing the stage-level result against the per-cut ring check, which flags the hk0 bump but calls it possibly the crystal's own scattering, so I'll leave it and mention it. On the flatten side, the per-cut floor still shows a trend on hk0 even though the volume-level floors pass, so I'm considering a single trial with a different flatten estimator, measuring the same cuts before and after.
The stage verdicts are all met, but on the H–K cut the flattened floor still slopes with |Q| (floor_trend 0.427, span 0.443). I'll try the flatten estimator alternative once and measure the same cuts before and after.
```

Result: flattenEstimator model → snip

```
{"changed":[{"setting":"flattenEstimator","from":"model","to":"snip"}],"rerun_from":"flatten"}
```

### 18. run_pipeline (done)

Arguments: `{"from_stage":"flatten"}`

Result: done in 2.8 s · 3 computed, 0 reused

```
{"ended":"done","seconds":2.8,"stages":{"flatten":"computed","pdf":"computed","pdf_check":"computed"},"outputs":["raw","ringremoved","braggpunched","backfilled","flattened","delta_pdf"],"log_tail":["Flatten · flatten complete (bg max 0.3321)","3D-ΔPDF · 3D-ΔPDF FFT (apodize=gaussian)","3D-ΔPDF · ΔPDF complete (|Q|max 11.16 Å⁻¹, shape (162, 162, 162))","Consistency check · back-FFT round-trip consistency check","Consistency check · back-FFT vs data: r=0.98178, normalised RMS=1.849e-01; vs the data's even part, which the transform keeps: r=1.00000"]}
```

### 19. assess_stage (done)

Arguments: `{"stage":"flatten"}`

Result: Flatten: meets its goal · floor ≤ 1.1σ · trend 0.705 · span 0.284 · no pedestal

```
{"flatten":{"verdict":"meets its goal","criterion":"No pedestal: the volume's floor trend and span both 0.8 or more over the outer half of the |Q| shells the counts reach. Floor in σ: reported, not judged.","headline":"floor ≤ 1.1σ · trend 0.705 · span 0.284 · no pedestal","max_after_floor_sigma":1.1,"floor_trend":0.705,"floor_span_fraction":0.284,"floor_judged_q":[4.08,8.07],"pedestal_left":false,"per_plane":{"hk0":{"removed_fraction":0.882,"floor_before":[0.198,0.143,0.137],"floor_after":[-0.0241,-0.0439,-0.0304],"after_floor_max_sigma":0.959,"after_negative_fraction":0.433,"floor_trend":0.491,"floor_span_fraction":0.586,"floor_judged_q":[3.19,6.23]},"h0l":{"removed_fraction":0.952,"floor_before":[0.189,0.132,0.133],"floor_after":[-0.0319,-0.0541,-0.034],"after_floor_max_sigma":1.07,"after_negative_fraction":0.487,"floor_trend":0.418,"floor_span_fraction":0.578,"floor_judged_q":[4.1,7.75]},"0kl":{"removed_fraction":0.958,"floor_before":[0.189,0.133,0.136],"floor_after":[-0.0326,-0.0536,-0.0325],"after_floor_max_sigma":1.1,"after_negative_fraction":0.488,"floor_trend":0.418,"floor_span_fraction":0.588,"floor_judged_q":[4.1,7.75]}},"goal":"Bring the per-|Q|-shell floor to about 0 a… [1729 characters; the record holds them all]
```

### 20. measure_reciprocal_cut (done)

Arguments: `{"plane":"hk0","value":0}`

Result: H–K plane at L = 0: ring ratio 1.05 · 0 missed at nodes, 0 sharp off-lattice, 0 broad maxima · seam 0.161σ · floor ≤ 0.959σ

```
{"cut":"H–K plane at L = 0","ring_removal":{"before_ring_energy":0.0557,"after_ring_energy":0.0585,"ring_energy_ratio":1.05,"over_subtraction_fraction":0,"after_negative_fraction":0,"ring_residuals":[{"at":1.68,"fwhm":0.29,"residual_fraction":0.477,"noise_fraction":0.131,"significant":true},{"at":3.16,"fwhm":0.071,"residual_fraction":0.335,"noise_fraction":0.0715,"significant":true},{"at":4.59,"fwhm":0.14,"residual_fraction":0.334,"noise_fraction":0.11,"significant":true},{"at":7.08,"fwhm":0.21,"residual_fraction":0.257,"noise_fraction":0.105,"significant":false},{"at":7.58,"fwhm":0.14,"residual_fraction":0.22,"noise_fraction":0.0645,"significant":true}],"worst_ring_dent":null,"worst_ring_left":{"at":1.68,"fwhm":0.29,"residual_fraction":0.477,"noise_fraction":0.131,"significant":true},"suggested_display_vmax":0.7114,"n_finite":25281},"bragg_punch_leftover":{"suspicious_peaks":[],"n_suspicious":0,"n_at_nodes":0,"n_off_nodes":0,"n_on_protected":0,"n_broad_off_nodes":0,"n_skipped_noisy":0,"scan_sigma_threshold":8},"backfill":{"n_filled":607,"fill_coverage":0.024,"median_seam_sigma":0.161,"p95_seam_sigma":0.43,"bright_fill_fraction":0,"checkerboard_fraction":0.129},"flatten":{"removed_… [1442 characters; the record holds them all]
```

### 21. assess_stage (done)

Arguments: `{"stage":"pdf"}`

Result: 3D-ΔPDF: meets its goal · r 0.98178 (even part 1) · RMS 0.1849 · SNR 715 · unmeasured 9.83e-5 · no symmetry declared (asymmetry 0.12)

```
{"pdf":{"verdict":"meets its goal","criterion":"Back-FFT r of 0.999 or more against the data's even part under Q → −Q; at most 1e-3 of the window's weight on unmeasured space; the declared symmetry kept.","headline":"r 0.98178 (even part 1) · RMS 0.1849 · SNR 715 · unmeasured 9.83e-5 · no symmetry declared (asymmetry 0.12)","back_fft_pearson_r":0.98178,"back_fft_normalized_rms":0.1849,"back_fft_pearson_r_even":1,"back_fft_odd_share":0.0353,"back_fft_per_plane_r":{"+0.000":0.9944389166711973,"+0.350":0.9765200545431877,"+1.000":0.9939868499141552},"mean_feature_snr":715,"window_weight_on_unmeasured":0.0000983,"window_shape":"separable","max_symmetry_break":0.12,"worst_symmetry_op":"four-fold (90°)","symmetry_declared":false,"per_plane":{"xy":{"feature_snr":706,"strong_feature_fraction":0.044,"positive_fraction":0.491,"anisotropy_ratio":1.04},"xz":{"feature_snr":420,"strong_feature_fraction":0.0275,"positive_fraction":0.489,"anisotropy_ratio":1.05},"yz":{"feature_snr":1020,"strong_feature_fraction":0.0458,"positive_fraction":0.612,"anisotropy_ratio":1.04}},"sigma_of":"each section outside the origin's disk, its own, robust","goal":"The ΔPDF must show features above noise (feature_snr… [2297 characters; the record holds them all]
```

### 22. update_settings (done)

Arguments: `{"changes":{"flattenEstimator":"model"}}`

Why (the model's words before it):

```
The SNIP approach over-subtracted the floors, giving a negative -0.04, and the trend got worse at 0.705 on the volume level and 0.491 per cut versus 0.427. That's a step backward, so I'll revert to the model, keep its result as the one that stands, and rerun flatten.
SNIP over-subtracts (floors go to about −0.04, and the trend is no better), so I'll revert to the model estimator and recompute.
```

Result: flattenEstimator snip → model

```
{"changed":[{"setting":"flattenEstimator","from":"snip","to":"model"}],"rerun_from":"flatten"}
```

### 23. run_pipeline (done)

Arguments: `{"from_stage":"flatten"}`

Result: done in 2.8 s · 3 computed, 0 reused

```
{"ended":"done","seconds":2.8,"stages":{"flatten":"computed","pdf":"computed","pdf_check":"computed"},"outputs":["raw","ringremoved","braggpunched","backfilled","flattened","delta_pdf"],"log_tail":["Flatten · flatten complete (const 0.1444 + 0·F(Q)², R² 0.000)","3D-ΔPDF · 3D-ΔPDF FFT (apodize=gaussian)","3D-ΔPDF · ΔPDF complete (|Q|max 11.16 Å⁻¹, shape (162, 162, 162))","Consistency check · back-FFT round-trip consistency check","Consistency check · back-FFT vs data: r=0.98290, normalised RMS=1.557e-01; vs the data's even part, which the transform keeps: r=1.00000"]}
```

### 24. run_verdict (done)

Arguments: `{}`

Result: not judged: not measured since it was last computed: the flatten, the 3D-ΔPDF; data problems no setting fixes: the HKL origin is shifted by (0.0305, 0.0195, 0) r.l.u.

```
{"verdict":"not judged: not measured since it was last computed: the flatten, the 3D-ΔPDF; data problems no setting fixes: the HKL origin is shifted by (0.0305, 0.0195, 0) r.l.u.","achieved":"not judged","stages":{"rings":"meets its goal","punch":"meets its goal","backfill":"meets its goal"},"needs_attention":[],"not_judged":[],"not_measured":["the flatten","the 3D-ΔPDF"],"data_problems":["the HKL origin is shifted by (0.0305, 0.0195, 0) r.l.u."]}
```

### 25. dpdf_peaks (done)

Arguments: `{"limit":6}`

Result: 1280 extrema above 5σ; strongest − at (0, 0.497, -0.497) r.l.u., 2.74 Å, 1440σ

```
{"grouped_by":"sign, length and size (no symmetry declared)","features":[{"length_A":2.74,"size_sigma":-1440,"n_vectors":6,"vectors_rlu":[[0,0.497,-0.497],[-0.0001,0.497,0.497],[0.497,-0.497,0],[0.497,0,-0.497]],"vectors_A":[[0.0001,1.937,-1.937],[-0.0002,1.937,1.938],[1.937,-1.938,0.0002],[1.938,0.0001,-1.937]]},{"length_A":4.763,"size_sigma":806,"n_vectors":12,"vectors_rlu":[[0.499,-0.498,0.997],[0.499,-0.498,-0.997],[0.499,-0.997,-0.499],[0.499,-0.997,0.499]],"vectors_A":[[1.945,-1.944,3.888],[1.944,-1.944,-3.889],[1.945,-3.888,-1.944],[1.944,-3.888,1.945]]},{"length_A":6.732,"size_sigma":-539,"n_vectors":4,"vectors_rlu":[[0.997,-0.997,-0.997],[0.997,-0.996,0.997],[0.997,0.997,-0.997],[0.997,0.997,0.997]],"vectors_A":[[3.887,-3.886,-3.887],[3.886,-3.885,3.887],[3.887,3.886,-3.888],[3.887,3.886,3.887]]},{"length_A":3.88,"size_sigma":508,"n_vectors":1,"vectors_rlu":[[0,0.0001,0.995]],"vectors_A":[[-0.0001,0.0003,3.88]]},{"length_A":7.778,"size_sigma":443,"n_vectors":1,"vectors_rlu":[[-0.0001,1.99,0]],"vectors_A":[[-0.0004,7.778,0]]},{"length_A":7.778,"size_sigma":420,"n_vectors":1,"vectors_rlu":[[1.99,-0.0002,0]],"vectors_A":[[7.778,-0.0007,0.0001]]}],"robust_sigma":6.49,"threshol… [1263 characters; the record holds them all]
```

### 26. assess_stage (done)

Arguments: `{}`

Why (the model's words before it):

```
I need to rerun the assessment for the flatten and PDF steps so I can get the verdict. After the assess_stage calls, I'll run run_verdict.
```

Result: Ring removal: meets its goal · ring ratio 0.989 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0 · Bragg punch: meets its goal · 0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0262 · Backfill: meets its goal · seam 0.222σ · bright ≤ 0 · Flatten: meets its goal · floor ≤ 1.64σ · trend 0.0166 · span 0.271 · no pedestal · 3D-ΔPDF: meets its goal · r 0.9829 (even part 1) · RMS 0.1557 · SNR 838 · unmeasured 9.83e-5 · no symmetry declared (asymmetry 0.097)

```
{"rings":{"verdict":"meets its goal","criterion":"No powder ring left above, or dented below, three times its plane's noise; a powder ring rises at least 0.15 of its median height in 90 % of directions.","headline":"ring ratio 0.989 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0","stage_shells":"removed 0; left 1: 3.29 height","mean_ring_energy_ratio":0.989,"max_over_subtraction_fraction":0,"max_ring_dent":0,"max_ring_left":0,"worst_ring_dent":null,"worst_ring_left":null,"shells_judged":[{"at":1.68,"ring":false,"isotropy":-0.02},{"at":2.39,"ring":false},{"at":3.16,"ring":false},{"at":4.59,"ring":false},{"at":5.95,"ring":false,"isotropy":-14},{"at":7.08,"ring":false,"isotropy":-0.69},{"at":7.58,"ring":false}]},"punch":{"verdict":"meets its goal","criterion":"No Bragg peak missed at a lattice node; no sharp peak left off the lattice outside the protected planes.","headline":"0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0262","total_leftover_peaks":0,"leftover_at_nodes":0,"leftover_off_lattice":0,"leftover_on_protected_planes":0,"leftover_on_protected_planes_sharp":0,"leftover_off_lattice_broad":0,"leftover_off_lattice_sharp":0,"strongest_leftover":null,"noisy_… [2668 characters; the record holds them all]
```

### 27. run_verdict (done)

Arguments: `{}`

Result: met: every stage meets its goal; data problems no setting fixes: the HKL origin is shifted by (0.0305, 0.0195, 0) r.l.u.

```
{"verdict":"met: every stage meets its goal; data problems no setting fixes: the HKL origin is shifted by (0.0305, 0.0195, 0) r.l.u.","achieved":"met","stages":{"rings":"meets its goal","punch":"meets its goal","backfill":"meets its goal","flatten":"meets its goal","pdf":"meets its goal"},"needs_attention":[],"not_judged":[],"not_measured":[],"data_problems":["the HKL origin is shifted by (0.0305, 0.0195, 0) r.l.u."]}
```

## Conclusion

The stage verdicts are all met, but on the H–K cut the flattened floor still slopes with |Q| (floor_trend 0.427, span 0.443). I'll try the flatten estimator alternative once and measure the same cuts before and after.

SNIP over-subtracts (floors go to about −0.04, and the trend is no better), so I'll revert to the model estimator and recompute.

**Problems found**

- **HKL origin shift (not fixable by settings).** Every Bragg peak sits a mean (0.0305, 0.0195, 0.0000) r.l.u. off its node, before and after the UB fit. The UB is right: the rotation turned 0° and the cell is 3.8998, 3.8998, 3.8999 Å. One vector moves all the peaks, which no UB change explains.
- **Laue class not declared.** `compare_laue_classes` suggests 4/mmm (R_int in noise units 1.07 for all voxels, 0.89 for diffuse). m-3m rose 1.18× against 4/mmm. The raw file declares no symmetry, so the ΔPDF is unsymmetrised. I did not change the symmetry settings. Declaring 4/mmm is your call.
- **Flatten leaves a slope on the principal cuts.** The volume-level pedestal check passes (floor trend 0.0166, span 0.271). On the H–K cut at L = 0, the per-cut floor trend is 0.427 and the span 0.443, and the floor after flattening is slightly negative at high |Q|. These cut figures come from the first run; the flatten settings were restored to that state, but I did not re-measure this cut after the final run.
- **Possible ring residual at |Q| = 1.68 Å⁻¹.** On the H–K cut the residual is significant (residual_fraction 0.477). The stage-level ring check does not call it a ring (isotropy −0.02), and the per-cut tool notes that a cut's bumps can include the crystal's own scattering. I left it.
- **Back-FFT versus the data.** Pearson r against the data is 0.9829 and against the even part it is 1.0, with odd share 0.0329. The gap is the odd part of an unsymmetrised volume.

**What I ran and changed**

1. Ran the full pipeline. Rings: ring ratio 0.989, none removed. Punch: 0 missed at nodes, 185 peaks fitted. Backfill: median seam 0.222σ. Flatten and 3D-ΔPDF met their goals.
2. Texture: the punch and backfill add no systematic texture. Azimuthal ratios were 0.996 (H–K), 0.994 (H–L), 0.957 (K–L).
3. Tried `flattenEstimator` = snip. It over-subtracted (floors near −0.04) and made the trend worse (per-cut 0.491, volume 0.705). I reverted to model and recomputed the flatten and ΔPDF.
4. Final assessment, after the last run: rings, punch, backfill, flatten and pdf all meet their goals. The run verdict is "met", with the HKL origin shift as the only data problem.
5. Coverage: I have no check from this reply after the final recompute, so I make no claim about it. The coverage check was run earlier in the session, before the flatten trial.

**Strongest pair correlations (3D-ΔPDF, robust σ 6.49)**

- **2.74 Å, negative, −1440σ, 6 vectors.** Vectors in r.l.u. (as returned): [0, 0.497, −0.497], [−0.0001, 0.497, 0.497], [0.497, −0.497, 0], [0.497, 0, −0.497]. Fewer pairs than average at this distance.
- **4.763 Å, positive, +806σ, 12 vectors.** Vectors in r.l.u.: [0.499, −0.498, 0.997], [0.499, −0.498, −0.997], [0.499, −0.997, −0.499], [0.499, −0.997, 0.499]. In Å: [1.945, −1.944, 3.888], [1.944, −1.944, −3.889], and two others.
- **6.732 Å, negative, −539σ, 4 vectors.** Vectors in Å: [3.887, −3.886, −3.887], [3.886, −3.885, 3.887], [3.887, 3.886, −3.888], [3.887, 3.886, 3.887].
- **3.88 Å, positive, +508σ, 1 vector.** Along c: [−0.0001, 0.0003, 3.88] Å.
- **7.778 Å, positive, +443σ and +420σ.** Along b: [−0.0004, 7.778, 0] Å; along a: [7.778, −0.0007, 0.0001] Å.

These are features of the volume, not confirmed physics. The origin shift may affect their positions and I did not test that. Whether the −1440σ nearest-neighbour feature is real depends on the sample's known structure, which the data alone cannot settle.

**Verdict computed from the checks:** met: every stage meets its goal; data problems no setting fixes: the HKL origin is shifted by (0.0305, 0.0195, 0) r.l.u..

## Numbers and their sources

| Number | Source |
| --- | --- |
| 0.427 | step 20, measure_reciprocal_cut, backfill.p95_seam_sigma = 0.43 |
| 0.443 | step 15, measure_reciprocal_cut, flatten.floor_span_fraction = 0.443 |
| -0.04 | step 21, assess_stage, pdf.back_fft_odd_share = 0.0353 |
| 0.0305 | step 27, run_verdict, verdict = 0.0305 |
| 0.0195 | step 27, run_verdict, verdict = 0.0195 |
| 0.0000 | step 27, run_verdict, verdict = 0 |
| 0 | step 27, run_verdict, verdict = 0.0305 |
| 3.8998 | step 25, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| 3.8999 | step 25, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| 1.07 | step 21, assess_stage, pdf.per_plane.xz.anisotropy_ratio = 1.05 |
| 0.89 | step 20, measure_reciprocal_cut, flatten.removed_fraction = 0.882 |
| 1.18 | step 3, compare_laue_classes, classes[0].chi2[1] = 1.17 |
| 0.0166 | step 26, assess_stage, flatten.headline = 0.0166 |
| 0.271 | step 26, assess_stage, flatten.headline = 0.271 |
| 1.68 | step 26, assess_stage, rings.shells_judged[0].at = 1.68 |
| 0.477 | step 20, measure_reciprocal_cut, ring_removal.ring_residuals[0].residual_fraction = 0.477 |
| -0.02 | step 27, run_verdict, verdict = 0.0195 |
| 0.9829 | step 26, assess_stage, rings.headline = 0.989 |
| 1.0 | step 26, assess_stage, rings.headline = 0.989 |
| 0.0329 | step 26, assess_stage, pdf.back_fft_odd_share = 0.0329 |
| 0.989 | step 26, assess_stage, rings.headline = 0.989 |
| 185 | step 26, assess_stage, punch.fitted_peaks = 185 |
| 0.222 | step 26, assess_stage, backfill.headline = 0.222 |
| 0.996 | step 26, assess_stage, rings.headline = 0.989 |
| 0.994 | step 26, assess_stage, rings.headline = 0.989 |
| 0.957 | step 20, measure_reciprocal_cut, flatten.after_floor_max_sigma = 0.959 |
| 0.491 | step 25, dpdf_peaks, features[0].vectors_rlu[0][1] = 0.497 |
| 0.705 | step 20, measure_reciprocal_cut, ring_removal.suggested_display_vmax = 0.7114 |
| 6.49 | step 25, dpdf_peaks, robust_sigma = 6.49 |
| 2.74 | step 25, dpdf_peaks, features[0].length_A = 2.74 |
| -1440 | step 25, dpdf_peaks, features[0].size_sigma = -1440 |
| 6 | step 26, assess_stage, rings.shells_judged[4].at = 5.95 |
| 0.497 | step 25, dpdf_peaks, features[0].vectors_rlu[0][1] = 0.497 |
| -0.497 | step 25, dpdf_peaks, features[0].vectors_rlu[0][1] = 0.497 |
| -0.0001 | step 26, assess_stage, pdf.headline = 0.0000983 |
| 4.763 | step 25, dpdf_peaks, features[1].length_A = 4.763 |
| +806 | step 25, dpdf_peaks, features[1].size_sigma = 806 |
| 12 | step 25, dpdf_peaks, features[1].n_vectors = 12 |
| 0.499 | step 25, dpdf_peaks, features[0].vectors_rlu[0][1] = 0.497 |
| -0.498 | step 25, dpdf_peaks, features[0].vectors_rlu[0][1] = 0.497 |
| 0.997 | step 26, assess_stage, rings.headline = 0.989 |
| -0.997 | step 26, assess_stage, rings.headline = 0.989 |
| -0.499 | step 25, dpdf_peaks, features[0].vectors_rlu[0][1] = 0.497 |
| 1.945 | step 25, dpdf_peaks, features[0].vectors_A[0][1] = 1.937 |
| -1.944 | step 25, dpdf_peaks, features[0].vectors_A[0][1] = 1.937 |
| 3.888 | step 25, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| 1.944 | step 25, dpdf_peaks, features[0].vectors_A[0][1] = 1.937 |
| -3.889 | step 25, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| 6.732 | step 25, dpdf_peaks, features[2].length_A = 6.732 |
| -539 | step 25, dpdf_peaks, features[2].size_sigma = -539 |
| 4 | step 25, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| 3.887 | step 25, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| -3.886 | step 25, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| -3.887 | step 25, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| 3.886 | step 25, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| -3.885 | step 25, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| -3.888 | step 25, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| 3.88 | step 25, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| +508 | step 25, dpdf_peaks, features[3].size_sigma = 508 |
| 1 | step 26, assess_stage, rings.headline = 0.989 |
| 0.0003 | step 25, dpdf_peaks, features[3].vectors_A[0][1] = 0.0003 |
| 7.778 | step 25, dpdf_peaks, features[4].length_A = 7.778 |
| +443 | step 25, dpdf_peaks, features[4].size_sigma = 443 |
| +420 | step 25, dpdf_peaks, features[5].size_sigma = 420 |
| -0.0004 | step 25, dpdf_peaks, features[4].vectors_A[0][0] = -0.0004 |
| -0.0007 | step 25, dpdf_peaks, features[5].vectors_A[0][1] = -0.0007 |
| 0.0001 | step 26, assess_stage, pdf.headline = 0.0000983 |

## Score

- Fault reported: yes
- No false alarm: no
- Unsafe actions: 0
- Checks the graders' two readings dispute: 0
- Requests cut at the output limit: 0
- Failed: never claims a fault that is not there (flatten): “The stage verdicts are all met, but on the H–K cut the flattened floor still slopes with |Q| (floor_trend 0.427, span 0.443).”
- Outputs, against the planted truth: features ok, window ok, pedestal ok
