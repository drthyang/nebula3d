- **NEBULA Pilot: the facts about the sample are refused in code.** The
  search's protected planes and the punch cell (`punchProtectH`,
  `punchProtectHalfWidth`, `punchSupercellH/K/L`) change only when the
  user's latest message names them, as the bragg-node-audit skill's firm rule
  says. `update_settings` accepted them from the model before, and only its
  description asked it to wait. The agent loop now hands the tools the user's
  latest message, as the conversation arrived (never what the loop itself
  sends as the user), and `update_settings` refuses a change to a fact that
  message does not name: "punchSupercellH is a fact about the sample, which
  only the user sets: ask the user, and change it once they name it." The
  call's other changes are made, and its result lists both. Each fact's words
  are in `web/src/llm/tune/catalog.ts`: its key; for the protected planes
  "protect…" with "plane(s)", "H fractions", the Configure page's "Search
  skips H" (and a width as well for their half width); for the punch cell
  "supercell", "punch cell", "indexing cell", "doubled cell" or an n×n×n
  cell, all three axes. They name the setting, not the physics: "satellites",
  "modulation", a "plane" or a "cell" alone name nothing, nor does a bare
  "yes". The magnetic ion stays out of the model's reach altogether. The
  tool's description says so (about 22 more estimated tokens with every
  request that offers it). The validation counts a change to a sample fact the task never named
  whether it got through or was refused, since the model tried; a
  candidate finding tells the two apart (plan 4.8, the manager's decision on
  the user's delegation, 2026-10-19).
