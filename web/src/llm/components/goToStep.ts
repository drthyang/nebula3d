// A link to a step in the chat: the transcript scrolls to it, opens the list
// it is in, and pulses it. A step of the reply being written is under its live
// id; one of a past reply under its turn's; one an auto run made itself where
// the transcript shows it (auto/transcript.ts): in the run's own blocks, or
// as the first steps of the reply it was seeded into.

import { useNavStore } from "../../state/navStore";
import { useAutoStore } from "../auto/store";
import { autoTranscript, isAppStep, stepElementId } from "../auto/transcript";
import { useChatStore } from "../chatStore";

/** The DOM id of a step's row: `turn` null is the reply being written. */
export function stepDomId(turn: number | null, stepId: string): string {
  if (isAppStep({ id: stepId })) {
    const run = useAutoStore.getState().run;
    const place = run ? autoTranscript(run, useChatStore.getState().turns).where.get(stepId) : undefined;
    return stepElementId(place ?? { turn: null, stepId });
  }
  return turn === null ? `ai-step-live-${stepId}` : `ai-step-${turn}-${stepId}`;
}

/** Scroll the chat to the step and pulse it (the Pilot opened first, on a phone). */
export function goToStep(turn: number | null, stepId: string): void {
  useNavStore.getState().setDockOpen(true);
  requestAnimationFrame(() => {
    const el = document.getElementById(stepDomId(turn, stepId));
    if (!el) return;
    const list = el.closest("details");
    if (list && !list.open) list.open = true;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.remove("is-pulsed");
    void el.offsetWidth;
    el.classList.add("is-pulsed");
  });
}
