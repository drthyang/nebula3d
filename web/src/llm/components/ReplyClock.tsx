// The Pilot's working time while a reply runs, one plain line in the panel's
// title row ("Working · 1:23"), ticking each second (clock.ts). It reads any
// RunClock, so an auto run's clock (its limit, its paused time) shows the same way.

import { useEffect, useState } from "react";

import { useChatStore } from "../chatStore";
import { clockLine, type RunClock } from "../clock";

export function ClockLine({ clock, className = "ai-clock" }: { clock: RunClock; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (clock.endedAt !== null) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [clock]);
  return (
    <span className={className} role="timer" aria-live="off" title="How long NEBULA Pilot has worked on this reply">
      {clockLine(clock, Math.max(now, clock.startedAt))}
    </span>
  );
}

/** The running reply's clock; nothing between replies. */
export function ReplyClock() {
  const clock = useChatStore((s) => s.clock);
  return clock ? <ClockLine clock={clock} /> : null;
}
