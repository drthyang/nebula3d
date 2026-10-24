// The eval suite's CI replay: each scenario played by a scripted model against
// the tool results recorded on the eval datasets (fixtures/hex90k.json, from
// probe.test.ts), through the real agent loop, messages and graders.  A good
// script must pass every check without running past its end; a bad one, the
// failure as models made it, must fail the checks named for it.  Real models
// run the same scenarios in live.test.ts. The scripts are in replays.ts.

import { describe, expect, it } from "vitest";

import { transcript } from "./harness";
import { replay, REPLAYS } from "./replays";
import { SCENARIOS } from "./scenarios";

describe("NEBULA Pilot evals, replayed", () => {
  it("has a replay for every scenario", () => {
    expect(Object.keys(REPLAYS).sort()).toEqual(SCENARIOS.map((s) => s.id).sort());
  });

  for (const scenario of SCENARIOS) {
    it(`${scenario.id}: a good run passes, a bad one is caught`, async () => {
      const r = REPLAYS[scenario.id];
      const good = await replay(scenario, r.good);
      const failing = good.result.grades.filter((g) => !g.pass);
      expect(failing, `${failing.map((g) => `${g.check}: ${g.detail}`).join("\n")}\n${transcript(good.result.run)}`).toEqual([]);
      expect(good.result.passed).toBe(true);
      expect(good.model.overrun()).toBe(0);
      expect(good.result.run.usage?.requests).toBe(r.good.length);

      const bad = await replay(scenario, r.bad);
      const caught = bad.result.grades.filter((g) => !g.pass).map((g) => g.check);
      expect(bad.result.passed).toBe(false);
      for (const name of r.catches) expect(caught, `${name}\n${transcript(bad.result.run)}`).toContain(name);
      if (r.flags) expect(bad.result.run.note ?? "", transcript(bad.result.run)).toMatch(r.flags);
      else expect(bad.result.run.note ?? "", "a bad run the answer checks do not flag").not.toMatch(/Not measured|Contradicts/);
    });
  }
});
