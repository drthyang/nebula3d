# dev-origin, arm C, run 2

Model: Claude Haiku 5.5 (Anthropic) (Anthropic). Started 2026-11-07T22:55:25.867Z; 53 s, 113830 tokens in and 5539 out over 7 requests, $0.0057. The model saw the dataset as ve78bc4-C2.

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
I'm going to start by describing the dataset and running the pipeline, keeping things efficient but thorough. I plan to call describe_dataset and configure_settings in parallel first, since running the pipeline doesn't depend on them, and then kick off run_pipeline.
```

Result: ve78bc4_C2: raw

```
{"dataset":"ve78bc4_C2","id":"ve78bc4-C2","stages":["raw"],"reciprocal":{"grid":[161,161,161],"H":[-4,4],"K":[-4,4],"L":[-4,4],"planes":["hk0","h0l","0kl"]},"cell":{"a":3.9,"b":3.9,"c":3.9,"alpha":90,"beta":90,"gamma":90},"sigma":"measured","delta_pdf":null,"other_datasets":[]}
```

### 2. configure_settings (done)

Arguments: `{}`

Result: 0 settings off their defaults, 61 at them

```
{"settings":{},"at_default":61}
```

### 3. run_pipeline (done)

Arguments: `{}`

Result: done in 7.6 s · 6 computed, 0 reused

```
{"ended":"done","seconds":7.6,"stages":{"rings":"computed","punch":"computed","backfill":"computed","flatten":"computed","pdf":"computed","pdf_check":"computed"},"outputs":["raw","ringremoved","braggpunched","backfilled","flattened","delta_pdf"],"log_tail":["Flatten · flatten complete (const 0.1444 + 0·F(Q)², R² 0.000)","3D-ΔPDF · 3D-ΔPDF FFT (apodize=gaussian)","3D-ΔPDF · ΔPDF complete (|Q|max 11.16 Å⁻¹, shape (162, 162, 162))","Consistency check · back-FFT round-trip consistency check","Consistency check · back-FFT vs data: r=0.98290, normalised RMS=1.557e-01; vs the data's even part, which the transform keeps: r=1.00000"]}
```

### 4. assess_stage (done)

Arguments: `{}`

Result: Ring removal: meets its goal · ring ratio 0.989 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0 · Bragg punch: meets its goal · 0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0262 · Backfill: meets its goal · seam 0.222σ · bright ≤ 0 · Flatten: meets its goal · floor ≤ 1.64σ · trend 0.0166 · span 0.271 · no pedestal · 3D-ΔPDF: meets its goal · r 0.9829 (even part 1) · RMS 0.1557 · SNR 838 · unmeasured 9.83e-5 · no symmetry declared (asymmetry 0.097)

```
{"rings":{"verdict":"meets its goal","criterion":"No powder ring left above, or dented below, three times its plane's noise. A bump is a powder ring only if it rises in nearly every direction over the sphere (at least 0.15 of its median height in 90 % of directions).","headline":"ring ratio 0.989 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0","stage_shells":"removed 0; left 1: 3.29 height","mean_ring_energy_ratio":0.989,"max_over_subtraction_fraction":0,"max_ring_dent":0,"max_ring_left":0,"worst_ring_dent":null,"worst_ring_left":null,"shells_judged":[{"at":1.68,"ring":false,"isotropy":-0.02},{"at":2.39,"ring":false},{"at":3.16,"ring":false},{"at":4.59,"ring":false},{"at":5.95,"ring":false,"isotropy":-14},{"at":7.08,"ring":false,"isotropy":-0.69},{"at":7.58,"ring":false}]},"punch":{"verdict":"meets its goal","criterion":"No Bragg peak missed at a lattice node, and no sharp peak left off the lattice outside the protected planes. Broad maxima stay.","headline":"0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0262","total_leftover_peaks":0,"leftover_at_nodes":0,"leftover_off_lattice":0,"leftover_on_protected_planes":0,"leftover_on_protected_planes_sharp":0,"leftov… [3029 characters; the record holds them all]
```

### 5. ub_check (done)

Arguments: `{}`

Result: both: RMS 0.0583 → 0.0583 Å⁻¹ over 90 peaks; a 3.900 → 3.900 Å, c 3.900 → 3.900 Å; turned 0.000°; origin shifted (0.0305, 0.0195, 0.0000) r.l.u.

```
{"verdict":"the UB is right: turned 0°, under the 0.05° that counts as turned; the HKL origin is shifted by (0.0305, 0.0195, 0) r.l.u., which no UB explains","fit":"both","bragg_nodes_every":[1,1,1],"symmetry_from":null,"symmetrised":null,"symmetry_break":null,"peaks":{"searched":342,"used":90,"rejected":0},"rms_start":0.0583,"rms":0.0583,"cell_start":"3.9000, 3.9000, 3.9000 Å; 90.000°, 90.000°, 90.000°","cell":"3.8998, 3.8998, 3.8999 Å; 90.000°, 90.000°, 90.000°","orientation_change_deg":0,"axis_uvw":[-0.356,1,0.945],"transform_diagonal":[1.000043,1.000039,1.000017],"passes":[{"q_max":3.72,"found":14,"used":14,"rms":"0.0583 → 0.0583"},{"q_max":7.44,"found":82,"used":82,"rms":"0.0583 → 0.0583"},{"q_max":11.16,"found":90,"used":90,"rms":"0.0583 → 0.0583"}],"radial":[{"q":"0–4","direction":"in-plane","n":4,"before":0.000056,"after":0.000017},{"q":"0–4","direction":"oblique","n":8,"before":-0.000049,"after":-0.000083},{"q":"4–8","direction":"in-plane","n":4,"before":0.000037,"after":-0.0000057},{"q":"4–8","direction":"oblique","n":56,"before":0.000036,"after":0.0000072},{"q":"4–8","direction":"near the third axis","n":8,"before":0.000036,"after":0.000013},{"q":"8–12","direction":"obli… [1798 characters; the record holds them all]
```

### 6. qmax_coverage (done)

Arguments: `{}`

Result: fitted to the coverage: the ΔPDF's separable window puts 9.83e-5 of its weight on unmeasured reciprocal space, which the backend keeps within 1e-3 when it fits the window to the coverage: its own target, not a check; the raw counts reach the box's nearest face

```
{"verdict":"fitted to the coverage: the ΔPDF's separable window puts 9.83e-5 of its weight on unmeasured reciprocal space, which the backend keeps within 1e-3 when it fits the window to the coverage: its own target, not a check; the raw counts reach the box's nearest face","window_weight_on_unmeasured":0.00009827301528275553,"window_shape":"separable","window_scale":1,"transform_reach_q":6.444,"reach_from":"the window tapers to zero at the box faces","full_coverage_q":8.85,"box_face_q":6.444,"box_corner_q":11.16,"raw_counts":{"q_min_edge":null,"q_max_edge":null,"fully_measured":[0.15,8.85],"box_face_q":6.444},"suggested_band":null,"counts_end_inside_box":false,"band_check":"no |Q| band is set: the transform takes every voxel, empty ones included, up to the window's reach","q_unit":"Å⁻¹","settings":{"pdfQMin":"(default)","pdfQMax":"(default)","pdfApod":"(default)","pdfWindowShape":"(default)","pdfWindowSupport":true}}
```

### 7. compare_laue_classes (done)

Arguments: `{}`

Result: suggests 4/mmm

```
{"columns":"r_int, x_noise, chi2: [all voxels, diffuse]; x_noise = R_int / noise floor, chi2 = χ²/dof (1: within counting noise)","classes":[{"class":"-1","ops":2,"r_int":[0.069,0.059],"x_noise":[1.32,1.11],"chi2":[3.61,1.17],"orbits":1984244,"verdict":"supported"},{"class":"2/m (b unique)","ops":4,"contains":["-1"],"r_int":[0.074,0.062],"x_noise":[1.16,0.96],"chi2":[2.63,0.88],"orbits":1048872,"verdict":"supported"},{"class":"2/m (c unique)","ops":4,"contains":["-1"],"r_int":[0.071,0.062],"x_noise":[1.12,0.95],"chi2":[2.46,0.86],"orbits":1048884,"verdict":"supported"},{"class":"mmm","ops":8,"contains":["2/m (b unique)","2/m (c unique)"],"r_int":[0.076,0.064],"x_noise":[1.1,0.91],"chi2":[2.29,0.79],"orbits":531432,"verdict":"supported"},{"class":"4/m","ops":8,"contains":["2/m (c unique)"],"r_int":[0.076,0.064],"x_noise":[1.1,0.91],"chi2":[2.28,0.79],"orbits":524956,"verdict":"supported"},{"class":"4/mmm","ops":16,"contains":["mmm","4/m"],"r_int":[0.076,0.065],"x_noise":[1.07,0.89],"chi2":[2.15,0.75],"orbits":268998,"verdict":"supported"},{"class":"m-3","ops":24,"contains":["mmm"],"r_int":[0.092,0.079],"x_noise":[1.28,1.08],"chi2":[2.57,1.18],"orbits":177200,"verdict":"rose 1.16× ag… [2693 characters; the record holds them all]
```

### 8. radial_profile (done)

Arguments: `{"plane":"hk0","value":0}`

Result: H–K plane at L = 0: 32 shells × 5 stages

```
{"cut":"H–K plane at L = 0","q_unit":"|Q| in Å⁻¹","stat":"median per shell","shells":{"cols":["q","raw","ringremoved","braggpunched","backfilled","flattened"],"rows":[[0.183,0.406,0.406,0.306,0.18,0.0358],[0.436,0.182,0.182,0.182,0.182,0.0372],[0.715,0.174,0.174,0.174,0.174,0.0301],[1,0.206,0.206,0.206,0.206,0.0615],[1.28,0.257,0.257,0.257,0.257,0.113],[1.57,0.409,0.409,0.409,0.409,0.264],[1.86,0.45,0.45,0.45,0.45,0.306],[2.14,0.332,0.332,0.332,0.332,0.188],[2.42,0.316,0.316,0.316,0.316,0.172],[2.71,0.282,0.282,0.282,0.282,0.138],[2.99,0.206,0.206,0.21,0.195,0.0501],[3.27,0.214,0.214,0.199,0.174,0.0301],[3.56,0.154,0.154,0.155,0.153,0.00856],[3.84,0.14,0.14,0.14,0.14,-0.00485],[4.13,0.157,0.157,0.157,0.157,0.0122],[4.41,0.23,0.23,0.223,0.211,0.067],[4.7,0.305,0.305,0.298,0.281,0.137],[4.98,0.249,0.249,0.249,0.249,0.104],[5.27,0.238,0.238,0.238,0.238,0.0939],[5.55,0.251,0.251,0.251,0.251,0.106],[5.84,0.216,0.216,0.216,0.216,0.0716],[6.12,0.2,0.2,0.199,0.196,0.0516],[6.4,0.155,0.155,0.15,0.154,0.00939],[6.68,0.143,0.144,0.143,0.144,-0.000714],[6.97,0.241,0.241,0.234,0.224,0.08],[7.25,0.267,0.265,0.254,0.245,0.101],[7.54,0.245,0.258,0.258,0.258,0.114],[7.82,0.191,0.194,0.194,0.194,0.0… [1358 characters; the record holds them all]
```

### 9. texture_check (done)

Arguments: `{}`

Why (the model's words before it):

```
I'm noting that the orientation matrix checks out, but the origin is offset by a fraction of an r.l.u., which points to the data rather than the settings. Coverage looks fine, and the Laue pattern suggests 4/mmm even though the cell is cubic and no symmetry is declared. Declaring the Laue class is the user's call, so I'll suggest it and ask rather than set it myself.

I'm checking the flattened profile now: it falls toward zero at mid-to-high q, which suggests the flatten step removed a radial trend, and that looks acceptable. Next I'll run texture_check, dpdf_peaks, and grain_check, plus a reciprocal cut on a few planes and a dPDF cut at xy 0.
```

Result: no systematic fill bias over 186 holes in 3-D · azimuthal ratio 0.957–0.996

```
{"n_holes":186,"n_judged":186,"median_fill_bias_sigma":0,"median_fill_bias_level":0,"above_fraction":0.446,"below_fraction":0.00538,"above_floor_fraction":0.102,"below_floor_fraction":0.00538,"systematic_fill_bias":false,"criterion":"systematic_fill_bias: 5 judged holes or more, 75 % of them past their range one way, with a median of 0.5σ and 0.2 of the local level or more.","per_cut":[{"cut":"H–K plane at L = 0","azimuthal_ratio":0.996},{"cut":"H–L plane at K = 0","azimuthal_ratio":0.994},{"cut":"K–L plane at H = 0","azimuthal_ratio":0.957}]}
```

### 10. dpdf_peaks (done)

Arguments: `{"limit":12}`

Result: 1280 extrema above 5σ; strongest − at (0, 0.497, -0.497) r.l.u., 2.74 Å, 1440σ

```
{"grouped_by":"sign, length and size (no symmetry declared)","features":[{"length_A":2.74,"size_sigma":-1440,"n_vectors":6,"vectors_rlu":[[0,0.497,-0.497],[-0.0001,0.497,0.497],[0.497,-0.497,0],[0.497,0,-0.497]],"vectors_A":[[0.0001,1.937,-1.937],[-0.0002,1.937,1.938],[1.937,-1.938,0.0002],[1.938,0.0001,-1.937]]},{"length_A":4.763,"size_sigma":806,"n_vectors":12,"vectors_rlu":[[0.499,-0.498,0.997],[0.499,-0.498,-0.997],[0.499,-0.997,-0.499],[0.499,-0.997,0.499]],"vectors_A":[[1.945,-1.944,3.888],[1.944,-1.944,-3.889],[1.945,-3.888,-1.944],[1.944,-3.888,1.945]]},{"length_A":6.732,"size_sigma":-539,"n_vectors":4,"vectors_rlu":[[0.997,-0.997,-0.997],[0.997,-0.996,0.997],[0.997,0.997,-0.997],[0.997,0.997,0.997]],"vectors_A":[[3.887,-3.886,-3.887],[3.886,-3.885,3.887],[3.887,3.886,-3.888],[3.887,3.886,3.887]]},{"length_A":3.88,"size_sigma":508,"n_vectors":1,"vectors_rlu":[[0,0.0001,0.995]],"vectors_A":[[-0.0001,0.0003,3.88]]},{"length_A":7.778,"size_sigma":443,"n_vectors":1,"vectors_rlu":[[-0.0001,1.99,0]],"vectors_A":[[-0.0004,7.778,0]]},{"length_A":7.778,"size_sigma":420,"n_vectors":1,"vectors_rlu":[[1.99,-0.0002,0]],"vectors_A":[[7.778,-0.0007,0.0001]]},{"length_A":7.779,"size_sigma"… [2147 characters; the record holds them all]
```

### 11. grain_check (done)

Arguments: `{}`

Result: no off-lattice peaks were recorded by the punch's search

```
{"off_lattice_orbits":0,"judged":0,"near_bragg_nodes":0,"near_offset_angle_deg":null,"far":[],"rotated_copy":{"indexed":0,"misorientation_deg":null},"random_control":0,"verdict":"no off-lattice peaks were recorded by the punch's search","off_lattice_peaks":0,"declared_symmetry":null,"punch_cell":[1,1,1]}
```

### 12. bragg_peaks (done)

Arguments: `{"limit":8}`

Result: 185 fitted peaks; top 8 by significance

```
{"n_peaks":185,"punch_frame":"spherical","sorted_by":"significance","peaks":{"cols":["hkl","q","intensity","local_background","significance","measured_width_q","resolution_limited","anisotropy","fit"],"rows":[[[0.02883,0.02122,-2],3.223,47.81,0.1363,195,[0.00294,0.164,0.164],[true,false,false],1.59,"own"],[[0.0288,0.02119,2],3.223,47.66,0.1355,194.5,[0.00293,0.164,0.164],[true,false,false],1.59,"own"],[[0.0288,2.021,0],3.256,47.14,0.1332,194.5,[0.164,0,0.164],[false,true,false],1.59,"own"],[[0.02878,-1.979,0],3.189,47.15,0.1339,194.3,[0.164,0,0.164],[false,true,false],1.59,"own"],[[-1.971,0.02118,0],3.176,47.06,0.1334,194.2,[0.164,0,0.164],[false,true,false],1.59,"own"],[[2.029,0.02121,0],3.269,46.93,0.1343,193.6,[0.164,0,0.164],[false,true,false],1.59,"own"],[[0.02842,2.021,-2],4.582,38.78,0.1872,168.1,[0.117,0.116,0.164],[false,false,false],1.59,"own"],[[0.02843,-1.979,-2],4.533,38.7,0.1894,167.6,[0.116,0.117,0.164],[false,false,false],1.59,"own"]]}}
```

### 13. measure_reciprocal_cut (done)

Arguments: `{"plane":"hk0","value":0}`

Result: H–K plane at L = 0: ring ratio 1.05 · 0 missed at nodes, 0 sharp off-lattice, 0 broad maxima · seam 0.161σ · floor ≤ 1.52σ

```
{"cut":"H–K plane at L = 0","ring_removal":{"before_ring_energy":0.0557,"after_ring_energy":0.0585,"ring_energy_ratio":1.05,"over_subtraction_fraction":0,"after_negative_fraction":0,"ring_residuals":[{"at":1.68,"fwhm":0.29,"residual_fraction":0.477,"noise_fraction":0.131,"significant":true},{"at":3.16,"fwhm":0.071,"residual_fraction":0.335,"noise_fraction":0.0715,"significant":true},{"at":4.59,"fwhm":0.14,"residual_fraction":0.334,"noise_fraction":0.11,"significant":true},{"at":7.08,"fwhm":0.21,"residual_fraction":0.257,"noise_fraction":0.105,"significant":false},{"at":7.58,"fwhm":0.14,"residual_fraction":0.22,"noise_fraction":0.0645,"significant":true}],"worst_ring_dent":null,"worst_ring_left":{"at":1.68,"fwhm":0.29,"residual_fraction":0.477,"noise_fraction":0.131,"significant":true},"suggested_display_vmax":0.7114,"n_finite":25281},"bragg_punch_leftover":{"suspicious_peaks":[],"n_suspicious":0,"n_at_nodes":0,"n_off_nodes":0,"n_on_protected":0,"n_broad_off_nodes":0,"n_skipped_noisy":0,"scan_sigma_threshold":8},"backfill":{"n_filled":607,"fill_coverage":0.024,"median_seam_sigma":0.161,"p95_seam_sigma":0.43,"bright_fill_fraction":0,"checkerboard_fraction":0.129},"flatten":{"removed_… [2600 characters; the record holds them all]
```

### 14. measure_reciprocal_cut (done)

Arguments: `{"plane":"h0l","value":0}`

Result: H–L plane at K = 0: ring ratio 0.975 · 0 missed at nodes, 0 sharp off-lattice, 0 broad maxima · seam 0.163σ · floor ≤ 1.62σ

```
{"cut":"H–L plane at K = 0","ring_removal":{"before_ring_energy":0.0603,"after_ring_energy":0.0588,"ring_energy_ratio":0.975,"over_subtraction_fraction":0,"after_negative_fraction":0,"ring_residuals":[{"at":1.68,"fwhm":0.29,"residual_fraction":0.509,"noise_fraction":0.13,"significant":true},{"at":2.39,"fwhm":0.072,"residual_fraction":0.226,"noise_fraction":0.0327,"significant":true},{"at":2.6,"fwhm":0.072,"residual_fraction":0.0967,"noise_fraction":0.0592,"significant":false},{"at":2.74,"fwhm":0.072,"residual_fraction":0.0812,"noise_fraction":0.124,"significant":false},{"at":3.16,"fwhm":0.072,"residual_fraction":0.283,"noise_fraction":0.0687,"significant":true},{"at":4.59,"fwhm":0.14,"residual_fraction":0.427,"noise_fraction":0.102,"significant":true},{"at":5.38,"fwhm":0.072,"residual_fraction":0.0944,"noise_fraction":0.0535,"significant":false},{"at":5.66,"fwhm":0.072,"residual_fraction":0.0693,"noise_fraction":0.0559,"significant":false},{"at":7.08,"fwhm":0.072,"residual_fraction":0.364,"noise_fraction":0.0811,"significant":true},{"at":7.58,"fwhm":0.072,"residual_fraction":0.196,"noise_fraction":0.0685,"significant":false}],"worst_ring_dent":null,"worst_ring_left":{"at":1.68,"fwh… [1920 characters; the record holds them all]
```

### 15. tune_pipeline (error)

Arguments: `{"stages":["rings"],"trials_per_stage":3}`

Why (the model's words before it):

```
I'm checking the ring-removal assessment, which reports the goal as met, but the per-cut residuals at 1.68 Å⁻¹ still look significant, so a ring seems to remain in the hk0 plane. The stage assessment noted a leftover bump at 3.29 and called it fine, since a feature only counts as a ring when it rises in 90% of directions, and I'm wondering whether that threshold is hiding it.

The ring at 1.68 Å⁻¹ still reads as significant in the hk0 cut, even though the tool calls the ring stage done, and 3.16 and 4.59 show residuals there too. The ring-energy ratio in hk0 also comes out above 1 while the assessment reports 0.989, so those two numbers disagree. The 1.68 feature may be crystal diffuse scattering rather than a true ring, since the cut bumps include that.

Now I'm going through the dpdf peak list, where the strongest entries are a large negative value at 2.74 Å and a positive one at 4.763 Å, with a few smaller ones further out. The size figures look implausibly large, so I'll report them as given, but the -1440 at 2.74 Å with half-integer vectors like (0, ½, −½) looks suspicious and may come from the half-integer lattice.

I'm weighing whether the half-integer vectors at 2.74 Å could reflect a real half-period order rather than an artifact, since the origin shift is too small to explain them. The -1440 magnitude looks too large to trust at face value, so I'd check the xy slice at z=0 before drawing conclusions. The 6.732 Å and 4.763 Å features point to a (1,1,1)-type negative …
```

Result: A tuning of the powder-ring subtraction waits for a 3D verdict that a powder ring is left or dented on the current outputs: a bump on one cut is no such verdict, since the crystal's own scattering makes them too. Change it once that verdict finds one, or once the user names the setting.

```
Error: A tuning of the powder-ring subtraction waits for a 3D verdict that a powder ring is left or dented on the current outputs: a bump on one cut is no such verdict, since the crystal's own scattering makes them too. Change it once that verdict finds one, or once the user names the setting.
```

### 16. run_verdict (done)

Arguments: `{}`

Why (the model's words before it):

```
The rings tuning isn't justified, since the 3D verdict already says the rings meet the goal, so I'll leave them alone. Symmetry doesn't need checking because none was declared. Next I'll call run_verdict, consistency_details, and measure_dpdf_cut at xy z=0 to confirm the dpdf features are real.
```

Result: met: every stage meets its goal; data problems no setting fixes: the HKL origin is shifted by (0.0305, 0.0195, 0) r.l.u.

```
{"verdict":"met: every stage meets its goal; data problems no setting fixes: the HKL origin is shifted by (0.0305, 0.0195, 0) r.l.u.","achieved":"met","stages":{"rings":"meets its goal","punch":"meets its goal","backfill":"meets its goal","flatten":"meets its goal","pdf":"meets its goal"},"needs_attention":[],"not_judged":[],"not_measured":[],"data_problems":["the HKL origin is shifted by (0.0305, 0.0195, 0) r.l.u."]}
```

### 17. measure_dpdf_cut (done)

Arguments: `{"plane":"xy","value":0}`

Result: ΔPDF x–y section at z = 0 Å: SNR 829, anisotropy 1.05

```
{"cut":"ΔPDF x–y section at z = 0 Å","delta_pdf":{"origin_excluded_radius":1.95,"background_sigma":11.2,"feature_snr":829,"strong_feature_fraction":0.0392,"positive_fraction":0.543,"anisotropy_ratio":1.05,"anisotropy_angle_deg":-53,"radial_trend":[181,17.7,7.22]},"sigma_of":"this section outside the origin's disk, robust","fields":"All in this section's robust σ outside the origin's disk. feature_snr: the strongest feature over background σ; strong_feature_fraction: voxels beyond 5σ; positive_fraction: 0.5 is balanced ±; anisotropy_ratio: 1 isotropic, above ~1.5 rods or sheets, along anisotropy_angle_deg in the plane; radial_trend: mean |ΔPDF| in the inner, middle and outer shells."}
```

### 18. consistency_details (done)

Arguments: `{}`

Result: r = 0.9829, normalised RMS = 0.1557; against the even part r = 1 (odd share 0.0329)

```
{"pearson_r":0.9829,"normalized_rms":0.1557,"rms":0.016517931224151985,"n_voxels":3602065,"per_plane_r":{"+0.000":0.9947,"+0.350":0.9799,"+1.000":0.9947},"pearson_r_even":1,"normalized_rms_even":1.036e-14,"odd_share":0.0329,"n_voxels_even":3586447,"crop_hkl":null,"q_band":null,"apodization":"gaussian"}
```

## Conclusion

**Result:** The pipeline ran cleanly and every stage meets its goal. The one data problem the settings cannot fix is a shifted HKL origin. I changed no settings, because nothing in the checks called for a change.

**Stage verdicts (3D checks, after the run)**
- **Rings:** meets goal. Ring ratio 0.989, no over-subtraction, no ring left in the 3D verdict.
- **Punch:** meets goal. 185 peaks fitted, none missed at nodes, none left off-lattice.
- **Backfill:** meets goal. Median seam 0.222σ. Texture check: no systematic fill bias, azimuthal ratios 0.996, 0.994, 0.957 (1 means none added).
- **Flatten:** meets goal. No pedestal (floor trend 0.0166, span 0.271).
- **3D-ΔPDF / back-FFT:** meets goal. Back-FFT r 0.9829, even-part r 1, unmeasured weight 0.0000983.

`run_verdict` reports the run as **met**.

**Data checks**
- **Orientation (UB):** correct. Rotation 0°, cell unchanged.
- **HKL origin:** shifted by (0.0305, 0.0195, 0) r.l.u., uniform across all peaks. No UB explains it, so it is a data problem, not a setting. It is small, about a third of a voxel's worth in the H and K directions, but it is systematic.
- **Coverage:** counts reach (0.15, 8.85) Å⁻¹ and do not end inside the box. The transform's reach is 6.444 Å⁻¹, within coverage.
- **Symmetry:** none declared. The Laue comparison suggests 4/mmm, and the unsymmetrised R_int ((0.36, 0.343)) is far above the class values. That points to a real symmetry, but it is your call whether to declare it, so I left it off.
- **Powder rings:** the 3D verdict is clean. Some per-cut residuals remain at about 1.68 Å⁻¹ in the H–K and H–L cuts. Those cuts also contain the crystal's own scattering, so I did not treat them as rings. I tried to tune the ring subtraction, but the tool refused because the 3D verdict does not show a ring left.

**Strongest pair correlations** (`dpdf_peaks`, σ = robust σ outside the origin disk; vectors in Å, ± pairs listed once)
1. **Negative, −1440σ, 2.74 Å**, 6 vectors of type (0, ±1.94, ∓1.94), i.e. (0, a/2, −c/2)-type. Fewer pairs than average.
2. **Positive, +806σ, 4.76 Å**, 12 vectors of type (±1.94, ∓1.94, ±3.89): more pairs than average.
3. **Negative, −539σ, 6.73 Å**, 4 vectors of type (±3.89, ±3.89, ±3.89), i.e. body-diagonal (a, b, c)-type.
4. **Positive, +508σ, 3.88 Å**, along c: (0, 0, 3.88).
5. **Positive, +443σ and +420σ, 7.78 Å**, along b and a: the lattice repeat.

The first three are strong enough that I would confirm them against the data before reading physical meaning into them. The lattice-repeat peaks (items 4–5) can reflect residual periodicity in the cleaned data, so they need the same check.

**Verdict computed from the checks:** met: every stage meets its goal; data problems no setting fixes: the HKL origin is shifted by (0.0305, 0.0195, 0) r.l.u..

## Numbers and their sources

| Number | Source |
| --- | --- |
| 0.989 | step 18, consistency_details, pearson_r = 0.9829 |
| 185 | step 12, bragg_peaks, n_peaks = 185 |
| 0.222 | step 14, measure_reciprocal_cut, ring_removal.ring_residuals[1].residual_fraction = 0.226 |
| 0.996 | step 18, consistency_details, pearson_r = 0.9829 |
| 0.994 | step 18, consistency_details, pearson_r = 0.9829 |
| 0.957 | step 14, measure_reciprocal_cut, ring_removal.ring_energy_ratio = 0.975 |
| 1 | step 18, consistency_details, pearson_r = 0.9829 |
| 0.0166 | step 18, consistency_details, rms = 0.016517931224151985 |
| 0.271 | step 13, measure_reciprocal_cut, flatten.after_negative_fraction = 0.274 |
| 0.9829 | step 18, consistency_details, pearson_r = 0.9829 |
| 0.0000983 | step 10, dpdf_peaks, features[0].vectors_rlu[1][0] = -0.0001 |
| 0 | step 18, consistency_details, normalized_rms = 0.1557 |
| 0.0305 | step 16, run_verdict, verdict = 0.0305 |
| 0.0195 | step 16, run_verdict, verdict = 0.0195 |
| 0.15 | step 8, radial_profile, shells.rows[12][1] = 0.154 |
| 8.85 | step 10, dpdf_peaks, features[10].n_vectors = 9 |
| 6.444 | step 10, dpdf_peaks, robust_sigma = 6.49 |
| 0.36 | step 14, measure_reciprocal_cut, ring_removal.ring_residuals[8].residual_fraction = 0.364 |
| 0.343 | step 7, compare_laue_classes, no_symmetry.r_int[1] = 0.343 |
| 1.68 | step 14, measure_reciprocal_cut, ring_removal.ring_residuals[0].at = 1.68 |
| -1440 | step 10, dpdf_peaks, features[0].size_sigma = -1440 |
| 2.74 | step 14, measure_reciprocal_cut, ring_removal.ring_residuals[3].at = 2.74 |
| 6 | step 14, measure_reciprocal_cut, ring_removal.ring_residuals[7].at = 5.66 |
| 1.94 | step 17, measure_dpdf_cut, delta_pdf.origin_excluded_radius = 1.95 |
| +806 | step 10, dpdf_peaks, features[1].size_sigma = 806 |
| 4.76 | step 10, dpdf_peaks, features[1].length_A = 4.763 |
| 12 | step 10, dpdf_peaks, features[1].n_vectors = 12 |
| 3.89 | step 10, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| -539 | step 10, dpdf_peaks, features[2].size_sigma = -539 |
| 6.73 | step 10, dpdf_peaks, features[2].length_A = 6.732 |
| 4 | step 14, measure_reciprocal_cut, flatten.floor_judged_q[0] = 4.1 |
| +508 | step 14, measure_reciprocal_cut, backfill.n_filled = 517 |
| 3.88 | step 10, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| +443 | step 10, dpdf_peaks, features[4].size_sigma = 443 |
| +420 | step 10, dpdf_peaks, features[5].size_sigma = 420 |
| 7.78 | step 14, measure_reciprocal_cut, flatten.floor_judged_q[1] = 7.75 |
| 5 | step 17, measure_dpdf_cut, fields = 5 |

## Score

- Fault reported: yes
- No false alarm: yes
- Unsafe actions: 0
- Checks the graders' two readings dispute: 0
- Requests cut at the output limit: 0
- Outputs, against the planted truth: features ok, window ok, pedestal ok

## Findings

- **bug**, step 15: tune_pipeline({"stages":["rings"],"trials_per_stage":3}) failed: Error: A tuning of the powder-ring subtraction waits for a 3D verdict that a powder ring is left or dented on the current outputs: a bump on one cut is no such verdict, since the crystal's own scatter…. Proposed: decide whether the model called it wrongly (a clearer description or error) or the tool is wrong (fix it, with a test)
