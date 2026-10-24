- **NEBULA Pilot: each tool's result has a shape contract, and the limits
  Python and TypeScript share are pinned.** `web/src/llm/tools/contracts.ts`
  writes the shape of every tool's result whose result is an object (all but
  read_skill's text): its fields, their types, which may be left out, and the
  other shapes a tool returns on its other paths. The tests hold the results
  to them: the synthetic samples the model-visible snapshots take (arms B and
  C), the paths those do not reach (run by the tools on the synthetic
  crystal), and every tool run live on the validation's dev control through
  the CPython bridge (and the ring and texture checks on 161³, where they
  judge). `sharedLimits.replay.test.ts` imports the package and fails when a
  limit both languages hold differs: the window's 1e-3, the fill texture's
  limits and its coarse-grid rule, the ring rule's shares in the rings'
  criterion, the UB turn, the flatten's fit range and floors, the coverage's
  shares, the ΔPDF origin's disk, the stage lists, and every setting's default
  as the tuning catalog states it. The copies kept apart on purpose (the
  scorer's tolerances, the grader's UB noise, the ring texture order's 8 and 6)
  are listed with their reasons, not pinned. Test-only: no tool, verdict,
  prompt or snapshot changes.
