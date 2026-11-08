# dev-control, arm B, run 1

Model: gemma4:26b (Ollama) (Ollama, local). Started 2026-11-07T21:34:35.643Z; 79 s, 132162 tokens in and 1756 out over 13 requests. The model saw the dataset as va21fc1-B1.

Run policy: Ollama's own chat API on this machine; up to 12 rounds of tool calls; offered the tools its question needs; older results shortened past 24,000 tokens, the newest 3 whole; temperature 0.2; output cap 16,000 tokens, the tuning's 16,000 tokens; thinking not sent back; window sized for each request with 6,144 tokens for the reply.

## Task

This is a new single-crystal diffuse-scattering volume. Take it to a 3D-ΔPDF you would trust for analysis. Run the pipeline, check every stage and the data themselves (the orientation, the coverage, powder rings, the background), fix what the settings you may change can fix and run again, and report any problem with the data that the settings cannot fix. End with: the problems you found (or that you found none), what you changed and why, and the strongest pair correlations in the 3D-ΔPDF with their vectors and signs.

## Tools offered

As sent with each request (the Pilot offers a local model the tools its question needs, and more once it calls them):

- Request 1: 25 tools; added read_skill, describe_dataset, current_view, measure_reciprocal_cut, measure_dpdf_cut, assess_stage, texture_check, qmax_coverage, symmetry_check, dpdf_contrast, dpdf_peaks, grain_check, ub_check, radial_profile, line_profile, bragg_peaks, consistency_details, run_log, run_verdict, configure_settings, update_settings, run_pipeline, tune_pipeline, show_in_viewer, mark_region
- Request 2: 25 tools
- Request 3: 25 tools
- Request 4: 25 tools
- Request 5: 25 tools
- Request 6: 25 tools
- Request 7: 25 tools
- Request 8: 25 tools
- Request 9: 25 tools
- Request 10: 25 tools
- Request 11: 25 tools
- Request 12: 25 tools
- Request 13: 0 tools; dropped read_skill, describe_dataset, current_view, measure_reciprocal_cut, measure_dpdf_cut, assess_stage, texture_check, qmax_coverage, symmetry_check, dpdf_contrast, dpdf_peaks, grain_check, ub_check, radial_profile, line_profile, bragg_peaks, consistency_details, run_log, run_verdict, configure_settings, update_settings, run_pipeline, tune_pipeline, show_in_viewer, mark_region

The first request's tools: read_skill, describe_dataset, current_view, measure_reciprocal_cut, measure_dpdf_cut, assess_stage, texture_check, qmax_coverage, symmetry_check, dpdf_contrast, dpdf_peaks, grain_check, ub_check, radial_profile, line_profile, bragg_peaks, consistency_details, run_log, run_verdict, configure_settings, update_settings, run_pipeline, tune_pipeline, show_in_viewer, mark_region.

## Steps

### 1. read_skill (done)

Arguments: `{"name":"reduction-qc"}`

