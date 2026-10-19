// How the Execution page shows a run's log lines: each line's colour, from its
// status and its marks. Pure, so it is tested without the page.

import type { JobEvent } from "../api/types";

/**
 * Whether a line holds a warning (⚠): something the run says the user must not
 * miss. A stage's done line can end on one, as the ring removal's does when its
 * grid is too coarse to confirm the ring candidates it detected (it subtracts none, and
 * says how many): the line, and the stage's summary that shows it, read as a
 * warning, not as a success.
 */
export const warns = (message: string | null | undefined): boolean => Boolean(message?.includes("⚠"));

/** A log line's colour class, from its status and its marks (✗, ⚠, ✓, ■). */
export function logClass(ev: JobEvent): string {
  const m = ev.message ?? "";
  if (ev.status === "error" || m.startsWith("✗")) return "error";
  if (warns(m)) return "warn";
  if (ev.status === "done" || ev.status === "skip" || m.startsWith("✓")) return "success";
  if (ev.status === "start") return "blue";
  if (m.startsWith("■")) return "warn";
  if (ev.type === "done" || ev.type === "cancelled") return "dim";
  return "info";
}
