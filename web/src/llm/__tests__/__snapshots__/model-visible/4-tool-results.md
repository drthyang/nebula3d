# Tool results

Each tool called through `runToolCall` (tools/index.ts) against the synthetic crystal, and the text the model reads back: `ToolRun.text`, after `fitResult` trims a long result to valid JSON. JSON is shown indented; the model reads it on one line, as `JSON.stringify` writes it.

Update from web/: `npx vitest run src/llm/__tests__/modelVisible.test.ts -u`, then read the diff.

## read_skill {"name":"bragg-node-audit"}

5304 characters sent.

```text
Skill bragg-node-audit

# Bragg-node audit

**Status:** Draft: awaiting the user's interview (questions in
`docs/SKILL_INTERVIEWS.md`). Ported from the scattering-agent-tools plugin
skill of the same name, from its NeXus Viewer and NEXPLAN tools to the
console's own.

The punch removes what sits at the Bragg nodes, so the 3D-ΔPDF sees only the
diffuse scattering. An audit checks the nodes the cell allows, the nodes it
forbids and the peaks off every node, and keeps the broad diffuse maxima out of
all three.

## Steps

1. **Settle the nodes.** `describe_dataset` and `configure_settings`: the cell,
   the symmetry the file declares, the punch cell (`punchSupercellH/K/L`:
   Bragg nodes every n along H, K and L, for a volume indexed on a supercell)
   and the search's protected H planes. These are facts about the sample, set
   only when the user asks. `describe_dataset` and `configure_settings` do not
   give the declared symmetry: `grain_check` does (`declared_symmetry`). Which
   cell is the parent, and whether the supercell's other nodes hold Bragg peaks
   or diffuse scattering (to confirm with the user).
2. **The punch on three planes.** `assess_stage` for the punch: the peaks left
   at nodes, the sharp peaks off the lattice, the broad maxima kept, and how
   much was punched to get there. It reads the planes through the origin:
   check an off-zero cut too, with `measure_reciprocal_cut`.
3. **Leftovers at allowed nodes.** Look at each (`show_in_viewer`,
   `line_profile`). A real leftover is sharp and stands above its own
   neighbourhood; widen or deepen the punch only for those.
4. **Forbidden nodes.** Intensity clearly above the local background at a node
   the space group forbids has several causes. Say which evidence points where,
   and do not pick one without it:
   - λ/2 contamination: is the 2h 2k 2l reflection strong?
   - multiple scattering: sharp, and often only some members of an orbit;
   - a lower true symmetry, or a superlattice.

   What counts as clearly above the background (to confirm with the user).
5. **Peaks off the lattice.** `grain_check`: the off-lattice peaks the punch's
   search found, grouped into symmetry orbits, tested against the nodes (a
   Bragg peak displaced by a UB that is slightly off) and as a rotated copy of
   the lattice (a second grain), judged against the same search at random
   directions; the test against the nodes has no such control. A rotation
   under 2° is the UB, not a grain: check it with `ub_check` (reduction-qc).
   The leftover counts are only what the punch missed on one cut, never what
   its search found.
6. **Broad maxima stay.** A maximum several Bragg widths broad along any axis
   is diffuse scattering, the signal. Never report it as a missed peak. The
   search's width limit (`punchSearchMaxWidth`) leaves such maxima unpunched,
   but it is off by default: then the search punches every candidate, broad
   or sharp.
7. **The backfill.** `texture_check`: no cut whose fills sit systematically
   outside the range their rims allow, and an azimuthal ratio near 1. The
   diffuse often peaks at the nodes (thermal diffuse scattering), so a sound
   fill sits above its rim's median; the range runs from the diffuse at the
   hole's edge to its rise continued to the node, and a bias counts only when
   it is also a fifth of the local diffuse level or more. A lattice-periodic
   fill pattern is texture that the 3D-ΔPDF will show.
8. **Report** (below).

## Firm rules (enforced in code)

- Changing a punch or backfill setting, or tuning those stages, is refused
  until this skill has been read in the conversation.
- The protected H planes and the punch cell are facts about the sample: they
  change only when the user asks, never to improve a number.

## Acceptance checklist

- [ ] the cell and nodes used, and who set them;
- [ ] the leftovers at allowed nodes, on three planes and an off-zero cut;
- [ ] each forbidden-node signal with the evidence for its cause, or "not
  tested";
- [ ] the off-lattice verdict from `grain_check`, with the offset angle when
  Bragg peaks are displaced;
- [ ] broad maxima counted apart from missed peaks;
- [ ] the backfill's texture verdict;
- [ ] every number with what produced it (settings, planes).

## Failure modes

- Reading the leftover count as "no off-lattice peaks", or as everything the
  search found.
- Calling broad short-range-order maxima missed Bragg peaks, and widening the
  punch until they are gone.
- Naming a second grain from displaced Bragg peaks without `grain_check`.
- Changing the protected planes or the punch cell to make a number look better.
- Judging from the opening cut at L = 0 alone.

## What to report

The audit in the order above. For each signal, the evidence and its likely
cause, or that it was not tested; what to change and why; and what only the
user can decide (the cell, the satellites, the protected planes).

## References

- [bragg_cleanup](../../../docs/algorithms/bragg_cleanup.md) — the punch: node
  detection, the off-lattice search, footprints, the significance gate and the
  backfill

---
References of this skill (read one with read_skill and `reference`):
- bragg_cleanup: the punch: node detection, the off-lattice search, footprints, the significance gate and the backfill
```

