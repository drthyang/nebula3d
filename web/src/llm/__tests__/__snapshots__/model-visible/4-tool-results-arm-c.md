# Tool results and goals with the skills off (validation arm C)

Arm C's text where it differs from arm B's: the stages' goals, the results that carry inference (a goal, a criterion, a verdict's or a reading's words: inference.ts, 6-inference.md), the calls arm B's skill gate refuses, read_skill called by name, and the tuning prompt for the flatten. Each tool is called through `runToolCall` with the skills' switch off (`skills: false` in its context) and the tools `toolsWithSkills(CHAT_TOOLS, false)` gives; every other sampled result reads as in 4-tool-results.md.

Update from web/: `npx vitest run src/llm/__tests__/modelVisible.test.ts -u`, then read the diff.

## The stages' goals with the skills off

`STAGE_GOALS_WITHOUT_SKILLS` (tune/prompts.ts; `WORDS.goalWithoutSkills`, verdicts/rules.ts): in assess_stage's single-stage result and the tuning prompts.

### rings

```text
Remove powder/Al rings: mean_ring_energy_ratio as low as the trials reach on every plane (its floor is set by the diffuse, not 0; near 0.4–0.5 can be ring-free), while over_subtraction_fraction and after_negative_fraction stay small (a few percent from noise), and each raw ring ends level with the diffuse beside it: max_ring_dent (how far the deepest ring sits below its flanks, a share of the diffuse there) and max_ring_left (a ring left over) both 0: they count only residuals beyond 3 × their plane's noise_fraction, so any value above 0 is a real dent or leftover (worst_ring_dent and worst_ring_left say on which plane and at which |Q|). A bump counts only if it is a powder ring, rising in nearly every direction over the sphere (shells_judged); the others are the crystal's own scattering, which the removal must leave and subtracts nothing from (per_plane marks them ring: false, out of its worst_ring_dent and worst_ring_left). Lower ring energy bought by over-subtracting (negatives or ring dents rising) is worse, not better.
```

### punch

```text
Remove every sharp peak that should go while punching as little as possible (punched_fraction small): every punched voxel is diffuse signal thrown away and later backfilled. Missed lattice peaks (leftover_at_nodes) must reach 0 on every plane; off-lattice sharp peaks (leftover_off_lattice) the search punches unless their H planes are protected: leftover_on_protected_planes of them sit on protected planes and stay by design (whether they are real is the user's call), while the rest are peaks the search left, so fewer of those is better where they are spurious. leftover_off_lattice splits into leftover_off_lattice_sharp (punch candidates) and leftover_off_lattice_broad (FWHM ≥ 5 voxels along a slice axis). Fewer leftovers win only if the punched fraction does not grow substantially; lowering the significance or the search floor punches noise and diffuse maxima, raising them leaves weak peaks.
```

### backfill

```text
Fill punched holes seamlessly: median_seam_sigma ≲ 1, bright_fill_fraction small, checkerboard_fraction near 0.5.
```

### flatten

```text
Bring the per-|Q|-shell floor to about 0 and level across |Q| (floor_after near 0 in all thirds) without over-subtracting (floors well below 0), and leave no pedestal: max_floor_trend (|rank correlation| of the floors with |Q|, over the outer half of the shells the counts reach) well below 1 and max_floor_span_fraction well below 1 (pedestal_left false). after_floor_max_sigma is the floors in the cut's own σ, which the diffuse sets: it reads above 1 on sound flattens and is no goal by itself.
```

### pdf

```text
The ΔPDF must show features above noise (feature_snr) with the transform's reach inside the measured coverage: window_weight_on_unmeasured, the share of the window's weight on unmeasured reciprocal space, must stay at or below 1e-3, where the backend's own window keeps it (a trial past it is not a candidate). max_symmetry_break is the x–y section's largest RMS difference from its image under the cell's in-plane operations (worst_symmetry_op names it). back_fft_pearson_r_even, the round trip against the data's even part under Q → −Q (what the real transform keeps), must stay near 1; back_fft_pearson_r against the data is lower by the odd part (back_fft_odd_share, counting noise on unsymmetrised data). Without a band or crop the round trip is the identity, so neither can rank trials. Apodization trades real-space resolution against truncation ripples; prefer the default unless another is clearly better on feature_snr without the reach leaving the coverage.
```

# The results that read otherwise

## assess_stage {}

