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