## describe_dataset {}

473 characters sent.

```json
{
  "dataset": "synthetic_a",
  "id": "synthetic_a",
  "stages": ["raw", "ringremoved", "braggpunched", "backfilled", "flattened", "delta_pdf"],
  "reciprocal": {
    "grid": [97, 97, 97],
    "H": [-3, 3],
    "K": [-3, 3],
    "L": [-3, 3],
    "planes": ["hk0", "h0l", "0kl"]
  },
  "cell": {
    "a": 4,
    "b": 4,
    "c": 4,
    "alpha": 90,
    "beta": 90,
    "gamma": 90
  },
  "sigma": "measured",
  "delta_pdf": {
    "grid": [49, 49, 49],
    "x": [-12, 12],
    "y": [-12, 12],
    "z": [-12, 12],
    "q_max": 8.162,
    "planes": ["xy", "xz", "yz"]
  },
  "other_datasets": [
    {
      "id": "synthetic_b",
      "label": "synthetic_b"
    }
  ]
}
```

## current_view {}

151 characters sent.

```json
{
  "page": "reciprocal",
  "dataset": "synthetic_a",
  "reciprocal_cut": {
    "plane": "hk0",
    "value": 0,
    "label": "H–K plane at L = 0"
  },
  "dpdf_cuts_A": {
    "x": 0,
    "y": 0,
    "z": 4
  }
}
```

## measure_reciprocal_cut {"plane":"h0l","value":1}

1487 characters sent.

```json
{
  "cut": "H–L plane at K = 1",
  "ring_removal": {
    "before_ring_energy": 0.0866,
    "after_ring_energy": 0.0167,
    "ring_energy_ratio": 0.193,
    "over_subtraction_fraction": 0,
    "after_negative_fraction": 0,
    "ring_residuals": [
      {
        "at": 1.79,
        "fwhm": 0.11,
        "residual_fraction": 0.0718,
        "noise_fraction": 0.00937,
        "significant": true
      },
      {
        "at": 3.18,
        "fwhm": 0.16,
        "residual_fraction": 0.124,
        "noise_fraction": 0.0161,
        "significant": true
      }
    ],
    "worst_ring_dent": null,
    "worst_ring_left": {
      "at": 3.18,
      "fwhm": 0.16,
      "residual_fraction": 0.124,
      "noise_fraction": 0.0161,
      "significant": true
    },
    "suggested_display_vmax": 73.43,
    "n_finite": 5497
  },
  "bragg_punch_leftover": {
    "suspicious_peaks": [
      {
        "xy": [2, 0],
        "intensity": 452,
        "local_background": 21,
        "contrast": 21.5,
        "sigma": 332,
        "fwhm_voxels": [1, 1],
        "broad": false,
        "hkl": [2, 1, 0],
        "at_node": true
      },
      {
        "xy": [1.5, -1.938],
        "intensity": 27.2,
        "local_background": 21.1,
        "contrast": 1.29,
        "sigma": 8.63,
        "fwhm_voxels": [2, 19],
        "broad": true,
        "hkl": [1.5, 1, -1.938],
        "at_node": false,
        "on_protected_plane": false
      }
    ],
    "n_suspicious": 2,
    "n_at_nodes": 1,
    "n_off_nodes": 1,
    "n_on_protected": 0,
    "n_broad_off_nodes": 1,
    "n_skipped_noisy": 0,
    "scan_sigma_threshold": 8
  },
  "backfill": {
    "n_filled": 180,
    "fill_coverage": 0.0327,
    "median_seam_sigma": 0.227,
    "p95_seam_sigma": 0.495,
    "bright_fill_fraction": 0,
    "checkerboard_fraction": 0.267
  },
  "flatten": {
    "removed_fraction": 0.907,
    "floor_before": [17.3, 20, 20.5],
    "floor_after": [0.334, 1.73, 0.546],
    "after_floor_max_sigma": 2.05,
    "after_negative_fraction": 0.0538,
    "floor_trend": 0.224,
    "floor_span_fraction": 0.125,
    "floor_judged_q": [2.17, 4.22]
  },
  "notes": []
}
```

## measure_dpdf_cut {"plane":"xz","value":0}

322 characters sent.

```json
{
  "cut": "ΔPDF x–z section at y = 0 Å",
  "delta_pdf": {
    "origin_excluded_radius": 0.6,
    "background_sigma": 0.502,
    "feature_snr": 252,
    "strong_feature_fraction": 0.0634,
    "positive_fraction": 0.763,
    "anisotropy_ratio": 1,
    "anisotropy_angle_deg": 0,
    "radial_trend": [8.68, 0.781, 0.302]
  },
  "sigma_of": "this section outside the origin's disk, robust"
}
```

## assess_stage {}

3279 characters sent.

