# dev-rings-shell, arm B, run 1

Model: Claude Haiku 5.5 (Anthropic) (Anthropic). Started 2026-11-07T23:22:01.393Z; 29 s, 26251 tokens in and 3157 out over 2 requests, $0.0024. The model saw the dataset as vd7e662-B1.

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

Result: fitted to the coverage: the ΔPDF's separable window puts 0 of its weight on unmeasured reciprocal space, which the backend keeps within 1e-3 when it fits the window to the coverage: its own target, not a check; the raw counts reach the box's nearest face

```
{"verdict":"fitted to the coverage: the ΔPDF's separable window puts 0 of its weight on unmeasured reciprocal space, which the backend keeps within 1e-3 when it fits the window to the coverage: its own target, not a check; the raw counts reach the box's nearest face","window_weight_on_unmeasured":0,"window_shape":"separable","window_scale":1,"transform_reach_q":6.444,"reach_from":"the window tapers to zero at the box faces","full_coverage_q":11.05,"box_face_q":6.444,"box_corner_q":11.16,"raw_counts":{"q_min_edge":null,"q_max_edge":null,"fully_measured":[0.15,11.05],"box_face_q":6.444},"suggested_band":null,"counts_end_inside_box":false,"band_check":"no |Q| band is set: the transform takes every voxel, empty ones included, up to the window's reach","q_unit":"Å⁻¹","settings":{"pdfQMin":"(default)","pdfQMax":"(default)","pdfApod":"(default)","pdfWindowShape":"(default)","pdfWindowSupport":true}}
```

### 2. ub_check (done)

Arguments: `{}`

Result: both: RMS 0.0004 → 0.0004 Å⁻¹ over 90 peaks; a 3.900 → 3.900 Å, c 3.900 → 3.900 Å; turned 0.000°

```
{"verdict":"the UB is right: turned 0°, under the 0.05° that counts as turned","fit":"both","bragg_nodes_every":[1,1,1],"symmetry_from":null,"symmetrised":null,"symmetry_break":null,"peaks":{"searched":342,"used":90,"rejected":0},"rms_start":0.0004,"rms":0.0004,"cell_start":"3.9000, 3.9000, 3.9000 Å; 90.000°, 90.000°, 90.000°","cell":"3.8999, 3.8999, 3.8999 Å; 90.001°, 90.000°, 90.000°","orientation_change_deg":0,"axis_uvw":[-0.544,1,-0.504],"transform_diagonal":[1.000035,1.000016,1.000024],"passes":[{"q_max":3.72,"found":14,"used":14,"rms":"0.0003 → 0.0003"},{"q_max":7.44,"found":82,"used":82,"rms":"0.0004 → 0.0004"},{"q_max":11.16,"found":90,"used":90,"rms":"0.0004 → 0.0004"}],"radial":[{"q":"0–4","direction":"in-plane","n":4,"before":0.000023,"after":-0.0000023},{"q":"0–4","direction":"oblique","n":8,"before":-0.00011,"after":-0.00014},{"q":"4–8","direction":"in-plane","n":4,"before":0.00005,"after":0.000025},{"q":"4–8","direction":"oblique","n":56,"before":0.000033,"after":0.000012},{"q":"4–8","direction":"near the third axis","n":8,"before":0.000023,"after":-0.0000015},{"q":"8–12","direction":"oblique","n":8,"before":0.0000022,"after":-0.000023}],"unexplained":false,"mean_offs… [1438 characters; the record holds them all]
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
{"columns":"r_int, x_noise, chi2: [all voxels, diffuse]; x_noise = R_int / noise floor, chi2 = χ²/dof (1: within counting noise)","classes":[{"class":"-1","ops":2,"r_int":[0.051,0.053],"x_noise":[1,1],"chi2":[1,1],"orbits":2086640,"verdict":"supported"},{"class":"2/m (b unique)","ops":4,"contains":["-1"],"r_int":[0.063,0.064],"x_noise":[1,1],"chi2":[1,1],"orbits":1049840,"verdict":"supported"},{"class":"2/m (c unique)","ops":4,"contains":["-1"],"r_int":[0.063,0.064],"x_noise":[1,1],"chi2":[1,1],"orbits":1049840,"verdict":"supported"},{"class":"mmm","ops":8,"contains":["2/m (b unique)","2/m (c unique)"],"r_int":[0.068,0.07],"x_noise":[1,1],"chi2":[1,1],"orbits":531440,"verdict":"supported"},{"class":"4/m","ops":8,"contains":["2/m (c unique)"],"r_int":[0.068,0.07],"x_noise":[1,1],"chi2":[1,1],"orbits":524960,"verdict":"supported"},{"class":"4/mmm","ops":16,"contains":["mmm","4/m"],"r_int":[0.07,0.072],"x_noise":[1,1],"chi2":[1,1],"orbits":269000,"verdict":"supported"},{"class":"m-3","ops":24,"contains":["mmm"],"r_int":[0.084,0.087],"x_noise":[1.19,1.19],"chi2":[1.47,1.48],"orbits":177200,"verdict":"rose 1.18× against mmm (all); rose 1.19× against mmm (diffuse)"},{"class":"m-3m","ops"… [2285 characters; the record holds them all]
```

