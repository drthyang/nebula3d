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

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and pull request,
with `NEBULA_HOLDOUT_TESTS=1`:

- the tests (with coverage) and ruff on Python 3.10, 3.11, 3.12 and 3.13;
- mypy once, against the pinned numpy stubs in
  `.github/constraints/typecheck.txt` (mypy's verdict depends on them);
- the tests again under the numpy, scipy, h5py and matplotlib that Pyodide
  0.27.7 ships, the stack the browser build runs on;
- the console's lint, tests and both builds (native and Pages).

The Pages workflow deploys `main` to GitHub Pages after CI passes on it.

### What the Pilot's model sees

`web/src/llm/__tests__/modelVisible.test.ts` writes everything NEBULA Pilot's
model reads to Markdown snapshots in
`web/src/llm/__tests__/__snapshots__/model-visible/`: the system prompt and the
opening messages (tools on with and without the skills, as validation arms B
and C get them, and tools off), every tool's definition and the tools a local
model is offered, the stage goals, the verdicts' criteria, the skills' listing,
the stage-review and tuning prompts, a result from each tool as the executor
hands it over, and what the answer checks and the agent loop send back. It runs
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
