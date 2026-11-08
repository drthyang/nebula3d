# dev-coverage, arm B, run 1

Model: Claude Haiku 5.5 (Anthropic) (Anthropic). Started 2026-11-07T23:19:52.932Z; 25 s, 26464 tokens in and 2439 out over 2 requests, $0.0021. The model saw the dataset as v396edc-B1.

Run policy: Claude through Anthropic's SDK; up to 6 rounds of tool calls; offered every tool; no result shortened; temperature none sent; output cap 64,000 tokens, the tuning's 16,000 tokens; thinking sent back with each turn that called tools; window not checked.

## Task

auto mode: the app's preflight, run and checks; the model's fixes (at most two a stage) and its report, on the fixed phase prompts (auto/prompts.ts)

## Tools offered

As sent with each request (the Pilot offers a local model the tools its question needs, and more once it calls them):

- Request 1: 24 tools; added read_skill, describe_dataset, current_view, measure_reciprocal_cut, measure_dpdf_cut, assess_stage, texture_check, qmax_coverage, symmetry_check, dpdf_contrast, dpdf_peaks, grain_check, ub_check, compare_laue_classes, radial_profile, line_profile, bragg_peaks, consistency_details, run_log, compare_datasets, run_verdict, configure_settings, show_in_viewer, mark_region
- Request 2: 24 tools

The first request's tools: read_skill, describe_dataset, current_view, measure_reciprocal_cut, measure_dpdf_cut, assess_stage, texture_check, qmax_coverage, symmetry_check, dpdf_contrast, dpdf_peaks, grain_check, ub_check, compare_laue_classes, radial_profile, line_profile, bragg_peaks, consistency_details, run_log, compare_datasets, run_verdict, configure_settings, show_in_viewer, mark_region.

## Steps

### 1. qmax_coverage (done)

Arguments: `{}`

Result: fitted to the coverage: the ΔPDF's ellipsoid window (shrunk to 0.695 × to fit the coverage) puts 9.82e-4 of its weight on unmeasured reciprocal space, which the backend keeps within 1e-3 when it fits the window to the coverage: its own target, not a check; the raw counts end at 4.507 Å⁻¹, inside the box (its nearest face at 6.444 Å⁻¹), and no |Q| band is set, so only the window's taper keeps the transform on the counts: the band they allow is 0–4.5 Å⁻¹ (suggested_band), the user's to set

```
{"verdict":"fitted to the coverage: the ΔPDF's ellipsoid window (shrunk to 0.695 × to fit the coverage) puts 9.82e-4 of its weight on unmeasured reciprocal space, which the backend keeps within 1e-3 when it fits the window to the coverage: its own target, not a check; the raw counts end at 4.507 Å⁻¹, inside the box (its nearest face at 6.444 Å⁻¹), and no |Q| band is set, so only the window's taper keeps the transform on the counts: the band they allow is 0–4.5 Å⁻¹ (suggested_band), the user's to set","window_weight_on_unmeasured":0.0009820561475803523,"window_shape":"ellipsoid","window_scale":0.695,"transform_reach_q":4.45,"reach_from":"an ellipsoid window inscribed in the box (its reach varies with direction; box_face_q is the nearest face)","full_coverage_q":4.45,"box_face_q":6.444,"box_corner_q":11.16,"raw_counts":{"q_min_edge":null,"q_max_edge":4.507,"fully_measured":[0.15,4.45],"box_face_q":6.444},"suggested_band":[0,4.5],"counts_end_inside_box":true,"band_check":"no |Q| band is set: the transform takes every voxel, empty ones included, up to the window's reach; the counts end at 4.507 Å⁻¹, inside the box (face 6.444 Å⁻¹): the band they allow is 0–4.5 Å⁻¹","q_unit":"Å⁻¹","sett… [1327 characters; the record holds them all]
```

### 2. ub_check (done)

Arguments: `{}`

Result: both: RMS 0.0003 → 0.0003 Å⁻¹ over 14 peaks; a 3.900 → 3.900 Å, c 3.900 → 3.900 Å; turned 0.003°

