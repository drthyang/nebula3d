- **NEBULA Pilot: one run policy per transport, recorded; the validation's
  replies capped at 16,000 tokens, a cut one never graded silently.** What a
  reply runs under was spread over constants in and around the agent loop.
  `web/src/llm/runPolicy.ts` now states it for each transport (Claude, an
  OpenAI-compatible server such as LM Studio, Ollama), each field read from
  the constant that decides it: the round limit, the tools a model is offered,
  when older results are shortened, the temperature (none for Claude), the
  output cap of a reply and of a tuning request, whether the model's thinking
  is sent back, and the window plan. The agent loop reads it; what the app
  sends is unchanged, byte for byte. A validation run runs under its
  transport's policy as the app ships it, with one output cap on every
  request, the loop's and the tuning's, in either arm (`VALIDATION_MAX_TOKENS`,
  16,000; the app keeps Claude's 64,000 and no cap on a local server). Each
  run's record keeps the policy it ran under (`run_policy`) and every request
  whose reply stopped at its output limit (Claude's `max_tokens`, an
  OpenAI-style or Ollama `length`), the loop's and the tuning's
  (`truncated`); both are optional, so the schema stays
  `nebula3d-validation-run/1`. The transcript prints the policy and says when
  a reply was cut; `python -m nebula3d.validation summarize` counts the cut
  runs per case and arm (`truncated`) and names them in a line under the
  table. The live runner sends Claude no temperature and records none, in
  place of `?? 0.2` (its transport already sent none). Plan 1.1; the cap is
  the manager's decision, confirmed by the user, 2026-10-24.
