- **Validation: a run's tuning asks the run's model, and its tokens are the
  run's.** `tune_pipeline` asked the model on the console's LLM settings,
  which in the live runner are the defaults (Ollama at its usual port, no
  model), not the model the run is graded on, and the tuning's requests
  reported no token counts, so neither a run's record nor a paid model's
  spend counted them. A validation run now hands its model to the tools
  through the tool context (`ToolContext.model`, set by `runCase` alone): the
  tuning's proposals and judgements go to it, and each request's counts are
  added to the agent loop's. The record's `usage` holds the total and keeps
  the tuning's part apart (`usage.tuning`, present when the run tuned), and
  `cost_usd` and the spend tracker include it at the run model's price; a
  tuning request whose counts the server did not report leaves the total
  unknown, and the run is charged the reserve, as for the loop's own. The
  tool offers stay the agent loop's. In the console nothing changes: the
  tuning asks the console's settings, with the same request. Nothing the
  model reads changed. Plan 1.2, the manager's decision on the user's
  delegation, 2026-10-19.