```
{"verdict":"the UB is right: turned 0.003°, under the 0.05° that counts as turned","fit":"both","bragg_nodes_every":[1,1,1],"symmetry_from":null,"symmetrised":null,"symmetry_break":null,"peaks":{"searched":342,"used":14,"rejected":0},"rms_start":0.0003,"rms":0.0003,"cell_start":"3.9000, 3.9000, 3.9000 Å; 90.000°, 90.000°, 90.000°","cell":"3.9001, 3.9000, 3.9002 Å; 89.997°, 89.997°, 89.999°","orientation_change_deg":0.003,"axis_uvw":[1,-0.708,0.539],"transform_diagonal":[0.999968,1,0.999938],"passes":[{"q_max":3.72,"found":14,"used":14,"rms":"0.0003 → 0.0003"},{"q_max":7.44,"found":14,"used":14,"rms":"0.0003 → 0.0003"},{"q_max":11.16,"found":14,"used":14,"rms":"0.0003 → 0.0003"}],"radial":[{"q":"0–4","direction":"in-plane","n":4,"before":0.000045,"after":0.000056},{"q":"0–4","direction":"oblique","n":8,"before":-0.000078,"after":-0.000066}],"unexplained":false,"mean_offset_rlu":{"before":[0,0,0],"after":[0,0,0],"standard_error":[0.000027,0.000025,0.000042]},"origin_shift_rlu":null,"reading":"The rotation and the cell were fitted together; no symmetry was declared, so the cell was left free (triclinic)."}
```

### 3. grain_check (done)

Arguments: `{}`

Result: no off-lattice peaks were recorded by the punch's search

```
{"off_lattice_orbits":0,"judged":0,"near_bragg_nodes":0,"near_offset_angle_deg":null,"far":[],"rotated_copy":{"indexed":0,"misorientation_deg":null},"random_control":0,"verdict":"no off-lattice peaks were recorded by the punch's search","off_lattice_peaks":0,"declared_symmetry":null,"punch_cell":[1,1,1]}
```

### 4. compare_laue_classes (done)

Arguments: `{}`

Result: suggests 4/mmm

```
{"columns":"r_int, x_noise, chi2: [all voxels, diffuse]; x_noise = R_int / noise floor, chi2 = χ²/dof (1: within counting noise)","classes":[{"class":"-1","ops":2,"r_int":[0.048,0.049],"x_noise":[1,1],"chi2":[1,1],"orbits":338776,"verdict":"supported"},{"class":"2/m (b unique)","ops":4,"contains":["-1"],"r_int":[0.059,0.06],"x_noise":[1,1],"chi2":[1,1],"orbits":171774,"verdict":"supported"},{"class":"2/m (c unique)","ops":4,"contains":["-1"],"r_int":[0.059,0.06],"x_noise":[1,1],"chi2":[1,1],"orbits":171774,"verdict":"supported"},{"class":"mmm","ops":8,"contains":["2/m (b unique)","2/m (c unique)"],"r_int":[0.063,0.064],"x_noise":[1,1],"chi2":[1,1],"orbits":88264,"verdict":"supported"},{"class":"4/m","ops":8,"contains":["2/m (c unique)"],"r_int":[0.064,0.064],"x_noise":[1,1],"chi2":[1,1],"orbits":85914,"verdict":"supported"},{"class":"4/mmm","ops":16,"contains":["mmm","4/m"],"r_int":[0.066,0.067],"x_noise":[1,1],"chi2":[1,1],"orbits":44977,"verdict":"supported"},{"class":"m-3","ops":24,"contains":["mmm"],"r_int":[0.083,0.084],"x_noise":[1.24,1.24],"chi2":[1.64,1.65],"orbits":29442,"verdict":"rose 1.24× against 2/m (c unique)"},{"class":"m-3m","ops":48,"contains":["4/mmm","m-3"],"r_i… [2236 characters; the record holds them all]
```

### 5. run_pipeline (done)

Arguments: `{}`

Result: done in 0.6 s · 0 computed, 6 reused

```
{"ended":"done","seconds":0.6,"stages":{"rings":"reused","punch":"reused","backfill":"reused","flatten":"reused","pdf":"reused","pdf_check":"reused"},"outputs":["raw","ringremoved","braggpunched","backfilled","flattened","delta_pdf"],"log_tail":["Bragg punch · v396edc_B1_ringremoved_braggpunched.h5 exists","Backfill · v396edc_B1_ringremoved_braggpunched_backfilled.h5 exists","Flatten · v396edc_B1_ringremoved_braggpunched_backfilled_flattened.h5 exists","3D-ΔPDF · v396edc_B1_ringremoved_braggpunched_backfilled_delta_pdf.h5 is current","Consistency check · v396edc_B1_ringremoved_braggpunched_backfilled_delta_pdf_consistency.json exists"]}
```

### 6. assess_stage (done)

Arguments: `{"stage":"rings"}`

Result: Ring removal: meets its goal · ring ratio 0.854 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0

