# Tool definitions

`toolSpecs(CHAT_TOOLS)`: each tool's name, description and parameters' JSON schema, as sent with every request (28 tools, 21590 characters as JSON).

Update from web/: `npx vitest run src/llm/__tests__/modelVisible.test.ts -u`, then read the diff.

## 1. read_skill

```text
Read one of the user's skills: their method for a topic, with the steps, the checks and what to report. Name it from the list in the system prompt. With reference, read one of the documents the skill cites (a long one by section). Read a stage's skill before you change that stage's settings or tune it: those calls are refused until it has been read in this conversation.
```

Parameters:

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "enum": ["bragg-node-audit", "delta-pdf-interpretation", "reduction-qc"],
      "description": "The skill"
    },
    "reference": {
      "type": "string",
      "description": "One of the skill's references, by the name the skill lists"
    },
    "section": {
      "type": "string",
      "description": "With reference: one section of that document, by its heading"
    }
  },
  "required": ["name"]
}
```

## 2. describe_dataset

```text
The selected dataset: which stage outputs exist, the reciprocal grid and its H/K/L ranges, the unit cell, the ΔPDF grid and x/y/z ranges, and the other datasets (e.g. other temperatures) available for compare_datasets.
```

Parameters:

```json
{
  "type": "object",
  "properties": {}
}
```

## 3. current_view

```text
What the user is looking at: the console page and the cuts open in the reciprocal-space and ΔPDF viewers. Use it when the user says 'this', 'here' or 'what I'm looking at'.
```

Parameters:

```json
{
  "type": "object",
  "properties": {}
}
```

## 4. measure_reciprocal_cut

```text
Compute the stage-quality metrics (ring removal, leftover Bragg peaks, backfill seams, flatten floors) on any reciprocal-space cut: one cut, not the volume. A reply's first call also returns fields, what each one means. Use it to check whether a finding holds on other planes or off-zero cuts (e.g. L=0.5, or K=1/3 for satellites).
```

Parameters:

```json
{
  "type": "object",
  "properties": {
    "plane": {
      "type": "string",
      "enum": ["hk0", "h0l", "0kl"],
      "description": "hk0: H–K plane (fixed L), h0l: H–L (fixed K), 0kl: K–L (fixed H)"
    },
    "value": {
      "type": "number",
      "description": "Cut position along the fixed axis, in r.l.u."
    }
  },
  "required": ["plane", "value"]
}
```

## 5. measure_dpdf_cut

```text
Compute the 3D-ΔPDF feature metrics (feature SNR, strong-feature fraction, sign balance, anisotropy and its direction, radial trend) on any real-space section, in its own robust σ. A reply's first call also returns fields, what each one means.
```

Parameters:

```json
{
  "type": "object",
  "properties": {
    "plane": {
      "type": "string",
      "enum": ["xy", "xz", "yz"],
      "description": "xy (cut along z), xz (cut along y), yz (cut along x); x ∥ a, y ∥ b, z ∥ c"
    },
    "value": {
      "type": "number",
      "description": "Cut position along the fixed axis, in Å"
    }
  },
  "required": ["plane", "value"]
}
```

## 6. assess_stage

```text
Judge a stage's output against its goal by the stage's rule, on the three principal planes through the origin and the records the stage writes, as tuning judges trials. stage: rings, punch, backfill, flatten, pdf, or all (default). Returns per stage its verdict, criterion, headline and numbers; one stage adds the per-plane detail and its goal. Use it for a verdict on a stage, after a run, and before and after a change.
```

Parameters:

```json
{
  "type": "object",
  "properties": {
    "stage": {
      "type": "string",
      "enum": ["rings", "punch", "backfill", "flatten", "pdf", "all"],
      "description": "The stage to judge, or all (default)"
    }
  }
}
```

## 7. texture_check

```text
Did the punch and backfill print a pattern of their own into reciprocal space? Each punch hole's fill, in 3-D, against the range its rim allows. Returns median_fill_bias_sigma and median_fill_bias_level, above/below_fraction, above/below_floor_fraction (beyond a fifth of the local level), systematic_fill_bias and its criterion; per cut (default: the three principal planes), azimuthal_ratio: the sector means' spread around |Q| shells after the backfill over before the punch (1: none added).
```

Parameters:

```json
{
  "type": "object",
  "properties": {
    "plane": {
      "type": "string",
      "enum": ["hk0", "h0l", "0kl"],
      "description": "One plane instead of all three"
    },
    "value": {
      "type": "number",
      "description": "Cut position for that plane, in r.l.u. (default 0)"
    }
  }
}
```

## 8. qmax_coverage

```text
Does the forward transform (data → 3D-ΔPDF) reach past the measured reciprocal space? Returns verdict: the window's weight on unmeasured space from the ΔPDF's record (≲ 1e-3 is clean), else the transform's reach against full_coverage_q (where |Q| shells stop holding counts in 95 % of voxels); raw_counts (where the counts begin and end in |Q|), suggested_band, band_check, counts_end_inside_box. With the window fitted to the coverage, the verdict judges the counts' end and the band instead.
```

Parameters:

```json
{
  "type": "object",
  "properties": {}
}
```

## 9. symmetry_check

```text
Does the 3D-ΔPDF keep the symmetry its data were declared symmetrised with? Each operation of the declared point group (none: the cell's in-plane ones): the RMS difference from the ΔPDF's image over its RMS, on the worst section it maps (x–y at ±z, default 0; x–z, y–z), else voxel by voxel (tested_on, not_tested). Returns ops, holds, verdict; a kept symmetry holds to about 1e-3; more means a stage broke it, or the sample lacks it. Which operations the sample has is the user's to say.
```

Parameters:

```json
{
  "type": "object",
  "properties": {
    "z": {
      "type": "number",
      "description": "Height of the x–y section along c, in Å (default 0); the one at −z is read too"
    }
  }
}
```

## 10. dpdf_contrast

```text
Set the 3D-ΔPDF viewer's colour range so pair-correlation features carry the colour and the FFT ripple stays dim. Call it once without arguments: the limit is the 99.9th percentile of |ΔPDF| on the three centre sections (origin disk left out), the page's Auto. Use it before you describe a ΔPDF figure. Returns the applied limit, and what the 99.5th and 99.97th percentiles would give. Pass percentile or limit_sigma only for a range the user asks for; reset returns to Auto.
```

Parameters:

```json
{
  "type": "object",
  "properties": {
    "percentile": {
      "type": "number",
      "description": "Only when the user asks: percentile of |ΔPDF| for the limit, 99–99.99"
    },
    "limit_sigma": {
      "type": "number",
      "description": "Only when the user asks: the ± limit in units of the sections' robust σ"
    },
    "reset": {
      "type": "boolean",
      "description": "Return the viewer to Auto"
    }
  }
}
```

## 11. dpdf_peaks

```text
The 3D-ΔPDF's strongest features in the whole volume: extrema above min_sigma (default 5) robust σ outside the origin's disk, each ± pair once. Returns features: length_A, size_sigma (signed: + more pairs than the average structure, − fewer), n_vectors of one sign, length and size (likely symmetry copies), up to 4 vectors_rlu (x/a, y/b, z/c) and vectors_A (Å along a, b, c). Use it after the trust checks (qmax_coverage, symmetry_check, assess_stage pdf).  What a feature means is the user's call.
```

Parameters:

```json
{
  "type": "object",
  "properties": {
    "min_sigma": {
      "type": "number",
      "description": "Smallest |ΔPDF| listed, in robust σ (3–1000; default 5)"
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 30,
      "description": "How many entries, strongest first (default 12)"
    }
  }
}
```

## 12. grain_check

```text
Is there a second grain, and what are the punch's sharp off-lattice peaks? Groups them into orbits of the declared point group and tests the strongest. An orbit within a quarter of the node spacing of a Bragg node is that peak displaced, its offset over |Q| a rotation angle (a lower bound). A second grain is one rotation of the Bragg lattice that indexes most orbits, against random directions; under 2° it is the UB, not a grain. Returns verdict and its numbers. Run the punch first.
```

Parameters:

```json
{
  "type": "object",
  "properties": {
    "top": {
      "type": "number",
      "description": "How many of the strongest orbits to test, 8–120 (default 40)"
    }
  }
}
```

## 13. ub_check

```text
Is the volume's UB right? Fits a UB to the raw volume's Bragg-peak centres (the punch cell's nodes, low |Q| first); it changes no data. Returns verdict, rms_start → rms, cell_start → cell, orientation_change_deg, radial (offset along Q per |Q| band and direction), mean_offset_rlu, origin_shift_rlu. On a symmetrised volume only the changes that commute with its operations are fitted (fit 'symmetric'): the orientation needs the unsymmetrised file. An offset that changes with |Q| is no UB error.
```

Parameters:

```json
{
  "type": "object",
  "properties": {
    "q_max": {
      "type": "number",
      "description": "The nodes' |Q| limit in Å⁻¹ (default: everything the box holds)"
    }
  }
}
```

## 14. compare_laue_classes

```text
Which Laue class does the sample have? Compares by R_int every Laue class the cell's metric allows (within 2%) and whose operations map the grid, on the raw volume as the average reads it, on all measured voxels and the diffuse, each over its noise floor (x_noise). Returns classes, rule, suggestion (or none), flag (the diffuse supports less than the Bragg peaks). Refused on a symmetrised volume. Seconds to minutes. The class is the user's to set: cite classes, rule and flag when you suggest one.
```

Parameters:

```json
{
  "type": "object",
  "properties": {}
}
```

## 15. radial_profile

```text
The median intensity in |Q| shells of one reciprocal cut, for each cleanup stage side by side (raw, ringremoved, braggpunched, backfilled, flattened). Shell medians ignore Bragg peaks but follow powder rings, which are bumps in raw that ring removal should take out without denting the diffuse; after flatten the floor should sit near 0 at every |Q|. Use it to see where in |Q| a stage left or removed signal.
```

Parameters:

```json
{
  "type": "object",
  "properties": {
    "plane": {
      "type": "string",
      "enum": ["hk0", "h0l", "0kl"],
      "description": "hk0 (default), h0l or 0kl"
    },
    "value": {
      "type": "number",
      "description": "Cut position along the fixed axis, in r.l.u. (default 0)"
    },
    "stages": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": ["raw", "ringremoved", "braggpunched", "backfilled", "flattened"]
      },
      "description": "Stages to compare (default every one that exists)"
    },
    "bins": {
      "type": "integer",
      "minimum": 8,
      "maximum": 64,
      "description": "Number of |Q| shells (default 32)"
    }
  }
}
```

## 16. line_profile

```text
Intensity along a straight line parallel to one axis through any stage volume — e.g. along H through (H, 1/3, 0) to see a satellite row, or across a residual ring. Reciprocal stages take H/K/L (r.l.u.); delta_pdf takes x/y/z (Å). Returns sampled points plus the exact maximum, minimum and median.
```

Parameters:

```json
{
  "type": "object",
  "properties": {
    "stage": {
      "type": "string",
      "enum": ["raw", "ringremoved", "braggpunched", "backfilled", "flattened", "delta_pdf"]
    },
    "along": {
      "type": "string",
      "enum": ["H", "K", "L", "x", "y", "z"],
      "description": "The axis the line runs along"
    },
    "at": {
      "type": "object",
      "description": "The other two coordinates on the line (missing: 0), e.g. {\"K\": 0.333, \"L\": 0}",
      "properties": {
        "H": {
          "type": "number"
        },
        "K": {
          "type": "number"
        },
        "L": {
          "type": "number"
        },
        "x": {
          "type": "number"
        },
        "y": {
          "type": "number"
        },
        "z": {
          "type": "number"
        }
      }
    },
    "n_points": {
      "type": "integer",
      "minimum": 16,
      "maximum": 128,
      "description": "Points to return (block-averaged); default 64"
    }
  },
  "required": ["stage", "along"]
}
```

## 17. bragg_peaks

```text
Peaks from the punch stage's fitted Bragg profile: position (HKL and |Q|), intensity, local background, significance, measured width per axis (Å⁻¹), whether each axis is resolution-limited, and anisotropy (largest/smallest principal width). Sort by a property or by distance to an HKL point.
```

Parameters:

```json
{
  "type": "object",
  "properties": {
    "sort_by": {
      "type": "string",
      "enum": ["significance", "intensity", "anisotropy", "width", "q"],
      "description": "Default significance"
    },
    "near_hkl": {
      "type": "array",
      "items": {
        "type": "number"
      },
      "minItems": 3,
      "maxItems": 3,
      "description": "Sort by distance to this (H, K, L) instead"
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 25,
      "description": "Default 10"
    }
  }
}
```

## 18. consistency_details

```text
The run's saved back-FFT check in full: Pearson r and normalised RMS of the inverse-FFT ΔPDF against the cleaned data, r per principal plane, the |Q| and r bands, crop and apodization. pearson_r_even compares the round trip with the data's even part under Q → −Q, what the transform keeps: 1 when it is sound; r against the data is lower by the odd part (odd_share), no fault on unsymmetrised data. Neither says a feature is real.
```

Parameters:

```json
{
  "type": "object",
  "properties": {}
}
```

## 19. run_log

```text
The log of the last pipeline run in this session: each stage's start, skip, result and error lines (how many ring shells were fitted, peaks punched, voxels left unmeasured, the back-FFT r, …) and how the run ended. Use it to explain a result or a failure.
```

Parameters:

```json
{
  "type": "object",
  "properties": {
    "stage": {
      "type": "string",
      "enum": ["symmetry_average", "rings", "punch", "backfill", "flatten", "pdf", "pdf_check"],
      "description": "Only this stage's lines (default all)"
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 60,
      "description": "The last N lines (default 30)"
    }
  }
}
```

## 20. compare_datasets

```text
The same cut measured on several datasets (e.g. temperatures), to see what changes between them. kind=reciprocal compares the stage metrics; kind=dpdf compares the ΔPDF feature metrics and back-FFT r. Up to 6 datasets; default all.
```

Parameters:

```json
{
  "type": "object",
  "properties": {
    "kind": {
      "type": "string",
      "enum": ["reciprocal", "dpdf"]
    },
    "plane": {
      "type": "string",
      "description": "hk0/h0l/0kl for reciprocal; xy/xz/yz for dpdf"
    },
    "value": {
      "type": "number",
      "description": "Cut position (r.l.u. or Å)"
    },
    "dataset_ids": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "From describe_dataset; default all"
    }
  },
  "required": ["kind", "plane", "value"]
}
```

## 21. run_verdict

```text
The verdict on the run that {{achieved}} gives now, computed from this reply's checks: its words (null before any check), each stage's verdict, what needs attention, is not judged or not measured, and the data's problems no setting fixes. Read it before you write whether the run met its goal.
```

Parameters:

```json
{
  "type": "object",
  "properties": {}
}
```

## 22. configure_settings

```text
The Configure page's settings that differ from their defaults, what the next run would use ("(default)": the backend's), and how many are at their defaults; all: true lists every one. They may differ from the settings that made the files on disk. update_settings lists the settings it can change; name them exactly as there.
```

Parameters:

```json
{
  "type": "object",
  "properties": {
    "all": {
      "type": "boolean",
      "description": "Every setting, those at their defaults too"
    }
  }
}
```

## 23. update_settings

```text
Change settings on the Configure page for the next run_pipeline: only those the user named or agreed to, when they ask for a change or to improve or tune the result; when unsure which they mean, ask. A fact about the sample changes only when the user's latest message names it, never to improve a result. The magnetic ion, the |Q| band and the symmetry average (the symmetry* settings) stay with the user: suggest a Laue class with your evidence. Returns each change and the stage to rerun from.
Method choices and thresholds: ringModel (pooled|global_v2|patched|parametric), ringPooledSectors (integer 8–144), ringPooledWindow (number 0.5–30), ringNFourier (integer 0–40), ringGlobalSubtraction (conservative|mean), punchMinSig (number 3–12), punchMode (both|integer|search), punchHGuard (number 0–0.3), punchSearchFloor (number 3–60), punchFootprint (own|profile|ellipsoid), punchProfileNSigma (number 0.1–3), punchSearchMaxWidth (number 1–6), punchMargin (number 0–0.5), punchFitUnconstrained (true|false), backfillMethod (laplace|local|q_shell), flattenQ2 (true|false), flattenFitQMax (number 3–25), flattenEstimator (model|floor|snip), pdfApod (gaussian|hann|none), pdfWindowShape (auto|separable|ellipsoid), pdfWindowSupport (true|false). Facts about the sample: modulation ({"k": "1/3, 0, 0", "order": 1, "form": "points|planes", "half_width": 0.08}, "none" or "default"; satellites G ± m·k left alone (form points) or the planes through them (planes); order m 1–6; several k by ";"), punchSupercellH (integer 1–6; the punch's indexing cell along H: 2 on a doubled cell, the nodes between not punched), punchSupercellK (integer 1–6; along K), punchSupercellL (integer 1–6; along L), edgeTrim (0–3; voxel layers off the raw coverage edge at load, default 1).
```

Parameters:

```json
{
  "type": "object",
  "properties": {
    "changes": {
      "type": "object",
      "description": "Setting → new value, e.g. {\"punchMinSig\": 6}"
    }
  },
  "required": ["changes"]
}
```

## 24. run_pipeline

```text
Run the reduction pipeline on the selected dataset with the Configure page's settings, as the Run button does; the console shows it on its Execution page. Without from_stage, outputs that still follow from the settings and inputs are reused (unless Force is on) and the rest recomputed; with from_stage, that stage and every enabled one after it are recomputed: use it after update_settings. Seconds to minutes. Returns how it ended, the stages computed or reused, and the outputs, to measure next.
```

Parameters:

```json
{
  "type": "object",
  "properties": {
    "from_stage": {
      "type": "string",
      "enum": ["rings", "punch", "backfill", "flatten", "pdf"],
      "description": "Recompute from this stage on; omit to compute only what is missing or stale"
    }
  }
}
```

## 25. tune_pipeline

```text
Search for the best settings, one stage at a time: the current settings run, you propose alternatives, each runs and is judged against the stage's goal, the best is kept, and later stages build on it. Trials run in a tuning folder: the dataset's outputs stay, and the chosen settings land on the Configure page. Minutes (one run per trial). Returns each trial's changes and numbers (no_effect: the current settings' numbers exactly) and each stage's choice and why: quote these, nothing else.
```

Parameters:

```json
{
  "type": "object",
  "properties": {
    "stages": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": ["rings", "punch", "backfill", "flatten", "pdf"]
      },
      "description": "Stages to tune (default all); stages between are re-run once as set"
    },
    "trials_per_stage": {
      "type": "integer",
      "minimum": 2,
      "maximum": 5,
      "description": "Trials per tuned stage, the current settings included (default 3)"
    }
  }
}
```

## 26. regrid_refined_ub

```text
Regrid the raw volume onto its refined UB (ub_check's fit) as a new dataset, <stem>_regridded.nxs beside the raw file, never over one; no pipeline is run. Only when the user's latest message asks for a regrid. Refused, with code and reason, when the turn is under turn_threshold_deg, a symmetrised volume has no unsymmetrised source, or the file or dataset id exists. Returns the new dataset, the turn, the peaks' RMS before → after, and the measured voxels lost outside the old grid.
```

Parameters:

```json
{
  "type": "object",
  "properties": {
    "q_max": {
      "type": "number",
      "description": "The nodes' |Q| limit in Å⁻¹ (default: everything the box holds)"
    }
  }
}
```

## 27. show_in_viewer

```text
Open a cut in the console's viewer so the user can see what you are describing: view=cleanup opens the reciprocal-space cleanup page (all stages side by side) at a reciprocal plane; view=dpdf opens the 3D-ΔPDF page at a real-space section. Use it for the one cut that best shows your point.
```

Parameters:

```json
{
  "type": "object",
  "properties": {
    "view": {
      "type": "string",
      "enum": ["cleanup", "dpdf"]
    },
    "plane": {
      "type": "string",
      "description": "hk0/h0l/0kl for cleanup; xy/xz/yz for dpdf"
    },
    "value": {
      "type": "number",
      "description": "Cut position: r.l.u. for cleanup, Å for dpdf"
    }
  },
  "required": ["view", "plane", "value"]
}
```

## 28. mark_region

```text
Mark a region in the slice views and move them to it, so the user sees a finding (satellites at h ± q, a ring left over, a ΔPDF feature). where: raw, rings, punch, backfill, flatten (h, k, l in r.l.u.) or pdf (x, y, z in Å along a, b, c). shape: box or ellipsoid (center, half_size), or points (up to 12). evidence: the calls showing it, as tool or tool.field (dpdf_peaks.features.0); none, or a region empty or outside the volume, marks nothing. Returns where it is drawn. Cite it by its id (M1, …).
```

Parameters:

```json
{
  "type": "object",
  "properties": {
    "where": {
      "type": "string",
      "enum": ["raw", "rings", "punch", "backfill", "flatten", "pdf"]
    },
    "shape": {
      "type": "string",
      "enum": ["box", "ellipsoid", "points"]
    },
    "center": {
      "type": "array",
      "items": {
        "type": "number"
      },
      "description": "box or ellipsoid: its centre (three coordinates)"
    },
    "half_size": {
      "type": "array",
      "items": {
        "type": "number"
      },
      "description": "box or ellipsoid: its half-widths along the three axes"
    },
    "points": {
      "type": "array",
      "items": {
        "type": "array",
        "items": {
          "type": "number"
        }
      },
      "description": "points: up to 12 positions, three coordinates each"
    },
    "label": {
      "type": "string",
      "description": "What is there, in a few words (at most 48 characters)"
    },
    "evidence": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "The calls whose results show it: tool or tool.field"
    }
  },
  "required": ["where", "shape", "label", "evidence"]
}
```