```json
{
  "rings": {
    "verdict": "needs attention",
    "criterion": "No powder ring left above, or dented below, three times its plane's noise. A bump is a powder ring only if it rises in nearly every direction over the sphere (at least 0.15 of its median height in 90 % of directions).",
    "headline": "ring ratio 0.23 · over-sub ≤ 0 · ring dent ≤ 0 · left ≤ 0.125 (0kl, 3.2 Å⁻¹)",
    "mean_ring_energy_ratio": 0.23,
    "max_over_subtraction_fraction": 0,
    "max_ring_dent": 0,
    "max_ring_left": 0.125,
    "worst_ring_dent": null,
    "worst_ring_left": {
      "plane": "0kl",
      "at": 3.2,
      "residual_fraction": 0.125
    },
    "ring_rule": {
      "direction_share": 0.9,
      "height_share": 0.15
    },
    "shells_judged": [
      {
        "at": 0.911,
        "ring": false,
        "isotropy": 0.04
      },
      {
        "at": 1.43,
        "ring": false,
        "isotropy": 0.04
      },
      {
        "at": 3.2,
        "ring": true,
        "isotropy": 0.86
      },
      {
        "at": 3.93,
        "ring": false,
        "isotropy": 0.04
      }
    ]
  },
  "punch": {
    "verdict": "needs attention",
    "criterion": "No Bragg peak missed at a lattice node, and no sharp peak left off the lattice outside the protected planes. Broad maxima stay.",
    "headline": "1 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.03",
    "total_leftover_peaks": 1,
    "leftover_at_nodes": 1,
    "leftover_off_lattice": 0,
    "leftover_on_protected_planes": 0,
    "leftover_on_protected_planes_sharp": 0,
    "leftover_off_lattice_broad": 0,
    "leftover_off_lattice_sharp": 0,
    "strongest_leftover": {
      "plane": "hk0",
      "xy": [2, 1],
      "intensity": 452,
      "local_background": 21.3,
      "contrast": 21.2,
      "sigma": 374,
      "fwhm_voxels": [1, 1],
      "broad": false,
      "hkl": [2, 1, 0],
      "at_node": true
    },
    "noisy_spikes_skipped": 0,
    "mean_punched_fraction": 0.03,
    "fitted_peaks": 14
  },
  "backfill": {
    "verdict": "meets its goal",
    "criterion": "The fills meet their surroundings: a median seam of 1σ or less.",
    "headline": "seam 0.218σ · bright ≤ 0",
    "mean_median_seam_sigma": 0.218,
    "max_bright_fill_fraction": 0
  },
  "flatten": {
    "verdict": "meets its goal",
    "criterion": "No pedestal: a floor trend and a span both 0.8 or more over the outer half of the |Q| shells the counts reach. The largest floor in σ is reported, not judged: σ is the cut's own spread, and the floors follow the diffuse level (the 1σ limit dropped at the user's choice, 2026-10-17; provisional).",
    "headline": "floor ≤ 2.78σ · trend ≤ 0.333 · span ≤ 0.17 · no pedestal",
    "max_after_floor_sigma": 2.78,
    "max_floor_trend": 0.333,
    "max_floor_span_fraction": 0.17,
    "pedestal_left": false
  },
  "pdf": {
    "verdict": "meets its goal",
    "criterion": "The back-FFT reproduces what the transform keeps, the data's even part under Q → −Q, to an r of 0.999 or more (a check recorded without that comparison: r against the data, judged only on data the file declares symmetrised, where the two are the same); at most 1e-3 of the window's weight on unmeasured space; and the declared symmetry kept.",
    "headline": "r 0.99714 (even part 1) · RMS 0.07132 · SNR 252 · unmeasured 2.4e-4 · symmetry off ≤ 0",
    "back_fft_pearson_r": 0.99714,
    "back_fft_normalized_rms": 0.07132,
    "back_fft_pearson_r_even": 1,
    "back_fft_odd_share": 0.00421,
    "back_fft_per_plane_r": {
      "+0.000": 0.99691
    },
    "mean_feature_snr": 252,
    "window_weight_on_unmeasured": 0.00024,
    "window_shape": "ellipsoid",
    "max_symmetry_break": 0,
    "worst_symmetry_op": "mirror ⊥ a",
    "symmetry_declared": true
  },
  "measured_on": ["H–K plane at L = 0", "H–L plane at K = 0", "K–L plane at H = 0"]
}
```

## assess_stage {"stage":"flatten"}