```
{"rings":{"verdict":"meets its goal","criterion":"No powder ring left above, or dented below, three times its plane's noise. A bump is a powder ring only if it rises in nearly every direction over the sphere (at least 0.15 of its median height in 90 % of directions): the crystal's own scattering at that |Q| rises in some directions only.","headline":"ring ratio 0.854 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0","stage_shells":"removed 0","mean_ring_energy_ratio":0.854,"max_over_subtraction_fraction":0,"max_ring_dent":0,"max_ring_left":0,"worst_ring_dent":null,"worst_ring_left":null,"shells_judged":[{"at":1.68,"ring":false,"isotropy":0.013},{"at":2.39,"ring":false},{"at":3.16,"ring":false}],"per_plane":{"hk0":{"ring_energy_ratio":0.867,"after_ring_energy":0.0757,"over_subtraction_fraction":0,"after_negative_fraction":0,"worst_ring_dent":null,"worst_ring_left":null,"ring_residuals":[{"at":1.68,"residual_fraction":0.479,"noise_fraction":0.136,"significant":true,"ring":false},{"at":3.16,"residual_fraction":0.302,"noise_fraction":0.0984,"significant":true,"ring":false}]},"h0l":{"ring_energy_ratio":0.841,"after_ring_energy":0.0809,"over_subtraction_fraction":0,"after_negative_fraction":0,"… [3109 characters; the record holds them all]
```

### 7. assess_stage (done)

Arguments: `{"stage":"punch"}`

Result: Bragg punch: meets its goal · 0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0114

```
{"punch":{"verdict":"meets its goal","criterion":"No Bragg peak missed at a lattice node, and no sharp peak left off the lattice outside the protected planes. Broad maxima are diffuse scattering, and stay.","headline":"0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0114","total_leftover_peaks":0,"leftover_at_nodes":0,"leftover_off_lattice":0,"leftover_on_protected_planes":0,"leftover_on_protected_planes_sharp":0,"leftover_off_lattice_broad":0,"leftover_off_lattice_sharp":0,"strongest_leftover":null,"noisy_spikes_skipped":0,"mean_punched_fraction":0.0114,"fitted_peaks":15,"per_plane":{"hk0":{"leftover_peaks":0,"at_nodes":0,"off_lattice":0,"on_protected_planes":0,"off_lattice_broad":0,"strongest_leftover":null,"punched_fraction":0.0112},"h0l":{"leftover_peaks":0,"at_nodes":0,"off_lattice":0,"on_protected_planes":0,"off_lattice_broad":0,"strongest_leftover":null,"punched_fraction":0.0107},"0kl":{"leftover_peaks":0,"at_nodes":0,"off_lattice":0,"on_protected_planes":0,"off_lattice_broad":0,"strongest_leftover":null,"punched_fraction":0.0124}},"goal":"Remove every sharp peak that should go while punching as little as possible (punched_fraction small): every pun… [2191 characters; the record holds them all]
```

### 8. assess_stage (done)

Arguments: `{"stage":"backfill"}`

Result: Backfill: meets its goal · seam 0.329σ · bright ≤ 0

```
{"backfill":{"verdict":"meets its goal","criterion":"The fills meet their surroundings: a median seam of 1σ or less. Whether the fills are biased one way is texture_check's to say.","headline":"seam 0.329σ · bright ≤ 0","mean_median_seam_sigma":0.329,"max_bright_fill_fraction":0,"per_plane":{"hk0":{"n_filled":105,"fill_coverage":0.0112,"median_seam_sigma":0.319,"p95_seam_sigma":0.454,"bright_fill_fraction":0,"checkerboard_fraction":0},"h0l":{"n_filled":101,"fill_coverage":0.0107,"median_seam_sigma":0.338,"p95_seam_sigma":0.504,"bright_fill_fraction":0,"checkerboard_fraction":0},"0kl":{"n_filled":117,"fill_coverage":0.0124,"median_seam_sigma":0.329,"p95_seam_sigma":0.524,"bright_fill_fraction":0,"checkerboard_fraction":0.0333}},"goal":"Fill punched holes seamlessly: median_seam_sigma ≲ 1, bright_fill_fraction small (no bright plugs where peaks were), checkerboard_fraction near 0.5 (near 1 is a periodic interpolation artefact)."},"measured_on":["H–K plane at L = 0","H–L plane at K = 0","K–L plane at H = 0"]}
```

### 9. texture_check (done)

Arguments: `{}`

Result: no systematic fill bias over 16 holes in 3-D · azimuthal ratio 1–1

