// How long the Pilot has been working: one reply in manual mode, and (later)
// a whole auto run, measured against its limit with the time spent waiting for
// the user kept apart (docs/pilot-auto-mode-design.md §2.5). Pure: every
// function takes the time it is asked about, so a test drives it with a fake
// clock. UI only: the model never reads it.

export interface RunClock {
  startedAt: number; // ms (Date.now())
  pausedMs: number; // the pauses that ended
  pausedAt: number | null; // in a pause since then
  endedAt: number | null; // stopped: the time stands
  limitMs?: number; // an auto run's wall-clock limit (the paused time not counted)
}

/** A clock started at `now`, with an optional limit. */
export const startClock = (now: number, limitMs?: number): RunClock => ({
  startedAt: now,
  pausedMs: 0,
  pausedAt: null,
  endedAt: null,
  ...(limitMs !== undefined ? { limitMs } : {}),
});

/** The clock paused at `now` (already paused, or stopped: as it was). */
export const pauseClock = (c: RunClock, now: number): RunClock => (c.pausedAt !== null || c.endedAt !== null ? c : { ...c, pausedAt: now });

/** The clock going again at `now`, the pause added to the paused time. */
export const resumeClock = (c: RunClock, now: number): RunClock =>
  c.pausedAt === null || c.endedAt !== null ? c : { ...c, pausedMs: c.pausedMs + Math.max(0, now - c.pausedAt), pausedAt: null };

/** The clock stopped at `now`: a pause it was in ends there too. */
export const stopClock = (c: RunClock, now: number): RunClock => {
  if (c.endedAt !== null) return c;
  const resumed = resumeClock(c, now);
  return { ...resumed, endedAt: now };
};

const until = (c: RunClock, now: number): number => c.endedAt ?? now;

/** The time paused, the pause it is in included. */
export const pausedMs = (c: RunClock, now: number): number =>
  c.pausedMs + (c.pausedAt !== null ? Math.max(0, until(c, now) - c.pausedAt) : 0);

/** The time it worked: from the start to now (or the stop), less the pauses. */
export const elapsedMs = (c: RunClock, now: number): number => Math.max(0, until(c, now) - c.startedAt - pausedMs(c, now));

/** Whether the working time has reached the limit (never, without one). */
export const overLimit = (c: RunClock, now: number): boolean => c.limitMs !== undefined && elapsedMs(c, now) >= c.limitMs;

/** A duration as a clock reads: 0:07, 1:23, 1:02:03. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * The clock as one plain line, result first: "Working · 1:23" for a reply;
 * with a limit, "6:12 of 30:00"; in a pause, "Paused · …"; the paused time,
 * when there is any, after it ("· paused 2:05").
 */
export function clockLine(c: RunClock, now: number): string {
  const worked = formatDuration(elapsedMs(c, now));
  const state = c.endedAt !== null ? "Took" : c.pausedAt !== null ? "Paused" : "Working";
  const main = c.limitMs !== undefined ? `${worked} of ${formatDuration(c.limitMs)}` : worked;
  const paused = pausedMs(c, now);
  return `${state} · ${main}${paused >= 1000 ? ` · paused ${formatDuration(paused)}` : ""}`;
}
