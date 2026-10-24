- **NEBULA Pilot: `regrid_refined_ub`, the regrid onto the refined UB.** The
  Pilot's tool for `nebula3d.analysis.ub_regrid.regrid_dataset` (plan 4.7):
  it regrids the selected dataset's raw volume onto its refined UB, with the
  UB check's fit (the punch cell's Bragg nodes and `q_max`, as `ub_check`
  takes them), and writes `<stem>_regridded.nxs` beside the raw file as a
  new dataset, never over a file (server: `POST /api/datasets/{id}/regrid`;
  browser: `webbridge.dataset_regrid_json`; the client's `regridDataset`).
  The backend's refusals come back in its own words, nothing written: a turn
  under the UB check's 0.05°, a symmetrised volume without its unsymmetrised
  source, a file or dataset id in use. It is the user's to run: it runs only
  when the user's latest message asks for a regrid by name ("regrid",
  "re-grid", its own name, or `refine_ub.py`), the gate `update_settings`
  holds a fact about the sample to, and is refused otherwise ("A regrid
  writes a new dataset, which only the user asks for: nothing was written.
  Ask the user, and regrid once they ask for it."). A local model is offered
  it only for such a message, so the validation task's offer is unchanged;
  the console's requests carry its definition, about 253 more estimated
  tokens. It selects nothing and runs no pipeline: the run's stages are as
  before, and the new dataset is reduced only when the user runs it. The
  evals never run it, as they never start a run. On the dev case with a
  turned UB the regrid writes the new dataset, and `ub_check` on it reads no
  turn (0.037° at 81 points per axis, 0.001° at 161, from 0.565° and 0.601°).