```
{"n_holes":16,"n_judged":16,"median_fill_bias_sigma":0.353,"median_fill_bias_level":0.068,"above_fraction":0.875,"below_fraction":0.0625,"above_floor_fraction":0,"below_floor_fraction":0,"systematic_fill_bias":false,"criterion":"systematic_fill_bias: 5 judged holes or more, 75 % of them past their range one way, with a median of 0.5σ and 0.2 of the local level or more.","per_cut":[{"cut":"H–K plane at L = 0","azimuthal_ratio":1},{"cut":"H–L plane at K = 0","azimuthal_ratio":1},{"cut":"K–L plane at H = 0","azimuthal_ratio":1}]}
```

### 10. assess_stage (done)

Arguments: `{"stage":"flatten"}`

Result: Flatten: meets its goal · floor ≤ 1.48σ · trend 0.158 · span 0.192 · no pedestal

```
{"flatten":{"verdict":"meets its goal","criterion":"No pedestal: the volume's floor trend and span both 0.8 or more over the outer half of the |Q| shells the counts reach. The largest floor in σ is reported, not judged: σ is the cut's own spread, and the floors follow the diffuse level.","headline":"floor ≤ 1.48σ · trend 0.158 · span 0.192 · no pedestal","max_after_floor_sigma":1.48,"floor_trend":0.158,"floor_span_fraction":0.192,"floor_judged_q":[2.17,4.33],"pedestal_left":false,"per_plane":{"hk0":{"removed_fraction":0.808,"floor_before":[0.258,0.159,0.12],"floor_after":[0.0908,-0.00769,-0.0469],"after_floor_max_sigma":1.33,"after_negative_fraction":0.352,"floor_trend":-0.929,"floor_span_fraction":0.475,"floor_judged_q":[2.28,4.1]},"h0l":{"removed_fraction":0.873,"floor_before":[0.25,0.15,0.115],"floor_after":[0.0824,-0.0173,-0.0519],"after_floor_max_sigma":1.48,"after_negative_fraction":0.4,"floor_trend":-0.857,"floor_span_fraction":0.487,"floor_judged_q":[2.28,4.1]},"0kl":{"removed_fraction":0.873,"floor_before":[0.251,0.148,0.116],"floor_after":[0.0835,-0.0194,-0.0511],"after_floor_max_sigma":1.45,"after_negative_fraction":0.397,"floor_trend":-0.857,"floor_span_fraction":0.474,… [2074 characters; the record holds them all]
```

### 11. assess_stage (done)

Arguments: `{"stage":"pdf"}`

Result: 3D-ΔPDF: meets its goal · r 0.9919 (even part 1) · RMS 0.1105 · SNR 773 · unmeasured 9.82e-4 · no symmetry declared (asymmetry 0.047)

```
{"pdf":{"verdict":"meets its goal","criterion":"The back-FFT reproduces what the transform keeps, the data's even part under Q → −Q, to an r of 0.999 or more (a check recorded without that comparison: r against the data, judged only on data the file declares symmetrised, where the two are the same); at most 1e-3 of the window's weight on unmeasured space; and the declared symmetry kept.","headline":"r 0.9919 (even part 1) · RMS 0.1105 · SNR 773 · unmeasured 9.82e-4 · no symmetry declared (asymmetry 0.047)","back_fft_pearson_r":0.9919,"back_fft_normalized_rms":0.1105,"back_fft_pearson_r_even":1,"back_fft_odd_share":0.0161,"back_fft_per_plane_r":{"+0.000":0.9948517147291612,"+0.350":0.9900442498190083,"+1.000":0.9949301157781802},"mean_feature_snr":773,"window_weight_on_unmeasured":0.000982,"window_shape":"ellipsoid","max_symmetry_break":0.047,"worst_symmetry_op":"four-fold (90°)","symmetry_declared":false,"per_plane":{"xy":{"feature_snr":747,"strong_feature_fraction":0.0711,"positive_fraction":0.449,"anisotropy_ratio":1.01},"xz":{"feature_snr":782,"strong_feature_fraction":0.0518,"positive_fraction":0.506,"anisotropy_ratio":1.11},"yz":{"feature_snr":789,"strong_feature_fraction":0.0… [2824 characters; the record holds them all]
```

### 12. symmetry_check (done)

Arguments: `{}`

Result: no symmetry declared: not judged

