// The Pilot's working clock (clock.ts) on a fake clock: a reply's, and an
// auto run's, its limit enforced but never shown, with the time paused kept apart.

import { describe, expect, it } from "vitest";

import { clockLine, elapsedMs, formatDuration, leftMs, overLimit, pausedMs, pauseClock, resumeClock, startClock, stopClock, totalMs } from "../clock";

const S = 1000;
const M = 60 * S;

describe("the working clock", () => {
  it("counts from its start, and stands once stopped", () => {
    const c = startClock(10 * S);
    expect(elapsedMs(c, 10 * S)).toBe(0);
    expect(elapsedMs(c, 93 * S)).toBe(83 * S);
    expect(clockLine(c, 93 * S)).toBe("Working · 1:23");
    const stopped = stopClock(c, 100 * S);
    expect(elapsedMs(stopped, 500 * S)).toBe(90 * S);
    expect(clockLine(stopped, 500 * S)).toBe("Took · 1:30");
    expect(stopClock(stopped, 900 * S)).toBe(stopped);
  });

  it("leaves the pauses out of the working time, and counts them apart", () => {
    let c = startClock(0, 30 * M);
    c = pauseClock(c, 5 * M);
    expect(pauseClock(c, 6 * M)).toBe(c); // already paused
    expect(elapsedMs(c, 7 * M)).toBe(5 * M);
    expect(pausedMs(c, 7 * M)).toBe(2 * M);
    expect(clockLine(c, 7 * M)).toBe("Paused · 5:00 · paused 2:00 · total 7:00");
    c = resumeClock(c, 8 * M);
    expect(resumeClock(c, 9 * M)).toBe(c); // not paused
    expect(elapsedMs(c, 10 * M)).toBe(7 * M);
    expect(clockLine(c, 10 * M)).toBe("Working · 7:00 · paused 3:00 · total 10:00");
    expect(totalMs(c, 10 * M)).toBe(10 * M);
    expect(leftMs(c, 10 * M)).toBe(23 * M);
    // Stopped in a pause: the pause ends there.
    const stopped = stopClock(pauseClock(c, 12 * M), 14 * M);
    expect(elapsedMs(stopped, 99 * M)).toBe(9 * M);
    expect(pausedMs(stopped, 99 * M)).toBe(5 * M);
    // The run's whole time stands at the stop: the working time and the pauses.
    expect(totalMs(stopped, 99 * M)).toBe(14 * M);
    expect(clockLine(stopped, 99 * M)).toBe("Took · 9:00 · paused 5:00 · total 14:00");
    expect(leftMs(startClock(0), 5 * M)).toBeNull();
  });

  it("reaches its limit on working time only", () => {
    let c = startClock(0, 10 * M);
    c = resumeClock(pauseClock(c, 4 * M), 30 * M);
    expect(overLimit(c, 35 * M)).toBe(false);
    expect(overLimit(c, 36 * M)).toBe(true);
    expect(overLimit(startClock(0), 99 * M)).toBe(false); // no limit
  });

  it("reads as a clock does", () => {
    expect([0, 7 * S, 83 * S, 10 * M, 62 * M + 3 * S, -5].map(formatDuration)).toEqual(["0:00", "0:07", "1:23", "10:00", "1:02:03", "0:00"]);
  });
});
