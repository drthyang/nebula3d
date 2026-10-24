# Tuning prompts

What tune_pipeline asks the model, stage by stage (tune/prompts.ts), shown for the punch with the default settings and synthetic trials: what to try, then which trial was best.

Update from web/: `npx vitest run src/llm/__tests__/modelVisible.test.ts -u`, then read the diff.

## What to try

### 0. system

```text
You tune nebula3d, a pipeline that cleans a 3D reciprocal-space diffuse-scattering volume
and Fourier-transforms it into a 3D-ΔPDF. Stages run in order: ring removal, Bragg punch,
backfill, background correction (flatten), ΔPDF. You tune one stage at a time; each stage reads the output the
earlier stages settled on. For each stage you are asked to propose settings to try, then
to pick the best trial from metrics measured on the three principal planes. Diffuse
scattering is the signal: never trade it away for a cleaner-looking number. Change as
little as possible, and keep the user's settings unless a trial is clearly better.
Reply with one JSON object only, no other text.
```

### 1. user

```text
Stage: Bragg punch.
Goal: Remove every sharp peak that should go while punching as little as possible (punched_fraction small): every punched voxel is diffuse signal thrown away and later backfilled. Missed lattice peaks (leftover_at_nodes) must reach 0 on every plane; off-lattice sharp peaks (leftover_off_lattice) are satellites or spurious peaks the search punches unless their H planes are protected: leftover_on_protected_planes of them sit on protected planes and stay by design (whether they are real is the user's call), while the rest are peaks the search left, so fewer of those is better where they are spurious. leftover_off_lattice splits into leftover_off_lattice_sharp (punch candidates) and leftover_off_lattice_broad (FWHM ≥ 5 voxels along a slice axis: diffuse maxima such as short-range order, which are the signal, not peaks to punch). Fewer leftovers win only if the punched fraction does not grow substantially; lowering the significance or the search floor punches noise and diffuse maxima, raising them leaves weak peaks.

Settings you may change (use these names exactly):
- punchMinSig (number in [3, 12]; default 5): Significance (standard errors, corrected for picking the brightest voxel) an integer-node peak must reach to be punched. Lower punches weaker peaks and risks punching noise or diffuse; higher leaves weak peaks.
- punchMode (one of both | integer | search; default both): Which peaks to punch: integer (Bragg nodes of the lattice only), search (a |Q|-shell search for any sharp peak, e.g. satellites), or both (default).
- punchHGuard (number in [0, 0.3]; default 0.12): Integer-node punches only: each node's punch stops this far (r.l.u.) from the node's H plane, so the H planes between nodes (e.g. satellites at H = n ± 1/3) stay unpunched. 0 turns the guard off and lets every node's punch run along H, discarding the diffuse there. Not the off-lattice search's protected H planes, which are a fact about the sample set on the Configure page.
- punchSearchFloor (number in [3, 60]; default 27): Off-lattice search floor, in units of the diffuse scatter: a peak off the integer nodes must stand this far above its |Q| shell and its neighbourhood. Lower punches weaker spurious peaks; too low punches diffuse maxima.
- punchFootprint (one of own | profile | ellipsoid; default own): Punch footprint. own (default): each peak punched to its own measured width, as far as it stays above the noise, so a sharp spike on a broad maximum takes a small punch. profile: every peak shares the dataset's learned Bragg profile (a consistent width), so strong peaks, spikes included, get wide punches. ellipsoid: the fixed resolution ellipsoid scaled with intensity.
- punchProfileNSigma (number in [0.1, 3]; default 0.5): own and profile footprints: punch out to where each peak's tail falls to this × the local noise. Lower reaches further down the wings of very strong peaks (fewer wing pieces left for the search), at the cost of more punched diffuse; higher punches tighter.
- punchSearchMaxWidth (number in [1, 6]; default 0): Off-lattice search width test: a candidate broader than this × the dataset's Bragg width along any axis is left as diffuse (a short-range-order maximum) instead of punched. 0 (blank) is off and punches every candidate; spurious reflections are as sharp as Bragg peaks, so 2 keeps them punched while broad diffuse maxima stay.
- punchMargin (number in [0, 0.5]; default 0.02): Extra margin added around each punch footprint. Larger removes peak tails but discards more diffuse.
- punchFitUnconstrained (true | false; default false): ellipsoid footprint only: do not floor/cap the Bragg covariance-fit radii at the resolution limits. The profile footprint replaces those radii with the profile's, so there it changes nothing.

Current settings: {"punchMinSig":5,"punchMode":"both","punchHGuard":0.12,"punchSearchFloor":27,"punchFootprint":"own","punchProfileNSigma":0.5,"punchSearchMaxWidth":0,"punchMargin":0.02}
Settings already chosen for earlier stages: {"rings":{"ringModel":"pooled","ringPooledSectors":72,"ringPooledWindow":5}}
Trials so far (trial 1 = the current settings): [{"trial":1,"settings":{"punchMinSig":5,"punchMode":"both","punchHGuard":0.12,"punchSearchFloor":27,"punchFootprint":"own","punchProfileNSigma":0.5,"punchSearchMaxWidth":0,"punchMargin":0.02},"metrics":{"leftover_at_nodes":1,"leftover_off_lattice_sharp":0,"leftover_off_lattice_broad":2,"mean_punched_fraction":0.031}}]

Propose up to 2 new settings to try, each different from every trial so far and
each changing as few settings as possible, with a one-sentence reason tied to the metrics.
Reply as {"candidates": [{"changes": {"<setting>": <value>}, "why": "<reason>"}]}.
If the current settings already meet the goal, reply {"candidates": []}.
```

