# Tool definitions

`toolSpecs(CHAT_TOOLS)`: each tool's name, description and parameters' JSON schema, as sent with every request (24 tools, 22667 characters as JSON).

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
Compute the stage-quality metrics (ring removal, leftover Bragg peaks, backfill seams, flatten floors) on any reciprocal-space cut — the same metrics as the opening context, which used only the L=0 H–K plane. Use it to check whether a finding holds on other planes or off-zero cuts (e.g. L=0.5, or K=1/3 for satellites).
```

Parameters:

```json
{
  "type": "object",
  "properties": {
    "plane": {
      "type": "string",
      "enum": ["hk0", "h0l", "0kl"],
      "description": "hk0 = H–K plane (cut along L), h0l = H–L plane (cut along K), 0kl = K–L plane (cut along H)"
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
Compute the 3D-ΔPDF feature metrics (feature SNR, strong-feature fraction, sign balance, anisotropy and its direction, radial trend) on any real-space section. The opening context used only z=0.
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
Judge a stage's output against its goal, on the three principal planes through the origin plus the records the stage writes — the evaluation the tuning run judges trials by. rings: ring-energy ratio and over-subtraction per plane; punch: leftover peaks, punched fraction, fitted peaks; backfill: seam σ and bright fills; flatten: shell floors in σ; pdf: back-FFT r and RMS, feature SNR per section. Returns the stage's goal with the numbers. stage=all gives each stage's headline numbers; one stage adds the per-plane detail. Use it for a verdict on a stage, after a run, and before and after a change.
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
Check whether the punch and backfill printed a pattern of their own into reciprocal space, on a cut (default: the three principal planes through the origin). Fill bias: each filled hole against the range its measured rim allows, from the diffuse at the hole's edge carried in to its rise toward the node continued linearly (the diffuse often peaks at the nodes, so a sound fill sits above its rim's median); the part outside that range, signed, in the rim's σ and in units of the local diffuse level. Holes filled systematically outside it (systematic_fill_bias: 75 % of them one way, a median of 0.5σ and a fifth of the level or more) add a lattice-periodic texture that the ΔPDF turns into features at lattice vectors. Azimuthal texture: per |Q| shell, how much the sector means vary around the shell before the punch (unpunched voxels) and after the backfill; a ratio near 1 adds none.
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
Check that the forward transform (data → 3D-ΔPDF) does not reach past the measured reciprocal space. When the ΔPDF on disk records it, the verdict is the share of its window's weight on unmeasured space (≲ 1e-3 is clean), with the window's shape and scale. On the three principal planes through the origin it measures the share of each |Q| shell that was measured (finite in raw), the |Q| where shells stop being fully (95 %) measured, and where the data box ends, and compares them with how far the transform's window reaches: the |Q| band if one is set, else the box faces, the coverage edge when the window is tapered to the coverage, or the box corners when apodization is off with a separable window. The reach comes from the Configure page's settings, which may differ from the ones that made the ΔPDF on disk. From the raw volume, raw_counts gives where its counts begin and end in |Q| (beyond those edges most voxels hold no counts) and the box's nearest face; suggested_band is the |Q| band they allow, and band_check says whether a band that is set stays inside the counts. When the counts end inside the box and no band is set, the verdict says so, with the edge and the band they allow (counts_end_inside_box).
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
Check that the 3D-ΔPDF keeps the symmetry its data were declared symmetrised with (with none declared the asymmetry is the data's own and is not judged): the ΔPDF against its image under each operation of the declared point group, an operation and its product with the inversion one entry (equal on the centrosymmetric ΔPDF), those that move c included (none declared: the cell's in-plane ones), on the sections the operation maps onto sections (the x–y sections at z and −z, default z = 0, and the x–z and y–z sections through the origin), else on the voxels it maps from one onto another (tested_on says which; not_tested, any it cannot test), as the RMS of the difference over the RMS, the worst section's. A symmetry the data were symmetrised with holds to about 1e-3 or better when the pipeline kept it; a larger share means a stage broke it, or the sample lacks that operation. Which operations the sample has is the user's to say.
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
Optimise the 3D-ΔPDF viewer's colour range, so the pair-correlation features carry the colour and the FFT ripple around them stays dim. Call it once, without arguments: it measures the three centre sections (xy, xz, yz through the origin; the origin's self-correlation disk left out), sets the limit at the 99.9th percentile of |ΔPDF|, the page's Auto, and lists what the 99.5th and 99.97th percentiles would give without applying them. Pass percentile (99–99.99) or limit_sigma only for a range the user asks for: a limit of a few σ colours the ripple, as the old Auto (the 97th percentile) did. reset returns the viewer to Auto. Quote the applied limit it returns.
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
The 3D-ΔPDF's strongest features, read from the whole volume rather than one section: its local extrema above min_sigma (default 5) robust σ of the volume outside the origin's disk, each with its vector in Å along a, b, c and in lattice units, its sign (+: more pairs at that vector than the average structure has, −: fewer) and its size in σ. The ΔPDF is centrosymmetric, so each ± pair is listed once. Extrema of one sign, length and size are one entry (n_vectors): copies of one correlation under the crystal's symmetry, most likely, though the grouping does not use the symmetry and two correlations can share a length. Use it for the strongest pair correlations with their vectors and signs, after the trust checks (qmax_coverage, symmetry_check on symmetrised data, assess_stage pdf). What size is worth interpreting, and what a feature means, is the user's call (delta-pdf-interpretation). Quote the vectors, signs and sizes it returns.
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
Is there a second grain, and what are the sharp off-lattice peaks the punch's search found? It takes the punch's peak record, groups the off-lattice peaks into symmetry orbits (the declared point group), and tests the strongest two ways. Against the Bragg nodes: an orbit within a quarter of the node spacing of one is that peak displaced, and its offset over |Q| is a rotation angle (symmetrising data whose UB is slightly off makes such copies; the angle is a lower bound). As a rotated copy of the Bragg lattice: a second grain is one rotation that indexes most strong orbits, judged against the same search at random directions; a rotation under 2° is the UB, not a grain. Run the punch first. Quote its verdict and numbers.
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
Is the volume's UB right? On the raw volume it finds each Bragg node's peak (the punch cell gives the Bragg nodes: (2, 2, 2) on a doubled cell), measures its centre, and fits the UB that puts the centres back on their nodes, from low |Q| outward. A volume symmetrised under the operations it declares hides a misorientation as rings around the nodes, not shifts, so there it fits only the changes that commute with the operations (fit 'symmetric': for 6/mmm the scales of the hk plane and of l); otherwise the rotation and the cell together ('both'). radial is the peaks' median offset along Q from their nodes, relative to |Q|, per |Q| band and direction, before and after the fit: a UB error gives the same relative offset at every |Q| along a direction, so one that changes with |Q| is not a UB error, and refining the UB only averages it. mean_offset_rlu is the peaks' mean offset from their nodes in r.l.u., before and after the fit: a UB error averages out over the nodes and the fit removes it, while a shifted HKL origin moves every peak by one vector that stays after the fit (origin_shift_rlu, when that vector makes most of the offset the fit leaves). About ten seconds on a full volume. Quote rms_start → rms, the cell before and after, the angle, what radial shows, and an origin shift when it gives one.
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

## 14. radial_profile

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

## 15. line_profile

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
      "description": "The other two coordinates the line passes through (missing ones are 0), e.g. {\"K\": 0.333, \"L\": 0} for a line along H",
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

## 16. bragg_peaks

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

## 17. consistency_details

```text
The run's saved back-FFT check in full: Pearson r and normalised RMS of the inverse-FFT ΔPDF against the cleaned data, r per principal plane, the |Q| and r bands, crop and apodization. The transform keeps the real part, which is the data's even part under Q → −Q: pearson_r_even compares the round trip with that part and is 1 when the transform is sound, while r against the data is limited by the odd part (odd_share: counting noise on unsymmetrised data), so r below 1 on unsymmetrised data is no fault. Neither says a feature is real.
```

Parameters:

```json
{
  "type": "object",
  "properties": {}
}
```

## 18. run_log

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
      "enum": ["rings", "punch", "backfill", "flatten", "pdf", "pdf_check"],
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

## 19. compare_datasets

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

## 20. configure_settings

```text
The Configure page's current settings — what the next run would use (blank = the backend default). They may differ from the settings that produced the files on disk. Name settings exactly as returned here when you suggest a change.
```

Parameters:

```json
{
  "type": "object",
  "properties": {}
}
```

## 21. update_settings

```text
Change settings on the Configure page; the next run_pipeline uses them and the user sees the fields change. These method choices and thresholds can be changed: ringModel (pooled|global_v2|patched|parametric), ringPooledSectors (integer 8–144), ringPooledWindow (number 0.5–30), ringNFourier (integer 0–40), ringGlobalSubtraction (conservative|mean), punchMinSig (number 3–12), punchMode (both|integer|search), punchHGuard (number 0–0.3), punchSearchFloor (number 3–60), punchFootprint (own|profile|ellipsoid), punchProfileNSigma (number 0.1–3), punchSearchMaxWidth (number 1–6), punchMargin (number 0–0.5), punchFitUnconstrained (true|false), backfillMethod (laplace|local|q_shell), flattenQ2 (true|false), flattenFitQMax (number 3–25), flattenEstimator (model|floor|snip), pdfApod (gaussian|hann|none), pdfWindowShape (auto|separable|ellipsoid), pdfWindowSupport (true|false). These facts about the sample only when the user asks for that change, never to improve a result: punchProtectH (H fractions like "1/3, 2/3", or none; H fractions the off-lattice search leaves alone (its protected planes, e.g. real satellites at H = n ± 1/3); none protects nothing.) punchProtectHalfWidth (number 0–0.25; Half width (r.l.u.) of each protected H plane.) punchSupercellH (integer 1–6; The punch's indexing cell along H: the Bragg nodes are the multiples of this H (2 when the volume is indexed on a doubled cell); the nodes between are superstructure or diffuse, not punched as Bragg peaks.) punchSupercellK (integer 1–6; The punch's indexing cell along K: the Bragg nodes are the multiples of this K (2 when the volume is indexed on a doubled cell); the nodes between are superstructure or diffuse, not punched as Bragg peaks.) punchSupercellL (integer 1–6; The punch's indexing cell along L: the Bragg nodes are the multiples of this L (2 when the volume is indexed on a doubled cell); the nodes between are superstructure or diffuse, not punched as Bragg peaks.) The magnetic ion and |Q| band stay with the user. Change them when the user asks for a change, or asks you to improve or tune the result, and only the settings the user named or agreed to; when unsure which setting the user means, ask instead of guessing. Settings already at the value are left as they are. Returns each change and the stage to rerun from.
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

## 22. run_pipeline

```text
Run the reduction pipeline on the selected dataset with the Configure page's settings, as the Run button does: it writes the dataset's stage outputs, and the console shows the run on its Execution page while it goes. Without from_stage, outputs that already exist are reused (unless the user switched Force on), so it computes what is missing. With from_stage, that stage and every enabled stage after it are recomputed: use it after update_settings. A run takes seconds to minutes. Returns how it ended, which stages were computed or reused, and the outputs that now exist; measure them afterwards.
```

Parameters:

```json
{
  "type": "object",
  "properties": {
    "from_stage": {
      "type": "string",
      "enum": ["rings", "punch", "backfill", "flatten", "pdf"],
      "description": "Recompute from this stage on; omit to compute only what is missing"
    }
  }
}
```

## 23. tune_pipeline

```text
Search for the best settings, one stage at a time: for each stage it runs the current settings, has you propose alternatives, runs each, judges which best meets the stage's goal, keeps it and moves on, so later stages build on the best earlier ones. Trials run in a tuning folder: the dataset's own outputs are not changed, and the chosen settings end up on the Configure page. The user watches the trials in the chat, under this reply, and each run on the Execution page. Takes minutes (one run per trial). Returns every trial's changes and numbers (a trial that matched the current settings' numbers exactly is marked no_effect), and each stage's chosen trial and why: quote these, never numbers the result does not hold.
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
      "description": "Stages to tune (default all); the stages between them are re-run once with their settings"
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

## 24. show_in_viewer

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