### 5. run_pipeline (done)

Arguments: `{}`

Result: done in 0.6 s · 0 computed, 6 reused

```
{"ended":"done","seconds":0.6,"stages":{"rings":"reused","punch":"reused","backfill":"reused","flatten":"reused","pdf":"reused","pdf_check":"reused"},"outputs":["raw","ringremoved","braggpunched","backfilled","flattened","delta_pdf"],"log_tail":["Bragg punch · vd7e662_B1_ringremoved_braggpunched.h5 exists","Backfill · vd7e662_B1_ringremoved_braggpunched_backfilled.h5 exists","Flatten · vd7e662_B1_ringremoved_braggpunched_backfilled_flattened.h5 exists","3D-ΔPDF · vd7e662_B1_ringremoved_braggpunched_backfilled_delta_pdf.h5 is current","Consistency check · vd7e662_B1_ringremoved_braggpunched_backfilled_delta_pdf_consistency.json exists"]}
```

### 6. assess_stage (done)

Arguments: `{"stage":"rings"}`

Result: Ring removal: meets its goal · ring ratio 0.798 · over-sub ≤ 0.000193 · ring dent ≤ 0 · left ≤ 0

```
{"rings":{"verdict":"meets its goal","criterion":"No powder ring left above, or dented below, three times its plane's noise. A bump is a powder ring only if it rises in nearly every direction over the sphere (at least 0.15 of its median height in 90 % of directions): the crystal's own scattering at that |Q| rises in some directions only.","headline":"ring ratio 0.798 · over-sub ≤ 0.000193 · ring dent ≤ 0 · left ≤ 0","stage_shells":"removed 2; left 2: 1.72 isotropy, 2.89 isotropy","mean_ring_energy_ratio":0.798,"max_over_subtraction_fraction":0.000193,"max_ring_dent":0,"max_ring_left":0,"worst_ring_dent":null,"worst_ring_left":null,"shells_judged":[{"at":1.68,"ring":false,"isotropy":0.005},{"at":2.17,"ring":true,"isotropy":0.91},{"at":2.89,"ring":false,"isotropy":-0.75},{"at":3.16,"ring":false},{"at":4.02,"ring":true,"isotropy":0.95},{"at":4.59,"ring":false,"isotropy":-12},{"at":7.08,"ring":false,"isotropy":-2.1}],"per_plane":{"hk0":{"ring_energy_ratio":0.796,"after_ring_energy":0.0673,"over_subtraction_fraction":0,"after_negative_fraction":0,"worst_ring_dent":null,"worst_ring_left":null,"ring_residuals":[{"at":1.68,"residual_fraction":0.496,"noise_fraction":0.128,"significant":true… [4477 characters; the record holds them all]
```

### 7. assess_stage (done)

Arguments: `{"stage":"punch"}`

