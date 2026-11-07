# Auto mode's replies

What an auto-mode reply reads (auto/prompts.ts): the system prompt with the reply's own round limit, the dataset's summary with the run's digest after it (the plan's outcomes in words and the run's decisions as the since line words them, at their longest: autoSamples.ts), a fixed phase prompt, and the phase's checks seeded (agent.ts) as a round of the app's calls or in the phase message (prompts/seeded.ts). The fix sampled is the Bragg punch's, its check the synthetic crystal's.

Update from web/: `npx vitest run src/llm/__tests__/modelVisible.test.ts -u`, then read the diff.

## The phase prompts

### Fix: rings

```text
Change or tune the ring removal so its check above passes: one update_settings change, or tune_pipeline for this stage. Say what you changed and why, or why no change would help.
```

### Fix: punch

```text
Change or tune the Bragg punch so its check above passes: one update_settings change, or tune_pipeline for this stage. Say what you changed and why, or why no change would help.
```

### Fix: backfill

```text
Change or tune the backfill so its checks above pass: one update_settings change, or tune_pipeline for this stage. Say what you changed and why, or why no change would help.
```

### Fix: flatten

```text
Change or tune the flatten so its check above passes: one update_settings change, or tune_pipeline for this stage. Say what you changed and why, or why no change would help.
```

### Fix: pdf

```text
Change or tune the 3D-ΔPDF so its checks above pass: one update_settings change, or tune_pipeline for this stage. Say what you changed and why, or why no change would help.
```

### Report

```text
Report on this auto run from the checks above, its final ones: each stage's verdict with the numbers it rests on, what changed during the run and why, and what is left for the user to decide.
```

The transcript's line before each (the user turn the chat keeps; later chat history, never the guard's user words): `Auto · fix the ring removal, first of two`, `Auto · fix the Bragg punch, first of two`, `Auto · the report`.

## What a local model is offered (localTools.ts, of the tools each reply holds)

- a fix (26 held; all but run_pipeline and regrid_refined_ub): read_skill, describe_dataset, current_view, measure_reciprocal_cut, assess_stage, grain_check, ub_check, line_profile, bragg_peaks, run_log, run_verdict, configure_settings, update_settings, tune_pipeline, show_in_viewer, mark_region
- the report (24 held; the reading ones): read_skill, describe_dataset, current_view, measure_reciprocal_cut, assess_stage, texture_check, qmax_coverage, symmetry_check, ub_check, radial_profile, line_profile, bragg_peaks, run_log, run_verdict, configure_settings, show_in_viewer, mark_region

## The report's digest at its longest

```text
- auto run so far: preflight done; the run done; the ring removal still needs attention after two fixes; the Bragg punch still needs attention after two fixes; the backfill still needs attention after two fixes; the flatten still needs attention after two fixes; the 3D-ΔPDF still needs attention after two fixes
- the fixes ended at the time limit
- in this auto run, auto mode ran the pipeline from the start; you kept modulation default, declined k = (0, 1/3, 0), order 1, points, ± 0.08 r.l.u.; auto mode applied ringPooledSectors 72 → 32; ran the pipeline from rings; undid ringPooledSectors 32 → 72; ran the pipeline from rings; applied punchMinSig 5 → 6; ran the pipeline from punch
```

## A fix of the punch, its first request: the checks as a round of calls (Ollama, LM Studio, OpenAI)

### 1. user

```text
Context: the dataset as this request found it. Nothing here is measured: the tools measure.
- dataset: synthetic_a
- cell: a = 4, b = 4, c = 4 Å; α = 90, β = 90, γ = 90°
- reciprocal grid: 97 × 97 × 97 voxels, H -3 to 3, K -3 to 3, L -3 to 3 r.l.u.
- raw volume: symmetrised with mmm
- on disk: raw, ringremoved, braggpunched, backfilled, flattened, delta_pdf
- auto run so far: preflight done; the run done; the ring removal still needs attention after two fixes; the Bragg punch needs attention: this is its second fix of two
- in this auto run, auto mode ran the pipeline from the start; you kept modulation default, declined k = (0, 1/3, 0), order 1, points, ± 0.08 r.l.u.; auto mode applied ringPooledSectors 72 → 32; ran the pipeline from rings; undid ringPooledSectors 32 → 72; ran the pipeline from rings; applied punchMinSig 5 → 6; ran the pipeline from punch
```

### 2. assistant

```text
Understood. I will measure with the tools and quote the numbers I rely on.
```

### 3. user

```text
Change or tune the Bragg punch so its check above passes: one update_settings change, or tune_pipeline for this stage. Say what you changed and why, or why no change would help.
```

### 4. assistant

```text

```

Tool calls:

```json
[
  {
    "id": "seed_1",
    "type": "function",
    "function": {
      "name": "assess_stage",
      "arguments": "{\"stage\":\"punch\"}"
    }
  }
]
```

### 5. tool (answers seed_1)

