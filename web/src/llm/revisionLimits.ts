// The limits on an answer's revision (THY-84). When an answer fails its checks
// it goes back to the model once (agent.ts, ANSWER_REVISIONS), and the revision
// only has to drop or correct claims. On gemma4:26b a revision sometimes ran to
// the 16,000-token output cap instead, about 5.5 minutes, and the cut-off reply
// then failed the graders (the B-auto evals, 2026-11-07; again on 2026-11-25:
// dev-flatten's fix). Two limits the model never sees bound it:
//
// - its own output cap, from the length of the answer it revises;
// - a stop when its text, or its thinking, starts repeating itself.
//
// A revision stopped by either is a revision cut off: the answer it revised
// stands, its unsupported claims marked (agent.ts, keepRejected), as when a
// revision is cut at the loop's cap. Its note says it was cut at an output
// limit, or, for a repetition, that it repeated itself (REVISION_STOPPED_NOTE).

import { PROSE_CHARS_PER_TOKEN } from "./provider/tokens";

/** The least a revision may write, thinking included: room to think, then restate an answer. */
export const REVISION_MIN_TOKENS = 4_096;
/** A revision may write this many times the answer it revises. */
export const REVISION_LENGTH_FACTOR = 2;

/**
 * The output cap of the request that revises *rejected*: twice its length,
 * at least REVISION_MIN_TOKENS, and never above the loop's own cap (null: the
 * loop asks none, the server's limit holds).
 */
export function revisionOutputCap(rejected: string, loopCap: number | null): number {
  const own = Math.max(REVISION_MIN_TOKENS, Math.ceil((REVISION_LENGTH_FACTOR * rejected.length) / PROSE_CHARS_PER_TOKEN));
  return loopCap == null ? own : Math.min(loopCap, own);
}

/** The tail that must recur, in characters. */
export const REPEAT_TAIL = 200;
/** How often the tail must occur, itself included, within REPEAT_WINDOW. */
export const REPEAT_TIMES = 4;
/** The span of the text's end searched for the tail, in characters. */
export const REPEAT_WINDOW = 6_000;

/**
 * Whether *text* ends in a loop: its last REPEAT_TAIL characters occur
 * REPEAT_TIMES times or more within its last REPEAT_WINDOW characters. An
 * answer restating a heading or a number does not repeat 200 characters four
 * times; a model stuck in a loop does.
 */
export function endsRepeating(text: string): boolean {
  if (text.length < REPEAT_TAIL * REPEAT_TIMES) return false;
  const span = text.slice(-REPEAT_WINDOW);
  const tail = span.slice(-REPEAT_TAIL);
  if (!tail.trim()) return false;
  let count = 0;
  for (let at = span.indexOf(tail); at >= 0; at = span.indexOf(tail, at + 1)) {
    if (++count >= REPEAT_TIMES) return true;
  }
  return false;
}