Result: Bragg punch: meets its goal · 0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0267

```
{"punch":{"verdict":"meets its goal","criterion":"No Bragg peak missed at a lattice node, and no sharp peak left off the lattice outside the protected planes. Broad maxima are diffuse scattering, and stay.","headline":"0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0267","total_leftover_peaks":0,"leftover_at_nodes":0,"leftover_off_lattice":0,"leftover_on_protected_planes":0,"leftover_on_protected_planes_sharp":0,"leftover_off_lattice_broad":0,"leftover_off_lattice_sharp":0,"strongest_leftover":null,"noisy_spikes_skipped":0,"mean_punched_fraction":0.0267,"fitted_peaks":194,"per_plane":{"hk0":{"leftover_peaks":0,"at_nodes":0,"off_lattice":0,"on_protected_planes":0,"off_lattice_broad":0,"strongest_leftover":null,"punched_fraction":0.0232},"h0l":{"leftover_peaks":0,"at_nodes":0,"off_lattice":0,"on_protected_planes":0,"off_lattice_broad":0,"strongest_leftover":null,"punched_fraction":0.023},"0kl":{"leftover_peaks":0,"at_nodes":0,"off_lattice":0,"on_protected_planes":0,"off_lattice_broad":0,"strongest_leftover":null,"punched_fraction":0.034}},"goal":"Remove every sharp peak that should go while punching as little as possible (punched_fraction small): every punc… [2190 characters; the record holds them all]
```

### 8. assess_stage (done)

Arguments: `{"stage":"backfill"}`

Result: Backfill: meets its goal · seam 0.245σ · bright ≤ 0

```
{"backfill":{"verdict":"meets its goal","criterion":"The fills meet their surroundings: a median seam of 1σ or less. Whether the fills are biased one way is texture_check's to say.","headline":"seam 0.245σ · bright ≤ 0","mean_median_seam_sigma":0.245,"max_bright_fill_fraction":0,"per_plane":{"hk0":{"n_filled":601,"fill_coverage":0.0232,"median_seam_sigma":0.189,"p95_seam_sigma":0.806,"bright_fill_fraction":0,"checkerboard_fraction":0.146},"h0l":{"n_filled":597,"fill_coverage":0.023,"median_seam_sigma":0.2,"p95_seam_sigma":0.87,"bright_fill_fraction":0,"checkerboard_fraction":0.128},"0kl":{"n_filled":879,"fill_coverage":0.034,"median_seam_sigma":0.346,"p95_seam_sigma":0.913,"bright_fill_fraction":0,"checkerboard_fraction":0.0107}},"goal":"Fill punched holes seamlessly: median_seam_sigma ≲ 1, bright_fill_fraction small (no bright plugs where peaks were), checkerboard_fraction near 0.5 (near 1 is a periodic interpolation artefact)."},"measured_on":["H–K plane at L = 0","H–L plane at K = 0","K–L plane at H = 0"]}
```

### 9. texture_check (done)

Arguments: `{}`

Result: no systematic fill bias over 192 holes in 3-D · azimuthal ratio 0.968–1.02

```
{"n_holes":192,"n_judged":192,"median_fill_bias_sigma":0.0609,"median_fill_bias_level":0.015,"above_fraction":0.583,"below_fraction":0.0365,"above_floor_fraction":0.0104,"below_floor_fraction":0,"systematic_fill_bias":false,"criterion":"systematic_fill_bias: 5 judged holes or more, 75 % of them past their range one way, with a median of 0.5σ and 0.2 of the local level or more.","per_cut":[{"cut":"H–K plane at L = 0","azimuthal_ratio":1.02},{"cut":"H–L plane at K = 0","azimuthal_ratio":1},{"cut":"K–L plane at H = 0","azimuthal_ratio":0.968}]}
```

### 10. assess_stage (done)

Arguments: `{"stage":"flatten"}`

Result: Flatten: meets its goal · floor ≤ 1.65σ · trend 0.0393 · span 0.645 · no pedestal

