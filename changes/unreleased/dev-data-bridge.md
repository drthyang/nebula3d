- **The console's replay tests run the real pipeline, on the validation's dev
  cases.** A CPython bridge stands in for Pyodide under the engine's Worker
  messages (`web/src/llm/evals/devData/`): the tests drive the in-browser
  build's own path, the client, `pyodideEngine.ts`, the stores and NEBULA
  Pilot's tools, and `nebula3d.webbridge` answers natively over stdio. The dev
  cases are built where the tests run (81³ by default, `NEBULA_DEV_N=161` for a
  nightly run), so no recording can go stale; the held-out test split is never
  built. Known-answer tests hold each dev case's planted fault to its truth
  through the real tools and verdict rules; at 81³ four checks stay expected
  failures, findings about the ring check (a bump at 1.75 Å⁻¹ judged a powder
  ring beside the planted ones, and the crystal's shell at 2.9 Å⁻¹ never seen),
  while at 161³ all pass. THY-18's replays run on the dev cases too, the
  flatten's rerun now a real one. vitest has two projects: `unit` (no Python)
  and `replay` (Python with the package installed, `NEBULA_PYTHON`). CI's
  frontend job sets up Python 3.12 with the numeric stack Pyodide 0.27.7 ships
  and checks both against its pins first.