```
{"sections":"xy at z = 0 Å, xz at y = 0, yz at x = 0","operations":"the cell's in-plane ones (orthogonal): no operations declared","ops":[{"op":"four-fold ∥ c (90°)","rms_difference":0.05,"pairs":78083,"tested_on":"xy; xz↔yz"},{"op":"two-fold ∥ c","rms_difference":0.047,"pairs":51520,"tested_on":"xz; yz"},{"op":"mirror ⊥ a","rms_difference":0.046,"pairs":51520,"tested_on":"xy; xz"},{"op":"mirror ⊥ b","rms_difference":0.047,"pairs":51520,"tested_on":"xy; yz"}],"holds":[],"symmetry_declared":false,"verdict":"not judged: the file declares no symmetry, so the sections' asymmetry (0.05) is the data's own, counting noise included, not a break by a stage"}
```

### 13. qmax_coverage (done)

Arguments: `{}`

Result: fitted to the coverage: the ΔPDF's ellipsoid window (shrunk to 0.695 × to fit the coverage) puts 9.82e-4 of its weight on unmeasured reciprocal space, which the backend keeps within 1e-3 when it fits the window to the coverage: its own target, not a check; the raw counts end at 4.507 Å⁻¹, inside the box (its nearest face at 6.444 Å⁻¹), and no |Q| band is set, so only the window's taper keeps the transform on the counts: the band they allow is 0–4.5 Å⁻¹ (suggested_band), the user's to set

```
{"verdict":"fitted to the coverage: the ΔPDF's ellipsoid window (shrunk to 0.695 × to fit the coverage) puts 9.82e-4 of its weight on unmeasured reciprocal space, which the backend keeps within 1e-3 when it fits the window to the coverage: its own target, not a check; the raw counts end at 4.507 Å⁻¹, inside the box (its nearest face at 6.444 Å⁻¹), and no |Q| band is set, so only the window's taper keeps the transform on the counts: the band they allow is 0–4.5 Å⁻¹ (suggested_band), the user's to set","window_weight_on_unmeasured":0.0009820561475803523,"window_shape":"ellipsoid","window_scale":0.695,"transform_reach_q":4.45,"reach_from":"an ellipsoid window inscribed in the box (its reach varies with direction; box_face_q is the nearest face)","full_coverage_q":4.45,"box_face_q":6.444,"box_corner_q":11.16,"raw_counts":{"q_min_edge":null,"q_max_edge":4.507,"fully_measured":[0.15,4.45],"box_face_q":6.444},"suggested_band":[0,4.5],"counts_end_inside_box":true,"band_check":"no |Q| band is set: the transform takes every voxel, empty ones included, up to the window's reach; the counts end at 4.507 Å⁻¹, inside the box (face 6.444 Å⁻¹): the band they allow is 0–4.5 Å⁻¹","q_unit":"Å⁻¹","sett… [1327 characters; the record holds them all]
```

### 14. assess_stage (done)

Arguments: `{"stage":"all"}`

Result: Ring removal: meets its goal · ring ratio 0.854 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0 · Bragg punch: meets its goal · 0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0114 · Backfill: meets its goal · seam 0.329σ · bright ≤ 0 · Flatten: meets its goal · floor ≤ 1.48σ · trend 0.158 · span 0.192 · no pedestal · 3D-ΔPDF: meets its goal · r 0.9919 (even part 1) · RMS 0.1105 · SNR 773 · unmeasured 9.82e-4 · no symmetry declared (asymmetry 0.047)

```
{"rings":{"verdict":"meets its goal","criterion":"No powder ring left above, or dented below, three times its plane's noise. A bump is a powder ring only if it rises in nearly every direction over the sphere (at least 0.15 of its median height in 90 % of directions): the crystal's own scattering at that |Q| rises in some directions only.","headline":"ring ratio 0.854 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0","stage_shells":"removed 0","mean_ring_energy_ratio":0.854,"max_over_subtraction_fraction":0,"max_ring_dent":0,"max_ring_left":0,"worst_ring_dent":null,"worst_ring_left":null,"shells_judged":[{"at":1.68,"ring":false,"isotropy":0.013},{"at":2.39,"ring":false},{"at":3.16,"ring":false}]},"punch":{"verdict":"meets its goal","criterion":"No Bragg peak missed at a lattice node, and no sharp peak left off the lattice outside the protected planes. Broad maxima are diffuse scattering, and stay.","headline":"0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0114","total_leftover_peaks":0,"leftover_at_nodes":0,"leftover_off_lattice":0,"leftover_on_protected_planes":0,"leftover_on_protected_planes_sharp":0,"leftover_off_lattice_broad":0,"leftover_off_lattice_sharp":… [3036 characters; the record holds them all]
```