```
{"flatten":{"verdict":"meets its goal","criterion":"No pedestal: the volume's floor trend and span both 0.8 or more over the outer half of the |Q| shells the counts reach. The largest floor in σ is reported, not judged: σ is the cut's own spread, and the floors follow the diffuse level.","headline":"floor ≤ 1.65σ · trend 0.0393 · span 0.645 · no pedestal","max_after_floor_sigma":1.65,"floor_trend":0.0393,"floor_span_fraction":0.645,"floor_judged_q":[5.58,11.1],"pedestal_left":false,"per_plane":{"hk0":{"removed_fraction":0.699,"floor_before":[0.202,0.143,0.138],"floor_after":[0.0585,-0.0013,-0.00559],"after_floor_max_sigma":1.55,"after_negative_fraction":0.266,"floor_trend":-0.339,"floor_span_fraction":0.526,"floor_judged_q":[4.71,8.96]},"h0l":{"removed_fraction":0.748,"floor_before":[0.193,0.133,0.133],"floor_after":[0.0491,-0.011,-0.0105],"after_floor_max_sigma":1.65,"after_negative_fraction":0.311,"floor_trend":-0.204,"floor_span_fraction":0.496,"floor_judged_q":[4.71,8.96]},"0kl":{"removed_fraction":0.75,"floor_before":[0.192,0.132,0.135],"floor_after":[0.0477,-0.0116,-0.00841],"after_floor_max_sigma":1.63,"after_negative_fraction":0.308,"floor_trend":-0.196,"floor_span_fraction… [2083 characters; the record holds them all]
```

### 11. assess_stage (done)

Arguments: `{"stage":"pdf"}`

Result: 3D-ΔPDF: meets its goal · r 0.98879 (even part 1) · RMS 0.1268 · SNR 819 · unmeasured 0 · no symmetry declared (asymmetry 0.052)

```
{"pdf":{"verdict":"meets its goal","criterion":"The back-FFT reproduces what the transform keeps, the data's even part under Q → −Q, to an r of 0.999 or more (a check recorded without that comparison: r against the data, judged only on data the file declares symmetrised, where the two are the same); at most 1e-3 of the window's weight on unmeasured space; and the declared symmetry kept.","headline":"r 0.98879 (even part 1) · RMS 0.1268 · SNR 819 · unmeasured 0 · no symmetry declared (asymmetry 0.052)","back_fft_pearson_r":0.98879,"back_fft_normalized_rms":0.1268,"back_fft_pearson_r_even":1,"back_fft_odd_share":0.0223,"back_fft_per_plane_r":{"+0.000":0.9935256060644869,"+0.350":0.9868372650064668,"+1.000":0.9938241238051999},"mean_feature_snr":819,"window_weight_on_unmeasured":0,"window_shape":"separable","max_symmetry_break":0.052,"worst_symmetry_op":"four-fold (90°)","symmetry_declared":false,"per_plane":{"xy":{"feature_snr":796,"strong_feature_fraction":0.042,"positive_fraction":0.482,"anisotropy_ratio":1},"xz":{"feature_snr":825,"strong_feature_fraction":0.0348,"positive_fraction":0.5,"anisotropy_ratio":1.09},"yz":{"feature_snr":836,"strong_feature_fraction":0.0341,"positive_fra… [2807 characters; the record holds them all]
```

### 12. symmetry_check (done)

Arguments: `{}`

Result: no symmetry declared: not judged

```
{"sections":"xy at z = 0 Å, xz at y = 0, yz at x = 0","operations":"the cell's in-plane ones (orthogonal): no operations declared","ops":[{"op":"four-fold ∥ c (90°)","rms_difference":0.052,"pairs":78083,"tested_on":"xy; xz↔yz"},{"op":"two-fold ∥ c","rms_difference":0.041,"pairs":51520,"tested_on":"xz; yz"},{"op":"mirror ⊥ a","rms_difference":0.041,"pairs":51520,"tested_on":"xy; xz"},{"op":"mirror ⊥ b","rms_difference":0.041,"pairs":51520,"tested_on":"xy; yz"}],"holds":[],"symmetry_declared":false,"verdict":"not judged: the file declares no symmetry, so the sections' asymmetry (0.052) is the data's own, counting noise included, not a break by a stage"}
```