```text
{"punch":{"verdict":"needs attention","criterion":"No Bragg peak missed at a lattice node, and no sharp peak left off the lattice outside the protected planes. Broad maxima are diffuse scattering, and stay.","headline":"1 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.03","total_leftover_peaks":1,"leftover_at_nodes":1,"leftover_off_lattice":0,"leftover_on_protected_planes":0,"leftover_on_protected_planes_sharp":0,"leftover_off_lattice_broad":0,"leftover_off_lattice_sharp":0,"strongest_leftover":{"plane":"hk0","xy":[2,1],"intensity":452,"local_background":21.3,"contrast":21.2,"sigma":374,"fwhm_voxels":[1,1],"broad":false,"hkl":[2,1,0],"at_node":true},"noisy_spikes_skipped":0,"mean_punched_fraction":0.03,"fitted_peaks":14,"per_plane":{"hk0":{"leftover_peaks":1,"at_nodes":1,"off_lattice":0,"on_protected_planes":0,"off_lattice_broad":0,"strongest_leftover":{"xy":[2,1],"intensity":452,"local_background":21.3,"contrast":21.2,"sigma":374,"fwhm_voxels":[1,1],"broad":false,"hkl":[2,1,0],"at_node":true},"punched_fraction":0.0291},"h0l":{"leftover_peaks":0,"at_nodes":0,"off_lattice":0,"on_protected_planes":0,"off_lattice_broad":0,"strongest_leftover":null,"punched_fraction":0.0305},"0kl":{"leftover_peaks":0,"at_nodes":0,"off_lattice":0,"on_protected_planes":0,"off_lattice_broad":0,"strongest_leftover":null,"punched_fraction":0.0305}},"goal":"Remove every sharp peak that should go while punching as little as possible (punched_fraction small): every punched voxel is diffuse signal thrown away and later backfilled. Missed lattice peaks (leftover_at_nodes) must reach 0 on every plane; off-lattice sharp peaks (leftover_off_lattice) are satellites or spurious peaks the search punches unless their H planes are protected: leftover_on_protected_planes of them sit on protected planes and stay by design (whether they are real is the user's call), while the rest are peaks the search left, so fewer of those is better where they are spurious. leftover_off_lattice splits into leftover_off_lattice_sharp (punch candidates) and leftover_off_lattice_broad (FWHM ≥ 5 voxels along a slice axis: diffuse maxima such as short-range order, which are the signal, not peaks to punch). Fewer leftovers win only if the punched fraction does not grow substantially; lowering the significance or the search floor punches noise and diffuse maxima, raising them leaves weak peaks."},"measured_on":["H–K plane at L = 0","H–L plane at K = 0","K–L plane at H = 0"]}
```

## The same, the checks in the message (Claude with adaptive thinking, Gemini)

### 3. user

```text
Checks already run for this request, as tool calls (each result as its tool returned it):

[step 1] assess_stage {"stage":"punch"}
{"punch":{"verdict":"needs attention","criterion":"No Bragg peak missed at a lattice node, and no sharp peak left off the lattice outside the protected planes. Broad maxima are diffuse scattering, and stay.","headline":"1 missed at nodes · 0 sharp off-lattice · 0 broad maxima kept · punched 0.03","total_leftover_peaks":1,"leftover_at_nodes":1,"leftover_off_lattice":0,"leftover_on_protected_planes":0,"leftover_on_protected_planes_sharp":0,"leftover_off_lattice_broad":0,"leftover_off_lattice_sharp":0,"strongest_leftover":{"plane":"hk0","xy":[2,1],"intensity":452,"local_background":21.3,"contrast":21.2,"sigma":374,"fwhm_voxels":[1,1],"broad":false,"hkl":[2,1,0],"at_node":true},"noisy_spikes_skipped":0,"mean_punched_fraction":0.03,"fitted_peaks":14,"per_plane":{"hk0":{"leftover_peaks":1,"at_nodes":1,"off_lattice":0,"on_protected_planes":0,"off_lattice_broad":0,"strongest_leftover":{"xy":[2,1],"intensity":452,"local_background":21.3,"contrast":21.2,"sigma":374,"fwhm_voxels":[1,1],"broad":false,"hkl":[2,1,0],"at_node":true},"punched_fraction":0.0291},"h0l":{"leftover_peaks":0,"at_nodes":0,"off_lattice":0,"on_protected_planes":0,"off_lattice_broad":0,"strongest_leftover":null,"punched_fraction":0.0305},"0kl":{"leftover_peaks":0,"at_nodes":0,"off_lattice":0,"on_protected_planes":0,"off_lattice_broad":0,"strongest_leftover":null,"punched_fraction":0.0305}},"goal":"Remove every sharp peak that should go while punching as little as possible (punched_fraction small): every punched voxel is diffuse signal thrown away and later backfilled. Missed lattice peaks (leftover_at_nodes) must reach 0 on every plane; off-lattice sharp peaks (leftover_off_lattice) are satellites or spurious peaks the search punches unless their H planes are protected: leftover_on_protected_planes of them sit on protected planes and stay by design (whether they are real is the user's call), while the rest are peaks the search left, so fewer of those is better where they are spurious. leftover_off_lattice splits into leftover_off_lattice_sharp (punch candidates) and leftover_off_lattice_broad (FWHM ≥ 5 voxels along a slice axis: diffuse maxima such as short-range order, which are the signal, not peaks to punch). Fewer leftovers win only if the punched fraction does not grow substantially; lowering the significance or the search floor punches noise and diffuse maxima, raising them leaves weak peaks."},"measured_on":["H–K plane at L = 0","H–L plane at K = 0","K–L plane at H = 0"]}

Change or tune the Bragg punch so its check above passes: one update_settings change, or tune_pipeline for this stage. Say what you changed and why, or why no change would help.
```
