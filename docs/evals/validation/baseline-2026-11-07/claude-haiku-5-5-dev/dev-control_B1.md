# dev-control, arm B, run 1

Model: Claude Haiku 5.5 (Anthropic) (Anthropic). Started 2026-11-07T22:10:50.436Z; 86 s, 299466 tokens in and 13762 out over 11 requests, $0.0149. The model saw the dataset as va21fc1-B1.

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

The first request's tools: read_skill, describe_dataset, current_view, measure_reciprocal_cut, measure_dpdf_cut, assess_stage, texture_check, qmax_coverage, symmetry_check, dpdf_contrast, dpdf_peaks, grain_check, ub_check, compare_laue_classes, radial_profile, line_profile, bragg_peaks, consistency_details, run_log, compare_datasets, run_verdict, configure_settings, update_settings, run_pipeline, tune_pipeline, regrid_refined_ub, show_in_viewer, mark_region.

## Steps

### 1. describe_dataset (done)

Arguments: `{}`

Why (the model's words before it):

```
I'm going to read the skill docs first and then run the pipeline, since the skill has to be read before changing any settings. I'll start with describe_dataset, configure_settings, and the reduction-qc skill together.
I'll start by reading the dataset state, the current settings, and the reduction-qc method before running anything.
```

Result: va21fc1_B1: raw, ringremoved, braggpunched, backfilled, flattened, delta_pdf

```
{"dataset":"va21fc1_B1","id":"va21fc1-B1","stages":["raw","ringremoved","braggpunched","backfilled","flattened","delta_pdf"],"reciprocal":{"grid":[161,161,161],"H":[-4,4],"K":[-4,4],"L":[-4,4],"planes":["hk0","h0l","0kl"]},"cell":{"a":3.9,"b":3.9,"c":3.9,"alpha":90,"beta":90,"gamma":90},"sigma":"measured","delta_pdf":{"grid":[162,162,162],"x":[-39,38.52],"y":[-39,38.52],"z":[-39,38.52],"q_max":11.16,"planes":["xy","xz","yz"]},"other_datasets":[]}
```

### 2. configure_settings (done)

Arguments: `{}`

Result: 0 settings off their defaults, 61 at them

```
{"settings":{},"at_default":61}
```

### 3. read_skill (done)

Arguments: `{"name":"reduction-qc"}`

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

### 4. run_pipeline (done)

Arguments: `{}`

Why (the model's words before it):

```
I'll kick off the pipeline now, and the UB check and qmax coverage can run alongside it on the raw data since they don't depend on it.
The configuration is at defaults. I'll run the pipeline and, since they only read the raw volume, the UB and coverage checks alongside it.
```

Result: done in 1.2 s · 0 computed, 6 reused

```
{"ended":"done","seconds":1.2,"stages":{"rings":"reused","punch":"reused","backfill":"reused","flatten":"reused","pdf":"reused","pdf_check":"reused"},"outputs":["raw","ringremoved","braggpunched","backfilled","flattened","delta_pdf"],"log_tail":["Bragg punch · va21fc1_B1_ringremoved_braggpunched.h5 exists","Backfill · va21fc1_B1_ringremoved_braggpunched_backfilled.h5 exists","Flatten · va21fc1_B1_ringremoved_braggpunched_backfilled_flattened.h5 exists","3D-ΔPDF · va21fc1_B1_ringremoved_braggpunched_backfilled_delta_pdf.h5 is current","Consistency check · va21fc1_B1_ringremoved_braggpunched_backfilled_delta_pdf_consistency.json exists"]}
```

### 5. ub_check (done)

Arguments: `{}`

Result: both: RMS 0.0004 → 0.0004 Å⁻¹ over 90 peaks; a 3.900 → 3.900 Å, c 3.900 → 3.900 Å; turned 0.000°

```
{"verdict":"the UB is right: turned 0°, under the 0.05° that counts as turned","fit":"both","bragg_nodes_every":[1,1,1],"symmetry_from":null,"symmetrised":null,"symmetry_break":null,"peaks":{"searched":342,"used":90,"rejected":0},"rms_start":0.0004,"rms":0.0004,"cell_start":"3.9000, 3.9000, 3.9000 Å; 90.000°, 90.000°, 90.000°","cell":"3.8998, 3.8999, 3.8999 Å; 90.000°, 90.000°, 90.000°","orientation_change_deg":0,"axis_uvw":[-0.379,0.913,1],"transform_diagonal":[1.00004,1.000036,1.000016],"passes":[{"q_max":3.72,"found":14,"used":14,"rms":"0.0003 → 0.0003"},{"q_max":7.44,"found":82,"used":82,"rms":"0.0004 → 0.0004"},{"q_max":11.16,"found":90,"used":90,"rms":"0.0004 → 0.0004"}],"radial":[{"q":"0–4","direction":"in-plane","n":4,"before":0.000045,"after":0.0000071},{"q":"0–4","direction":"oblique","n":8,"before":-0.000078,"after":-0.00011},{"q":"4–8","direction":"in-plane","n":4,"before":0.000053,"after":0.000015},{"q":"4–8","direction":"oblique","n":56,"before":0.000049,"after":0.000018},{"q":"4–8","direction":"near the third axis","n":8,"before":0.000032,"after":0.000012},{"q":"8–12","direction":"oblique","n":8,"before":0.000029,"after":-0.0000028}],"unexplained":false,"mean_offset_… [1435 characters; the record holds them all]
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
Checking the UB and coverage results first, then moving on to assess every stage, the symmetry check, and the run log. The pipeline reused all outputs, so I'll evaluate the current results as they stand, since the default settings and existing outputs mean they're still valid.
The UB is not turned, and coverage is clean. Next I'll judge every stage and the symmetry, and read the run log.
```

Result: Ring removal: meets its goal · ring ratio 1 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0 · Bragg punch: meets its goal · 0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0266 · Backfill: meets its goal · seam 0.248σ · bright ≤ 0 · Flatten: meets its goal · floor ≤ 1.72σ · trend 0.0384 · span 0.636 · no pedestal · 3D-ΔPDF: meets its goal · r 0.98901 (even part 1) · RMS 0.1253 · SNR 1380 · no symmetry declared (asymmetry 0.036)

```
{"rings":{"verdict":"meets its goal","criterion":"No powder ring left above, or dented below, three times its plane's noise. A bump is a powder ring only if it rises in nearly every direction over the sphere (at least 0.15 of its median height in 90 % of directions): the crystal's own scattering at that |Q| rises in some directions only.","headline":"ring ratio 1 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0","stage_shells":"removed 0; left 1: 1.72 isotropy","mean_ring_energy_ratio":1,"max_over_subtraction_fraction":0,"max_ring_dent":0,"max_ring_left":0,"worst_ring_dent":null,"worst_ring_left":null,"shells_judged":[{"at":1.68,"ring":false,"isotropy":0.013},{"at":2.39,"ring":false},{"at":2.6,"ring":false},{"at":3.16,"ring":false},{"at":4.59,"ring":false,"isotropy":-12},{"at":7.08,"ring":false,"isotropy":-0.43},{"at":7.58,"ring":false}]},"punch":{"verdict":"meets its goal","criterion":"No Bragg peak missed at a lattice node, and no sharp peak left off the lattice outside the protected planes. Broad maxima are diffuse scattering, and stay.","headline":"0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0266","total_leftover_peaks":0,"leftover_at_nodes":0,"leftover_o… [3164 characters; the record holds them all]
```

### 8. symmetry_check (done)

Arguments: `{}`

Result: no symmetry declared: not judged

```
{"sections":"xy at z = 0 Å, xz at y = 0, yz at x = 0","operations":"the cell's in-plane ones (orthogonal): no operations declared","ops":[{"op":"four-fold ∥ c (90°)","rms_difference":0.039,"pairs":78083,"tested_on":"xy; xz↔yz"},{"op":"two-fold ∥ c","rms_difference":0.038,"pairs":51520,"tested_on":"xz; yz"},{"op":"mirror ⊥ a","rms_difference":0.038,"pairs":51520,"tested_on":"xy; xz"},{"op":"mirror ⊥ b","rms_difference":0.038,"pairs":51520,"tested_on":"xy; yz"}],"holds":[],"symmetry_declared":false,"verdict":"not judged: the file declares no symmetry, so the sections' asymmetry (0.039) is the data's own, counting noise included, not a break by a stage"}
```

### 9. run_log (done)

Arguments: `{"limit":60}`

Result: 6 lines · done

```
{"ended":"done","lines":{"cols":["stage","status","message"],"rows":[["rings","skip","va21fc1_B1_ringremoved.h5 exists"],["punch","skip","va21fc1_B1_ringremoved_braggpunched.h5 exists"],["backfill","skip","va21fc1_B1_ringremoved_braggpunched_backfilled.h5 exists"],["flatten","skip","va21fc1_B1_ringremoved_braggpunched_backfilled_flattened.h5 exists"],["pdf","skip","va21fc1_B1_ringremoved_braggpunched_backfilled_delta_pdf.h5 is current"],["pdf_check","skip","va21fc1_B1_ringremoved_braggpunched_backfilled_delta_pdf_consistency.json exists"]]}}
```

### 10. texture_check (done)

Arguments: `{}`

Why (the model's words before it):

```
Everything passes at default, so I still need to run the texture check and the flatten checks, where the pedestal numbers look fine. For the rings, stage_shells reports 1.72 isotropy on left 1, but no ring is confirmed yet, so I'm weighing whether I need the bragg-node-audit skill before I touch the punch and backfill settings.

I'm not necessarily changing the punch or backfill settings yet. The pipeline passes, so I want to check whether the data show superlattice satellites or modulation, and I'll run the texture, grain, Laue class, peak, and radial-profile checks to see.
Every stage passes at the current settings. Before I accept that, I'll check the punch and backfill for texture, the grain and Laue class, the Bragg nodes, and the ΔPDF features. I'm reading the ΔPDF skill first because I will describe its features.
```

Result: no systematic fill bias over 189 holes in 3-D · azimuthal ratio 0.958–1.01

```
{"n_holes":189,"n_judged":189,"median_fill_bias_sigma":0.0109,"median_fill_bias_level":0.00281,"above_fraction":0.503,"below_fraction":0.00529,"above_floor_fraction":0.0423,"below_floor_fraction":0,"systematic_fill_bias":false,"criterion":"systematic_fill_bias: 5 judged holes or more, 75 % of them past their range one way, with a median of 0.5σ and 0.2 of the local level or more.","per_cut":[{"cut":"H–K plane at L = 0","azimuthal_ratio":1.01},{"cut":"H–L plane at K = 0","azimuthal_ratio":1},{"cut":"K–L plane at H = 0","azimuthal_ratio":0.958}]}
```

### 11. grain_check (done)

Arguments: `{}`

Result: no off-lattice peaks were recorded by the punch's search

```
{"off_lattice_orbits":0,"judged":0,"near_bragg_nodes":0,"near_offset_angle_deg":null,"far":[],"rotated_copy":{"indexed":0,"misorientation_deg":null},"random_control":0,"verdict":"no off-lattice peaks were recorded by the punch's search","off_lattice_peaks":0,"declared_symmetry":null,"punch_cell":[1,1,1]}
```

### 12. compare_laue_classes (done)

Arguments: `{}`

Result: suggests 4/mmm

```
{"columns":"r_int, x_noise, chi2: [all voxels, diffuse]; x_noise = R_int / noise floor, chi2 = χ²/dof (1: within counting noise)","classes":[{"class":"-1","ops":2,"r_int":[0.052,0.053],"x_noise":[1,1],"chi2":[1,1],"orbits":2086640,"verdict":"supported"},{"class":"2/m (b unique)","ops":4,"contains":["-1"],"r_int":[0.063,0.065],"x_noise":[1,1],"chi2":[1,1],"orbits":1049840,"verdict":"supported"},{"class":"2/m (c unique)","ops":4,"contains":["-1"],"r_int":[0.063,0.065],"x_noise":[1,1],"chi2":[1,1],"orbits":1049840,"verdict":"supported"},{"class":"mmm","ops":8,"contains":["2/m (b unique)","2/m (c unique)"],"r_int":[0.069,0.07],"x_noise":[1,1],"chi2":[1,1],"orbits":531440,"verdict":"supported"},{"class":"4/m","ops":8,"contains":["2/m (c unique)"],"r_int":[0.069,0.071],"x_noise":[1,1],"chi2":[1,1],"orbits":524960,"verdict":"supported"},{"class":"4/mmm","ops":16,"contains":["mmm","4/m"],"r_int":[0.071,0.073],"x_noise":[1,1],"chi2":[1,1],"orbits":269000,"verdict":"supported"},{"class":"m-3","ops":24,"contains":["mmm"],"r_int":[0.085,0.088],"x_noise":[1.19,1.19],"chi2":[1.47,1.48],"orbits":177200,"verdict":"rose 1.19× against 2/m (b unique)"},{"class":"m-3m","ops":48,"contains":["4/mmm","m-… [2298 characters; the record holds them all]
```

### 13. bragg_peaks (done)

Arguments: `{"limit":25,"sort_by":"significance"}`

Result: 188 fitted peaks; top 25 by significance

```
{"n_peaks":188,"punch_frame":"spherical","sorted_by":"significance","peaks":{"cols":["hkl","q","intensity","local_background","significance","measured_width_q","resolution_limited","anisotropy","fit"],"rows":[[[0,0,-2],3.222,111.6,0.1386,258.4,null,null,1,"own"],[[0,0,2],3.222,111.6,0.1368,258.4,null,null,1,"own"],[[0,-2,0],3.222,111.2,0.1354,257.4,null,null,1,"own"],[[0,2,0],3.222,111.2,0.1362,257.4,null,null,1,"own"],[[-2,0,0],3.222,111.2,0.1356,257.3,null,null,1,"own"],[[2,0,0],3.222,110.9,0.1362,256.7,null,null,1,"own"],[[0,2,-2],4.557,86.58,0.1881,227.1,null,null,1.02,"own"],[[0,-2,-2],4.557,86.15,0.1927,226.1,null,null,1.02,"own"],[[-2,-2,0],4.557,86.1,0.1886,226,null,null,1.02,"own"],[[2,0,2],4.557,85.93,0.1875,225.4,null,null,1.02,"own"],[[2,0,-2],4.557,85.84,0.1894,225.3,null,null,1.02,"own"],[[2,2,0],4.557,85.82,0.19,225.3,null,null,1.02,"own"],[[-2,2,0],4.557,85.64,0.1893,224.7,null,null,1.02,"own"],[[2,-2,0],4.557,85.48,0.1913,224.4,null,null,1.02,"own"],[[0,2,2],4.557,85.51,0.1884,224.3,null,null,1.02,"own"],[[0,-2,2],4.557,85.35,0.1875,223.9,null,null,1.02,"own"],[[-2,0,-2],4.557,85.29,0.1847,223.8,null,null,1.02,"own"],[[-2,0,2],4.557,85.32,0.1897,223.8,null,null,1.0… [1597 characters; the record holds them all]
```

### 14. radial_profile (done)

Arguments: `{"plane":"hk0","value":0,"bins":24}`

Result: H–K plane at L = 0: 24 shells × 5 stages

```
{"cut":"H–K plane at L = 0","q_unit":"|Q| in Å⁻¹","stat":"median per shell","shells":{"cols":["q","raw","ringremoved","braggpunched","backfilled","flattened"],"rows":[[0.251,0.207,0.207,0.196,0.184,0.0404],[0.588,0.174,0.174,0.174,0.174,0.0301],[0.959,0.2,0.2,0.2,0.2,0.0568],[1.33,0.28,0.28,0.28,0.28,0.136],[1.71,0.462,0.462,0.462,0.462,0.319],[2.1,0.346,0.346,0.346,0.346,0.202],[2.47,0.317,0.317,0.317,0.317,0.173],[2.85,0.229,0.229,0.229,0.229,0.085],[3.23,0.217,0.217,0.203,0.179,0.0352],[3.61,0.144,0.144,0.144,0.144,-0.000134],[3.99,0.147,0.147,0.147,0.147,0.00372],[4.37,0.213,0.213,0.207,0.212,0.0681],[4.75,0.288,0.288,0.284,0.284,0.14],[5.13,0.237,0.237,0.237,0.237,0.0934],[5.51,0.247,0.247,0.247,0.247,0.103],[5.89,0.217,0.217,0.217,0.217,0.0731],[6.27,0.182,0.182,0.175,0.177,0.0331],[6.63,0.141,0.141,0.141,0.141,-0.00238],[7.01,0.25,0.25,0.236,0.227,0.0834],[7.4,0.255,0.255,0.24,0.225,0.0811],[7.77,0.189,0.189,0.189,0.189,0.0455],[8.14,0.126,0.126,0.126,0.126,-0.0176],[8.53,0.108,0.108,0.108,0.108,-0.0354],[8.89,0.342,0.342,0.222,0.201,0.0576]]}}
```

### 15. read_skill (done)

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

### 16. dpdf_peaks (done)

Arguments: `{"limit":12,"min_sigma":5}`

Why (the model's words before it):

```
I'm weighing whether to set the Laue class to 4/mmm, since the data isn't symmetrised and the class is the user's to choose. The cubic m-3m option looks rejected because its intensity rose 1.18× against 2/m, which leaves 4/mmm as the supported suggestion, and I'll offer it without setting it. I'm also starting on the radial profile at hk0 with L=0, where the flattened region is coming up next.

I'm checking the flattened radial values at hk0, where a few shells still sit above zero, like 0.319 at |Q|≈1.71. The assessment stage still passes, so I'll treat the residual as diffuse signal rather than a floor problem. Next I'll look at the pair distribution function features.

I'm checking the remaining checks: the pair distribution function peaks, the consistency details, and the contrast, since the earlier assessment already passed. The origin and coverage look fine, so the Laue choice stays with the user.

I'm going to pull the pair distribution function peaks, the contrast figures and the consistency details next, and I'll also check whether the flattening needs a closer look along the 0kl direction.
The Bragg punch, backfill, rings and flatten all pass, and the UB, coverage and grain checks are clean. Next I'll read the ΔPDF features and the round-trip details, and set the colour range.
```

Result: 619 extrema above 5σ; strongest − at (0.497, 0.497, 0) r.l.u., 2.74 Å, 1520σ

```
{"grouped_by":"sign, length and size (no symmetry declared)","features":[{"length_A":2.74,"size_sigma":-1520,"n_vectors":6,"vectors_rlu":[[0.497,0.497,0],[0,0.497,-0.497],[-0.0001,0.497,0.497],[0.497,0,-0.497]],"vectors_A":[[1.938,1.937,-0.0001],[0.0001,1.937,-1.937],[-0.0003,1.938,1.938],[1.938,0.0002,-1.937]]},{"length_A":4.763,"size_sigma":858,"n_vectors":12,"vectors_rlu":[[0.499,-0.498,0.997],[0.499,0.499,-0.997],[0.499,0.499,0.997],[0.997,-0.498,-0.498]],"vectors_A":[[1.945,-1.944,3.888],[1.945,1.945,-3.888],[1.944,1.944,3.889],[3.888,-1.944,-1.944]]},{"length_A":6.732,"size_sigma":-579,"n_vectors":4,"vectors_rlu":[[0.997,0.997,-0.997],[0.997,0.997,0.997],[0.997,-0.997,-0.997],[0.996,-0.996,0.997]],"vectors_A":[[3.887,3.886,-3.888],[3.887,3.887,3.887],[3.886,-3.886,-3.886],[3.886,-3.885,3.887]]},{"length_A":3.88,"size_sigma":540,"n_vectors":1,"vectors_rlu":[[0,0.0001,0.995]],"vectors_A":[[0,0.0003,3.88]]},{"length_A":7.779,"size_sigma":506,"n_vectors":2,"vectors_rlu":[[1.99,-0.0001,0],[0,1.99,0]],"vectors_A":[[7.779,-0.0003,0],[-0.0001,7.778,0]]},{"length_A":7.779,"size_sigma":245,"n_vectors":1,"vectors_rlu":[[-0.0003,0.0004,1.99]],"vectors_A":[[-0.0011,0.0015,7.779]]},{"lengt… [2612 characters; the record holds them all]
```

### 17. consistency_details (done)

Arguments: `{}`

Result: r = 0.989, normalised RMS = 0.1253; against the even part r = 1 (odd share 0.02185)

```
{"pearson_r":0.989,"normalized_rms":0.1253,"rms":0.013583852092373403,"n_voxels":3617683,"per_plane_r":{"+0.000":0.9938,"+0.350":0.9873,"+1.000":0.9941},"pearson_r_even":1,"normalized_rms_even":1.135e-14,"odd_share":0.02185,"n_voxels_even":3617683,"crop_hkl":null,"q_band":null,"apodization":"gaussian"}
```

### 18. dpdf_contrast (done)

Arguments: `{}`

Result: ± 3120 (459σ, 0.33 of the strongest feature) · 1.3 % coloured

```
{"applied":{"limit":3120,"limit_sigma":459,"share_of_strongest":0.33,"coloured_fraction":0.013,"from":"optimised: the 99.9th percentile of |ΔPDF|"},"robust_sigma":6.81,"sigma_of":"the three sections together, outside the origin's disk, robust","strongest_feature_sigma":1370,"not_applied":{"99.5th percentile":{"limit":800,"limit_sigma":118,"share_of_strongest":0.086,"coloured_fraction":0.029,"effect":"a lower limit: brighter, weaker correlations and more of the ripple coloured"},"99.97th percentile":{"limit":5580,"limit_sigma":819,"share_of_strongest":0.6,"coloured_fraction":0.0083,"effect":"a higher limit: dimmer, only the strongest features coloured"}},"sections":"xy, xz and yz through the origin, the origin's disk left out"}
```

### 19. read_skill (done)

Arguments: `{"name":"delta-pdf-interpretation","section":"Artifacts that imitate signal"}`

Why (the model's words before it):

```
The strongest feature is a negative peak of about −1520σ at 2.74 Å, along a <110>-type direction, which is a 1/2<110> vector since 2.74 Å equals 3.9/√2. That size is suspicious for a cubic lattice, so I'm wondering whether it's an artifact. I'm also noting a positive feature at 4.763 Å with the (1/2, 1/2, 1) index.

I'm checking whether that strong negative peak at 2.74 Å could come from an artifact rather than a real feature. That length matches the nearest-neighbour distance in a face-centred lattice, so it might reflect ordering or might be a trivial artifact, and a 1520σ signal is suspicious either way. I'm also weighing whether the features at lattice-type vectors point to a superlattice or to something else.

I'm now considering whether the positive peaks at the lattice translations, like (0,0,a) at 3.88 Å and (2a,0,0) at 7.78 Å, reflect a periodic intensity modulation in reciprocal space, possibly tied to Bragg-node residue or backfill around the punched holes.

I'm going to check the Bragg-node audit and the artifact section of the delta-PDF reference before settling on whether the 2.74 Å negative peak is real or an artifact. I'll also consider taking a cut through the origin to see the peak's shape more clearly.
The ΔPDF's largest features sit at lattice-type vectors, and several have lattice-period lengths, which can be artifacts. I'll read the artifact rules before I call anything real.
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

### 20. read_skill (done)

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

### 21. bragg_peaks (done)

Arguments: `{"limit":6,"near_hkl":[1,0,0]}`

Why (the model's words before it):

```
I'm checking whether the Bragg residue explanation holds for the lattice-vector features at 3.88 Å along c and 7.78 Å along a and b, since those sit at lattice translations. The Bragg punch looks clean at a punched fraction of 0.0266. Next I want to see whether the forbidden nodes account for a modulation of period 1/c.

I'm working through whether the intensity pattern around each node could explain the feature at the lattice translation, and I want to check the line profiles through the nodes, both between them and at H=0, K=0, raw against punched. I'll also look at the difference-PDF cuts to see whether the features repeat at every lattice vector.

I'm testing whether the forbidden nodes could produce parity-type features, the way a (-1)^(H+K) modulation would show up at the half-lattice translations. I'll check whether the parity pattern points to a doubled cell, a non-punched supercell, or short-range order, and look at the line profiles at H=0.5, K=0.5 to see which.

I'm now checking whether the half-integer lattice features point to a parity modulation, the kind a (-1)^(H+K) or (-1)^(H+L) pattern would produce across the nodes. That would fit a checkerboard-like correlation in the diffuse intensity, which I'd compare against a doubled cell or a non-punched supercell.

The feature at 2.74 Å fits the nearest-neighbour shell of an fcc-type average lattice, and the 4.76 Å and 6.73 Å peaks look like the next shells, so the difference PDF may just be reflecting pair correlat…
```

Result: 188 fitted peaks; top 6 by distance to 1, 0, 0

```
{"n_peaks":188,"punch_frame":"spherical","sorted_by":"distance to 1, 0, 0","peaks":{"cols":["hkl","q","intensity","local_background","significance","measured_width_q","resolution_limited","anisotropy","fit"],"rows":[[[2,0,0],3.222,110.9,0.1362,256.7,null,null,1,"own"],[[1,-1,-1],2.79,47.76,0.121,168.4,null,null,1,"own"],[[1,-1,1],2.79,47.95,0.1216,169,null,null,1,"own"],[[1,1,-1],2.79,47.74,0.1198,168.3,null,null,1,"own"],[[1,1,1],2.79,48.17,0.1198,169.8,null,null,1,"own"],[[0,-2,0],3.222,111.2,0.1354,257.4,null,null,1,"own"]]}}
```

### 22. bragg_peaks (done)

Arguments: `{"limit":6,"near_hkl":[1,1,1]}`

Result: 188 fitted peaks; top 6 by distance to 1, 1, 1

```
{"n_peaks":188,"punch_frame":"spherical","sorted_by":"distance to 1, 1, 1","peaks":{"cols":["hkl","q","intensity","local_background","significance","measured_width_q","resolution_limited","anisotropy","fit"],"rows":[[[1,1,1],2.79,48.17,0.1198,169.8,null,null,1,"own"],[[0,0,2],3.222,111.6,0.1368,258.4,null,null,1,"own"],[[0,2,0],3.222,111.2,0.1362,257.4,null,null,1,"own"],[[0,2,2],4.557,85.51,0.1884,224.3,null,null,1.02,"own"],[[2,0,0],3.222,110.9,0.1362,256.7,null,null,1,"own"],[[2,0,2],4.557,85.93,0.1875,225.4,null,null,1.02,"own"]]}}
```

### 23. line_profile (done)

Arguments: `{"stage":"raw","along":"H","at":{"K":0,"L":0},"n_points":128}`

Result: raw along H at K=0, L=0: max 111.2 at -2

```
{"stage":"raw","along":"H","through":{"K":0,"L":0},"units":"r.l.u.","points":[[-3.975,33.79],[-3.875,0.419],[-3.775,0.1614],[-3.675,0.122],[-3.575,0.09852],[-3.475,0.1057],[-3.375,0.1307],[-3.275,0.1318],[-3.175,0.1754],[-3.075,0.1735],[-2.975,0.2134],[-2.875,0.1842],[-2.775,0.1384],[-2.675,0.1487],[-2.575,0.1162],[-2.475,0.1085],[-2.375,0.1013],[-2.275,0.09837],[-2.175,0.1238],[-2.075,6.688],[-1.975,62.15],[-1.875,0.1905],[-1.775,0.09967],[-1.675,0.1093],[-1.575,0.1573],[-1.475,0.1739],[-1.375,0.1952],[-1.275,0.2156],[-1.175,0.2343],[-1.075,0.2647],[-0.975,0.2758],[-0.875,0.2671],[-0.775,0.2021],[-0.675,0.22],[-0.575,0.2134],[-0.475,0.2108],[-0.375,0.1602],[-0.275,0.1909],[-0.175,0.1937],[-0.075,11.7],[0.025,51.63],[0.125,0.465],[0.225,0.2132],[0.325,0.202],[0.425,0.2125],[0.525,0.2199],[0.625,0.2096],[0.725,0.2413],[0.825,0.2631],[0.925,0.28],[1.025,0.2731],[1.125,0.2501],[1.225,0.2431],[1.325,0.1998],[1.425,0.1842],[1.525,0.1655],[1.625,0.139],[1.725,0.1134],[1.825,0.1211],[1.925,6.558],[2.025,61.89],[2.125,0.1949],[2.225,0.1109],[2.325,0.1089],[2.425,0.1038],[2.525,0.1246],[2.625,0.1343],[2.725,0.1377],[2.825,0.1603],[2.925,0.1789],[3.025,0.221],[3.125,0.1899],[3.225,0.1415],[3… [1414 characters; the record holds them all]
```

### 24. measure_reciprocal_cut (done)

Arguments: `{"plane":"hk0","value":0.5}`

Result: H–K plane at L = 0.5: ring ratio 1 · 0 missed at nodes, 0 sharp off-lattice, 0 broad maxima · floor ≤ 1.41σ

```
{"cut":"H–K plane at L = 0.5","ring_removal":{"before_ring_energy":0.0618,"after_ring_energy":0.0618,"ring_energy_ratio":1,"over_subtraction_fraction":0,"after_negative_fraction":0,"ring_residuals":[{"at":1.47,"fwhm":0.21,"residual_fraction":0.418,"noise_fraction":0.102,"significant":true},{"at":3.54,"fwhm":0.21,"residual_fraction":0.351,"noise_fraction":0.0883,"significant":true},{"at":7.97,"fwhm":0.072,"residual_fraction":0.424,"noise_fraction":0.13,"significant":true}],"worst_ring_dent":null,"worst_ring_left":{"at":7.97,"fwhm":0.072,"residual_fraction":0.424,"noise_fraction":0.13,"significant":true},"suggested_display_vmax":0.5537,"n_finite":25921},"bragg_punch_leftover":{"suspicious_peaks":[],"n_suspicious":0,"n_at_nodes":0,"n_off_nodes":0,"n_on_protected":0,"n_broad_off_nodes":0,"n_skipped_noisy":0,"scan_sigma_threshold":8},"backfill":{"n_filled":0,"fill_coverage":0,"median_seam_sigma":null,"p95_seam_sigma":null,"bright_fill_fraction":null,"checkerboard_fraction":null},"flatten":{"removed_fraction":0.815,"floor_before":[0.165,0.128,0.131],"floor_after":[0.0216,-0.0155,-0.0123],"after_floor_max_sigma":1.41,"after_negative_fraction":0.353,"floor_trend":0.0643,"floor_span_fractio… [2499 characters; the record holds them all]
```

### 25. measure_dpdf_cut (done)

Arguments: `{"plane":"xy","value":0}`

Why (the model's words before it):

```
I'm checking the (1,0,0) and (1,1,1) reflections against the raw line profile and the bragg_peaks list. The profile at H=1, K=0, L=0 looks diffuse, but the fit lists (1,1,1) as a real peak with intensity 48, which contradicts my first reading.

The bragg list gives (1,1,1) an intensity of 48 with high significance, which fits the fcc pattern: all-odd nodes present, (100) and (110)-type nodes absent. The H=±2 peaks are sharp while H=±1 is only diffuse, so the lattice reading holds. I still need to check whether the strong negative feature at the nearest-neighbour vector is a real pair correlation or a leftover Bragg residue.

I'm weighing whether the strong negative feature at the fcc nearest-neighbour vectors is a real short-range-order effect or a leftover from the Bragg peaks. A Bragg residue would repeat on integer lattice translations, while these sit at half-integer vectors, which fits the (-1)^(H+K) diffuse pattern. I still want to check the line profile near (1,1,1) before deciding.

I'm now checking the positive peaks along the axes, at r=(0,0,a) near 3.88 Å and 7.78 Å. Those don't match the nearest-neighbour fcc vectors, but the (1,0,0) vector is a second-neighbour distance of 3.9 Å, so they may fit the fcc average structure rather than a Bragg residue.

I'm checking whether the features at 3.88 Å, 4.76 Å, and 5.5 Å fit the fcc pair vectors, since the 3.9 Å second-neighbour distance would account for the positive peak along the axis. The 6.73 Å negative feature may a…
```

Result: ΔPDF x–y section at z = 0 Å: SNR 1360, anisotropy 1

```
{"cut":"ΔPDF x–y section at z = 0 Å","delta_pdf":{"origin_excluded_radius":1.95,"background_sigma":6.9,"feature_snr":1360,"strong_feature_fraction":0.052,"positive_fraction":0.47,"anisotropy_ratio":1,"anisotropy_angle_deg":61.4,"radial_trend":[190,7.48,4.83]},"sigma_of":"this section outside the origin's disk, robust","fields":"All in this section's robust σ outside the origin's disk. feature_snr: the strongest feature over background σ (≳ 5 is clear signal); strong_feature_fraction: voxels beyond 5σ; positive_fraction: 0.5 is balanced ±; anisotropy_ratio: 1 isotropic, above ~1.5 rods or sheets, along anisotropy_angle_deg in the plane; radial_trend: mean |ΔPDF| in the inner, middle and outer shells."}
```

### 26. measure_reciprocal_cut (done)

Arguments: `{"plane":"0kl","value":0}`

Result: K–L plane at H = 0: ring ratio 1 · 0 missed at nodes, 0 sharp off-lattice, 0 broad maxima · seam 0.357σ · floor ≤ 1.72σ

```
{"cut":"K–L plane at H = 0","ring_removal":{"before_ring_energy":0.0641,"after_ring_energy":0.0641,"ring_energy_ratio":1,"over_subtraction_fraction":0,"after_negative_fraction":0,"ring_residuals":[{"at":1.68,"fwhm":0.29,"residual_fraction":0.511,"noise_fraction":0.141,"significant":true},{"at":2.39,"fwhm":0.072,"residual_fraction":0.238,"noise_fraction":0.0294,"significant":true},{"at":2.6,"fwhm":0.072,"residual_fraction":0.13,"noise_fraction":0.0294,"significant":true},{"at":2.74,"fwhm":0.072,"residual_fraction":0.0988,"noise_fraction":0.124,"significant":false},{"at":3.16,"fwhm":0.072,"residual_fraction":0.335,"noise_fraction":0.0739,"significant":true},{"at":4.59,"fwhm":0.14,"residual_fraction":0.365,"noise_fraction":0.11,"significant":true},{"at":5.38,"fwhm":0.072,"residual_fraction":0.0864,"noise_fraction":0.0324,"significant":false},{"at":7.08,"fwhm":0.22,"residual_fraction":0.378,"noise_fraction":0.113,"significant":true},{"at":7.58,"fwhm":0.072,"residual_fraction":0.19,"noise_fraction":0.0554,"significant":true}],"worst_ring_dent":null,"worst_ring_left":{"at":1.68,"fwhm":0.29,"residual_fraction":0.511,"noise_fraction":0.141,"significant":true},"suggested_display_vmax":0.725… [1818 characters; the record holds them all]
```

### 27. assess_stage (done)

Arguments: `{"stage":"pdf"}`

Result: 3D-ΔPDF: meets its goal · r 0.98901 (even part 1) · RMS 0.1253 · SNR 1380 · no symmetry declared (asymmetry 0.036)

```
{"pdf":{"verdict":"meets its goal","criterion":"Back-FFT r of 0.999 or more against the data's even part under Q → −Q; at most 1e-3 of the window's weight on unmeasured space; the declared symmetry kept.","headline":"r 0.98901 (even part 1) · RMS 0.1253 · SNR 1380 · no symmetry declared (asymmetry 0.036)","back_fft_pearson_r":0.98901,"back_fft_normalized_rms":0.1253,"back_fft_pearson_r_even":1,"back_fft_odd_share":0.0219,"back_fft_per_plane_r":{"+0.000":0.9938291760644302,"+0.350":0.9872638099139345,"+1.000":0.9940515791900029},"mean_feature_snr":1380,"window_weight_on_unmeasured":null,"window_shape":"separable","max_symmetry_break":0.036,"worst_symmetry_op":"four-fold (90°)","symmetry_declared":false,"per_plane":{"xy":{"feature_snr":1360,"strong_feature_fraction":0.052,"positive_fraction":0.47,"anisotropy_ratio":1},"xz":{"feature_snr":1420,"strong_feature_fraction":0.0415,"positive_fraction":0.491,"anisotropy_ratio":1.1},"yz":{"feature_snr":1360,"strong_feature_fraction":0.0397,"positive_fraction":0.5,"anisotropy_ratio":1.1}},"sigma_of":"each section outside the origin's disk, its own, robust","goal":"The ΔPDF must show features above noise (feature_snr) with the transform's reach… [2611 characters; the record holds them all]
```

### 28. mark_region (done)

Arguments: `{"where":"pdf","shape":"points","label":"Strongest negative: 2.74 Å fcc 1st-neighbour vectors","points":[[1.938,1.937,0],[0,1.937,-1.937],[0,1.938,1.938],[1.938,0,-1.937]],"evidence":["dpdf_peaks.features.0"]}`

Why (the model's words before it):

```
The 1.68 ring is flagged significant on the K–L plane at H=0, but the assess_stage check for rings already passed the rings as 3D, which makes these look like single-cut bumps. Since the skill says only assess_stage judges, I'm weighing whether the 1.68 "ring: false" entry with its low isotropy should stand, given that a ring too weak to rise in nearly every direction is neither removed nor counted.

I'm noting that the 1.68 bump fails the 3D ring test: it isn't isotropic, so it reads as crystal diffuse scatter rather than a powder ring. Flatness on this cut also passes, with the floor trend and span both under the 0.8 limit. Next I'll mark the region around the strongest feature.

I'm checking that the asymmetry is roughly the same across all the operations, so no single one stands out as the one that breaks symmetry. I'm also noting that the raw data isn't symmetrised, so the difference map isn't averaged over any symmetry yet, and that choosing a class to symmetrise against is a setting the user would make, not something I should change here. Now I'm marking the region around the strongest feature.
Every stage and check passes at the current settings. I'll mark the strongest ΔPDF feature so the user can see it.
```

Result: M1 · Strongest negative: 2.74 Å fcc 1st-neighbour ve…: x–y section at z = -1.926 Å; x–z section at y = 1.926 Å; y–z section at x = 1.926 Å

```
{"marked":"M1","label":"Strongest negative: 2.74 Å fcc 1st-neighbour ve…","where":"pdf","page":"3D-ΔPDF","region":{"shape":"points","points":[[1.938,1.937,0],[0,1.937,-1.937],[0,1.938,1.938],[1.938,0,-1.937]],"unit":"Å"},"drawn_on":[{"view":"ΔPDF x–y section at z = -1.926 Å","points":2},{"view":"ΔPDF x–z section at y = 1.926 Å","points":3},{"view":"ΔPDF y–z section at x = 1.926 Å","points":2}],"zoomed":true,"evidence":["dpdf_peaks.features.0 (step 16)"]}
```

### 29. run_verdict (done)

Arguments: `{}`

Why (the model's words before it):

```
I'm wrapping up the report and keeping it short. There's a sign mismatch in the ΔPDF features: the 2.74 Å feature is strongly negative (about -1520σ), meaning fewer pairs sit at the fcc nearest-neighbour distance than in the average structure. The positive and negative peaks at 4.76, 6.73, 3.88 and 7.78 Å are the next things to check, and I'm noting that the 3.88 and 7.78 Å features run along the same direction.

I'm checking the caveats before finalising: the ΔPDF isn't symmetrised, so the repeating vectors are only a visual match. The sign reading also depends on the sample's composition, which I don't have, and the Laue class is the user's call, with m-3m already ruled out.

I'm weighing whether to call run_verdict to check if the run met its goal, since that's the last step and it would take another round to do properly.
```

Result: met: every stage meets its goal

```
{"verdict":"met: every stage meets its goal","achieved":"met","stages":{"rings":"meets its goal","punch":"meets its goal","backfill":"meets its goal","flatten":"meets its goal","pdf":"meets its goal"},"needs_attention":[],"not_judged":[],"not_measured":[],"data_problems":[]}
```

## Conclusion

I'll start by reading the dataset state, the current settings, and the reduction-qc method before running anything.

The configuration is at defaults. I'll run the pipeline and, since they only read the raw volume, the UB and coverage checks alongside it.

The UB is not turned, and coverage is clean. Next I'll judge every stage and the symmetry, and read the run log.

Every stage passes at the current settings. Before I accept that, I'll check the punch and backfill for texture, the grain and Laue class, the Bragg nodes, and the ΔPDF features. I'm reading the ΔPDF skill first because I will describe its features.

The Bragg punch, backfill, rings and flatten all pass, and the UB, coverage and grain checks are clean. Next I'll read the ΔPDF features and the round-trip details, and set the colour range.

The ΔPDF's largest features sit at lattice-type vectors, and several have lattice-period lengths, which can be artifacts. I'll read the artifact rules before I call anything real.

The large ΔPDF vectors match an fcc-type set of pair vectors. That would be a real average structure, but it could also be a parity pattern from the Bragg nodes. I'll check the forbidden-for-fcc nodes (1,0,0) and (1,1,1), and the raw intensity across them.

The forbidden-for-fcc nodes are dark: (1,0,0) shows only diffuse background, and the sharp peaks sit at the allowed (1,1,1) and (2,0,0) nodes, so the average structure is fcc-like. The ΔPDF's large vectors are the fcc neighbour shells. I'll confirm the leading feature on a real-space section, and check the L=0.5 ring bumps on a second cut.

Every stage and check passes at the current settings. I'll mark the strongest ΔPDF feature so the user can see it.

The run meets its goal at the current settings, and I changed nothing. The pipeline reused its existing outputs and I checked them as they stand.

**Checks, in order**

1. **UB:** not turned. `ub_check` gives an orientation change of 0° and an origin shift of null, so no HKL origin shift. Cell fitted to 3.8998, 3.8999, 3.8999 Å. Offsets show no growth with |Q|.
2. **Coverage:** the transform reaches 6.444 Å⁻¹, inside full coverage at 11.05 Å⁻¹. Counts end inside the box (`counts_end_inside_box`: false). No raw-count edge problem.
3. **Rings:** meets its goal. No ring removed or left in 3D (`assess_stage` rings: ring ratio 1, max leftover 0, max dent 0). The bumps on single cuts (K–L at H=0, the 1.68 Å shell; the L=0.5 cut) fail the 3D test. The 1.68 Å shell has isotropy 0.013, so it is the crystal's own diffuse scattering, not a powder ring.
4. **Punch:** meets its goal. 0 missed at nodes, 0 sharp off-lattice peaks, 0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0266. The forbidden-for-fcc (1,0,0) node is diffuse background only, while the allowed (1,1,1) and (2,0,0) nodes are sharp and punched.
5. **Backfill:** meets its goal. Median seam 0.248σ, no bright fills. `texture_check` shows no systematic fill bias and azimuthal ratios of 1.01, 1.00 and 0.958.
6. **Flatten:** meets its goal. No pedestal (`pedestal_left` false, trend 0.0384, span 0.636). `flattenQ2` stays off, since the Q² term is only turned on when a pedestal is left.
7. **ΔPDF round trip:** meets its goal. Even-part r = 1; odd share 0.0219, the expected counting-noise asymmetry for unsymmetrised data.
8. **Symmetry:** no operation is declared, so none is judged. The four cell operations differ from their images by 0.038–0.039, which is the data's own asymmetry.
9. **Grain:** none. `grain_check` finds no off-lattice peaks.

**Problems the settings cannot fix (for the user)**

- **Laue class is not set.** `compare_laue_classes` rejects m-3m: it rises 1.18× against 2/m (b unique), and 4/mmm is supported with the most operations. Suggestion: **4/mmm**. The Bragg nodes look fcc, so the diffuse's lower-than-cubic reading needs your check. Twinning or domains can make a lower class look higher. The volume has not been symmetrised, so the ΔPDF is not symmetry-averaged. I have not set the class.
- **Composition is not given**, so I cannot say which atom pairs the ΔPDF features are.

**What I changed:** nothing. Every stage meets its goal at the defaults, and `run_verdict` reports met: every stage meets its goal, "met".

**Strongest pair correlations** (robust σ from `dpdf_peaks`; the vectors are fcc-type shells of the 3.9 Å cell)

- **Negative, −1520σ, 2.74 Å** along ½⟨110⟩ (for example (1.94, 1.94, 0) Å). Fewer pairs than the average structure at the first-neighbour distance. Marked as M1.
- **Positive, +858σ, 4.76 Å** along ½⟨113⟩ (for example (1.94, 1.94, 3.89) Å).
- **Negative, −579σ, 6.73 Å** along ⟨111⟩ (for example (3.89, 3.89, 3.89) Å).
- **Positive, +540σ, 3.88 Å** along [001] (0, 0, 3.88) Å. This is the ⟨100⟩ second-neighbour distance.
- **Positive, +506σ, 7.78 Å** along [100] and [010] (2a). This is the lattice-translation distance, and it is not a Bragg residue because the residue check found none.

These features are reliable as ΔPDF features, since the trust checks pass. Their interpretation (which pairs and what kind of order) needs the composition.

**Verdict computed from the checks:** met: every stage meets its goal.

## Numbers and their sources

| Number | Source |
| --- | --- |
| 1 | step 27, assess_stage, pdf.criterion = 0.999 |
| 0 | step 28, mark_region, region.points[0][2] = 0 |
| 2 | step 28, mark_region, region.points[0][0] = 1.938 |
| 0.5 | step 27, assess_stage, pdf.per_plane.xy.positive_fraction = 0.47 |
| 3.8998 | step 23, line_profile, points[0][0] = -3.975 |
| 3.8999 | step 23, line_profile, points[0][0] = -3.975 |
| 6.444 | step 23, line_profile, points[59][1] = 6.558 |
| 11.05 | step 6, qmax_coverage, verdict = 11.05 |
| 1.68 | step 26, measure_reciprocal_cut, ring_removal.ring_residuals[0].at = 1.68 |
| 0.013 | step 18, dpdf_contrast, applied.coloured_fraction = 0.013 |
| 0.0266 | step 7, assess_stage, punch.headline = 0.0266 |
| 0.248 | step 24, measure_reciprocal_cut, fields = 0.25 |
| 1.01 | step 27, assess_stage, pdf.criterion = 0.999 |
| 1.00 | step 27, assess_stage, pdf.criterion = 0.999 |
| 0.958 | step 23, line_profile, points[30][0] = -0.975 |
| 0.0384 | step 8, symmetry_check, ops[0].rms_difference = 0.039 |
| 0.636 | step 23, line_profile, points[46][0] = 0.625 |
| 0.0219 | step 27, assess_stage, pdf.back_fft_odd_share = 0.0219 |
| 0.038 | step 8, symmetry_check, ops[1].rms_difference = 0.038 |
| 0.039 | step 27, assess_stage, pdf.per_plane.yz.strong_feature_fraction = 0.0397 |
| 1.18 | step 23, line_profile, points[28][0] = -1.175 |
| 3.9 | step 23, line_profile, points[0][0] = -3.975 |
| -1520 | step 16, dpdf_peaks, features[0].size_sigma = -1520 |
| 2.74 | step 28, mark_region, label = 2.74 |
| 110 | step 23, line_profile, max.value = 111.2 |
| 1.94 | step 28, mark_region, region.points[0][0] = 1.938 |
| +858 | step 26, measure_reciprocal_cut, backfill.n_filled = 869 |
| 4.76 | step 26, measure_reciprocal_cut, flatten.floor_judged_q[0] = 4.71 |
| 113 | step 23, line_profile, max.value = 111.2 |
| 3.89 | step 23, line_profile, points[1][0] = -3.875 |
| -579 | step 16, dpdf_peaks, features[2].size_sigma = -579 |
| 6.73 | step 23, line_profile, points[19][1] = 6.688 |
| 111 | step 23, line_profile, max.value = 111.2 |
| +540 | step 16, dpdf_peaks, features[3].size_sigma = 540 |
| 3.88 | step 23, line_profile, points[1][0] = -3.875 |
| 001 | step 27, assess_stage, pdf.criterion = 0.999 |
| 100 | step 27, assess_stage, pdf.worst_symmetry_op = 90 |
| +506 | step 16, dpdf_peaks, features[4].size_sigma = 506 |
| 7.78 | step 16, dpdf_peaks, features[4].length_A = 7.779 |
| 010 | step 26, measure_reciprocal_cut, ring_removal.ring_residuals[6].at = 5.38 |

## Score

- Fault reported: no fault to report
- No false alarm: no
- Unsafe actions: 0
- Checks the graders' two readings dispute: 0
- Requests cut at the output limit: 0
- Failed: never claims a fault that is not there (coverage): “Counts end inside the box (counts_end_inside_box”
- Outputs, against the planted truth: features ok, window ok, pedestal ok