```json
{
  "rings": {
    "verdict": "needs attention",
    "criterion": "No powder ring left above, or dented below, three times its plane's noise. A bump is a powder ring only if it rises in nearly every direction over the sphere (at least 0.15 of its median height in 90 % of directions): the crystal's own scattering at that |Q| rises in some directions only.",
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
    "criterion": "No Bragg peak missed at a lattice node, and no sharp peak left off the lattice outside the protected planes. Broad maxima are diffuse scattering, and stay.",
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
    "criterion": "The fills meet their surroundings: a median seam of 1σ or less. Whether a cut's fill is biased one way is texture_check's to say.",
    "headline": "seam 0.218σ · bright ≤ 0",
    "mean_median_seam_sigma": 0.218,
    "max_bright_fill_fraction": 0
  },
  "flatten": {
    "verdict": "meets its goal",
    "criterion": "No pedestal: the volume's floor trend and span both 0.8 or more over the outer half of the |Q| shells the counts reach. The largest floor in σ is reported, not judged: σ is the cut's own spread, and the floors follow the diffuse level.",
    "headline": "floor ≤ 2.78σ · trend 0.00268 · span 0.207 · no pedestal",
    "max_after_floor_sigma": 2.78,
    "floor_trend": 0.00268,
    "floor_span_fraction": 0.207,
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
    "worst_symmetry_op": "two-fold ∥ a / mirror ⊥ a",
    "symmetry_declared": true
  },
  "measured_on": ["H–K plane at L = 0", "H–L plane at K = 0", "K–L plane at H = 0"]
}
```

## assess_stage {"stage":"flatten"}

2044 characters sent.

```json
{
  "flatten": {
    "verdict": "meets its goal",
    "criterion": "No pedestal: the volume's floor trend and span both 0.8 or more over the outer half of the |Q| shells the counts reach. The largest floor in σ is reported, not judged: σ is the cut's own spread, and the floors follow the diffuse level.",
    "headline": "floor ≤ 2.78σ · trend 0.00268 · span 0.207 · no pedestal",
    "max_after_floor_sigma": 2.78,
    "floor_trend": 0.00268,
    "floor_span_fraction": 0.207,
    "floor_judged_q": [2.2, 4.35],
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
    "goal": "Bring the per-|Q|-shell floor to about 0 and level across |Q| (floor_after near 0 in all thirds) without over-subtracting (floors well below 0), and leave no pedestal: floor_trend (|rank correlation| of the floors with |Q|, over the outer half of the shells the counts reach) well below 1 and floor_span_fraction well below 1 (pedestal_left false). after_floor_max_sigma is the floors in the cut's own σ, which the diffuse sets: it reads above 1 on sound flattens and is no goal by itself. A trend near 1 with a span near 1 or more is a background the model missed, however small it reads in σ: a rising one wants flattenQ2 and a fit range reaching the coverage (flattenFitQMax), not a free-form estimator, which also removes isotropic pair correlations."
  },
  "measured_on": ["H–K plane at L = 0", "H–L plane at K = 0", "K–L plane at H = 0"]
}
```

## texture_check {}

802 characters sent.

```json
{
  "per_cut": [
    {
      "cut": "H–K plane at L = 0",
      "n_holes": 23,
      "median_fill_bias_sigma": 0,
      "median_fill_bias_level": 0,
      "above_fraction": 0.478,
      "below_fraction": 0.348,
      "systematic_fill_bias": false,
      "azimuthal_variation_before": 0.0691,
      "azimuthal_variation_after": 0.0703,
      "azimuthal_ratio": 1.02
    },
    {
      "cut": "H–L plane at K = 0",
      "n_holes": 24,
      "median_fill_bias_sigma": 0,
      "median_fill_bias_level": 0,
      "above_fraction": 0.458,
      "below_fraction": 0.417,
      "systematic_fill_bias": false,
      "azimuthal_variation_before": 0.0599,
      "azimuthal_variation_after": 0.0599,
      "azimuthal_ratio": 1
    },
    {
      "cut": "K–L plane at H = 0",
      "n_holes": 24,
      "median_fill_bias_sigma": 0,
      "median_fill_bias_level": 0,
      "above_fraction": 0.417,
      "below_fraction": 0.458,
      "systematic_fill_bias": false,
      "azimuthal_variation_before": 0.0587,
      "azimuthal_variation_after": 0.0587,
      "azimuthal_ratio": 1
    }
  ]
}
```

## qmax_coverage {}

1270 characters sent.

```json
{
  "verdict": "fitted to the coverage: the ΔPDF's ellipsoid window puts 2.4e-4 of its weight on unmeasured reciprocal space, which the backend keeps within 1e-3 when it fits the window to the coverage: its own target, not a check; the raw counts end at 4.4 Å⁻¹, inside the box (its nearest face at 4.712 Å⁻¹), and no |Q| band is set, so only the window's taper keeps the transform on the counts: the band they allow is 0.25–4.4 Å⁻¹ (suggested_band), the user's to set",
  "window_weight_on_unmeasured": 0.00024,
  "window_shape": "ellipsoid",
  "window_scale": 1,
  "transform_reach_q": 4.35,
  "reach_from": "an ellipsoid window inscribed in the box (its reach varies with direction; box_face_q is the nearest face)",
  "full_coverage_q": 4.35,
  "box_face_q": 4.712,
  "box_corner_q": 8.162,
  "raw_counts": {
    "q_min_edge": 0.25,
    "q_max_edge": 4.4,
    "fully_measured": [0.3, 4.35],
    "box_face_q": 4.712
  },
  "suggested_band": [0.25, 4.4],
  "counts_end_inside_box": true,
  "band_check": "no |Q| band is set: the transform takes every voxel, empty ones included, up to the window's reach; the counts end at 4.4 Å⁻¹, inside the box (face 4.712 Å⁻¹): the band they allow is 0.25–4.4 Å⁻¹",
  "q_unit": "Å⁻¹",
  "settings": {
    "pdfQMin": "(default)",
    "pdfQMax": "(default)",
    "pdfApod": "(default)",
    "pdfWindowShape": "(default)",
    "pdfWindowSupport": true
  }
}
```