## Which trial was best

### 0. system

```text
You tune nebula3d, a pipeline that cleans a 3D reciprocal-space diffuse-scattering volume
and Fourier-transforms it into a 3D-ΔPDF. Stages run in order: ring removal, Bragg punch,
backfill, background correction (flatten), ΔPDF. You tune one stage at a time; each stage reads the output the
earlier stages settled on. For each stage you are asked to propose settings to try, then
to pick the best trial from metrics measured on the three principal planes. Diffuse
scattering is the signal: never trade it away for a cleaner-looking number. Change as
little as possible, and keep the user's settings unless a trial is clearly better.
Reply with one JSON object only, no other text.
```

### 1. user

```text
Stage: Bragg punch.
Goal: Remove every sharp peak that should go while punching as little as possible (punched_fraction small): every punched voxel is diffuse signal thrown away and later backfilled. Missed lattice peaks (leftover_at_nodes) must reach 0 on every plane; off-lattice sharp peaks (leftover_off_lattice) are satellites or spurious peaks the search punches unless their H planes are protected: leftover_on_protected_planes of them sit on protected planes and stay by design (whether they are real is the user's call), while the rest are peaks the search left, so fewer of those is better where they are spurious. leftover_off_lattice splits into leftover_off_lattice_sharp (punch candidates) and leftover_off_lattice_broad (FWHM ≥ 5 voxels along a slice axis: diffuse maxima such as short-range order, which are the signal, not peaks to punch). Fewer leftovers win only if the punched fraction does not grow substantially; lowering the significance or the search floor punches noise and diffuse maxima, raising them leaves weak peaks.

Trials (trial 1 = the user's settings): [{"trial":1,"settings":{"punchMinSig":5,"punchMode":"both","punchHGuard":0.12,"punchSearchFloor":27,"punchFootprint":"own","punchProfileNSigma":0.5,"punchSearchMaxWidth":0,"punchMargin":0.02},"metrics":{"leftover_at_nodes":1,"leftover_off_lattice_sharp":0,"leftover_off_lattice_broad":2,"mean_punched_fraction":0.031}},{"trial":2,"settings":{"punchMinSig":4,"punchMode":"both","punchHGuard":0.12,"punchSearchFloor":27,"punchFootprint":"own","punchProfileNSigma":0.5,"punchSearchMaxWidth":0,"punchMargin":0.02},"metrics":{"leftover_at_nodes":0,"leftover_off_lattice_sharp":0,"leftover_off_lattice_broad":2,"mean_punched_fraction":0.033}}]

Pick the trial that best meets the goal. Keep trial 1 unless another is clearly better;
a small gain in one number is not worth a change. Quote the numbers behind your choice.
Reply as {"best": <trial number>, "why": "<two sentences>"}.
```
