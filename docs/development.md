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
`PY=/path/to/python` to choose the interpreter. To run it automatically on every
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

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and pull request:

- the tests (with coverage) and ruff on Python 3.10, 3.11, 3.12 and 3.13;
- mypy once, against the pinned numpy stubs in
  `.github/constraints/typecheck.txt` (mypy's verdict depends on them);
- the tests again under the numpy, scipy, h5py and matplotlib that Pyodide
  0.27.7 ships, the stack the browser build runs on;
- the console's lint, tests and both builds (native and Pages).

The Pages workflow deploys `main` to GitHub Pages after CI passes on it.

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