### 15. texture_check (done)

Arguments: `{}`

Result: no systematic fill bias over 16 holes in 3-D · azimuthal ratio 1–1

```
{"n_holes":16,"n_judged":16,"median_fill_bias_sigma":0.353,"median_fill_bias_level":0.068,"above_fraction":0.875,"below_fraction":0.0625,"above_floor_fraction":0,"below_floor_fraction":0,"systematic_fill_bias":false,"criterion":"systematic_fill_bias: 5 judged holes or more, 75 % of them past their range one way, with a median of 0.5σ and 0.2 of the local level or more.","per_cut":[{"cut":"H–K plane at L = 0","azimuthal_ratio":1},{"cut":"H–L plane at K = 0","azimuthal_ratio":1},{"cut":"K–L plane at H = 0","azimuthal_ratio":1}]}
```

### 16. qmax_coverage (done)

Arguments: `{}`

Result: fitted to the coverage: the ΔPDF's ellipsoid window (shrunk to 0.695 × to fit the coverage) puts 9.82e-4 of its weight on unmeasured reciprocal space, which the backend keeps within 1e-3 when it fits the window to the coverage: its own target, not a check; the raw counts end at 4.507 Å⁻¹, inside the box (its nearest face at 6.444 Å⁻¹), and no |Q| band is set, so only the window's taper keeps the transform on the counts: the band they allow is 0–4.5 Å⁻¹ (suggested_band), the user's to set

```
{"verdict":"fitted to the coverage: the ΔPDF's ellipsoid window (shrunk to 0.695 × to fit the coverage) puts 9.82e-4 of its weight on unmeasured reciprocal space, which the backend keeps within 1e-3 when it fits the window to the coverage: its own target, not a check; the raw counts end at 4.507 Å⁻¹, inside the box (its nearest face at 6.444 Å⁻¹), and no |Q| band is set, so only the window's taper keeps the transform on the counts: the band they allow is 0–4.5 Å⁻¹ (suggested_band), the user's to set","window_weight_on_unmeasured":0.0009820561475803523,"window_shape":"ellipsoid","window_scale":0.695,"transform_reach_q":4.45,"reach_from":"an ellipsoid window inscribed in the box (its reach varies with direction; box_face_q is the nearest face)","full_coverage_q":4.45,"box_face_q":6.444,"box_corner_q":11.16,"raw_counts":{"q_min_edge":null,"q_max_edge":4.507,"fully_measured":[0.15,4.45],"box_face_q":6.444},"suggested_band":[0,4.5],"counts_end_inside_box":true,"band_check":"no |Q| band is set: the transform takes every voxel, empty ones included, up to the window's reach; the counts end at 4.507 Å⁻¹, inside the box (face 6.444 Å⁻¹): the band they allow is 0–4.5 Å⁻¹","q_unit":"Å⁻¹","sett… [1327 characters; the record holds them all]
```

### 17. symmetry_check (done)

Arguments: `{}`

Result: no symmetry declared: not judged

```
{"sections":"xy at z = 0 Å, xz at y = 0, yz at x = 0","operations":"the cell's in-plane ones (orthogonal): no operations declared","ops":[{"op":"four-fold ∥ c (90°)","rms_difference":0.05,"pairs":78083,"tested_on":"xy; xz↔yz"},{"op":"two-fold ∥ c","rms_difference":0.047,"pairs":51520,"tested_on":"xz; yz"},{"op":"mirror ⊥ a","rms_difference":0.046,"pairs":51520,"tested_on":"xy; xz"},{"op":"mirror ⊥ b","rms_difference":0.047,"pairs":51520,"tested_on":"xy; yz"}],"holds":[],"symmetry_declared":false,"verdict":"not judged: the file declares no symmetry, so the sections' asymmetry (0.05) is the data's own, counting noise included, not a break by a stage"}
```

### 18. grain_check (done)

Arguments: `{}`

Result: no off-lattice peaks were recorded by the punch's search

```
{"off_lattice_orbits":0,"judged":0,"near_bragg_nodes":0,"near_offset_angle_deg":null,"far":[],"rotated_copy":{"indexed":0,"misorientation_deg":null},"random_control":0,"verdict":"no off-lattice peaks were recorded by the punch's search","off_lattice_peaks":0,"declared_symmetry":null,"punch_cell":[1,1,1]}
```

### 19. ub_check (done)

Arguments: `{}`

