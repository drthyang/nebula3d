# Tool results

Each tool called through `runToolCall` (tools/index.ts) against the synthetic crystal, and the text the model reads back: `ToolRun.text`, after `fitResult` trims a long result to valid JSON. JSON is shown indented; the model reads it on one line, as `JSON.stringify` writes it.

Update from web/: `npx vitest run src/llm/__tests__/modelVisible.test.ts -u`, then read the diff.

## read_skill {"name":"bragg-node-audit"}

3912 characters sent.

```text
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

## Steps

1. **Settle the nodes.** `describe_dataset` and `configure_settings`: the cell,
   the symmetry the file declares, the punch cell (`punchSupercellH/K/L`:
   Bragg nodes every n along H, K and L, for a volume indexed on a supercell)
   and the sample's modulation (`modulation`: its satellites, or the planes
   through them, which the punch's search leaves alone). These are facts about
   the sample, set only when the user asks. Neither tool gives the declared
   symmetry: `grain_check` does (`declared_symmetry`).
2. **The punch on three planes.** `assess_stage` for the punch: the peaks left
   at nodes, the sharp peaks off the lattice, the broad maxima kept, and how
   much was punched to get there. It reads the planes through the origin:
   check an off-zero cut too, with `measure_reciprocal_cut`.
3. **Leftovers at allowed nodes.** Look at each (`show_in_viewer`,
   `line_profile`).
4. **Forbidden nodes.** Say which evidence points where, and do not pick a
   cause without it:
   - λ/2 contamination: is the 2h 2k 2l reflection strong?
   - multiple scattering: sharp, and often only some members of an orbit;
   - a lower true symmetry, or a superlattice.
5. **Peaks off the lattice.** `grain_check`: the off-lattice peaks the punch's
   search found, grouped into symmetry orbits, tested against the nodes (a
   Bragg peak displaced by a UB that is slightly off) and as a rotated copy of
   the lattice (a second grain), judged against the same search at random
   directions; the test against the nodes has no such control.
6. **Broad maxima stay.** The search's width limit (`punchSearchMaxWidth`)
   leaves such maxima unpunched, but it is off by default: then the search
   punches every candidate, broad or sharp.
7. **The backfill.** `texture_check`, over every punch hole of the volume and
   on the cuts. A lattice-periodic fill pattern is texture that the 3D-ΔPDF
   will show.
8. **Report** the audit in the order above. For each signal, the evidence and
   its likely cause, or that it was not tested; what to change and why; and
   what only the user can decide (the cell, the satellites, the sample's
   modulation). Mark a signal the user should look at (satellites, a leftover
   peak, intensity at a forbidden node) with `mark_region` on the stage that
   shows it, its positions as points, resting on the call that measured it;
   name the mark by its id beside the signal.

---
Details of this skill (read with read_skill and `section` "Details", or one part by its heading): Settle the nodes; Forbidden nodes; Peaks off the lattice; The backfill; Firm rules (enforced in code); Acceptance checklist; Failure modes.
References of this skill (read one with read_skill and `reference`):
- bragg_cleanup: the punch: node detection, the off-lattice search, footprints, the significance gate and the backfill
```

## read_skill {"name":"bragg-node-audit","section":"Details"}

2409 characters sent.

