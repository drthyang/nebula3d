// Moving the chat to a reply, for the Auto panel's links (AutoPanel.tsx).

import { useNavStore } from "../../state/navStore";

/** Scroll the chat to a reply, and pulse it. */
export function goToTurn(turn: number): void {
  useNavStore.getState().setDockOpen(true);
  requestAnimationFrame(() => {
    const el = document.getElementById(`ai-turn-${turn}`);
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: "smooth" });
    el.classList.remove("is-pulsed");
    void el.offsetWidth;
    el.classList.add("is-pulsed");
  });
}

/** The run's "Report ↗": the report document of its report reply, as the reply's Report button opens it; without a way to open it, the chat at the reply. */
export function openRunReport(turn: number, onReport: ((turn: number) => void) | undefined): void {
  if (onReport) onReport(turn);
  else goToTurn(turn);
}
