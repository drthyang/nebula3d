# NEBULA Pilot evals

How well NEBULA Pilot, the console's agent, reaches the answers the research
rounds established on a measured volume, model by model. The volume is a
hexagonal X-ray volume, symmetrised under 6/mmm by the NeXus Viewer, indexed on
a doubled 8 × 10 Å cell, together with its unsymmetrised export.

Each scenario is one question. It goes through the app's own agent loop, with
the messages the chat panel builds and the console's tools running against the
native server. Deterministic checks grade the run on two things:

- **what the model called:** a call counts only when it ran without an error;
- **what it answered:** the text is read sentence by sentence, and a sentence
  that negates (no, not, never, without…) does not count as asserting what it
  mentions.

Every number an answer must quote is compared with that run's own tool results,
not with a value written into the test. A run passes only when every check
passes. The suite lives in `web/src/llm/evals/`.

## Scenarios

| Scenario | Question | The answer the research established | Checks |
| --- | --- | --- | --- |
| `rings-left` | Is the powder-ring removal clean on this run? | One Al ring is left at 10.3 Å⁻¹ on h0l and 0kl. The hk0 bumps are the crystal's own scattering. | `assess_stage` for the rings; quotes the ring's \|Q\|; says a ring is left |
| `punch-missed` | Did the Bragg punch remove every peak it should have? | 16 lattice peaks were missed at nodes. 360 broad maxima are kept as diffuse scattering. | `assess_stage` for the punch; quotes the count; says peaks were missed |
| `pdf-window-coverage` | Does the ΔPDF's transform window stay inside the measured space? | Yes: 3.2·10⁻⁶ of its weight falls on unmeasured space, under the 10⁻³ limit. | `qmax_coverage`; quotes the weight; says it stays inside |
| `pdf-separable-refused` | Should I switch to a separable window for a higher SNR? | No. On this cell it reaches unmeasured space and breaks the six-fold symmetry; the tuner refused it. | No setting changed and no run started; advises keeping the ellipsoid; says why |
| `symmetry-kept` | Did the ΔPDF keep the cell's hexagonal symmetry? | Yes: every in-plane operation holds to 3·10⁻⁶. | `symmetry_check`; says it is kept |
| `q-band-from-raw` | What \|Q\| band should the ΔPDF use? | Where the raw counts begin and end: 0.52 (band 0.55) to 16.7 Å⁻¹. | `qmax_coverage`; quotes both edges |
| `no-second-grain` | Is there a second grain? | No. 35 of the 40 strongest off-lattice orbits are Bragg peaks displaced by a UB about 0.85° off. | `grain_check`; says there is no second grain and never claims one; quotes the angle |
| `ub-symmetrised` | Is the UB of this volume right? | It can't be fully judged here: a symmetrised volume hides a misorientation, so the orientation needs the unsymmetrised file. | `ub_check`; says the unsymmetrised data are needed |
| `ub-misoriented` | (unsymmetrised export) Is the UB right? How far off? | It is turned 0.87°; the cell is a = 8.002 Å, c = 9.988 Å. | `ub_check`; quotes the angle and a |

## Running it

- **CI replay** (`evals.test.ts`, part of `npm test`). A scripted model plays
  each scenario against tool results recorded on the eval datasets
  (`fixtures/hex90k.json`), through the real loop and graders. A good script must
  pass every check. A bad script, the failure as models made it, must fail the
  checks named for it.
- **Real models** (`live.test.ts`). With the native server serving the eval
  datasets:

  ```bash
  cd web && NEBULA_EVAL=1 NEBULA_EVAL_BASE_URL=http://localhost:11434/v1 NEBULA_EVAL_MODEL=gemma4:26b NEBULA_EVAL_OUT=../docs/evals/results/ollama-gemma4-26b.json npm run eval:agent
  ```

  `NEBULA_EVAL_ONLY` takes scenario ids, `NEBULA_EVAL_REPEAT` runs per scenario.
  A Claude base URL reads `ANTHROPIC_API_KEY` from the environment; the key is
  never written out.
- **Tables:** `node web/scripts/eval-table.mjs docs/evals/results/*.json`.
- **Re-recording the fixtures:** `NEBULA_EVAL_PROBE=1 npx vitest run src/llm/evals/probe.test.ts`.

## Results

Measured on 2026-10-10 on one Mac (68.7 GB unified memory), against the native
server. Each scenario ran three times per model, at temperature 0.2, with a
20-minute limit per run. Raw records, with every tool call, its result and the
answer, are in [`docs/evals/results/`](evals/results/).

| Scenario | gemma4:26b (Ollama) |
| --- | :---: |
| `rings-left` | ✗ 0/3 |
| `punch-missed` | ✗ 0/3 |
| `pdf-window-coverage` | ✓ 3/3 |
| `pdf-separable-refused` | ✗ 0/3 |
| `symmetry-kept` | ✓ 3/3 |
| `q-band-from-raw` | ✓ 3/3 |
| `no-second-grain` | ✓ 3/3 |
| `ub-symmetrised` | ✗ 0/3 |
| `ub-misoriented` | ✓ 3/3 |

| Model | Passed | Median time per run | Mean tokens per run (in / out) | Mean cost per run |
| --- | :---: | ---: | ---: | ---: |
| gemma4:26b (Ollama) | 15/27 | 27 s | 17,332 / 870 | local |

How to read the local results:

- **gemma4:26b** reliably reads the dedicated checks: window coverage,
  symmetry, the |Q| band, the second grain and the misorientation pass 3/3.
- Asked whether the ring removal or the punch is clean, it answers from the
  opening cut and never calls `assess_stage`, so it misses the ring and the
  peaks that only show on the other planes.
- It advises against the separable window, but for the wrong reason (the SNR
  is already high) rather than the coverage or the symmetry.
- It leaves out `ub_check`'s caveat that a symmetrised volume hides the
  orientation.
- One early run switched the window and started a pipeline run on the eval
  dataset. The harness now stubs `run_pipeline` and `tune_pipeline`: the call is
  graded, never sent.

More models are being added: LM Studio qwen3.8-27b, Ollama qwen3:32b, and
Claude Haiku and Sonnet 5.5. LM Studio's muse-glimmer was not run, because it
was not loaded and these runs never load LM Studio models.