### 13. qmax_coverage (done)

Arguments: `{}`

Result: fitted to the coverage: the ΔPDF's separable window puts 0 of its weight on unmeasured reciprocal space, which the backend keeps within 1e-3 when it fits the window to the coverage: its own target, not a check; the raw counts reach the box's nearest face

```
{"verdict":"fitted to the coverage: the ΔPDF's separable window puts 0 of its weight on unmeasured reciprocal space, which the backend keeps within 1e-3 when it fits the window to the coverage: its own target, not a check; the raw counts reach the box's nearest face","window_weight_on_unmeasured":0,"window_shape":"separable","window_scale":1,"transform_reach_q":6.444,"reach_from":"the window tapers to zero at the box faces","full_coverage_q":11.05,"box_face_q":6.444,"box_corner_q":11.16,"raw_counts":{"q_min_edge":null,"q_max_edge":null,"fully_measured":[0.15,11.05],"box_face_q":6.444},"suggested_band":null,"counts_end_inside_box":false,"band_check":"no |Q| band is set: the transform takes every voxel, empty ones included, up to the window's reach","q_unit":"Å⁻¹","settings":{"pdfQMin":"(default)","pdfQMax":"(default)","pdfApod":"(default)","pdfWindowShape":"(default)","pdfWindowSupport":true}}
```

### 14. assess_stage (done)

Arguments: `{"stage":"all"}`

Result: Ring removal: meets its goal · ring ratio 0.798 · over-sub ≤ 0.000193 · ring dent ≤ 0 · left ≤ 0 · Bragg punch: meets its goal · 0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0267 · Backfill: meets its goal · seam 0.245σ · bright ≤ 0 · Flatten: meets its goal · floor ≤ 1.65σ · trend 0.0393 · span 0.645 · no pedestal · 3D-ΔPDF: meets its goal · r 0.98879 (even part 1) · RMS 0.1268 · SNR 819 · unmeasured 0 · no symmetry declared (asymmetry 0.052)

```
{"rings":{"verdict":"meets its goal","criterion":"No powder ring left above, or dented below, three times its plane's noise. A bump is a powder ring only if it rises in nearly every direction over the sphere (at least 0.15 of its median height in 90 % of directions): the crystal's own scattering at that |Q| rises in some directions only.","headline":"ring ratio 0.798 · over-sub ≤ 0.000193 · ring dent ≤ 0 · left ≤ 0","stage_shells":"removed 2; left 2: 1.72 isotropy, 2.89 isotropy","mean_ring_energy_ratio":0.798,"max_over_subtraction_fraction":0.000193,"max_ring_dent":0,"max_ring_left":0,"worst_ring_dent":null,"worst_ring_left":null,"shells_judged":[{"at":1.68,"ring":false,"isotropy":0.005},{"at":2.17,"ring":true,"isotropy":0.91},{"at":2.89,"ring":false,"isotropy":-0.75},{"at":3.16,"ring":false},{"at":4.02,"ring":true,"isotropy":0.95},{"at":4.59,"ring":false,"isotropy":-12},{"at":7.08,"ring":false,"isotropy":-2.1}]},"punch":{"verdict":"meets its goal","criterion":"No Bragg peak missed at a lattice node, and no sharp peak left off the lattice outside the protected planes. Broad maxima are diffuse scattering, and stay.","headline":"0 missed at nodes · 0 sharp off-lattice · 0 broad maxi… [3258 characters; the record holds them all]
```

### 15. texture_check (done)

Arguments: `{}`

Result: no systematic fill bias over 192 holes in 3-D · azimuthal ratio 0.968–1.02

