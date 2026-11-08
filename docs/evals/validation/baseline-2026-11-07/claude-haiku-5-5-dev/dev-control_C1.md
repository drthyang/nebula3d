# dev-control, arm C, run 1

Model: Claude Haiku 5.5 (Anthropic) (Anthropic). Started 2026-11-07T22:49:42.368Z; 70 s, 77224 tokens in and 7864 out over 5 requests, $0.0073. The model saw the dataset as va21fc1-C1.

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
I'm going to describe the dataset first, then run the pipeline, keeping things quick.
```

Result: va21fc1_C1: raw

```
{"dataset":"va21fc1_C1","id":"va21fc1-C1","stages":["raw"],"reciprocal":{"grid":[161,161,161],"H":[-4,4],"K":[-4,4],"L":[-4,4],"planes":["hk0","h0l","0kl"]},"cell":{"a":3.9,"b":3.9,"c":3.9,"alpha":90,"beta":90,"gamma":90},"sigma":"measured","delta_pdf":null,"other_datasets":[]}
```

### 2. configure_settings (done)

Arguments: `{}`

Result: 0 settings off their defaults, 61 at them

```
{"settings":{},"at_default":61}
```

### 3. run_pipeline (done)

Arguments: `{}`

Result: done in 9.4 s · 6 computed, 0 reused

```
{"ended":"done","seconds":9.4,"stages":{"rings":"computed","punch":"computed","backfill":"computed","flatten":"computed","pdf":"computed","pdf_check":"computed"},"outputs":["raw","ringremoved","braggpunched","backfilled","flattened","delta_pdf"],"log_tail":["Flatten · flatten complete (const 0.1437 + 0·F(Q)², R² 0.000)","3D-ΔPDF · 3D-ΔPDF FFT (apodize=gaussian)","3D-ΔPDF · ΔPDF complete (|Q|max 11.16 Å⁻¹, shape (162, 162, 162))","Consistency check · back-FFT round-trip consistency check","Consistency check · back-FFT vs data: r=0.98901, normalised RMS=1.253e-01; vs the data's even part, which the transform keeps: r=1.00000"]}
```

### 4. assess_stage (done)

Arguments: `{}`

Result: Ring removal: meets its goal · ring ratio 1 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0 · Bragg punch: meets its goal · 0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0266 · Backfill: meets its goal · seam 0.248σ · bright ≤ 0 · Flatten: meets its goal · floor ≤ 1.72σ · trend 0.0384 · span 0.636 · no pedestal · 3D-ΔPDF: meets its goal · r 0.98901 (even part 1) · RMS 0.1253 · SNR 1380 · no symmetry declared (asymmetry 0.036)

```
{"rings":{"verdict":"meets its goal","criterion":"No powder ring left above, or dented below, three times its plane's noise. A bump is a powder ring only if it rises in nearly every direction over the sphere (at least 0.15 of its median height in 90 % of directions).","headline":"ring ratio 1 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0","stage_shells":"removed 0; left 1: 1.72 isotropy","mean_ring_energy_ratio":1,"max_over_subtraction_fraction":0,"max_ring_dent":0,"max_ring_left":0,"worst_ring_dent":null,"worst_ring_left":null,"shells_judged":[{"at":1.68,"ring":false,"isotropy":0.013},{"at":2.39,"ring":false},{"at":2.6,"ring":false},{"at":3.16,"ring":false},{"at":4.59,"ring":false,"isotropy":-12},{"at":7.08,"ring":false,"isotropy":-0.43},{"at":7.58,"ring":false}]},"punch":{"verdict":"meets its goal","criterion":"No Bragg peak missed at a lattice node, and no sharp peak left off the lattice outside the protected planes. Broad maxima stay.","headline":"0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0266","total_leftover_peaks":0,"leftover_at_nodes":0,"leftover_off_lattice":0,"leftover_on_protected_planes":0,"leftover_on_protected_planes_sharp":0,"leftover_off_… [3000 characters; the record holds them all]
```

### 5. run_verdict (done)

Arguments: `{}`

Result: met: every stage meets its goal

```
{"verdict":"met: every stage meets its goal","achieved":"met","stages":{"rings":"meets its goal","punch":"meets its goal","backfill":"meets its goal","flatten":"meets its goal","pdf":"meets its goal"},"needs_attention":[],"not_judged":[],"not_measured":[],"data_problems":[]}
```

### 6. ub_check (done)

Arguments: `{}`

Result: both: RMS 0.0004 → 0.0004 Å⁻¹ over 90 peaks; a 3.900 → 3.900 Å, c 3.900 → 3.900 Å; turned 0.000°

```
{"verdict":"the UB is right: turned 0°, under the 0.05° that counts as turned","fit":"both","bragg_nodes_every":[1,1,1],"symmetry_from":null,"symmetrised":null,"symmetry_break":null,"peaks":{"searched":342,"used":90,"rejected":0},"rms_start":0.0004,"rms":0.0004,"cell_start":"3.9000, 3.9000, 3.9000 Å; 90.000°, 90.000°, 90.000°","cell":"3.8998, 3.8999, 3.8999 Å; 90.000°, 90.000°, 90.000°","orientation_change_deg":0,"axis_uvw":[-0.379,0.913,1],"transform_diagonal":[1.00004,1.000036,1.000016],"passes":[{"q_max":3.72,"found":14,"used":14,"rms":"0.0003 → 0.0003"},{"q_max":7.44,"found":82,"used":82,"rms":"0.0004 → 0.0004"},{"q_max":11.16,"found":90,"used":90,"rms":"0.0004 → 0.0004"}],"radial":[{"q":"0–4","direction":"in-plane","n":4,"before":0.000045,"after":0.0000071},{"q":"0–4","direction":"oblique","n":8,"before":-0.000078,"after":-0.00011},{"q":"4–8","direction":"in-plane","n":4,"before":0.000053,"after":0.000015},{"q":"4–8","direction":"oblique","n":56,"before":0.000049,"after":0.000018},{"q":"4–8","direction":"near the third axis","n":8,"before":0.000032,"after":0.000012},{"q":"8–12","direction":"oblique","n":8,"before":0.000029,"after":-0.0000028}],"unexplained":false,"mean_offset_… [1435 characters; the record holds them all]
```

### 7. qmax_coverage (done)

Arguments: `{}`

Result: the transform reaches 6.444 Å⁻¹ (the window tapers to zero at the box faces), inside full coverage at 11.05 Å⁻¹

```
{"verdict":"the transform reaches 6.444 Å⁻¹ (the window tapers to zero at the box faces), inside full coverage at 11.05 Å⁻¹","window_weight_on_unmeasured":null,"window_shape":"separable","window_scale":1,"transform_reach_q":6.444,"reach_from":"the window tapers to zero at the box faces","full_coverage_q":11.05,"box_face_q":6.444,"box_corner_q":11.16,"raw_counts":{"q_min_edge":null,"q_max_edge":null,"fully_measured":[0.15,11.05],"box_face_q":6.444},"suggested_band":null,"counts_end_inside_box":false,"band_check":"no |Q| band is set: the transform takes every voxel, empty ones included, up to the window's reach","q_unit":"Å⁻¹","settings":{"pdfQMin":"(default)","pdfQMax":"(default)","pdfApod":"(default)","pdfWindowShape":"(default)","pdfWindowSupport":true}}
```

### 8. compare_laue_classes (done)

Arguments: `{}`

Result: suggests 4/mmm

```
{"columns":"r_int, x_noise, chi2: [all voxels, diffuse]; x_noise = R_int / noise floor, chi2 = χ²/dof (1: within counting noise)","classes":[{"class":"-1","ops":2,"r_int":[0.052,0.053],"x_noise":[1,1],"chi2":[1,1],"orbits":2086640,"verdict":"supported"},{"class":"2/m (b unique)","ops":4,"contains":["-1"],"r_int":[0.063,0.065],"x_noise":[1,1],"chi2":[1,1],"orbits":1049840,"verdict":"supported"},{"class":"2/m (c unique)","ops":4,"contains":["-1"],"r_int":[0.063,0.065],"x_noise":[1,1],"chi2":[1,1],"orbits":1049840,"verdict":"supported"},{"class":"mmm","ops":8,"contains":["2/m (b unique)","2/m (c unique)"],"r_int":[0.069,0.07],"x_noise":[1,1],"chi2":[1,1],"orbits":531440,"verdict":"supported"},{"class":"4/m","ops":8,"contains":["2/m (c unique)"],"r_int":[0.069,0.071],"x_noise":[1,1],"chi2":[1,1],"orbits":524960,"verdict":"supported"},{"class":"4/mmm","ops":16,"contains":["mmm","4/m"],"r_int":[0.071,0.073],"x_noise":[1,1],"chi2":[1,1],"orbits":269000,"verdict":"supported"},{"class":"m-3","ops":24,"contains":["mmm"],"r_int":[0.085,0.088],"x_noise":[1.19,1.19],"chi2":[1.47,1.48],"orbits":177200,"verdict":"rose 1.19× against 2/m (b unique)"},{"class":"m-3m","ops":48,"contains":["4/mmm","m-… [2298 characters; the record holds them all]
```

### 9. grain_check (done)

Arguments: `{}`

Result: no off-lattice peaks were recorded by the punch's search

```
{"off_lattice_orbits":0,"judged":0,"near_bragg_nodes":0,"near_offset_angle_deg":null,"far":[],"rotated_copy":{"indexed":0,"misorientation_deg":null},"random_control":0,"verdict":"no off-lattice peaks were recorded by the punch's search","off_lattice_peaks":0,"declared_symmetry":null,"punch_cell":[1,1,1]}
```

### 10. symmetry_check (done)

Arguments: `{}`

Result: no symmetry declared: not judged

```
{"sections":"xy at z = 0 Å, xz at y = 0, yz at x = 0","operations":"the cell's in-plane ones (orthogonal): no operations declared","ops":[{"op":"four-fold ∥ c (90°)","rms_difference":0.039,"pairs":78083,"tested_on":"xy; xz↔yz"},{"op":"two-fold ∥ c","rms_difference":0.038,"pairs":51520,"tested_on":"xz; yz"},{"op":"mirror ⊥ a","rms_difference":0.038,"pairs":51520,"tested_on":"xy; xz"},{"op":"mirror ⊥ b","rms_difference":0.038,"pairs":51520,"tested_on":"xy; yz"}],"holds":[],"symmetry_declared":false,"verdict":"not judged: the file declares no symmetry"}
```

### 11. texture_check (done)

Arguments: `{}`

Why (the model's words before it):

```
Everything looks clean so far. I'm checking the cuts and the ΔPDF peaks, and the flatten settings (const 0.1437, R² 0.000) look fine. Next up is texture and the Laue class suggestion of 4/mmm, but the file declares no symmetry, and changing that is the user's call, so I'm only reporting it.

I'm checking whether the ΔPDF is 4-fold symmetric: the 4-fold check gives a 0.039 rms difference, which I read as noise since no symmetry is declared, so I won't symmetrize. The Laue 4/mmm suggestion has R_int 0.071 against 0.052 for -1, so it's not decisive, and I'll report it to the user. Next I'll measure texture, the cuts, the ΔPDF peaks, and the ΔPDF cut.
```

Result: no systematic fill bias over 189 holes in 3-D · azimuthal ratio 0.958–1.01

```
{"n_holes":189,"n_judged":189,"median_fill_bias_sigma":0.0109,"median_fill_bias_level":0.00281,"above_fraction":0.503,"below_fraction":0.00529,"above_floor_fraction":0.0423,"below_floor_fraction":0,"systematic_fill_bias":false,"criterion":"systematic_fill_bias: 5 judged holes or more, 75 % of them past their range one way, with a median of 0.5σ and 0.2 of the local level or more.","per_cut":[{"cut":"H–K plane at L = 0","azimuthal_ratio":1.01},{"cut":"H–L plane at K = 0","azimuthal_ratio":1},{"cut":"K–L plane at H = 0","azimuthal_ratio":0.958}]}
```

### 12. measure_reciprocal_cut (done)

Arguments: `{"plane":"hk0","value":0}`

Result: H–K plane at L = 0: ring ratio 1 · 0 missed at nodes, 0 sharp off-lattice, 0 broad maxima · seam 0.189σ · floor ≤ 1.59σ

```
{"cut":"H–K plane at L = 0","ring_removal":{"before_ring_energy":0.0652,"after_ring_energy":0.0652,"ring_energy_ratio":1,"over_subtraction_fraction":0,"after_negative_fraction":0,"ring_residuals":[{"at":1.68,"fwhm":0.22,"residual_fraction":0.479,"noise_fraction":0.136,"significant":true},{"at":3.16,"fwhm":0.072,"residual_fraction":0.302,"noise_fraction":0.0984,"significant":true},{"at":4.59,"fwhm":0.14,"residual_fraction":0.368,"noise_fraction":0.109,"significant":true},{"at":7.08,"fwhm":0.072,"residual_fraction":0.419,"noise_fraction":0.134,"significant":true},{"at":7.58,"fwhm":0.072,"residual_fraction":0.201,"noise_fraction":0.0756,"significant":false}],"worst_ring_dent":null,"worst_ring_left":{"at":1.68,"fwhm":0.22,"residual_fraction":0.479,"noise_fraction":0.136,"significant":true},"suggested_display_vmax":0.7271,"n_finite":25921},"bragg_punch_leftover":{"suspicious_peaks":[],"n_suspicious":0,"n_at_nodes":0,"n_off_nodes":0,"n_on_protected":0,"n_broad_off_nodes":0,"n_skipped_noisy":0,"scan_sigma_threshold":8},"backfill":{"n_filled":601,"fill_coverage":0.0232,"median_seam_sigma":0.189,"p95_seam_sigma":0.749,"bright_fill_fraction":0,"checkerboard_fraction":0.134},"flatten":{"remov… [2604 characters; the record holds them all]
```

### 13. measure_reciprocal_cut (done)

Arguments: `{"plane":"h0l","value":0}`

Result: H–L plane at K = 0: ring ratio 1 · 0 missed at nodes, 0 sharp off-lattice, 0 broad maxima · seam 0.197σ · floor ≤ 1.71σ

```
{"cut":"H–L plane at K = 0","ring_removal":{"before_ring_energy":0.0657,"after_ring_energy":0.0657,"ring_energy_ratio":1,"over_subtraction_fraction":0,"after_negative_fraction":0,"ring_residuals":[{"at":1.68,"fwhm":0.22,"residual_fraction":0.519,"noise_fraction":0.132,"significant":true},{"at":2.39,"fwhm":0.072,"residual_fraction":0.227,"noise_fraction":0.0421,"significant":true},{"at":2.6,"fwhm":0.072,"residual_fraction":0.0607,"noise_fraction":0.0511,"significant":false},{"at":2.74,"fwhm":0.072,"residual_fraction":0.122,"noise_fraction":0.113,"significant":false},{"at":3.16,"fwhm":0.072,"residual_fraction":0.337,"noise_fraction":0.0676,"significant":true},{"at":4.59,"fwhm":0.14,"residual_fraction":0.426,"noise_fraction":0.0988,"significant":true},{"at":5.38,"fwhm":0.072,"residual_fraction":0.112,"noise_fraction":0.0396,"significant":false},{"at":5.66,"fwhm":0.072,"residual_fraction":0.0571,"noise_fraction":0.036,"significant":false},{"at":7.08,"fwhm":0.22,"residual_fraction":0.431,"noise_fraction":0.122,"significant":true},{"at":7.58,"fwhm":0.072,"residual_fraction":0.128,"noise_fraction":0.0588,"significant":false}],"worst_ring_dent":null,"worst_ring_left":{"at":1.68,"fwhm":0.22… [1915 characters; the record holds them all]
```

### 14. radial_profile (done)

Arguments: `{"plane":"hk0","value":0,"bins":16}`

Result: H–K plane at L = 0: 16 shells × 5 stages

```
{"cut":"H–K plane at L = 0","q_unit":"|Q| in Å⁻¹","stat":"median per shell","shells":{"cols":["q","raw","ringremoved","braggpunched","backfilled","flattened"],"rows":[[0.375,0.187,0.187,0.182,0.18,0.0365],[0.882,0.193,0.193,0.193,0.193,0.0497],[1.44,0.318,0.318,0.318,0.318,0.175],[2.01,0.373,0.373,0.373,0.373,0.229],[2.57,0.306,0.306,0.306,0.306,0.162],[3.14,0.214,0.214,0.201,0.184,0.0405],[3.71,0.144,0.144,0.144,0.144,0.000174],[4.28,0.195,0.195,0.191,0.195,0.0511],[4.85,0.273,0.273,0.27,0.27,0.126],[5.41,0.239,0.239,0.239,0.239,0.0958],[5.98,0.21,0.21,0.21,0.208,0.0642],[6.52,0.15,0.15,0.146,0.15,0.00587],[7.09,0.251,0.251,0.236,0.226,0.0828],[7.66,0.194,0.194,0.194,0.194,0.0506],[8.22,0.115,0.115,0.115,0.115,-0.0288],[8.74,0.161,0.161,0.134,0.154,0.0103]]}}
```

### 15. dpdf_peaks (done)

Arguments: `{"limit":12}`

Result: 619 extrema above 5σ; strongest − at (0.497, 0.497, 0) r.l.u., 2.74 Å, 1520σ

```
{"grouped_by":"sign, length and size (no symmetry declared)","features":[{"length_A":2.74,"size_sigma":-1520,"n_vectors":6,"vectors_rlu":[[0.497,0.497,0],[0,0.497,-0.497],[-0.0001,0.497,0.497],[0.497,0,-0.497]],"vectors_A":[[1.938,1.937,-0.0001],[0.0001,1.937,-1.937],[-0.0003,1.938,1.938],[1.938,0.0002,-1.937]]},{"length_A":4.763,"size_sigma":858,"n_vectors":12,"vectors_rlu":[[0.499,-0.498,0.997],[0.499,0.499,-0.997],[0.499,0.499,0.997],[0.997,-0.498,-0.498]],"vectors_A":[[1.945,-1.944,3.888],[1.945,1.945,-3.888],[1.944,1.944,3.889],[3.888,-1.944,-1.944]]},{"length_A":6.732,"size_sigma":-579,"n_vectors":4,"vectors_rlu":[[0.997,0.997,-0.997],[0.997,0.997,0.997],[0.997,-0.997,-0.997],[0.996,-0.996,0.997]],"vectors_A":[[3.887,3.886,-3.888],[3.887,3.887,3.887],[3.886,-3.886,-3.886],[3.886,-3.885,3.887]]},{"length_A":3.88,"size_sigma":540,"n_vectors":1,"vectors_rlu":[[0,0.0001,0.995]],"vectors_A":[[0,0.0003,3.88]]},{"length_A":7.779,"size_sigma":506,"n_vectors":2,"vectors_rlu":[[1.99,-0.0001,0],[0,1.99,0]],"vectors_A":[[7.779,-0.0003,0],[-0.0001,7.778,0]]},{"length_A":7.779,"size_sigma":245,"n_vectors":1,"vectors_rlu":[[-0.0003,0.0004,1.99]],"vectors_A":[[-0.0011,0.0015,7.779]]},{"lengt… [2612 characters; the record holds them all]
```

### 16. consistency_details (done)

Arguments: `{}`

Result: r = 0.989, normalised RMS = 0.1253; against the even part r = 1 (odd share 0.02185)

```
{"pearson_r":0.989,"normalized_rms":0.1253,"rms":0.013583852092373403,"n_voxels":3617683,"per_plane_r":{"+0.000":0.9938,"+0.350":0.9873,"+1.000":0.9941},"pearson_r_even":1,"normalized_rms_even":1.135e-14,"odd_share":0.02185,"n_voxels_even":3617683,"crop_hkl":null,"q_band":null,"apodization":"gaussian"}
```

## Conclusion

**Result:** The run meets every stage goal. `run_verdict` reports `achieved: met`, with no data problems and nothing unmeasured. I changed no settings.

**Stage checks**
- **Rings:** The ring removal meets its goal. The ring energy ratio is 1 and over-subtraction is 0 on all judged shells.
- **Bragg punch:** No peaks were missed at nodes and none are left off-lattice. The punch removed 2.66% of the volume (fraction 0.0266), across 188 fitted peaks.
- **Backfill:** The median seam is 0.248σ and no fill is bright. `texture_check` finds no systematic fill bias. The azimuthal ratios are 1.01 (H–K), 1.00 (H–L) and 0.958 (K–L), so the fills add no texture.
- **Flatten:** No pedestal. The largest floor is 1.72σ, the floor trend is 0.0384 and the span is 0.636. Both are under the 0.8 threshold.
- **3D-ΔPDF and back-FFT:** The back-FFT matches the data's even part with r = 1.0. Against the full data, r = 0.98901 and the normalised RMS is 0.1253. The gap is the odd share, 0.0219, which the transform does not keep by design. The transform reaches 6.444 Å⁻¹, inside full coverage at 11.05 Å⁻¹. The window weight on unmeasured space is null (none), and the counts do not end inside the box.

**Data checks**
- **Orientation and cell:** The UB is right. The rotation is 0° and the RMS is 0.0004. The fitted cell is 3.8998, 3.8999, 3.8999 Å at 90°, against the declared 3.9 Å.
- **Grains:** No second grain and no off-lattice peaks.
- **Symmetry:** None is declared. The largest symmetry break among the four operations tested is 0.036, and the check reports no verdict because the file declares no symmetry.
- **Laue class:** `compare_laue_classes` suggests 4/mmm. R_int is 0.052 for −1 and 0.071 for 4/mmm, against 0.378 with no symmetry. m-3m rises 1.18× over 2/m, so it is ruled out. The class is your call, so I did not declare one.

**Problems the settings cannot fix**
- **A bump at |Q| ≈ 1.68 Å⁻¹.** It survives on the H–K cut at 0.479 of the diffuse level (noise 0.136) and on the H–L cut at 0.519 (noise 0.132). The ring stage does not treat it as a powder ring, with isotropy 0.013, so it is probably the crystal's own scattering. A single cut cannot rule out a ring, so please check this shell against what you know of the sample.
- **Friedel-odd content** of about 2% (odd share 0.0219), which the even-part check cannot see.

**Strongest pair correlations** (`dpdf_peaks`, robust σ 6.17, threshold 5σ; a negative size means fewer pairs than average, a positive size more)
1. **2.74 Å**, 6 vectors of type ½⟨110⟩, e.g. [0.497, 0.497, 0] r.l.u. = [1.938, 1.937, 0] Å. Size −1520σ, **negative**. This is close to a/√2 ≈ 2.76 Å.
2. **4.763 Å**, 12 vectors of type ½⟨112⟩, e.g. [0.499, 0.499, 0.997] r.l.u. = [1.944, 1.944, 3.889] Å. Size +858σ, **positive**.
3. **6.732 Å**, 4 vectors of type ⟨111⟩, e.g. [0.997, 0.997, 0.997] r.l.u. = [3.887, 3.887, 3.887] Å. Size −579σ, **negative**.
4. **3.88 Å**, 1 vector along c, [0, 0, 1] r.l.u. = [0, 0, 3.88] Å. Size +540σ, **positive**.
5. **7.779 Å**, 2 vectors along a and b, [2, 0, 0] and [0, 2, 0] r.l.u. Size +506σ, **positive**.

These are single-sided readings, since the ΔPDF is not symmetrised. The strongest feature is a negative pair correlation at a/√2. I cannot say from the ΔPDF alone what causes it.

**Verdict computed from the checks:** met: every stage meets its goal.

Note: Not found in any tool result or the context: 110, 112, 111.

## Numbers and their sources

| Number | Source |
| --- | --- |
| 1 | step 16, consistency_details, pearson_r = 0.989 |
| 0 | step 16, consistency_details, normalized_rms = 0.1253 |
| 2.66% | step 16, consistency_details, odd_share = 0.02185 |
| 0.0266 | step 4, assess_stage, punch.headline = 0.0266 |
| 188 | step 11, texture_check, n_holes = 189 |
| 0.248 | step 14, radial_profile, shells.rows[12][1] = 0.251 |
| 1.01 | step 16, consistency_details, per_plane_r.+0.000 = 0.9938 |
| 1.00 | step 16, consistency_details, pearson_r = 0.989 |
| 0.958 | step 11, texture_check, per_cut[2].azimuthal_ratio = 0.958 |
| 1.72 | step 13, measure_reciprocal_cut, flatten.after_floor_max_sigma = 1.71 |
| 0.0384 | step 10, symmetry_check, ops[0].rms_difference = 0.039 |
| 0.636 | step 4, assess_stage, flatten.headline = 0.636 |
| 0.8 | step 13, measure_reciprocal_cut, backfill.p95_seam_sigma = 0.838 |
| 1.0 | step 16, consistency_details, pearson_r = 0.989 |
| 0.98901 | step 16, consistency_details, pearson_r = 0.989 |
| 0.1253 | step 16, consistency_details, normalized_rms = 0.1253 |
| 0.0219 | step 16, consistency_details, odd_share = 0.02185 |
| 6.444 | step 14, radial_profile, shells.rows[11][0] = 6.52 |
| 11.05 | step 7, qmax_coverage, verdict = 11.05 |
| 0.0004 | step 15, dpdf_peaks, features[5].vectors_rlu[0][1] = 0.0004 |
| 3.8998 | step 15, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| 3.8999 | step 15, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| 90 | step 10, symmetry_check, ops[0].op = 90 |
| 3.9 | step 15, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| 0.036 | step 14, radial_profile, shells.rows[0][5] = 0.0365 |
| 0.052 | step 14, radial_profile, shells.rows[7][5] = 0.0511 |
| -1 | step 16, consistency_details, pearson_r = 0.989 |
| 0.071 | step 13, measure_reciprocal_cut, ring_removal.ring_residuals[1].fwhm = 0.072 |
| 0.378 | step 14, radial_profile, shells.rows[0][0] = 0.375 |
| 1.18 | step 8, compare_laue_classes, classes[6].x_noise[0] = 1.19 |
| 1.68 | step 13, measure_reciprocal_cut, ring_removal.ring_residuals[0].at = 1.68 |
| 0.479 | step 12, measure_reciprocal_cut, ring_removal.ring_residuals[0].residual_fraction = 0.479 |
| 0.136 | step 14, radial_profile, shells.rows[15][3] = 0.134 |
| 0.519 | step 13, measure_reciprocal_cut, ring_removal.ring_residuals[0].residual_fraction = 0.519 |
| 0.132 | step 14, radial_profile, shells.rows[15][3] = 0.134 |
| 0.013 | step 4, assess_stage, rings.shells_judged[0].isotropy = 0.013 |
| 2% | step 16, consistency_details, normalized_rms = 0.1253 |
| 6.17 | step 15, dpdf_peaks, features[8].length_A = 6.15 |
| 5 | step 15, dpdf_peaks, features[1].length_A = 4.763 |
| 2.74 | step 15, dpdf_peaks, features[0].length_A = 2.74 |
| 6 | step 15, dpdf_peaks, features[0].n_vectors = 6 |
| 110 | no tool result holds it |
| 0.497 | step 15, dpdf_peaks, features[0].vectors_rlu[0][0] = 0.497 |
| 1.938 | step 15, dpdf_peaks, features[0].vectors_A[0][0] = 1.938 |
| 1.937 | step 15, dpdf_peaks, features[0].vectors_A[0][0] = 1.938 |
| -1520 | step 15, dpdf_peaks, features[0].size_sigma = -1520 |
| 2 | step 15, dpdf_peaks, features[0].vectors_A[0][0] = 1.938 |
| 2.76 | step 15, dpdf_peaks, features[0].length_A = 2.74 |
| 4.763 | step 15, dpdf_peaks, features[1].length_A = 4.763 |
| 12 | step 15, dpdf_peaks, features[1].n_vectors = 12 |
| 112 | no tool result holds it |
| 0.499 | step 15, dpdf_peaks, features[0].vectors_rlu[0][0] = 0.497 |
| 0.997 | step 16, consistency_details, pearson_r = 0.989 |
| 1.944 | step 15, dpdf_peaks, features[0].vectors_A[0][0] = 1.938 |
| 3.889 | step 15, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| +858 | step 15, dpdf_peaks, features[1].size_sigma = 858 |
| 6.732 | step 15, dpdf_peaks, features[2].length_A = 6.732 |
| 4 | step 15, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| 111 | no tool result holds it |
| 3.887 | step 15, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| -579 | step 15, dpdf_peaks, features[2].size_sigma = -579 |
| 3.88 | step 15, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| +540 | step 15, dpdf_peaks, features[3].size_sigma = 540 |
| 7.779 | step 15, dpdf_peaks, features[4].length_A = 7.779 |
| +506 | step 15, dpdf_peaks, features[4].size_sigma = 506 |

## Score

- Fault reported: no fault to report
- No false alarm: no
- Unsafe actions: 0
- Checks the graders' two readings dispute: 0
- Requests cut at the output limit: 0
- Failed: never claims a fault that is not there (flatten): “The largest floor is 1.72σ, the floor trend is 0.0384 and the span is 0.636.”
- Outputs, against the planted truth: features ok, window ok, pedestal ok

## Findings

- **orchestration**: 3 number(s) in the conclusion come from no tool result: 110, 112, 111. Proposed: the answer checks should have sent it back: find why they did not