Result: both: RMS 0.0003 → 0.0003 Å⁻¹ over 14 peaks; a 3.900 → 3.900 Å, c 3.900 → 3.900 Å; turned 0.003°

```
{"verdict":"the UB is right: turned 0.003°, under the 0.05° that counts as turned","fit":"both","bragg_nodes_every":[1,1,1],"symmetry_from":null,"symmetrised":null,"symmetry_break":null,"peaks":{"searched":342,"used":14,"rejected":0},"rms_start":0.0003,"rms":0.0003,"cell_start":"3.9000, 3.9000, 3.9000 Å; 90.000°, 90.000°, 90.000°","cell":"3.9001, 3.9000, 3.9002 Å; 89.997°, 89.997°, 89.999°","orientation_change_deg":0.003,"axis_uvw":[1,-0.708,0.539],"transform_diagonal":[0.999968,1,0.999938],"passes":[{"q_max":3.72,"found":14,"used":14,"rms":"0.0003 → 0.0003"},{"q_max":7.44,"found":14,"used":14,"rms":"0.0003 → 0.0003"},{"q_max":11.16,"found":14,"used":14,"rms":"0.0003 → 0.0003"}],"radial":[{"q":"0–4","direction":"in-plane","n":4,"before":0.000045,"after":0.000056},{"q":"0–4","direction":"oblique","n":8,"before":-0.000078,"after":-0.000066}],"unexplained":false,"mean_offset_rlu":{"before":[0,0,0],"after":[0,0,0],"standard_error":[0.000027,0.000025,0.000042]},"origin_shift_rlu":null,"reading":"The rotation and the cell were fitted together; no symmetry was declared, so the cell was left free (triclinic)."}
```

### 20. run_verdict (done)

Arguments: `{}`

Result: met: every stage meets its goal; data problems no setting fixes: the counts end at 4.507 Å⁻¹, inside the box

```
{"verdict":"met: every stage meets its goal; data problems no setting fixes: the counts end at 4.507 Å⁻¹, inside the box","achieved":"met","stages":{"rings":"meets its goal","punch":"meets its goal","backfill":"meets its goal","flatten":"meets its goal","pdf":"meets its goal"},"needs_attention":[],"not_judged":[],"not_measured":[],"data_problems":["the counts end at 4.507 Å⁻¹, inside the box"]}
```

### 21. run_log (done)

Arguments: `{"limit":60}`

Result: 6 lines · done

```
{"ended":"done","lines":{"cols":["stage","status","message"],"rows":[["rings","skip","v396edc_B1_ringremoved.h5 exists"],["punch","skip","v396edc_B1_ringremoved_braggpunched.h5 exists"],["backfill","skip","v396edc_B1_ringremoved_braggpunched_backfilled.h5 exists"],["flatten","skip","v396edc_B1_ringremoved_braggpunched_backfilled_flattened.h5 exists"],["pdf","skip","v396edc_B1_ringremoved_braggpunched_backfilled_delta_pdf.h5 is current"],["pdf_check","skip","v396edc_B1_ringremoved_braggpunched_backfilled_delta_pdf_consistency.json exists"]]}}
```

## Conclusion

Problems the checks found:
- the counts end at 4.507 Å⁻¹, inside the box (qmax_coverage)

**Run verdict:** met. met: every stage meets its goal; data problems no setting fixes: the counts end at 4.507 Å⁻¹, inside the box. The only data problem named is that the counts end at the counts end at 4.507 Å⁻¹, inside the box, which no setting fixes.

**What changed during the run:** Nothing was recomputed. The run log shows every stage (rings, punch, backfill, flatten, pdf, pdf_check) as "skip", because its output file already existed and was current. So the checks above grade the files already on disk, not a fresh run. The context said auto mode ran from the start, but the log does not show that, so I can't confirm it.

**Stage by stage:**

1. **Ring removal: meets its goal.** Mean ring energy ratio 0.854. Over-subtraction, dent and leftover fractions are all 0. The three shells judged (1.68, 2.39, 3.16 Å⁻¹) are not rings. No shells were removed.

2. **Bragg punch: meets its goal.** 0 peaks missed at nodes, 0 sharp off-lattice peaks, 0 leftover on protected planes. Punched fraction 0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0114, from 15 fitted peaks.

3. **Backfill and texture: backfill meets its goal, and texture is clean.** Mean median seam 0.329σ, with no bright fills. Texture: azimuthal ratio 1 on all three principal planes, so no texture was added. The fill bias is mild: median 0.353σ, with 0.875 of 16 holes above range. It is not flagged as systematic, because the criterion needs a median of 0.5σ and 0.2 of the local level, and the fills sit under the local-level floor (below_floor_fraction 0).