```json
{
  "flatten": {
    "verdict": "meets its goal",
    "criterion": "No pedestal: a floor trend and a span both 0.8 or more over the outer half of the |Q| shells the counts reach. The largest floor in σ is reported, not judged: σ is the cut's own spread, and the floors follow the diffuse level (the 1σ limit dropped at the user's choice, 2026-10-17; provisional).",
    "headline": "floor ≤ 2.78σ · trend ≤ 0.333 · span ≤ 0.17 · no pedestal",
    "max_after_floor_sigma": 2.78,
    "max_floor_trend": 0.333,
    "max_floor_span_fraction": 0.17,
    "pedestal_left": false,
    "per_plane": {
      "hk0": {
        "removed_fraction": 0.859,
        "floor_before": [17.6, 19.8, 21.2],
        "floor_after": [1.03, 1.98, 1.43],
        "after_floor_max_sigma": 1.79,
        "after_negative_fraction": 0.0124,
        "floor_trend": 0.333,
        "floor_span_fraction": 0.155,
        "floor_judged_q": [2.11, 4.11]
      },
      "h0l": {
        "removed_fraction": 0.9,
        "floor_before": [17, 19.2, 20.5],
        "floor_after": [0.44, 1.32, 0.721],
        "after_floor_max_sigma": 2.74,
        "after_negative_fraction": 0.056,
        "floor_trend": 0.103,
        "floor_span_fraction": 0.167,
        "floor_judged_q": [2.11, 4.11]
      },
      "0kl": {
        "removed_fraction": 0.9,
        "floor_before": [17, 19.1, 20.5],
        "floor_after": [0.427, 1.33, 0.717],
        "after_floor_max_sigma": 2.78,
        "after_negative_fraction": 0.0544,
        "floor_trend": 0.224,
        "floor_span_fraction": 0.17,
        "floor_judged_q": [2.11, 4.11]
      }
    },
    "goal": "Bring the per-|Q|-shell floor to about 0 and level across |Q| (floor_after near 0 in all thirds) without over-subtracting (floors well below 0), and leave no pedestal: max_floor_trend (|rank correlation| of the floors with |Q|, over the outer half of the shells the counts reach) well below 1 and max_floor_span_fraction well below 1 (pedestal_left false). after_floor_max_sigma is the floors in the cut's own σ, which the diffuse sets: it reads above 1 on sound flattens and is no goal by itself."
  },
  "measured_on": ["H–K plane at L = 0", "H–L plane at K = 0", "K–L plane at H = 0"]
}
```

## dpdf_peaks {}

```json
{
  "features": [
    {
      "sign": "−",
      "length_A": 4,
      "size_sigma": 35.2,
      "n_vectors": 3,
      "vectors_rlu": [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1]
      ],
      "vectors_A": [
        [4, 0, 0],
        [0, 4, 0],
        [0, 0, 4]
      ]
    },
    {
      "sign": "+",
      "length_A": 5.657,
      "size_sigma": 21.1,
      "n_vectors": 6,
      "vectors_rlu": [
        [1, 1, 0],
        [1, -1, 0],
        [1, 0, 1],
        [1, 0, -1]
      ],
      "vectors_A": [
        [4, 4, 0],
        [4, -4, 0],
        [4, 0, 4],
        [4, 0, -4]
      ]
    }
  ],
  "robust_sigma": 0.71,
  "threshold_sigma": 5,
  "origin_disk_A": 1.8,
  "extrema_above_threshold": 26,
  "reading": "Each entry: the sign, |r|, the largest size in σ, how many vectors (one per ± pair) share them, and up to 4 of those vectors in lattice units (x/a, y/b, z/c) and in Å along a, b, c. The size is against the volume's robust σ outside the origin's disk."
}
```

## grain_check {}

```json
{
  "off_lattice_orbits": 7,
  "judged": 7,
  "near_bragg_nodes": 0,
  "near_offset_angle_deg": null,
  "far": [
    {
      "hkl": [1.5, 0.5, 0],
      "q": 2.484,
      "offset_q": 1.111
    },
    {
      "hkl": [0.5, 1.5, 0],
      "q": 2.484,
      "offset_q": 1.111
    },
    {
      "hkl": [2.5, 0.5, 0],
      "q": 4.005,
      "offset_q": 1.111
    },
    {
      "hkl": [0.5, 2.5, 0],
      "q": 4.005,
      "offset_q": 1.111
    },
    {
      "hkl": [1.5, 1.5, 0],
      "q": 3.332,
      "offset_q": 1.111
    },
    {
      "hkl": [0.5, 0.5, 1],
      "q": 1.924,
      "offset_q": 1.111
    },
    {
      "hkl": [1.5, 0.5, 1],
      "q": 2.939,
      "offset_q": 1.111
    }
  ],
  "rotated_copy": {
    "indexed": 0,
    "misorientation_deg": null
  },
  "random_control": 0,
  "verdict": "no second grain of this phase: a rotated copy of the Bragg lattice indexes only 0 of the 7 strongest off-lattice orbits (random directions: 0). 7 lie farther from any node",
  "off_lattice_peaks": 8,
  "declared_symmetry": "mmm",
  "punch_cell": [1, 1, 1]
}
```