## symmetry_check {}

653 characters sent.

```json
{
  "sections": "xy at z = 0 Å, xz at y = 0, yz at x = 0",
  "operations": "declared (mmm): 7 besides the identity",
  "ops": [
    {
      "op": "two-fold ∥ c / mirror ⊥ c",
      "rms_difference": 0,
      "pairs": 4608,
      "tested_on": "xz; yz"
    },
    {
      "op": "two-fold ∥ a / mirror ⊥ a",
      "rms_difference": 0,
      "pairs": 4608,
      "tested_on": "xy; xz"
    },
    {
      "op": "two-fold ∥ b / mirror ⊥ b",
      "rms_difference": 0,
      "pairs": 4608,
      "tested_on": "xy; yz"
    },
    {
      "op": "inversion",
      "rms_difference": 0,
      "pairs": 7200,
      "tested_on": "xy; xz; yz"
    }
  ],
  "holds": ["two-fold ∥ c / mirror ⊥ c", "two-fold ∥ a / mirror ⊥ a", "two-fold ∥ b / mirror ⊥ b", "inversion"],
  "symmetry_declared": true,
  "verdict": "kept: every operation tested holds to 0.001 or better"
}
```

## dpdf_contrast {}

728 characters sent.

```json
{
  "applied": {
    "limit": 127,
    "limit_sigma": 252,
    "share_of_strongest": 1,
    "coloured_fraction": 0.017,
    "from": "optimised: the 99.9th percentile of |ΔPDF|"
  },
  "robust_sigma": 0.502,
  "sigma_of": "the three sections together, outside the origin's disk, robust",
  "strongest_feature_sigma": 252,
  "not_applied": {
    "99.5th percentile": {
      "limit": 45.2,
      "limit_sigma": 90.2,
      "share_of_strongest": 0.36,
      "coloured_fraction": 0.04,
      "effect": "a lower limit: brighter, weaker correlations and more of the ripple coloured"
    },
    "99.97th percentile": {
      "limit": 127,
      "limit_sigma": 252,
      "share_of_strongest": 1,
      "coloured_fraction": 0.017,
      "effect": "a higher limit: dimmer, only the strongest features coloured"
    }
  },
  "sections": "xy, xz and yz through the origin, the origin's disk left out"
}
```

## dpdf_peaks {}

1450 characters sent.

```json
{
  "grouped_by": "declared symmetry (mmm: 8 operations, r ≡ −r)",
  "features": [
    {
      "sign": "−",
      "length_A": 4,
      "size_sigma": 35.2,
      "mean_size_sigma": 35.2,
      "n_vectors": 1,
      "multiplicity": 1,
      "vectors_rlu": [
        [1, 0, 0]
      ],
      "vectors_A": [
        [4, 0, 0]
      ]
    },
    {
      "sign": "−",
      "length_A": 4,
      "size_sigma": 35.2,
      "mean_size_sigma": 35.2,
      "n_vectors": 1,
      "multiplicity": 1,
      "vectors_rlu": [
        [0, 1, 0]
      ],
      "vectors_A": [
        [0, 4, 0]
      ]
    },
    {
      "sign": "−",
      "length_A": 4,
      "size_sigma": 35.2,
      "mean_size_sigma": 35.2,
      "n_vectors": 1,
      "multiplicity": 1,
      "vectors_rlu": [
        [0, 0, 1]
      ],
      "vectors_A": [
        [0, 0, 4]
      ]
    },
    {
      "sign": "+",
      "length_A": 5.657,
      "size_sigma": 21.1,
      "mean_size_sigma": 21.1,
      "n_vectors": 2,
      "multiplicity": 2,
      "vectors_rlu": [
        [1, 1, 0],
        [1, -1, 0]
      ],
      "vectors_A": [
        [4, 4, 0],
        [4, -4, 0]
      ]
    },
    {
      "sign": "+",
      "length_A": 5.657,
      "size_sigma": 21.1,
      "mean_size_sigma": 21.1,
      "n_vectors": 2,
      "multiplicity": 2,
      "vectors_rlu": [
        [1, 0, 1],
        [1, 0, -1]
      ],
      "vectors_A": [
        [4, 0, 4],
        [4, 0, -4]
      ]
    },
    {
      "sign": "+",
      "length_A": 5.657,
      "size_sigma": 21.1,
      "mean_size_sigma": 21.1,
      "n_vectors": 2,
      "multiplicity": 2,
      "vectors_rlu": [
        [0, 1, 1],
        [0, 1, -1]
      ],
      "vectors_A": [
        [0, 4, 4],
        [0, 4, -4]
      ]
    }
  ],
  "robust_sigma": 0.71,
  "threshold_sigma": 5,
  "origin_disk_A": 1.8,
  "extrema_above_threshold": 26,
  "reading": "Each entry: the sign, |r|, the largest size in σ, how many vectors (one per ± pair) share them, and up to 4 of those vectors in lattice units (x/a, y/b, z/c) and in Å along a, b, c. The size is against the volume's robust σ outside the origin's disk; features nearer the origin than the shortest interatomic distance are not pair correlations."
}
```

## grain_check {}

