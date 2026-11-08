# dev-control, arm B, run 3

Model: Claude Sonnet 5.5 (Anthropic) (Anthropic). Started 2026-11-08T00:22:35.624Z; 89 s, 240524 tokens in and 9835 out over 9 requests, $0.2184. The model saw the dataset as va21fc1-B3.

Run policy: Claude through Anthropic's SDK; up to 12 rounds of tool calls; offered every tool; no result shortened; temperature none sent; output cap 16,000 tokens, the tuning's 16,000 tokens; thinking sent back with each turn that called tools; window not checked.

## Task

This is a new single-crystal diffuse-scattering volume. Take it to a 3D-ΔPDF you would trust for analysis. Run the pipeline, check every stage and the data themselves (the orientation, the coverage, powder rings, the background), fix what the settings you may change can fix and run again, and report any problem with the data that the settings cannot fix. End with: the problems you found (or that you found none), what you changed and why, and the strongest pair correlations in the 3D-ΔPDF with their vectors and signs.

## Tools offered

As sent with each request (the Pilot offers a local model the tools its question needs, and more once it calls them):

- Request 1: 28 tools; added read_skill, describe_dataset, current_view, measure_reciprocal_cut, measure_dpdf_cut, assess_stage, texture_check, qmax_coverage, symmetry_check, dpdf_contrast, dpdf_peaks, grain_check, ub_check, compare_laue_classes, radial_profile, line_profile, bragg_peaks, consistency_details, run_log, compare_datasets, run_verdict, configure_settings, update_settings, run_pipeline, tune_pipeline, regrid_refined_ub, show_in_viewer, mark_region
- Request 2: 28 tools
- Request 3: 28 tools
- Request 4: 28 tools
- Request 5: 28 tools
- Request 6: 28 tools
- Request 7: 28 tools
- Request 8: 28 tools
- Request 9: 28 tools

The first request's tools: read_skill, describe_dataset, current_view, measure_reciprocal_cut, measure_dpdf_cut, assess_stage, texture_check, qmax_coverage, symmetry_check, dpdf_contrast, dpdf_peaks, grain_check, ub_check, compare_laue_classes, radial_profile, line_profile, bragg_peaks, consistency_details, run_log, compare_datasets, run_verdict, configure_settings, update_settings, run_pipeline, tune_pipeline, regrid_refined_ub, show_in_viewer, mark_region.

## Steps

### 1. read_skill (done)

Arguments: `{"name":"reduction-qc"}`

