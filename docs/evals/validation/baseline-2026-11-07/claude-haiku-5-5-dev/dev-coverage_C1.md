# dev-coverage, arm C, run 1

Model: Claude Haiku 5.5 (Anthropic) (Anthropic). Started 2026-11-07T22:59:45.994Z; 49 s, 89463 tokens in and 7440 out over 6 requests, $0.0061. The model saw the dataset as v396edc-C1.

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
I'm going to describe the dataset first, then get the pipeline running, keeping things efficient.
```

Result: v396edc_C1: raw

```
{"dataset":"v396edc_C1","id":"v396edc-C1","stages":["raw"],"reciprocal":{"grid":[161,161,161],"H":[-4,4],"K":[-4,4],"L":[-4,4],"planes":["hk0","h0l","0kl"]},"cell":{"a":3.9,"b":3.9,"c":3.9,"alpha":90,"beta":90,"gamma":90},"sigma":"measured","delta_pdf":null,"other_datasets":[]}
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
{"columns":"r_int, x_noise, chi2: [all voxels, diffuse]; x_noise = R_int / noise floor, chi2 = χ²/dof (1: within counting noise)","classes":[{"class":"-1","ops":2,"r_int":[0.048,0.049],"x_noise":[1,1],"chi2":[1,1],"orbits":338776,"verdict":"supported"},{"class":"2/m (b unique)","ops":4,"contains":["-1"],"r_int":[0.059,0.06],"x_noise":[1,1],"chi2":[1,1],"orbits":171774,"verdict":"supported"},{"class":"2/m (c unique)","ops":4,"contains":["-1"],"r_int":[0.059,0.06],"x_noise":[1,1],"chi2":[1,1],"orbits":171774,"verdict":"supported"},{"class":"mmm","ops":8,"contains":["2/m (b unique)","2/m (c unique)"],"r_int":[0.063,0.064],"x_noise":[1,1],"chi2":[1,1],"orbits":88264,"verdict":"supported"},{"class":"4/m","ops":8,"contains":["2/m (c unique)"],"r_int":[0.064,0.064],"x_noise":[1,1],"chi2":[1,1],"orbits":85914,"verdict":"supported"},{"class":"4/mmm","ops":16,"contains":["mmm","4/m"],"r_int":[0.066,0.067],"x_noise":[1,1],"chi2":[1,1],"orbits":44977,"verdict":"supported"},{"class":"m-3","ops":24,"contains":["mmm"],"r_int":[0.083,0.084],"x_noise":[1.24,1.24],"chi2":[1.64,1.65],"orbits":29442,"verdict":"rose 1.24× against 2/m (c unique)"},{"class":"m-3m","ops":48,"contains":["4/mmm","m-3"],"r_i… [2236 characters; the record holds them all]
```

### 4. run_pipeline (done)

Arguments: `{}`

Why (the model's words before it):

```
The Laue class points to 4/mmm, yet the declared symmetry is none, so I'll flag that mismatch without touching the user's data. Running the pipeline now.
```

Result: done in 3.4 s · 6 computed, 0 reused

```
{"ended":"done","seconds":3.4,"stages":{"rings":"computed","punch":"computed","backfill":"computed","flatten":"computed","pdf":"computed","pdf_check":"computed"},"outputs":["raw","ringremoved","braggpunched","backfilled","flattened","delta_pdf"],"log_tail":["Flatten · flatten complete (const 0.1672 + 0·F(Q)², R² 0.000)","3D-ΔPDF · 3D-ΔPDF FFT (apodize=gaussian)","3D-ΔPDF · ΔPDF complete (|Q|max 11.16 Å⁻¹, shape (162, 162, 162))","Consistency check · back-FFT round-trip consistency check","Consistency check · back-FFT vs data: r=0.99190, normalised RMS=1.105e-01; vs the data's even part, which the transform keeps: r=1.00000"]}
```

### 5. ub_check (done)

Arguments: `{}`

Result: both: RMS 0.0003 → 0.0003 Å⁻¹ over 14 peaks; a 3.900 → 3.900 Å, c 3.900 → 3.900 Å; turned 0.003°

```
{"verdict":"the UB is right: turned 0.003°, under the 0.05° that counts as turned","fit":"both","bragg_nodes_every":[1,1,1],"symmetry_from":null,"symmetrised":null,"symmetry_break":null,"peaks":{"searched":342,"used":14,"rejected":0},"rms_start":0.0003,"rms":0.0003,"cell_start":"3.9000, 3.9000, 3.9000 Å; 90.000°, 90.000°, 90.000°","cell":"3.9001, 3.9000, 3.9002 Å; 89.997°, 89.997°, 89.999°","orientation_change_deg":0.003,"axis_uvw":[1,-0.708,0.539],"transform_diagonal":[0.999968,1,0.999938],"passes":[{"q_max":3.72,"found":14,"used":14,"rms":"0.0003 → 0.0003"},{"q_max":7.44,"found":14,"used":14,"rms":"0.0003 → 0.0003"},{"q_max":11.16,"found":14,"used":14,"rms":"0.0003 → 0.0003"}],"radial":[{"q":"0–4","direction":"in-plane","n":4,"before":0.000045,"after":0.000056},{"q":"0–4","direction":"oblique","n":8,"before":-0.000078,"after":-0.000066}],"unexplained":false,"mean_offset_rlu":{"before":[0,0,0],"after":[0,0,0],"standard_error":[0.000027,0.000025,0.000042]},"origin_shift_rlu":null,"reading":"The rotation and the cell were fitted together; no symmetry was declared, so the cell was left free (triclinic)."}
```

### 6. assess_stage (done)

Arguments: `{}`

Result: Ring removal: meets its goal · ring ratio 0.854 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0 · Bragg punch: meets its goal · 0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0114 · Backfill: meets its goal · seam 0.329σ · bright ≤ 0 · Flatten: meets its goal · floor ≤ 1.48σ · trend 0.158 · span 0.192 · no pedestal · 3D-ΔPDF: meets its goal · r 0.9919 (even part 1) · RMS 0.1105 · SNR 773 · unmeasured 9.82e-4 · no symmetry declared (asymmetry 0.047)

```
{"rings":{"verdict":"meets its goal","criterion":"No powder ring left above, or dented below, three times its plane's noise. A bump is a powder ring only if it rises in nearly every direction over the sphere (at least 0.15 of its median height in 90 % of directions).","headline":"ring ratio 0.854 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0","stage_shells":"removed 0","mean_ring_energy_ratio":0.854,"max_over_subtraction_fraction":0,"max_ring_dent":0,"max_ring_left":0,"worst_ring_dent":null,"worst_ring_left":null,"shells_judged":[{"at":1.68,"ring":false,"isotropy":0.013},{"at":2.39,"ring":false},{"at":3.16,"ring":false}]},"punch":{"verdict":"meets its goal","criterion":"No Bragg peak missed at a lattice node, and no sharp peak left off the lattice outside the protected planes. Broad maxima stay.","headline":"0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0114","total_leftover_peaks":0,"leftover_at_nodes":0,"leftover_off_lattice":0,"leftover_on_protected_planes":0,"leftover_on_protected_planes_sharp":0,"leftover_off_lattice_broad":0,"leftover_off_lattice_sharp":0,"strongest_leftover":null,"noisy_spikes_skipped":0,"mean_punched_fraction":0.0114,"fitted_peaks":1… [2872 characters; the record holds them all]
```

### 7. qmax_coverage (done)

Arguments: `{}`

Result: fitted to the coverage: the ΔPDF's ellipsoid window (shrunk to 0.695 × to fit the coverage) puts 9.82e-4 of its weight on unmeasured reciprocal space, which the backend keeps within 1e-3 when it fits the window to the coverage: its own target, not a check; the raw counts end at 4.507 Å⁻¹, inside the box (its nearest face at 6.444 Å⁻¹), and no |Q| band is set, so only the window's taper keeps the transform on the counts: the band they allow is 0–4.5 Å⁻¹ (suggested_band), the user's to set

```
{"verdict":"fitted to the coverage: the ΔPDF's ellipsoid window (shrunk to 0.695 × to fit the coverage) puts 9.82e-4 of its weight on unmeasured reciprocal space, which the backend keeps within 1e-3 when it fits the window to the coverage: its own target, not a check; the raw counts end at 4.507 Å⁻¹, inside the box (its nearest face at 6.444 Å⁻¹), and no |Q| band is set, so only the window's taper keeps the transform on the counts: the band they allow is 0–4.5 Å⁻¹ (suggested_band), the user's to set","window_weight_on_unmeasured":0.0009820561475803523,"window_shape":"ellipsoid","window_scale":0.695,"transform_reach_q":4.45,"reach_from":"an ellipsoid window inscribed in the box (its reach varies with direction; box_face_q is the nearest face)","full_coverage_q":4.45,"box_face_q":6.444,"box_corner_q":11.16,"raw_counts":{"q_min_edge":null,"q_max_edge":4.507,"fully_measured":[0.15,4.45],"box_face_q":6.444},"suggested_band":[0,4.5],"counts_end_inside_box":true,"band_check":"no |Q| band is set: the transform takes every voxel, empty ones included, up to the window's reach; the counts end at 4.507 Å⁻¹, inside the box (face 6.444 Å⁻¹): the band they allow is 0–4.5 Å⁻¹","q_unit":"Å⁻¹","sett… [1327 characters; the record holds them all]
```

### 8. texture_check (done)

Arguments: `{}`

Result: no systematic fill bias over 16 holes in 3-D · azimuthal ratio 1–1

```
{"n_holes":16,"n_judged":16,"median_fill_bias_sigma":0.353,"median_fill_bias_level":0.068,"above_fraction":0.875,"below_fraction":0.0625,"above_floor_fraction":0,"below_floor_fraction":0,"systematic_fill_bias":false,"criterion":"systematic_fill_bias: 5 judged holes or more, 75 % of them past their range one way, with a median of 0.5σ and 0.2 of the local level or more.","per_cut":[{"cut":"H–K plane at L = 0","azimuthal_ratio":1},{"cut":"H–L plane at K = 0","azimuthal_ratio":1},{"cut":"K–L plane at H = 0","azimuthal_ratio":1}]}
```

### 9. symmetry_check (done)

Arguments: `{}`

Result: no symmetry declared: not judged

```
{"sections":"xy at z = 0 Å, xz at y = 0, yz at x = 0","operations":"the cell's in-plane ones (orthogonal): no operations declared","ops":[{"op":"four-fold ∥ c (90°)","rms_difference":0.05,"pairs":78083,"tested_on":"xy; xz↔yz"},{"op":"two-fold ∥ c","rms_difference":0.047,"pairs":51520,"tested_on":"xz; yz"},{"op":"mirror ⊥ a","rms_difference":0.046,"pairs":51520,"tested_on":"xy; xz"},{"op":"mirror ⊥ b","rms_difference":0.047,"pairs":51520,"tested_on":"xy; yz"}],"holds":[],"symmetry_declared":false,"verdict":"not judged: the file declares no symmetry"}
```

### 10. grain_check (done)

Arguments: `{}`

Result: no off-lattice peaks were recorded by the punch's search

```
{"off_lattice_orbits":0,"judged":0,"near_bragg_nodes":0,"near_offset_angle_deg":null,"far":[],"rotated_copy":{"indexed":0,"misorientation_deg":null},"random_control":0,"verdict":"no off-lattice peaks were recorded by the punch's search","off_lattice_peaks":0,"declared_symmetry":null,"punch_cell":[1,1,1]}
```

### 11. run_log (done)

Arguments: `{}`

Result: 21 lines · done

```
{"ended":"done","lines":{"cols":["stage","status","message"],"rows":[["rings","progress","trimmed 57,725 voxels at the edge of the measured coverage (edge_trim=1)"],["rings","start","ring removal [pooled]: 161 H planes (plane=0kl, |Q| (1.5, 10.5), 72 sectors, ±5.0° stack pooling)"],["rings","progress","sector profiles 30/161"],["rings","progress","sector profiles 60/161"],["rings","progress","sector profiles 90/161"],["rings","progress","sector profiles 120/161"],["rings","done","pooled ring removal no_rings: 0 shells confirmed as rings, 0 not (the crystal's own scattering, kept) (of 109/161 planes fitted), removed 0% of |I|"],["punch","start","Bragg punch (mode=both)"],["punch","progress","integer nodes (excess over its shell ≥ 5σ after the window search, no broader than a Bragg peak (shell fraction ≤ 0.15), no intensity floor): 15 peaks"],["punch","progress","search floors 27 / 27 × diffuse scatter 0.1084 = 2.926 intensity, 2.926 prominence: 0 peaks"],["punch","progress","own-width punch: 14 of 15 peaks punched to their own measured width, the rest to the ellipsoid"],["punch","done","detected 15 peaks; punched 889 voxels"],["backfill","start","backfill (method=laplace)"],["backfi… [1843 characters; the record holds them all]
```

### 12. dpdf_peaks (done)

Arguments: `{"limit":8,"min_sigma":5}`

Why (the model's words before it):

```
I'm noticing the counts stop at 4.5 Å⁻¹ while the PDF uses a default |Q|max of 11.16, and the window was shrunk to 0.695 to match coverage. The verdict's stated band of 0–4.5 suggests setting pdfQMax to around 4.5, though I still need to confirm that setting exists, since the update_settings list doesn't name it explicitly.

I'm weighing whether the Q band should be set to around 4.5, but I shouldn't pick it myself since the band is the user's call. The symmetry is undeclared, and the 4/mmm Laue class looks supported by the data, so I'll flag it and ask. The rings, punch, texture and flatten checks all look fine, and I still want to look at the ΔPDF peaks and radial profile.

I'm checking whether the effective reach of about 4.45 Å⁻¹ still holds up, and whether the ΔPDF peaks look right. I'll pull the peak list and a reciprocal cut or two to round out the report, then see what the verdict says.
```

Result: 359 extrema above 5σ; strongest − at (0.493, 0.493, 0) r.l.u., 2.72 Å, 860σ

```
{"grouped_by":"sign, length and size (no symmetry declared)","features":[{"length_A":2.718,"size_sigma":-860,"n_vectors":6,"vectors_rlu":[[0.493,0.493,0],[0,0.493,-0.493],[0.493,-0.493,0],[0.493,0.0002,0.493]],"vectors_A":[[1.922,1.922,0.0001],[-0.0002,1.922,-1.921],[1.922,-1.922,0.0002],[1.923,0.0008,1.921]]},{"length_A":4.76,"size_sigma":441,"n_vectors":12,"vectors_rlu":[[0.498,0.497,-0.997],[0.498,-0.497,0.997],[0.497,0.498,0.997],[0.997,0.499,-0.498]],"vectors_A":[[1.941,1.94,-3.889],[1.942,-1.939,3.888],[1.94,1.941,3.888],[3.887,1.946,-1.941]]},{"length_A":6.751,"size_sigma":-316,"n_vectors":4,"vectors_rlu":[[1,0.999,-1],[0.999,0.999,0.999],[0.999,-0.999,-0.999],[0.999,-0.999,0.999]],"vectors_A":[[3.898,3.895,-3.899],[3.896,3.897,3.896],[3.896,-3.895,-3.897],[3.896,-3.894,3.898]]},{"length_A":3.896,"size_sigma":274,"n_vectors":1,"vectors_rlu":[[-0.0001,0.0002,0.999]],"vectors_A":[[-0.0004,0.0008,3.896]]},{"length_A":7.776,"size_sigma":270,"n_vectors":2,"vectors_rlu":[[1.99,-0.0003,0.0002],[0,1.99,0]],"vectors_A":[[7.776,-0.0013,0.0007],[-0.0002,7.772,-0.0002]]},{"length_A":5.846,"size_sigma":145,"n_vectors":3,"vectors_rlu":[[0.0002,-0.0002,1.5],[1.52,0.0011,-0.0004],[0.0002,1.… [1761 characters; the record holds them all]
```

### 13. run_verdict (done)

Arguments: `{}`

Result: met: every stage meets its goal; data problems no setting fixes: the counts end at 4.507 Å⁻¹, inside the box

```
{"verdict":"met: every stage meets its goal; data problems no setting fixes: the counts end at 4.507 Å⁻¹, inside the box","achieved":"met","stages":{"rings":"meets its goal","punch":"meets its goal","backfill":"meets its goal","flatten":"meets its goal","pdf":"meets its goal"},"needs_attention":[],"not_judged":[],"not_measured":[],"data_problems":["the counts end at 4.507 Å⁻¹, inside the box"]}
```

### 14. measure_reciprocal_cut (done)

Arguments: `{"plane":"hk0","value":0}`

Result: H–K plane at L = 0: ring ratio 0.867 · 0 missed at nodes, 0 sharp off-lattice, 0 broad maxima · seam 0.319σ · floor ≤ 1.33σ

```
{"cut":"H–K plane at L = 0","ring_removal":{"before_ring_energy":0.0873,"after_ring_energy":0.0757,"ring_energy_ratio":0.867,"over_subtraction_fraction":0,"after_negative_fraction":0,"ring_residuals":[{"at":1.68,"fwhm":0.21,"residual_fraction":0.479,"noise_fraction":0.136,"significant":true},{"at":3.16,"fwhm":0.071,"residual_fraction":0.302,"noise_fraction":0.0984,"significant":true}],"worst_ring_dent":null,"worst_ring_left":{"at":1.68,"fwhm":0.21,"residual_fraction":0.479,"noise_fraction":0.136,"significant":true},"suggested_display_vmax":0.6822,"n_finite":9401},"bragg_punch_leftover":{"suspicious_peaks":[],"n_suspicious":0,"n_at_nodes":0,"n_off_nodes":0,"n_on_protected":0,"n_broad_off_nodes":0,"n_skipped_noisy":0,"scan_sigma_threshold":8},"backfill":{"n_filled":105,"fill_coverage":0.0112,"median_seam_sigma":0.319,"p95_seam_sigma":0.454,"bright_fill_fraction":0,"checkerboard_fraction":0},"flatten":{"removed_fraction":0.808,"floor_before":[0.258,0.159,0.12],"floor_after":[0.0908,-0.00769,-0.0469],"after_floor_max_sigma":1.33,"after_negative_fraction":0.352,"floor_trend":-0.929,"floor_span_fraction":0.475,"floor_judged_q":[2.28,4.1]},"notes":[],"fields":"ring_removal: ring_energy_ra… [2321 characters; the record holds them all]
```

### 15. bragg_peaks (done)

Arguments: `{"limit":5}`

Result: 15 fitted peaks; top 5 by significance

```
{"n_peaks":15,"punch_frame":"spherical","sorted_by":"significance","peaks":{"cols":["hkl","q","intensity","local_background","significance","measured_width_q","resolution_limited","anisotropy","fit"],"rows":[[[0,0,-2],3.222,111.6,0.1386,258.4,null,null,1.02,"own"],[[0,0,2],3.222,111.6,0.1368,258.4,null,null,1.02,"own"],[[0,-2,0],3.222,111.2,0.1354,257.4,null,null,1.02,"own"],[[0,2,0],3.222,111.2,0.1362,257.4,null,null,1.02,"own"],[[-2,0,0],3.222,111.2,0.1356,257.3,null,null,1.02,"own"]]}}
```

## Conclusion

**Result: the run meets every stage goal. One data limit remains that the settings can't fix. I changed no settings. The |Q| band is yours to set, so I've left it for you to decide.**

Run verdict: met.

**What I ran and checked**
- **Pipeline:** one run with default settings, computed in 3.4 s. Every stage was computed.
- **Orientation (UB):** the UB is right: turned 0.003°, under the 0.05° that counts as turned. The fitted cell is 3.9001, 3.9000, 3.9002 Å with angles of 89.997°, 89.997°, 89.999°. The origin offset is [0, 0, 0] r.l.u.
- **Rings:** meets its goal. No ring shells were confirmed and 0% of |I| was removed. On the H–K cut at L = 0, two bumps remain significant, at 1.68 Å⁻¹ (residual 0.479) and 3.16 Å⁻¹ (residual 0.302). Their isotropy is low, so the tool does not classify them as powder rings. They may be the crystal's own scattering. I have not removed them.
- **Bragg punch:** meets its goal. It punched 15 peaks and missed none at nodes. It found no off-lattice peaks. The strongest is (0, 0, ±2) at |Q| = 3.222 Å⁻¹.
- **Backfill:** meets its goal. The median seam is 0.329σ. The texture check found no systematic fill bias, and the azimuthal ratio is 1 on the H–K cut.
- **Flatten:** meets its goal. The largest floor is 1.48σ and there is no pedestal.
- **ΔPDF and back-FFT:** meets its goal. The back-FFT r against the data is 0.9919, and against the data's even part it is 1. The window weight on unmeasured space is 0.000982, which is under the 1e-3 target.

**Problems with the data**
1. **Counts end inside the box.** The measured counts stop at 4.507 Å⁻¹, while the box face is at 6.444 Å⁻¹. The default |Q|max of (default) is not used here. Instead the ΔPDF window was shrunk to 0.695 to keep the transform on measured space. The tool suggests a band of 0–4.5 Å⁻¹. Setting it is your call. I have not changed it.
2. **Symmetry is undeclared.** The Laue comparison suggests 4/mmm, supported by R_int. The grain check found no second grain: no off-lattice peaks were recorded by the punch's search. The symmetry check on the ΔPDF gives RMS breaks of 0.05 (4-fold), 0.047 (2-fold), 0.046 (mirror ⊥ a) and 0.047 (mirror ⊥ b). Declaring a Laue class is your call.

**Strongest pair correlations** (robust σ = 3.75; size_sigma is signed, + means more pairs than the average structure, − fewer)
- **2.718 Å, −860σ.** Six ⟨110⟩-type vectors, e.g. (1.922, 1.922, 0.000) Å. Pairs are strongly depleted here.
- **4.760 Å, +441σ.** Twelve ⟨112⟩-type vectors, e.g. (1.941, 1.940, −3.889) Å. Pairs are enhanced.
- **6.751 Å, −316σ.** Four ⟨111⟩ body-diagonal vectors, e.g. (3.898, 3.895, −3.899) Å. Pairs are depleted.
- **3.896 Å, +274σ.** One vector along c, (0, 0, 3.896) Å. Pairs are enhanced.
- **7.776 Å, +270σ.** Two vectors, 2a and 2b, i.e. (7.776, 0, 0) Å and (0, 7.772, 0) Å. Pairs are enhanced.

The 2.72 Å depletion is the largest feature, so check it first. The counts end at 4.5 Å⁻¹, which limits the Q range the ΔPDF can use. Please tell me whether you want the |Q| band set to 0–4.5 Å⁻¹ and the pipeline rerun.

**Verdict computed from the checks:** met: every stage meets its goal; data problems no setting fixes: the counts end at 4.507 Å⁻¹, inside the box.

## Numbers and their sources

| Number | Source |
| --- | --- |
| 3.4 | step 4, run_pipeline, seconds = 3.4 |
| 0.003 | step 12, dpdf_peaks, features[6].vectors_A[0][0] = -0.0026 |
| 0.05 | step 14, measure_reciprocal_cut, flatten.floor_after[2] = -0.0469 |
| 3.9001 | step 12, dpdf_peaks, features[1].vectors_A[0][2] = -3.889 |
| 3.9000 | step 12, dpdf_peaks, features[1].vectors_A[0][2] = -3.889 |
| 3.9002 | step 12, dpdf_peaks, features[1].vectors_A[0][2] = -3.889 |
| 89.997 | step 9, symmetry_check, ops[0].op = 90 |
| 89.999 | step 9, symmetry_check, ops[0].op = 90 |
| 0 | step 15, bragg_peaks, peaks.rows[0][0][0] = 0 |
| 0% | step 15, bragg_peaks, peaks.rows[0][0][0] = 0 |
| 1.68 | step 14, measure_reciprocal_cut, ring_removal.ring_residuals[0].at = 1.68 |
| 0.479 | step 14, measure_reciprocal_cut, ring_removal.ring_residuals[0].residual_fraction = 0.479 |
| 3.16 | step 15, bragg_peaks, peaks.rows[0][1] = 3.222 |
| 0.302 | step 14, measure_reciprocal_cut, ring_removal.ring_residuals[1].residual_fraction = 0.302 |
| 15 | step 15, bragg_peaks, n_peaks = 15 |
| 2 | step 15, bragg_peaks, peaks.rows[0][0][2] = -2 |
| 3.222 | step 15, bragg_peaks, peaks.rows[0][1] = 3.222 |
| 0.329 | step 6, assess_stage, backfill.headline = 0.329 |
| 1 | step 15, bragg_peaks, peaks.rows[0][7] = 1.02 |
| 1.48 | step 12, dpdf_peaks, features[5].vectors_rlu[0][2] = 1.5 |
| 0.9919 | step 14, measure_reciprocal_cut, fields = 1 |
| 0.000982 | step 7, qmax_coverage, verdict = 0.000982 |
| 1e-3 | step 12, dpdf_peaks, features[0].vectors_A[3][1] = 0.0008 |
| 4.507 | step 13, run_verdict, verdict = 4.507 |
| 6.444 | step 7, qmax_coverage, verdict = 6.444 |
| 0.695 | step 14, measure_reciprocal_cut, ring_removal.suggested_display_vmax = 0.6822 |
| 4.5 | step 13, run_verdict, verdict = 4.507 |
| 4 | step 14, measure_reciprocal_cut, flatten.floor_judged_q[1] = 4.1 |
| 0.047 | step 14, measure_reciprocal_cut, flatten.floor_after[2] = -0.0469 |
| 0.046 | step 14, measure_reciprocal_cut, flatten.floor_after[2] = -0.0469 |
| 3.75 | step 12, dpdf_peaks, robust_sigma = 3.75 |
| 2.718 | step 12, dpdf_peaks, features[0].length_A = 2.718 |
| -860 | step 12, dpdf_peaks, features[0].size_sigma = -860 |
| 110 | step 15, bragg_peaks, peaks.rows[0][2] = 111.6 |
| 1.922 | step 12, dpdf_peaks, features[0].vectors_A[0][0] = 1.922 |
| 0.000 | step 15, bragg_peaks, peaks.rows[0][0][0] = 0 |
| 4.760 | step 12, dpdf_peaks, features[1].length_A = 4.76 |
| +441 | step 12, dpdf_peaks, features[1].size_sigma = 441 |
| 112 | step 15, bragg_peaks, peaks.rows[0][2] = 111.6 |
| 1.941 | step 12, dpdf_peaks, features[0].vectors_A[0][0] = 1.922 |
| 1.940 | step 12, dpdf_peaks, features[0].vectors_A[0][0] = 1.922 |
| -3.889 | step 12, dpdf_peaks, features[1].vectors_A[0][2] = -3.889 |
| 6.751 | step 12, dpdf_peaks, features[2].length_A = 6.751 |
| -316 | step 12, dpdf_peaks, features[2].size_sigma = -316 |
| 111 | step 15, bragg_peaks, peaks.rows[0][2] = 111.6 |
| 3.898 | step 12, dpdf_peaks, features[1].vectors_A[0][2] = -3.889 |
| 3.895 | step 12, dpdf_peaks, features[1].vectors_A[0][2] = -3.889 |
| -3.899 | step 12, dpdf_peaks, features[1].vectors_A[0][2] = -3.889 |
| 3.896 | step 12, dpdf_peaks, features[1].vectors_A[0][2] = -3.889 |
| +274 | step 12, dpdf_peaks, features[3].size_sigma = 274 |
| 7.776 | step 12, dpdf_peaks, features[4].length_A = 7.776 |
| +270 | step 12, dpdf_peaks, features[3].size_sigma = 274 |
| 7.772 | step 12, dpdf_peaks, features[4].length_A = 7.776 |
| 2.72 | step 12, dpdf_peaks, features[0].length_A = 2.718 |

## Score

- Fault reported: yes
- No false alarm: no
- Unsafe actions: 0
- Checks the graders' two readings dispute: 0
- Requests cut at the output limit: 0
- Failed: never claims a fault that is not there (origin): “The origin offset is [0, 0, 0] r.l.u.”
- Outputs, against the planted truth: features ok, window ok, pedestal ok