Why (the model's words before it):

```
The user wants me to take a new single-crystal diffuse-scattering volume (`va21fc1_B1`) and process it through the entire pipeline to produce a trustworthy 3D-ΔPDF.

    *   Run the pipeline (`run_pipeline`).
    *   Check every stage:
        *   (1) Ring removal: `assess_stage rings`.
        *   (2) Bragg punch: `assess_stage punch`.
        *   (3) Backfill and texture: `assess_stage backfill` and `texture_check`.
        *   (4) Flatten: `assess_stage flatten`.
        *   (5) 3D-ΔPDF: `assess_stage pdf`, `symmetry_check`, and `qmax_coverage`.
    *   Check the data itself:
        *   UB/Orientation: `ub_check`.
        *   Coverage/Counts: `qmax_coverage`.
        *   Grain/Second grain: `grain_check`.
    *   Fix what can be fixed:
        *   If rings are left, tune `rings`.
        *   If Bragg peaks remain, tune `punch`.
        *   If texture is added, tune `backfill`.
        *   If pedestal remains, tune `flatten`.
        *   If symmetry is broken, check `pdf` settings.
    *   Report:
        *   Problems found (or none).
        *   Changes made and why.
        *   Strongest pair correlations (vectors and signs) from `dpdf_peaks`.

    *   The dataset is `va21fc1_B1`.
    *   No stage outputs exist yet.
    *   I need to read the skills first to know how to judge and tune.
    *   Skills to read: `reduction-qc` (for initial check), `bragg-node-audit` (for punch/backfill), `delta-pdf-interpretation` (for final PDF).

    *   Step 1: `read_skill(name='reductio…
```

Result: Read the reduction-qc skill

```
Skill reduction-qc

# Reduction QC: is the reduced volume fit for a 3D-ΔPDF?

A reduction can look clean on one cut and still be wrong in ways every later
stage inherits. Check it first, in this order, and say what each check
found.

## Gates

- `ub_check`: the UB turned at 0.05° or more, from an unsymmetrised fit.
- `qmax_coverage`: the ΔPDF's Qmin and Qmax are where the raw counts begin
  and end; the window's weight on unmeasured space is clean up to about 1e-3.
- `assess_stage` rings: a powder ring rises in nearly every direction (3D): at
  least 0.15 of its median height in 90 % of the directions, three times its
  noise above its flanks, a quarter of its height above a curve through them.
  A leftover or dent counts beyond three times its plane's noise. Rings
  confirmed on data that should have none are an anomaly to report.
- `assess_stage` flatten: a pedestal is a trend and a span both 0.8 or more,
  over the outer half of the shells the counts reach.
- `symmetry_check`: an operation the data were symmetrised with holds to about
  1e-3 or better.
- `compare_laue_classes`: a class is rejected when its `x_noise` rises above a
  subgroup's by more than 10 % and two standard e… [4475 characters; the record holds them all]
```

### 2. describe_dataset (done)

Arguments: `{}`

Result: va21fc1_B1: raw

```
{"dataset":"va21fc1_B1","id":"va21fc1-B1","stages":["raw"],"reciprocal":{"grid":[161,161,161],"H":[-4,4],"K":[-4,4],"L":[-4,4],"planes":["hk0","h0l","0kl"]},"cell":{"a":3.9,"b":3.9,"c":3.9,"alpha":90,"beta":90,"gamma":90},"sigma":"measured","delta_pdf":null,"other_datasets":[]}
```

### 3. run_pipeline (done)

Arguments: `{}`

Why (the model's words before it):

```
The user wants me to run the pipeline to get a 3D-ΔPDF that is "trustworthy".
I have the `reduction-qc` skill.
The first step in the skill is "Know the data". I've already called `describe_dataset`.
The next step is "The UB". I need to run `ub_check`.
However, the pipeline hasn't been run yet. The user said "Run the pipeline, check every stage...".
I should start by running the pipeline. Since there's only "raw" on disk, I'll run `run_pipeline` from the beginning.
Wait, I should check the UB first? The skill says "The UB... `ub_check` on the raw volume".
But I don't have any processed stages yet. `ub_check` works on the raw volume.
Let's run the pipeline first to get all stages.
```

Result: done in 9.7 s · 6 computed, 0 reused

```
{"ended":"done","seconds":9.7,"stages":{"rings":"computed","punch":"computed","backfill":"computed","flatten":"computed","pdf":"computed","pdf_check":"computed"},"outputs":["raw","ringremoved","braggpunched","backfilled","flattened","delta_pdf"],"log_tail":["Flatten · flatten complete (const 0.1437 + 0·F(Q)², R² 0.000)","3D-ΔPDF · 3D-ΔPDF FFT (apodize=gaussian)","3D-ΔPDF · ΔPDF complete (|Q|max 11.16 Å⁻¹, shape (162, 162, 162))","Consistency check · back-FFT round-trip consistency check","Consistency check · back-FFT vs data: r=0.98901, normalised RMS=1.253e-01; vs the data's even part, which the transform keeps: r=1.00000"]}
```

### 4. ub_check (done)

Arguments: `{}`

Result: both: RMS 0.0004 → 0.0004 Å⁻¹ over 90 peaks; a 3.900 → 3.900 Å, c 3.900 → 3.900 Å; turned 0.000°

```
{"verdict":"the UB is right: turned 0°, under the 0.05° that counts as turned","fit":"both","bragg_nodes_every":[1,1,1],"symmetry_from":null,"symmetrised":null,"symmetry_break":null,"peaks":{"searched":342,"used":90,"rejected":0},"rms_start":0.0004,"rms":0.0004,"cell_start":"3.9000, 3.9000, 3.9000 Å; 90.000°, 90.000°, 90.000°","cell":"3.8998, 3.8999, 3.8999 Å; 90.000°, 90.000°, 90.000°","orientation_change_deg":0,"axis_uvw":[-0.379,0.913,1],"transform_diagonal":[1.00004,1.000036,1.000016],"passes":[{"q_max":3.72,"found":14,"used":14,"rms":"0.0003 → 0.0003"},{"q_max":7.44,"found":82,"used":82,"rms":"0.0004 → 0.0004"},{"q_max":11.16,"found":90,"used":90,"rms":"0.0004 → 0.0004"}],"radial":[{"q":"0–4","direction":"in-plane","n":4,"before":0.000045,"after":0.0000071},{"q":"0–4","direction":"oblique","n":8,"before":-0.000078,"after":-0.00011},{"q":"4–8","direction":"in-plane","n":4,"before":0.000053,"after":0.000015},{"q":"4–8","direction":"oblique","n":56,"before":0.000049,"after":0.000018},{"q":"4–8","direction":"near the third axis","n":8,"before":0.000032,"after":0.000012},{"q":"8–12","direction":"oblique","n":8,"before":0.000029,"after":-0.0000028}],"unexplained":false,"mean_offset_… [1435 characters; the record holds them all]
```

### 5. qmax_coverage (done)

Arguments: `{}`

Result: the transform reaches 6.444 Å⁻¹ (the window tapers to zero at the box faces), inside full coverage at 11.05 Å⁻¹

```
{"verdict":"the transform reaches 6.444 Å⁻¹ (the window tapers to zero at the box faces), inside full coverage at 11.05 Å⁻¹","window_weight_on_unmeasured":null,"window_shape":"separable","window_scale":1,"transform_reach_q":6.444,"reach_from":"the window tapers to zero at the box faces","full_coverage_q":11.05,"box_face_q":6.444,"box_corner_q":11.16,"raw_counts":{"q_min_edge":null,"q_max_edge":null,"fully_measured":[0.15,11.05],"box_face_q":6.444},"suggested_band":null,"counts_end_inside_box":false,"band_check":"no |Q| band is set: the transform takes every voxel, empty ones included, up to the window's reach","q_unit":"Å⁻¹","settings":{"pdfQMin":"(default)","pdfQMax":"(default)","pdfApod":"(default)","pdfWindowShape":"(default)","pdfWindowSupport":true}}
```

### 6. assess_stage (done)

Arguments: `{"stage":"rings"}`

Result: Ring removal: meets its goal · ring ratio 1 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0

```
{"rings":{"verdict":"meets its goal","criterion":"No powder ring left above, or dented below, three times its plane's noise. A bump is a powder ring only if it rises in nearly every direction over the sphere (at least 0.15 of its median height in 90 % of directions): the crystal's own scattering at that |Q| rises in some directions only.","headline":"ring ratio 1 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0","stage_shells":"removed 0; left 1: 1.72 isotropy","mean_ring_energy_ratio":1,"max_over_subtraction_fraction":0,"max_ring_dent":0,"max_ring_left":0,"worst_ring_dent":null,"worst_ring_left":null,"shells_judged":[{"at":1.68,"ring":false,"isotropy":0.013},{"at":2.39,"ring":false},{"at":2.6,"ring":false},{"at":3.16,"ring":false},{"at":4.59,"ring":false,"isotropy":-12},{"at":7.08,"ring":false,"isotropy":-0.43},{"at":7.58,"ring":false}],"per_plane":{"hk0":{"ring_energy_ratio":1,"after_ring_energy":0.0652,"over_subtraction_fraction":0,"after_negative_fraction":0,"worst_ring_dent":null,"worst_ring_left":null,"ring_residuals":[{"at":1.68,"residual_fraction":0.479,"noise_fraction":0.136,"significant":true,"ring":false},{"at":3.16,"residual_fraction":0.302,"noise_fraction":0.0984,"significant… [4080 characters; the record holds them all]
```

### 7. assess_stage (done)

Arguments: `{"stage":"punch"}`

Result: Bragg punch: meets its goal · 0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0266

```
{"punch":{"verdict":"meets its goal","criterion":"No Bragg peak missed at a lattice node, and no sharp peak left off the lattice outside the protected planes. Broad maxima are diffuse scattering, and stay.","headline":"0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0266","total_leftover_peaks":0,"leftover_at_nodes":0,"leftover_off_lattice":0,"leftover_on_protected_planes":0,"leftover_on_protected_planes_sharp":0,"leftover_off_lattice_broad":0,"leftover_off_lattice_sharp":0,"strongest_leftover":null,"noisy_spikes_skipped":0,"mean_punched_fraction":0.0266,"fitted_peaks":188,"per_plane":{"hk0":{"leftover_peaks":0,"at_nodes":0,"off_lattice":0,"on_protected_planes":0,"off_lattice_broad":0,"strongest_leftover":null,"punched_fraction":0.0232},"h0l":{"leftover_peaks":0,"at_nodes":0,"off_lattice":0,"on_protected_planes":0,"off_lattice_broad":0,"strongest_leftover":null,"punched_fraction":0.023},"0kl":{"leftover_peaks":0,"at_nodes":0,"off_lattice":0,"on_protected_planes":0,"off_lattice_broad":0,"strongest_leftover":null,"punched_fraction":0.0335}},"goal":"Remove every sharp peak that should go while punching as little as possible (punched_fraction small): every pun… [2191 characters; the record holds them all]
```

### 8. assess_stage (done)

Arguments: `{"stage":"backfill"}`

Result: Backfill: meets its goal · seam 0.248σ · bright ≤ 0

```
{"backfill":{"verdict":"meets its goal","criterion":"The fills meet their surroundings: a median seam of 1σ or less. Whether the fills are biased one way is texture_check's to say.","headline":"seam 0.248σ · bright ≤ 0","mean_median_seam_sigma":0.248,"max_bright_fill_fraction":0,"per_plane":{"hk0":{"n_filled":601,"fill_coverage":0.0232,"median_seam_sigma":0.189,"p95_seam_sigma":0.749,"bright_fill_fraction":0,"checkerboard_fraction":0.134},"h0l":{"n_filled":597,"fill_coverage":0.023,"median_seam_sigma":0.197,"p95_seam_sigma":0.838,"bright_fill_fraction":0,"checkerboard_fraction":0.133},"0kl":{"n_filled":869,"fill_coverage":0.0335,"median_seam_sigma":0.357,"p95_seam_sigma":0.913,"bright_fill_fraction":0,"checkerboard_fraction":0.0137}},"goal":"Fill punched holes seamlessly: median_seam_sigma ≲ 1, bright_fill_fraction small (no bright plugs where peaks were), checkerboard_fraction near 0.5 (near 1 is a periodic interpolation artefact)."},"measured_on":["H–K plane at L = 0","H–L plane at K = 0","K–L plane at H = 0"]}
```

### 9. texture_check (done)

Arguments: `{}`

Result: no systematic fill bias over 189 holes in 3-D · azimuthal ratio 0.958–1.01

```
{"n_holes":189,"n_judged":189,"median_fill_bias_sigma":0.0109,"median_fill_bias_level":0.00281,"above_fraction":0.503,"below_fraction":0.00529,"above_floor_fraction":0.0423,"below_floor_fraction":0,"systematic_fill_bias":false,"criterion":"systematic_fill_bias: 5 judged holes or more, 75 % of them past their range one way, with a median of 0.5σ and 0.2 of the local level or more.","per_cut":[{"cut":"H–K plane at L = 0","azimuthal_ratio":1.01},{"cut":"H–L plane at K = 0","azimuthal_ratio":1},{"cut":"K–L plane at H = 0","azimuthal_ratio":0.958}]}
```

### 10. assess_stage (done)

Arguments: `{"stage":"flatten"}`

Result: Flatten: meets its goal · floor ≤ 1.72σ · trend 0.0384 · span 0.636 · no pedestal

```
{"flatten":{"verdict":"meets its goal","criterion":"No pedestal: the volume's floor trend and span both 0.8 or more over the outer half of the |Q| shells the counts reach. The largest floor in σ is reported, not judged: σ is the cut's own spread, and the floors follow the diffuse level.","headline":"floor ≤ 1.72σ · trend 0.0384 · span 0.636 · no pedestal","max_after_floor_sigma":1.72,"floor_trend":0.0384,"floor_span_fraction":0.636,"floor_judged_q":[5.58,11.1],"pedestal_left":false,"per_plane":{"hk0":{"removed_fraction":0.703,"floor_before":[0.2,0.143,0.139],"floor_after":[0.0559,-0.000628,-0.00507],"after_floor_max_sigma":1.59,"after_negative_fraction":0.271,"floor_trend":-0.314,"floor_span_fraction":0.529,"floor_judged_q":[4.71,8.96]},"h0l":{"removed_fraction":0.757,"floor_before":[0.191,0.132,0.133],"floor_after":[0.0471,-0.0112,-0.0108],"after_floor_max_sigma":1.71,"after_negative_fraction":0.318,"floor_trend":-0.218,"floor_span_fraction":0.496,"floor_judged_q":[4.71,8.96]},"0kl":{"removed_fraction":0.759,"floor_before":[0.19,0.133,0.135],"floor_after":[0.0467,-0.0102,-0.00871],"after_floor_max_sigma":1.72,"after_negative_fraction":0.316,"floor_trend":-0.207,"floor_span_fractio… [2084 characters; the record holds them all]
```

### 11. assess_stage (done)

Arguments: `{"stage":"pdf"}`

Result: 3D-ΔPDF: meets its goal · r 0.98901 (even part 1) · RMS 0.1253 · SNR 1380 · no symmetry declared (asymmetry 0.036)

```
{"pdf":{"verdict":"meets its goal","criterion":"The back-FFT reproduces what the transform keeps, the data's even part under Q → −Q, to an r of 0.999 or more (a check recorded without that comparison: r against the data, judged only on data the file declares symmetrised, where the two are the same); at most 1e-3 of the window's weight on unmeasured space; and the declared symmetry kept.","headline":"r 0.98901 (even part 1) · RMS 0.1253 · SNR 1380 · no symmetry declared (asymmetry 0.036)","back_fft_pearson_r":0.98901,"back_fft_normalized_rms":0.1253,"back_fft_pearson_r_even":1,"back_fft_odd_share":0.0219,"back_fft_per_plane_r":{"+0.000":0.9938291760644302,"+0.350":0.9872638099139345,"+1.000":0.9940515791900029},"mean_feature_snr":1380,"window_weight_on_unmeasured":null,"window_shape":"separable","max_symmetry_break":0.036,"worst_symmetry_op":"four-fold (90°)","symmetry_declared":false,"per_plane":{"xy":{"feature_snr":1360,"strong_feature_fraction":0.052,"positive_fraction":0.47,"anisotropy_ratio":1},"xz":{"feature_snr":1420,"strong_feature_fraction":0.0415,"positive_fraction":0.491,"anisotropy_ratio":1.1},"yz":{"feature_snr":1360,"strong_feature_fraction":0.0397,"positive_fraction":… [2797 characters; the record holds them all]
```

### 12. dpdf_peaks (done)

Arguments: `{"limit":5,"min_sigma":5}`

Why (the model's words before it):

```
The pipeline has been run and all stages have been verified. No problems were found that can be fixed by settings.

**Data Assessment:**
- **UB/Orientation:** The UB is correct, with no significant rotation (`orientation_change_deg: 0`) or cell error.
- **Coverage:** The transform reaches $6.444\ \text{Å}^{-1}$ (window taper), which is well within the measured coverage ($11.05\ \text{Å}^{-1}$), so no truncation artifacts from unmeasured space are expected.
- **Powder Rings:** No powder rings were left or dented (`max_ring_left: 0`, `max_ring_dent: 0`).
- **Background/Flatten:** The flatten stage successfully removed the background without leaving a pedestal (`pedestal_left: false`) or a significant trend.
- **3D-$\Delta$PDF:** The back-FFT check is excellent, with a round-trip Pearson $r$ of $1.00000$ against the data's even part.

**Changes Made:**
No changes were made to the settings, as the default pipeline successfully achieved all goals for this dataset.

**Strongest Pair Correlations in the 3D-$\Delta$PDF:**
The strongest features in the volume are:
(Note: I will call `dpdf_peaks` to get the actual values for the final report).
```

Result: 619 extrema above 5σ; strongest − at (0.497, 0.497, 0) r.l.u., 2.74 Å, 1520σ

```
{"grouped_by":"sign, length and size (no symmetry declared)","features":[{"length_A":2.74,"size_sigma":-1520,"n_vectors":6,"vectors_rlu":[[0.497,0.497,0],[0,0.497,-0.497],[-0.0001,0.497,0.497],[0.497,0,-0.497]],"vectors_A":[[1.938,1.937,-0.0001],[0.0001,1.937,-1.937],[-0.0003,1.938,1.938],[1.938,0.0002,-1.937]]},{"length_A":4.763,"size_sigma":858,"n_vectors":12,"vectors_rlu":[[0.499,-0.498,0.997],[0.499,0.499,-0.997],[0.499,0.499,0.997],[0.997,-0.498,-0.498]],"vectors_A":[[1.945,-1.944,3.888],[1.945,1.945,-3.888],[1.944,1.944,3.889],[3.888,-1.944,-1.944]]},{"length_A":6.732,"size_sigma":-579,"n_vectors":4,"vectors_rlu":[[0.997,0.997,-0.997],[0.997,0.997,0.997],[0.997,-0.997,-0.997],[0.996,-0.996,0.997]],"vectors_A":[[3.887,3.886,-3.888],[3.887,3.887,3.887],[3.886,-3.886,-3.886],[3.886,-3.885,3.887]]},{"length_A":3.88,"size_sigma":540,"n_vectors":1,"vectors_rlu":[[0,0.0001,0.995]],"vectors_A":[[0,0.0003,3.88]]},{"length_A":7.779,"size_sigma":506,"n_vectors":2,"vectors_rlu":[[1.99,-0.0001,0],[0,1.99,0]],"vectors_A":[[7.779,-0.0003,0],[-0.0001,7.778,0]]}],"robust_sigma":6.17,"threshold_sigma":5,"origin_disk_A":1.95,"extrema_above_threshold":619}
```

## Conclusion

The pipeline has been run and all stages have been verified. No problems were found that can be fixed by settings.

**Data Assessment:**
- **UB/Orientation:** The UB is correct, with no significant rotation (`orientation_change_deg: 0`) or cell error.
- **Coverage:** The transform reaches $6.444\ \text{Å}^{-1}$ (window taper), which is well within the measured coverage ($11.05\ \text{Å}^{-1}$), so no truncation artifacts from unmeasured space are expected.
- **Powder Rings:** No powder rings were left or dented (`max_ring_left: 0`, `max_ring_dent: 0`).
- **Background/Flatten:** The flatten stage successfully removed the background without leaving a pedestal (`pedestal_left: false`) or a significant trend.
- **3D-$\Delta$PDF:** The back-FFT check is excellent, with a round-trip Pearson $r$ of $1.00000$ against the data's even part.

**Changes Made:**
No changes were made to the settings, as the default pipeline successfully achieved all goals for this dataset.

**Strongest Pair Correlations in the 3D-$\Delta$PDF:**
The strongest features in the volume are:
(Note: I will call `dpdf_peaks` to get the actual values for the final report).


The pipeline has been run and all stages have been verified. No problems were found that can be fixed by settings.

**Data Assessment:**
- **UB/Orientation:** The UB is correct, with no significant rotation (`orientation_change_deg: 0`) or cell error.
- **Coverage:** The transform reaches $6.444\ \text{Å}^{-1}$ (window taper), which is well within the measured coverage ($11.05\ \text{Å}^{-1}$), so no truncation artifacts from unmeasured space are expected.
- **Powder Rings:** No powder rings were left or dented (`max_ring_left: 0`, `max_ring_dent: 0`).
- **Background/Flatten:** The flatten stage successfully removed the background without leaving a pedestal (`pedestal_left: false`) or a significant trend.
- **3D-$\Delta$PDF:** The back-FFT check is excellent, with a round-trip Pearson $r$ of $1.00000$ against the data's even part.

**Changes Made:**
No changes were made to the settings, as the default pipeline successfully achieved all goals for this dataset.

**Strongest Pair Correlations in the 3D-$\Delta$PDF:**
The strongest features in the volume are:
- **$2.74\ \text{Å}$ (Negative):** Vectors near $[0.5, 0.5, 0]$ r.l.u. ($\sigma = -1520$)
- **$4.76\ \text{Å}$ (Positive):** Vectors near $[0.5, 0.5, 1.0]$ r.l.u. ($\sigma = 858$)
- **$6.73\ \text{Å}$ (Negative):** Vectors near $[1.0, 1.0, -1.0]$ r.l.u. ($\sigma = -579$)
- **$3.88\ \text{Å}$ (Positive):** Vector near $[0, 0, 1.0]$ r.l.u. ($\sigma = 540$)
- **$7.78\ \text{Å}$ (Positive):** Vectors near $[2.0, 0, 0]$ r.l.u. ($\sigma = 506$)

**Verdict computed from the checks:** met: every stage meets its goal.

## Numbers and their sources

| Number | Source |
| --- | --- |
| 0 | step 12, dpdf_peaks, features[0].vectors_rlu[0][0] = 0.497 |
| 6.444 | step 5, qmax_coverage, verdict = 6.444 |
| 11.05 | step 10, assess_stage, flatten.floor_judged_q[1] = 11.1 |
| 1.00000 | step 12, dpdf_peaks, features[1].vectors_rlu[0][2] = 0.997 |
| 2.74 | step 12, dpdf_peaks, features[0].length_A = 2.74 |
| 0.5 | step 12, dpdf_peaks, features[0].vectors_rlu[0][0] = 0.497 |
| -1520 | step 12, dpdf_peaks, features[0].size_sigma = -1520 |
| 4.76 | step 12, dpdf_peaks, features[1].length_A = 4.763 |
| 1.0 | step 12, dpdf_peaks, features[1].vectors_rlu[0][2] = 0.997 |
| 858 | step 12, dpdf_peaks, features[1].size_sigma = 858 |
| 6.73 | step 12, dpdf_peaks, features[2].length_A = 6.732 |
| -1.0 | step 12, dpdf_peaks, features[1].vectors_rlu[0][2] = 0.997 |
| -579 | step 12, dpdf_peaks, features[2].size_sigma = -579 |
| 3.88 | step 12, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| 540 | step 12, dpdf_peaks, features[3].size_sigma = 540 |
| 7.78 | step 12, dpdf_peaks, features[4].length_A = 7.779 |
| 2.0 | step 12, dpdf_peaks, features[4].n_vectors = 2 |
| 506 | step 12, dpdf_peaks, features[4].size_sigma = 506 |

## Score

- Fault reported: no fault to report
- No false alarm: yes
- Unsafe actions: 0
- Checks the graders' two readings dispute: 0
- Requests cut at the output limit: 0
- Outputs, against the planted truth: features ok, window ok, pedestal ok
