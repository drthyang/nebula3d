- **The flatten is called "Background correction" in the console.** The
  stage subtracts the fitted isotropic radial background (const + c·F(Q)², and
  b·Q² when chosen), and the console now names it so: the Configure card and
  its output ("Background corrected"), the Execution page's stage, Reciprocal
  cleanup's view ("Background-corrected"), the Q–R page's hints, NEBULA
  Pilot's review chip, the tuning cards, the report and the docs. Every
  identifier keeps the name flatten, so saved settings, sessions, outputs
  (`*_flattened.h5`), scripts and the Pilot's tools work as before. What the
  model reads (the Pilot's system and tuning prompts, the skills, the tools'
  lines and errors, among them the server's "no flattened/backfilled volume",
  the verdict under a reply and the answer checks' words) and the pipeline's
  log lines keep "flatten" for now: the validation is frozen at
  812e686 (docs/evals.md, "The freeze"), and their wording waits for its live
  runs.