# The calls arm B's gate refuses, and read_skill

## update_settings {"changes":{"flattenQ2":true}}

No skill read: arm B's gate refuses it until reduction-qc is read (4-tool-results.md); arm C has none.

```json
{
  "changed": [
    {
      "setting": "flattenQ2",
      "from": false,
      "to": true
    }
  ],
  "rerun_from": "flatten"
}
```

## tune_pipeline {"stages":["punch"],"trials_per_stage":2} (a stubbed tuning run of 5.2 min, no skill read)

No skill read: it runs, and passes the switch on to the tuning prompts.

```json
{
  "minutes": 5.2,
  "stages": [
    {
      "stage": "punch",
      "status": "done",
      "tuned": true,
      "chosen_trial": 2,
      "of": 2,
      "changes": {
        "punchMinSig": 4
      },
      "result": "0 missed at nodes · 0 sharp off-lattice · 2 broad maxima kept · punched 0.033",
      "trials": [
        {
          "n": 1,
          "changes": {},
          "result": "1 missed at nodes · 0 sharp off-lattice · 2 broad maxima kept · punched 0.031"
        },
        {
          "n": 2,
          "changes": {
            "punchMinSig": 4
          },
          "result": "0 missed at nodes · 0 sharp off-lattice · 2 broad maxima kept · punched 0.033"
        }
      ],
      "why": "Trial 2 punched the missed node (1 → 0 at nodes) for 0.002 more punched fraction."
    }
  ],
  "note": "Done. The punch's settings changed; run the pipeline from the punch to write them.",
  "write_outputs_with": {
    "tool": "run_pipeline",
    "from_stage": "punch"
  }
}
```

## read_skill {"name":"reduction-qc"} (called by name: it is not offered)

```text
Error: no tool named read_skill. Available: describe_dataset, current_view, measure_reciprocal_cut, measure_dpdf_cut, assess_stage, texture_check, qmax_coverage, symmetry_check, dpdf_contrast, dpdf_peaks, grain_check, ub_check, radial_profile, line_profile, bragg_peaks, consistency_details, run_log, compare_datasets, configure_settings, update_settings, run_pipeline, tune_pipeline, show_in_viewer
```

## The tuning prompt for the flatten, what to try

`buildProposeMessages({ stage: "flatten", …, skills: false })` with a synthetic trial: the goal and the settings' help with the skills off. The system message is TUNE_SYSTEM (3-tuning-prompts.md).

```text
Stage: Flatten.
Goal: Bring the per-|Q|-shell floor to about 0 and level across |Q| (floor_after near 0 in all thirds) without over-subtracting (floors well below 0), and leave no pedestal: max_floor_trend (|rank correlation| of the floors with |Q|, over the outer half of the shells the counts reach) well below 1 and max_floor_span_fraction well below 1 (pedestal_left false). after_floor_max_sigma is the floors in the cut's own σ, which the diffuse sets: it reads above 1 on sound flattens and is no goal by itself.

Settings you may change (use these names exactly):
- flattenQ2 (true | false; default false): model only: also fit b·Q², the smooth rise of an inelastic background (thermal diffuse; with X-rays also Compton); it varies too slowly to follow pair correlations.
- flattenFitQMax (number in [3, 25]; default 10): model only: end (Å⁻¹) of the |Q| range the model is fitted to (from 0.8).
- flattenEstimator (one of model | floor | snip; default model): Pedestal estimator. model (default): a fitted const (+ c·F(Q)² when a magnetic ion is set) on the per-shell low floors. floor: the floors themselves. snip: a SNIP background.

Current settings: {"flattenQ2":false,"flattenFitQMax":10,"flattenEstimator":"model"}
Settings already chosen for earlier stages: {}
Trials so far (trial 1 = the current settings): [{"trial":1,"settings":{"flattenQ2":false,"flattenFitQMax":10,"flattenEstimator":"model"},"metrics":{"max_floor_trend":0.97,"max_floor_span_fraction":1.2,"pedestal_left":true}}]

Propose up to 2 new settings to try, each different from every trial so far and
each changing as few settings as possible, with a one-sentence reason tied to the metrics.
Reply as {"candidates": [{"changes": {"<setting>": <value>}, "why": "<reason>"}]}.
If the current settings already meet the goal, reply {"candidates": []}.
```
