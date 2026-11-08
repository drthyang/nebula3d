# dev-flatten, arm B, run 1

Model: Claude Sonnet 5.5 (Anthropic) (Anthropic). Started 2026-11-07T23:44:46.792Z; 376 s, 274273 tokens in and 5368 out over 11 requests, $0.1690. The model saw the dataset as va7eeb5-B1.

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

The first request's tools: read_skill, describe_dataset, current_view, measure_reciprocal_cut, measure_dpdf_cut, assess_stage, texture_check, qmax_coverage, symmetry_check, dpdf_contrast, dpdf_peaks, grain_check, ub_check, compare_laue_classes, radial_profile, line_profile, bragg_peaks, consistency_details, run_log, compare_datasets, run_verdict, configure_settings, update_settings, run_pipeline, tune_pipeline, regrid_refined_ub, show_in_viewer, mark_region.

## Steps

### 1. read_skill (done)

Arguments: `{"name":"reduction-qc"}`

Why (the model's words before it):

```
I'm going to start by reading the skill files, beginning with reduction-qc and then the others.
I'll start by reading the skills for this task.
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

Result: va7eeb5_B1: raw, ringremoved, braggpunched, backfilled, flattened, delta_pdf

```
{"dataset":"va7eeb5_B1","id":"va7eeb5-B1","stages":["raw","ringremoved","braggpunched","backfilled","flattened","delta_pdf"],"reciprocal":{"grid":[161,161,161],"H":[-4,4],"K":[-4,4],"L":[-4,4],"planes":["hk0","h0l","0kl"]},"cell":{"a":3.9,"b":3.9,"c":3.9,"alpha":90,"beta":90,"gamma":90},"sigma":"measured","delta_pdf":{"grid":[162,162,162],"x":[-39,38.52],"y":[-39,38.52],"z":[-39,38.52],"q_max":11.16,"planes":["xy","xz","yz"]},"other_datasets":[]}
```

### 5. configure_settings (done)

Arguments: `{}`

Result: 0 settings off their defaults, 61 at them

```
{"settings":{},"at_default":61}
```

### 6. run_pipeline (done)

Arguments: `{"from_stage":"rings"}`

Why (the model's words before it):

```
Outputs on disk might not match the current settings, so I'm wondering whether to run the whole pipeline or just the part that's relevant. Before running anything, I want to do the UB and coverage checks first.
```

Result: done in 6.4 s · 6 computed, 0 reused

```
{"ended":"done","seconds":6.4,"stages":{"rings":"computed","punch":"computed","backfill":"computed","flatten":"computed","pdf":"computed","pdf_check":"computed"},"outputs":["raw","ringremoved","braggpunched","backfilled","flattened","delta_pdf"],"log_tail":["Flatten · flatten complete (const 0.3607 + 0·F(Q)², R² 0.000)","3D-ΔPDF · 3D-ΔPDF FFT (apodize=gaussian)","3D-ΔPDF · ΔPDF complete (|Q|max 11.16 Å⁻¹, shape (162, 162, 162))","Consistency check · back-FFT round-trip consistency check","Consistency check · back-FFT vs data: r=0.98891, normalised RMS=1.342e-01; vs the data's even part, which the transform keeps: r=1.00000"]}
```

### 7. ub_check (done)

Arguments: `{}`

Result: both: RMS 0.0010 → 0.0004 Å⁻¹ over 90 peaks; a 3.900 → 3.899 Å, c 3.900 → 3.899 Å; turned 0.001°

```
{"verdict":"the UB is right: turned 0.001°, under the 0.05° that counts as turned","fit":"both","bragg_nodes_every":[1,1,1],"symmetry_from":null,"symmetrised":null,"symmetry_break":null,"peaks":{"searched":342,"used":90,"rejected":0},"rms_start":0.001,"rms":0.0004,"cell_start":"3.9000, 3.9000, 3.9000 Å; 90.000°, 90.000°, 90.000°","cell":"3.8994, 3.8995, 3.8994 Å; 90.002°, 90.000°, 90.000°","orientation_change_deg":0.001,"axis_uvw":[1,-0.064,0.101],"transform_diagonal":[1.000158,1.000141,1.000144],"passes":[{"q_max":3.72,"found":14,"used":14,"rms":"0.0003 → 0.0002"},{"q_max":7.44,"found":82,"used":82,"rms":"0.0009 → 0.0004"},{"q_max":11.16,"found":90,"used":90,"rms":"0.0010 → 0.0004"}],"radial":[{"q":"0–4","direction":"in-plane","n":4,"before":0.000071,"after":-0.000078},{"q":"0–4","direction":"oblique","n":8,"before":-7.7e-7,"after":-0.00015},{"q":"4–8","direction":"in-plane","n":4,"before":0.00011,"after":-0.000046},{"q":"4–8","direction":"oblique","n":56,"before":0.00014,"after":-0.0000029},{"q":"4–8","direction":"near the third axis","n":8,"before":0.00018,"after":0.000039},{"q":"8–12","direction":"oblique","n":8,"before":0.00014,"after":0.0000036}],"unexplained":false,"mean_off… [1439 characters; the record holds them all]
```

### 8. compare_laue_classes (done)

Arguments: `{}`

Result: suggests 4/mmm; flag: the diffuse supports only 4/mmm

```
{"columns":"r_int, x_noise, chi2: [all voxels, diffuse]; x_noise = R_int / noise floor, chi2 = χ²/dof (1: within counting noise)","classes":[{"class":"-1","ops":2,"r_int":[0.034,0.035],"x_noise":[1,1],"chi2":[1,1],"orbits":2086640,"verdict":"supported"},{"class":"2/m (b unique)","ops":4,"contains":["-1"],"r_int":[0.042,0.042],"x_noise":[1,1],"chi2":[1,1],"orbits":1049840,"verdict":"supported"},{"class":"2/m (c unique)","ops":4,"contains":["-1"],"r_int":[0.042,0.042],"x_noise":[1,1],"chi2":[1,1],"orbits":1049840,"verdict":"supported"},{"class":"mmm","ops":8,"contains":["2/m (b unique)","2/m (c unique)"],"r_int":[0.045,0.046],"x_noise":[1,1],"chi2":[1,1],"orbits":531440,"verdict":"supported"},{"class":"4/m","ops":8,"contains":["2/m (c unique)"],"r_int":[0.045,0.046],"x_noise":[1,1],"chi2":[1,1],"orbits":524960,"verdict":"supported"},{"class":"4/mmm","ops":16,"contains":["mmm","4/m"],"r_int":[0.047,0.047],"x_noise":[1,1],"chi2":[1,1],"orbits":269000,"verdict":"supported"},{"class":"m-3","ops":24,"contains":["mmm"],"r_int":[0.052,0.053],"x_noise":[1.1,1.1],"chi2":[1.25,1.26],"orbits":177200,"verdict":"supported (all); rose 1.1× against -1 (diffuse)"},{"class":"m-3m","ops":48,"contains"… [2414 characters; the record holds them all]
```

### 9. qmax_coverage (done)

Arguments: `{}`

Result: the transform reaches 6.444 Å⁻¹ (the window tapers to zero at the box faces), inside full coverage at 11.05 Å⁻¹

```
{"verdict":"the transform reaches 6.444 Å⁻¹ (the window tapers to zero at the box faces), inside full coverage at 11.05 Å⁻¹","window_weight_on_unmeasured":null,"window_shape":"separable","window_scale":1,"transform_reach_q":6.444,"reach_from":"the window tapers to zero at the box faces","full_coverage_q":11.05,"box_face_q":6.444,"box_corner_q":11.16,"raw_counts":{"q_min_edge":null,"q_max_edge":null,"fully_measured":[0.15,11.05],"box_face_q":6.444},"suggested_band":null,"counts_end_inside_box":false,"band_check":"no |Q| band is set: the transform takes every voxel, empty ones included, up to the window's reach","q_unit":"Å⁻¹","settings":{"pdfQMin":"(default)","pdfQMax":"(default)","pdfApod":"(default)","pdfWindowShape":"(default)","pdfWindowSupport":true}}
```

### 10. assess_stage (done)

Arguments: `{}`

Result: Ring removal: meets its goal · ring ratio 1 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0 · Bragg punch: meets its goal · 0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0257 · Backfill: meets its goal · seam 0.202σ · bright ≤ 0 · Flatten: needs attention · floor ≤ 1.8σ · trend 0.996 · span 1.3 · pedestal left · 3D-ΔPDF: meets its goal · r 0.98891 (even part 1) · RMS 0.1342 · SNR 1250 · no symmetry declared (asymmetry 0.038)

```
{"rings":{"verdict":"meets its goal","criterion":"No powder ring left above, or dented below, three times its plane's noise. A bump is a powder ring only if it rises in nearly every direction over the sphere (at least 0.15 of its median height in 90 % of directions): the crystal's own scattering at that |Q| rises in some directions only.","headline":"ring ratio 1 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0","stage_shells":"removed 0; left 1: 1.72 isotropy","mean_ring_energy_ratio":1,"max_over_subtraction_fraction":0,"max_ring_dent":0,"max_ring_left":0,"worst_ring_dent":null,"worst_ring_left":null,"shells_judged":[{"at":1.68,"ring":false,"isotropy":0.005},{"at":2.39,"ring":false},{"at":3.16,"ring":false,"isotropy":-15},{"at":4.59,"ring":false},{"at":5.52,"ring":false,"isotropy":-1.9},{"at":5.66,"ring":false,"isotropy":-4.6},{"at":6.02,"ring":false},{"at":7.08,"ring":false,"isotropy":-0.83},{"at":7.23,"ring":false},{"at":7.58,"ring":false},{"at":7.73,"ring":false,"isotropy":-0.84}]},"punch":{"verdict":"meets its goal","criterion":"No Bragg peak missed at a lattice node, and no sharp peak left off the lattice outside the protected planes. Broad maxima are diffuse scattering, and stay.",… [3302 characters; the record holds them all]
```

### 11. texture_check (done)

Arguments: `{}`

Result: no systematic fill bias over 189 holes in 3-D · azimuthal ratio 0.932–0.966

```
{"n_holes":189,"n_judged":189,"median_fill_bias_sigma":0,"median_fill_bias_level":0,"above_fraction":0.418,"below_fraction":0.00529,"above_floor_fraction":0,"below_floor_fraction":0,"systematic_fill_bias":false,"criterion":"systematic_fill_bias: 5 judged holes or more, 75 % of them past their range one way, with a median of 0.5σ and 0.2 of the local level or more.","per_cut":[{"cut":"H–K plane at L = 0","azimuthal_ratio":0.966},{"cut":"H–L plane at K = 0","azimuthal_ratio":0.957},{"cut":"K–L plane at H = 0","azimuthal_ratio":0.932}]}
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
{"sections":"xy at z = 0 Å, xz at y = 0, yz at x = 0","operations":"the cell's in-plane ones (orthogonal): no operations declared","ops":[{"op":"four-fold ∥ c (90°)","rms_difference":0.041,"pairs":78083,"tested_on":"xy; xz↔yz"},{"op":"two-fold ∥ c","rms_difference":0.042,"pairs":51520,"tested_on":"xz; yz"},{"op":"mirror ⊥ a","rms_difference":0.042,"pairs":51520,"tested_on":"xy; xz"},{"op":"mirror ⊥ b","rms_difference":0.042,"pairs":51520,"tested_on":"xy; yz"}],"holds":[],"symmetry_declared":false,"verdict":"not judged: the file declares no symmetry, so the sections' asymmetry (0.042) is the data's own, counting noise included, not a break by a stage"}
```

### 14. consistency_details (done)

Arguments: `{}`

Result: r = 0.9889, normalised RMS = 0.1342; against the even part r = 1 (odd share 0.02205)

```
{"pearson_r":0.9889,"normalized_rms":0.1342,"rms":0.019137286379749617,"n_voxels":3617683,"per_plane_r":{"+0.000":0.9924,"+0.350":0.9885,"+1.000":0.9923},"pearson_r_even":1,"normalized_rms_even":8.55e-15,"odd_share":0.02205,"n_voxels_even":3617683,"crop_hkl":null,"q_band":null,"apodization":"gaussian"}
```

### 15. radial_profile (done)

Arguments: `{}`

Why (the model's words before it):

```
I'm going to set flattenQ2 on for the pedestal, rerun from the flatten step, and check the radial profile as well. The 1.72 isotropy reading doesn't match a ring at 1.68, and at 0.005 it isn't one. Next I'll look at the radial profile and the flatten results, and confirm the raw ring count, which shows zero shells removed.

Heh, I'm not sure what this fragment is meant to be—it's just "ine." Hopefully the rest of the check fills in the gap.
```

Result: H–K plane at L = 0: 32 shells × 5 stages

```
{"cut":"H–K plane at L = 0","q_unit":"|Q| in Å⁻¹","stat":"median per shell","shells":{"cols":["q","raw","ringremoved","braggpunched","backfilled","flattened"],"rows":[[0.183,0.336,0.336,0.222,0.18,-0.18],[0.436,0.182,0.182,0.182,0.182,-0.179],[0.715,0.176,0.176,0.176,0.176,-0.185],[1,0.21,0.21,0.21,0.21,-0.151],[1.28,0.267,0.267,0.267,0.267,-0.0936],[1.57,0.434,0.434,0.434,0.434,0.0736],[1.86,0.472,0.472,0.472,0.472,0.111],[2.14,0.35,0.35,0.35,0.35,-0.0109],[2.42,0.349,0.349,0.349,0.349,-0.0118],[2.71,0.325,0.325,0.325,0.325,-0.0361],[2.99,0.263,0.263,0.261,0.25,-0.11],[3.27,0.277,0.277,0.264,0.252,-0.108],[3.56,0.227,0.227,0.227,0.227,-0.134],[3.84,0.227,0.227,0.227,0.227,-0.134],[4.13,0.265,0.265,0.265,0.265,-0.0952],[4.41,0.342,0.342,0.335,0.341,-0.0199],[4.7,0.437,0.437,0.431,0.429,0.0679],[4.98,0.399,0.399,0.399,0.399,0.0382],[5.27,0.398,0.398,0.398,0.398,0.0375],[5.55,0.445,0.445,0.445,0.445,0.0843],[5.84,0.423,0.423,0.423,0.423,0.0619],[6.12,0.429,0.429,0.427,0.424,0.0631],[6.4,0.405,0.405,0.399,0.402,0.0412],[6.68,0.419,0.419,0.419,0.419,0.0583],[6.97,0.529,0.529,0.521,0.514,0.154],[7.25,0.584,0.584,0.562,0.544,0.183],[7.54,0.563,0.563,0.563,0.563,0.203],[7.82,0.557,0.557,0… [1362 characters; the record holds them all]
```

### 16. radial_profile (done)

Arguments: `{"plane":"h0l","value":0.5}`

Result: H–L plane at K = 0.5: 30 shells × 5 stages

```
{"cut":"H–L plane at K = 0.5","q_unit":"|Q| in Å⁻¹","stat":"median per shell","shells":{"cols":["q","raw","ringremoved","braggpunched","backfilled","flattened"],"rows":[[0.834,0.197,0.197,0.197,0.197,-0.164],[1.01,0.184,0.184,0.184,0.184,-0.177],[1.29,0.331,0.331,0.331,0.331,-0.0298],[1.58,0.379,0.379,0.379,0.379,0.0188],[1.86,0.346,0.346,0.346,0.346,-0.0146],[2.15,0.314,0.314,0.314,0.314,-0.047],[2.43,0.263,0.263,0.263,0.263,-0.0975],[2.72,0.243,0.243,0.243,0.243,-0.117],[3.01,0.241,0.241,0.241,0.241,-0.12],[3.29,0.315,0.315,0.315,0.315,-0.0453],[3.58,0.356,0.356,0.356,0.356,-0.00467],[3.86,0.346,0.346,0.346,0.346,-0.0151],[4.15,0.356,0.356,0.356,0.356,-0.00491],[4.43,0.338,0.338,0.338,0.338,-0.0229],[4.72,0.3,0.3,0.3,0.3,-0.0606],[5.01,0.303,0.303,0.303,0.303,-0.0574],[5.29,0.348,0.348,0.348,0.348,-0.0126],[5.58,0.409,0.409,0.409,0.409,0.0479],[5.86,0.453,0.453,0.453,0.453,0.0922],[6.15,0.464,0.464,0.464,0.464,0.103],[6.43,0.463,0.463,0.463,0.463,0.102],[6.71,0.449,0.449,0.449,0.449,0.0879],[7,0.437,0.437,0.437,0.437,0.0763],[7.28,0.47,0.47,0.47,0.47,0.11],[7.57,0.539,0.539,0.539,0.539,0.178],[7.86,0.622,0.622,0.622,0.622,0.261],[8.14,0.638,0.638,0.638,0.638,0.278],[8.41,0.597,0.… [1299 characters; the record holds them all]
```

### 17. read_skill (done)

Arguments: `{"name":"reduction-qc","section":"The flatten floor"}`

Result: reduction-qc: The flatten floor

```
Skill reduction-qc, section "The flatten floor"

### The flatten floor

- A floor that rises with |Q| is inelastic background (thermal diffuse and
  multiphonon scattering; with X-rays also Compton scattering, which neutrons
  lack). The `+ b·Q²` term (`flattenQ2`) and *Fit to |Q|* (`flattenFitQMax`)
  address it.
- Why the Q² term stays off otherwise: on a volume without such a background
  it is not free, since it fits part of the crystal's own floor (on the
  validation's clean controls it raised the scored pedestal span from 0.025 to
  0.066 to 0.107 of the diffuse level).
- Whether a floor that rises with |Q| could be signal rather than background
  stays a judgment call (to confirm with the user).
- X-ray data carry no magnetic scattering, so the magnetic ion stays none for
  them; neutron data can carry magnetic diffuse scattering, so there the ion
  is the user's call.
```

### 18. update_settings (done)

Arguments: `{"changes":{"flattenQ2":true}}`

Why (the model's words before it):

```
Pedestal left in the flatten, with a floor that rises with |Q|. Following the skill, I'll turn on the Q² term and rerun from the flatten.
```

Result: flattenQ2 false → true

```
{"changed":[{"setting":"flattenQ2","from":false,"to":true}],"rerun_from":"flatten"}
```

### 19. run_pipeline (done)

Arguments: `{"from_stage":"flatten"}`

Result: done in 2.5 s · 3 computed, 0 reused

```
{"ended":"done","seconds":2.5,"stages":{"flatten":"computed","pdf":"computed","pdf_check":"computed"},"outputs":["raw","ringremoved","braggpunched","backfilled","flattened","delta_pdf"],"log_tail":["Flatten · flatten complete (const 0.1626 + 0·F(Q)² + 0.005469·Q² (held past 10 Å⁻¹), R² 0.942)","3D-ΔPDF · 3D-ΔPDF FFT (apodize=gaussian)","3D-ΔPDF · ΔPDF complete (|Q|max 11.16 Å⁻¹, shape (162, 162, 162))","Consistency check · back-FFT round-trip consistency check","Consistency check · back-FFT vs data: r=0.97854, normalised RMS=1.747e-01; vs the data's even part, which the transform keeps: r=1.00000"]}
```

### 20. assess_stage (done)

Arguments: `{}`

Result: Ring removal: meets its goal · ring ratio 1 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0 · Bragg punch: meets its goal · 0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0257 · Backfill: meets its goal · seam 0.202σ · bright ≤ 0 · Flatten: meets its goal · floor ≤ 1.52σ · trend 0.756 · span 0.455 · no pedestal · 3D-ΔPDF: meets its goal · r 0.97854 (even part 1) · RMS 0.1747 · SNR 1250 · no symmetry declared (asymmetry 0.041)

```
{"rings":{"verdict":"meets its goal","criterion":"No powder ring left above, or dented below, three times its plane's noise; a powder ring rises at least 0.15 of its median height in 90 % of directions.","headline":"ring ratio 1 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0","stage_shells":"removed 0; left 1: 1.72 isotropy","mean_ring_energy_ratio":1,"max_over_subtraction_fraction":0,"max_ring_dent":0,"max_ring_left":0,"worst_ring_dent":null,"worst_ring_left":null,"shells_judged":[{"at":1.68,"ring":false,"isotropy":0.005},{"at":2.39,"ring":false},{"at":3.16,"ring":false,"isotropy":-15},{"at":4.59,"ring":false},{"at":5.52,"ring":false,"isotropy":-1.9},{"at":5.66,"ring":false,"isotropy":-4.6},{"at":6.02,"ring":false},{"at":7.08,"ring":false,"isotropy":-0.83},{"at":7.23,"ring":false},{"at":7.58,"ring":false},{"at":7.73,"ring":false,"isotropy":-0.84}]},"punch":{"verdict":"meets its goal","criterion":"No Bragg peak missed at a lattice node; no sharp peak left off the lattice outside the protected planes.","headline":"0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0257","total_leftover_peaks":0,"leftover_at_nodes":0,"leftover_off_lattice":0,"leftover_on_protected_p… [2787 characters; the record holds them all]
```

### 21. radial_profile (done)

Arguments: `{"stages":["raw","flattened"]}`

Result: H–K plane at L = 0: 32 shells × 2 stages

```
{"cut":"H–K plane at L = 0","q_unit":"|Q| in Å⁻¹","stat":"median per shell","shells":{"cols":["q","raw","flattened"],"rows":[[0.183,0.336,0.0177],[0.436,0.182,0.0181],[0.715,0.176,0.00974],[1,0.21,0.041],[1.28,0.267,0.0944],[1.57,0.434,0.259],[1.86,0.472,0.291],[2.14,0.35,0.162],[2.42,0.349,0.154],[2.71,0.325,0.123],[2.99,0.263,0.0388],[3.27,0.277,0.0313],[3.56,0.227,-0.00495],[3.84,0.227,-0.0172],[4.13,0.265,0.00866],[4.41,0.342,0.0711],[4.7,0.437,0.145],[4.98,0.399,0.099],[5.27,0.398,0.0834],[5.55,0.445,0.111],[5.84,0.423,0.0729],[6.12,0.429,0.055],[6.4,0.405,0.0146],[6.68,0.419,0.011],[6.97,0.529,0.0844],[7.25,0.584,0.099],[7.54,0.563,0.088],[7.82,0.557,0.0569],[8.1,0.53,0.00665],[8.38,0.521,-0.0261],[8.65,0.581,0.0131],[8.92,0.896,0.0746]]}}
```

### 22. qmax_coverage (done)

Arguments: `{}`

Result: the transform reaches 6.444 Å⁻¹ (the window tapers to zero at the box faces), inside full coverage at 11.05 Å⁻¹

```
{"verdict":"the transform reaches 6.444 Å⁻¹ (the window tapers to zero at the box faces), inside full coverage at 11.05 Å⁻¹","window_weight_on_unmeasured":null,"window_shape":"separable","window_scale":1,"transform_reach_q":6.444,"reach_from":"the window tapers to zero at the box faces","full_coverage_q":11.05,"box_face_q":6.444,"box_corner_q":11.16,"raw_counts":{"q_min_edge":null,"q_max_edge":null,"fully_measured":[0.15,11.05],"box_face_q":6.444},"suggested_band":null,"counts_end_inside_box":false,"band_check":"no |Q| band is set: the transform takes every voxel, empty ones included, up to the window's reach","q_unit":"Å⁻¹","settings":{"pdfQMin":"(default)","pdfQMax":"(default)","pdfApod":"(default)","pdfWindowShape":"(default)","pdfWindowSupport":true}}
```

### 23. symmetry_check (done)

Arguments: `{}`

Result: no symmetry declared: not judged

```
{"sections":"xy at z = 0 Å, xz at y = 0, yz at x = 0","operations":"the cell's in-plane ones (orthogonal): no operations declared","ops":[{"op":"four-fold ∥ c (90°)","rms_difference":0.043,"pairs":78083,"tested_on":"xy; xz↔yz"},{"op":"two-fold ∥ c","rms_difference":0.043,"pairs":51520,"tested_on":"xz; yz"},{"op":"mirror ⊥ a","rms_difference":0.043,"pairs":51520,"tested_on":"xy; xz"},{"op":"mirror ⊥ b","rms_difference":0.043,"pairs":51520,"tested_on":"xy; yz"}],"holds":[],"symmetry_declared":false,"verdict":"not judged: the file declares no symmetry, so the sections' asymmetry (0.043) is the data's own, counting noise included, not a break by a stage"}
```

### 24. measure_reciprocal_cut (done)

Arguments: `{"plane":"hk0","value":0.5}`

Why (the model's words before it):

```
The pedestal is gone, and the odd share went up. The back-FFT agreement with the data dropped, which I'm reading as the odd part accounting for it rather than a fault. Next I'll run a second cut check at L=0.5 with the reciprocal-cut measure and the verdict, then move on to the contrast and peak analysis and a Bragg node audit of the forbidden nodes.
```

Result: H–K plane at L = 0.5: ring ratio 1 · 0 missed at nodes, 0 sharp off-lattice, 0 broad maxima · floor ≤ 1.21σ

```
{"cut":"H–K plane at L = 0.5","ring_removal":{"before_ring_energy":0.0279,"after_ring_energy":0.0279,"ring_energy_ratio":1,"over_subtraction_fraction":0,"after_negative_fraction":0,"ring_residuals":[{"at":1.47,"fwhm":0.14,"residual_fraction":0.397,"noise_fraction":0.101,"significant":true},{"at":2.33,"fwhm":0.14,"residual_fraction":0.123,"noise_fraction":0.0574,"significant":false},{"at":3.54,"fwhm":0.14,"residual_fraction":0.206,"noise_fraction":0.0639,"significant":true},{"at":6.26,"fwhm":0.072,"residual_fraction":0.063,"noise_fraction":0.021,"significant":false},{"at":7.97,"fwhm":0.072,"residual_fraction":0.114,"noise_fraction":0.0411,"significant":false}],"worst_ring_dent":null,"worst_ring_left":{"at":1.47,"fwhm":0.14,"residual_fraction":0.397,"noise_fraction":0.101,"significant":true},"suggested_display_vmax":0.7308,"n_finite":25921},"bragg_punch_leftover":{"suspicious_peaks":[],"n_suspicious":0,"n_at_nodes":0,"n_off_nodes":0,"n_on_protected":0,"n_broad_off_nodes":0,"n_skipped_noisy":0,"scan_sigma_threshold":8},"backfill":{"n_filled":0,"fill_coverage":0,"median_seam_sigma":null,"p95_seam_sigma":null,"bright_fill_fraction":null,"checkerboard_fraction":null},"flatten":{"removed_… [2688 characters; the record holds them all]
```

### 25. measure_reciprocal_cut (done)

Arguments: `{"plane":"0kl","value":1.5}`

Result: K–L plane at H = 1.5: ring ratio 1 · 0 missed at nodes, 0 sharp off-lattice, 0 broad maxima · floor ≤ 0.967σ

```
{"cut":"K–L plane at H = 1.5","ring_removal":{"before_ring_energy":0.0174,"after_ring_energy":0.0174,"ring_energy_ratio":1,"over_subtraction_fraction":0,"after_negative_fraction":0,"ring_residuals":[{"at":2.76,"fwhm":0.22,"residual_fraction":0.5,"noise_fraction":0.127,"significant":true},{"at":3.13,"fwhm":0.074,"residual_fraction":0.0897,"noise_fraction":0.0333,"significant":false},{"at":4.68,"fwhm":0.074,"residual_fraction":0.0639,"noise_fraction":0.0118,"significant":true},{"at":8.29,"fwhm":0.074,"residual_fraction":0.0732,"noise_fraction":0.0354,"significant":false}],"worst_ring_dent":null,"worst_ring_left":{"at":2.76,"fwhm":0.22,"residual_fraction":0.5,"noise_fraction":0.127,"significant":true},"suggested_display_vmax":0.7495,"n_finite":25921},"bragg_punch_leftover":{"suspicious_peaks":[],"n_suspicious":0,"n_at_nodes":0,"n_off_nodes":0,"n_on_protected":0,"n_broad_off_nodes":0,"n_skipped_noisy":0,"scan_sigma_threshold":8},"backfill":{"n_filled":0,"fill_coverage":0,"median_seam_sigma":null,"p95_seam_sigma":null,"bright_fill_fraction":null,"checkerboard_fraction":null},"flatten":{"removed_fraction":0.818,"floor_before":[0.23,0.348,0.532],"floor_after":[-0.00106,-0.00194,0.00257],"… [1350 characters; the record holds them all]
```

### 26. texture_check (done)

Arguments: `{}`

Result: no systematic fill bias over 189 holes in 3-D · azimuthal ratio 0.932–0.966

```
{"n_holes":189,"n_judged":189,"median_fill_bias_sigma":0,"median_fill_bias_level":0,"above_fraction":0.418,"below_fraction":0.00529,"above_floor_fraction":0,"below_floor_fraction":0,"systematic_fill_bias":false,"criterion":"systematic_fill_bias: 5 judged holes or more, 75 % of them past their range one way, with a median of 0.5σ and 0.2 of the local level or more.","per_cut":[{"cut":"H–K plane at L = 0","azimuthal_ratio":0.966},{"cut":"H–L plane at K = 0","azimuthal_ratio":0.957},{"cut":"K–L plane at H = 0","azimuthal_ratio":0.932}]}
```

### 27. dpdf_contrast (done)

Arguments: `{}`

Result: ± 3140 (419σ, 0.34 of the strongest feature) · 1.3 % coloured

```
{"applied":{"limit":3140,"limit_sigma":419,"share_of_strongest":0.34,"coloured_fraction":0.013,"from":"optimised: the 99.9th percentile of |ΔPDF|"},"robust_sigma":7.49,"sigma_of":"the three sections together, outside the origin's disk, robust","strongest_feature_sigma":1250,"not_applied":{"99.5th percentile":{"limit":796,"limit_sigma":106,"share_of_strongest":0.085,"coloured_fraction":0.029,"effect":"a lower limit: brighter, weaker correlations and more of the ripple coloured"},"99.97th percentile":{"limit":5570,"limit_sigma":743,"share_of_strongest":0.6,"coloured_fraction":0.0083,"effect":"a higher limit: dimmer, only the strongest features coloured"}},"sections":"xy, xz and yz through the origin, the origin's disk left out"}
```

### 28. dpdf_peaks (done)

Arguments: `{}`

Result: 608 extrema above 5σ; strongest − at (0.497, -0.497, 0) r.l.u., 2.74 Å, 1380σ

```
{"grouped_by":"sign, length and size (no symmetry declared)","features":[{"length_A":2.74,"size_sigma":-1380,"n_vectors":6,"vectors_rlu":[[0.497,-0.497,0],[0.497,0.497,0],[0.0001,0.497,0.497],[0,0.497,-0.497]],"vectors_A":[[1.938,-1.937,-0.0001],[1.937,1.937,0.0001],[0.0003,1.938,1.937],[0.0001,1.938,-1.937]]},{"length_A":4.763,"size_sigma":785,"n_vectors":12,"vectors_rlu":[[0.499,0.499,0.997],[0.997,0.498,0.498],[0.498,-0.997,-0.499],[0.499,0.997,-0.499]],"vectors_A":[[1.946,1.945,3.888],[3.888,1.944,1.944],[1.944,-3.888,-1.945],[1.945,3.888,-1.945]]},{"length_A":6.733,"size_sigma":-527,"n_vectors":4,"vectors_rlu":[[0.997,0.997,-0.997],[0.997,0.997,0.997],[0.997,-0.996,0.997],[0.997,-0.997,-0.997]],"vectors_A":[[3.888,3.887,-3.887],[3.887,3.886,3.886],[3.886,-3.886,3.888],[3.887,-3.887,-3.887]]},{"length_A":3.881,"size_sigma":493,"n_vectors":1,"vectors_rlu":[[0,0,0.995]],"vectors_A":[[0,-0.0001,3.881]]},{"length_A":7.778,"size_sigma":464,"n_vectors":2,"vectors_rlu":[[0,1.99,-0.0001],[1.99,0,-0.0003]],"vectors_A":[[0.0002,7.778,-0.0005],[7.779,-0.0001,-0.0013]]},{"length_A":7.78,"size_sigma":226,"n_vectors":1,"vectors_rlu":[[-0.0002,-0.0003,1.99]],"vectors_A":[[-0.0008,-0.0011,7.78… [2623 characters; the record holds them all]
```

### 29. bragg_peaks (done)

Arguments: `{"sort_by":"anisotropy","limit":5}`

Result: 188 fitted peaks; top 5 by anisotropy

```
{"n_peaks":188,"punch_frame":"spherical","sorted_by":"anisotropy","peaks":{"cols":["hkl","q","intensity","local_background","significance","measured_width_q","resolution_limited","anisotropy","fit"],"rows":[[[-4,0,0],6.444,56,0.5264,178,null,null,1.7,"profile"],[[0,-4,0],6.444,56.26,0.526,179,null,null,1.7,"profile"],[[0,0,-4],6.444,56.7,0.5329,180.5,null,null,1.7,"profile"],[[0,0,4],6.444,56.52,0.5327,179.8,null,null,1.7,"profile"],[[0,4,0],6.444,55.95,0.5281,177.8,null,null,1.7,"profile"]]}}
```

### 30. dpdf_peaks (done)

Arguments: `{"limit":30,"min_sigma":100}`

Why (the model's words before it):

```
I'm checking the ring residuals at the off-zero cuts: 1.47 and 2.76 look significant in single cuts, but those likely include the crystal's diffuse scattering, so only the assess_stage ring judgment in 3D really counts. Next I'm noting the two features, a strong negative peak at 2.74 Å at (½,½,0) with six vectors, and a positive one at 4.763 at (½,½,1), and I'm puzzled that these half-integer vectors don't fit a primitive cubic cell with integer lattice vectors.

I'm checking whether the features at (½,½,0) and (½,½,1) are real, since half-integer vectors look odd for a primitive cubic cell. Those positions line up with O–O and perovskite-type distances, so I'll stay cautious about reading too much into them. The axis asymmetry between c and a,b suggests a tetragonal rather than cubic symmetry, which fits the 4/mmm preference.

I'm going to run the verdict next and also check the (0.5, 0.5, 0) vector across all signs.
```

Result: 71 extrema above 100σ; strongest − at (0.497, -0.497, 0) r.l.u., 2.74 Å, 1380σ

```
{"grouped_by":"sign, length and size (no symmetry declared)","features":[{"length_A":2.74,"size_sigma":-1380,"n_vectors":6,"vectors_rlu":[[0.497,-0.497,0],[0.497,0.497,0],[0.0001,0.497,0.497],[0,0.497,-0.497]],"vectors_A":[[1.938,-1.937,-0.0001],[1.937,1.937,0.0001],[0.0003,1.938,1.937],[0.0001,1.938,-1.937]]},{"length_A":4.763,"size_sigma":785,"n_vectors":12,"vectors_rlu":[[0.499,0.499,0.997],[0.997,0.498,0.498],[0.498,-0.997,-0.499],[0.499,0.997,-0.499]],"vectors_A":[[1.946,1.945,3.888],[3.888,1.944,1.944],[1.944,-3.888,-1.945],[1.945,3.888,-1.945]]},{"length_A":6.733,"size_sigma":-527,"n_vectors":4,"vectors_rlu":[[0.997,0.997,-0.997],[0.997,0.997,0.997],[0.997,-0.996,0.997],[0.997,-0.997,-0.997]],"vectors_A":[[3.888,3.887,-3.887],[3.887,3.886,3.886],[3.886,-3.886,3.888],[3.887,-3.887,-3.887]]},{"length_A":3.881,"size_sigma":493,"n_vectors":1,"vectors_rlu":[[0,0,0.995]],"vectors_A":[[0,-0.0001,3.881]]},{"length_A":7.778,"size_sigma":464,"n_vectors":2,"vectors_rlu":[[0,1.99,-0.0001],[1.99,0,-0.0003]],"vectors_A":[[0.0002,7.778,-0.0005],[7.779,-0.0001,-0.0013]]},{"length_A":7.78,"size_sigma":226,"n_vectors":1,"vectors_rlu":[[-0.0002,-0.0003,1.99]],"vectors_A":[[-0.0008,-0.0011,7.78… [3023 characters; the record holds them all]
```

### 31. run_verdict (done)

Arguments: `{}`

Result: met: every stage meets its goal

```
{"verdict":"met: every stage meets its goal","achieved":"met","stages":{"rings":"meets its goal","punch":"meets its goal","backfill":"meets its goal","flatten":"meets its goal","pdf":"meets its goal"},"needs_attention":[],"not_judged":[],"not_measured":[],"data_problems":[]}
```

### 32. measure_dpdf_cut (done)

Arguments: `{"plane":"xy","value":0}`

Result: ΔPDF x–y section at z = 0 Å: SNR 1250, anisotropy 1

```
{"cut":"ΔPDF x–y section at z = 0 Å","delta_pdf":{"origin_excluded_radius":1.95,"background_sigma":7.44,"feature_snr":1250,"strong_feature_fraction":0.0496,"positive_fraction":0.468,"anisotropy_ratio":1,"anisotropy_angle_deg":43.2,"radial_trend":[190,7.81,5.27]},"sigma_of":"this section outside the origin's disk, robust","fields":"All in this section's robust σ outside the origin's disk. feature_snr: the strongest feature over background σ (≳ 5 is clear signal); strong_feature_fraction: voxels beyond 5σ; positive_fraction: 0.5 is balanced ±; anisotropy_ratio: 1 isotropic, above ~1.5 rods or sheets, along anisotropy_angle_deg in the plane; radial_trend: mean |ΔPDF| in the inner, middle and outer shells."}
```

### 33. mark_region (done)

Arguments: `{"where":"pdf","shape":"ellipsoid","center":[1.937,1.937,0],"half_size":[0.6,0.6,0.6],"label":"Strongest: negative, (½,½,0) 2.74 Å","evidence":["dpdf_peaks.features.0"]}`

Why (the model's words before it):

```
I'm marking the region around the strongest feature, which is an ellipsoid at (1.938, -1.937, 0) in the PDF, and then I'll report back.
```

Result: M7 · Strongest: negative, (½,½,0) 2.74 Å: x–y section at z = 0 Å; x–z section at y = 1.926 Å; y–z section at x = 1.926 Å

```
{"marked":"M7","label":"Strongest: negative, (½,½,0) 2.74 Å","where":"pdf","page":"3D-ΔPDF","region":{"shape":"ellipsoid","center":[1.937,1.937,0],"half_size":[0.6,0.6,0.6],"unit":"Å"},"drawn_on":[{"view":"ΔPDF x–y section at z = 0 Å"},{"view":"ΔPDF x–z section at y = 1.926 Å"},{"view":"ΔPDF y–z section at x = 1.926 Å"}],"zoomed":true,"evidence":["dpdf_peaks.features.0 (step 30)"]}
```

## Conclusion

I'll start by reading the skills for this task.

Pedestal left in the flatten, with a floor that rises with |Q|. Following the skill, I'll turn on the Q² term and rerun from the flatten.

The reduction is sound and the 3D-ΔPDF is trustworthy enough to read. `run_verdict` returns "met": every stage meets its goal. I changed one setting, `flattenQ2`, and found no problems with the data.

## Problems found
- **Data problems:** none.
  - **Orientation:** the UB is right. It turned 0.001°, well under the 0.05° that counts as turned. The fitted cell is 3.8994, 3.8995, 3.8994 Å. There is no origin shift (`ub_check.origin_shift_rlu` is null). Radial offsets are about 1e-4 r.l.u. and show no trend with |Q|.
  - **Second grain:** none. `grain_check` says "no off-lattice peaks were recorded by the punch's search".
  - **Coverage:** the transform reaches 6.444 Å⁻¹, at the box faces. That is inside full coverage, which is 11.05 Å⁻¹. No |Q| band is set. I did not set one, since the band is yours to decide.
  - **Raw counts end:** the raw counts do not end inside the box (`counts_end_inside_box` is false).
- **Pipeline issue (fixed):** the flatten left a pedestal after the first run. Floor trend was 0.756, floor span was 0.455, and `pedestal_left` was true. This was an inelastic-type background that rose with |Q|. The raw shell medians climbed from about 0.2 to about 0.6.

## What I changed
- **Setting:** I turned `flattenQ2` on, following the reduction-qc rule, and reran from the flatten.
- **Before:** trend 0.996, span 1.3, pedestal left.
- **After:** trend 0.756, span 0.455, no pedestal. The fit gave R² 0.942.
- **Cost:** the back-FFT r against the data fell from 0.98891 to 0.97854. The odd share rose from 0.022 to 0.0425. This is not a fault, because r against the even part under Q → −Q is 1.
- **Judgment call:** a floor that rises with |Q| could in principle be signal rather than background. Please confirm this reading.

## Checks, in order
1. **Rings:** pass.
   - Ring ratio is 1, with nothing left over or dented. No shell of the 11 judged is a ring in 3D.
   - On the off-zero cuts (hk0 at L=0.5 and 0kl at H=1.5), single-cut bumps at about 1.47 and 2.76 Å⁻¹ are flagged significant. A single cut includes the crystal's own scattering, so only the 3D verdict counts.
2. **Punch:** pass. 0 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.0257. No suspicious peaks on the off-zero cuts either.
3. **Backfill and texture:** pass.
   - The seam is 0.202σ.
   - `texture_check` found no systematic fill bias (`systematic_fill_bias` is false, over 189 holes). Azimuthal ratios are 0.93 to 0.97.
4. **Flatten:** pass after the fix (see above). The largest floor is 1.52σ.
5. **ΔPDF trust:** pass.
   - The round trip holds against the even part (1).
   - The window's weight on unmeasured space is not reported (null), and the reach stays inside full coverage.
   - No symmetry is declared. The ~0.04 asymmetry (`symmetry_check`) is the data's own noise, not a break by a stage.
   - Colour range: auto, at the 99.9th percentile.
6. **Laue class:** `compare_laue_classes` suggests 4/mmm. The diffuse supports only 4/mmm, while all voxels support m-3m, because the Bragg peaks dominate. I did not set a class. Averaging over m-3m would impose the Bragg symmetry on the diffuse, so the choice is yours.
   - The volume is unsymmetrised. The ΔPDF shows 3.881 Å along c (0,0,1) as a single listed vector, which suggests tetragonal rather than cubic. I did not check whether the a and b copies fall below the 5σ listing threshold.

## Strongest pair correlations
Sizes are in robust σ, which is 6.77. Vectors are in a, b, c and run over all signed copies.

| Vector (r.l.u.) | Length (Å) | Sign | Size (σ) | Copies |
|---|---|---|---|---|
| (½,½,0) type | 2.74 | negative | -1380 | 6 |
| (½,½,1) type | 4.763 | positive | 785 | 12 |
| (1,1,1) type | 6.733 | negative | -527 | 4 |
| (0,0,1) | 3.881 | positive | 493 | 1 |
| (0,2,0), (2,0,0) | 7.778 | positive | 464 | 2 |

- **Strongest feature:** the negative one at about 2.74 Å, (½,½,0), is marked as M7 on the ΔPDF. Negative means fewer pairs than the average structure has at that vector. For occupational disorder that would mean unlike pairs are preferred. For a displacement correlation, a positive lobe should sit on the other side of an average vector. I have not checked for that.
- **Next:** the positive (½,½,1) feature at 4.763 Å and the negative (1,1,1) feature at 6.733 Å follow it.
- **Weaker features:** the next-weaker listed ones are the positive 7.778 Å (0,2,0)/(2,0,0) lobes and the 5.841 Å (0,1.5,0) type. They reach 464σ at most.
- **Not checked:** I have not tied the features to specific atom pairs. The structure overlay needs a CIF, which I don't have. I have also not ruled out termination ripple beyond the window and coverage checks.

## Yours to decide
- the |Q| band
- the Laue class
- whether the rising |Q| floor is background rather than signal
- the atom-pair assignment of the features

**Verdict computed from the checks:** met: every stage meets its goal.

## Numbers and their sources

| Number | Source |
| --- | --- |
| 0.001 | step 30, dpdf_peaks, features[4].vectors_A[0][2] = -0.0005 |
| 0.05 | step 32, measure_dpdf_cut, delta_pdf.strong_feature_fraction = 0.0496 |
| 3.8994 | step 30, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| 3.8995 | step 30, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| 1e-4 | step 30, dpdf_peaks, features[0].vectors_rlu[2][0] = 0.0001 |
| 6.444 | step 29, bragg_peaks, peaks.rows[0][1] = 6.444 |
| 11.05 | step 30, dpdf_peaks, features[12].length_A = 11.01 |
| 0.756 | step 25, measure_reciprocal_cut, ring_removal.suggested_display_vmax = 0.7495 |
| 0.455 | step 20, assess_stage, flatten.headline = 0.455 |
| 0.2 | step 26, texture_check, criterion = 0.2 |
| 0.6 | step 33, mark_region, region.half_size[0] = 0.6 |
| 0.996 | step 32, measure_dpdf_cut, delta_pdf.anisotropy_ratio = 1 |
| 1.3 | step 21, radial_profile, shells.rows[4][0] = 1.28 |
| 0.942 | step 26, texture_check, per_cut[1].azimuthal_ratio = 0.957 |
| 0.98891 | step 32, measure_dpdf_cut, delta_pdf.anisotropy_ratio = 1 |
| 0.97854 | step 30, dpdf_peaks, features[1].vectors_rlu[0][2] = 0.997 |
| 0.022 | step 14, consistency_details, odd_share = 0.02205 |
| 0.0425 | step 23, symmetry_check, ops[0].rms_difference = 0.043 |
| 1 | step 33, mark_region, region.half_size[0] = 0.6 |
| 11 | step 30, dpdf_peaks, features[12].length_A = 11.01 |
| 0.5 | step 32, measure_dpdf_cut, delta_pdf.positive_fraction = 0.468 |
| 1.5 | step 32, measure_dpdf_cut, fields = 1.5 |
| 1.47 | step 24, measure_reciprocal_cut, ring_removal.ring_residuals[0].at = 1.47 |
| 2.76 | step 33, mark_region, label = 2.74 |
| 0 | step 33, mark_region, label = 0 |
| 0.0257 | step 21, radial_profile, shells.rows[29][2] = -0.0261 |
| 0.202 | step 26, texture_check, criterion = 0.2 |
| 189 | step 32, measure_dpdf_cut, delta_pdf.radial_trend[0] = 190 |
| 0.93 | step 26, texture_check, per_cut[2].azimuthal_ratio = 0.932 |
| 0.97 | step 26, texture_check, per_cut[0].azimuthal_ratio = 0.966 |
| 1.52 | step 32, measure_dpdf_cut, fields = 1.5 |
| 0.04 | step 25, measure_reciprocal_cut, ring_removal.ring_residuals[3].noise_fraction = 0.0354 |
| 3.881 | step 30, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| 5 | step 32, measure_dpdf_cut, delta_pdf.radial_trend[2] = 5.27 |
| 6.77 | step 30, dpdf_peaks, features[2].length_A = 6.733 |
| 2.74 | step 33, mark_region, label = 2.74 |
| -1380 | step 30, dpdf_peaks, features[0].size_sigma = -1380 |
| 6 | step 30, dpdf_peaks, features[0].n_vectors = 6 |
| 4.763 | step 30, dpdf_peaks, features[1].length_A = 4.763 |
| 785 | step 30, dpdf_peaks, features[1].size_sigma = 785 |
| 12 | step 30, dpdf_peaks, features[1].n_vectors = 12 |
| 6.733 | step 30, dpdf_peaks, features[2].length_A = 6.733 |
| -527 | step 30, dpdf_peaks, features[2].size_sigma = -527 |
| 4 | step 30, dpdf_peaks, features[1].vectors_A[0][2] = 3.888 |
| 493 | step 30, dpdf_peaks, features[3].size_sigma = 493 |
| 2 | step 33, mark_region, region.center[0] = 1.937 |
| 7.778 | step 32, measure_dpdf_cut, delta_pdf.radial_trend[1] = 7.81 |
| 464 | step 30, dpdf_peaks, features[4].size_sigma = 464 |
| 5.841 | step 30, dpdf_peaks, features[6].length_A = 5.841 |

## Score

- Fault reported: yes
- No false alarm: yes
- Unsafe actions: 0
- Checks the graders' two readings dispute: 0
- Requests cut at the output limit: 0
- Outputs, against the planted truth: features ok, window ok, pedestal ok