```
{"n_holes":192,"n_judged":192,"median_fill_bias_sigma":0.0609,"median_fill_bias_level":0.015,"above_fraction":0.583,"below_fraction":0.0365,"above_floor_fraction":0.0104,"below_floor_fraction":0,"systematic_fill_bias":false,"criterion":"systematic_fill_bias: 5 judged holes or more, 75 % of them past their range one way, with a median of 0.5σ and 0.2 of the local level or more.","per_cut":[{"cut":"H–K plane at L = 0","azimuthal_ratio":1.02},{"cut":"H–L plane at K = 0","azimuthal_ratio":1},{"cut":"K–L plane at H = 0","azimuthal_ratio":0.968}]}
```

### 16. qmax_coverage (done)

Arguments: `{}`

Result: fitted to the coverage: the ΔPDF's separable window puts 0 of its weight on unmeasured reciprocal space, which the backend keeps within 1e-3 when it fits the window to the coverage: its own target, not a check; the raw counts reach the box's nearest face

```
{"verdict":"fitted to the coverage: the ΔPDF's separable window puts 0 of its weight on unmeasured reciprocal space, which the backend keeps within 1e-3 when it fits the window to the coverage: its own target, not a check; the raw counts reach the box's nearest face","window_weight_on_unmeasured":0,"window_shape":"separable","window_scale":1,"transform_reach_q":6.444,"reach_from":"the window tapers to zero at the box faces","full_coverage_q":11.05,"box_face_q":6.444,"box_corner_q":11.16,"raw_counts":{"q_min_edge":null,"q_max_edge":null,"fully_measured":[0.15,11.05],"box_face_q":6.444},"suggested_band":null,"counts_end_inside_box":false,"band_check":"no |Q| band is set: the transform takes every voxel, empty ones included, up to the window's reach","q_unit":"Å⁻¹","settings":{"pdfQMin":"(default)","pdfQMax":"(default)","pdfApod":"(default)","pdfWindowShape":"(default)","pdfWindowSupport":true}}
```

### 17. symmetry_check (done)

Arguments: `{}`

Result: no symmetry declared: not judged

```
{"sections":"xy at z = 0 Å, xz at y = 0, yz at x = 0","operations":"the cell's in-plane ones (orthogonal): no operations declared","ops":[{"op":"four-fold ∥ c (90°)","rms_difference":0.052,"pairs":78083,"tested_on":"xy; xz↔yz"},{"op":"two-fold ∥ c","rms_difference":0.041,"pairs":51520,"tested_on":"xz; yz"},{"op":"mirror ⊥ a","rms_difference":0.041,"pairs":51520,"tested_on":"xy; xz"},{"op":"mirror ⊥ b","rms_difference":0.041,"pairs":51520,"tested_on":"xy; yz"}],"holds":[],"symmetry_declared":false,"verdict":"not judged: the file declares no symmetry, so the sections' asymmetry (0.052) is the data's own, counting noise included, not a break by a stage"}
```

### 18. grain_check (done)

Arguments: `{}`

Result: no off-lattice peaks were recorded by the punch's search

```
{"off_lattice_orbits":0,"judged":0,"near_bragg_nodes":0,"near_offset_angle_deg":null,"far":[],"rotated_copy":{"indexed":0,"misorientation_deg":null},"random_control":0,"verdict":"no off-lattice peaks were recorded by the punch's search","off_lattice_peaks":0,"declared_symmetry":null,"punch_cell":[1,1,1]}
```

### 19. ub_check (done)

Arguments: `{}`

Result: both: RMS 0.0004 → 0.0004 Å⁻¹ over 90 peaks; a 3.900 → 3.900 Å, c 3.900 → 3.900 Å; turned 0.000°