```text
Skill bragg-node-audit, section "Details"

## Details

**Status:** Draft: awaiting the user's interview (questions in
`docs/SKILL_INTERVIEWS.md`). Ported from the scattering-agent-tools plugin
skill of the same name, from its NeXus Viewer and NEXPLAN tools to the
console's own.

### Settle the nodes

- No modulation is declared by default: the search then leaves no position
  alone, and when the sharp peaks it found off the lattice bunch at one
  commensurate fraction, the punch's assessment and the run carry a question
  for the user: whether the sample has that modulation.
- Which cell is the parent, and whether the supercell's other nodes hold Bragg
  peaks or diffuse scattering (to confirm with the user).

### Forbidden nodes

What counts as clearly above the background (to confirm with the user).

### Peaks off the lattice

Symmetrising data whose UB is slightly off makes the displaced copies the test
against the nodes finds.

### The backfill

The diffuse often peaks at the nodes (thermal diffuse scattering), so a sound
fill sits above its rim's median; the range a fill is judged against runs from
the diffuse at the hole's edge to its rise continued to the node.

### Firm rules (enforced in code)

- Changing a punch or backfill setting, or tuning those stages, is refused
  until this skill has been read in the conversation.
- The sample's modulation and the punch cell are facts about the sample:
  they change only when the user asks, never to improve a number.

### Acceptance checklist

- [ ] the cell and nodes used, and who set them;
- [ ] the leftovers at allowed nodes, on three planes and an off-zero cut;
- [ ] each forbidden-node signal with the evidence for its cause, or "not
  tested";
- [ ] the off-lattice verdict from `grain_check`, with the offset angle when
  Bragg peaks are displaced;
- [ ] broad maxima counted apart from missed peaks;
- [ ] the backfill's texture verdict;
- [ ] every number with what produced it (settings, planes).

### Failure modes

- Reading the leftover count as "no off-lattice peaks", or as everything the
  search found.
- Calling broad short-range-order maxima missed Bragg peaks, and widening the
  punch until they are gone.
- Naming a second grain from displaced Bragg peaks without `grain_check`.
- Changing the sample's modulation or the punch cell to make a number look
  better.
- Judging from the opening cut at L = 0 alone.
```

## read_skill {"name":"delta-pdf-interpretation","reference":"delta_pdf"}

928 characters sent.

```text
Reference "delta_pdf" of skill delta-pdf-interpretation (docs/algorithms/delta_pdf.md)

# 3D-ΔPDF Transform

Sections (read one with read_skill, `reference` and `section`, by its heading):
- Purpose
- Correct transform recipe
  - Non-orthogonal cells (hexagonal, monoclinic, triclinic)
- The strongest features, grouped by the declared symmetry (2026-10-19)
- Inverse transform & consistency check (`invert_delta_pdf`)
- The centring bug (fixed 2026-06-05)
- Near-origin spike (expected, not the bug)
- The dashed axis streaks were the DC subtraction (fixed 2026-10-07)
- The window respects the lattice symmetry (2026-10-07)
  - The window and the measured coverage (`support`)
- The axis cross is the residual diffuse background (diagnosed 2026-06-05)
  - Methods compared (smooth-bg wins)
  - Background removal in the pipeline: the radial flatten (step 4)
    - A background that rises with |Q|, and what the literature does
```

## read_skill {"name":"delta-pdf-interpretation","reference":"delta_pdf","section":"The window and the measured coverage (`support`)"}

4125 characters sent.

