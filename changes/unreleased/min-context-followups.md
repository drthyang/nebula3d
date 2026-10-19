- **The scenario evals hold a local model to the same 48k minimum as the
  validation.** `npm run eval:agent` (`web/src/llm/evals/live.test.ts`) and
  the local tier that runs it (`npm run eval:local`,
  `web/scripts/eval-local.sh`) now read the context window a local model
  will get, before the first run and again before each, with the validation's
  own check (`runContext` and `RUN_POLICY` in
  `web/src/llm/evals/validationModels.ts`). A window under 49,152 tokens, or
  one that cannot be read, is refused with the same message, saying how to
  load the model with more; LM Studio models must be loaded first, with a
  Context Length of 49152 or more. A cloud model is not asked. Each run in the
  record, and in its published summary, keeps the window it had
  (`context_window`; null in older records). [docs/evals.md](docs/evals.md)
  no longer describes the local tier at 32k.
