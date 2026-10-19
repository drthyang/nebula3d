- **A local live run of the validation needs at least 48k of context, and the
  console suggests 48k for Tools.** NEBULA Pilot's worst turn on a local model,
  a full assessment that reads two skills whole, is about 45.6k tokens with
  room for the reply, measured through the agent loop; a 32k window holds it
  only by shortening the skills just read to stubs. The run policy's minimum
  for a local live run is 49,152 tokens (`RUN_POLICY` in
  `web/src/llm/evals/validationModels.ts`). Before the plan starts, and again
  before each run, the validation's runner reads the window the run will get
  (LM Studio's loaded context, the longest context Ollama says the model
  supports) and refuses one under the minimum or one it cannot read, saying
  how to load the model with more; each run's record keeps the window and the
  minimum (`context_window`, optional, so older records stay valid). The
  console's own guidance (the context warning, the window's refusal, the
  connection settings) now suggests 48k, from the measured need; the context
  guard's budgets and what the model sees are unchanged. How to load a model
  with 48k in LM Studio and Ollama is in [docs/pilot.md](docs/pilot.md) and
  [docs/evals.md](docs/evals.md#the-models).
