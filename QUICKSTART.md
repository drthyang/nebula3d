# Quickstart

`nebula3d` ships **one** application: a browser console (React UI) that
runs the full cleanup → 3D-ΔPDF → consistency-check workflow. It has two
interchangeable run modes that share the same UI and the same reduction code:

| Mode | Use it for | Needs |
| --- | --- | --- |
| **In-browser** (GitHub Pages) | The complete pipeline, no install; your data stays local. | A browser |
| **Native** (`nebula3d-web`) | Local work with no size limit; your data in `./data`. | Python 3.10+ |

## In-browser — no install, fully static

Open the hosted app: **https://drthyang.github.io/nebula3d/**

It is a **fully static** GitHub Pages bundle — no backend — that runs the *real*,
*complete* `nebula3d` pipeline entirely in your browser via Pyodide. Load your
own `.nxs`/`.h5`, or the built-in demo volume; nothing is uploaded. It runs at
full resolution, storing volumes and running the FFT in float32 (|Q|, fits and
reductions stay float64): up to about 80 M voxels in a desktop browser, about
5 M on a phone or tablet. Larger data uses the native mode below: when a volume
or a run is too large for the browser, the page says so and gives its commands.
This path has full feature parity with the native backend.

To run that build locally:

```bash
make web-install
make web-wheel                     # the data-free wheel + manifest the page loads
cd web && npm run dev:pyodide      # http://localhost:5173
```

## Native — no size limit

Runs the real pipeline locally with no size limit; reads `./data` by default.
nebula3d is not on PyPI, so install it from a clone:

```bash
git clone https://github.com/drthyang/nebula3d && cd nebula3d
pip install -e ".[web]"
nebula3d-web                 # serves http://127.0.0.1:8000 and opens a browser
```

Useful flags:

```bash
nebula3d-web --data-root /path/to/data   # if raw/ + processed/ live elsewhere
nebula3d-web --no-browser                # headless / remote
```

From a source checkout, build the UI once first (otherwise only the API serves):

```bash
make web-install        # npm install in web/
make ui                 # build the SPA into src/nebula3d/server/static
```

## Using the console

Pick the dataset once from the switcher at the top of the sidebar; every view
reads it from there. A session typically runs top to bottom:

1. **Configure** — tune ring removal / punch / backfill / background correction / ΔPDF, then
   **Run pipeline**. Existing outputs are skipped unless *force* is on.
2. **Reciprocal cleanup** — compare stages (raw → ring-removed → punched →
   backfilled → background-corrected) on one shared plane and colour scale.
3. **3D-ΔPDF** — three linked real-space orthoslices with a unit-cell overlay.
4. **Q–R Band Transform** (the consistency check) — inverse-FFT the ΔPDF back to reciprocal space and
   compare *data | back-FFT | residual*, with `|Q|` and real-space `r` bands.
5. **NEBULA Pilot** — open it from the sidebar; it docks beside every page.
   Connect a local (Ollama / LM Studio) or cloud (OpenAI / Gemini / Anthropic)
   model. Ask it to *Assess the run* or *Tune for the best result*, or ask
   anything about the reduction: with *Tools* on it measures cuts, judges each
   stage, runs and tunes the pipeline, and opens the figures it talks about
   ([docs/pilot.md](docs/pilot.md)).
   A local model needs room: load it with a **56k context** (57344; in LM
   Studio, set the model's default Context Length, which it uses whenever it
   reloads an idle model; Ollama at its usual port gets its window from the app,
   up to what the model supports, and elsewhere start it with
   `OLLAMA_CONTEXT_LENGTH=57344`). With *Tools* on, the first request alone is
   about 7.2k tokens, and a full assessment that reads two skills about 42k; in
   a 32k window the skill it read first is shortened to a stub
   ([docs/pilot.md](docs/pilot.md#guardrails)).

## Going further

- The pipeline from Python and the command line: [docs/pipeline.md](docs/pipeline.md),
  with short recipes in [docs/commands.md](docs/commands.md)
- NEBULA Pilot, its tools, guardrails and evals: [docs/pilot.md](docs/pilot.md)
- The console's reference and architecture: [docs/web.md](docs/web.md)
- Installing from source and the checks before pushing: [docs/development.md](docs/development.md)
- Everything else: [docs/README.md](docs/README.md)
