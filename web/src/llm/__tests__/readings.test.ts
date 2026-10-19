// A tool result's two readings (readings/): what the tool found and what the
// model read. `fit` makes the model's copy of a result and keeps the whole
// beside it; `shorten` shortens that copy later in a long reply; `found`,
// `seen` and `whole` read a step, live, old (without `full`) or round-tripped
// through JSON, and never throw.

import { describe, expect, it, vi } from "vitest";

import type { AgentStep } from "../agent";
import { fit, found, seen, shorten, whole, type Readable } from "../readings";
import { COMPACTED, isCompacted } from "../readings/compact";
import { MAX_TEXTS } from "../readings/found";
import { MAX_RESULT_CHARS } from "../tools";

// An assess_stage rings result past the limit: a long goal, long per-plane lists.
const residuals = (n: number) => Array.from({ length: n }, (_, i) => ({ at: 1 + i / 10, residual_fraction: 0.1, noise_fraction: 0.05, significant: true, ring: false }));
const long = {
  rings: {
    verdict: "needs attention",
    headline: "ring ratio 0.7 · left ≤ 0.4 (h0l, 3.16 Å⁻¹)",
    max_ring_left: 0.4,
    per_plane: { hk0: { ring_residuals: residuals(30) }, h0l: { ring_residuals: residuals(30) }, "0kl": { ring_residuals: residuals(30) } },
    goal: "g".repeat(1500),
  },
};

const done = (result: string, full?: string): AgentStep => ({ id: "1", name: "assess_stage", args: {}, status: "done", result, ...(full !== undefined ? { full } : {}) });
/** A step whose result went through fit, as the executor hands it to the loop. */
const fitted = (value: unknown, max = MAX_RESULT_CHARS): AgentStep => {
  const { text, full } = fit(value, max);
  return done(text, full);
};
/** How many times JSON.parse read *text* while *read* ran. */
const parsesOf = (text: string, read: () => void): number => {
  const spy = vi.spyOn(JSON, "parse");
  try {
    read();
    return spy.mock.calls.filter(([t]) => t === text).length;
  } finally {
    spy.mockRestore();
  }
};