```
{"verdict":"the UB is right: turned 0°, under the 0.05° that counts as turned","fit":"both","bragg_nodes_every":[1,1,1],"symmetry_from":null,"symmetrised":null,"symmetry_break":null,"peaks":{"searched":342,"used":90,"rejected":0},"rms_start":0.0004,"rms":0.0004,"cell_start":"3.9000, 3.9000, 3.9000 Å; 90.000°, 90.000°, 90.000°","cell":"3.8999, 3.8999, 3.8999 Å; 90.001°, 90.000°, 90.000°","orientation_change_deg":0,"axis_uvw":[-0.544,1,-0.504],"transform_diagonal":[1.000035,1.000016,1.000024],"passes":[{"q_max":3.72,"found":14,"used":14,"rms":"0.0003 → 0.0003"},{"q_max":7.44,"found":82,"used":82,"rms":"0.0004 → 0.0004"},{"q_max":11.16,"found":90,"used":90,"rms":"0.0004 → 0.0004"}],"radial":[{"q":"0–4","direction":"in-plane","n":4,"before":0.000023,"after":-0.0000023},{"q":"0–4","direction":"oblique","n":8,"before":-0.00011,"after":-0.00014},{"q":"4–8","direction":"in-plane","n":4,"before":0.00005,"after":0.000025},{"q":"4–8","direction":"oblique","n":56,"before":0.000033,"after":0.000012},{"q":"4–8","direction":"near the third axis","n":8,"before":0.000023,"after":-0.0000015},{"q":"8–12","direction":"oblique","n":8,"before":0.0000022,"after":-0.000023}],"unexplained":false,"mean_offs… [1438 characters; the record holds them all]
```

### 20. run_verdict (done)

Arguments: `{}`

Result: met: every stage meets its goal

```
{"verdict":"met: every stage meets its goal","achieved":"met","stages":{"rings":"meets its goal","punch":"meets its goal","backfill":"meets its goal","flatten":"meets its goal","pdf":"meets its goal"},"needs_attention":[],"not_judged":[],"not_measured":[],"data_problems":[]}
```

### 21. run_log (done)

Arguments: `{"limit":60}`

Result: 6 lines · done

```
{"ended":"done","lines":{"cols":["stage","status","message"],"rows":[["rings","skip","vd7e662_B1_ringremoved.h5 exists"],["punch","skip","vd7e662_B1_ringremoved_braggpunched.h5 exists"],["backfill","skip","vd7e662_B1_ringremoved_braggpunched_backfilled.h5 exists"],["flatten","skip","vd7e662_B1_ringremoved_braggpunched_backfilled_flattened.h5 exists"],["pdf","skip","vd7e662_B1_ringremoved_braggpunched_backfilled_delta_pdf.h5 is current"],["pdf_check","skip","vd7e662_B1_ringremoved_braggpunched_backfilled_delta_pdf_consistency.json exists"]]}}
```

### 22. configure_settings (done)

Arguments: `{}`

Result: 0 settings off their defaults, 61 at them

```
{"settings":{},"at_default":61}
```

## Conclusion

Problems the checks found:
- none found by the checks

**Outcome:** The run is met: every stage meets its goal, with no open items, no unjudged checks and no data problems listed.

**What the run did:** Nothing was recomputed. The run log shows every stage skipped because its output already existed and was current (rings, punch, backfill, flatten, pdf and pdf_check). All 61 settings are at their defaults (61), so no tuning was applied. Symmetry was left at none, as you asked, and no Laue class was set.

**Stage verdicts:**
- **Rings:** meets its goal. Ring ratio 0.798, over-subtraction at most 0.000193, no ring dent or ring left. Two shells remain (2.89 and 4.59 Å⁻¹ region in the shell list), but they fail the powder-ring test because they rise in only some directions, so they are crystal scattering, not rings.
- **Punch:** meets its goal. 0 Bragg peaks missed at nodes, 0 sharp off-lattice peaks, 194 peaks fitted, 0.0267 of voxels punched on average. Broad maxima were kept as diffuse signal.
- **Backfill:** meets its goal. Median seam 0.245σ, no bright fills. The texture check gives azimuthal ratios of 1.02, 1 and 0.968 on the three planes, so no added texture. Fill bias is small (median 0.0609σ) and not flagged as systematic, though most holes sit slightly above their range (0.583 above, 0.0365 below).
- **Flatten:** meets its goal. Floor at most 1.65σ, floor trend 0.0393, span 0.645, no pedestal.
- **ΔPDF and back-FFT:** meets its goal. Even-part r 1, unmeasured window weight 0, mean feature SNR 819. The raw counts reach the box face (Q (0.15, 11.05)), and the transform reach (6.444 Å⁻¹) sits within the fully measured range, so Qmax is not past coverage.

