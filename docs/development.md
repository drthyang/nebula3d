# Development

Installing from source, the checks to run before pushing, the package layout,
and what CI runs. The console's own development workflow (dev servers, the
in-browser build) is in [web.md](web.md#development).

## Install

Requires Python 3.10 or newer.

```bash
git clone https://github.com/drthyang/nebula3d
cd nebula3d
pip install -e ".[dev]"
```

For local scripts run from the repository root, set:

```bash
export PYTHONPATH=src
export MPLCONFIGDIR=/tmp/mpl
```

`MPLCONFIGDIR` keeps Matplotlib cache files out of the repository.

## Checks before pushing

Before pushing, run the same checks as CI (tests, lint, type check):

```bash
bash scripts/check.sh
```

It runs `pytest`, `ruff check src/ tests/`, and `mypy src/nebula3d`. Set
`PY=/path/to/python` to choose the interpreter. Unlike CI, it does not set
`NEBULA_HOLDOUT_TESTS`, so the held-out test split stays out (see
[Tests and CI](#tests-and-ci)). To run it automatically on every
push, install it as a git hook in your clone:

```bash
ln -s ../../scripts/check.sh .git/hooks/pre-push
```

## Package layout

```text
src/nebula3d/
├── core.py              HKLVolume: 3D array, HKL axes, mask, sigma, UB matrix
├── pipeline.py          the stage driver: rings → punch → backfill → flatten → 3D-ΔPDF → check
├── io/                  Mantid NeXus (read/write), legacy HDF5, ΔPDF files, ASCII HKL
├── preprocessing/       powder-ring models and their 3D confirmation, background, sampling
├── analysis/            Bragg punch/fill, 3D-ΔPDF, |Q| coverage, UB refinement
├── demo.py              the synthetic demo volume (simulated, with known physics)
├── faults.py            known faults to inject, for the held-out evals
├── symmetry.py          declared symmetry ops: index maps and orbit means
├── inpainting/          symmetry, TV, RBF, and biharmonic fallbacks
├── server/              FastAPI backend for the console (native mode)
├── webbridge.py         the same API for the in-browser (Pyodide) build
└── visualization/       slices, profiles, overview plots, interactive viewers

web/                     the React console; NEBULA Pilot lives in web/src/llm
```

## Tests and CI

Run locally in a Python 3.10+ environment with the dev dependencies, or all at
once with `bash scripts/check.sh` (above):

```bash
PYTHONPATH=src python3 -m pytest
python3 -m ruff check src/ tests/
python3 -m mypy src/nebula3d --ignore-missing-imports --python-version 3.12
npm --prefix web test
```

`npm --prefix web test` runs the console's replay tests too, which need Python
([below](#the-replay-tests-the-dev-cases-through-the-pages-path)).

By default pytest leaves out the validation's held-out test split
([evals.md](evals.md#the-cases-and-the-split)): nothing that is tuned may see it,
and pytest prints every test's name, so a builder tuning against the suite would
read the held-out cases' names and verdicts. `NEBULA_HOLDOUT_TESTS=1` runs them
too, each under an opaque name (`test-split-case-0`, `-1`, ...) and with a
failure that names only the failed criteria:

```bash
NEBULA_HOLDOUT_TESTS=1 PYTHONPATH=src python3 -m pytest tests/test_validation.py
```

CI sets it for every job; a value other than `1`, `0` or unset stops the run.
`tests/conftest.py` wires it: a test that takes a `validation_case` argument
gets the dev cases, and the test split's with the opt-in.

Without it the test split cannot load at all. Its definitions are held out in a
module of their own, `src/nebula3d/validation/holdout/heldout_cases.py`: do not
open, print or read it. `cases("test")` imports it only with the opt-in (or the
CLI's `--report`) and raises without it, so the tests that need the test split
skip in a default run. No failure in the validation's tests shows a held-out
case: names are masked, and values compared by count or digest. The web
harness's manifest lists every case, so writing it needs the opt-in too:

```bash
PYTHONPATH=src python3 -m nebula3d.validation manifest --report \
  > web/src/llm/evals/fixtures/validation-cases.json
```

The same opt-in gates the scenario evals' held-out fixture,
`web/src/llm/evals/fixtures/holdout/heldout.json`: do not open, print or read it
either. Its one reader, `web/src/llm/evals/heldoutFixture.ts`, reads it only with
`NEBULA_HOLDOUT_TESTS=1`; without it `npm test` neither collects nor runs the
held-out scenarios' replay (`heldout.test.ts`), and `localTools.test.ts` leaves
their questions out. `heldoutFixture.test.ts` checks that no other module in
`web/src` imports the file, names it or globs its way to it. CI's frontend job
runs them, under the workflow's opt-in.

What the validation reports on the test split is held out too, in
`docs/evals/validation/holdout/` (arm A's `arm-a-test.json` and its table): do
not open, print or read anything in it. `arm-a --split test --report` writes only
there and prints how many cases pass. The held-out scan allows test values in
that folder and nowhere else in the docs, `docs/evals.md` included.

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and pull request,
with `NEBULA_HOLDOUT_TESTS=1`:

- the tests (with coverage) and ruff on Python 3.10, 3.11, 3.12 and 3.13;
- mypy once, against the pinned numpy stubs in
  `.github/constraints/typecheck.txt` (mypy's verdict depends on them);
- the tests again under the numpy, scipy, h5py and matplotlib that Pyodide
  0.27.7 ships, the stack the browser build runs on;
- the console's lint, tests and both builds (native and Pages); its replay
  tests run on that same stack, on Python 3.12, the CPython Pyodide 0.27.7
  ships, and a step checks both against `.github/constraints/pyodide-0.27.7.txt`
  first.

The Pages workflow deploys `main` to GitHub Pages after CI passes on it.

### The replay tests: the dev cases through the Pages path

The console's tests are two vitest projects (`web/vitest.config.ts`):

- `unit`: every `*.test.ts` but the replays. No Python is needed; it is the
  fast loop, about three seconds:

  ```bash
  cd web && npx vitest --project unit
  ```

- `replay`: the `*.replay.test.ts` files. They run the in-browser (Pages)
  build's own path, the client, `pyodideEngine.ts`, the stores and NEBULA
  Pilot's tools, with `VITE_DATA_MODE=pyodide`, on the validation's dev cases
  ([evals.md](evals.md#the-cases-and-the-split)) built where the tests run.
  Only the transport under the engine's Worker messages differs: a CPython
  bridge (`web/src/llm/evals/devData/bridge.py`) answers them from
  `nebula3d.webbridge` over stdio instead of Pyodide. Nothing is recorded, so
  the Python and the TypeScript of the checkout always run together.
  `devCase(id)` (`web/src/llm/evals/devData/index.ts`) is their interface: a
  handle on one dev case, from its default run, for running a tool on it or
  replaying a scripted model through the agent loop. Only the dev split is
  built; the held-out test split never is.

`npm run test` runs both. The replay project needs a Python 3.10 or newer with
the package installed (`pip install -e .` from the repository root). It takes
`NEBULA_PYTHON` when set, else `.venv/bin/python` at the repository root, else
`python3`, and puts the checkout's `src/` first on its `PYTHONPATH`. Without
one that imports this checkout's `nebula3d` with numpy, scipy and h5py, the
project fails at its start, saying how to fix it; it never skips. From `web/`:

```bash
NEBULA_PYTHON=/path/to/python npx vitest --project replay
```

The dev cases are built on an 81³ grid (every Bragg node on a voxel; each
case's default run takes a second or two). `NEBULA_DEV_N=161` builds them on
the validation's own 161³ grid, for a nightly run (about five times as long).
The known-answer tests (`knownAnswers.replay.test.ts`) hold each case's
planted fault to its truth; a fault the tools miss on a grid stays listed in
its `MISSES`, an expected failure with the reason, until the tools find it. A
check the grid is too coarse for gives no verdict, and is held there to "not
judged", with the grid's reason (`TOO_COARSE`): on 81³ the ring check and the
texture check ([pipeline.md](pipeline.md#which-shells-are-rings-and-the-grid-that-takes)).
There the ring removal's notice is held to its count, the planted rings among
the shells it left unconfirmed, in its log, its record and the ring check, and
the verdict on the clean control's run to why it is not judged; on 161³ to the
notice's absence, and the verdict met.
The replays that need every check to judge (THY-18's verdict met on the
clean control) build their case on 161³ whatever the run's grid
(`devCase(id, { n })`).

### The verdicts, before and after a change

`web/src/llm/__tests__/verdictGoldens.test.ts` holds what the verdicts were
when the check-verdict module (`web/src/llm/verdicts/`) took them over: the
verdict on a reply's run (`{{achieved}}`), the claims the answer checks send
back, and the report's cards and goal, over a synthetic grid of each rule on
both sides of its limits (`verdictGrid.ts`) and the dev and eval replay fixtures (the
measured set's as a digest only). `verdictPins.test.ts` pins each named
disagreement between the readers, D1 to D18, with both readings. A change
that moves a verdict shows in the goldens; one that unifies a disagreement
flips its rule's constant (or deletes its matrix cell, as its comment says)
and updates its pin and the goldens it moves, saying which and why.

### What the Pilot's model sees

`web/src/llm/__tests__/modelVisible.test.ts` writes everything NEBULA Pilot's
model reads to Markdown snapshots in
`web/src/llm/__tests__/__snapshots__/model-visible/`: the system prompt and the
opening messages (tools on with and without the skills, as validation arms B
and C get them, and tools off), every tool's definition and the tools a local
model is offered, the stage goals, the verdicts' criteria, the skills' listing,
the stage-review and tuning prompts, a result from each tool as the executor
hands it over, and what the answer checks and the agent loop send back. Arm C,
with the skills' switch off, has files of its own (`*-arm-c.md`), and
`6-inference.md` lists every span of inference arm C does not read
(`web/src/llm/inference.ts`): a text the model reads is written once, its
inference tagged inline, and rendered whole or without it. It runs
on a synthetic crystal behind a mocked API: no model, no backend, no measured
data. A diff in these files is a change to what the model sees, and is reviewed
as one: a reworded prompt, a renamed result field or a new tool shows up there.
After an intended change, update them from `web/` and read the diff before
committing it:

```bash
npx vitest run src/llm/__tests__/modelVisible.test.ts -u
```

Put `-u` after the file: before it, vitest takes the path as `-u`'s value and
updates every snapshot in the suite.

### A Pilot tool's facts

Each of the Pilot's tools declares, beside its definition in
`web/src/llm/tools/index.ts`, the facts the code around the model reads
(`web/src/llm/tools/facts.ts`): whether it only reads or acts, and on what,
the verdicts it settles, the questions a local model is offered it for, its
line in the transcript, the cards it lights, whether a reply that ran it gets
a report, and the skill it waits for. A new tool declares them there and
nowhere else. `web/src/llm/__tests__/facts.test.ts` holds what every
declaration keeps: a tool that acts says what it changes, one that changes a
stage's settings or tunes it waits for the stage's skill, and every verdict
topic and every kind of question has a tool.

### The skills against the code

`web/src/llm/__tests__/skillLint.test.ts` reads each skill
(`.claude/skills/<name>/SKILL.md`) against the code it describes, and changes
no skill. It checks that every tool a skill names is in the registry; that
every field or parameter a step names in backticks is in the result of the
tools that step names, as each tool returns it on the synthetic crystal
(`CLAIMS` adds the quantities a step says its tools give, such as "the symmetry
the file declares"); that every setting it names exists; and that every number
it writes is either a gate, bound to the constant in the code it must equal
(`GATES`), or listed as no gate (`NOT_GATES`). `UNSTATED` lists the limits a
step's tool judges by, which the step should state among its gates. A failure
names the skill, its step, and what disagrees: a field the tool does not give
(and where it is instead), a gate whose number differs from its constant, a
limit the step leaves out. A failure of the tables themselves (a phrase the
skill no longer holds, a number nobody classified) means the skill's words
changed: update the table with them. Today's disagreements are on the
allow-list, `ALLOWED`, each with why. It is the user's skill-review queue
(agent plan 5.2), not a list to fix here: the lint fails on a disagreement
that is not on it, and on an entry that no longer fails, so the list shrinks
as the skills are corrected.