824 characters sent.

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
  "verdict": "no second grain of this phase: a rotated copy of the Bragg lattice indexes only 0 of the 7 strongest off-lattice orbits (random directions: 0). 7 lie farther from any node; their origin is open (another phase, multiple scattering, or an artefact)",
  "off_lattice_peaks": 8,
  "declared_symmetry": "mmm",
  "punch_cell": [1, 1, 1]
}
```

## ub_check {}

956 characters sent.

```json
{
  "fit": "both",
  "bragg_nodes_every": [1, 1, 1],
  "symmetry_from": "synthetic_a.nxs",
  "symmetrised": false,
  "symmetry_break": 0.0012,
  "peaks": {
    "searched": 130,
    "used": 112,
    "rejected": 8
  },
  "rms_start": 0.0123,
  "rms": 0.0119,
  "cell_start": "4.0000, 4.0000, 4.0000 Å; 90.000°, 90.000°, 90.000°",
  "cell": "4.0012, 4.0009, 3.9994 Å; 90.010°, 89.990°, 90.000°",
  "orientation_change_deg": 0.003,
  "axis_uvw": [0.12, -0.31, 0.94],
  "transform_diagonal": [0.9997, 0.9998, 1.0002],
  "passes": [
    {
      "q_max": 4.4,
      "found": 120,
      "used": 112,
      "rms": "0.0123 → 0.0119"
    }
  ],
  "radial": [
    {
      "q": "0–2",
      "direction": "in-plane",
      "n": 40,
      "before": 0.0004,
      "after": 0.0001
    },
    {
      "q": "≥ 2",
      "direction": "oblique",
      "n": 72,
      "before": 0.0003,
      "after": -0.0001
    }
  ],
  "unexplained": false,
  "mean_offset_rlu": {
    "before": [0.0011, -0.0007, 0.0002],
    "after": [0.0009, -0.0006, 0.0002],
    "standard_error": [0.0008, 0.0008, 0.0009]
  },
  "origin_shift_rlu": null,
  "reading": "The rotation and the cell were fitted together, the cell constrained by the operations synthetic_a.nxs declares."
}
```

## radial_profile {}

2096 characters sent.

```json
{
  "cut": "H–K plane at L = 0",
  "q_unit": "|Q| in Å⁻¹",
  "stat": "median per shell",
  "rows": [
    {
      "q": 0.345,
      "raw": 16.7,
      "ringremoved": 16.7,
      "braggpunched": 16.7,
      "backfilled": 16.7,
      "flattened": 0.646
    },
    {
      "q": 0.531,
      "raw": 17.5,
      "ringremoved": 17.4,
      "braggpunched": 17.4,
      "backfilled": 17.4,
      "flattened": 1.34
    },
    {
      "q": 0.73,
      "raw": 20,
      "ringremoved": 19.9,
      "braggpunched": 19.9,
      "backfilled": 19.9,
      "flattened": 3.75
    },
    {
      "q": 0.933,
      "raw": 20.8,
      "ringremoved": 20.7,
      "braggpunched": 20.7,
      "backfilled": 20.7,
      "flattened": 4.46
    },
    {
      "q": 1.14,
      "raw": 18.4,
      "ringremoved": 18.4,
      "braggpunched": 18.4,
      "backfilled": 18.4,
      "flattened": 2
    },
    {
      "q": 1.35,
      "raw": 18.2,
      "ringremoved": 18.1,
      "braggpunched": 18.1,
      "backfilled": 18.1,
      "flattened": 1.65
    },
    {
      "q": 1.55,
      "raw": 18.8,
      "ringremoved": 18.7,
      "braggpunched": 18.5,
      "backfilled": 18.3,
      "flattened": 1.68
    },
    {
      "q": 1.76,
      "raw": 18.5,
      "ringremoved": 18.3,
      "braggpunched": 18.2,
      "backfilled": 18.1,
      "flattened": 1.32
    },
    {
      "q": 1.98,
      "raw": 18.6,
      "ringremoved": 18.4,
      "braggpunched": 18.4,
      "backfilled": 18.4,
      "flattened": 1.39
    },
    {
      "q": 2.19,
      "raw": 19.8,
      "ringremoved": 19.5,
      "braggpunched": 19.3,
      "backfilled": 19.2,
      "flattened": 2
    },
    {
      "q": 2.39,
      "raw": 22.5,
      "ringremoved": 21.9,
      "braggpunched": 21.7,
      "backfilled": 21.4,
      "flattened": 3.94
    },
    {
      "q": 2.6,
      "raw": 21.4,
      "ringremoved": 20.5,
      "braggpunched": 20.5,
      "backfilled": 20.5,
      "flattened": 2.81
    },
    {
      "q": 2.81,
      "raw": 23.4,
      "ringremoved": 20.9,
      "braggpunched": 20.9,
      "backfilled": 20.9,
      "flattened": 2.88
    },
    {
      "q": 3.02,
      "raw": 30.3,
      "ringremoved": 21.9,
      "braggpunched": 21.8,
      "backfilled": 21.8,
      "flattened": 3.47
    },
    {
      "q": 3.22,
      "raw": 46.7,
      "ringremoved": 23.8,
      "braggpunched": 23.7,
      "backfilled": 23.6,
      "flattened": 5.04
    },
    {
      "q": 3.43,
      "raw": 28.5,
      "ringremoved": 21.5,
      "braggpunched": 21.3,
      "backfilled": 21.2,
      "flattened": 2.27
    },
    {
      "q": 3.64,
      "raw": 23.3,
      "ringremoved": 21.5,
      "braggpunched": 21.3,
      "backfilled": 21.2,
      "flattened": 1.86
    },
    {
      "q": 3.85,
      "raw": 23.3,
      "ringremoved": 22.4,
      "braggpunched": 22.4,
      "backfilled": 22.4,
      "flattened": 2.73
    },
    {
      "q": 4.06,
      "raw": 23.8,
      "ringremoved": 23.3,
      "braggpunched": 23.3,
      "backfilled": 23.3,
      "flattened": 3.17
    },
    {
      "q": 4.26,
      "raw": 23.8,
      "ringremoved": 23.5,
      "braggpunched": 23.5,
      "backfilled": 23.5,
      "flattened": 2.81
    },
    {
      "q": 4.38,
      "raw": 25.3,
      "ringremoved": 25.1,
      "braggpunched": 24.9,
      "backfilled": 24.7,
      "flattened": 3.92
    }
  ]
}
```

## line_profile {"stage":"flattened","along":"H","at":{"K":0.5,"L":0}}

905 characters sent.

```json
{
  "stage": "flattened",
  "along": "H",
  "through": {
    "K": 0.5,
    "L": 0
  },
  "units": "r.l.u.",
  "points": [
    [-2.969, null],
    [-2.844, null],
    [-2.719, 6.622],
    [-2.594, 8.153],
    [-2.469, 11.44],
    [-2.344, 7.508],
    [-2.219, 6.394],
    [-2.094, 8.322],
    [-1.969, 10.17],
    [-1.844, 7.246],
    [-1.719, 7.097],
    [-1.594, 9.19],
    [-1.469, 10.75],
    [-1.344, 7.5],
    [-1.219, 6.923],
    [-1.094, 6.189],
    [-0.9688, 5.64],
    [-0.8438, 6.892],
    [-0.7188, 6.828],
    [-0.5938, 8.334],
    [-0.4688, 10.78],
    [-0.3438, 7.559],
    [-0.2188, 6.202],
    [-0.09375, 6.281],
    [0.03125, 6.54],
    [0.1563, 6.198],
    [0.2813, 6.139],
    [0.4063, 9.249],
    [0.5313, 10.89],
    [0.6563, 6.882],
    [0.7813, 7.13],
    [0.9063, 6.414],
    [1.031, 5.88],
    [1.156, 6.348],
    [1.281, 7.105],
    [1.406, 8.641],
    [1.531, 10.34],
    [1.656, 8.051],
    [1.781, 7.105],
    [1.906, 8.408],
    [2.031, 9.812],
    [2.156, 7.178],
    [2.281, 6.648],
    [2.406, 8.818],
    [2.531, 11.2],
    [2.656, 7.16],
    [2.781, 6.006],
    [2.906, null],
    [3, null]
  ],
  "max": {
    "at": -2.5,
    "value": 12.68
  },
  "min": {
    "at": -0.9375,
    "value": 5.539
  },
  "median": 7.169,
  "masked_fraction": 0.0825
}
```

## bragg_peaks {}

2071 characters sent.

```json
{
  "n_peaks": 14,
  "punch_frame": "spherical",
  "sorted_by": "significance",
  "peaks": [
    {
      "hkl": [1, 0, 0],
      "q": 1.571,
      "intensity": 1250,
      "local_background": 16,
      "significance": 310,
      "measured_width_q": [0.094, 0.094, 0.11],
      "resolution_limited": [true, true, false],
      "anisotropy": 1.17,
      "fit": "covariance"
    },
    {
      "hkl": [0, 1, 0],
      "q": 1.571,
      "intensity": 1240,
      "local_background": 16,
      "significance": 305,
      "measured_width_q": [0.094, 0.094, 0.11],
      "resolution_limited": [true, true, false],
      "anisotropy": 1.17,
      "fit": "covariance"
    },
    {
      "hkl": [1, 1, 0],
      "q": 2.221,
      "intensity": 1060,
      "local_background": 16,
      "significance": 262,
      "measured_width_q": [0.094, 0.094, 0.11],
      "resolution_limited": [true, true, false],
      "anisotropy": 1.17,
      "fit": "covariance"
    },
    {
      "hkl": [1, 1, 1],
      "q": 2.721,
      "intensity": 900,
      "local_background": 16,
      "significance": 221,
      "measured_width_q": [0.094, 0.094, 0.11],
      "resolution_limited": [true, true, false],
      "anisotropy": 1.17,
      "fit": "covariance"
    },
    {
      "hkl": [2, 0, 0],
      "q": 3.142,
      "intensity": 760,
      "local_background": 16,
      "significance": 188,
      "measured_width_q": [0.094, 0.094, 0.11],
      "resolution_limited": [true, true, false],
      "anisotropy": 1.17,
      "fit": "covariance"
    },
    {
      "hkl": [2, 1, 0],
      "q": 3.512,
      "intensity": 640,
      "local_background": 16,
      "significance": 160,
      "measured_width_q": [0.094, 0.094, 0.11],
      "resolution_limited": [true, true, false],
      "anisotropy": 1.17,
      "fit": "covariance"
    },
    {
      "hkl": [1.5, 0.5, 0],
      "q": 2.483,
      "intensity": 96,
      "local_background": 16,
      "significance": 22,
      "measured_width_q": [0.157, 0.141, 0.188],
      "resolution_limited": [false, false, false],
      "anisotropy": 1.33,
      "fit": "covariance"
    },
    {
      "hkl": [0.5, 1.5, 0],
      "q": 2.483,
      "intensity": 94,
      "local_background": 16,
      "significance": 21,
      "measured_width_q": [0.157, 0.141, 0.188],
      "resolution_limited": [false, false, false],
      "anisotropy": 1.33,
      "fit": "covariance"
    },
    {
      "hkl": [1.5, -0.5, 0],
      "q": 2.483,
      "intensity": 90,
      "local_background": 16,
      "significance": 20,
      "measured_width_q": [0.157, 0.141, 0.188],
      "resolution_limited": [false, false, false],
      "anisotropy": 1.33,
      "fit": "covariance"
    },
    {
      "hkl": [2.5, 0.5, 0],
      "q": 4.005,
      "intensity": 61,
      "local_background": 16,
      "significance": 14,
      "measured_width_q": [0.157, 0.141, 0.188],
      "resolution_limited": [false, false, false],
      "anisotropy": 1.33,
      "fit": "covariance"
    }
  ]
}
```

## consistency_details {}

253 characters sent.

```json
{
  "pearson_r": 0.9971,
  "normalized_rms": 0.07132,
  "rms": 0.512,
  "n_voxels": 117649,
  "per_plane_r": {
    "+0.000": 0.9969
  },
  "q_band": null,
  "crop_hkl": null,
  "apodization": "gaussian",
  "pearson_r_even": 1,
  "normalized_rms_even": 2.1e-7,
  "odd_share": 0.00421,
  "n_voxels_even": 117649
}
```

## run_log {}

522 characters sent.

```json
{
  "ended": "done",
  "lines": [
    {
      "stage": "rings",
      "status": "skip",
      "message": "ring-removed output exists"
    },
    {
      "stage": "punch",
      "status": "start",
      "message": "Bragg punch"
    },
    {
      "stage": "punch",
      "status": "done",
      "message": "13 peaks punched, 1 below the significance gate"
    },
    {
      "stage": "backfill",
      "status": "done",
      "message": "13 holes filled"
    },
    {
      "stage": "flatten",
      "status": "done",
      "message": "floor fitted on 32 shells"
    },
    {
      "stage": "pdf",
      "status": "done",
      "message": "3D-ΔPDF written"
    },
    {
      "stage": "pdf_check",
      "status": "done",
      "message": "back-FFT r = 0.99714"
    }
  ]
}
```

## compare_datasets {"kind":"reciprocal","plane":"hk0","value":0}

450 characters sent.

```json
{
  "cut": "H–K plane at L = 0",
  "rows": [
    {
      "dataset": "synthetic_a",
      "ring_energy_ratio": 0.314,
      "over_subtraction_fraction": 0,
      "leftover_peaks": 1,
      "backfill_median_seam_sigma": 0.197,
      "flatten_floor_after": [1.03, 1.98, 1.43],
      "flatten_floor_max_sigma": 1.79
    },
    {
      "dataset": "synthetic_b",
      "ring_energy_ratio": 0.235,
      "over_subtraction_fraction": 0,
      "leftover_peaks": 1,
      "backfill_median_seam_sigma": 0.156,
      "flatten_floor_after": [1.01, 1.04, 1.11],
      "flatten_floor_max_sigma": 0.976
    }
  ]
}
```

## configure_settings {}

1443 characters sent.

```json
{
  "settings": {
    "ringsEnabled": true,
    "punchEnabled": true,
    "backfillEnabled": true,
    "flatten": true,
    "pdfEnabled": true,
    "force": false,
    "ringModel": "pooled",
    "ringRadialMode": "rolling",
    "ringNPatches": "(default)",
    "ringNFourier": "8",
    "ringSliceAxis": "H",
    "ringWidth": "(default)",
    "ringGlobalMaterial": "auto",
    "ringGlobalSubtraction": "conservative",
    "ringGlobalConfidence": "1",
    "ringGlobalLmax": "4",
    "ringGlobalMinSnr": "5",
    "ringPooledSectors": "(default)",
    "ringPooledWindow": "(default)",
    "punchMinSig": "(default)",
    "punchFootprint": "(default)",
    "punchProfileNSigma": "(default)",
    "punchMode": "(default)",
    "punchSupercellH": "(default)",
    "punchSupercellK": "(default)",
    "punchSupercellL": "(default)",
    "punchHGuard": "(default)",
    "punchSearchFloor": "(default)",
    "punchProtectH": "(default)",
    "punchProtectHalfWidth": "(default)",
    "punchSearchMaxWidth": "(default)",
    "punchFrame": "spherical",
    "punchRho": "(default)",
    "punchTheta": "(default)",
    "punchPhi": "(default)",
    "punchQA": "(default)",
    "punchQB": "(default)",
    "punchQC": "(default)",
    "punchFitUnconstrained": false,
    "punchMargin": "(default)",
    "incidentBeamQA": "(default)",
    "incidentBeamQB": "(default)",
    "incidentBeamQC": "(default)",
    "incidentBeamMargin": "(default)",
    "incidentBeamFitCovariance": false,
    "backfillMethod": "(default)",
    "flattenEstimator": "(default)",
    "flattenIon": "(default)",
    "flattenQ2": false,
    "flattenFitQMax": "(default)",
    "pdfApod": "(default)",
    "pdfWindowShape": "(default)",
    "pdfWindowSupport": true,
    "pdfQMin": "(default)",
    "pdfQMax": "(default)"
  }
}
```

## update_settings {"changes":{"punchMinSig":6}} (with the punch's skill (bragg-node-audit) read in the conversation)

76 characters sent.

```json
{
  "changed": [
    {
      "setting": "punchMinSig",
      "from": 5,
      "to": 6
    }
  ],
  "rerun_from": "punch"
}
```

## update_settings {"changes":{"punchMinSig":6,"punchSupercellH":2}} (the punch's skill read; the user's latest message, “Raise the punch significance to 6.”, names no fact about the sample)

243 characters sent.

```json
{
  "changed": [
    {
      "setting": "punchMinSig",
      "from": 5,
      "to": 6
    }
  ],
  "refused": [
    {
      "setting": "punchSupercellH",
      "why": "punchSupercellH is a fact about the sample, which only the user sets: ask the user, and change it once they name it."
    }
  ],
  "rerun_from": "punch"
}
```

## run_pipeline {"from_stage":"punch"} (a stubbed run of 42.3 s)

460 characters sent.

```json
{
  "ended": "done",
  "seconds": 42.3,
  "stages": {
    "rings": "reused",
    "punch": "computed",
    "backfill": "computed",
    "flatten": "computed",
    "pdf": "computed",
    "pdf_check": "computed"
  },
  "outputs": ["raw", "ringremoved", "braggpunched", "backfilled", "flattened", "delta_pdf"],
  "log_tail": ["Bragg punch · 13 peaks punched, 1 below the significance gate", "Backfill · 13 holes filled", "Flatten · floor fitted on 32 shells", "3D-ΔPDF · 3D-ΔPDF written", "Consistency check · back-FFT r = 0.99714"]
}
```

## tune_pipeline {"stages":["punch"],"trials_per_stage":2} (a stubbed tuning run of 5.2 min, the punch's skill read)

708 characters sent.

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

## show_in_viewer {"view":"dpdf","plane":"xy","value":4}

40 characters sent.

```json
{
  "opened": "ΔPDF x–y section at z = 4 Å"
}
```

# Calls the executor refuses

## delete_dataset {} (a tool that does not exist)

```text
Error: no tool named delete_dataset. Available: read_skill, describe_dataset, current_view, measure_reciprocal_cut, measure_dpdf_cut, assess_stage, texture_check, qmax_coverage, symmetry_check, dpdf_contrast, dpdf_peaks, grain_check, ub_check, radial_profile, line_profile, bragg_peaks, consistency_details, run_log, compare_datasets, configure_settings, update_settings, run_pipeline, tune_pipeline, show_in_viewer
```

## measure_reciprocal_cut {plane: hk0 (arguments that are not JSON)

```text
Error: the arguments were not a JSON object: {plane: hk0
```

## measure_reciprocal_cut {"plane":"hk0","value":7} (a cut outside the data)

```text
Error: invalid arguments — L = 7 is outside the data range [-3, 3]
```

## update_settings {"changes":{"punchMinSig":6}} (a change before its stage's skill was read)

```text
Error: read the method first: call read_skill with name "bragg-node-audit". It is how the user works on the Bragg punch stage, and this change waits until it has been read in this conversation.
```

## update_settings {"changes":{"punchSupercellH":2}} (a fact about the sample that the user's latest message, “Is the punch clean?”, does not name; the punch's skill read)

```text
Error: punchSupercellH is a fact about the sample, which only the user sets: ask the user, and change it once they name it.
```

## tune_pipeline {"stages":["flatten"]} (tuning before its stage's skill was read)

```text
Error: read the method first: call read_skill with name "reduction-qc". It is how the user works on the flatten stage, and this tuning waits until it has been read in this conversation.
```

## update_settings {"changes":{"flattenQ2":true}} (a change in a later turn, its stage's skill read in an earlier one and not in this reply)

```text
Error: read the method again: call read_skill with name "reduction-qc". It was read earlier in the conversation, but its text is not in this reply. It is how the user works on the flatten stage, and this change waits until it has been read in this reply.
```

# An older result, shortened

A local model's request past its soft budget has its older results shortened (`compactResult`, compact.ts); the first assess_stage sample above reads so:

## assess_stage {}

```json
{
  "rings": {
    "verdict": "needs attention",
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
    "shells_judged": "(4 items)"
  },
  "punch": {
    "verdict": "needs attention",
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
    "headline": "seam 0.218σ · bright ≤ 0",
    "mean_median_seam_sigma": 0.218,
    "max_bright_fill_fraction": 0
  },
  "flatten": {
    "verdict": "meets its goal",
    "headline": "floor ≤ 2.78σ · trend 0.00268 · span 0.207 · no pedestal",
    "max_after_floor_sigma": 2.78,
    "floor_trend": 0.00268,
    "floor_span_fraction": 0.207,
    "pedestal_left": false
  },
  "pdf": {
    "verdict": "meets its goal",
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
    "worst_symmetry_op": "two-fold ∥ a / mirror ⊥ a",
    "symmetry_declared": true
  },
  "measured_on": ["H–K plane at L = 0", "H–L plane at K = 0", "K–L plane at H = 0"],
  "compacted": "shortened to save room; call the tool again for the whole result"
}
```
