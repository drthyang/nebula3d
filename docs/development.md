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
