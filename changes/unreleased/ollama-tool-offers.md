- **Validation: a run on an Ollama model records its tool offers.** The run's
  record keeps the tools each chat request offered (`tool_offers`), taken
  from requests to `/chat/completions` and `/v1/messages`. The app talks to a
  model at Ollama's port through Ollama's own chat API, `/api/chat`, so a run
  on gemma4:26b recorded none, and its transcript said "Not recorded.". The
  recorder now takes Ollama's chat requests too, with the tools their bodies
  carry, and leaves Ollama's other calls out. Nothing else in the record
  depended on those paths: the token counts were recorded for Ollama runs
  before. Records made before keep their empty offers. Finding P1.2b, decided
  by the manager on the user's delegation, 2026-10-24.
