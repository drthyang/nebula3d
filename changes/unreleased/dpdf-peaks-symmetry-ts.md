- **NEBULA Pilot: `dpdf_peaks` says how its entries are grouped, and gives an
  orbit its multiplicity and its copies' mean size.** The backend groups the
  3D-ΔPDF's extrema by the point group the dataset's raw file declares, else
  by sign, length and size (`nebula3d.analysis.dpdf_features`, plan 4.4). The
  tool now passes that on: `grouped_by` names the rule (`"declared symmetry
  (m-3m: 48 operations, r ≡ −r)"`, `"sign, length and size (no symmetry
  declared)"`, or why a declared symmetry was not applied), and an entry
  grouped by the declared symmetry gives its copies' mean size
  (`mean_size_sigma`) beside the largest, and the orbit's distinct vectors,
  one per ± pair (`multiplicity`), beside the vectors found (`n_vectors`).
  Grouped by sign, length and size there is no orbit, and every size is
  within 5 % of the largest, so an entry gives neither and reads as it did:
  on the validation's dev cases, which declare no symmetry, the result grows
  only by `grouped_by`. The default limit stays 12 entries, and the tool's
  description is unchanged.
- **Requirement change: a local live run needs at least 56k of context
  (57,344 tokens), up from 48k (49,152).** NEBULA Pilot's worst turn on a
  local model was measured with the 3D-ΔPDF's strongest features as a
  synthetic handful; it now carries a full list, the validation dev control's
  at `dpdf_peaks`' default (`web/src/llm/__tests__/tokenBudget.test.ts`, the
  list recorded from the dev-data bridge), and reaches about 47.6k tokens with
  the reply reserve, 1.5k under the old minimum. The run policy (`RUN_POLICY`
  in `web/src/llm/evals/validationModels.ts`) now holds it with at least 3k
  free, which the budget test asserts. The validation's runner, the scenario
  evals (`npm run eval:agent`) and the local tier (`npm run eval:local`)
  refuse a window under 57,344 tokens, before the first run and before each:
  load an LM Studio model with a Context Length of 57344 or more
  (`lms load <model> --context-length 57344`), and use an Ollama model that
  supports at least that. The console's guidance (the context warning, the
  window's refusal, the connection settings, the hint when the context is
  full and the note when a reply is cut off) suggests 56k. The guard's
  budgets and what the model reads are unchanged.
