# NEBULA Pilot evals

How well NEBULA Pilot, the console's agent, reaches the answers the research
rounds established on a measured volume, model by model: a hexagonal neutron
volume from TOPAZ, symmetrised by the NeXus Viewer, together with its
unsymmetrised export.

Each scenario is one question. It goes through the app's own agent loop, with
the messages the chat panel builds and the console's tools running against the
native server. Deterministic checks grade the run on two things:

- **what the model called:** a call it must make counts only when it ran
  without an error, while a call it must not make counts if it was attempted at
  all;
- **what it answered:** the text is read sentence by sentence, and a sentence
  that negates (no, not, never, without…) does not count as asserting what it
  mentions.

Every number an answer must quote is compared with that run's own tool results,
not with a value written into the test. The one exception is `q-band-from-raw`'s
lower edge, checked against the 0.55 Å⁻¹ band the run used. A run passes only when every check
passes. The suite lives in `web/src/llm/evals/`.

A second question, whether the Pilot helps (against the default pipeline, and with
and without its skills), is asked on synthetic cases with a planted truth, in
[the validation](#does-the-pilot-help-validation-on-synthetic-cases) at the end of
this page.

## Scenarios

| Scenario | Question | The answer the research established | Checks |
| --- | --- | --- | --- |
| `rings-left` | Is the powder-ring removal clean on this run? | A powder ring is left, on two of the three planes. Bumps seen on one plane only are the crystal's own scattering. TOPAZ has no aluminium powder-ring background, so rings on this set are an anomaly to report and trace, not routine cleanup. | `assess_stage` for the rings; quotes the ring's \|Q\|; says a ring is left |
| `punch-missed` | Did the Bragg punch remove every peak it should have? | Some lattice peaks were missed at nodes. The broad maxima are kept as diffuse scattering. | `assess_stage` for the punch; quotes the count; says peaks were missed |
| `pdf-window-coverage` | Does the ΔPDF's transform window stay inside the measured space? | Yes: its weight on unmeasured space is far under the 10⁻³ limit. | `qmax_coverage`; quotes the weight; says it stays inside |
| `pdf-separable-refused` | Should I switch to a separable window for a higher SNR? | No. It would reach unmeasured space and break the six-fold symmetry; the tuner refused it. | No setting changed and no run started; advises keeping the ellipsoid; says why |
| `symmetry-kept` | Did the ΔPDF keep the cell's hexagonal symmetry? | Yes: every in-plane operation holds. | `symmetry_check`; says it is kept |
| `q-band-from-raw` | What \|Q\| band should the ΔPDF use? | Where the raw counts begin and end. | `qmax_coverage`; quotes both edges |
| `no-second-grain` | Is there a second grain? | No. Most of the strongest off-lattice orbits are Bragg peaks displaced by a UB that is off. | `grain_check`; says there is no second grain and never claims one; quotes the angle |
| `ub-symmetrised` | Is the UB of this volume right? | It can't be fully judged here: a symmetrised volume hides a misorientation, so the orientation needs the unsymmetrised file. | `ub_check`; says the unsymmetrised data are needed |
| `ub-misoriented` | (unsymmetrised export) Is the UB right? How far off? | It is turned by under a degree; the tool reports the angle and the refined cell. | `ub_check`; quotes the angle and a |
| `skill-punch-change` | Raise the punch's minimum significance to 6. | The punch's skill is read first; the change then goes through. | `read_skill` for `bragg-node-audit` before `update_settings`; the change made |
| `skill-pdf-change` | Use the Hann apodization window for the 3D-ΔPDF. | The ΔPDF's skill is read first; the change then goes through. | `read_skill` for `delta-pdf-interpretation` before `update_settings`; the change made |
| `skill-flatten-change` | Turn on the flatten's b·Q² term. | The flatten's skill is read first; the change then goes through. | `read_skill` for `reduction-qc` before `update_settings`; the change made |

The three `skill-…` scenarios test the skills' firm rule (`web/src/llm/skills.ts`).
They came after the results below, so the CI replay plays them but no live model
has yet.

## Held-out volumes and injected faults

The scenarios above were written on one measured volume, so passing them can
mean that the prompts and checks fit that volume. The held-out set tests the
same loop on data no eval, tuning or prompt was written on: a variant of the
built-in synthetic crystal (another cell, stronger short-range order, another
seed, no aluminium rings), with one fault injected per volume at a known size
(`nebula3d.faults`). Each answer is graded against the run's own tool results,
as above, and against the size that was put in. That truth is known by
construction, so the set grades the tools as well as the model.

| Scenario | Volume | The fault | Checks |
| --- | --- | --- | --- |
| `heldout-ub-turned` | `heldout-misoriented` | The UB turned by 0.6° about [1 1 0] | `ub_check`; quotes the angle it measured, and within 0.15° of 0.6°; says the UB is off |
| `heldout-ub-right` | `heldout-rocksalt` | None | `ub_check`; says the UB is right; never claims a misorientation |
| `heldout-origin-shifted` | `heldout-shifted` | The HKL origin off by (0.03, 0.02, 0) r.l.u., which no UB removes | `ub_check`; points at the origin or how \|Q\| was assigned; never calls the UB wrong |
| `heldout-coverage-edge` | `heldout-coverage` | No counts past 4.511 Å⁻¹ (70 % of the box's inscribed \|Q\|) | `qmax_coverage`; quotes the counts' upper edge, and within 0.2 Å⁻¹ of 4.511 |
| `heldout-rings-found` | `heldout-rings` | Powder rings at 2.45 and 3.65 Å⁻¹ | `assess_stage` for the rings; quotes both, within 0.1 Å⁻¹; says a ring is left |

`examples/make_eval_volumes.py` writes the five volumes. The CI replay
(`heldout.test.ts`, part of `npm test`) plays each scenario with a good and a
bad script against tool results recorded on them (`fixtures/heldout.json`). It
also checks what the tools read against the faults. No live model has run the
set yet. The measured set's fixture (in `web/src/llm/evals/fixtures/`) was recorded
before the 3D ring rule, and re-recording it needs the user's data.

What the tools read, against what was put in:

- **The turned UB:** `ub_check` measured 0.602° of the 0.6°, and the peaks' RMS
  offset fell from 0.0492 to 0.0016 Å⁻¹. On the clean volume it measured
  0.001°.
- **The shifted origin:** the fit removed none of the offset (RMS 0.0583 Å⁻¹
  before and after, against a voxel of 0.0806 Å⁻¹), and `ub_check` says that no
  UB change explains it.
- **The cut coverage:** the raw counts' upper edge reads 4.507 Å⁻¹, against
  4.511, and the suggested band is 0–4.5 Å⁻¹.
- **The rings:** the ring removal confirms both as powder rings (each rises in
  nearly every direction over the sphere) at their |Q| (2.447 and 3.655 Å⁻¹),
  and by construction removes 95 % of the first and 96.5 % of the second. The
  ring check still flags the first on hk0 alone, a residual of 0.149 of the
  level there. On that plane the crystal's own rods lift the profile at the
  same |Q|, and a residual cannot tell the two apart.

The set also found two faults in the ring tools, both now fixed by the rule
the user chose on 11 October 2026 (`nebula3d.preprocessing.ring_isotropy`,
[powder_rings.md](algorithms/powder_rings.md)):

- **The ring check read short-range-order diffuse as rings.** On the clean
  volume, with no ring, it said "needs attention", with rings at 1.68, 3.16,
  4.59, 5.52 and 7.08 Å⁻¹: the crystal's own diffuse scattering, mostly its
  short-range order, lifting the median radial profile in shells. Its rule
  that "only rings seen on two or more planes count" could not tell them
  apart. On a cubic crystal hk0, h0l and 0kl are equivalent planes, so the
  crystal's own scattering shows on all three; under hexagonal or tetragonal
  symmetry h0l and 0kl are equivalent. A bump now counts as a ring only if it
  rises in nearly every direction over the sphere, judged in 3D on the raw
  volume, and the clean volume reads "meets its goal".
- **The default ring removal took diffuse from a crystal with no rings.** On
  the clean volume it subtracted four shells: 3 % of the intensity, about a
  fifth of the diffuse between 1.7 and 1.9 Å⁻¹ and a third near 4.1 Å⁻¹. The
  built-in demo crystal with its aluminium rings left out lost 0.5 %; with the
  held-out variant's stronger order, 4 %. The removal now subtracts only the
  shells confirmed as rings, so none of these volumes loses any intensity, and
  the demo volume's aluminium rings are removed as before.

## Running it

- **CI replay** (`evals.test.ts`, part of `npm test`). A scripted model plays
  each scenario against tool results recorded on the eval datasets
  (`web/src/llm/evals/fixtures/`), through the real loop and graders. A good script must
  pass every check, and the agent's own answer checks
  (`web/src/llm/answerChecks.ts`) on its first answer. A bad script, the failure
  as models made it, must fail the checks named for it. Where the answer checks
  catch that failure too, the replay asserts their note.
- **Real models** (`live.test.ts`). With the native server serving the eval
  datasets:

  ```bash
  cd web && NEBULA_EVAL=1 NEBULA_EVAL_BASE_URL=http://localhost:11434/v1 NEBULA_EVAL_MODEL=gemma4:26b NEBULA_EVAL_OUT=../docs/evals/results/ollama-gemma4-26b.json npm run eval:agent
  ```

  `NEBULA_EVAL_ONLY` takes scenario ids, `NEBULA_EVAL_REPEAT` runs per scenario.
  A Claude base URL reads `ANTHROPIC_API_KEY` from the environment; the key is
  never written out.
- **The held-out set:** write the volumes into a data root of their own, serve
  it, and run with `NEBULA_EVAL_SET=heldout`:

  ```bash
  DATA_ROOT=/tmp/nebula-heldout .venv/bin/python examples/make_eval_volumes.py
  ```

  Run each volume once with the default settings. Then `cd web &&
  NEBULA_EVAL_PROBE_HELDOUT=1 NEBULA_EVAL_API=<that server> npx vitest run
  src/llm/evals/heldoutProbe.test.ts` records its fixture.
- **The local tier** (`cd web && npm run eval:local -- <base-url> <model>
  <label>`, `web/scripts/eval-local.sh`): one local model through the
  scenarios and the held-out fault scenarios, three runs each, each set on its
  own backend (`NEBULA_EVAL_API`, `NEBULA_EVAL_HELDOUT_API`), then the
  acceptance (`web/scripts/eval-acceptance.mjs`):
  - at least 80 % of the model's runs pass;
  - no reply reaches the round cap, and the loop guard ends none;
  - no run ends in an exception. A run the model server failed after its
    retries (a crash, out of memory, a stall) ends in a note instead, and is
    listed by kind.

  The models are qwen3.8-27b in LM Studio, loaded at a 32,768-token context,
  and gemma4:26b in Ollama. The Mac is shared: the script first shows what the
  model servers hold and how much memory is free, stops below 15 %, and never
  unloads a model. Before the local-model work, on the nine scenarios of the
  time: qwen3.8-27b passed 12/27 runs with 15 exceptions, qwen3:32b 17/27 and
  gemma4:26b 15/27 (below).

  The full records, with every tool call, result and answer, stay on the
  machine (`web/.eval-runs/<date>/`, ignored by git): on the measured volume
  they hold figures from unpublished data. Their summaries go to
  [`docs/evals/local/<date>/`](evals/local/): per run, whether it passed, the
  names of the checks it failed, how the model server failed it if it did,
  whether it ended in an exception, at the round cap or by the loop guard, and
  its time and tokens (`web/scripts/eval-records.mjs`). The 10 October runs
  are there as the baseline, and the before/after report reads the folders:

  ```bash
  cd web && node scripts/eval-report.mjs --before ../docs/evals/local/2026-10-10/*.json --after ../docs/evals/local/<date>/*.json
  ```
- **Tables:** `node web/scripts/eval-table.mjs` with the five records, not the
  `-pilot` one: `docs/evals/results/{claude-sonnet-5-5,claude-haiku-5-5,ollama-gemma4-26b,ollama-qwen3-32b,lmstudio-qwen3.8-27b}.json`.
- **Re-recording the measured set's fixture:** `cd web && NEBULA_EVAL_PROBE=1 npx vitest run src/llm/evals/probe.test.ts`.

## Results

Measured on 10 and 11 October 2026 on one Mac (68.7 GB unified memory),
against the native server, before the skills and the answer checks existed: a
rerun would show what they change. Each scenario ran three times per model, at
temperature 0.2 (the Claude models take no sampling parameters), with a
20-minute limit per run. Raw records, with every tool call, its result and
the answer, are in [`docs/evals/results/`](evals/results/). They name no
sample: the runner replaces a sample written as a formula in a dataset id with
a neutral label (sampleA, sampleB, …) before it writes a record
(`web/src/llm/evals/scrub.ts`).

| Scenario | claude-sonnet-5-5 (Anthropic) | claude-haiku-5-5 (Anthropic) | gemma4:26b (Ollama) | qwen3:32b (Ollama) | qwen/qwen3.8-27b (LM Studio) |
| --- | :---: | :---: | :---: | :---: | :---: |
| `rings-left` | ✓ 3/3 | ✓ 3/3 | ✗ 0/3 | ✗ 0/3 | ◐ 1/3 (2 errors) |
| `punch-missed` | ✓ 3/3 | ✓ 3/3 | ✗ 0/3 | ✗ 0/3 | ✗ 0/3 (3 errors) |
| `pdf-window-coverage` | ✓ 3/3 | ✓ 3/3 | ✓ 3/3 | ✓ 3/3 | ✓ 3/3 |
| `pdf-separable-refused` | ✓ 3/3 | ✓ 3/3 | ✗ 0/3 | ✗ 0/3 | ◐ 1/3 (2 errors) |
| `symmetry-kept` | ✓ 3/3 | ✓ 3/3 | ✓ 3/3 | ✓ 3/3 | ◐ 1/3 (2 errors) |
| `q-band-from-raw` | ✓ 3/3 | ✓ 3/3 | ✓ 3/3 | ✓ 3/3 | ✗ 0/3 (3 errors) |
| `no-second-grain` | ✓ 3/3 | ✓ 3/3 | ✓ 3/3 | ✓ 3/3 | ◐ 2/3 (1 error) |
| `ub-symmetrised` | ✓ 3/3 | ✓ 3/3 | ✗ 0/3 | ◐ 2/3 | ✓ 3/3 |
| `ub-misoriented` | ✓ 3/3 | ✓ 3/3 | ✓ 3/3 | ✓ 3/3 | ◐ 1/3 (2 errors) |

| Model | Passed | Failed on the checks | Errors (crash, out of memory, timeout) | Median time per run | Mean tokens per run (in / out) | Mean cost per run |
| --- | :---: | :---: | :---: | ---: | ---: | ---: |
| claude-sonnet-5-5 (Anthropic) | 27/27 | 0 | 0 | 12 s | 34,187 / 1,406 | $0.0245 |
| claude-haiku-5-5 (Anthropic) | 27/27 | 0 | 0 | 9 s | 32,621 / 1,189 | $0.0012 |
| gemma4:26b (Ollama) | 15/27 | 12 | 0 | 27 s | 17,332 / 870 | local |
| qwen3:32b (Ollama) | 17/27 | 10 | 0 | 365 s | 16,646 / 1,227 | local |
| qwen/qwen3.8-27b (LM Studio) | 12/27 | 0 | 15 | 326 s | – | local |

Costs use Anthropic's published prices, fetched 2026-10-10: Sonnet 5.5 at $2
input, $10 output and $0.10 cache hits per million tokens; Haiku 5.5 at $0.10,
$0.50 and $0.01. Claude requests cache the system prompt and tools, plus an
automatic breakpoint that follows the conversation, so about 90 % of their
input tokens were cache hits. The Claude runs cost about $0.70 in all,
including a one-run pilot on Haiku (`claude-haiku-5-5-pilot.json`).

- **Claude Sonnet 5.5 and Haiku 5.5 pass every scenario, 27/27 each.** That
  includes the four the local models miss.
- **gemma4:26b misses the scenarios that need more than one tool's verdict.**
  - On the ring removal and the punch, it answers from the opening hk0 cut and
    never calls `assess_stage`. So it misses the ring and the peaks that only
    show on the other two planes.
  - On the two questions that need reasoning from a tool's caveat, it doesn't
    take the caveat in. It advises against the separable window, but because
    the SNR is already high, not because the window reaches unmeasured space or
    breaks the symmetry. It also leaves out that a symmetrised volume hides the
    orientation.
  - It passes the five scenarios a single dedicated tool answers: window
    coverage, symmetry, the |Q| band, the second grain and the misorientation.
- **qwen3:32b (Ollama) has the same blind spot as gemma4, and passes 17/27.**
  - It never calls `assess_stage` for the rings or the punch and answers from
    the opening cut.
  - Asked about the separable window, it twice changed the settings and started
    a run (stubbed, so graded and never sent), and once advised without saying
    to keep the ellipsoid.
  - It passes the single-tool scenarios. In one of three runs on the
    symmetrised UB it called `grain_check` instead of `ub_check`.
  - Its times say little about the model. It shared Ollama with another
    benchmark that used gemma4:26b, so most requests waited for the two models
    to swap in memory. Two `pdf-separable-refused` runs also include pauses of
    4.7 and 2.4 minutes, while the machine recorded a demo.
- **qwen3.8-27b (LM Studio) passed all 12 of its runs that finished.** The other
  15 ended in GPU out-of-memory crashes inside LM Studio, or at the 20-minute
  limit. This happened while the machine also served other model servers, so
  those 15 measure the machine's memory, not the model.
- **One early gemma4 run took an action.** It switched the window and started a
  pipeline run on the eval dataset. The harness now stubs `run_pipeline` and
  `tune_pipeline`: the call is graded, never sent.
- **One grader fix after the runs.** A correct Sonnet answer wrote "five orbits
  are too few to show a second grain", which the grader read as claiming one.
  Every record was then re-graded with the current checks
  (`NEBULA_EVAL_REGRADE`); only that run changed.
- **Not run:**
  - LM Studio's muse-glimmer was not loaded, and these runs never load LM Studio
    models.
  - Claude Opus 5.5 was not needed: Sonnet passed everything.

## Does the Pilot help? Validation on synthetic cases

The scenarios above ask whether the Pilot reaches the answers the research
established on one measured volume. This asks the question that matters: given a
volume it has not seen, does the Pilot take it to a better 3D-ΔPDF than the
default pipeline, does it find the fault the volume has, and does it do harm. The
volumes are synthetic, so the truth is known by construction. A result here says
what the Pilot does on a variant of the built-in demo crystal with one fault of
a known size, not how well it does on a measured volume. The code is
`nebula3d.validation` (Python: the cases, the scoring, arms A and D) and
`web/src/llm/evals/validation*.ts` (the Pilot's arms, their graders, the records).
[pilot-review.md](pilot-review.md) is the review of the tools and skills this
began with.

### The arms

| Arm | What runs |
| --- | --- |
| **A** | The default pipeline, no agent: Run with nothing configured, three times |
| **B** | The Pilot as shipped, for each model: its tools, skills and guardrails, and whatever tools the shipped code offers that model. A local model is offered the reading tools and those its question is about (`localTools.ts`), 23 of the 24 for this task (`compare_datasets` is withheld), and more as it calls them; the validation does not bypass that |
| **C** | B without its skills and nothing else: `read_skill` is not offered and the system prompt lists no skill; the skill gate (a stage's settings change only after its skill is read) is counted as passed, so C may change what B may. A test (`validationArms.test.ts`) runs both through the real agent loop and shows their requests differ only by `read_skill` and the skills' listing |
| **D** | The planted truth: the crystal's own noise-free diffuse scattering through the same transform on the same support. It is the reference, and a check that the scorer passes it on every case |

B and C get the same task, blind to the case, and one dataset each: its own, under
an opaque name (`v3fa91c_B2`), so that no tool shows a model the fault, the split
or another case. The task:

> This is a new single-crystal diffuse-scattering volume. Take it to a 3D-ΔPDF you
> would trust for analysis. Run the pipeline, check every stage and the data
> themselves (the orientation, the coverage, powder rings, the background), fix what
> the settings you may change can fix and run again, and report any problem with the
> data that the settings cannot fix. End with: the problems you found (or that you
> found none), what you changed and why, and the strongest pair correlations in the
> 3D-ΔPDF with their vectors and signs.

### The cases, and the split

Every case is the demo crystal (a rock-salt variant: its short-range order,
thermal diffuse scattering and rods) with **planted pair correlations** at known
vectors and signs, the measurement's own additions (radial background, Bragg
peaks, beam spot, counting noise) and one fault. Eight families, each in a dev and
a test case: 16 cases.

| Family | What is planted or broken | Dev case |
| --- | --- | --- |
| `control` | Nothing: the correlations must come through and nothing may be reported | none |
| `ub` | The UB turned: report the angle; no setting fixes it | 0.6° about [1 1 0] |
| `origin` | The HKL origin shifted, which no UB undoes: report it as the origin, not the UB | (0.03, 0.02, 0) r.l.u. |
| `coverage` | The counts end inside the box: the window must stay on measured space; report the edge | counts end at 4.511 Å⁻¹ (70 % of the box's face) |
| `rings` | Powder rings: remove and report them | two rings, 2.2 and 4.05 Å⁻¹ |
| `shell` | A diffuse shell at one \|Q\| that is the crystal's own (not a ring): keep it | 2.9 Å⁻¹ |
| `flatten` | A background rising as \|Q\|², which the default flatten leaves as a pedestal | b = 0.006 |
| `rings-shell` | Both: remove the one, keep the other | both of the above |

**dev** is for improving the tools, the skills and the prompts. **test** is held
out: each of its cases has another crystal (cell, order, seed, planted vectors) and
another fault size, so what is learned on dev cannot fit it by its numbers, and
its numbers are read once, to be reported. Five tests enforce this:

- every command that reads the test split needs `--report`
  (`NEBULA_VALIDATION_REPORT=1` for the live runner): `test_the_test_split_needs_report`,
  `casesToRun` in `validation.test.ts`;
- nothing that may be tuned names a test case
  (`test_nothing_tuned_names_a_test_case`). The scan reads `web/src`,
  `web/scripts`, `src`, `tests`, `examples`, `scripts`, `docs`, `.claude/skills`
  and the top-level Markdown. A case may be named only where the cases are
  defined (`src/nebula3d/validation/`), in the validation's records
  (`docs/evals/validation/`), in this page's *Arm A* section, which reports the
  test results, and in the manifest the web harness grades against
  (`fixtures/validation-cases.json`). It skips binary files, other people's
  packages (`node_modules`) and generated files (bytecode, caches,
  `*.egg-info`), but it reads a test's `__snapshots__`. It matches each test
  case's id and opaque label; the test crystal's seed after the word *seed*; its
  planted vectors only when all of them are written as vectors in one file,
  since one alone is a common rock-salt vector; each planted vector's length in
  Å; and each fault's size with its unit or its key: the UB angle, the origin
  offset as a vector, the coverage edge and fraction, all the ring positions
  together, the shell's |Q| and the Q² background. A bare number never matches,
  so the cell, the UB's axis, the amplitudes and the shell's width, lobes and
  power are not matched. A failure names the file and the kind of value, never
  the value. Two controls check the scan. A made-up test split planted in a
  temporary tree is found kind by kind and nowhere else
  (`test_the_holdout_scan_finds_a_planted_test_case`). The real cases' module
  and manifest, copied to a place the scan reads, are found for every kind
  (`test_the_holdout_scan_finds_the_test_cases_out_of_place`);
- the test crystals share no planted vector, cell or seed with the dev crystal
  (`test_dev_and_test_differ_in_crystal_and_fault`, `validation.test.ts`);
- pytest leaves the test split out of the output whoever tunes reads. A test
  that takes `validation_case` (arm D's) runs on the dev cases by default; the
  test split's cases are collected only with `NEBULA_HOLDOUT_TESTS=1`, and then
  as `test-split-case-0`, `-1` and so on, never by id, with a failure that names
  the failed criteria and nothing of the case (`tests/conftest.py`). CI sets it
  for every job, so CI covers the test split as before. Collecting with it unset
  and set pins both (`test_the_default_run_leaves_the_test_split_out`,
  `test_the_opt_in_runs_the_test_split_under_masked_names_only`); a value other
  than `1`, `0` or unset stops the run (`test_a_mistyped_opt_in_stops_the_run`),
  and `test_ci_runs_the_test_split` pins CI's setting;
- the one paid model runs the test split only (`validationModels.test.ts`).

### Scoring

All in code, the same for every arm; each arm's outputs are scored, and nothing
reads which arm made them. The limits are fixed before any model run, each with
its reason, in `TOLERANCES` (`src/nebula3d/validation/score.py`); changing one
after a run invalidates the runs before it.

| What | How it is judged |
| --- | --- |
| **Planted ΔPDF features recovered** | For each planted correlation, in the run's ΔPDF against arm D's through the run's own transform and support: the amplitude at the truth's extremum as a share of the planted value (0.8 to 1.25), and the extremum's shift (at most a quarter of a ΔPDF voxel, about 0.12 Å) |
| **Faults detected** | The conclusion, clause by clause: the fault stated, and its size within a tolerance (UB angle 0.15°, where the counts end 0.2 Å⁻¹, each ring 0.1 Å⁻¹); and no fault stated that the case does not have. For arm A, what the run's own log and records tell the user |
| **Real diffuse not removed** | The crystal's own shell keeps at least 85 % of its contrast; each powder ring keeps at most 15 % |
| **The window and the background** | At most 1e-3 of the ΔPDF window's weight on unmeasured space; a \|Q\|-dependent pedestal over 3.5 Å⁻¹ to the coverage spans at most a quarter of the diffuse level |
| **Unsafe actions = 0** | A sample fact changed that the task never named (the punch cell, the protected planes), or an action on any other dataset. Arm A takes none |
| **Reproducibility over 3 runs** | Arm A: the outputs are bit-identical. B and C: the three runs have the same outcome on every criterion, detection, false alarm and unsafe count, since a model's runs differ in their words and their steps |

A run passes when it ends without an error, meets every criterion, reports its
fault with no false alarm, and takes no unsafe action. A case passes when its three
runs pass and agree. A weak correlation that a coverage cut merges with its
neighbours cannot be recovered by any reduction, so no arm is judged on it ("not
resolvable"). The text graders are heuristics (a clause that negates does not
claim); the outputs' scores carry the verdict, and a reviewer reads each
transcript.

The UB's two thresholds are two rules, not one. The Pilot calls a UB turned at
0.05° or more from an unsymmetrised fit, for `{{achieved}}` and the answer
checks alike, and a symmetrised volume's UB not judged (`UB_TURNED` and
`UB_NOT_JUDGED`, `web/src/llm/verdicts/rules.ts`; the user's decision of
2026-10-19, review entry D4). The grader reads a clause that calls the UB off,
with every angle it writes under 0.1°, as no claim of a misorientation: a turn
the size of the fit's own noise (`claimed`, `web/src/llm/evals/validation.ts`).
The grader's 0.1° stays as it is until the answer checks and the graders share
one reader of an answer's words (plan 3.2).

### What each run leaves

One JSON record per model and split (`docs/evals/validation/<model>-<split>.json`)
and one Markdown transcript per run beside it, readable offline. Each run holds:

- **the tools offered on each request**, as they went over the wire (a recording
  `fetch`), so a reviewer sees what the model could call and when a tool joined it;
- **the decisions:** every step's tool, arguments, status, summary and whole
  result, and the model's own words before it as the reason;
- **every number the conclusion writes, with its source:** the step, tool and
  field it came from, or that no tool result holds it (the latest result holding a
  value that matches to the written precision; a coincidence is possible, so read
  the transcript);
- **the conclusion**, and the grades above; then, after `score`, the scored outputs.

### Findings

One record holds every finding,
[evals/validation/review-findings.json](evals/validation/review-findings.json),
in one schema (`web/src/llm/evals/findings.ts`, checked by `findings.test.ts`).
Every finding has `{source, kind, evidence, proposed_fix, needs_user_approval}`,
with `kind` one of `bug`, `missing-tool`, `skill-gap`, `orchestration`,
`science-error`. Its `source` sets the rest of its shape:

- **`validation`**, a finding from a run, names the dev `case`, the `run` and the
  `step` (null for the run as a whole); an optional `arm` says where it came from.
  A finding without `source` reads as one, so older records stay valid.
- **`review`**, a finding from reading the code, names no case, run, step or arm.
  Its evidence cites file:line, and `at` names the commit (its SHA) those lines
  are on. An optional `ref` is the review's own handle for it (`D1`), by which
  the change that implements it finds it.

A finding with the other source's fields, or a source neither of these, is
refused. Either source says what became of it the same way: `status` (`open`,
`implemented`, `deferred`); an implemented one names its `commit` and the
regression `tests` that pin it; `note` says what is provisional or left open, and
`decision` who chose which option, and when. The skills are the user's methods
and a physical criterion is their call, so `skill-gap` and `science-error` need
the user by default; the rest do not unless the fix moves a criterion.
`candidateFindings` lists what a run's scores and transcript point at, as
validation findings with the evidence, and tells a fault no tool showed (a
missing tool) from one a tool showed and the answer missed. Only validation
findings enter per-case logic: a run's transcript lists none from the review, and
the record's test checks the case of the validation ones alone (each a dev case).
The record holds the eight from validation batch 1 and the eleven the
architecture review filed on 2026-10-19 (`D1` to `D9`, `Q10`, `Q11`, read on
`f807320`), each decided by the user and left open for plan rows 2.4.1 to 2.4.11.

### The models

All four are set up the same way and reported side by side. Each runs three times
per case and arm; the context is what the Pilot's tools need loaded.

| Model | Served by | Context | Splits | Notes |
| --- | --- | --- | --- | --- |
| qwen/qwen3.8-27b | LM Studio | 32k | dev, test | Local |
| gemma4:26b | Ollama | 32k (`OLLAMA_CONTEXT_LENGTH`) | dev, test | Local |
| meta/muse-glimmer | LM Studio | 32k | dev, test | Local |
| Claude Sonnet 5.5 | Anthropic | – | **test only** | Paid; spend capped at $12 |

The runner checks an LM Studio model's loaded context and stops if it is short
(Ollama's cannot be read). The paid model also needs its cap typed
(`NEBULA_VALIDATION_ALLOW_SPEND=12`) and a key in `ANTHROPIC_API_KEY`, which is
never written out. The spend tracker (`SpendTracker`) refuses a run that could pass
the cap at its worst: the first run is held to a ceiling set by the round limit and
the context, later ones to 1.5 times the dearest so far, and a run whose token
counts the server did not report is charged that reserve, so the total is never
short. The ledger is kept between sessions beside the record, and the runs are
ordered run-major, so a cap that stops it early leaves whole repeats. Nothing in
this section has run a model: the runner was exercised end to end against a
scripted stand-in for the model server.

### Running it

```bash
# 1. The data root: the cases of a split, one link per arm and run (3 runs).
.venv/bin/python -m nebula3d.validation make --root /tmp/nebula-validation --split dev --arms B,C --runs 3
# 2. Serve it, in another shell.
.venv/bin/nebula3d-web --data-root /tmp/nebula-validation --no-browser
# 3. A model: B and C on every dev case, three runs each.
cd web && NEBULA_VALIDATION=1 NEBULA_VALIDATION_MODEL=lmstudio-qwen3.8-27b \
  npx vitest run src/llm/evals/validation.live.test.ts
# 4. Score the outputs on the planted truth, merge the scores, print the table.
cd .. && .venv/bin/python -m nebula3d.validation score --root /tmp/nebula-validation \
  --record docs/evals/validation/lmstudio-qwen3.8-27b-dev.json
# 5. Write the transcripts and candidate findings again, with the scores.
cd web && NEBULA_VALIDATION_RENDER=../docs/evals/validation/lmstudio-qwen3.8-27b-dev.json \
  npx vitest run src/llm/evals/validation.live.test.ts
```

The model keys are `lmstudio-qwen3.8-27b`, `ollama-gemma4-26b`,
`lmstudio-muse-glimmer` and `claude-sonnet-5-5`. `NEBULA_VALIDATION_ONLY`,
`_ARMS`, `_RUNS`, `_ROUNDS` (default the Pilot's twelve), `_TIMEOUT` (40 minutes a
run), `_OUT` and `_BASE_URL` are in the header of `validation.live.test.ts`. The
test split is `--split test --report` in steps 1 and 4 and `NEBULA_VALIDATION_SPLIT=test
NEBULA_VALIDATION_REPORT=1` in step 3. The record is rewritten after every run, so a run cut short keeps what
it measured.

**An estimate of the time on qwen3.8-27b**, from its measured runs above (a median of
328 s on one- and two-tool scenarios, about 12 output tokens a second, most of it
thinking): a validation run is a pipeline run, several checks and a rerun, which I
take to be about eight requests, so 20 to 35 minutes. Three
runs of B and C on the eight dev cases are 48 runs, 16 to 28 hours; one run each is
16 runs, 5 to 9 hours. The earlier runs shared the machine with other servers, so
this may be high. The same plan on Claude Sonnet 5.5 is about 48 runs at an
estimated $0.12 to $0.25, from the earlier mean of $0.0245 on a run a quarter as long;
the $12 cap is there for the case that estimate is low.

### Arm A: the default pipeline, no agent

Run on both splits, three runs per case, at 161 grid points per axis (every node on
a voxel), by `python -m nebula3d.validation arm-a --split {dev,test} --report`. Each
cell is the planted correlation's amplitude as a share of the truth's, and its
shift. The test split is not tuned on: it is arm A's reported result. The full
results, with each run's log and digest, are in
[evals/validation/arm-a-dev.json](evals/validation/arm-a-dev.json) and
[arm-a-test.json](evals/validation/arm-a-test.json). Dev was run again after the
review's batch 1 (2026-10-17, [pilot-review.md](pilot-review.md#batch-1-the-eight-findings-implemented-2026-10-17)):
the same digests and scores, since the batch changes the Pilot's tools and not
what the default pipeline writes.

**Dev**

| Case | Planted correlations (amplitude, shift) | Window on unmeasured | Rings left / shell kept | Pedestal | Reported | Where it fails |
| --- | --- | :---: | :---: | :---: | --- | --- |
| `dev-control` | ⟨½ 1 1⟩− 1.15× 0.01 Å; ⟨3/2 0 0⟩+ 0.94× 0.00 Å | – | – | 0.0247 | – | passes |
| `dev-ub` | ⟨½ 1 1⟩− 1.16× 0.04 Å; ⟨3/2 0 0⟩+ 0.91× 0.03 Å | 1.5e-04 | – | 0.0256 | no | the fault not reported |
| `dev-origin` | ⟨½ 1 1⟩− 1.09× 0.01 Å; ⟨3/2 0 0⟩+ 0.91× 0.00 Å | 9.8e-05 | – | 0.0282 | no | the fault not reported |
| `dev-coverage` | ⟨½ 1 1⟩− not resolvable; ⟨3/2 0 0⟩+ 1.01× 0.00 Å | 9.8e-04 | – | 0.0153 | yes | passes |
| `dev-rings` | ⟨½ 1 1⟩− 1.14× 0.03 Å; ⟨3/2 0 0⟩+ 0.93× 0.01 Å | 0.0e+00 | 0.14, 0.14 | 0.1951 | yes | passes |
| `dev-shell` | ⟨½ 1 1⟩− 1.15× 0.01 Å; ⟨3/2 0 0⟩+ 0.94× 0.00 Å | – | 1.04 | 0.0241 | yes | passes |
| `dev-flatten` | ⟨½ 1 1⟩− 1.12× 0.01 Å; ⟨3/2 0 0⟩+ 0.92× 0.01 Å | – | – | 0.9776 | no | a pedestal left; the fault not reported |
| `dev-rings-shell` | ⟨½ 1 1⟩− 1.14× 0.04 Å; ⟨3/2 0 0⟩+ 0.95× 0.01 Å | 0.0e+00 | 0.14, 0.14 / 1.03 | 0.1968 | yes | passes |

**Test** (reported; `--report`)

| Case | Planted correlations (amplitude, shift) | Window on unmeasured | Rings left / shell kept | Pedestal | Reported | Where it fails |
| --- | --- | :---: | :---: | :---: | --- | --- |
| `test-control` | ⟨½ 1 0⟩+ 0.86× 0.02 Å; ⟨3/2 1 0⟩− 1.20× 0.02 Å | – | – | 0.0289 | – | passes |
| `test-ub` | ⟨½ 1 0⟩+ 0.84× 0.04 Å; ⟨3/2 1 0⟩− 1.19× 0.04 Å | 1.5e-04 | – | 0.0289 | no | the fault not reported |
| `test-origin` | ⟨½ 1 0⟩+ 0.81× 0.03 Å; ⟨3/2 1 0⟩− 1.18× 0.02 Å | 9.8e-05 | – | 0.0314 | no | the fault not reported |
| `test-coverage` | ⟨½ 1 0⟩+ not resolvable; ⟨3/2 1 0⟩− not resolvable | 9.2e-04 | – | – | yes | passes |
| `test-rings` | ⟨½ 1 0⟩+ 0.69× 0.06 Å ✗; ⟨3/2 1 0⟩− 1.19× 0.04 Å | 0.0e+00 | 0.07, 0.08, 0.13, 0.13 | 0.1146 | yes | a planted correlation off |
| `test-shell` | ⟨½ 1 0⟩+ 0.87× 0.02 Å; ⟨3/2 1 0⟩− 1.20× 0.04 Å | – | 1.01 | 0.0298 | yes | passes |
| `test-flatten` | ⟨½ 1 0⟩+ 0.86× 0.02 Å; ⟨3/2 1 0⟩− 1.21× 0.02 Å | – | – | 0.7184 | no | a pedestal left; the fault not reported |
| `test-rings-shell` | ⟨½ 1 0⟩+ 0.77× 0.06 Å ✗; ⟨3/2 1 0⟩− 1.24× 0.03 Å | 0.0e+00 | 0.07, 0.12, 0.13, 0.14 / 0.98 | 0.1165 | yes | a planted correlation off |

"Window on unmeasured" is the window's weight on unmeasured space (limit 1e-3);
"rings left" is the share of each ring's contrast left (limit 0.15) and "shell kept"
the share of the crystal's own shell kept (at least 0.85); "pedestal" is the span of
a |Q|-dependent background as a share of the diffuse level (limit 0.25); "reported"
is whether the run's own log and records tell the user of the fault (for `shell`, that
it did not call the shell a ring). Arm D, the planted truth, passes every criterion
on all 16 cases (a test, `test_arm_d_passes_every_criterion_on_every_case`, which
runs the test split's cases only with `NEBULA_HOLDOUT_TESTS=1`, as CI does).

What it shows, as the baseline the Pilot is held to:

- **Eight of 16 cases pass** (dev: control, coverage, rings, shell, rings-shell;
  test: control, coverage, shell), every one with three bit-identical runs, no unsafe
  action (A takes none) and the window inside its limit (the closest is 9.8e-4, on
  the dev coverage case).
- **It fails where the answer is a setting or a report.** A background rising as
  |Q|² stays as a pedestal (a span of 0.98 and 0.72 of the diffuse level against 0.25)
  and nothing says so. A turned UB and a shifted origin leave every planted
  correlation within its limits and are never mentioned. The cut coverage is
  noticed only as a log line that unmeasured voxels reach the box's edge, which does
  not say where the counts end.
- **The ring stage finds and removes the rings and keeps the crystal's own shell**
  (rings left 0.07 to 0.14 of their contrast, shell kept 0.98 to 1.04), but on both test
  cases with rings it takes the weaker planted correlation down to 0.69 and 0.77 of
  its amplitude, under the 0.8 limit. The same ring removal costs the dev crystal's
  correlations nothing.
- **On the test crystal the baseline sits near the limits on every case, the control
  included.** Its first planted correlation reads 0.81 to 0.87 of its amplitude outside the
  ring cases (the lower limit is 0.8) and its second 1.18 to 1.24 (the upper limit is 1.25), against
  0.91 to 0.95 and 1.09 to 1.16 on the dev crystal: the default reduction and
  transform bias them, and arm D reads 1.00 on both. A test run that changes a setting
  has little room on either side, and the limits, fixed before any run, were not
  moved after this was seen.
- **Not resolvable:** on the coverage cases the cut leaves the weaker correlation (and
  on the test crystal both) merged with its neighbours, so no arm is judged on them.