Why (the model's words before it):

```
I'm going to read the skills first, since I need them before I act, so I'll open all three.
I'll start by reading the three skills, then look at the dataset.
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

### 2. read_skill (done)

Arguments: `{"name":"bragg-node-audit"}`

Result: Read the bragg-node-audit skill

```
Skill bragg-node-audit

# Bragg-node audit

The punch removes what sits at the Bragg nodes, so the 3D-ΔPDF sees only the
diffuse scattering. An audit checks the nodes the cell allows, the nodes it
forbids and the peaks off every node, and keeps the broad diffuse maxima out of
all three.

## Gates

- A real leftover at an allowed node is sharp and stands above its own
  neighbourhood: widen or deepen the punch only for those.
- A forbidden node's signal is intensity clearly above the local background;
  name its cause only with the evidence for it.
- `grain_check`: a rotation under 2° is the UB, not a grain: check it with
  `ub_check` (reduction-qc). The leftover counts are only what the punch missed
  on one cut, never what its search found.
- A maximum several Bragg widths broad along any axis is diffuse scattering,
  the signal: never a missed peak.
- `texture_check`: no fills sitting systematically outside the range their
  rims allow, a bias counting only at a fifth of the local diffuse level or
  more; on the cuts, an azimuthal ratio near 1.
- `ub_turn`: one turn only far beyond its error, explaining most offsets.

## Steps

1. **Settle the nodes.** `describe_dataset` and `con… [3948 characters; the record holds them all]
```

### 3. read_skill (done)

Arguments: `{"name":"delta-pdf-interpretation"}`

Result: Read the delta-pdf-interpretation skill

```
Skill delta-pdf-interpretation

# Interpreting a 3D-ΔPDF

The 3D-ΔPDF is the Fourier transform of the diffuse scattering left once the
Bragg peaks are removed: its features are the pair correlations' deviations
from the average structure, at the interatomic vectors where they occur.
Interpret only a ΔPDF that passes the trust checks.

## Gates

- `qmax_coverage`: the window's weight on unmeasured space up to about 1e-3,
  and the band inside the raw counts' edges (reduction-qc); past them,
  features come from empty voxels.
- `symmetry_check`, on symmetrised data: each operation the data were
  symmetrised with holds to about 1e-3 or better. A clear break while the raw
  data were exact was made by processing: do not interpret that ΔPDF.
- `assess_stage` for the ΔPDF, or `consistency_details`: a back-FFT r of 0.999
  or more only shows the transform ran correctly, never that a feature is real.
- `dpdf_contrast`: never describe a figure whose features are saturated.
- Nothing nearer the origin than the shortest interatomic distance is
  interpreted.

## Steps

1. **The settings that made it.** `qmax_coverage`: the window's shape and
   scale; `consistency_details`: the |Q| band; `gr… [3747 characters; the record holds them all]
```

### 4. describe_dataset (done)

Arguments: `{}`

Result: va21fc1_B3: raw, ringremoved, braggpunched, backfilled, flattened, delta_pdf

```
{"dataset":"va21fc1_B3","id":"va21fc1-B3","stages":["raw","ringremoved","braggpunched","backfilled","flattened","delta_pdf"],"reciprocal":{"grid":[161,161,161],"H":[-4,4],"K":[-4,4],"L":[-4,4],"planes":["hk0","h0l","0kl"]},"cell":{"a":3.9,"b":3.9,"c":3.9,"alpha":90,"beta":90,"gamma":90},"sigma":"measured","delta_pdf":{"grid":[162,162,162],"x":[-39,38.52],"y":[-39,38.52],"z":[-39,38.52],"q_max":11.16,"planes":["xy","xz","yz"]},"other_datasets":[]}
```

### 5. configure_settings (done)

Arguments: `{}`

Result: 0 settings off their defaults, 61 at them

```
{"settings":{},"at_default":61}
```

### 6. run_pipeline (done)

Arguments: `{}`

Result: done in 0.6 s · 0 computed, 6 reused

```
{"ended":"done","seconds":0.6,"stages":{"rings":"reused","punch":"reused","backfill":"reused","flatten":"reused","pdf":"reused","pdf_check":"reused"},"outputs":["raw","ringremoved","braggpunched","backfilled","flattened","delta_pdf"],"log_tail":["Bragg punch · va21fc1_B3_ringremoved_braggpunched.h5 exists","Backfill · va21fc1_B3_ringremoved_braggpunched_backfilled.h5 exists","Flatten · va21fc1_B3_ringremoved_braggpunched_backfilled_flattened.h5 exists","3D-ΔPDF · va21fc1_B3_ringremoved_braggpunched_backfilled_delta_pdf.h5 is current","Consistency check · va21fc1_B3_ringremoved_braggpunched_backfilled_delta_pdf_consistency.json exists"]}
```

### 7. ub_check (done)

Arguments: `{}`

Result: both: RMS 0.0004 → 0.0004 Å⁻¹ over 90 peaks; a 3.900 → 3.900 Å, c 3.900 → 3.900 Å; turned 0.000°

```
{"verdict":"the UB is right: turned 0°, under the 0.05° that counts as turned","fit":"both","bragg_nodes_every":[1,1,1],"symmetry_from":null,"symmetrised":null,"symmetry_break":null,"peaks":{"searched":342,"used":90,"rejected":0},"rms_start":0.0004,"rms":0.0004,"cell_start":"3.9000, 3.9000, 3.9000 Å; 90.000°, 90.000°, 90.000°","cell":"3.8998, 3.8999, 3.8999 Å; 90.000°, 90.000°, 90.000°","orientation_change_deg":0,"axis_uvw":[-0.379,0.913,1],"transform_diagonal":[1.00004,1.000036,1.000016],"passes":[{"q_max":3.72,"found":14,"used":14,"rms":"0.0003 → 0.0003"},{"q_max":7.44,"found":82,"used":82,"rms":"0.0004 → 0.0004"},{"q_max":11.16,"found":90,"used":90,"rms":"0.0004 → 0.0004"}],"radial":[{"q":"0–4","direction":"in-plane","n":4,"before":0.000045,"after":0.0000071},{"q":"0–4","direction":"oblique","n":8,"before":-0.000078,"after":-0.00011},{"q":"4–8","direction":"in-plane","n":4,"before":0.000053,"after":0.000015},{"q":"4–8","direction":"oblique","n":56,"before":0.000049,"after":0.000018},{"q":"4–8","direction":"near the third axis","n":8,"before":0.000032,"after":0.000012},{"q":"8–12","direction":"oblique","n":8,"before":0.000029,"after":-0.0000028}],"unexplained":false,"mean_offset_… [1435 characters; the record holds them all]
```

### 8. qmax_coverage (done)

Arguments: `{}`

Result: the transform reaches 6.444 Å⁻¹ (the window tapers to zero at the box faces), inside full coverage at 11.05 Å⁻¹

```
{"verdict":"the transform reaches 6.444 Å⁻¹ (the window tapers to zero at the box faces), inside full coverage at 11.05 Å⁻¹","window_weight_on_unmeasured":null,"window_shape":"separable","window_scale":1,"transform_reach_q":6.444,"reach_from":"the window tapers to zero at the box faces","full_coverage_q":11.05,"box_face_q":6.444,"box_corner_q":11.16,"raw_counts":{"q_min_edge":null,"q_max_edge":null,"fully_measured":[0.15,11.05],"box_face_q":6.444},"suggested_band":null,"counts_end_inside_box":false,"band_check":"no |Q| band is set: the transform takes every voxel, empty ones included, up to the window's reach","q_unit":"Å⁻¹","settings":{"pdfQMin":"(default)","pdfQMax":"(default)","pdfApod":"(default)","pdfWindowShape":"(default)","pdfWindowSupport":true}}
```

### 9. compare_laue_classes (done)

Arguments: `{}`

Result: suggests 4/mmm

```
{"columns":"r_int, x_noise, chi2: [all voxels, diffuse]; x_noise = R_int / noise floor, chi2 = χ²/dof (1: within counting noise)","classes":[{"class":"-1","ops":2,"r_int":[0.052,0.053],"x_noise":[1,1],"chi2":[1,1],"orbits":2086640,"verdict":"supported"},{"class":"2/m (b unique)","ops":4,"contains":["-1"],"r_int":[0.063,0.065],"x_noise":[1,1],"chi2":[1,1],"orbits":1049840,"verdict":"supported"},{"class":"2/m (c unique)","ops":4,"contains":["-1"],"r_int":[0.063,0.065],"x_noise":[1,1],"chi2":[1,1],"orbits":1049840,"verdict":"supported"},{"class":"mmm","ops":8,"contains":["2/m (b unique)","2/m (c unique)"],"r_int":[0.069,0.07],"x_noise":[1,1],"chi2":[1,1],"orbits":531440,"verdict":"supported"},{"class":"4/m","ops":8,"contains":["2/m (c unique)"],"r_int":[0.069,0.071],"x_noise":[1,1],"chi2":[1,1],"orbits":524960,"verdict":"supported"},{"class":"4/mmm","ops":16,"contains":["mmm","4/m"],"r_int":[0.071,0.073],"x_noise":[1,1],"chi2":[1,1],"orbits":269000,"verdict":"supported"},{"class":"m-3","ops":24,"contains":["mmm"],"r_int":[0.085,0.088],"x_noise":[1.19,1.19],"chi2":[1.47,1.48],"orbits":177200,"verdict":"rose 1.19× against 2/m (b unique)"},{"class":"m-3m","ops":48,"contains":["4/mmm","m-… [2298 characters; the record holds them all]
```

### 10. assess_stage (done)

Arguments: `{}`

Why (the model's words before it):

```
The pipeline turned out to be reused, which is unexpected, but the outputs are already there. The box face's Qmax is 6.444 and the window tapers, which is acceptable. Next I'll assess everything else.
```

Result: Ring removal: meets its goal · ring ratio 1 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0 · Bragg punch: meets its goal · 0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0266 · Backfill: meets its goal · seam 0.248σ · bright ≤ 0 · Flatten: meets its goal · floor ≤ 1.72σ · trend 0.0384 · span 0.636 · no pedestal · 3D-ΔPDF: meets its goal · r 0.98901 (even part 1) · RMS 0.1253 · SNR 1380 · no symmetry declared (asymmetry 0.036)

```
{"rings":{"verdict":"meets its goal","criterion":"No powder ring left above, or dented below, three times its plane's noise. A bump is a powder ring only if it rises in nearly every direction over the sphere (at least 0.15 of its median height in 90 % of directions): the crystal's own scattering at that |Q| rises in some directions only.","headline":"ring ratio 1 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0","stage_shells":"removed 0; left 1: 1.72 isotropy","mean_ring_energy_ratio":1,"max_over_subtraction_fraction":0,"max_ring_dent":0,"max_ring_left":0,"worst_ring_dent":null,"worst_ring_left":null,"shells_judged":[{"at":1.68,"ring":false,"isotropy":0.013},{"at":2.39,"ring":false},{"at":2.6,"ring":false},{"at":3.16,"ring":false},{"at":4.59,"ring":false,"isotropy":-12},{"at":7.08,"ring":false,"isotropy":-0.43},{"at":7.58,"ring":false}]},"punch":{"verdict":"meets its goal","criterion":"No Bragg peak missed at a lattice node, and no sharp peak left off the lattice outside the protected planes. Broad maxima are diffuse scattering, and stay.","headline":"0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0266","total_leftover_peaks":0,"leftover_at_nodes":0,"leftover_o… [3164 characters; the record holds them all]
```

### 11. texture_check (done)

Arguments: `{}`

Result: no systematic fill bias over 189 holes in 3-D · azimuthal ratio 0.958–1.01

```
{"n_holes":189,"n_judged":189,"median_fill_bias_sigma":0.0109,"median_fill_bias_level":0.00281,"above_fraction":0.503,"below_fraction":0.00529,"above_floor_fraction":0.0423,"below_floor_fraction":0,"systematic_fill_bias":false,"criterion":"systematic_fill_bias: 5 judged holes or more, 75 % of them past their range one way, with a median of 0.5σ and 0.2 of the local level or more.","per_cut":[{"cut":"H–K plane at L = 0","azimuthal_ratio":1.01},{"cut":"H–L plane at K = 0","azimuthal_ratio":1},{"cut":"K–L plane at H = 0","azimuthal_ratio":0.958}]}
```

### 12. grain_check (done)

Arguments: `{}`

Result: no off-lattice peaks were recorded by the punch's search

```
{"off_lattice_orbits":0,"judged":0,"near_bragg_nodes":0,"near_offset_angle_deg":null,"far":[],"rotated_copy":{"indexed":0,"misorientation_deg":null},"random_control":0,"verdict":"no off-lattice peaks were recorded by the punch's search","off_lattice_peaks":0,"declared_symmetry":null,"punch_cell":[1,1,1]}
```

### 13. symmetry_check (done)

Arguments: `{}`

Result: no symmetry declared: not judged

```
{"sections":"xy at z = 0 Å, xz at y = 0, yz at x = 0","operations":"the cell's in-plane ones (orthogonal): no operations declared","ops":[{"op":"four-fold ∥ c (90°)","rms_difference":0.039,"pairs":78083,"tested_on":"xy; xz↔yz"},{"op":"two-fold ∥ c","rms_difference":0.038,"pairs":51520,"tested_on":"xz; yz"},{"op":"mirror ⊥ a","rms_difference":0.038,"pairs":51520,"tested_on":"xy; xz"},{"op":"mirror ⊥ b","rms_difference":0.038,"pairs":51520,"tested_on":"xy; yz"}],"holds":[],"symmetry_declared":false,"verdict":"not judged: the file declares no symmetry, so the sections' asymmetry (0.039) is the data's own, counting noise included, not a break by a stage"}
```

### 14. consistency_details (done)

Arguments: `{}`

Result: r = 0.989, normalised RMS = 0.1253; against the even part r = 1 (odd share 0.02185)

```
{"pearson_r":0.989,"normalized_rms":0.1253,"rms":0.013583852092373403,"n_voxels":3617683,"per_plane_r":{"+0.000":0.9938,"+0.350":0.9873,"+1.000":0.9941},"pearson_r_even":1,"normalized_rms_even":1.135e-14,"odd_share":0.02185,"n_voxels_even":3617683,"crop_hkl":null,"q_band":null,"apodization":"gaussian"}
```

### 15. run_log (done)

Arguments: `{}`

Result: 6 lines · done

```
{"ended":"done","lines":{"cols":["stage","status","message"],"rows":[["rings","skip","va21fc1_B3_ringremoved.h5 exists"],["punch","skip","va21fc1_B3_ringremoved_braggpunched.h5 exists"],["backfill","skip","va21fc1_B3_ringremoved_braggpunched_backfilled.h5 exists"],["flatten","skip","va21fc1_B3_ringremoved_braggpunched_backfilled_flattened.h5 exists"],["pdf","skip","va21fc1_B3_ringremoved_braggpunched_backfilled_delta_pdf.h5 is current"],["pdf_check","skip","va21fc1_B3_ringremoved_braggpunched_backfilled_delta_pdf_consistency.json exists"]]}}
```

### 16. run_pipeline (done)

Arguments: `{"from_stage":"rings"}`

Why (the model's words before it):

```
I've checked everything that meets the goals, and the ring at 1.72 isotropy doesn't hold up, since the shell at 1.68 with isotropy 0.013 isn't a ring. Next I'm going to look at the radial profile, an off-zero cut, and other planes for a second cut, then audit the nodes for forbidden ones before running the verdict and checking peaks. This pipeline was reused rather than freshly run, and nothing was recomputed in this session, which is fine, so I'm just noting that the tools after the last recomputing run don't change anything.

I'm weighing whether to force a fresh run from the rings step, since the on-disk outputs may have been produced under different settings than the current defaults. Re-running from rings would make sure everything lines up before I re-measure.
Every stage was reused from disk, so the files may not match the current settings. I'll recompute from the first stage and measure again.
```

Result: done in 6.7 s · 6 computed, 0 reused

```
{"ended":"done","seconds":6.7,"stages":{"rings":"computed","punch":"computed","backfill":"computed","flatten":"computed","pdf":"computed","pdf_check":"computed"},"outputs":["raw","ringremoved","braggpunched","backfilled","flattened","delta_pdf"],"log_tail":["Flatten · flatten complete (const 0.1437 + 0·F(Q)², R² 0.000)","3D-ΔPDF · 3D-ΔPDF FFT (apodize=gaussian)","3D-ΔPDF · ΔPDF complete (|Q|max 11.16 Å⁻¹, shape (162, 162, 162))","Consistency check · back-FFT round-trip consistency check","Consistency check · back-FFT vs data: r=0.98901, normalised RMS=1.253e-01; vs the data's even part, which the transform keeps: r=1.00000"]}
```

### 17. assess_stage (done)

Arguments: `{}`

Result: Ring removal: meets its goal · ring ratio 1 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0 · Bragg punch: meets its goal · 0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0266 · Backfill: meets its goal · seam 0.248σ · bright ≤ 0 · Flatten: meets its goal · floor ≤ 1.72σ · trend 0.0384 · span 0.636 · no pedestal · 3D-ΔPDF: meets its goal · r 0.98901 (even part 1) · RMS 0.1253 · SNR 1380 · no symmetry declared (asymmetry 0.036)

```
{"rings":{"verdict":"meets its goal","criterion":"No powder ring left above, or dented below, three times its plane's noise; a powder ring rises at least 0.15 of its median height in 90 % of directions.","headline":"ring ratio 1 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0","stage_shells":"removed 0; left 1: 1.72 isotropy","mean_ring_energy_ratio":1,"max_over_subtraction_fraction":0,"max_ring_dent":0,"max_ring_left":0,"worst_ring_dent":null,"worst_ring_left":null,"shells_judged":[{"at":1.68,"ring":false,"isotropy":0.013},{"at":2.39,"ring":false},{"at":2.6,"ring":false},{"at":3.16,"ring":false},{"at":4.59,"ring":false,"isotropy":-12},{"at":7.08,"ring":false,"isotropy":-0.43},{"at":7.58,"ring":false}]},"punch":{"verdict":"meets its goal","criterion":"No Bragg peak missed at a lattice node; no sharp peak left off the lattice outside the protected planes.","headline":"0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0266","total_leftover_peaks":0,"leftover_at_nodes":0,"leftover_off_lattice":0,"leftover_on_protected_planes":0,"leftover_on_protected_planes_sharp":0,"leftover_off_lattice_broad":0,"leftover_off_lattice_sharp":0,"strongest_leftover":null,"noisy_spikes_… [2639 characters; the record holds them all]
```

### 18. texture_check (done)

Arguments: `{}`

Result: no systematic fill bias over 189 holes in 3-D · azimuthal ratio 0.958–1.01

```
{"n_holes":189,"n_judged":189,"median_fill_bias_sigma":0.0109,"median_fill_bias_level":0.00281,"above_fraction":0.503,"below_fraction":0.00529,"above_floor_fraction":0.0423,"below_floor_fraction":0,"systematic_fill_bias":false,"criterion":"systematic_fill_bias: 5 judged holes or more, 75 % of them past their range one way, with a median of 0.5σ and 0.2 of the local level or more.","per_cut":[{"cut":"H–K plane at L = 0","azimuthal_ratio":1.01},{"cut":"H–L plane at K = 0","azimuthal_ratio":1},{"cut":"K–L plane at H = 0","azimuthal_ratio":0.958}]}
```

### 19. measure_reciprocal_cut (done)

Arguments: `{"plane":"hk0","value":0.5}`

Result: H–K plane at L = 0.5: ring ratio 1 · 0 missed at nodes, 0 sharp off-lattice, 0 broad maxima · floor ≤ 1.41σ

```
{"cut":"H–K plane at L = 0.5","ring_removal":{"before_ring_energy":0.0618,"after_ring_energy":0.0618,"ring_energy_ratio":1,"over_subtraction_fraction":0,"after_negative_fraction":0,"ring_residuals":[{"at":1.47,"fwhm":0.21,"residual_fraction":0.418,"noise_fraction":0.102,"significant":true},{"at":3.54,"fwhm":0.21,"residual_fraction":0.351,"noise_fraction":0.0883,"significant":true},{"at":7.97,"fwhm":0.072,"residual_fraction":0.424,"noise_fraction":0.13,"significant":true}],"worst_ring_dent":null,"worst_ring_left":{"at":7.97,"fwhm":0.072,"residual_fraction":0.424,"noise_fraction":0.13,"significant":true},"suggested_display_vmax":0.5537,"n_finite":25921},"bragg_punch_leftover":{"suspicious_peaks":[],"n_suspicious":0,"n_at_nodes":0,"n_off_nodes":0,"n_on_protected":0,"n_broad_off_nodes":0,"n_skipped_noisy":0,"scan_sigma_threshold":8},"backfill":{"n_filled":0,"fill_coverage":0,"median_seam_sigma":null,"p95_seam_sigma":null,"bright_fill_fraction":null,"checkerboard_fraction":null},"flatten":{"removed_fraction":0.815,"floor_before":[0.165,0.128,0.131],"floor_after":[0.0216,-0.0155,-0.0123],"after_floor_max_sigma":1.41,"after_negative_fraction":0.353,"floor_trend":0.0643,"floor_span_fractio… [2499 characters; the record holds them all]
```

### 20. measure_reciprocal_cut (done)

Arguments: `{"plane":"0kl","value":1.5}`

Result: K–L plane at H = 1.5: ring ratio 1 · 0 missed at nodes, 0 sharp off-lattice, 0 broad maxima · floor ≤ 1.13σ

```
{"cut":"K–L plane at H = 1.5","ring_removal":{"before_ring_energy":0.0413,"after_ring_energy":0.0413,"ring_energy_ratio":1,"over_subtraction_fraction":0,"after_negative_fraction":0,"ring_residuals":[{"at":2.76,"fwhm":0.22,"residual_fraction":0.524,"noise_fraction":0.159,"significant":true},{"at":3.13,"fwhm":0.074,"residual_fraction":0.0991,"noise_fraction":0.0373,"significant":false},{"at":4.16,"fwhm":0.22,"residual_fraction":0.187,"noise_fraction":0.0879,"significant":false},{"at":4.68,"fwhm":0.074,"residual_fraction":0.0774,"noise_fraction":0.00687,"significant":true},{"at":6.23,"fwhm":0.15,"residual_fraction":0.112,"noise_fraction":0.0323,"significant":true},{"at":8.29,"fwhm":0.15,"residual_fraction":0.208,"noise_fraction":0.0749,"significant":false}],"worst_ring_dent":null,"worst_ring_left":{"at":2.76,"fwhm":0.22,"residual_fraction":0.524,"noise_fraction":0.159,"significant":true},"suggested_display_vmax":0.5285,"n_finite":25921},"bragg_punch_leftover":{"suspicious_peaks":[],"n_suspicious":0,"n_at_nodes":0,"n_off_nodes":0,"n_on_protected":0,"n_broad_off_nodes":0,"n_skipped_noisy":0,"scan_sigma_threshold":8},"backfill":{"n_filled":0,"fill_coverage":0,"median_seam_sigma":null,"p9… [1539 characters; the record holds them all]
```

### 21. radial_profile (done)

Arguments: `{}`

Result: H–K plane at L = 0: 32 shells × 5 stages

```
{"cut":"H–K plane at L = 0","q_unit":"|Q| in Å⁻¹","stat":"median per shell","shells":{"cols":["q","raw","ringremoved","braggpunched","backfilled","flattened"],"rows":[[0.183,0.344,0.344,0.214,0.18,0.0365],[0.436,0.179,0.179,0.179,0.179,0.035],[0.715,0.174,0.174,0.174,0.174,0.0302],[1,0.205,0.205,0.205,0.205,0.0615],[1.28,0.258,0.258,0.258,0.258,0.115],[1.57,0.416,0.416,0.416,0.416,0.272],[1.86,0.45,0.45,0.45,0.45,0.306],[2.14,0.325,0.325,0.325,0.325,0.181],[2.42,0.317,0.317,0.317,0.317,0.173],[2.71,0.281,0.281,0.281,0.281,0.138],[2.99,0.207,0.207,0.205,0.193,0.0492],[3.27,0.214,0.214,0.2,0.178,0.0348],[3.56,0.153,0.153,0.153,0.151,0.00782],[3.84,0.135,0.135,0.135,0.135,-0.00834],[4.13,0.155,0.155,0.155,0.155,0.0118],[4.41,0.227,0.227,0.219,0.225,0.0815],[4.7,0.303,0.303,0.298,0.296,0.152],[4.98,0.247,0.247,0.247,0.247,0.104],[5.27,0.232,0.232,0.232,0.232,0.0881],[5.55,0.253,0.253,0.253,0.253,0.109],[5.84,0.217,0.217,0.217,0.217,0.0729],[6.12,0.201,0.201,0.2,0.196,0.0527],[6.4,0.155,0.155,0.149,0.154,0.0107],[6.68,0.143,0.143,0.143,0.143,-0.000319],[6.97,0.238,0.238,0.231,0.219,0.0749],[7.25,0.273,0.273,0.252,0.236,0.0922],[7.54,0.229,0.229,0.229,0.229,0.085],[7.82,0.188,0.188,0.188… [1375 characters; the record holds them all]
```

### 22. qmax_coverage (done)

Arguments: `{}`

Result: the transform reaches 6.444 Å⁻¹ (the window tapers to zero at the box faces), inside full coverage at 11.05 Å⁻¹

```
{"verdict":"the transform reaches 6.444 Å⁻¹ (the window tapers to zero at the box faces), inside full coverage at 11.05 Å⁻¹","window_weight_on_unmeasured":null,"window_shape":"separable","window_scale":1,"transform_reach_q":6.444,"reach_from":"the window tapers to zero at the box faces","full_coverage_q":11.05,"box_face_q":6.444,"box_corner_q":11.16,"raw_counts":{"q_min_edge":null,"q_max_edge":null,"fully_measured":[0.15,11.05],"box_face_q":6.444},"suggested_band":null,"counts_end_inside_box":false,"band_check":"no |Q| band is set: the transform takes every voxel, empty ones included, up to the window's reach","q_unit":"Å⁻¹","settings":{"pdfQMin":"(default)","pdfQMax":"(default)","pdfApod":"(default)","pdfWindowShape":"(default)","pdfWindowSupport":true}}
```

### 23. ub_check (done)

Arguments: `{}`

Result: both: RMS 0.0004 → 0.0004 Å⁻¹ over 90 peaks; a 3.900 → 3.900 Å, c 3.900 → 3.900 Å; turned 0.000°

```
{"verdict":"the UB is right: turned 0°, under the 0.05° that counts as turned","fit":"both","bragg_nodes_every":[1,1,1],"symmetry_from":null,"symmetrised":null,"symmetry_break":null,"peaks":{"searched":342,"used":90,"rejected":0},"rms_start":0.0004,"rms":0.0004,"cell_start":"3.9000, 3.9000, 3.9000 Å; 90.000°, 90.000°, 90.000°","cell":"3.8998, 3.8999, 3.8999 Å; 90.000°, 90.000°, 90.000°","orientation_change_deg":0,"axis_uvw":[-0.379,0.913,1],"transform_diagonal":[1.00004,1.000036,1.000016],"passes":[{"q_max":3.72,"found":14,"used":14,"rms":"0.0003 → 0.0003"},{"q_max":7.44,"found":82,"used":82,"rms":"0.0004 → 0.0004"},{"q_max":11.16,"found":90,"used":90,"rms":"0.0004 → 0.0004"}],"radial":[{"q":"0–4","direction":"in-plane","n":4,"before":0.000045,"after":0.0000071},{"q":"0–4","direction":"oblique","n":8,"before":-0.000078,"after":-0.00011},{"q":"4–8","direction":"in-plane","n":4,"before":0.000053,"after":0.000015},{"q":"4–8","direction":"oblique","n":56,"before":0.000049,"after":0.000018},{"q":"4–8","direction":"near the third axis","n":8,"before":0.000032,"after":0.000012},{"q":"8–12","direction":"oblique","n":8,"before":0.000029,"after":-0.0000028}],"unexplained":false,"mean_offset_… [1435 characters; the record holds them all]
```

### 24. grain_check (done)

Arguments: `{}`

Result: no off-lattice peaks were recorded by the punch's search

```
{"off_lattice_orbits":0,"judged":0,"near_bragg_nodes":0,"near_offset_angle_deg":null,"far":[],"rotated_copy":{"indexed":0,"misorientation_deg":null},"random_control":0,"verdict":"no off-lattice peaks were recorded by the punch's search","off_lattice_peaks":0,"declared_symmetry":null,"punch_cell":[1,1,1]}
```

### 25. symmetry_check (done)

Arguments: `{}`

Result: no symmetry declared: not judged

```
{"sections":"xy at z = 0 Å, xz at y = 0, yz at x = 0","operations":"the cell's in-plane ones (orthogonal): no operations declared","ops":[{"op":"four-fold ∥ c (90°)","rms_difference":0.039,"pairs":78083,"tested_on":"xy; xz↔yz"},{"op":"two-fold ∥ c","rms_difference":0.038,"pairs":51520,"tested_on":"xz; yz"},{"op":"mirror ⊥ a","rms_difference":0.038,"pairs":51520,"tested_on":"xy; xz"},{"op":"mirror ⊥ b","rms_difference":0.038,"pairs":51520,"tested_on":"xy; yz"}],"holds":[],"symmetry_declared":false,"verdict":"not judged: the file declares no symmetry, so the sections' asymmetry (0.039) is the data's own, counting noise included, not a break by a stage"}
```

### 26. dpdf_contrast (done)

Arguments: `{}`

Result: ± 3120 (459σ, 0.33 of the strongest feature) · 1.3 % coloured

```
{"applied":{"limit":3120,"limit_sigma":459,"share_of_strongest":0.33,"coloured_fraction":0.013,"from":"optimised: the 99.9th percentile of |ΔPDF|"},"robust_sigma":6.81,"sigma_of":"the three sections together, outside the origin's disk, robust","strongest_feature_sigma":1370,"not_applied":{"99.5th percentile":{"limit":800,"limit_sigma":118,"share_of_strongest":0.086,"coloured_fraction":0.029,"effect":"a lower limit: brighter, weaker correlations and more of the ripple coloured"},"99.97th percentile":{"limit":5580,"limit_sigma":819,"share_of_strongest":0.6,"coloured_fraction":0.0083,"effect":"a higher limit: dimmer, only the strongest features coloured"}},"sections":"xy, xz and yz through the origin, the origin's disk left out"}
```

### 27. dpdf_peaks (done)

Arguments: `{}`

Result: 619 extrema above 5σ; strongest − at (0.497, 0.497, 0) r.l.u., 2.74 Å, 1520σ

```
{"grouped_by":"sign, length and size (no symmetry declared)","features":[{"length_A":2.74,"size_sigma":-1520,"n_vectors":6,"vectors_rlu":[[0.497,0.497,0],[0,0.497,-0.497],[-0.0001,0.497,0.497],[0.497,0,-0.497]],"vectors_A":[[1.938,1.937,-0.0001],[0.0001,1.937,-1.937],[-0.0003,1.938,1.938],[1.938,0.0002,-1.937]]},{"length_A":4.763,"size_sigma":858,"n_vectors":12,"vectors_rlu":[[0.499,-0.498,0.997],[0.499,0.499,-0.997],[0.499,0.499,0.997],[0.997,-0.498,-0.498]],"vectors_A":[[1.945,-1.944,3.888],[1.945,1.945,-3.888],[1.944,1.944,3.889],[3.888,-1.944,-1.944]]},{"length_A":6.732,"size_sigma":-579,"n_vectors":4,"vectors_rlu":[[0.997,0.997,-0.997],[0.997,0.997,0.997],[0.997,-0.997,-0.997],[0.996,-0.996,0.997]],"vectors_A":[[3.887,3.886,-3.888],[3.887,3.887,3.887],[3.886,-3.886,-3.886],[3.886,-3.885,3.887]]},{"length_A":3.88,"size_sigma":540,"n_vectors":1,"vectors_rlu":[[0,0.0001,0.995]],"vectors_A":[[0,0.0003,3.88]]},{"length_A":7.779,"size_sigma":506,"n_vectors":2,"vectors_rlu":[[1.99,-0.0001,0],[0,1.99,0]],"vectors_A":[[7.779,-0.0003,0],[-0.0001,7.778,0]]},{"length_A":7.779,"size_sigma":245,"n_vectors":1,"vectors_rlu":[[-0.0003,0.0004,1.99]],"vectors_A":[[-0.0011,0.0015,7.779]]},{"lengt… [2612 characters; the record holds them all]
```

### 28. bragg_peaks (done)

Arguments: `{"sort_by":"anisotropy","limit":5}`

Result: 188 fitted peaks; top 5 by anisotropy

```
{"n_peaks":188,"punch_frame":"spherical","sorted_by":"anisotropy","peaks":{"cols":["hkl","q","intensity","local_background","significance","measured_width_q","resolution_limited","anisotropy","fit"],"rows":[[[-4,0,0],6.444,56.09,0.297,179.5,null,null,1.61,"profile"],[[0,-4,0],6.444,56.24,0.2896,180,null,null,1.61,"profile"],[[0,0,-4],6.444,55.46,0.2826,177.7,null,null,1.61,"profile"],[[0,0,4],6.444,56.23,0.2863,180.2,null,null,1.61,"profile"],[[0,4,0],6.444,56.37,0.2983,180.6,null,null,1.61,"profile"]]}}
```

### 29. dpdf_peaks (done)

Arguments: `{"limit":30,"min_sigma":100}`

Why (the model's words before it):

```
I'm checking the ring findings: the assessment rules out any confirmed ring, and the single in-cut residual is flagged as significant without a ring verdict. Looking at the radial profile, the outermost shell drops sharply after flattening and backfilling, and there's a possible ring near q around 1.7 that I still need to make sense of.

I'm reading the ΔPDF peaks: the strongest is a large negative at (½,½,0), which I'd put at about 2.74 Å. Half-integer vectors look odd for a simple cubic cell, but for a perovskite of roughly 3.9 Å the O–O vector would fall there, so that's a plausible reading. I still need to explain why the (0,0,1) peak appears alone while the x and y directions don't show up in the same way.

I'm wondering whether the (1,0,0) and (0,1,0) peaks are simply sitting just below the list cutoff, since only the z-direction vector made it into the output. I'll rerun the peak listing with a larger limit to see whether the x and y vectors are there with similar sizes. I also still want to check the odd share value, since the data hasn't been symmetrised and the Laue group suggests 4/mmm.

Next I'm checking whether the feature anisotropy holds up across the cuts, so I'll pull a larger set of peaks and measure the xy and xz slices. The corner shell at 8.92 Å⁻¹ still looks like it's coming from high-order Bragg peaks, and I've already punched it out. Last, I'm auditing the Bragg nodes for forbidden reflections, which should be straightforward for a cubic primitive cell…
```

Result: 71 extrema above 100σ; strongest − at (0.497, 0.497, 0) r.l.u., 2.74 Å, 1520σ

```
{"grouped_by":"sign, length and size (no symmetry declared)","features":[{"length_A":2.74,"size_sigma":-1520,"n_vectors":6,"vectors_rlu":[[0.497,0.497,0],[0,0.497,-0.497],[-0.0001,0.497,0.497],[0.497,0,-0.497]],"vectors_A":[[1.938,1.937,-0.0001],[0.0001,1.937,-1.937],[-0.0003,1.938,1.938],[1.938,0.0002,-1.937]]},{"length_A":4.763,"size_sigma":858,"n_vectors":12,"vectors_rlu":[[0.499,-0.498,0.997],[0.499,0.499,-0.997],[0.499,0.499,0.997],[0.997,-0.498,-0.498]],"vectors_A":[[1.945,-1.944,3.888],[1.945,1.945,-3.888],[1.944,1.944,3.889],[3.888,-1.944,-1.944]]},{"length_A":6.732,"size_sigma":-579,"n_vectors":4,"vectors_rlu":[[0.997,0.997,-0.997],[0.997,0.997,0.997],[0.997,-0.997,-0.997],[0.996,-0.996,0.997]],"vectors_A":[[3.887,3.886,-3.888],[3.887,3.887,3.887],[3.886,-3.886,-3.886],[3.886,-3.885,3.887]]},{"length_A":3.88,"size_sigma":540,"n_vectors":1,"vectors_rlu":[[0,0.0001,0.995]],"vectors_A":[[0,0.0003,3.88]]},{"length_A":7.779,"size_sigma":506,"n_vectors":2,"vectors_rlu":[[1.99,-0.0001,0],[0,1.99,0]],"vectors_A":[[7.779,-0.0003,0],[-0.0001,7.778,0]]},{"length_A":7.779,"size_sigma":245,"n_vectors":1,"vectors_rlu":[[-0.0003,0.0004,1.99]],"vectors_A":[[-0.0011,0.0015,7.779]]},{"lengt… [3020 characters; the record holds them all]
```

### 30. measure_dpdf_cut (done)

Arguments: `{"plane":"xy","value":0}`

Result: ΔPDF x–y section at z = 0 Å: SNR 1360, anisotropy 1

```
{"cut":"ΔPDF x–y section at z = 0 Å","delta_pdf":{"origin_excluded_radius":1.95,"background_sigma":6.9,"feature_snr":1360,"strong_feature_fraction":0.052,"positive_fraction":0.47,"anisotropy_ratio":1,"anisotropy_angle_deg":61.4,"radial_trend":[190,7.48,4.83]},"sigma_of":"this section outside the origin's disk, robust","fields":"All in this section's robust σ outside the origin's disk. feature_snr: the strongest feature over background σ (≳ 5 is clear signal); strong_feature_fraction: voxels beyond 5σ; positive_fraction: 0.5 is balanced ±; anisotropy_ratio: 1 isotropic, above ~1.5 rods or sheets, along anisotropy_angle_deg in the plane; radial_trend: mean |ΔPDF| in the inner, middle and outer shells."}
```

### 31. measure_dpdf_cut (done)

Arguments: `{"plane":"xz","value":3.9}`

Result: ΔPDF x–z section at y = 3.9 Å: SNR 793, anisotropy 1.1

```
{"cut":"ΔPDF x–z section at y = 3.9 Å","delta_pdf":{"origin_excluded_radius":1.95,"background_sigma":6.67,"feature_snr":793,"strong_feature_fraction":0.0324,"positive_fraction":0.432,"anisotropy_ratio":1.1,"anisotropy_angle_deg":-1.93,"radial_trend":[109,5.56,4.93]},"sigma_of":"this section outside the origin's disk, robust"}
```

### 32. line_profile (done)

Arguments: `{"stage":"flattened","along":"H","at":{"K":0.5,"L":0.5},"n_points":64}`

Result: flattened along H at K=0.5, L=0.5: max 0.2996 at -0.45

```
{"stage":"flattened","along":"H","through":{"K":0.5,"L":0.5},"units":"r.l.u.","points":[[-3.95,-0.03466],[-3.8,-0.006621],[-3.65,0.0678],[-3.5,0.161],[-3.35,0.07375],[-3.2,0.009934],[-3.05,0.009985],[-2.9,-0.007851],[-2.75,0.02964],[-2.6,0.1173],[-2.45,0.1489],[-2.3,0.04445],[-2.15,-0.005628],[-2,0.007097],[-1.85,0.003344],[-1.7,0.03622],[-1.55,0.2055],[-1.4,0.1824],[-1.25,0.0942],[-1.1,0.05458],[-0.95,0.06051],[-0.8,0.09252],[-0.65,0.1513],[-0.5,0.2908],[-0.35,0.1401],[-0.2,0.06384],[-0.05,0.05391],[0.1,0.05732],[0.25,0.08161],[0.4,0.1725],[0.55,0.2385],[0.7,0.1209],[0.85,0.07089],[1,0.05681],[1.15,0.08003],[1.3,0.09944],[1.45,0.2331],[1.6,0.1731],[1.75,0.05153],[1.9,-0.02062],[2.05,-0.006723],[2.2,0.002409],[2.35,0.06465],[2.5,0.1684],[2.65,0.09326],[2.8,0.005537],[2.95,-0.009152],[3.1,-0.005488],[3.25,0.02936],[3.4,0.1239],[3.55,0.1388],[3.7,0.04038],[3.85,-0.00468],[3.975,-0.0196]],"max":{"at":-0.45,"value":0.2996},"min":{"at":-3.9,"value":-0.06083},"median":0.06202,"masked_fraction":0}
```

### 33. measure_reciprocal_cut (done)

Arguments: `{"plane":"h0l","value":0.5}`

Result: H–L plane at K = 0.5: ring ratio 1 · 0 missed at nodes, 0 sharp off-lattice, 0 broad maxima · floor ≤ 1.52σ

```
{"cut":"H–L plane at K = 0.5","ring_removal":{"before_ring_energy":0.0315,"after_ring_energy":0.0315,"ring_energy_ratio":1,"over_subtraction_fraction":0,"after_negative_fraction":0,"ring_residuals":[{"at":1.54,"fwhm":0.21,"residual_fraction":0.216,"noise_fraction":0.0885,"significant":false},{"at":2.25,"fwhm":0.072,"residual_fraction":0.0904,"noise_fraction":0.0367,"significant":false},{"at":2.68,"fwhm":0.14,"residual_fraction":0.0328,"noise_fraction":0.0398,"significant":false},{"at":3.54,"fwhm":0.14,"residual_fraction":0.125,"noise_fraction":0.0567,"significant":false},{"at":5.83,"fwhm":0.21,"residual_fraction":0.101,"noise_fraction":0.0386,"significant":false},{"at":6.26,"fwhm":0.14,"residual_fraction":0.0632,"noise_fraction":0.021,"significant":true},{"at":6.61,"fwhm":0.072,"residual_fraction":0.173,"noise_fraction":0.023,"significant":true},{"at":7.97,"fwhm":0.072,"residual_fraction":0.216,"noise_fraction":0.0557,"significant":true}],"worst_ring_dent":null,"worst_ring_left":{"at":7.97,"fwhm":0.072,"residual_fraction":0.216,"noise_fraction":0.0557,"significant":true},"suggested_display_vmax":0.5546,"n_finite":25921},"bragg_punch_leftover":{"suspicious_peaks":[],"n_suspicious":0… [1723 characters; the record holds them all]
```

### 34. run_verdict (done)

Arguments: `{}`

Why (the model's words before it):

```
I'm looking at diffuse scattering near half-integer positions like (0.5, 0.5, 0.5). The peaks there are broad, around 0.3 r.l.u. wide, sitting well above the background, which points to diffuse signal rather than sharp Bragg reflections. A superlattice would give sharper peaks, so this broadness argues against one.

I'm noting that the broad half-integer signal isn't being logged as off-lattice peaks. Next I'll run the verdict and mark the top features in the PDF before wrapping up.
```

Result: met: every stage meets its goal

```
{"verdict":"met: every stage meets its goal","achieved":"met","stages":{"rings":"meets its goal","punch":"meets its goal","backfill":"meets its goal","flatten":"meets its goal","pdf":"meets its goal"},"needs_attention":[],"not_judged":[],"not_measured":[],"data_problems":[]}
```

### 35. mark_region (done)

Arguments: `{"where":"pdf","shape":"points","points":[[1.938,1.937,0],[1.938,0,-1.937],[0,1.937,1.938]],"label":"Strongest: negative at (½,½,0) type, 2.74 Å","evidence":["dpdf_peaks.features.0"]}`

Result: M2 · Strongest: negative at (½,½,0) type, 2.74 Å: x–y section at z = 0 Å; x–z section at y = 1.926 Å; y–z section at x = 1.926 Å

```
{"marked":"M2","label":"Strongest: negative at (½,½,0) type, 2.74 Å","where":"pdf","page":"3D-ΔPDF","region":{"shape":"points","points":[[1.938,1.937,0],[1.938,0,-1.937],[0,1.937,1.938]],"unit":"Å"},"drawn_on":[{"view":"ΔPDF x–y section at z = 0 Å","points":1},{"view":"ΔPDF x–z section at y = 1.926 Å","points":2},{"view":"ΔPDF y–z section at x = 1.926 Å","points":2}],"zoomed":true,"evidence":["dpdf_peaks.features.0 (step 29)"]}
```

### 36. mark_region (done)

Arguments: `{"where":"pdf","shape":"points","points":[[1.944,1.944,3.889],[3.888,-1.944,-1.944],[1.945,-1.944,3.888]],"label":"Positive at (½,½,1) type, 4.76 Å","evidence":["dpdf_peaks.features.1"]}`

Result: M3 · Positive at (½,½,1) type, 4.76 Å: x–y section at z = 3.852 Å; x–z section at y = -1.926 Å; y–z section at x = 1.926 Å

```
{"marked":"M3","label":"Positive at (½,½,1) type, 4.76 Å","where":"pdf","page":"3D-ΔPDF","region":{"shape":"points","points":[[1.944,1.944,3.889],[3.888,-1.944,-1.944],[1.945,-1.944,3.888]],"unit":"Å"},"drawn_on":[{"view":"ΔPDF x–y section at z = 3.852 Å","points":2},{"view":"ΔPDF x–z section at y = -1.926 Å","points":2},{"view":"ΔPDF y–z section at x = 1.926 Å","points":2}],"zoomed":false,"evidence":["dpdf_peaks.features.1 (step 29)"]}
```

## Conclusion

I'll start by reading the three skills, then look at the dataset.

Every stage was reused from disk, so the files may not match the current settings. I'll recompute from the first stage and measure again.

**Result:** I found no data problems and changed no settings. The app's verdict is **met: every stage meets its goal**.

I recomputed every stage from the rings stage, because the first run only reused files already on disk. All measurements below come after that recompute.

**Data checks**
- **Orientation:** the UB is right. The orientation turned 0°, and the tool's verdict is "the UB is right: turned 0°, under the 0.05° that counts as turned". The fit used 90 peaks and ended at an RMS of 0.0004 r.l.u. The fitted cell is 3.8998, 3.8999, 3.8999 Å; 90.000°, 90.000°, 90.000°, against 3.9 Å declared. The radial offsets are tiny and show no |Q| trend. No origin shift was reported.
- **Second grain:** no off-lattice peaks were recorded by the punch's search.
- **Coverage:**
  - The transform reaches 6.444 Å⁻¹, where the window tapers to zero at the box faces.
  - Full coverage extends to 11.05 Å⁻¹, so the window has no weight on unmeasured space.
  - The raw counts do not end inside the box (`counts_end_inside_box` = no).
  - No |Q| band is set, and none is needed.
- **Laue class:** `compare_laue_classes` suggests **4/mmm**. The m-3m class has x_noise 1.18 and m-3 has 1.19. Both "rose 1.18× against 2/m (b unique) (all); rose 1.19× against 2/m (b unique) (diffuse)", so cubic symmetry is not supported. The volume is not symmetrised, and I did not set the class. Symmetry averaging in 4/mmm is your decision. A twinned crystal would look more symmetric to this test than it really is.

**Stage checks**
- **Rings:** pass. The ring ratio is 1, with no leftovers (0) and no dents (0). None of the judged shells is a confirmed 3D ring (first shell: `ring` = no). The bump near 1.7 Å⁻¹ in the radial profile is the crystal's diffuse scattering, not a ring.
- **Bragg punch:** pass. It fitted 188 peaks, with 0 missed at nodes and 0 off the lattice. It punched 0.0266 of the volume. Two off-zero cuts (hk0 at L = 0.5 and h0l at K = 0.5) also show no missed peaks.
- **Backfill:** pass. The median seam is 0.248σ. `texture_check` found no systematic fill bias (`systematic_fill_bias` = no). The azimuthal ratios are 1.01, 1 and 0.958.
- **Flatten:** pass. The floor is at most 1.72σ. The trend is 0.0384 and the span is 0.636, both under 0.8, so no pedestal is left (`pedestal_left` = no). I left the Q² term off.
- **ΔPDF round trip:**
  - The back-FFT matches the data's even part with r = 1.
  - Against the full data, r is 0.98901. The difference is the odd part of the data (0.0219), which the transform does not keep and which is not a fault.
  - No symmetry is declared, so `symmetry_check` is not judged. The sections' own asymmetry (for example 0.039 for the four-fold) is the data's own, counting noise included.

**Diffuse scattering at half-integer positions:** along H through (H, 0.5, 0.5) the flattened data show broad maxima at half-integer H, for example near (±0.5, 0.5, 0.5). The line's maximum is 0.2996 against a median of 0.06202. The maxima are broad along the line, so they are diffuse signal, not superlattice peaks. The punch's search recorded no sharp off-lattice peaks (0).

**Strongest pair correlations in the 3D-ΔPDF**

The colour range is set by `dpdf_contrast` (limit 459σ). The robust σ is 6.17, and features are listed outside the 1.95 Å origin disk.

| Vector (x/a, y/b, z/c) | Length | Sign | Size |
|---|---|---|---|
| (½,½,0) and permutations | 2.74 Å | negative | -1520σ |
| (½,½,1) and permutations | 4.763 Å | positive | 858σ |
| (1,1,1) | 6.732 Å | negative | -579σ |
| (0,0,1) | 3.88 Å | positive | 540σ |
| (2,0,0) and (0,2,0) | 7.779 Å | positive | 506σ |

The next features are weaker: (0,0,2) at 245σ, (3/2,0,0) and (1,1,0).

- The strongest feature, at 2.74 Å, is negative at the (½,½,0) vectors. M2 marks it. The tool grouped 6 vectors of one sign, length and size.
- The positive (½,½,1) feature is marked as M3.
- These vectors sit on lattice or half-lattice positions of a ~3.9 Å cell. That is consistent with a perovskite-like structure, but that is my inference, since I have no structure file. What the pairs actually are, and whether the sign reflects clustering, ordering or a displacement correlation, is for you to decide.
- The (0,0,1) feature is listed alone, while (1,0,0) and (0,1,0) do not appear at that size. The (0,0,2) feature (245σ) is about half the size of (2,0,0)/(0,2,0) (506σ). That suggests a mild axis inequivalence, but I did not test it.

**What I did not check**
- I did not test the assignment of the pairs against a structure, because there is no CIF.
- I did not test whether the c axis is inequivalent to a and b.

**Your decisions**
- Whether to symmetrise in 4/mmm.
- Whether to set a |Q| band. None is needed from the coverage.

**Verdict computed from the checks:** met: every stage meets its goal.

## Numbers and their sources

| Number | Source |
| --- | --- |
| 0 | step 35, mark_region, label = 0 |
| 0.05 | step 32, line_profile, points[19][1] = 0.05458 |
| 90 | step 25, symmetry_check, ops[0].op = 90 |
| 0.0004 | step 29, dpdf_peaks, features[5].vectors_rlu[0][1] = 0.0004 |
| 3.8998 | step 36, mark_region, region.points[0][2] = 3.889 |
| 3.8999 | step 36, mark_region, region.points[0][2] = 3.889 |
| 90.000 | step 25, symmetry_check, ops[0].op = 90 |
| 3.9 | step 36, mark_region, region.points[0][2] = 3.889 |
| 6.444 | step 28, bragg_peaks, peaks.rows[0][1] = 6.444 |
| 11.05 | step 29, dpdf_peaks, features[12].length_A = 11.01 |
| 1.18 | step 9, compare_laue_classes, classes[6].x_noise[0] = 1.19 |
| 3 | step 35, mark_region, label = 2.74 |
| 1.19 | step 9, compare_laue_classes, classes[6].x_noise[0] = 1.19 |
| 1 | step 36, mark_region, label = 1 |
| 1.7 | step 32, line_profile, points[15][0] = -1.7 |
| 188 | step 30, measure_dpdf_cut, delta_pdf.radial_trend[0] = 190 |
| 0.0266 | step 17, assess_stage, punch.headline = 0.0266 |
| 0.5 | step 33, measure_reciprocal_cut, cut = 0.5 |
| 0.248 | step 32, line_profile, points[28][0] = 0.25 |
| 1.01 | step 36, mark_region, label = 1 |
| 0.958 | step 32, line_profile, points[20][0] = -0.95 |
| 1.72 | step 32, line_profile, points[15][0] = -1.7 |
| 0.0384 | step 33, measure_reciprocal_cut, ring_removal.ring_residuals[4].noise_fraction = 0.0386 |
| 0.636 | step 17, assess_stage, flatten.headline = 0.636 |
| 0.8 | step 32, line_profile, points[21][0] = -0.8 |
| 0.98901 | step 36, mark_region, label = 1 |
| 0.0219 | step 19, measure_reciprocal_cut, flatten.floor_after[0] = 0.0216 |
| 0.039 | step 33, measure_reciprocal_cut, ring_removal.ring_residuals[4].noise_fraction = 0.0386 |
| 0.2996 | step 32, line_profile, max.value = 0.2996 |
| 0.06202 | step 33, measure_reciprocal_cut, ring_removal.ring_residuals[5].residual_fraction = 0.0632 |
| 459 | step 26, dpdf_contrast, applied.limit_sigma = 459 |
| 6.17 | step 33, measure_reciprocal_cut, ring_removal.ring_residuals[5].at = 6.26 |
| 1.95 | step 36, mark_region, region.points[0][0] = 1.944 |
| 2.74 | step 35, mark_region, label = 2.74 |
| -1520 | step 29, dpdf_peaks, features[0].size_sigma = -1520 |
| 4.763 | step 36, mark_region, label = 4.76 |
| 858 | step 29, dpdf_peaks, features[1].size_sigma = 858 |
| 6.732 | step 33, measure_reciprocal_cut, ring_removal.ring_residuals[6].at = 6.61 |
| -579 | step 29, dpdf_peaks, features[2].size_sigma = -579 |
| 3.88 | step 36, mark_region, region.points[0][2] = 3.889 |
| 540 | step 29, dpdf_peaks, features[3].size_sigma = 540 |
| 2 | step 36, mark_region, region.points[0][0] = 1.944 |
| 7.779 | step 29, dpdf_peaks, features[4].length_A = 7.779 |
| 506 | step 29, dpdf_peaks, features[4].size_sigma = 506 |
| 245 | step 29, dpdf_peaks, features[5].size_sigma = 245 |
| 6 | step 33, measure_reciprocal_cut, ring_removal.ring_residuals[4].at = 5.83 |

## Score

- Fault reported: no fault to report
- No false alarm: yes
- Unsafe actions: 0
- Checks the graders' two readings dispute: 0
- Requests cut at the output limit: 0
- Outputs, against the planted truth: features ok, window ok, pedestal ok