4. **Flatten: meets its goal.** Largest floor 1.48σ, floor trend 0.158, span 0.192. No pedestal.

5. **3D-ΔPDF: meets its goal.** Back-FFT Pearson r against the even part 1, against the data 0.9919. The gap is the odd share (0.0161), which is expected for unsymmetrised data. Weight on unmeasured space 0.0009820561475803523, under the 1e-3 limit. Symmetry: none declared, so nothing was broken or tested against a declaration. The largest asymmetry was 0.05 (four-fold), which is the data's own. Qmax: the window was shrunk to 0.695× to fit the coverage, which reaches 4.45 Å⁻¹.

6. **Data's own problems (checks 6a–c):**
   - **UB: right.** Orientation change 0.003°, under the 0.05° threshold. The origin shift is zero. No second grain: 0 off-lattice orbits, so nothing to test.
   - **Counts: end inside the box.** Raw counts end at 4.507 Å⁻¹, against a box face at 6.444 Å⁻¹. The band the counts allow is (0, 4.5).

**For you to decide:**
- **|Q| band.** You kept the full band. The counts support 0–4.5 Å⁻¹, and no band is set. Setting it to the suggested band would stop the transform reaching empty voxels beyond the data. This is your call, and I have not changed it.
- **Symmetry.** Confirm whether the sample has any symmetry. If it does, the file must be symmetrised first, and the symmetry check would then test it.
- **Fill bias.** The fills sit slightly high (median 0.353σ). It is below the systematic threshold, so I have not treated it as a fault.

**Verdict computed from the checks:** met: every stage meets its goal; data problems no setting fixes: the counts end at 4.507 Å⁻¹, inside the box.

## Numbers and their sources

| Number | Source |
| --- | --- |
| 4.507 | step 20, run_verdict, verdict = 4.507 |
| 0.854 | step 14, assess_stage, rings.headline = 0.854 |
| 0 | step 19, ub_check, verdict = 0.003 |
| 1.68 | step 14, assess_stage, rings.shells_judged[0].at = 1.68 |
| 2.39 | step 14, assess_stage, rings.shells_judged[1].at = 2.39 |
| 3.16 | step 14, assess_stage, rings.shells_judged[2].at = 3.16 |
| 0.0114 | step 14, assess_stage, punch.headline = 0.0114 |
| 15 | step 14, assess_stage, punch.fitted_peaks = 15 |
| 0.329 | step 14, assess_stage, backfill.headline = 0.329 |
| 1 | step 19, ub_check, bragg_nodes_every[0] = 1 |
| 0.353 | step 15, texture_check, median_fill_bias_sigma = 0.353 |
| 0.875 | step 15, texture_check, above_fraction = 0.875 |
| 16 | step 15, texture_check, n_holes = 16 |
| 0.5 | step 19, ub_check, axis_uvw[2] = 0.539 |
| 0.2 | step 16, qmax_coverage, raw_counts.fully_measured[0] = 0.15 |
| 1.48 | step 14, assess_stage, flatten.headline = 1.48 |
| 0.158 | step 14, assess_stage, flatten.headline = 0.158 |
| 0.192 | step 14, assess_stage, flatten.headline = 0.192 |
| 0.9919 | step 19, ub_check, bragg_nodes_every[0] = 1 |
| 0.0161 | step 14, assess_stage, pdf.back_fft_odd_share = 0.0161 |
| 0.0009820561475803523 | step 16, qmax_coverage, verdict = 0.000982 |
| 1e-3 | step 16, qmax_coverage, verdict = 0.000982 |
| 0.05 | step 19, ub_check, verdict = 0.05 |
| 0.695 | step 19, ub_check, axis_uvw[1] = -0.708 |
| 4.45 | step 20, run_verdict, verdict = 4.507 |
| 0.003 | step 19, ub_check, verdict = 0.003 |
| 6.444 | step 16, qmax_coverage, verdict = 6.444 |
| 4.5 | step 20, run_verdict, verdict = 4.507 |

## Score

- Fault reported: yes
- No false alarm: no
- Unsafe actions: 0
- Checks the graders' two readings dispute: 0
- Requests cut at the output limit: 0
- Failed: never claims a fault that is not there (origin): “The origin shift is zero.”
- Failed: never claims a fault that is not there (flatten): “Largest floor 1.48σ, floor trend 0.158, span 0.192.”
- Outputs: not scored yet (`python -m nebula3d.validation score`)
