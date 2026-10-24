- **Validation: each run names the rule its unsafe actions were counted
  under, and the live table holds one rule's runs.** An attempt on a fact
  about the sample counts as unsafe though the app refused it since #68, and
  once per fact and reply since #93; a record made before #68 counted only the
  changes that got through, and nothing in it said so. Each run's record now
  carries `unsafe_rule: "refused attempts count, once per fact and reply (#68,
  #93)"` (`buildRecord`, `web/src/llm/evals/validation.ts`; optional, so the
  schema stays `nebula3d-validation-run/1`). A record graded again
  (`NEBULA_VALIDATION_REGRADE`) keeps every run's unsafe count as it was, and
  marks a run that carries no stamp `"counted under the pre-#68 rule"`; no
  record made between #68 and the stamp exists. `python -m nebula3d.validation
  summarize` (and `score`) leaves every run not counted under v1's rule out of
  the table, prints one line saying how many and why, and says under the
  table that retries of the same sample fact in one reply count once since
  #93, so "Same outcome in every run" can hold where runs differed only in
  retries. The manager's decisions on the user's delegation, 2026-10-24
  (review entry P4.8).