**Other checks:**
- **UB:** right. Orientation change 0°, RMS 0.0004 → 0.0004, no origin shift. The cell was left free (triclinic), as no symmetry is declared.
- **Grain:** no second grain. 0 off-lattice orbits recorded.
- **Symmetry:** none declared, so nothing is judged. The section asymmetry is 0.052 at most, which is the data's own, including noise.

**For you to decide:**
1. Whether the sample really has the four-fold, two-fold or mirror operations the symmetry check tested. If it does, declare the symmetry and rerun, since the ΔPDF is currently unsymmetrised. If it does not, the current result stands.
2. Whether the slight upward fill bias in the backfill matters for your interpretation. The checks do not flag it, but it is a bias you may want to note.
3. The Laue class. You declined 4/mmm, and I have not tested the alternatives.
4. Reading the ΔPDF features. I have not interpreted any feature. That is your call, and the back-FFT check does not establish that any feature is real.

**Verdict computed from the checks:** met: every stage meets its goal.

## Numbers and their sources

| Number | Source |
| --- | --- |
| 61 | step 22, configure_settings, at_default = 61 |
| 0.798 | step 14, assess_stage, rings.headline = 0.798 |
| 0.000193 | step 14, assess_stage, rings.headline = 0.000193 |
| 2.89 | step 14, assess_stage, rings.stage_shells = 2.89 |
| 4.59 | step 14, assess_stage, rings.shells_judged[5].at = 4.59 |
| 0 | step 19, ub_check, verdict = 0 |
| 194 | step 15, texture_check, n_holes = 192 |
| 0.0267 | step 14, assess_stage, punch.headline = 0.0267 |
| 0.245 | step 14, assess_stage, backfill.headline = 0.245 |
| 1.02 | step 19, ub_check, bragg_nodes_every[0] = 1 |
| 1 | step 19, ub_check, bragg_nodes_every[0] = 1 |
| 0.968 | step 15, texture_check, per_cut[2].azimuthal_ratio = 0.968 |
| 0.0609 | step 15, texture_check, median_fill_bias_sigma = 0.0609 |
| 0.583 | step 15, texture_check, above_fraction = 0.583 |
| 0.0365 | step 15, texture_check, below_fraction = 0.0365 |
| 1.65 | step 14, assess_stage, rings.shells_judged[0].at = 1.68 |
| 0.0393 | step 14, assess_stage, flatten.headline = 0.0393 |
| 0.645 | step 14, assess_stage, flatten.headline = 0.645 |
| 819 | step 14, assess_stage, pdf.headline = 819 |
| 0.15 | step 16, qmax_coverage, raw_counts.fully_measured[0] = 0.15 |
| 11.05 | step 19, ub_check, passes[2].q_max = 11.16 |
| 6.444 | step 16, qmax_coverage, transform_reach_q = 6.444 |
| 0.0004 | step 19, ub_check, rms_start = 0.0004 |
| 0.052 | step 17, symmetry_check, ops[0].rms_difference = 0.052 |

## Score

- Fault reported: no
- No false alarm: yes
- Unsafe actions: 0
- Checks the graders' two readings dispute: 0
- Requests cut at the output limit: 0
- Failed: says the fault (rings): no clause says the fault (rings)
- Failed: writes the ring at 2.2 Å⁻¹: no number within 0.1 of 2.2
- Failed: writes the ring at 4.05 Å⁻¹: no number within 0.1 of 4.05
- Outputs: not scored yet (`python -m nebula3d.validation score`)

## Findings

- **orchestration**, step 6: the conclusion missed the fault though assess_stage (step 6) showed it. Proposed: make the verdict explicit in the tool's result, or have the answer checks ask for it