describe("fit: what the model reads of a result, and the whole beside it", () => {
  it("leaves a result that fits as it is, with nothing beside it", () => {
    expect(fit({ a: 1 }, 100)).toEqual({ text: '{"a":1}' });
    expect("full" in fit({ a: 1 }, 100)).toBe(false);
  });

  it("drops the bulkiest parts first, keeps the verdict, and names what it left out", () => {
    expect(JSON.stringify(long).length).toBeGreaterThan(MAX_RESULT_CHARS);
    const { text, full } = fit(long, MAX_RESULT_CHARS);
    expect(text.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    const read = JSON.parse(text) as { rings: Record<string, unknown>; left_out: string[] };
    expect(read.rings.verdict).toBe("needs attention");
    expect(read.rings.headline).toBe(long.rings.headline);
    expect(read.rings.max_ring_left).toBe(0.4);
    expect(read.left_out.length).toBeGreaterThan(0);
    expect(read.left_out.every((x) => x.startsWith("rings."))).toBe(true);
    expect(full).toBe(JSON.stringify(long));
  });

  it("cuts a text result (a skill) at the limit, marked, and keeps the whole text", () => {
    const skill = `# A skill\n\n${"Step. ".repeat(40)}`;
    expect(fit(skill, 1000)).toEqual({ text: skill });
    expect(fit(skill, 20)).toEqual({ text: `${skill.slice(0, 20)}… [truncated]`, full: skill });
  });
});

describe("shorten: the model's copy, shortened later in a long reply", () => {
  const assessment = {
    rings: {
      verdict: "needs attention",
      criterion: "No powder ring left above, or dented below, three times its plane's noise. ".repeat(3),
      headline: "ring ratio 0.713 · left ≤ 0.149 (hk0, 2.45 Å⁻¹)",
      mean_ring_energy_ratio: 0.713,
      max_ring_left: 0.149,
      worst_ring_left: { plane: "hk0", at: 2.45, residual_fraction: 0.149 },
      ring_rule: { direction_share: 0.9, height_share: 0.15 },
      shells_judged: [{ at: 1.68, ring: false }, { at: 2.45, ring: true }, { at: 3.16, ring: false }, { at: 3.66, ring: true }, { at: 4.59, ring: false }],
      per_plane: { hk0: { ring_residuals: [{ at: 1.68, residual_fraction: 0.516 }] }, h0l: { ring_residuals: [] } },
      goal: "Remove powder/Al rings: ".repeat(20),
    },
    measured_on: ["H–K plane at L = 0", "H–L plane at K = 0", "K–L plane at H = 0"],
  };

  it("keeps the verdict, headline and numbers, and drops the per-plane lists and long texts", () => {
    const short = JSON.parse(shorten(JSON.stringify(assessment)));
    expect(short).toEqual({
      rings: {
        verdict: "needs attention",
        headline: "ring ratio 0.713 · left ≤ 0.149 (hk0, 2.45 Å⁻¹)",
        mean_ring_energy_ratio: 0.713,
        max_ring_left: 0.149,
        worst_ring_left: { plane: "hk0", at: 2.45, residual_fraction: 0.149 },
        ring_rule: { direction_share: 0.9, height_share: 0.15 },
        shells_judged: "(5 items)",
      },
      measured_on: ["H–K plane at L = 0", "H–L plane at K = 0", "K–L plane at H = 0"],
      compacted: COMPACTED,
    });
  });

  it("cuts a long text that is not JSON, and leaves a short or unshrinkable result alone", () => {
    const longText = "x".repeat(1000);
    const cut = shorten(longText);
    expect(cut.length).toBeLessThan(500);
    expect(isCompacted(cut)).toBe(true);
    expect(shorten('{"got":7}')).toBe('{"got":7}');
    expect(shorten("plain words")).toBe("plain words");
  });

  it("shortens a text once: one already shortened is left as it is", () => {
    for (const text of [JSON.stringify(assessment), "x".repeat(1000)]) {
      const once = shorten(text);
      expect(shorten(once)).toBe(once);
    }
  });
});

describe("found, seen and whole: the two readings of a step", () => {
  it("reads a long result: seen is the fitted text sent, whole the whole, found the whole parsed as JSON has it", () => {
    // JSON-normalised: a field left undefined goes, a NaN reads as null.
    const value = { ...long, peak: 7.2, missing: undefined, nan: NaN };
    const step = fitted(value);
    expect(step.full).toBeDefined();
    expect(seen(step)).toBe(step.result);
    expect(seen(step).length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    expect((JSON.parse(seen(step)) as { left_out: string[] }).left_out.length).toBeGreaterThan(0);
    expect(whole(step)).toBe(JSON.stringify(value));
    expect(found(step)).toEqual(JSON.parse(JSON.stringify(value)));
    expect(found(step)).toMatchObject({ peak: 7.2, nan: null });
    expect(found(step)).not.toHaveProperty("missing");
  });

  it("reads a short result, which has no `full`: the three readings agree", () => {
    const step = fitted({ verdict: "meets its goal", peak: 7.2 });
    expect(step).not.toHaveProperty("full");
    expect(seen(step)).toBe('{"verdict":"meets its goal","peak":7.2}');
    expect(whole(step)).toBe(seen(step));
    expect(found(step)).toEqual({ verdict: "meets its goal", peak: 7.2 });
  });

  it("finds nothing in an error, a step still running, a skill's text or JSON that is no object, and reads their text whole", () => {
    const error: Readable = { status: "error", result: '{"verdict":"Error: not run"}' };
    expect(found(error)).toBeNull();
    expect([seen(error), whole(error)]).toEqual(['{"verdict":"Error: not run"}', '{"verdict":"Error: not run"}']);
    const running: Readable = { status: "running" };
    expect([found(running), seen(running), whole(running)]).toEqual([null, "", ""]);
    const text = `# A skill\n\n${"Step. ".repeat(40)}`;
    const skill = fitted(text, 20);
    expect(found(skill)).toBeNull();
    expect(whole(skill)).toBe(text);
    expect(seen(skill)).toBe(`${text.slice(0, 20)}… [truncated]`);
    for (const result of ["[1,2]", "42", "null", '"text"', "{", "", "Error: x"]) expect(found({ status: "done", result })).toBeNull();
  });

  it("reads a step round-tripped through JSON as it was, and an old step without `full` from its result", () => {
    const step = fitted(long);
    const back = JSON.parse(JSON.stringify(step)) as AgentStep;
    expect([seen(back), whole(back)]).toEqual([seen(step), whole(step)]);
    expect(found(back)).toEqual(found(step));
    const old: AgentStep = { id: "0", name: "ub_check", args: {}, status: "done", result: '{"angle_deg":0.61}' };
    expect([seen(old), whole(old)]).toEqual(['{"angle_deg":0.61}', '{"angle_deg":0.61}']);
    expect(found(old)).toEqual({ angle_deg: 0.61 });
  });

  it("parses each text once, and every reader shares the one frozen value", () => {
    const text = JSON.stringify({ rings: { verdict: "needs attention", series: [1, 2] }, unique: Math.random() });
    let first: ReturnType<typeof found> = null;
    let again: ReturnType<typeof found> = null;
    expect(
      parsesOf(text, () => {
        first = found(done(text));
        again = found(done("the model's copy", text)); // the same text, as another step's whole
      }),
    ).toBe(1);
    expect(again).toBe(first);
    const value = first as unknown as { rings: { verdict: string; series: number[] } };
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.rings)).toBe(true);
    expect(Object.isFrozen(value.rings.series)).toBe(true);
    expect(() => {
      value.rings.verdict = "meets its goal";
    }).toThrow(TypeError);
  });

  it("keeps a bounded number of texts: the oldest is parsed again once dropped", () => {
    const oldest = JSON.stringify({ oldest: Math.random() });
    found(done(oldest));
    expect(parsesOf(oldest, () => found(done(oldest)))).toBe(0);
    for (let i = 0; i < MAX_TEXTS; i++) found(done(JSON.stringify({ i, r: Math.random() })));
    expect(parsesOf(oldest, () => found(done(oldest)))).toBe(1);
  });
});