```text
Reference "delta_pdf" of skill delta-pdf-interpretation (docs/algorithms/delta_pdf.md), section "The window and the measured coverage (`support`) (part 1 of 2)"

### The window and the measured coverage (`support`)

A backfill that leaves unmeasured space masked, rather than inventing
intensity there, hands the transform a volume whose data end inside the box.
Read as `I = 0`, that region does two things: it pulls the weighted mean `c`
down, and the box-sized window still weights it. On the hexagonal data the
separable window puts a few percent of its weight on unmeasured space, so the
coverage edge becomes a step with a truncation ripple (period ≈ 2π/Q_edge,
with Q_edge the `|Q|` where the coverage ends).

`compute_delta_pdf(support=mask)` (pipeline `DeltaPdfParams.window_support`,
default on, passes the input volume's `mask`; server `pdf_window_support`;
*Taper to the measured coverage* in the web app):

- **ΔI = 0 off the data.** The mean is weighted over the support only, and
  voxels outside it are zeroed after it is subtracted. They then add no
  step of `−c`, and the input still sums to zero.
- **The window fits the coverage.** Unsupported space that reaches the box
  faces is where the coverage ends. It is found by `binary_fill_holes`
  (26-connected; bool arrays only), so holes enclosed by data do not count.
  The ellipsoid is shrunk until at most `support_tol` (default 10⁻³) of its
  weight lies there. With `"auto"`, an orthogonal box switches to the
  ellipsoid when the separable window puts more than that on it. A shrunk
  ellipsoid is the same ellipsoid scaled, so it stays invariant. The scale
  is logged as `window_scale`.
- **The weight left there is recorded.** The share of the window's weight on
  that open space is `DeltaPDF.window_open_weight`, logged as
  `window_open_weight` beside `window_scale` and served with the ΔPDF's
  metadata (`/api/deltapdf/{id}/meta`, `dpdf_meta_json`). The web app's
  coverage check reports it: the measure of a transform reaching past the
  data, whatever the window's shape. On a measured volume the auto window, an
  ellipsoid at scale 1.0, kept a negligible share there and nothing on a box
  face.
- `invert_delta_pdf` leaves unsupported voxels out of the reliable `mask`.
- An all-True support (a backfill that fills the whole box, e.g.
  `unmeasured="all"`) changes nothing, bit for bit.

The tolerance is not cosmetic. Coverage edges are ragged, and thin channels
of unmeasured voxels reach far in. On the raw hexagonal data the nearest open
voxel sits well inside the ellipsoid, although only a tiny fraction of the
window's weight (below the default tolerance) is open. Even on orthorhombic
data with full coverage, a thin channel of open voxels reaches inside the
ellipsoid, with a negligible share of the weight. Shrinking to the
nearest open voxel (`support_tol=0`) would shrink the hexagonal window
substantially (real-space peaks markedly broader) and cut its main peak
sharply; the weight criterion ignores such channels.

Measured on the hexagonal data (the pipeline's flattened input with the
unmeasured space that reaches the box edge masked, as the unmeasured-aware
backfill leaves it; Gaussian σ = 0.4; differences at 2–15 Å relative to the
strongest 1.5–15 Å correlation):

| window | `c` | effect of the support | scale |
|---|---|---|---|
| separable | rises | a few % max, well below 1 % RMS (the mean's share of the ripple) | — (cannot shrink) |
| ellipsoid (`auto`) | essentially unchanged | negligible (≪ 1 %) | 1.0 (already inside the coverage) |
| ellipsoid, `support_tol=0` | much lower | main peak sharply reduced | shrunk substantially |

So for this hexagonal cell the ellipsoid already keeps clear of the coverage
edge, and the support only fixes the mean's handling of the empty region. It
matters most for an orthogonal cell whose coverage ends inside the box, where
`"auto"` now moves to a fitted ellipsoid. `_open_space` takes 2–3 s on 401³
natively and runs only when the support has unsupported voxels.

[The section continues: read section "The window and the measured coverage (`support`) (part 2)".]
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

3277 characters sent.

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
    "criterion": "The fills meet their surroundings: a median seam of 1σ or less. Whether the fills are biased one way is texture_check's to say.",
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

## assess_stage {} (later in a reply whose first assess_stage sent every stage's whole criterion: the terse ones)

2752 characters sent.

```json
{
  "rings": {
    "verdict": "needs attention",
    "criterion": "No powder ring left above, or dented below, three times its plane's noise; a powder ring rises at least 0.15 of its median height in 90 % of directions.",
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
    "criterion": "No Bragg peak missed at a lattice node; no sharp peak left off the lattice outside the protected planes.",
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
    "criterion": "A median seam of 1σ or less; fill bias is texture_check's.",
    "headline": "seam 0.218σ · bright ≤ 0",
    "mean_median_seam_sigma": 0.218,
    "max_bright_fill_fraction": 0
  },
  "flatten": {
    "verdict": "meets its goal",
    "criterion": "No pedestal: the volume's floor trend and span both 0.8 or more over the outer half of the |Q| shells the counts reach. Floor in σ: reported, not judged.",
    "headline": "floor ≤ 2.78σ · trend 0.00268 · span 0.207 · no pedestal",
    "max_after_floor_sigma": 2.78,
    "floor_trend": 0.00268,
    "floor_span_fraction": 0.207,
    "pedestal_left": false
  },
  "pdf": {
    "verdict": "meets its goal",
    "criterion": "Back-FFT r of 0.999 or more against the data's even part under Q → −Q; at most 1e-3 of the window's weight on unmeasured space; the declared symmetry kept.",
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

## assess_stage {"stage":"punch"} (a run whose punch record says its sharp peaks off the lattice bunch at H ≡ ±1/3 (mod 1))

3087 characters sent.

```json
{
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
    "fitted_peaks": 14,
    "off_lattice_bunching": {
      "facts": "14 of the 17 sharp peaks the search punched off the lattice (each symmetry orbit once) lie within 0.05 r.l.u. of H ≡ ±1/3 (mod 1), where chance puts 1.9 (binomial tail 2.1e-11, under 0.00135 over 24 tests). No modulation is declared there, so the search punched them. Whether the sample has that modulation, and in which form, is the user's to say: ask them (ask_user), and do not assume the answer either way.",
      "ask_user": "14 of the 17 sharp peaks off the lattice sit at H = n ± 1/3, where about 2 would by chance. Does the sample have a modulation with k = (1/3, 0, 0)?"
    },
    "per_plane": {
      "hk0": {
        "leftover_peaks": 1,
        "at_nodes": 1,
        "off_lattice": 0,
        "on_protected_planes": 0,
        "off_lattice_broad": 0,
        "strongest_leftover": {
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
        "punched_fraction": 0.0291
      },
      "h0l": {
        "leftover_peaks": 0,
        "at_nodes": 0,
        "off_lattice": 0,
        "on_protected_planes": 0,
        "off_lattice_broad": 0,
        "strongest_leftover": null,
        "punched_fraction": 0.0305
      },
      "0kl": {
        "leftover_peaks": 0,
        "at_nodes": 0,
        "off_lattice": 0,
        "on_protected_planes": 0,
        "off_lattice_broad": 0,
        "strongest_leftover": null,
        "punched_fraction": 0.0305
      }
    },
    "goal": "Remove every sharp peak that should go while punching as little as possible (punched_fraction small): every punched voxel is diffuse signal thrown away and later backfilled. Missed lattice peaks (leftover_at_nodes) must reach 0 on every plane; off-lattice sharp peaks (leftover_off_lattice) are satellites or spurious peaks the search punches unless their H planes are protected: leftover_on_protected_planes of them sit on protected planes and stay by design (whether they are real is the user's call), while the rest are peaks the search left, so fewer of those is better where they are spurious. leftover_off_lattice splits into leftover_off_lattice_sharp (punch candidates) and leftover_off_lattice_broad (FWHM ≥ 5 voxels along a slice axis: diffuse maxima such as short-range order, which are the signal, not peaks to punch). Fewer leftovers win only if the punched fraction does not grow substantially; lowering the significance or the search floor punches noise and diffuse maxima, raising them leaves weak peaks."
  },
  "measured_on": ["H–K plane at L = 0", "H–L plane at K = 0", "K–L plane at H = 0"]
}
```

## texture_check {}

527 characters sent.

```json
{
  "n_holes": 79,
  "n_judged": 79,
  "median_fill_bias_sigma": 0,
  "median_fill_bias_level": 0,
  "above_fraction": 0.152,
  "below_fraction": 0.0886,
  "above_floor_fraction": 0,
  "below_floor_fraction": 0,
  "systematic_fill_bias": false,
  "criterion": "systematic_fill_bias: 5 judged holes or more, 75 % of them past their range one way, with a median of 0.5σ and 0.2 of the local level or more.",
  "per_cut": [
    {
      "cut": "H–K plane at L = 0",
      "azimuthal_ratio": 1.02
    },
    {
      "cut": "H–L plane at K = 0",
      "azimuthal_ratio": 1
    },
    {
      "cut": "K–L plane at H = 0",
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

791 characters sent.

```json
{
  "grouped_by": "declared symmetry (mmm: 8 operations, r ≡ −r)",
  "features": [
    {
      "length_A": 4,
      "size_sigma": -35.2,
      "n_vectors": 1,
      "vectors_rlu": [
        [1, 0, 0]
      ],
      "vectors_A": [
        [4, 0, 0]
      ]
    },
    {
      "length_A": 4,
      "size_sigma": -35.2,
      "n_vectors": 1,
      "vectors_rlu": [
        [0, 1, 0]
      ],
      "vectors_A": [
        [0, 4, 0]
      ]
    },
    {
      "length_A": 4,
      "size_sigma": -35.2,
      "n_vectors": 1,
      "vectors_rlu": [
        [0, 0, 1]
      ],
      "vectors_A": [
        [0, 0, 4]
      ]
    },
    {
      "length_A": 5.657,
      "size_sigma": 21.1,
      "n_vectors": 2,
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
      "length_A": 5.657,
      "size_sigma": 21.1,
      "n_vectors": 2,
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
      "length_A": 5.657,
      "size_sigma": 21.1,
      "n_vectors": 2,
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
  "extrema_above_threshold": 26
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

1038 characters sent.

```json
{
  "verdict": "the UB is right: turned 0.003°, under the 0.05° that counts as turned",
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

## compare_laue_classes {} (the demo crystal's comparison (cubic; its rods along L make it 4/mmm))

2445 characters sent.

```json
{
  "columns": "r_int, x_noise, chi2: [all voxels, diffuse]; x_noise = R_int / noise floor, chi2 = χ²/dof (1: within counting noise)",
  "classes": [
    {
      "class": "-1",
      "ops": 2,
      "r_int": [0.042, 0.049],
      "x_noise": [1, 1],
      "chi2": [1, 1],
      "orbits": 34460,
      "verdict": "supported"
    },
    {
      "class": "2/m (b unique)",
      "ops": 4,
      "contains": ["-1"],
      "r_int": [0.051, 0.06],
      "x_noise": [1, 1],
      "chi2": [1, 1],
      "orbits": 17660,
      "verdict": "supported"
    },
    {
      "class": "2/m (c unique)",
      "ops": 4,
      "contains": ["-1"],
      "r_int": [0.051, 0.06],
      "x_noise": [1, 1],
      "chi2": [0.99, 0.99],
      "orbits": 17660,
      "verdict": "supported"
    },
    {
      "class": "mmm",
      "ops": 8,
      "contains": ["2/m (b unique)", "2/m (c unique)"],
      "r_int": [0.055, 0.065],
      "x_noise": [1, 1],
      "chi2": [1, 0.99],
      "orbits": 9260,
      "verdict": "supported"
    },
    {
      "class": "4/m",
      "ops": 8,
      "contains": ["2/m (c unique)"],
      "r_int": [0.055, 0.065],
      "x_noise": [1, 1],
      "chi2": [1, 0.99],
      "orbits": 8840,
      "verdict": "supported"
    },
    {
      "class": "4/mmm",
      "ops": 16,
      "contains": ["mmm", "4/m"],
      "r_int": [0.057, 0.067],
      "x_noise": [1, 1],
      "chi2": [1, 1],
      "orbits": 4850,
      "verdict": "supported"
    },
    {
      "class": "m-3",
      "ops": 24,
      "contains": ["mmm"],
      "r_int": [0.087, 0.105],
      "x_noise": [1.51, 1.53],
      "chi2": [2.23, 2.26],
      "orbits": 3100,
      "verdict": "rose 1.51× against 2/m (b unique) (all); rose 1.54× against 2/m (c unique) (diffuse)"
    },
    {
      "class": "m-3m",
      "ops": 48,
      "contains": ["4/mmm", "m-3"],
      "r_int": [0.087, 0.105],
      "x_noise": [1.5, 1.52],
      "chi2": [2.21, 2.24],
      "orbits": 1770,
      "verdict": "rose 1.5× against 2/m (b unique) (all); rose 1.53× against 2/m (c unique) (diffuse)"
    }
  ],
  "no_symmetry": {
    "r_int": [0.537, 0.342],
    "x_noise": [9.12, 4.9]
  },
  "refused": ["-3, -3m1, -31m, 6/m, 6/mmm: metric changes 100%"],
  "suggestion": "4/mmm",
  "suggested_by": {
    "all": "4/mmm",
    "diffuse": "4/mmm"
  },
  "why": "4/mmm is the class with the most operations the rule supports in both readings: its R_int, in units of the noise floor, is 1.00× that of 2/m (b unique), the subgroup that agrees best; m-3m rose 1.50× against 2/m (b unique).",
  "flag": null,
  "rule": "Rises: x_noise above a subgroup's by >10% and 2 SE of the difference (block bootstrap, 69 effective blocks). Supported: rises against no subgroup, all subgroups supported. suggestion: the supported class with most operations in every reading that tells classes apart (no_symmetry must rise).",
  "diffuse_mask": "1×1×1 cell's Bragg nodes within 0.25 Å⁻¹ (2.7% of voxels)",
  "edge_trim": 1,
  "notes": ["The bootstrap's blocks were cut to 3 voxels (the correlation asks for 4) to keep 64 of them."],
  "limits": "Twinning or domains can make a lower symmetry look higher; R_int cannot tell."
}
```

## radial_profile {}

836 characters sent.

```json
{
  "cut": "H–K plane at L = 0",
  "q_unit": "|Q| in Å⁻¹",
  "stat": "median per shell",
  "shells": {
    "cols": ["q", "raw", "ringremoved", "braggpunched", "backfilled", "flattened"],
    "rows": [
      [0.345, 16.7, 16.7, 16.7, 16.7, 0.646],
      [0.531, 17.5, 17.4, 17.4, 17.4, 1.34],
      [0.73, 20, 19.9, 19.9, 19.9, 3.75],
      [0.933, 20.8, 20.7, 20.7, 20.7, 4.46],
      [1.14, 18.4, 18.4, 18.4, 18.4, 2],
      [1.35, 18.2, 18.1, 18.1, 18.1, 1.65],
      [1.55, 18.8, 18.7, 18.5, 18.3, 1.68],
      [1.76, 18.5, 18.3, 18.2, 18.1, 1.32],
      [1.98, 18.6, 18.4, 18.4, 18.4, 1.39],
      [2.19, 19.8, 19.5, 19.3, 19.2, 2],
      [2.39, 22.5, 21.9, 21.7, 21.4, 3.94],
      [2.6, 21.4, 20.5, 20.5, 20.5, 2.81],
      [2.81, 23.4, 20.9, 20.9, 20.9, 2.88],
      [3.02, 30.3, 21.9, 21.8, 21.8, 3.47],
      [3.22, 46.7, 23.8, 23.7, 23.6, 5.04],
      [3.43, 28.5, 21.5, 21.3, 21.2, 2.27],
      [3.64, 23.3, 21.5, 21.3, 21.2, 1.86],
      [3.85, 23.3, 22.4, 22.4, 22.4, 2.73],
      [4.06, 23.8, 23.3, 23.3, 23.3, 3.17],
      [4.26, 23.8, 23.5, 23.5, 23.5, 2.81],
      [4.38, 25.3, 25.1, 24.9, 24.7, 3.92]
    ]
  }
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

1054 characters sent.

```json
{
  "n_peaks": 14,
  "punch_frame": "spherical",
  "sorted_by": "significance",
  "peaks": {
    "cols": ["hkl", "q", "intensity", "local_background", "significance", "measured_width_q", "resolution_limited", "anisotropy", "fit"],
    "rows": [
      [
        [1, 0, 0],
        1.571,
        1250,
        16,
        310,
        [0.094, 0.094, 0.11],
        [true, true, false],
        1.17,
        "covariance"
      ],
      [
        [0, 1, 0],
        1.571,
        1240,
        16,
        305,
        [0.094, 0.094, 0.11],
        [true, true, false],
        1.17,
        "covariance"
      ],
      [
        [1, 1, 0],
        2.221,
        1060,
        16,
        262,
        [0.094, 0.094, 0.11],
        [true, true, false],
        1.17,
        "covariance"
      ],
      [
        [1, 1, 1],
        2.721,
        900,
        16,
        221,
        [0.094, 0.094, 0.11],
        [true, true, false],
        1.17,
        "covariance"
      ],
      [
        [2, 0, 0],
        3.142,
        760,
        16,
        188,
        [0.094, 0.094, 0.11],
        [true, true, false],
        1.17,
        "covariance"
      ],
      [
        [2, 1, 0],
        3.512,
        640,
        16,
        160,
        [0.094, 0.094, 0.11],
        [true, true, false],
        1.17,
        "covariance"
      ],
      [
        [1.5, 0.5, 0],
        2.483,
        96,
        16,
        22,
        [0.157, 0.141, 0.188],
        [false, false, false],
        1.33,
        "covariance"
      ],
      [
        [0.5, 1.5, 0],
        2.483,
        94,
        16,
        21,
        [0.157, 0.141, 0.188],
        [false, false, false],
        1.33,
        "covariance"
      ],
      [
        [1.5, -0.5, 0],
        2.483,
        90,
        16,
        20,
        [0.157, 0.141, 0.188],
        [false, false, false],
        1.33,
        "covariance"
      ],
      [
        [2.5, 0.5, 0],
        4.005,
        61,
        16,
        14,
        [0.157, 0.141, 0.188],
        [false, false, false],
        1.33,
        "covariance"
      ]
    ]
  }
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

378 characters sent.

```json
{
  "ended": "done",
  "lines": {
    "cols": ["stage", "status", "message"],
    "rows": [
      ["rings", "skip", "ring-removed output exists"],
      ["punch", "start", "Bragg punch"],
      ["punch", "done", "13 peaks punched, 1 below the significance gate"],
      ["backfill", "done", "13 holes filled"],
      ["flatten", "done", "floor fitted on 32 shells"],
      ["pdf", "done", "3D-ΔPDF written"],
      ["pdf_check", "done", "back-FFT r = 0.99714"]
    ]
  }
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

## run_verdict {} (before any check in this reply)

205 characters sent.

```json
{
  "verdict": null,
  "achieved": "not judged",
  "stages": {},
  "needs_attention": [],
  "not_judged": [],
  "not_measured": ["the ring removal", "the Bragg punch", "the backfill", "the flatten", "the 3D-ΔPDF"],
  "data_problems": []
}
```

## configure_settings {}

31 characters sent.

```json
{
  "settings": {},
  "at_default": 59
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

## regrid_refined_ub {} (the user's latest message, “Regrid the volume onto the refined UB.”, asks for it; the crystal's UB, turned 0.3° for this sample, is written as a new dataset)

578 characters sent.

```json
{
  "written": true,
  "refusal": null,
  "dataset_id": "synthetic_a_regridded",
  "file": "synthetic_a_regridded.nxs",
  "source_file": "synthetic_a.nxs",
  "refined_on": "synthetic_a.nxs",
  "fit": "both",
  "bragg_nodes_every": [1, 1, 1],
  "turn_deg": 0.3001,
  "turn_threshold_deg": 0.05,
  "axis_uvw": [0.12, -0.31, 0.94],
  "rms_start": 0.0171,
  "rms": 0.0002,
  "cell_start": "4.0000, 4.0000, 4.0000 Å; 90.000°, 90.000°, 90.000°",
  "cell": "4.0012, 4.0009, 3.9994 Å; 90.010°, 89.990°, 90.000°",
  "peaks_used": 112,
  "symmetrised": false,
  "measured_before": 812400,
  "measured_after": 808150,
  "voxels_outside": 4120,
  "voxels_outside_share": 0.0051
}
```

## regrid_refined_ub {} (asked for as above; the crystal's own UB, turned 0.003°: refused by the backend, nothing written)

767 characters sent.

```json
{
  "written": false,
  "refusal": {
    "code": "turn_below_noise",
    "reason": "The both fit turns the UB by 0.003°, under the UB check's 0.05° rule (UB_TURN): a turn that small is within the fit's own noise, and regridding onto it would only resample the data. Nothing was written."
  },
  "dataset_id": null,
  "file": null,
  "source_file": "synthetic_a.nxs",
  "refined_on": "synthetic_a.nxs",
  "fit": "both",
  "bragg_nodes_every": [1, 1, 1],
  "turn_deg": 0.003,
  "turn_threshold_deg": 0.05,
  "axis_uvw": [0.12, -0.31, 0.94],
  "rms_start": 0.0123,
  "rms": 0.0119,
  "cell_start": "4.0000, 4.0000, 4.0000 Å; 90.000°, 90.000°, 90.000°",
  "cell": "4.0012, 4.0009, 3.9994 Å; 90.010°, 89.990°, 90.000°",
  "peaks_used": 112,
  "symmetrised": false,
  "measured_before": null,
  "measured_after": null,
  "voxels_outside": null,
  "voxels_outside_share": null
}
```

## show_in_viewer {"view":"dpdf","plane":"xy","value":4}

40 characters sent.

```json
{
  "opened": "ΔPDF x–y section at z = 4 Å"
}
```

## mark_region {"where":"pdf","shape":"ellipsoid","center":[4,0,0],"half_size":[0.8,0.8,0.8],"label":"the strongest + pair, at a","evidence":["dpdf_peaks.features.0"]} (resting on a dpdf_peaks call earlier in the reply)

358 characters sent.

```json
{
  "marked": "M1",
  "label": "the strongest + pair, at a",
  "where": "pdf",
  "page": "3D-ΔPDF",
  "region": {
    "shape": "ellipsoid",
    "center": [4, 0, 0],
    "half_size": [0.8, 0.8, 0.8],
    "unit": "Å"
  },
  "drawn_on": [
    {
      "view": "ΔPDF x–y section at z = 0 Å"
    },
    {
      "view": "ΔPDF x–z section at y = 0 Å"
    },
    {
      "view": "ΔPDF y–z section at x = 4 Å"
    }
  ],
  "zoomed": true,
  "evidence": ["dpdf_peaks.features.0 (step 1)"]
}
```

## mark_region {"where":"flatten","shape":"points","points":[[1.5,0,0],[2.5,0,0],[3.5,0,0]],"label":"half-integer maxima along H","evidence":["measure_reciprocal_cut"]} (on the cleanup page, resting on a measure_reciprocal_cut call earlier in the reply; one point outside the volume)

413 characters sent.

```json
{
  "marked": "M1",
  "label": "half-integer maxima along H",
  "where": "flatten",
  "page": "Reciprocal cleanup",
  "region": {
    "shape": "points",
    "points": [
      [1.5, 0, 0],
      [2.5, 0, 0]
    ],
    "unit": "r.l.u."
  },
  "clipped": ["1 of 3 points are outside the volume and were left out"],
  "drawn_on": [
    {
      "view": "H–K plane at L = 0",
      "stages": ["raw", "rings", "punch", "backfill", "flatten"],
      "points": 2
    }
  ],
  "zoomed": false,
  "evidence": ["measure_reciprocal_cut (step 1)"]
}
```

# Calls the executor refuses

## mark_region {"where":"pdf","shape":"ellipsoid","center":[4,0,0],"half_size":[0.8,0.8,0.8],"label":"a feature","evidence":[]} (a mark that cites no evidence)

```text
Error: not marked: a mark needs its evidence: name the tool calls whose results show the region, by the tool's name or as tool.field (dpdf_peaks.features.0)
```

## mark_region {"where":"pdf","shape":"box","center":[20,0,0],"half_size":[1,1,1],"label":"a feature","evidence":["dpdf_peaks"]} (a mark outside the volume, its evidence in the reply)

```text
Error: not marked: the box (x 19 to 21) is outside the volume: the volume spans x -12 to 12 Å, y -12 to 12 Å, z -12 to 12 Å
```

## delete_dataset {} (a tool that does not exist)

```text
Error: no tool named delete_dataset. Available: read_skill, describe_dataset, current_view, measure_reciprocal_cut, measure_dpdf_cut, assess_stage, texture_check, qmax_coverage, symmetry_check, dpdf_contrast, dpdf_peaks, grain_check, ub_check, compare_laue_classes, radial_profile, line_profile, bragg_peaks, consistency_details, run_log, compare_datasets, run_verdict, configure_settings, update_settings, run_pipeline, tune_pipeline, regrid_refined_ub, show_in_viewer, mark_region
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

## regrid_refined_ub {} (a regrid that the user's latest message, “Is the UB right?”, does not ask for)

```text
Error: A regrid writes a new dataset, which only the user asks for: nothing was written. Ask the user, and regrid once they ask for it.
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
