# dev-flatten, arm B, run 1

Model: Claude Haiku 5.5 (Anthropic) (Anthropic). Started 2026-11-07T22:40:22.472Z; 94 s, 364393 tokens in and 13519 out over 13 requests, $0.0146. The model saw the dataset as va7eeb5-B1.

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
- Request 10: 28 tools
- Request 11: 28 tools
- Request 12: 28 tools
- Request 13: 28 tools

The first request's tools: read_skill, describe_dataset, current_view, measure_reciprocal_cut, measure_dpdf_cut, assess_stage, texture_check, qmax_coverage, symmetry_check, dpdf_contrast, dpdf_peaks, grain_check, ub_check, compare_laue_classes, radial_profile, line_profile, bragg_peaks, consistency_details, run_log, compare_datasets, run_verdict, configure_settings, update_settings, run_pipeline, tune_pipeline, regrid_refined_ub, show_in_viewer, mark_region.

## Steps

### 1. read_skill (done)

Arguments: `{"name":"reduction-qc"}`

Why (the model's words before it):

```
I'm going to read the reduction-qc, bragg-node-audit, and delta-pdf-interpretation skills first, then run the pipeline. Before that, I'll check the dataset, set the configuration, and load the skills.
I'll start by reading the reduction-qc skill, then check the dataset and its current settings.
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

Result: va7eeb5_B1: raw, ringremoved, braggpunched, backfilled, flattened, delta_pdf

```
{"dataset":"va7eeb5_B1","id":"va7eeb5-B1","stages":["raw","ringremoved","braggpunched","backfilled","flattened","delta_pdf"],"reciprocal":{"grid":[161,161,161],"H":[-4,4],"K":[-4,4],"L":[-4,4],"planes":["hk0","h0l","0kl"]},"cell":{"a":3.9,"b":3.9,"c":3.9,"alpha":90,"beta":90,"gamma":90},"sigma":"measured","delta_pdf":{"grid":[162,162,162],"x":[-39,38.52],"y":[-39,38.52],"z":[-39,38.52],"q_max":11.16,"planes":["xy","xz","yz"]},"other_datasets":[]}
```

### 3. configure_settings (done)

Arguments: `{}`

Result: 0 settings off their defaults, 61 at them

```
{"settings":{},"at_default":61}
```

### 4. run_pipeline (done)

Arguments: `{}`

Why (the model's words before it):

```
I'll start with the default settings and run the pipeline first, then the checks. The data-check tools can go in parallel: ub_check on the raw volume doesn't depend on the pipeline, so I'll run it alongside the pipeline with qmax_coverage.
Settings are all at default. I'll run the pipeline and, in parallel, the UB and coverage checks on the raw volume, which don't depend on the run.
```

Result: done in 2.4 s · 3 computed, 3 reused

```
{"ended":"done","seconds":2.4,"stages":{"rings":"reused","punch":"reused","backfill":"reused","flatten":"computed","pdf":"computed","pdf_check":"computed"},"outputs":["raw","ringremoved","braggpunched","backfilled","flattened","delta_pdf"],"log_tail":["3D-ΔPDF · va7eeb5_B1_ringremoved_braggpunched_backfilled_delta_pdf.h5 stale — recomputing","3D-ΔPDF · 3D-ΔPDF FFT (apodize=gaussian)","3D-ΔPDF · ΔPDF complete (|Q|max 11.16 Å⁻¹, shape (162, 162, 162))","Consistency check · back-FFT round-trip consistency check","Consistency check · back-FFT vs data: r=0.98891, normalised RMS=1.342e-01; vs the data's even part, which the transform keeps: r=1.00000"]}
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

### 7. assess_stage (done)

Arguments: `{}`

Why (the model's words before it):

```
Next I'm moving on to the stage assessments and the Laue symmetry checks. I'll load the bragg-node-audit and delta-pdf-interpretation skills first, since I need them before tuning. Then I'll run assess_stage on all stages and compare_laue_classes on the raw data, which is fine because the volume hasn't been symmetrised.
The UB is right (turn 0.001°) and the counts cover the box. Next, the stage verdicts, the Laue-class comparison, and the skills I'll need before touching any settings.
```

Result: Ring removal: meets its goal · ring ratio 1 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0 · Bragg punch: meets its goal · 0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0257 · Backfill: meets its goal · seam 0.202σ · bright ≤ 0 · Flatten: needs attention · floor ≤ 1.8σ · trend 0.996 · span 1.3 · pedestal left · 3D-ΔPDF: meets its goal · r 0.98891 (even part 1) · RMS 0.1342 · SNR 1250 · no symmetry declared (asymmetry 0.038)

```
{"rings":{"verdict":"meets its goal","criterion":"No powder ring left above, or dented below, three times its plane's noise. A bump is a powder ring only if it rises in nearly every direction over the sphere (at least 0.15 of its median height in 90 % of directions): the crystal's own scattering at that |Q| rises in some directions only.","headline":"ring ratio 1 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0","stage_shells":"removed 0; left 1: 1.72 isotropy","mean_ring_energy_ratio":1,"max_over_subtraction_fraction":0,"max_ring_dent":0,"max_ring_left":0,"worst_ring_dent":null,"worst_ring_left":null,"shells_judged":[{"at":1.68,"ring":false,"isotropy":0.005},{"at":2.39,"ring":false},{"at":3.16,"ring":false,"isotropy":-15},{"at":4.59,"ring":false},{"at":5.52,"ring":false,"isotropy":-1.9},{"at":5.66,"ring":false,"isotropy":-4.6},{"at":6.02,"ring":false},{"at":7.08,"ring":false,"isotropy":-0.83},{"at":7.23,"ring":false},{"at":7.58,"ring":false},{"at":7.73,"ring":false,"isotropy":-0.84}]},"punch":{"verdict":"meets its goal","criterion":"No Bragg peak missed at a lattice node, and no sharp peak left off the lattice outside the protected planes. Broad maxima are diffuse scattering, and stay.",… [3302 characters; the record holds them all]
```

### 8. compare_laue_classes (done)

Arguments: `{}`

Result: suggests 4/mmm; flag: the diffuse supports only 4/mmm

```
{"columns":"r_int, x_noise, chi2: [all voxels, diffuse]; x_noise = R_int / noise floor, chi2 = χ²/dof (1: within counting noise)","classes":[{"class":"-1","ops":2,"r_int":[0.034,0.035],"x_noise":[1,1],"chi2":[1,1],"orbits":2086640,"verdict":"supported"},{"class":"2/m (b unique)","ops":4,"contains":["-1"],"r_int":[0.042,0.042],"x_noise":[1,1],"chi2":[1,1],"orbits":1049840,"verdict":"supported"},{"class":"2/m (c unique)","ops":4,"contains":["-1"],"r_int":[0.042,0.042],"x_noise":[1,1],"chi2":[1,1],"orbits":1049840,"verdict":"supported"},{"class":"mmm","ops":8,"contains":["2/m (b unique)","2/m (c unique)"],"r_int":[0.045,0.046],"x_noise":[1,1],"chi2":[1,1],"orbits":531440,"verdict":"supported"},{"class":"4/m","ops":8,"contains":["2/m (c unique)"],"r_int":[0.045,0.046],"x_noise":[1,1],"chi2":[1,1],"orbits":524960,"verdict":"supported"},{"class":"4/mmm","ops":16,"contains":["mmm","4/m"],"r_int":[0.047,0.047],"x_noise":[1,1],"chi2":[1,1],"orbits":269000,"verdict":"supported"},{"class":"m-3","ops":24,"contains":["mmm"],"r_int":[0.052,0.053],"x_noise":[1.1,1.1],"chi2":[1.25,1.26],"orbits":177200,"verdict":"supported (all); rose 1.1× against -1 (diffuse)"},{"class":"m-3m","ops":48,"contains"… [2414 characters; the record holds them all]
```

### 9. read_skill (done)

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

### 10. read_skill (done)

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

### 11. radial_profile (done)

Arguments: `{"plane":"hk0","value":0,"stages":["backfilled","flattened"]}`

Why (the model's words before it):

```
The flatten step is showing a left-side pedestal, so I'm planning to turn on flattenQ2, rerun from flatten, and reassess. I'm also wondering whether the 1.72 shell isotropy needs a judgement, though the rings already meet the goal. On symmetry, the compare step points to 4/mmm, but the file declares none and the user hasn't given one, so I'm weighing what Laue class to use.

Before touching the flatten settings, I'm going back over the reduction-qc skill's flatten guidance, which I've already read, to confirm the change is safe. I'll apply flattenQ2 and rerun from flatten, and first gather texture_check, grain_check, and the radial profile for comparison.
The flatten stage reports a pedestal left (trend 0.996, span 1.3). Before I change anything, I'll record the flatten baseline and run the punch, backfill, and grain checks, which don't depend on the flatten.
```

Result: H–K plane at L = 0: 32 shells × 2 stages

```
{"cut":"H–K plane at L = 0","q_unit":"|Q| in Å⁻¹","stat":"median per shell","shells":{"cols":["q","backfilled","flattened"],"rows":[[0.183,0.18,-0.18],[0.436,0.182,-0.179],[0.715,0.176,-0.185],[1,0.21,-0.151],[1.28,0.267,-0.0936],[1.57,0.434,0.0736],[1.86,0.472,0.111],[2.14,0.35,-0.0109],[2.42,0.349,-0.0118],[2.71,0.325,-0.0361],[2.99,0.25,-0.11],[3.27,0.252,-0.108],[3.56,0.227,-0.134],[3.84,0.227,-0.134],[4.13,0.265,-0.0952],[4.41,0.341,-0.0199],[4.7,0.429,0.0679],[4.98,0.399,0.0382],[5.27,0.398,0.0375],[5.55,0.445,0.0843],[5.84,0.423,0.0619],[6.12,0.424,0.0631],[6.4,0.402,0.0412],[6.68,0.419,0.0583],[6.97,0.514,0.154],[7.25,0.544,0.183],[7.54,0.563,0.203],[7.82,0.557,0.196],[8.1,0.53,0.169],[8.38,0.521,0.161],[8.65,0.582,0.221],[8.92,0.677,0.317]]}}
```

### 12. texture_check (done)

Arguments: `{}`

Result: no systematic fill bias over 189 holes in 3-D · azimuthal ratio 0.932–0.966

```
{"n_holes":189,"n_judged":189,"median_fill_bias_sigma":0,"median_fill_bias_level":0,"above_fraction":0.418,"below_fraction":0.00529,"above_floor_fraction":0,"below_floor_fraction":0,"systematic_fill_bias":false,"criterion":"systematic_fill_bias: 5 judged holes or more, 75 % of them past their range one way, with a median of 0.5σ and 0.2 of the local level or more.","per_cut":[{"cut":"H–K plane at L = 0","azimuthal_ratio":0.966},{"cut":"H–L plane at K = 0","azimuthal_ratio":0.957},{"cut":"K–L plane at H = 0","azimuthal_ratio":0.932}]}
```

### 13. grain_check (done)

Arguments: `{}`

Result: no off-lattice peaks were recorded by the punch's search

```
{"off_lattice_orbits":0,"judged":0,"near_bragg_nodes":0,"near_offset_angle_deg":null,"far":[],"rotated_copy":{"indexed":0,"misorientation_deg":null},"random_control":0,"verdict":"no off-lattice peaks were recorded by the punch's search","off_lattice_peaks":0,"declared_symmetry":null,"punch_cell":[1,1,1]}
```

### 14. bragg_peaks (done)

Arguments: `{"limit":5}`

Result: 188 fitted peaks; top 5 by significance

```
{"n_peaks":188,"punch_frame":"spherical","sorted_by":"significance","peaks":{"cols":["hkl","q","intensity","local_background","significance","measured_width_q","resolution_limited","anisotropy","fit"],"rows":[[[0,2,0],3.222,112.1,0.1995,259.2,null,null,1,"own"],[[-2,0,0],3.222,111.8,0.2015,258.6,null,null,1,"own"],[[0,-2,0],3.222,111.7,0.2003,258.5,null,null,1,"own"],[[2,0,0],3.222,111.5,0.1984,257.9,null,null,1,"own"],[[0,0,2],3.222,111.3,0.2006,257.5,null,null,1,"own"]]}}
```

### 15. update_settings (done)

Arguments: `{"changes":{"flattenQ2":true}}`

Why (the model's words before it):

```
The flatten baseline shows a floor trend of 0.996 with a span of 1.3 in the outer shells. Flattened values run positive, about 0.2 to 0.3, at high q and sit near -0.18 at low q, so the pedestal is there and the floor rises with |Q|. I'll apply flattenQ2, rerun from flatten, and reassess.
The baseline is clear: after flatten the shell floors run from about −0.18 at low |Q| to +0.2–0.3 at high |Q|, so a pedestal remains. The reduction-qc procedure calls for the Q² term, so I'll turn `flattenQ2` on and rerun from the flatten stage.
```

Result: flattenQ2 false → true

```
{"changed":[{"setting":"flattenQ2","from":false,"to":true}],"rerun_from":"flatten"}
```

### 16. run_pipeline (done)

Arguments: `{"from_stage":"flatten"}`

Result: done in 2.5 s · 3 computed, 0 reused

```
{"ended":"done","seconds":2.5,"stages":{"flatten":"computed","pdf":"computed","pdf_check":"computed"},"outputs":["raw","ringremoved","braggpunched","backfilled","flattened","delta_pdf"],"log_tail":["Flatten · flatten complete (const 0.1626 + 0·F(Q)² + 0.005469·Q² (held past 10 Å⁻¹), R² 0.942)","3D-ΔPDF · 3D-ΔPDF FFT (apodize=gaussian)","3D-ΔPDF · ΔPDF complete (|Q|max 11.16 Å⁻¹, shape (162, 162, 162))","Consistency check · back-FFT round-trip consistency check","Consistency check · back-FFT vs data: r=0.97854, normalised RMS=1.747e-01; vs the data's even part, which the transform keeps: r=1.00000"]}
```

### 17. assess_stage (done)

Arguments: `{"stage":"flatten"}`

Why (the model's words before it):

```
I'm going back over the flatten, pdf, symmetry, qmax_coverage, and radial profile checks, plus the full assess_stage run. I also need to note that the back-FFT correlation fell from 0.989 to 0.979, and then decide whether the Q² term still belongs in the model now that the pedestal is gone.
The flatten and ΔPDF are recomputed. Now I'll re-judge the flatten, and re-check the ΔPDF and the floor profile, to decide whether to keep the Q² term.
```

Result: Flatten: meets its goal · floor ≤ 1.52σ · trend 0.756 · span 0.455 · no pedestal

```
{"flatten":{"verdict":"meets its goal","criterion":"No pedestal: the volume's floor trend and span both 0.8 or more over the outer half of the |Q| shells the counts reach. Floor in σ: reported, not judged.","headline":"floor ≤ 1.52σ · trend 0.756 · span 0.455 · no pedestal","max_after_floor_sigma":1.52,"floor_trend":0.756,"floor_span_fraction":0.455,"floor_judged_q":[5.58,11.1],"pedestal_left":false,"per_plane":{"hk0":{"removed_fraction":0.77,"floor_before":[0.234,0.298,0.497],"floor_after":[0.0393,-0.00516,0.00573],"after_floor_max_sigma":1.42,"after_negative_fraction":0.272,"floor_trend":0.00714,"floor_span_fraction":0.257,"floor_judged_q":[4.71,8.96]},"h0l":{"removed_fraction":0.79,"floor_before":[0.226,0.288,0.492],"floor_after":[0.031,-0.0157,0.0000698],"after_floor_max_sigma":1.47,"after_negative_fraction":0.319,"floor_trend":-0.0179,"floor_span_fraction":0.269,"floor_judged_q":[4.71,8.96]},"0kl":{"removed_fraction":0.791,"floor_before":[0.227,0.289,0.493],"floor_after":[0.0329,-0.015,0.00178],"after_floor_max_sigma":1.52,"after_negative_fraction":0.321,"floor_trend":0.025,"floor_span_fraction":0.333,"floor_judged_q":[4.71,8.96]}},"goal":"Bring the per-|Q|-shell floor to abou… [1999 characters; the record holds them all]
```

### 18. assess_stage (done)

Arguments: `{"stage":"pdf"}`

Result: 3D-ΔPDF: meets its goal · r 0.97854 (even part 1) · RMS 0.1747 · SNR 1250 · no symmetry declared (asymmetry 0.041)

```
{"pdf":{"verdict":"meets its goal","criterion":"Back-FFT r of 0.999 or more against the data's even part under Q → −Q; at most 1e-3 of the window's weight on unmeasured space; the declared symmetry kept.","headline":"r 0.97854 (even part 1) · RMS 0.1747 · SNR 1250 · no symmetry declared (asymmetry 0.041)","back_fft_pearson_r":0.97854,"back_fft_normalized_rms":0.1747,"back_fft_pearson_r_even":1,"back_fft_odd_share":0.0425,"back_fft_per_plane_r":{"+0.000":0.9898541020904176,"+0.350":0.9779167949812855,"+1.000":0.9895952638683005},"mean_feature_snr":1250,"window_weight_on_unmeasured":null,"window_shape":"separable","max_symmetry_break":0.041,"worst_symmetry_op":"four-fold (90°)","symmetry_declared":false,"per_plane":{"xy":{"feature_snr":1250,"strong_feature_fraction":0.0496,"positive_fraction":0.468,"anisotropy_ratio":1},"xz":{"feature_snr":1250,"strong_feature_fraction":0.0389,"positive_fraction":0.492,"anisotropy_ratio":1.1},"yz":{"feature_snr":1250,"strong_feature_fraction":0.0383,"positive_fraction":0.506,"anisotropy_ratio":1.09}},"sigma_of":"each section outside the origin's disk, its own, robust","goal":"The ΔPDF must show features above noise (feature_snr) with the transform's … [2616 characters; the record holds them all]
```

### 19. radial_profile (done)

Arguments: `{"plane":"hk0","value":0,"stages":["backfilled","flattened"]}`

Result: H–K plane at L = 0: 32 shells × 2 stages

```
{"cut":"H–K plane at L = 0","q_unit":"|Q| in Å⁻¹","stat":"median per shell","shells":{"cols":["q","backfilled","flattened"],"rows":[[0.183,0.18,0.0177],[0.436,0.182,0.0181],[0.715,0.176,0.00974],[1,0.21,0.041],[1.28,0.267,0.0944],[1.57,0.434,0.259],[1.86,0.472,0.291],[2.14,0.35,0.162],[2.42,0.349,0.154],[2.71,0.325,0.123],[2.99,0.25,0.0388],[3.27,0.252,0.0313],[3.56,0.227,-0.00495],[3.84,0.227,-0.0172],[4.13,0.265,0.00866],[4.41,0.341,0.0711],[4.7,0.429,0.145],[4.98,0.399,0.099],[5.27,0.398,0.0834],[5.55,0.445,0.111],[5.84,0.423,0.0729],[6.12,0.424,0.055],[6.4,0.402,0.0146],[6.68,0.419,0.011],[6.97,0.514,0.0844],[7.25,0.544,0.099],[7.54,0.563,0.088],[7.82,0.557,0.0569],[8.1,0.53,0.00665],[8.38,0.521,-0.0261],[8.65,0.582,0.0131],[8.92,0.677,0.0746]]}}
```

### 20. consistency_details (done)

Arguments: `{}`

Result: r = 0.9785, normalised RMS = 0.1747; against the even part r = 1 (odd share 0.04247)

```
{"pearson_r":0.9785,"normalized_rms":0.1747,"rms":0.019137286379749617,"n_voxels":3617683,"per_plane_r":{"+0.000":0.9899,"+0.350":0.9779,"+1.000":0.9896},"pearson_r_even":1,"normalized_rms_even":1.093e-14,"odd_share":0.04247,"n_voxels_even":3617683,"crop_hkl":null,"q_band":null,"apodization":"gaussian"}
```

### 21. assess_stage (done)

Arguments: `{}`

Why (the model's words before it):

```
The pedestal is gone with Q², with a trend of 0.756 and a span of 0.455, both under the 0.8 threshold, so that goal is met and I'll keep it. The floors are now close to zero. The 0.756 trend isn't under 0.8, but the pedestal criterion is about both measures being at least 0.8 the other way round, so I'll accept that verdict even though the trend is still fairly high.

Checking the back-FFT fit next, which dropped a little from 0.989 to 0.979. The even part still fits at r = 1, so the change seems to come from the odd share rising to about 0.042 after the Q² flatten. The pdf verdict counts as meeting its goal. The window weight hasn't been measured, and the coverage numbers from earlier still hold since flattening doesn't change them. The remaining question is whether to run a symmetry check. The cell has in-plane four-fold symmetry that wasn't declared, and the 0.041 break looks like asymmetry in the raw data, so it wouldn't count as a processing gate.

I'll run a symmetry check to confirm the 0.041 four-fold break is just the raw data's own asymmetry and not a processing problem, since the data was never symmetrised. I'll also pull the ΔPDF peaks and contrast, and the ring assessment reads as meeting its goal. The 1.72 shell is an isotropy result rather than a ring, so it's fine as it stands. Checking the punch fit next: 188 peaks fitted with none missed.

Next I'll check for satellite peaks in the raw data, measuring a cut through the half-integer position along the hk0 pla…
```

Result: Ring removal: meets its goal · ring ratio 1 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0 · Bragg punch: meets its goal · 0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0257 · Backfill: meets its goal · seam 0.202σ · bright ≤ 0 · Flatten: meets its goal · floor ≤ 1.52σ · trend 0.756 · span 0.455 · no pedestal · 3D-ΔPDF: meets its goal · r 0.97854 (even part 1) · RMS 0.1747 · SNR 1250 · no symmetry declared (asymmetry 0.041)

```
{"rings":{"verdict":"meets its goal","criterion":"No powder ring left above, or dented below, three times its plane's noise; a powder ring rises at least 0.15 of its median height in 90 % of directions.","headline":"ring ratio 1 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0","stage_shells":"removed 0; left 1: 1.72 isotropy","mean_ring_energy_ratio":1,"max_over_subtraction_fraction":0,"max_ring_dent":0,"max_ring_left":0,"worst_ring_dent":null,"worst_ring_left":null,"shells_judged":[{"at":1.68,"ring":false,"isotropy":0.005},{"at":2.39,"ring":false},{"at":3.16,"ring":false,"isotropy":-15},{"at":4.59,"ring":false},{"at":5.52,"ring":false,"isotropy":-1.9},{"at":5.66,"ring":false,"isotropy":-4.6},{"at":6.02,"ring":false},{"at":7.08,"ring":false,"isotropy":-0.83},{"at":7.23,"ring":false},{"at":7.58,"ring":false},{"at":7.73,"ring":false,"isotropy":-0.84}]},"punch":{"verdict":"meets its goal","criterion":"No Bragg peak missed at a lattice node; no sharp peak left off the lattice outside the protected planes.","headline":"0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0257","total_leftover_peaks":0,"leftover_at_nodes":0,"leftover_off_lattice":0,"leftover_on_protected_p… [2787 characters; the record holds them all]
```

### 22. dpdf_contrast (done)

Arguments: `{}`

Result: ± 3140 (419σ, 0.34 of the strongest feature) · 1.3 % coloured

```
{"applied":{"limit":3140,"limit_sigma":419,"share_of_strongest":0.34,"coloured_fraction":0.013,"from":"optimised: the 99.9th percentile of |ΔPDF|"},"robust_sigma":7.49,"sigma_of":"the three sections together, outside the origin's disk, robust","strongest_feature_sigma":1250,"not_applied":{"99.5th percentile":{"limit":796,"limit_sigma":106,"share_of_strongest":0.085,"coloured_fraction":0.029,"effect":"a lower limit: brighter, weaker correlations and more of the ripple coloured"},"99.97th percentile":{"limit":5570,"limit_sigma":743,"share_of_strongest":0.6,"coloured_fraction":0.0083,"effect":"a higher limit: dimmer, only the strongest features coloured"}},"sections":"xy, xz and yz through the origin, the origin's disk left out"}
```

### 23. dpdf_peaks (done)

Arguments: `{"limit":12}`

Result: 608 extrema above 5σ; strongest − at (0.497, -0.497, 0) r.l.u., 2.74 Å, 1380σ

```
{"grouped_by":"sign, length and size (no symmetry declared)","features":[{"length_A":2.74,"size_sigma":-1380,"n_vectors":6,"vectors_rlu":[[0.497,-0.497,0],[0.497,0.497,0],[0.0001,0.497,0.497],[0,0.497,-0.497]],"vectors_A":[[1.938,-1.937,-0.0001],[1.937,1.937,0.0001],[0.0003,1.938,1.937],[0.0001,1.938,-1.937]]},{"length_A":4.763,"size_sigma":785,"n_vectors":12,"vectors_rlu":[[0.499,0.499,0.997],[0.997,0.498,0.498],[0.498,-0.997,-0.499],[0.499,0.997,-0.499]],"vectors_A":[[1.946,1.945,3.888],[3.888,1.944,1.944],[1.944,-3.888,-1.945],[1.945,3.888,-1.945]]},{"length_A":6.733,"size_sigma":-527,"n_vectors":4,"vectors_rlu":[[0.997,0.997,-0.997],[0.997,0.997,0.997],[0.997,-0.996,0.997],[0.997,-0.997,-0.997]],"vectors_A":[[3.888,3.887,-3.887],[3.887,3.886,3.886],[3.886,-3.886,3.888],[3.887,-3.887,-3.887]]},{"length_A":3.881,"size_sigma":493,"n_vectors":1,"vectors_rlu":[[0,0,0.995]],"vectors_A":[[0,-0.0001,3.881]]},{"length_A":7.778,"size_sigma":464,"n_vectors":2,"vectors_rlu":[[0,1.99,-0.0001],[1.99,0,-0.0003]],"vectors_A":[[0.0002,7.778,-0.0005],[7.779,-0.0001,-0.0013]]},{"length_A":7.78,"size_sigma":226,"n_vectors":1,"vectors_rlu":[[-0.0002,-0.0003,1.99]],"vectors_A":[[-0.0008,-0.0011,7.78… [2623 characters; the record holds them all]
```

### 24. symmetry_check (done)

Arguments: `{}`

Result: no symmetry declared: not judged

```
{"sections":"xy at z = 0 Å, xz at y = 0, yz at x = 0","operations":"the cell's in-plane ones (orthogonal): no operations declared","ops":[{"op":"four-fold ∥ c (90°)","rms_difference":0.043,"pairs":78083,"tested_on":"xy; xz↔yz"},{"op":"two-fold ∥ c","rms_difference":0.043,"pairs":51520,"tested_on":"xz; yz"},{"op":"mirror ⊥ a","rms_difference":0.043,"pairs":51520,"tested_on":"xy; xz"},{"op":"mirror ⊥ b","rms_difference":0.043,"pairs":51520,"tested_on":"xy; yz"}],"holds":[],"symmetry_declared":false,"verdict":"not judged: the file declares no symmetry, so the sections' asymmetry (0.043) is the data's own, counting noise included, not a break by a stage"}
```

### 25. measure_reciprocal_cut (done)

Arguments: `{"plane":"hk0","value":0.5}`

Result: H–K plane at L = 0.5: ring ratio 1 · 0 missed at nodes, 0 sharp off-lattice, 0 broad maxima · floor ≤ 1.21σ

```
{"cut":"H–K plane at L = 0.5","ring_removal":{"before_ring_energy":0.0279,"after_ring_energy":0.0279,"ring_energy_ratio":1,"over_subtraction_fraction":0,"after_negative_fraction":0,"ring_residuals":[{"at":1.47,"fwhm":0.14,"residual_fraction":0.397,"noise_fraction":0.101,"significant":true},{"at":2.33,"fwhm":0.14,"residual_fraction":0.123,"noise_fraction":0.0574,"significant":false},{"at":3.54,"fwhm":0.14,"residual_fraction":0.206,"noise_fraction":0.0639,"significant":true},{"at":6.26,"fwhm":0.072,"residual_fraction":0.063,"noise_fraction":0.021,"significant":false},{"at":7.97,"fwhm":0.072,"residual_fraction":0.114,"noise_fraction":0.0411,"significant":false}],"worst_ring_dent":null,"worst_ring_left":{"at":1.47,"fwhm":0.14,"residual_fraction":0.397,"noise_fraction":0.101,"significant":true},"suggested_display_vmax":0.7308,"n_finite":25921},"bragg_punch_leftover":{"suspicious_peaks":[],"n_suspicious":0,"n_at_nodes":0,"n_off_nodes":0,"n_on_protected":0,"n_broad_off_nodes":0,"n_skipped_noisy":0,"scan_sigma_threshold":8},"backfill":{"n_filled":0,"fill_coverage":0,"median_seam_sigma":null,"p95_seam_sigma":null,"bright_fill_fraction":null,"checkerboard_fraction":null},"flatten":{"removed_… [2688 characters; the record holds them all]
```

### 26. qmax_coverage (done)

Arguments: `{}`

Result: the transform reaches 6.444 Å⁻¹ (the window tapers to zero at the box faces), inside full coverage at 11.05 Å⁻¹

```
{"verdict":"the transform reaches 6.444 Å⁻¹ (the window tapers to zero at the box faces), inside full coverage at 11.05 Å⁻¹","window_weight_on_unmeasured":null,"window_shape":"separable","window_scale":1,"transform_reach_q":6.444,"reach_from":"the window tapers to zero at the box faces","full_coverage_q":11.05,"box_face_q":6.444,"box_corner_q":11.16,"raw_counts":{"q_min_edge":null,"q_max_edge":null,"fully_measured":[0.15,11.05],"box_face_q":6.444},"suggested_band":null,"counts_end_inside_box":false,"band_check":"no |Q| band is set: the transform takes every voxel, empty ones included, up to the window's reach","q_unit":"Å⁻¹","settings":{"pdfQMin":"(default)","pdfQMax":"(default)","pdfApod":"(default)","pdfWindowShape":"(default)","pdfWindowSupport":true}}
```

### 27. radial_profile (done)

Arguments: `{"plane":"hk0","value":0.5,"stages":["raw","ringremoved","flattened"],"bins":32}`

Why (the model's words before it):

```
I'm noting a ring residual of about 0.397 of diffuse at |Q|=1.47 on the L=0.5 cut, which is significant against the 0.101 noise. But the assessment tool says the stage meets its goal on the three principal planes, and the 3D rule wants the ring to rise in about 90% of directions, so I'm checking whether this single off-principal cut actually counts against that.

I'm checking whether the 1.47 bump, which the 3D judge never scored because it only covers shells from 1.68 up, is a real ring or just the crystal's own diffuse scattering, since it doesn't match any Al reflection.

I'm checking the L=0 radial profile, where values near 1.57–1.86 sit well above the low-q level, and wondering whether that is a real powder ring or crystal diffuse scattering. Since only the 3D ring judge can settle that, I plan to compare h0l and 0kl cuts and line profiles across 1.47 in the raw and ring-removed data.

I'm checking the radial profiles for the h0l and 0kl cuts at 1.47 and 3.54, comparing raw and ring-removed data across stages to see whether those bumps are real rings or the crystal's own diffuse scattering.

I'm checking the satellite picture on the half-integer hk0 cut at L=0.5, which shows no leftover punch and no flagged suspicious nodes. The strongest difference-PDF feature sits near 2.74 Å, and I'm sorting out what vector that corresponds to.

I'm reading the difference-PDF peaks now: the strongest negative feature is about -1380 in robust-sigma units near 2.74 Å, and a positive on…
```

Result: H–K plane at L = 0.5: 30 shells × 3 stages

```
{"cut":"H–K plane at L = 0.5","q_unit":"|Q| in Å⁻¹","stat":"median per shell","shells":{"cols":["q","raw","ringremoved","flattened"],"rows":[[0.834,0.19,0.19,0.0241],[1.01,0.17,0.17,0.00243],[1.29,0.273,0.273,0.101],[1.58,0.337,0.337,0.161],[1.86,0.27,0.27,0.0885],[2.15,0.243,0.243,0.0564],[2.43,0.233,0.233,0.0393],[2.72,0.21,0.21,0.00707],[3.01,0.212,0.212,-0.000906],[3.29,0.268,0.268,0.047],[3.58,0.326,0.326,0.0936],[3.86,0.29,0.29,0.0452],[4.15,0.304,0.304,0.0452],[4.43,0.291,0.291,0.0198],[4.72,0.276,0.276,-0.00814],[5.01,0.282,0.282,-0.0173],[5.29,0.317,0.317,0.00057],[5.58,0.366,0.366,0.0345],[5.86,0.409,0.409,0.0566],[6.15,0.429,0.429,0.06],[6.43,0.423,0.423,0.0335],[6.71,0.418,0.418,0.00806],[7,0.427,0.427,-0.00539],[7.28,0.457,0.457,0.00308],[7.57,0.506,0.506,0.0294],[7.86,0.601,0.601,0.104],[8.14,0.625,0.625,0.0971],[8.41,0.574,0.574,0.0231],[8.69,0.566,0.566,-0.00873],[8.96,0.597,0.597,-0.00204]]}}
```

### 28. radial_profile (done)

Arguments: `{"plane":"h0l","value":0.5,"stages":["raw","ringremoved","flattened"],"bins":32}`

Result: H–L plane at K = 0.5: 30 shells × 3 stages

```
{"cut":"H–L plane at K = 0.5","q_unit":"|Q| in Å⁻¹","stat":"median per shell","shells":{"cols":["q","raw","ringremoved","flattened"],"rows":[[0.834,0.197,0.197,0.0302],[1.01,0.184,0.184,0.0157],[1.29,0.331,0.331,0.16],[1.58,0.379,0.379,0.204],[1.86,0.346,0.346,0.166],[2.15,0.314,0.314,0.126],[2.43,0.263,0.263,0.0668],[2.72,0.243,0.243,0.0406],[3.01,0.241,0.241,0.0295],[3.29,0.315,0.315,0.0941],[3.58,0.356,0.356,0.124],[3.86,0.346,0.346,0.101],[4.15,0.356,0.356,0.0994],[4.43,0.338,0.338,0.068],[4.72,0.3,0.3,0.0147],[5.01,0.303,0.303,0.00327],[5.29,0.348,0.348,0.032],[5.58,0.409,0.409,0.0766],[5.86,0.453,0.453,0.101],[6.15,0.464,0.464,0.0942],[6.43,0.463,0.463,0.0738],[6.71,0.449,0.449,0.0385],[7,0.437,0.437,0.00556],[7.28,0.47,0.47,0.0189],[7.57,0.539,0.539,0.063],[7.86,0.622,0.622,0.12],[8.14,0.638,0.638,0.114],[8.41,0.597,0.597,0.0468],[8.69,0.577,0.577,0.000353],[8.96,0.596,0.596,-0.000875]]}}
```

### 29. texture_check (done)

Arguments: `{"plane":"hk0","value":0.5}`

Result: no systematic fill bias over 189 holes in 3-D · azimuthal ratio 1–1

```
{"n_holes":189,"n_judged":189,"median_fill_bias_sigma":0,"median_fill_bias_level":0,"above_fraction":0.418,"below_fraction":0.00529,"above_floor_fraction":0,"below_floor_fraction":0,"systematic_fill_bias":false,"criterion":"systematic_fill_bias: 5 judged holes or more, 75 % of them past their range one way, with a median of 0.5σ and 0.2 of the local level or more.","per_cut":[{"cut":"H–K plane at L = 0.5","azimuthal_ratio":1}]}
```

### 30. measure_reciprocal_cut (done)

Arguments: `{"plane":"0kl","value":0.5}`

Why (the model's words before it):

```
I'm checking whether the ring removal did anything: the radial profile at the 0.5 cuts looks identical before and after, so it seems to have removed zero shells. There's a bump near 1.58 Å⁻¹ that shows up in both L=0.5 cuts, in both the hk0 and h0l planes, and it seems to carry over into the neighbouring region too.

I'm now asking whether the bump near 1.5–1.9 Å⁻¹ is a leftover powder ring that the 3D judge missed, since its shell list skips the 1.47–1.6 range. A crystal's own diffuse feature would look anisotropic, so I want to check the 0kl plane and an off-principal direction to tell them apart.

I'm checking the radial profile at 0.5 for a 2π/1.6 ≈ 3.9 Å spacing, which would match the cell length, so the bump could be a lattice-related feature rather than a powder ring. To tell whether it's isotropic, I'd compare the 0kl plane and the other planes at that same |Q|.

Now I'm checking whether the 1.6 Å⁻¹ bump matches the lattice: 2π/3.9 ≈ 1.61 Å⁻¹ is where the (100)-type Bragg nodes sit, so the feature may be the diffuse shoulder around those nodes rather than a powder ring.

I'm now testing whether the 1.6 Å⁻¹ bump is a lattice effect: its position lines up with the (100)-type Bragg nodes at 2π/3.9 ≈ 1.61 Å⁻¹, and the other bumps sit near multiples of that spacing, so this may be diffuse scattering around the nodes rather than a powder ring.

I'm now checking whether the bump at about 1.6 Å⁻¹ lines up with the first Bragg-node shell, since 2π/a is also about 1.61 Å⁻¹. If …
```

Result: K–L plane at H = 0.5: ring ratio 1 · 0 missed at nodes, 0 sharp off-lattice, 0 broad maxima · floor ≤ 1.38σ

```
{"cut":"K–L plane at H = 0.5","ring_removal":{"before_ring_energy":0.0155,"after_ring_energy":0.0155,"ring_energy_ratio":1,"over_subtraction_fraction":0,"after_negative_fraction":0,"ring_residuals":[{"at":1.54,"fwhm":0.21,"residual_fraction":0.188,"noise_fraction":0.0832,"significant":false},{"at":2.11,"fwhm":0.072,"residual_fraction":0.109,"noise_fraction":0.022,"significant":true},{"at":2.25,"fwhm":0.072,"residual_fraction":0.0533,"noise_fraction":0.0247,"significant":false},{"at":2.75,"fwhm":0.14,"residual_fraction":0.0387,"noise_fraction":0.0259,"significant":false},{"at":3.61,"fwhm":0.14,"residual_fraction":0.0841,"noise_fraction":0.0376,"significant":false},{"at":4.11,"fwhm":0.14,"residual_fraction":0.0698,"noise_fraction":0.0263,"significant":false},{"at":4.97,"fwhm":0.072,"residual_fraction":0.0145,"noise_fraction":0.0426,"significant":false},{"at":6.61,"fwhm":0.072,"residual_fraction":0.0695,"noise_fraction":0.0121,"significant":true},{"at":7.18,"fwhm":0.072,"residual_fraction":0.000846,"noise_fraction":0.0234,"significant":false},{"at":7.97,"fwhm":0.072,"residual_fraction":0.093,"noise_fraction":0.0235,"significant":true}],"worst_ring_dent":null,"worst_ring_left":{"at":2.… [1921 characters; the record holds them all]
```

### 31. read_skill (done)

Arguments: `{"name":"delta-pdf-interpretation","section":"Artifacts that imitate signal"}`

Why (the model's words before it):

```
I'm checking the 0kl cut at H=0.5: the 1.54 bump has residual 0.188 against noise 0.083, so it falls short of the 3x threshold and doesn't count as significant there. That means it isn't clearly a ring on that plane, so I'll look at the hk0 and h0l planes to see whether it shows up.

The 1.54 bump came out at about 2.3σ, which is still under the significance bar, so this looks like a feature across two planes rather than a clean ring. I'm not going to change the ring settings, since the rings verdict already passes, and I'll record the shell as unresolved, possibly a crystal feature near the first node.

I'm checking whether the half-lattice feature at 2.74 Å could be a Fourier artifact from the punched Bragg holes, since its vector isn't a lattice translation of the primitive cell. It would mean a correlation at half-lattice spacing, which points toward a superlattice-like pattern rather than a simple ripple.

I'm checking whether the checkerboard-like pattern at h+k parity is a real feature or an artifact, since the backfill checks already rule out a checkerboard. I'll look at whether the uniform punch rules out a punch-driven origin.

I'm weighing whether the strongest ΔPDF pair correlations, at (½,½,0)a and (½,½,1)a, mean the intensity alternates with the parity of h+k, which would be a checkerboard-like pattern. I'd want to read the artifact details before guessing, and I can't tie a specific pair to a cause without knowing the structure.

I'm working out what the parity…
```

Result: delta-pdf-interpretation: Artifacts that imitate signal

```
Skill delta-pdf-interpretation, section "Artifacts that imitate signal"

### Artifacts that imitate signal

- **Bragg residue.** A peak the punch missed adds a wave with the lattice's
  period. Residue at many nodes adds a pattern that repeats at every lattice
  translation and does not decay with r. Audit the nodes (bragg-node-audit)
  before calling such features pair correlations.
- **Copies of displaced Bragg peaks.** A UB slightly off, symmetrised, leaves
  residue beside the nodes: the same kind of artifact (reduction-qc,
  `ub_check`).
- **Termination ripple.** Truncation at the band or the box edge rings around
  every strong feature; the window (Gaussian, Hann, ellipsoid) trades the
  ringing against resolution. Ripple is regular and follows the strong
  features; signal does not.
- **A window past the data** (the coverage gate).
- **The origin.** The self-correlation and the smooth background terms (the
  flatten's constant and `b·Q²`) land near the origin, hence its gate. A
  leftover pedestal shows as a broad feature there.
- **Ring residue.** A leftover powder ring is a sphere in reciprocal space and
  a spherical ripple in real space.
- **Backfill texture.** A lattice… [1241 characters; the record holds them all]
```

### 32. measure_dpdf_cut (done)

Arguments: `{"plane":"xy","value":0}`

Result: ΔPDF x–y section at z = 0 Å: SNR 1250, anisotropy 1

```
{"cut":"ΔPDF x–y section at z = 0 Å","delta_pdf":{"origin_excluded_radius":1.95,"background_sigma":7.44,"feature_snr":1250,"strong_feature_fraction":0.0496,"positive_fraction":0.468,"anisotropy_ratio":1,"anisotropy_angle_deg":43.2,"radial_trend":[190,7.81,5.27]},"sigma_of":"this section outside the origin's disk, robust","fields":"All in this section's robust σ outside the origin's disk. feature_snr: the strongest feature over background σ (≳ 5 is clear signal); strong_feature_fraction: voxels beyond 5σ; positive_fraction: 0.5 is balanced ±; anisotropy_ratio: 1 isotropic, above ~1.5 rods or sheets, along anisotropy_angle_deg in the plane; radial_trend: mean |ΔPDF| in the inner, middle and outer shells."}
```

### 33. update_settings (done)

Arguments: `{"changes":{"flattenQ2":false}}`

Why (the model's words before it):

```
The inner shell carries by far the largest deviation, with a mean |ΔPDF| of 190 against about 7.8 in the middle shell, so there's a strong feature close to the origin. The origin exclusion only goes out to 1.95 Å, yet the inner shell also covers roughly 2–5 Å, which is where the 2.74 Å peak sits at -1380σ. So the biggest features are concentrated in that inner region.

I'm wondering whether that huge inner-shell signal is real, since the skill says nothing nearer the origin than the shortest interatomic distance should be interpreted. The 2.74 Å peak is about 200 times the robust sigma and far above the middle-shell values, which makes me suspect a near-origin artifact from the background or Q² term in the flattening, and I'm not convinced yet.

I'm weighing whether the 2.74 Å feature could be a parity-type artifact from the grid rather than a real structural signal. Its wavelength doesn't match a half-lattice pattern, and every node appears punched, so a simple Bragg residue seems unlikely. I'm still not sure which mechanism would produce it.

I'm testing whether the 2.74 Å feature is a real structural signal or a near-origin artifact: I'd check the raw reciprocal intensity by comparing diffuse scattering at all-even versus mixed-parity nodes, since a Bragg residue would not produce a half-lattice wavelength.

I'm planning a line profile along H at K=0.5, L=0 on the flattened data, since lines through the lattice nodes wouldn't reveal a parity effect and offsetting K should …
```

Result: flattenQ2 true → false

```
{"changed":[{"setting":"flattenQ2","from":true,"to":false}],"rerun_from":"flatten"}
```

## Conclusion

I'll start by reading the reduction-qc skill, then check the dataset and its current settings.

Settings are all at default. I'll run the pipeline and, in parallel, the UB and coverage checks on the raw volume, which don't depend on the run.

The UB is right (turn 0.001°) and the counts cover the box. Next, the stage verdicts, the Laue-class comparison, and the skills I'll need before touching any settings.

The flatten stage reports a pedestal left (trend 0.996, span 1.3). Before I change anything, I'll record the flatten baseline and run the punch, backfill, and grain checks, which don't depend on the flatten.

The baseline is clear: after flatten the shell floors run from about −0.18 at low |Q| to +0.2–0.3 at high |Q|, so a pedestal remains. The reduction-qc procedure calls for the Q² term, so I'll turn `flattenQ2` on and rerun from the flatten stage.

The flatten and ΔPDF are recomputed. Now I'll re-judge the flatten, and re-check the ΔPDF and the floor profile, to decide whether to keep the Q² term.

With `flattenQ2` on, the pedestal is gone: the floor trend fell to 0.756 and the span to 0.455, and the shell floors now sit near zero (≈0.04, −0.005, 0.006 by third), where before they ran to +0.5. I'm keeping the term. The back-FFT's even-part r stays at 1, and the r against the raw data drops from 0.989 to 0.979 because the odd share rose to 0.042, which is the expected cost of the subtraction. Next I'll get the whole-volume verdict and the ΔPDF features, and look for satellites or forbidden-node intensity at a half-integer cut.

Two findings to follow up. First, the L = 0.5 cut shows a significant bump left at |Q| 1.47 Å⁻¹ (residual 0.397 of the diffuse beside it, noise 0.101) and at 3.54 Å⁻¹. The 3D ring judge doesn't cover 1.47 (its judged shells start at 1.68), so I'll check it on other cuts. Second, the ΔPDF's strongest features need their artifact checks. I'll gather the ring profile on two more planes and the backfill texture at the off-zero cut.

Both L = 0.5 cuts show the same bump at |Q| ≈ 1.58 Å⁻¹ in the raw data, and the ring stage left it unchanged. The bump sits near 2π/a = 1.61 Å⁻¹, the first Bragg shell, so it may be crystal scattering rather than a powder ring. I'll check the third plane at H = 0.5 to see whether it's isotropic.

The 0kl cut at H = 0.5 does not confirm the 1.54 Å⁻¹ bump: its residual (0.188) is under three times the noise (0.083), so it is not significant there. Only two planes show it, so I'll report it as unresolved rather than as a ring. Next, the strongest ΔPDF feature sits on a half-lattice vector (2.74 Å, (½,½,0)·a), so I'll check its artifact list before reading it as a pair correlation.

The inner shell carries most of the ΔPDF's weight (mean |ΔPDF| 190 in the inner shell against 7.8 in the middle), which is suspicious for a near-origin background term. So I'll run a control: rerun the flatten and ΔPDF with the Q² term off, read the strongest features, then restore the Q² term.

**Verdict computed from the checks:** met: every stage meets its goal.

## Numbers and their sources

| Number | Source |
| --- | --- |
| 0.001 | step 30, measure_reciprocal_cut, ring_removal.ring_residuals[8].residual_fraction = 0.000846 |
| 0.996 | step 32, measure_dpdf_cut, delta_pdf.anisotropy_ratio = 1 |
| 1.3 | step 28, radial_profile, shells.rows[2][0] = 1.29 |
| -0.18 | step 28, radial_profile, shells.rows[1][1] = 0.184 |
| +0.2 | step 30, measure_reciprocal_cut, ring_removal.ring_residuals[0].fwhm = 0.21 |
| 0.3 | step 30, measure_reciprocal_cut, flatten.floor_before[1] = 0.304 |
| 0.756 | step 21, assess_stage, flatten.headline = 0.756 |
| 0.455 | step 28, radial_profile, shells.rows[18][1] = 0.453 |
| 0.04 | step 30, measure_reciprocal_cut, ring_removal.ring_residuals[3].residual_fraction = 0.0387 |
| -0.005 | step 29, texture_check, below_fraction = 0.00529 |
| 0.006 | step 28, radial_profile, shells.rows[22][3] = 0.00556 |
| +0.5 | step 32, measure_dpdf_cut, delta_pdf.positive_fraction = 0.468 |
| 1 | step 32, measure_dpdf_cut, delta_pdf.anisotropy_ratio = 1 |
| 0.989 | step 32, measure_dpdf_cut, delta_pdf.anisotropy_ratio = 1 |
| 0.979 | step 23, dpdf_peaks, features[1].vectors_rlu[0][2] = 0.997 |
| 0.042 | step 30, measure_reciprocal_cut, ring_removal.ring_residuals[6].noise_fraction = 0.0426 |
| 0.5 | step 32, measure_dpdf_cut, delta_pdf.positive_fraction = 0.468 |
| 1.47 | step 25, measure_reciprocal_cut, ring_removal.ring_residuals[0].at = 1.47 |
| 0.397 | step 25, measure_reciprocal_cut, ring_removal.ring_residuals[0].residual_fraction = 0.397 |
| 0.101 | step 28, radial_profile, shells.rows[11][3] = 0.101 |
| 3.54 | step 30, measure_reciprocal_cut, ring_removal.ring_residuals[4].at = 3.61 |
| 1.68 | step 21, assess_stage, rings.shells_judged[0].at = 1.68 |
| 1.58 | step 28, radial_profile, shells.rows[3][0] = 1.58 |
| 2 | step 32, measure_dpdf_cut, delta_pdf.origin_excluded_radius = 1.95 |
| 1.61 | step 28, radial_profile, shells.rows[3][0] = 1.58 |
| 1.54 | step 30, measure_reciprocal_cut, ring_removal.ring_residuals[0].at = 1.54 |
| 0.188 | step 30, measure_reciprocal_cut, ring_removal.ring_residuals[0].residual_fraction = 0.188 |
| 0.083 | step 30, measure_reciprocal_cut, ring_removal.ring_residuals[0].noise_fraction = 0.0832 |
| 2.74 | step 30, measure_reciprocal_cut, ring_removal.ring_residuals[3].at = 2.75 |
| 0 | step 32, measure_dpdf_cut, cut = 0 |
| 190 | step 32, measure_dpdf_cut, delta_pdf.radial_trend[0] = 190 |
| 7.8 | step 32, measure_dpdf_cut, delta_pdf.radial_trend[1] = 7.81 |

## Score

- Fault reported: yes
- No false alarm: yes
- Unsafe actions: 0
- Checks the graders' two readings dispute: 0
- Requests cut at the output limit: 0
- Outputs, against the planted truth: features ok, window ok, pedestal ok
